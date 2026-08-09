// **ジェスチャの見分け**。指の動きを「タップ」「スワイプ」「フリック」などの
// 名前に変えて、呼び出し側へ知らせるだけの部品。
//
//   import { createGesture } from './engine/util/gesture.js';
//
//   const g = createGesture({
//     el: document.getElementById('stage'),
//     onGesture: (e) => { if (e.type === 'flick' && e.dir === 'left') nextPage(); },
//   });
//   g.detach();
//
// ## 出てくるのは実機のイベントそのまま
//
// **偽のジェスチャは作らない。** pointer のイベントを見て名前を付けるだけなので、
// 実機では指の動きが、PC ではマウスの動きが、そのまま同じ形で出てくる。
// マウスは指 1 本ぶんなので、ピンチや 3 本指は PC では出ない。
//
// **PC で困らない。** 一覧の送りやページのめくりは、もともと矢印キーが受け持って
// いる(`Input` のほう)。ジェスチャは指のときだけの足しと考えればよい。
// どちらから来たかは `source`('touch' / 'mouse' / 'pen')で分かる。
//
// ## スワイプとフリックは別のもの
//
//   スワイプ … 動いているあいだ**続けて**出る。指に付いてくるもの(一覧の送り)
//   フリック … 離した瞬間に**1 回だけ**出る。速く払ったとき(ページのめくり)
//
// 1 回の操作で両方出ることがある(送りながら最後に払う)。使う側が選ぶ。

/** 出てくるもの。**増やすときはここに足す** */
export const GESTURES = ['down', 'up', 'tap', 'longpress', 'swipe', 'flick', 'pinch'];

const DEFAULTS = {
  /** これ以内で離せばタップ(ms) */
  tapMaxMs: 250,
  /** タップと認める動きの幅(px)。これを超えたらタップにしない */
  tapMaxDist: 10,
  /** 押しっぱなしをこれだけ続けたら longpress(ms)。0 で出さない */
  longPressMs: 500,
  /** これだけ動いたらスワイプが出はじめる(px) */
  swipeMinDist: 12,
  /** 離すときのこの速さ以上でフリック(px/ms) */
  flickMinSpeed: 0.5,
  /** 最後のこれだけの間の動きで速さを測る(ms) */
  flickWindowMs: 120,
  /** 指の間の距離がこの割合ずれたらピンチ */
  pinchMinScale: 0.05,
};

/**
 * @param {{
 *   el: HTMLElement,
 *   onGesture: (g: object) => void,
 *   tapMaxMs?: number, tapMaxDist?: number, longPressMs?: number,
 *   swipeMinDist?: number, flickMinSpeed?: number, flickWindowMs?: number,
 *   pinchMinScale?: number,
 * }} opt
 */
export function createGesture(opt) {
  const g = {
    el: opt.el,
    onGesture: opt.onGesture || null,
    opts: { ...DEFAULTS, ...opt },
    /** @type {Map<number, object>} いま触れている指 */
    points: new Map(),
    detach: () => off(),
    setOptions: (patch) => Object.assign(g.opts, patch),
  };

  /** ひとまとまりの操作。指が 1 本でも増えたら作り、全部離れたら畳む */
  let run = null;
  let holdTimer = 0;

  const now = () => performance.now();
  const emit = (type, extra) => {
    if (!g.onGesture) return;
    g.onGesture({
      type,
      fingers: run ? run.fingers : 0,
      source: run ? run.source : 'touch',
      t: now(),
      ...extra,
    });
  };

  /** 8 方向ではなく 4 方向。メニューの操作はこれで足りる */
  const dirOf = (dx, dy) =>
    (Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));

  /** いま触れている指の重心 */
  function center() {
    let x = 0, y = 0;
    for (const p of g.points.values()) { x += p.x; y += p.y; }
    const n = g.points.size || 1;
    return { x: x / n, y: y / n };
  }

  /** いちばん離れている 2 本の距離(指が 2 本以上のときだけ) */
  function spread() {
    const list = [...g.points.values()];
    if (list.length < 2) return 0;
    let max = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        max = Math.max(max, Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y));
      }
    }
    return max;
  }

  function startRun(source) {
    const c = center();
    run = {
      source,
      fingers: g.points.size,
      x0: c.x, y0: c.y, x: c.x, y: c.y,
      t0: now(),
      moved: 0,
      swiping: false,
      pinching: false,
      spread0: 0,
      /** 速さを測るための、直近の位置 */
      trail: [{ x: c.x, y: c.y, t: now() }],
    };
    run.spread0 = spread();
    emit('down', { x: c.x, y: c.y });
    if (g.opts.longPressMs > 0) {
      holdTimer = setTimeout(() => {
        holdTimer = 0;
        if (run && run.moved < g.opts.tapMaxDist) emit('longpress', { x: run.x, y: run.y });
      }, g.opts.longPressMs);
    }
  }

  function moveRun() {
    if (!run) return;
    const c = center();
    const dx = c.x - run.x, dy = c.y - run.y;
    run.x = c.x; run.y = c.y;
    run.moved = Math.hypot(c.x - run.x0, c.y - run.y0);
    run.fingers = Math.max(run.fingers, g.points.size);

    const t = now();
    run.trail.push({ x: c.x, y: c.y, t });
    while (run.trail.length > 1 && t - run.trail[0].t > g.opts.flickWindowMs) run.trail.shift();

    // ピンチ。**指 2 本以上のときだけ**
    const sp = spread();
    if (run.spread0 > 0 && sp > 0) {
      const scale = sp / run.spread0;
      if (Math.abs(scale - 1) >= g.opts.pinchMinScale) {
        run.pinching = true;
        emit('pinch', { scale, spread: sp, x: c.x, y: c.y });
      }
    }

    // スワイプ。**動いているあいだ続けて出る**。
    // **ピンチが始まったら出さない。** 指を広げるときは重心がぶれるので、
    // 動かしていないのにスワイプが出てしまう。
    // 指 2 本をそろえて動かしたぶん(広がらない)は、今までどおりスワイプになる
    if (run.pinching) return;
    if (!run.swiping && run.moved >= g.opts.swipeMinDist) run.swiping = true;
    if (run.swiping && (dx || dy)) {
      emit('swipe', {
        x: c.x, y: c.y, dx, dy,
        totalX: c.x - run.x0, totalY: c.y - run.y0,
        dir: dirOf(c.x - run.x0, c.y - run.y0),
      });
    }
  }

  function endRun() {
    if (!run) return;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    const t = now();
    const dx = run.x - run.x0, dy = run.y - run.y0;
    const ms = t - run.t0;

    // 直近の動きから速さを出す。**払ったかどうかは最後だけで決める**
    const a = run.trail[0], b = run.trail[run.trail.length - 1];
    const span = Math.max(1, b.t - a.t);
    const speed = Math.hypot(b.x - a.x, b.y - a.y) / span;

    // ピンチのあとはタップにしない。**指を広げるあいだ重心は動かない**ので、
    // 手早く広げると「短く触れて離した」と見分けが付かなくなる
    if (!run.pinching && ms <= g.opts.tapMaxMs && run.moved < g.opts.tapMaxDist) {
      emit('tap', { x: run.x, y: run.y, ms });
    } else if (!run.pinching && speed >= g.opts.flickMinSpeed
               && run.moved >= g.opts.swipeMinDist) {
      emit('flick', {
        x: run.x, y: run.y, dx, dy, ms, speed,
        dir: dirOf(b.x - a.x, b.y - a.y),
      });
    }
    emit('up', { x: run.x, y: run.y, dx, dy, ms, speed });
    run = null;
  }

  // ── 指 ────────────────────────────────────────────────

  const onDown = (e) => {
    e.preventDefault();
    try { g.el.setPointerCapture(e.pointerId); } catch (err) { /* 捕まえられなくても続ける */ }
    g.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!run) { startRun(e.pointerType || 'touch'); return; }
    run.fingers = Math.max(run.fingers, g.points.size);
    // **指が増えたら基準を取り直す。** 重心も指の間隔も、指を足した瞬間に飛ぶ。
    // 取り直さないと、置いただけで「横へ払った」「広げた」ことになってしまう
    const c = center();
    run.x0 = c.x; run.y0 = c.y;
    run.x = c.x; run.y = c.y;
    run.moved = 0;
    run.swiping = false;
    run.pinching = false;
    run.spread0 = spread();
    run.trail = [{ x: c.x, y: c.y, t: now() }];
  };

  const onMove = (e) => {
    const p = g.points.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    p.x = e.clientX; p.y = e.clientY;
    moveRun();
  };

  const onUp = (e) => {
    if (!g.points.has(e.pointerId)) return;
    g.points.delete(e.pointerId);
    if (g.points.size === 0) endRun();
  };

  function on() {
    g.el.addEventListener('pointerdown', onDown);
    g.el.addEventListener('pointermove', onMove);
    g.el.addEventListener('pointerup', onUp);
    g.el.addEventListener('pointercancel', onUp);
    g.el.addEventListener('lostpointercapture', onUp);
    g.el.addEventListener('contextmenu', prevent);
  }
  function off() {
    g.el.removeEventListener('pointerdown', onDown);
    g.el.removeEventListener('pointermove', onMove);
    g.el.removeEventListener('pointerup', onUp);
    g.el.removeEventListener('pointercancel', onUp);
    g.el.removeEventListener('lostpointercapture', onUp);
    g.el.removeEventListener('contextmenu', prevent);
    g.points.clear();
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    run = null;
  }
  const prevent = (e) => e.preventDefault();

  on();
  return g;
}
