// ゲームパッド。**押した / 離した を呼び出し側へ通知するだけ**の部品。
//
// エンジンの Input は知らない。渡された press / release を呼ぶだけなので、
// ゲームは「キーのコードへ変換して Input へ流す」、確かめる器(gamepadlab)は
// 「画面へ書き出す」と、同じ部品を別の使いかたができる。
//
//   const pad = createGamepad({
//     press:   (code) => mmsxx.input.press(code, 'pad'),   // 第 2 引数を忘れない
//     release: (code) => mmsxx.input.release(code),
//   });
//   pad.poll();   // 毎コマ呼ぶ
//
// ## Gamepad API の癖
//
// - **イベントでは来ない**。こちらから毎コマ聞きに行く
// - **ボタンを 1 回押すまでパッドは見えない**(挿しただけでは出てこない)
// - https か localhost でないと動かない
// - **並びが決まっているのは mapping === 'standard' のときだけ。**
//   それ以外(古い DirectInput のパッドなど)は製品ごとに番号がばらばらで、
//   十字が 1 本の軸に詰め込まれていることもある。**見なかったことにする**

/** standard の並び。十字は 12〜15(上右下左)、A は 0、Start は 9 */
export const STANDARD_MAP = {
  0: 'Space',       // A … ショット・決定
  1: 'Escape',      // B … 戻る・ポーズ
  2: 'Enter',       // X … 名前入力の確定
  9: 'Escape',      // Start … ポーズ
  12: 'ArrowUp',
  13: 'ArrowDown',
  14: 'ArrowLeft',
  15: 'ArrowRight',
};

/** 十字のボタン番号(軸だけを見るときはここを飛ばす) */
const DPAD_BUTTONS = [12, 13, 14, 15];

/** 連射を掛けるコード。ショットだけ */
const RAPID_CODE = 'Space';

/**
 * @param {object} opt
 * @param {(code: string) => void} opt.press 押されたときに呼ばれる
 * @param {(code: string) => void} opt.release 離されたときに呼ばれる
 * @param {number} [opt.deadzone] スティックの遊び(既定 0.5)。機種で癖が違うので外から変えられる
 * @param {(x:number, y:number) => void} [opt.onStick] **倒し量をそのまま知らせる先**。
 *   4 方向のキーとは別の口で、遊びの最中の移動に使う(倒し量が消えない)
 * @param {'both'|'dpad'|'axes'} [opt.mode] 十字と軸のどちらを見るか(既定 both = どちらでも動く)
 * @param {number} [opt.rapid] 連射の間隔コマ数。0 で連射なし(既定 0)
 * @param {Record<number, string>} [opt.map] ボタン番号 → キーのコード
 */
export function createGamepad(opt) {
  const gp = {
    press: opt.press,
    release: opt.release,
    deadzone: opt.deadzone === undefined ? 0.5 : opt.deadzone,
    onStick: opt.onStick || null,
    mode: opt.mode || 'both',
    rapid: opt.rapid || 0,
    map: opt.map || STANDARD_MAP,
    /** 使うパッドの番号。null なら**最後にボタンを押されたもの**を自動で選ぶ */
    index: null,
    /** 自動で選んだ結果。いま読んでいるパッドの番号(まだ無ければ -1) */
    active: -1,
    /** 何コマ目か。器が遅れを測るのに使う */
    frame: 0,
    /** @type {Set<string>} いま押していることにしているコード */
    down: new Set(),
    /** @type {Map<string, number>} 連射用に、生で押しはじめてからのコマ数 */
    _rawHeld: new Map(),
    /** 直前に読んだ生の様子(器が出す。poll のたびに入れ替わる) */
    snapshot: null,
    /**
     * 生のボタンが押された瞬間に呼ばれる(番号を渡す)。
     * **割り当てを通す前**なので、割り当ての無いボタンでも呼ばれる。
     * 「パッドを認識しました」と知らせるのに使う
     * @type {((index: number) => void) | null}
     */
    onRawPress: null,
    /** @type {Set<number>} 直前に押されていた生のボタン(onRawPress 用) */
    _rawBtn: new Set(),
  };

  /**
   * つながっているパッドの一覧。**押すまで出てこない**ので、
   * 空でも「無い」とは限らない
   */
  gp.list = () => {
    if (!navigator.getGamepads) return [];
    return Array.from(navigator.getGamepads()).filter(p => p);
  };

  /**
   * 使えるパッドだけ。**standard の並びでないものは相手にしない**。
   * 番号が製品ごとに違うので、当てずっぽうで読むと
   * 押していないボタンでポーズが掛かるような目に遭う
   */
  gp.usable = () => gp.list().filter(p => p.mapping === 'standard');

  /**
   * 相手にしなかったパッド。**「このパッドには対応していません」と言うため**にある。
   * 一覧に出てくる時点で 1 回は押されているので、
   * 「繋いだのに何も起きない」を黙って放置しないで済む
   */
  gp.unsupported = () => gp.list().filter(p => p.mapping !== 'standard');

  /** 押していることにしているものを全部離す(見失ったとき・画面を離れたとき) */
  gp.releaseAll = () => {
    for (const code of gp.down) gp.release(code);
    gp.down.clear();
    gp._rawHeld.clear();
  };

  /** そのパッドでどれか押されているか */
  const anyPressed = (p) => p.buttons.some(b => b && b.pressed);

  /** 使うパッドを決める。既定は**最後にボタンを押されたもの**(持ち替えが素直) */
  const pick = (pads) => {
    if (gp.index !== null) return pads.find(p => p.index === gp.index) || null;
    for (const p of pads) if (anyPressed(p)) gp.active = p.index;
    return pads.find(p => p.index === gp.active) || null;
  };

  /**
   * いま押されているコードを集める。
   * 十字と軸は**どちらでも動く**(mode で片方だけにもできる)
   */
  const collect = (p) => {
    const set = new Set();
    const useDpad = gp.mode !== 'axes';
    const useAxes = gp.mode !== 'dpad';
    for (let i = 0; i < p.buttons.length; i++) {
      const code = gp.map[i];
      if (!code) continue;
      if (!useDpad && DPAD_BUTTONS.includes(i)) continue;
      if (p.buttons[i] && p.buttons[i].pressed) set.add(code);
    }
    if (useAxes) {
      const dz = gp.deadzone;
      const x = p.axes[0] || 0;
      const y = p.axes[1] || 0;
      if (x <= -dz) set.add('ArrowLeft');
      else if (x >= dz) set.add('ArrowRight');
      if (y <= -dz) set.add('ArrowUp');
      else if (y >= dz) set.add('ArrowDown');
      // **倒し量もそのまま知らせる**(8 方向のキーとは別の口)。
      // 上の 4 つは 4 方向に潰しているので、**そこでは倒し量が消える**。
      // 遊びの最中の移動はこちらを読めば、そっと動かすこともできる。
      // 遊びの無いところ(deadzone の内側)は 0 に倒しておく
      if (gp.onStick) {
        const len = Math.hypot(x, y);
        if (len <= dz) gp.onStick(0, 0);
        else {
          // 遊びのぶんを引いて、残りを 0〜1 に伸ばし直す
          const t = Math.min(1, (len - dz) / (1 - dz));
          gp.onStick((x / len) * t, (y / len) * t);
        }
      }
    }
    return set;
  };

  /**
   * 連射。押しっぱなしのショットを、`rapid` コマごとに押し直したことにする。
   * **ゲーム側は既定で使わない**(こすり打ちのゲームなので)。手触りを見るための口
   */
  const applyRapid = (raw) => {
    if (!gp.rapid) return raw;
    const held = gp._rawHeld.get(RAPID_CODE);
    if (held === undefined) return raw;
    // 押しはじめから rapid コマずつ 入 / 切 を繰り返す
    if (Math.floor(held / gp.rapid) % 2 === 1) {
      const out = new Set(raw);
      out.delete(RAPID_CODE);
      return out;
    }
    return raw;
  };

  /** 割り当ての表を入れ替える。**押していたものは先に離す**(取り残さない) */
  gp.setMap = (map) => {
    gp.releaseAll();
    gp.map = map;
  };

  /** 生のボタンが押された瞬間を知らせる(割り当てを聞くときに使う) */
  const tellRaw = (p) => {
    for (let i = 0; i < p.buttons.length; i++) {
      const on = !!(p.buttons[i] && p.buttons[i].pressed);
      if (on && !gp._rawBtn.has(i)) { gp._rawBtn.add(i); if (gp.onRawPress) gp.onRawPress(i); }
      else if (!on) gp._rawBtn.delete(i);
    }
  };

  /** 毎コマ呼ぶ。変わったぶんだけ press / release を呼ぶ */
  gp.poll = () => {
    gp.frame++;
    const pads = gp.usable();
    const p = pick(pads);
    if (!p || !p.connected) {
      // 見失ったら**押していたものを全部離す**。
      // 残ったままだと自機が動き続ける
      if (gp.down.size) gp.releaseAll();
      gp._rawBtn.clear();
      gp.snapshot = null;
      return;
    }
    tellRaw(p);
    const raw = collect(p);
    // 連射の判定に使うので、生の押しっぱなしコマ数を先に進める
    for (const code of raw) {
      const n = gp._rawHeld.get(code);
      gp._rawHeld.set(code, n === undefined ? 0 : n + 1);
    }
    for (const code of gp._rawHeld.keys()) if (!raw.has(code)) gp._rawHeld.delete(code);

    const now = applyRapid(raw);
    // 押した … いま入っていて、前は入っていなかったもの
    for (const code of now) if (!gp.down.has(code)) gp.press(code);
    // 離した … 前は入っていて、いま入っていないもの
    for (const code of gp.down) if (!now.has(code)) gp.release(code);
    gp.down = now;
    gp.snapshot = p;
  };

  // 画面を離れたら全部離す。エンジンの Input も blur で全部離すので、
  // ここで持っている「押している」を捨てておかないと、戻ったとき押し直せない
  if (typeof window !== 'undefined') {
    window.addEventListener('blur', () => { gp.releaseAll(); gp._rawBtn.clear(); });
  }
  return gp;
}
