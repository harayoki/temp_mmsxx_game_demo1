// **タッチ操作**の GUI(画面の上の十字とショット)。**DOM だけで作る**。
// canvas には何も描かない。設計は docs/SMARTPHONE.md の 3〜5 節と 8 節。
//
// **ゲームパッドはここではない。** あちらは engine/util/gamepad.js。
// 送る種別も touch / pad で分かれている(docs/TODO.md の O 章)。
//
//   import { TouchControls } from './engine/util/touch.js';
//
//   const touch = new TouchControls({
//     onPress:   (code, source) => mmsxx.input.press(code, source),
//     onRelease: (code, source) => mmsxx.input.release(code),
//   });
//   touch.attach(document.body);
//
// ## エンジンにも game にも依存しない
//
// ここは**押した / 離したを呼び出し側へ知らせるだけ**。Input も mmsxx も触らない。
// SMARTPHONE.md の 10 節では `new TouchControls(mmsxx, ...)` と書いてあるが、
// 通知にしたので mmsxx は要らなくなった。繋ぐのは呼び出し側の仕事。
//
// ## 押されたときの「何で押したか」
//
// onPress の第 2 引数に **かならず 'touch'** を載せる。受け取る側は素通しすればよい:
//
//   onPress: (code, source) => mmsxx.input.press(code, source),
//
// こうすると繋ぐ側が種別を書く判断をしないので、**付け忘れが起きない**。
// 'touch' という文字列を持っているのはこのファイルの SOURCE 1 か所だけ。
// TODO: ランキングの窓口(markInputSource)へ繋ぐのは game/main.js 側。
//   docs/TODO.md の O 章。組み込みのときに一緒にやる
//
// ## つまみ(手触りを詰めるための値)
//
// すべて setOptions() で**動かしたまま**変えられる。touch-tool/ で実機で触って決める。
// 決まった値をここの既定値に書き戻すこと。

/** 押されたと知らせるときの種別。**ここ 1 か所だけ** */
const SOURCE = 'touch';

/** 8 方向。角度の区画(45 度ずつ)の順に、立てるキーを並べたもの */
const SECTOR_KEYS = [
  ['ArrowRight'],                 // 0:   0 度(右)
  ['ArrowRight', 'ArrowDown'],    // 1:  45
  ['ArrowDown'],                  // 2:  90(下。画面の y は下向き)
  ['ArrowLeft', 'ArrowDown'],     // 3: 135
  ['ArrowLeft'],                  // 4: 180
  ['ArrowLeft', 'ArrowUp'],       // 5: 225
  ['ArrowUp'],                    // 6: 270
  ['ArrowRight', 'ArrowUp'],      // 7: 315
];

const DEFAULTS = {
  side: 'left',        // 十字をどちら側に置くか('left' / 'right')
  dpadZone: 28,        // 十字エリアの幅(画面幅に対する %)
  deadzone: 12,        // これ未満しか動いていなければ無入力(px)
  dragMax: 48,         // これより離れたら原点を引きずる(px)
  hysteresis: 7,       // 区画の境目の重なり(度)。ばたつき止め
  guiRadius: 36,       // 十字の四角を、原点からどれだけ離して置くか(px)
  shotZone: 28,        // ショットエリアの幅(%)
  shotMode: 'D',       // 'A' 区画割り / 'B' 移動量 / 'C' 出入り / 'D' 往復
  shotStep: 24,        // A なら区画の一辺、B なら 1 発ぶんの移動量(px)
  holdRepeatMs: 0,     // 長押しの連射間隔(ms)。**0 で無し**(連射は腕前のまま)
  shotCode: 'Space',
  pauseCode: 'Escape',
};

export class TouchControls {
  /**
   * @param {{
   *   onPress?:   (code:string, source:string) => void,
   *   onRelease?: (code:string, source:string) => void,
   *   side?: string, dpadZone?: number, deadzone?: number, dragMax?: number,
   *   hysteresis?: number, guiRadius?: number,
   *   shotZone?: number, shotMode?: string, shotStep?: number,
   *   holdRepeatMs?: number, shotCode?: string, pauseCode?: string,
   *   toLocal?: (x:number, y:number) => number[],
   * }} [opts]
   */
  constructor(opts = {}) {
    this.onPress = opts.onPress || null;
    this.onRelease = opts.onRelease || null;
    /**
     * 画面の座標を、パッドを載せている入れ物の座標へ移す。
     * **画面を 90 度回して見せているときに要る**(SMARTPHONE.md 7 節)。
     * 置きかたを知っているのは呼び出し側なので、変換も呼び出し側から渡す。
     * null なら回っていない(そのまま使う)。あとから差し替えてよい
     */
    this.toLocal = opts.toLocal || null;
    /** つまみ。setOptions() で書き換える */
    this.opts = { ...DEFAULTS, ...opts };

    /** いま押していることになっている code */
    this.down = new Set();
    /** pointerId ごとの担当。**途中で入れ替えない**(SMARTPHONE.md 8 節) */
    this.pointers = new Map();

    /** 相対十字の様子(touch-tool が読む) */
    this.stick = { active: false, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0, dist: 0, deg: 0, sector: -1 };
    /** こすり打ちの様子(touch-tool が読む) */
    this.rub = { pressCount: 0, releaseCount: 0, move: 0, rate: 0, maxRate: 0, cell: '', turns: 0 };

    this.el = null;
    this._host = null;
    /** 1 コマだけ押すための仕掛け */
    this._pulseDown = new Set();
    this._pulseQueue = new Map();
    this._pulseRaf = 0;
    /** 直近の発射の時刻(1 秒あたりの連射数を出すため) */
    this._shotTimes = [];
    /** 長押しの見張り */
    this._holdTimer = 0;
    this._lastShotAt = 0;
  }

  // ── 取り付け ──────────────────────────────────────────

  /** DOM に取り付ける。@param {HTMLElement} host 置き場所 */
  attach(host) {
    if (this.el) this.detach();
    injectStyle();
    this._host = host;
    this.el = buildDom();
    this._applyLayout();
    host.appendChild(this.el);

    this._dpad = this.el.querySelector('.mmsxx-touch-dpad');
    this._shot = this.el.querySelector('.mmsxx-touch-shot');
    this._fire = this.el.querySelector('.mmsxx-touch-fire');
    this._pause = this.el.querySelector('.mmsxx-touch-pause');
    this._knob = this.el.querySelector('.mmsxx-touch-knob');
    this._stickEl = this.el.querySelector('.mmsxx-touch-stick');

    this._bind(this._dpad, 'dpad');
    this._bind(this._fire, 'shot');
    this._bind(this._pause, 'pause');
    return this;
  }

  /** 外す。押しっぱなしは全部離してから */
  detach() {
    if (!this.el) return;
    this.releaseAll();
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
    this._host = null;
  }

  /** 出し入れ */
  get visible() { return !!this.el && this.el.style.display !== 'none'; }
  set visible(v) {
    if (!this.el) return;
    if (!v) this.releaseAll();
    this.el.style.display = v ? '' : 'none';
  }

  /** つまみを変える。**動かしたまま効く** */
  setOptions(patch) {
    Object.assign(this.opts, patch);
    this._applyLayout();
  }

  /** 押しっぱなしを全部離す(画面が非アクティブになったときなど) */
  releaseAll() {
    for (const code of [...this.down]) this._release(code);
    this.pointers.clear();
    this._pulseDown.clear();
    this._pulseQueue.clear();
    this._stopHold();
    this.stick.active = false;
    this._hideRing();
    this._paint();
  }

  /** 数えたぶんを捨てる(touch-tool の RESET) */
  reset() {
    this.releaseAll();
    this.rub.pressCount = 0;
    this.rub.releaseCount = 0;
    this.rub.move = 0;
    this.rub.turns = 0;
    this.rub.rate = 0;
    this.rub.maxRate = 0;
    this._shotTimes.length = 0;
  }

  /** いまの様子をまとめて渡す(touch-tool の計器盤が読む) */
  state() {
    this._trimShotTimes();
    return {
      down: [...this.down],
      pointers: [...this.pointers.entries()].map(([id, p]) => ({
        id, owner: p.owner, x: Math.round(p.x), y: Math.round(p.y),
      })),
      stick: { ...this.stick },
      rub: { ...this.rub },
    };
  }

  // ── 座標 ──────────────────────────────────────────────
  //
  // 画面を回して見せているときは、指の場所も同じだけ回さないと、
  // 見えている場所と当たり判定がずれる。**ここから下はすべて入れ物の座標**で扱う。

  /** pointer の場所を入れ物の座標にする */
  _pt(e) {
    if (!this.toLocal) return { x: e.clientX, y: e.clientY };
    const [x, y] = this.toLocal(e.clientX, e.clientY);
    return { x, y };
  }

  /**
   * 要素の四角を入れ物の座標にする。
   * 90 度単位の回転なら、向かい合う角を 2 つ移して並べ直せば元の四角に戻る
   */
  _rectOf(el) {
    const r = el.getBoundingClientRect();
    if (!this.toLocal) return r;
    const [ax, ay] = this.toLocal(r.left, r.top);
    const [bx, by] = this.toLocal(r.right, r.bottom);
    const left = Math.min(ax, bx), right = Math.max(ax, bx);
    const top = Math.min(ay, by), bottom = Math.max(ay, by);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  // ── 見た目 ────────────────────────────────────────────

  _applyLayout() {
    if (!this.el) return;
    const o = this.opts;
    this.el.dataset.side = o.side;
    this.el.style.setProperty('--r', o.guiRadius + 'px');
    this.el.querySelector('.mmsxx-touch-dpad').style.width = o.dpadZone + '%';
    this.el.querySelector('.mmsxx-touch-shot').style.width = o.shotZone + '%';
  }

  /** 押しているところを明るくする。**音は鳴らさない** */
  _paint() {
    if (!this.el) return;
    for (const arrow of this.el.querySelectorAll('.mmsxx-touch-arrow')) {
      arrow.classList.toggle('on', this.down.has(arrow.dataset.code));
    }
    if (this._fire) this._fire.classList.toggle('on', this.down.has(this.opts.shotCode));
    if (this._pause) this._pause.classList.toggle('on', this.down.has(this.opts.pauseCode));
  }

  // ── 通知 ──────────────────────────────────────────────

  _press(code) {
    if (this.down.has(code)) return;
    this.down.add(code);
    if (this.onPress) this.onPress(code, SOURCE);
    if (code === this.opts.shotCode) this._countShot();
    this._paint();
  }

  _release(code) {
    if (!this.down.has(code)) return;
    this.down.delete(code);
    if (this.onRelease) this.onRelease(code, SOURCE);
    if (code === this.opts.shotCode) this.rub.releaseCount++;
    this._paint();
  }

  /**
   * **1 コマだけ押す**。押した直後に離すとゲーム側の wasPressed() が拾えないので、
   * 離すのは次の描き替えまで待つ。
   *
   * **待っているあいだに来たぶんは捨てる。** 貯めると、指を止めたあとも
   * 上限(1 コマ 1 発 = 60 発/秒)で出続けてしまう。実際そうなって、
   * 一気に指を滑らせるだけで 60 発/秒に張り付いた
   */
  _pulse(code) {
    if (this._pulseDown.has(code) || this.down.has(code)) return;
    this._press(code);
    this._pulseDown.add(code);
    this._runPulses();
  }

  _runPulses() {
    if (this._pulseRaf) return;
    this._pulseRaf = requestAnimationFrame(() => {
      this._pulseRaf = 0;
      for (const code of [...this._pulseDown]) {
        this._release(code);
        this._pulseDown.delete(code);
      }
    });
  }

  _countShot() {
    const now = performance.now();
    this.rub.pressCount++;
    this._lastShotAt = now;
    this._shotTimes.push(now);
    this._trimShotTimes();
    if (this.rub.rate > this.rub.maxRate) this.rub.maxRate = this.rub.rate;
  }

  /** 直近 1 秒に入っているものだけ残す */
  _trimShotTimes() {
    const cut = performance.now() - 1000;
    while (this._shotTimes.length && this._shotTimes[0] < cut) this._shotTimes.shift();
    this.rub.rate = this._shotTimes.length;
  }

  // ── 指の受け付け ──────────────────────────────────────

  _bind(el, owner) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // 担当は触れた瞬間に決めて、離すまで変えない
      const at = this._pt(e);
      const p = { owner, x: at.x, y: at.y, el };
      this.pointers.set(e.pointerId, p);
      // 捕まえておくと、指がボタンから滑り出ても続きが届く。
      // **失敗しても先へ進む**(捕まえられなくても、その場での操作は成り立つ)
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 捕まえられなくても続ける */ }
      if (owner === 'dpad') this._stickDown(p);
      else if (owner === 'shot') this._shotDown(p, e);
      else this._press(this.opts.pauseCode);
    });

    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      const at = this._pt(e);
      const dist = Math.hypot(at.x - p.x, at.y - p.y);
      p.x = at.x;
      p.y = at.y;
      if (p.owner === 'dpad') this._stickMove(p);
      else if (p.owner === 'shot') this._shotMove(p, dist);
    });

    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (p.owner === 'dpad') this._stickUp();
      else if (p.owner === 'shot') this._shotUp();
      else this._release(this.opts.pauseCode);
    };
    // 着信やジェスチャで指が消えることがあるので cancel も拾う
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  // ── 相対十字 ──────────────────────────────────────────

  _stickDown(p) {
    const s = this.stick;
    s.active = true;
    s.ox = p.x; s.oy = p.y;
    s.x = p.x; s.y = p.y;
    s.dx = 0; s.dy = 0; s.dist = 0; s.deg = 0; s.sector = -1;
    this._showRing();
  }

  _stickMove(p) {
    const s = this.stick;
    s.x = p.x; s.y = p.y;
    let dx = s.x - s.ox;
    let dy = s.y - s.oy;
    let dist = Math.hypot(dx, dy);

    // 大きく離れたら、その距離を保つように原点を引きずる
    const max = this.opts.dragMax;
    if (dist > max && dist > 0) {
      const k = (dist - max) / dist;
      s.ox += dx * k;
      s.oy += dy * k;
      dx = s.x - s.ox;
      dy = s.y - s.oy;
      dist = max;
    }
    s.dx = dx; s.dy = dy; s.dist = dist;
    s.deg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;

    if (dist < this.opts.deadzone) s.sector = -1;
    else s.sector = this._sectorOf(s.deg, s.sector);

    this._applyDirs(s.sector < 0 ? [] : SECTOR_KEYS[s.sector]);
    this._showRing();
  }

  _stickUp() {
    this.stick.active = false;
    this.stick.sector = -1;
    this._applyDirs([]);
    this._hideRing();
  }

  _hideRing() {
    if (this._stickEl) this._stickEl.style.display = 'none';
    if (this._knob) this._knob.style.display = 'none';
  }

  /** 区画を決める。**境目を少し重ねて**ばたつきを止める */
  _sectorOf(deg, current) {
    const next = Math.round(deg / 45) % 8;
    if (current < 0 || next === current) return next;
    // いまの区画の真ん中からどれだけ離れたか(0〜180 度)
    const d = Math.abs(((deg - current * 45 + 540) % 360) - 180);
    return d > 22.5 + this.opts.hysteresis ? next : current;
  }

  /** 向きを入れ替える。増えたぶんを押し、減ったぶんを離す */
  _applyDirs(keys) {
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      if (keys.includes(code)) this._press(code);
      else this._release(code);
    }
  }

  /** 十字の絵を原点へ、つまみを指の場所へ */
  _showRing() {
    if (!this._stickEl || !this._dpad) return;
    const r = this._rectOf(this._dpad);
    const s = this.stick;
    // **'' ではなく 'block'。** '' にすると CSS の display:none へ戻ってしまう
    this._stickEl.style.display = 'block';
    this._knob.style.display = 'block';
    this._stickEl.style.left = (s.ox - r.left) + 'px';
    this._stickEl.style.top = (s.oy - r.top) + 'px';
    this._knob.style.left = (s.x - r.left) + 'px';
    this._knob.style.top = (s.y - r.top) + 'px';
  }

  // ── こすり打ち ────────────────────────────────────────

  _shotDown(p, e) {
    this.rub.move = 0;
    p.acc = 0;
    p.vx = 0; p.vy = 0; p.stroke = 0;
    p.px = p.x; p.py = p.y;
    p.cell = this._cellOf(p);
    this.rub.cell = p.cell;
    this.rub.turns = 0;
    // どの方式でも、触れた瞬間に 1 発は出る
    if (this.opts.shotMode === 'C') this._press(this.opts.shotCode);
    else this._pulse(this.opts.shotCode);
    this._startHold();
  }

  _shotMove(p, dist) {
    const o = this.opts;
    p.acc = (p.acc || 0) + dist;
    this.rub.move += dist;
    const inside = this._inFire(p);

    if (o.shotMode === 'C') {
      // 領域はひとつ。入ったら押す、出たら離す
      if (inside) this._press(o.shotCode);
      else this._release(o.shotCode);
      return;
    }
    if (!inside) { this.rub.cell = ''; return; }

    if (o.shotMode === 'A') {
      // 区画割り。別の区画へ入るたびに 1 発
      const cell = this._cellOf(p);
      if (cell !== p.cell) {
        p.cell = cell;
        this.rub.cell = cell;
        this._pulse(o.shotCode);
      }
      return;
    }
    if (o.shotMode === 'B') {
      // B: 動いた量で数える。
      // **長く滑らせるほど得**になってしまうので、実機では使いものにならなかった。
      // 比べるために残してある
      const step = Math.max(1, o.shotStep);
      while (p.acc >= step) {
        p.acc -= step;
        this._pulse(o.shotCode);
      }
      return;
    }
    // D: 往復で数える。**向きが反転したときに 1 発**。
    // 爪を往復させる回数がそのまま連射数になり、一気の一振りは何 px でも 1 発。
    // ぐるぐる回すのは向きが連続して変わるだけなので、ほとんど出ない
    this._rubTurn(p, o);
  }

  /** 向きが反転したかを見て、していたら 1 発 */
  _rubTurn(p, o) {
    const dx = p.x - (p.px ?? p.x);
    const dy = p.y - (p.py ?? p.y);
    p.px = p.x; p.py = p.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;               // 止まっているうちは何もしない
    const ux = dx / len, uy = dy / len;

    if (p.vx === 0 && p.vy === 0) {      // 一振り目。向きが決まる
      p.vx = ux; p.vy = uy; p.stroke = len;
      return;
    }
    const dot = ux * p.vx + uy * p.vy;
    if (dot >= 0) {                      // 同じ向きへ進んでいる
      p.stroke += len;
      // 向きはゆっくり付いていく(曲がりながらこすっても切れないように)
      p.vx = p.vx * 0.8 + ux * 0.2;
      p.vy = p.vy * 0.8 + uy * 0.2;
      const n = Math.hypot(p.vx, p.vy) || 1;
      p.vx /= n; p.vy /= n;
      return;
    }
    // 反転した。**戻る前に十分こすっていたときだけ**数える(震えを拾わない)
    if (p.stroke >= Math.max(1, o.shotStep)) {
      this.rub.turns++;
      this._pulse(o.shotCode);
    }
    p.vx = ux; p.vy = uy;
    p.stroke = len;
  }

  _shotUp() {
    this._release(this.opts.shotCode);
    this._stopHold();
    this.rub.cell = '';
  }

  /** ショットボタンの中に指があるか(滑り出ても担当は変えない) */
  _inFire(p) {
    if (!this._fire) return false;
    const r = this._rectOf(this._fire);
    return p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom;
  }

  /** 区画割り(A)の、いまの区画の名前 */
  _cellOf(p) {
    if (!this._fire) return '';
    const r = this._rectOf(this._fire);
    const step = Math.max(1, this.opts.shotStep);
    return Math.floor((p.x - r.left) / step) + ',' + Math.floor((p.y - r.top) / step);
  }

  /**
   * 長押しの見張り。**既定は動かない**(holdRepeatMs が 0)。
   * 動かしたときは、こすらずに置いたままでも間隔ごとに 1 発出る
   */
  _startHold() {
    this._stopHold();
    if (!(this.opts.holdRepeatMs > 0)) return;
    this._holdTimer = setInterval(() => {
      const gap = this.opts.holdRepeatMs;
      if (!(gap > 0)) return;
      if (performance.now() - this._lastShotAt < gap) return;
      this._release(this.opts.shotCode);   // C で押しっぱなしのときのため
      this._pulse(this.opts.shotCode);
    }, 16);
  }

  _stopHold() {
    if (this._holdTimer) clearInterval(this._holdTimer);
    this._holdTimer = 0;
  }
}

// ── DOM と CSS ──────────────────────────────────────────

function buildDom() {
  const el = document.createElement('div');
  el.className = 'mmsxx-touch';
  el.innerHTML = `
    <div class="mmsxx-touch-zone mmsxx-touch-dpad">
      <div class="mmsxx-touch-stick">
        <div class="mmsxx-touch-ring"></div>
        <div class="mmsxx-touch-arrow" data-code="ArrowUp"></div>
        <div class="mmsxx-touch-arrow" data-code="ArrowDown"></div>
        <div class="mmsxx-touch-arrow" data-code="ArrowLeft"></div>
        <div class="mmsxx-touch-arrow" data-code="ArrowRight"></div>
      </div>
      <div class="mmsxx-touch-knob"></div>
    </div>
    <div class="mmsxx-touch-zone mmsxx-touch-shot">
      <div class="mmsxx-touch-fire"></div>
      <div class="mmsxx-touch-pause">PAUSE</div>
    </div>`;
  return el;
}

let styled = false;

/** CSS は 1 度だけ入れる。ドット絵風に、角は丸めない */
function injectStyle() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'mmsxx-touch-style';
  s.textContent = `
.mmsxx-touch {
  position: fixed; inset: 0; pointer-events: none; z-index: 20;
  touch-action: none; user-select: none; -webkit-touch-callout: none;
}
.mmsxx-touch-zone {
  position: absolute; top: 0; bottom: 0; pointer-events: auto;
  touch-action: none; overflow: hidden;
  image-rendering: pixelated;
}
.mmsxx-touch[data-side="left"]  .mmsxx-touch-dpad { left: 0; }
.mmsxx-touch[data-side="left"]  .mmsxx-touch-shot { right: 0; }
.mmsxx-touch[data-side="right"] .mmsxx-touch-dpad { right: 0; }
.mmsxx-touch[data-side="right"] .mmsxx-touch-shot { left: 0; }

/* 十字。**触れたところが原点**で、絵ごとそこへ移る。
   四角 4 つを、原点から一定の距離(--r)に置く */
.mmsxx-touch-stick {
  position: absolute; display: none; width: 0; height: 0;
}
.mmsxx-touch-ring {
  position: absolute;
  left: calc(var(--r) * -1); top: calc(var(--r) * -1);
  width: calc(var(--r) * 2); height: calc(var(--r) * 2);
  border: 2px solid #4488cc; background: rgba(32, 64, 112, 0.35);
}
.mmsxx-touch-knob {
  position: absolute; width: 20px; height: 20px; margin: -10px 0 0 -10px;
  background: #66ccff; display: none;
}

/* 押している向きの目印 */
.mmsxx-touch-arrow {
  position: absolute; background: #224466;
  width: 24px; height: 24px; margin: -12px 0 0 -12px;
}
.mmsxx-touch-arrow.on { background: #ffcc22; }
.mmsxx-touch-arrow[data-code="ArrowUp"]    { left: 0; top: calc(var(--r) * -1); }
.mmsxx-touch-arrow[data-code="ArrowDown"]  { left: 0; top: var(--r); }
.mmsxx-touch-arrow[data-code="ArrowLeft"]  { top: 0; left: calc(var(--r) * -1); }
.mmsxx-touch-arrow[data-code="ArrowRight"] { top: 0; left: var(--r); }

/* ショット。面の横溝で「こする場所」だと見せる */
.mmsxx-touch-fire {
  position: absolute; left: 6px; right: 6px; top: 6px; bottom: 64px;
  background: #aa2222;
  background-image: repeating-linear-gradient(
    to bottom, #cc3333 0 6px, #881111 6px 12px);
  border: 2px solid #ee6666;
}
.mmsxx-touch-fire.on {
  background-image: repeating-linear-gradient(
    to bottom, #ff8888 0 6px, #cc3333 6px 12px);
}
.mmsxx-touch-pause {
  position: absolute; left: 6px; right: 6px; bottom: 6px; height: 44px;
  background: #333344; border: 2px solid #8888aa; color: #ccccdd;
  font: 12px monospace; letter-spacing: 1px;
  display: flex; align-items: center; justify-content: center;
}
.mmsxx-touch-pause.on { background: #8888aa; color: #111122; }
`;
  document.head.appendChild(s);
}
