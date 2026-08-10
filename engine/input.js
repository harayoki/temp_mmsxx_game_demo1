// キーボード入力。KeyboardEvent.code (例: 'ArrowLeft', 'Space', 'KeyZ') で参照する。
//
// 読みかたは 3 つ。**画面側はこのどれかを選ぶだけ**でよい。
//
//   isDown(code)      押しているあいだずっと true (自機の移動)
//   wasPressed(code)  押した瞬間の 1 コマだけ true (決定・ページ送り)
//   repeat(code)      押した瞬間に 1 回、そのあと少し待って連続 (一覧の行送り)
//
// repeat は「押している長さ」から歩数を出すので、**呼ぶ側が数を覚えなくてよい**。
// 同じキーを別々の場所から聞いても干渉しない。
// タッチのフリックを「N コマ押しっぱなし」として流し込めば、
// 画面側は何も変えずに勢いのぶんスクロールする(docs/SMARTPHONE.md)。
//
// ## 何で操作したかを控える
//
// press() は「どれで押されたか」を第 2 引数で受け取り、使われた種類を覚えておく。
// ランキングへ「そのプレイで何を使ったか」を送るために要る。
// 途中で持ち替える人がいるので、**最後の 1 つではなく使ったもの全部**を残す。
export class Input {
  /** @param {() => void} [onFirstInput] 最初のキー入力時に呼ばれる(オーディオ解禁用) */
  constructor(onFirstInput) {
    /** @type {Set<string>} 押下中 */
    this.down = new Set();
    /** @type {Set<string>} このフレームで押された */
    this.pressed = new Set();
    /** @type {Map<string, number>} 押しているコマ数。押した瞬間が 0 */
    this.held = new Map();
    /** @type {Set<string>} 何で操作されたか('key' / 'touch' / 'pad') */
    this.usedSources = new Set();
    // 倒した向きと強さ(下の setStick / stick を見ること)
    this._stickFrom = '';
    this._stickPower = 0;
    this._stickX = 0;
    this._stickY = 0;
    this.onFirstInput = onFirstInput;

    window.addEventListener('keydown', (e) => {
      if (this.onFirstInput) { this.onFirstInput(); }
      this.press(e.code, 'key');
      // ゲーム用キーのスクロールなどを抑止
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.release(e.code));
    window.addEventListener('blur', () => this.clear());
  }

  /**
   * 押されたことにする。**キーボードもタッチもここを通す**。
   * 押しっぱなしで何度も呼ばれても、押した瞬間は 1 回だけにする
   * (OS のキーリピートで pressed が立ち続けないように)
   * @param {string} code
   * @param {'key'|'touch'|'pad'} [source] 何で押されたか(既定はキーボード)
   */
  press(code, source = 'key') {
    // 種類は**押しっぱなしの判定より先に**控える。
    // 同じキーをキーボードで押したままタッチでも押したときに取りこぼさない
    this.usedSources.add(source);
    if (this.down.has(code)) return;
    this.pressed.add(code);
    this.down.add(code);
    this.held.set(code, 0);
  }

  /** 離されたことにする */
  release(code) {
    this.down.delete(code);
    this.held.delete(code);
  }

  /** 全部離す(画面が非アクティブになったときなど) */
  clear() {
    this.down.clear();
    this.held.clear();
    this._stickFrom = '';
    this._stickPower = 0;
  }

  /**
   * 何で操作されたかを `key+touch+pad` の形で返す。まだ何も無ければ空文字。
   * **並びは key → touch → pad で固定**。受け取る側が並べ直さないので、
   * 同じ組み合わせがいつも同じ文字列になるようにする
   */
  usedInputs() {
    return ['key', 'touch', 'pad'].filter(s => this.usedSources.has(s)).join('+');
  }

  /** 控えを捨てる。**1 プレイごとに数え直す**ときに呼ぶ(clear() では消さない) */
  forgetUsedInputs() { this.usedSources.clear(); }

  // ── 倒した向きと強さ ──────────────────────────────────
  //
  // **矢印キーとは別の口。** 遊びの最中の「どちらへ、どれだけ」を、
  // どの機器からも**同じ形**で受け取るためのもの。
  //
  //   キーボード    … 押している矢印から 8 方向。強さは 1(倒し量が無いので)
  //   タッチの十字  … 指の動く向きと速さ
  //   ゲームパッド  … 軸の角度と倒し量
  //
  // **矢印キーは今までどおり出続ける。** メニュー・名前入力・ページ送りは
  // あちらで動いているので、こちらは**足すだけ**で置き換えではない。
  // 使うのは遊びの最中だけ、というのがいまの決め(docs/SMARTPHONE.md)。
  //
  // **吸着(4 / 8 / 16 方向へ丸める)はここではやらない。** 機器は生の角度を
  // 置いていき、**いくつに丸めるかは読む側が決める**。遊びによって
  // ちょうどよい粗さが違うし、同じ遊びでも場面で変えたくなる

  /**
   * **機器が、いま倒している向きと強さを置いていく。**
   * 毎コマ呼ぶこと(呼ばれなくなったら倒していない扱いになる)。
   * @param {string} source 'touch' / 'pad' など
   * @param {number} x 右が +。-1〜1
   * @param {number} y 下が +。-1〜1
   */
  setStick(source, x, y) {
    const s = Math.min(1, Math.hypot(x, y));
    // **倒すのをやめたら 0 を置きにくること。** こちらでは減らさない
    // (機器ごとに「いつ 0 になるか」が違う。指は止まったとき、パッドは離したとき)
    if (s <= 0) {
      if (this._stickFrom === source) { this._stickFrom = ''; this._stickPower = 0; }
      return;
    }
    // **強く倒しているほうが勝つ。** 指とパッドを同時に触ることは無いが、
    // 片方が 0 を置き続けているだけ、ということはある
    if (this._stickFrom && this._stickFrom !== source && s <= this._stickPower) return;
    this._stickFrom = source;
    this._stickPower = s;
    this._stickX = x;
    this._stickY = y;
  }

  /**
   * **いま倒している向きと強さ**。遊びの最中の移動はこれを読む。
   *
   *   const st = input.stick(8);
   *   if (st.strength) {
   *     player.x += Math.cos(st.rad) * spd * st.strength;
   *     player.y += Math.sin(st.rad) * spd * st.strength;
   *   }
   *
   * **倒し量のあるほうが勝つ。** 矢印キーを見るのは、どの機器も倒していない
   * ときだけ。**タッチもパッドも、倒しながら矢印キーも出している**ので
   * (メニューがそちらで動いているため)、キーを先に見ると
   * **自分が出した矢印で自分の倒し量が消える**。実際そうなった
   *
   * @param {number} [snap] 何方向へ丸めるか(4 / 8 / 16)。0 で丸めない
   * @returns {{ angle:number, rad:number, strength:number, sector:number, source:string }}
   *   angle は度(0 = 右、時計回り)。倒していなければ strength は 0
   */
  stick(snap = 0) {
    let x = 0, y = 0, source = '';
    if (this._stickFrom) {
      x = this._stickX; y = this._stickY; source = this._stickFrom;
    } else {
      if (this.down.has('ArrowLeft')) x -= 1;
      if (this.down.has('ArrowRight')) x += 1;
      if (this.down.has('ArrowUp')) y -= 1;
      if (this.down.has('ArrowDown')) y += 1;
      // **キーは倒し量を持たない。** 斜めでも長さ 1 にそろえる
      if (x || y) {
        const n = Math.hypot(x, y);
        x /= n; y /= n;
        source = 'key';
      }
    }
    const strength = Math.min(1, Math.hypot(x, y));
    if (!strength) return { angle: 0, rad: 0, strength: 0, sector: -1, source: '' };
    let angle = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    let sector = -1;
    if (snap > 0) {
      const step = 360 / snap;
      sector = Math.round(angle / step) % snap;
      angle = sector * step;
    }
    return { angle, rad: angle * Math.PI / 180, strength, sector, source };
  }

  /** キーが押されているか */
  isDown(code) { return this.down.has(code); }

  /** このフレームで押されたか(押しっぱなしでは false) */
  wasPressed(code) { return this.pressed.has(code); }

  /** 押しているコマ数。押した瞬間が 0、押していなければ -1 */
  heldFrames(code) {
    const n = this.held.get(code);
    return n === undefined ? -1 : n;
  }

  /**
   * 一覧の行送り用。**押した瞬間に 1 回**、そのあと `delay` 待ってから
   * `gap` コマおきに true を返す。
   *
   * 初動を待たせるのは、**1 行だけ動かせるようにする**ため。
   * 待ちが無いと、ちょっと押しただけで数行飛んでしまう。
   * @param {string} code
   * @param {number} [delay] 連続しはじめるまでのコマ数(既定 20 = 約 0.33 秒)
   * @param {number} [gap] 連続中の間隔(既定 4 = 毎秒 15 歩)
   */
  repeat(code, delay = 20, gap = 4) {
    const n = this.held.get(code);
    if (n === undefined) return false;
    if (n === 0) return true;              // 押した瞬間の 1 歩(取りこぼさない)
    if (n < delay) return false;           // 初動の待ち
    return (n - delay) % gap === 0;
  }

  /** フレーム終わりにエンジンが呼ぶ */
  endFrame() {
    this.pressed.clear();
    for (const [code, n] of this.held) this.held.set(code, n + 1);
  }
}
