// **スマホの GUI の器**。画面の左右の空きに何を置くかを決め、
// 部品(TouchControls / createGesture)を繋ぐところ。
//
//   import { TouchGui } from './engine/util/touchgui.js';
//
//   const gui = new TouchGui({
//     canvas: document.getElementById('screen'),
//     isRotated: () => mmsxx.vdp.rotated,
//     onPress:   (code, source) => mmsxx.input.press(code, source),
//     onRelease: (code) => mmsxx.input.release(code),
//   });
//   gui.attach();
//
// ## モードは 2 つ
//
//   ゲームモード … 左に相対十字、右にこすり打ちのショット。ジェスチャは受けない
//   メニューモード … **十字もショットも出さない**。画面ぜんぶでジェスチャを受け、
//                    左右の空きには**いま何ができるか**を書く
//
// ポーズ中もメニューモード。遊びの最中と選ぶ最中では指の使いかたが違うので、
// 出すものを丸ごと入れ替える。
//
//   gui.setMode('game');   // 遊んでいるあいだ
//   gui.setMode('menu');   // タイトル・ポーズ・一覧
//
// ## 案内はゲーム側が指示する
//
// **いま上下左右が何に使えるかを知っているのはゲーム側**なので、ここでは書かない。
// 渡されたものを並べるだけ:
//
//   gui.setGuide({
//     left:  [{ icon: 'leftright', en: 'SWIPE TO SWITCH PAGE', ja: 'スワイプでページ' }],
//     right: [{ icon: 'tap',       en: 'TAP TO START',         ja: 'タップで開始' }],
//     ok: true, esc: false,
//   });
//
// **ここだけ日本語と英語を出し分ける**(canvas の中は英語のまま)。DOM なのでよい。
// `ok` / `esc` はボタンを効かせるかどうか。**効かない場面でも置き場所は動かさない**
// (指が場所を覚えるところなので、消すと覚えたものが使えなくなる)。
//
// ## ジェスチャの読み替え
//
// 見分けそのものは engine/util/gesture.js。ここでやるのは**キーへの割り当て**だけ。
// 割り当ては全画面で同じ(docs/TODO.md の 上下=スクロール / 左右=ページ):
//
//   横フリック … 左右キーを 1 回。**ページのめくり**(1 回で 1 歩)
//   縦スワイプ … 上下キーを、動いた量ぶん繰り返す。**一覧の送り**(指に付いてくる)
//   タップ     … SPACE を 1 回。OK ボタンと同じ
//
// **画面を 90 度回して見せているとき**は、指の動きも同じだけ回してから読む
// (見えている向きと操作の向きがずれないように)。
//
// ## 置き場所
//
// canvas の置き場所と大きさを決めているのは engine/video.js なので、
// **こちらはその外側に合わせる**。canvas の見た目の幅を測って、
// 余ったぶんを左右で半分ずつ使う。回っているときは器ごと回す
// (canvas だけが回っていると、画面の左が遊びの下になってしまう)。

import { TouchControls } from './touch.js';
import { createGesture } from './gesture.js';

/** 押されたと知らせるときの種別。TouchControls と同じ */
const SOURCE = 'touch';

/**
 * **左右の空きをどう割るかを決めるだけの関数。** DOM も端末も見ない。
 *
 * ゲームごとに置きかたは違っても、**決めかたは同じ**なので切り出してある。
 * 他のゲームからはこれだけ呼んで、返ってきた数字で好きに置けばよい。
 * 数字を入れれば同じ答えが返るので、そのまま試験にも掛けられる。
 *
 * 決めているのは 3 つ。
 *
 *   1. 左右の帯をどこに、どれだけの幅で置くか
 *   2. **ゲーム画面に重ねるかどうか**(空きが足りないとき)
 *   3. **操作の案内を出すかどうか**(隙間があるときだけ)
 *
 * ゲーム画面は**器の真ん中**にある前提。食われるぶんが左右で違っても
 * 画面そのものは動かないので、空きは左右べつべつに出す。
 *
 * @param {{
 *   view: { w: number, h: number },  器の大きさ(回したあとの向きで)
 *   canvasW: number,                 ゲーム画面の見た目の幅
 *   safe?: { left?: number, right?: number },  端末に食われるぶん(器の向きで)
 *   minSide?: number,   これを割ったら重ねる
 *   guideMin?: number,  案内を出すのに要る空き
 * }} m
 * @returns {{
 *   left: { x: number, w: number }, right: { x: number, w: number },
 *   overlap: boolean, guide: boolean, gap: number,
 * }}
 *   gap は**本当に空いている幅**(重ねる前の、狭いほう)
 */
export function planSideLayout(m) {
  const w = m.view.w;
  const sl = (m.safe && m.safe.left) || 0;
  const sr = (m.safe && m.safe.right) || 0;
  // ゲーム画面は器の真ん中。食われるぶんを引いた残りが、実際に空いている幅
  const cLeft = (w - m.canvasW) / 2;
  const freeL = Math.max(0, Math.floor(cLeft - sl));
  const freeR = Math.max(0, Math.floor(w - sr - (cLeft + m.canvasW)));
  const gap = Math.min(freeL, freeR);

  // **空きが足りないときは重ねる。** 画面を縮めて空きを作る手もあるが、
  // それだと弾も自機も一緒に小さくなって見えなくなる
  const min = Math.max(0, m.minSide || 0);
  const overlap = freeL < min || freeR < min;
  const wl = overlap ? Math.max(freeL, min) : freeL;
  const wr = overlap ? Math.max(freeR, min) : freeR;

  return {
    left: { x: sl, w: wl },
    right: { x: w - sr - wr, w: wr },
    overlap,
    // **入るなら出す。重ねているかどうかは見ない。**
    // 見るのは「実際に文字を置く帯の幅」。重ねているときも帯は minSide まで
    // 広げてあるので、そこに入るなら読める。
    // **本当の空き(gap)で判断すると、縮めても案内が出ない段差ができる**
    // (パッドの取り分に届くまで重ね扱いのままなので)
    guide: Math.min(wl, wr) >= (m.guideMin || 0),
    gap,
  };
}

// ── 画面の向き ──────────────────────────────────────────
//
// **回すところが 4 つある**(canvas / 器 / 点 / 指の動き)ので、
// 向きの計算はここへまとめる。ばらばらに書くと、
// **見えている場所と触った場所がずれる**のに気づきにくい。
//
//   角度 = engine/video.js の viewAngle(0 / 90 / 180 / 270)
//   器の左上を原点に、器を angle だけ回すと画面にぴたりと重なる
//
// 下の 4 つは**同じ 1 つの変換**を、置き場所・大きさ・点・動きの
// それぞれの言葉で言い直したもの。**直すときは 4 つまとめて**見ること。

/** 角度を 0 / 90 / 180 / 270 のどれかへ丸める */
export function normAngle(a) {
  return ((Math.round((a || 0) / 90) * 90) % 360 + 360) % 360;
}

/**
 * 器の大きさと、画面に重ねるための CSS。
 * `transform-origin: 0 0` で使うこと(回してから、原点を画面の隅へ運ぶ)
 * @param {number} angle 0 / 90 / 180 / 270
 * @param {number} vw 画面(置ける場所)の幅
 * @param {number} vh 同じく高さ
 * @returns {{ w:number, h:number, css:string }} w/h は**回す前**の器の大きさ
 */
export function viewTransform(angle, vw, vh) {
  switch (normAngle(angle)) {
    case 90: return { w: vh, h: vw, css: `translateX(${vw}px) rotate(90deg)` };
    case 180: return { w: vw, h: vh, css: `translate(${vw}px, ${vh}px) rotate(180deg)` };
    case 270: return { w: vh, h: vw, css: `translateY(${vh}px) rotate(270deg)` };
    default: return { w: vw, h: vh, css: 'none' };
  }
}

/**
 * **画面の点を器の点へ戻す**(viewTransform の逆)。
 * 渡す x / y は、画面(置ける場所)の左上から数えた値
 * @returns {number[]} [x, y]
 */
export function viewToLocal(angle, vw, vh, x, y) {
  switch (normAngle(angle)) {
    case 90: return [y, vw - x];
    case 180: return [vw - x, vh - y];
    case 270: return [vh - y, x];
    default: return [x, y];
  }
}

/**
 * **画面の動きを器の動きへ戻す。** 点とは違って、原点を運ぶぶんは要らない
 * (向きだけ戻す)
 */
export function turnDelta(angle, dx, dy) {
  switch (normAngle(angle)) {
    case 90: return { dx: dy, dy: -dx };
    case 180: return { dx: -dx, dy: -dy };
    case 270: return { dx: -dy, dy: dx };
    default: return { dx, dy };
  }
}

/**
 * **端末に食われるぶんを器の向きへ移す。** env() は画面の向きで返ってくるので、
 * 回して見せているときは上下左右も一緒に回さないと、
 * くびれていない側を空けることになる
 * @param {{left:number,right:number,top:number,bottom:number}} ins 画面の向きで
 * @returns {{left:number,right:number,top:number,bottom:number}} 器の向きで
 */
export function turnInsets(angle, ins) {
  switch (normAngle(angle)) {
    case 90: return { left: ins.top, right: ins.bottom, top: ins.right, bottom: ins.left };
    case 180: return { left: ins.right, right: ins.left, top: ins.bottom, bottom: ins.top };
    case 270: return { left: ins.bottom, right: ins.top, top: ins.left, bottom: ins.right };
    default: return { ...ins };
  }
}

const DEFAULTS = {
  /** 一覧の送り。指がこれだけ動くたびに上下キーを 1 回(px) */
  scrollStep: 26,
  /**
   * **これだけ横へ動いたらページをめくる**(px)。指を離すのは待たない。
   * 短めにしてある。**めくり違えても戻せる**ので、
   * 渋って動かないより早とちりのほうがよい
   */
  flickMinDist: 28,
  /** 縦か横かを決めるまでに要る移動(px)。これ未満では何もしない */
  axisMinDist: 12,
  /** 決めるときの勝ち幅。**1.4 倍以上ないと決めない**(斜めで迷わせない) */
  axisBias: 1.4,
  /**
   * **画面の左右の端で、指を受けない帯の厚み**(px)。
   * Android のジェスチャーナビは、左右どちらの端から内へ払っても「戻る」になる。
   * **web ページからは切れない**(ネイティブの setSystemGestureExclusionRects は使えない)し、
   * env() にも出てこないので、こちらで避けるしかない。
   * 十字は「触れたところが原点」なので、端に置けなくなるだけで操作性はほとんど落ちない。
   * **機種は見ない。** iPhone に入れても害が無く、見分けを間違える危険のほうが大きい
   */
  edgeGuard: 20,
  /**
   * **左右の空きが これだけ取れないときは、ゲーム画面に重ねる**(px)。
   * 縦長の今どきの機種なら左右がよく開くが、**開かない機種もある**。
   * そのときは画面を削るより、**半透明で重ねる**ほうがまし
   * (画面を小さくすると、弾も自機も一緒に小さくなって見えなくなる)。
   * 十字の差し渡し(guiRadius の 2 倍)に、指ぶんの余りを足した値
   */
  minSide: 128,
  /**
   * **十字と連射の絵を、ゲーム画面へどれだけかぶせるか**(画面の幅に対する割合)。
   *
   * 帯の幅ぶんしか使わないと、空きの狭い機種では絵が小さくなりすぎる。
   * GUI は半透明なので、少しかぶせても下の弾と自機は透けて見える。
   * **かぶせるのはこの 2 つだけ。** 案内の文字や借りものボタンは帯の中のままで、
   * あちらを画面へ出すと読むものと遊ぶものが重なって、どちらも読めなくなる。
   *
   * 0 で今までどおり(帯の中に収める)
   */
  padBleed: 0.25,
  /**
   * **連射の丸のまわりに足す、受け場所の余白**(px)。
   *
   * 受けるのは丸のまわりの四角だけで、**残りは全部 十字**。
   * 十字は指がずれていくので広さが要るが、連射は同じところを
   * こすり続けるので要らない。少しだけ余白を持たせて、
   * 狙いが甘くても押せるようにする
   */
  shotHitPad: 16,
  /**
   * **連射の受け場所をゲーム画面に掛けない。**
   *
   * 丸の絵は帯からゲーム画面へ少しはみ出して置いてある(padBleed)ので、
   * 受け場所もそのぶん画面へ掛かる。十字で遊ぶあいだは害が無い
   * (画面の上を触っても、もともと何も起きない)。
   *
   * **画面を叩いて動かす遊びかた(パッドレス)では困る。**
   * 掛かっているところを叩くと、行き先が置けずに連射だけが効く —
   * 押したのに動かない場所が画面の中にできてしまう。
   * 立てると、受け場所を画面の外側へ切り詰める(絵は動かさない)
   */
  shotHitOffCanvas: false,
  /**
   * **連射の丸を、帯の真ん中からどれだけ外側へ寄せるか**
   * (かぶせたぶん padBleed に対する割合。0 で真ん中のまま)。
   *
   * 帯はゲーム画面へかぶせて広げてあるので、真ん中に置くと丸がそのぶん
   * 画面に掛かる。**0.5 で、かぶせていないほうの真ん中に来る** —
   * 絵の大きさはそのままで画面から降り、帯にも収まる
   * (受け場所を切り詰めずに済む)。
   *
   * **1 では寄せすぎる。** かぶせたぶんを丸ごと戻すと、こんどは
   * 帯の外側へはみ出して端で切れる(実測で器から 6.5px 出た)
   */
  shotShift: 0.5,
  /**
   * **案内を出すのに要る空き**(px)。これを割ったら文字は出さない。
   * 隙間が無いところへ無理に出すと、ゲーム画面に文字が重なって
   * どちらも読めなくなる。**操作の案内は出せるときだけでよい**
   */
  guideMin: 96,
  /**
   * **薄さ。** GUI は道具であってゲームの絵ではないので、はじめから前へ出ない。
   *   alpha        … 遊びはじめの濃さ
   *   alphaOverlap … ゲーム画面に重ねているときの、遊びはじめの濃さ
   *   alphaMin     … 慣れたあとの濃さ(ここまでしか薄くしない)
   *   fadeUses     … 何回さわったら alphaMin まで行くか
   * **ポーズを抜けるたびに数え直す**ので、久しぶりに遊ぶ人には濃く出る
   */
  alpha: 0.72,
  alphaOverlap: 0.45,
  alphaMin: 0.2,
  fadeUses: 30,
  /**
   * **字の 1 マスのドット数。** 8x8 のドット絵フォントなら 8。
   * これに画面の倍率を掛けた大きさで出すので、canvas の中の字と揃う。
   * 8x12 の書体に差し替えるなら 12 にする
   */
  fontUnit: 8,
  /**
   * **押せるようになったボタンが光る長さ**(ms)。CSS の keyframes と合わせること。
   * 場所を動かさない決めなので、**変わったことに気づく手がかりが色しか無い**
   */
  wakeMs: 1000,
  /** 長押しと認めるまで(ms)。短いと、ふつうに押しただけで説明が出る */
  tipHoldMs: 450,
  /**
   * **説明の札を、押しているものからどれだけ離すか**(px)。
   * 重ねて出すと、長押ししている指がその札を隠してしまう。
   * 指 1 本ぶん逃がす
   */
  tipGap: 14,
  /** これだけ触られなかったら、また光らせる(ms) */
  idleMs: 4000,
  /** 案内に出す文字の言語。'ja' か 'en' */
  lang: 'en',
  okCode: 'Space',
  escCode: 'Escape',
};

/**
 * 案内のアイコン。**動かさない**(動く絵は指の邪魔になる)。
 *
 * **塗りつぶしのシルエット**にしてある。上に文字を重ねるので、
 * 線画だと文字と線が絡んで両方読めなくなる。面で敷いておけば、
 * 文字はその上に浮いて見える。**縦に積まないぶん場所が要らない**
 */
const ICONS = {
  // 左右の両矢印。ページのめくり
  //
  // **胴は細く。** 文字を同じマスへ重ねて出すので、胴が太いと
  // 文字と一体の四角に見えて、**矢印だと分からなくなる**(実機でそうなった)。
  // 細くすれば、文字の上下から頭だけがはみ出して矢印だと読める
  leftright: '<path d="M1 24 15 9v10h18V9l14 15-14 15v-10H15v10z"/>',
  // 上下の両矢印。一覧の送り(こちらも同じ理由で胴を細くしてある)
  updown: '<path d="M24 1 39 15h-10v18h10L24 47 9 33h10V15H9z"/>',
  // 触る場所。真ん中の丸と、その外の輪
  tap: '<circle cx="24" cy="24" r="10"/>'
    + '<path d="M24 2a22 22 0 1 0 0 44 22 22 0 1 0 0-44zm0 7a15 15 0 1 1 0 30 15 15 0 1 1 0-30z"/>',
};

export class TouchGui {
  /**
   * @param {{
   *   canvas: HTMLCanvasElement,
   *   isRotated?: () => boolean,
   *   viewAngle?: () => number,   見た目の向き(0/90/180/270)。**あればこちらが勝つ**
   *   onPress?:   (code:string, source:string) => void,
   *   onRelease?: (code:string, source:string) => void,
   *   scrollStep?: number, flickMinDist?: number,
   *   frame?: () => ({ w:number, h:number }),   置ける場所の決め打ち(既定は窓いっぱい)
   *   lang?: string, okCode?: string, escCode?: string,
   *   touch?: object,   TouchControls へそのまま渡すつまみ
   * }} opts
   */
  constructor(opts = {}) {
    this.canvas = opts.canvas || null;
    this.isRotated = opts.isRotated || (() => false);
    // **向きは角度で受け取るのが本筋**だが、90 度しか無かったころの
    // isRotated だけでも動くようにしておく(他のゲームが呼んでいる)
    this.viewAngle = opts.viewAngle || (() => (this.isRotated() ? 90 : 0));
    this.onPress = opts.onPress || null;
    this.onRelease = opts.onRelease || null;
    /**
     * **倒している向きと強さの知らせ先**(x, y。どちらも -1〜1)。
     * 8 方向のキーとは別の口で、遊びの最中の移動に使う。
     * 倒すのをやめたら (0, 0) が来る
     */
    this.onStick = opts.onStick || null;
    this.opts = { ...DEFAULTS, ...opts };

    /** 'game' か 'menu'。取り付けた直後は menu(タイトルから始まるため) */
    this.mode = 'menu';
    /** DOM へ反映済みのモード。取り付ける前は null */
    this._modeShown = null;
    /** いま出している案内。同じものが来たら組み直さない */
    this._guide = { left: [], right: [], ok: false, esc: false };
    this._guideKey = '';

    /** 十字とショット。**入れ物はこちらが用意して貸す** */
    this.touch = new TouchControls({
      onPress: (code, source) => this._press(code, source),
      onRelease: (code, source) => this._release(code, source),
      // **倒している向きと強さは素通し**(8 方向のキーとは別の口)。
      // 読むかどうかはゲームが決める
      onStick: (x, y) => { if (this.onStick) this.onStick(x, y); },
      // **遊んでいる最中のこのボタンは「PAUSE」**(touch.js の既定のまま)。
      // メニューでは同じ場所に ESC のボタンが来て、そちらは場面ごとに
      // BACK / CANCEL / RESUME と書き換わる。**どちらもすることを書く**。
      // エリアの名前(D-PAD / SHOT)は出さない。絵を見れば何かは分かるし、
      // 上の隅は借りているボタンの置き場所でもある
      // **誘い文句(DRAG ME / SCRUB ME)は出さない。** 絵のすぐ下に置かれるので、
      // そのまた下の「DRAG TO MOVE」「RUB TO FIRE」と重なって両方読めなくなる。
      // 動かしかたは絵が見せているので、文字は 1 つで足りる
      labels: { dpadTitle: '', shotTitle: '', dpadCallout: '', shotCallout: '' },
      ...(opts.touch || {}),
    });
    this.gesture = null;

    this._root = null;
    this._el = {};
    this._pulsing = new Set();
    /** 縦スワイプの溜め(px)。しきい値を超えたぶんだけキーへ変える */
    this._scrollAcc = 0;
    /** 1 回の操作でページを送るのは 1 回だけ */
    this._flicked = false;
    /** 遊びはじめてから何回さわったか(薄さを決める。ポーズで数え直す) */
    this._use = 0;
    this._relayoutWait = 0;
  }

  // ── 取り付け ──────────────────────────────────────────

  /** 画面へ置く。**canvas の外側**に重ねるので、写真にも録画にも写らない */
  attach(host = document.body) {
    if (this._root) return this;
    injectStyle();
    const root = document.createElement('div');
    root.className = 'mmsxx-gui';
    root.innerHTML = ROOT_HTML;
    host.appendChild(root);
    this._root = root;
    const q = (sel) => root.querySelector(sel);
    this._el = {
      left: q('.mmsxx-gui-left'), right: q('.mmsxx-gui-right'),
      catchL: q('.mmsxx-gui-catch-left'), catchR: q('.mmsxx-gui-catch-right'),
      guideL: q('.mmsxx-gui-guide-left'), guideR: q('.mmsxx-gui-guide-right'),
      btns: q('.mmsxx-gui-btns'), tools: q('.mmsxx-gui-tools'),
      tools2: q('.mmsxx-gui-tools-right'),
      ok: q('.mmsxx-gui-ok'), esc: q('.mmsxx-gui-esc'), opt: q('.mmsxx-gui-opt'),
      safe: q('.mmsxx-gui-safe'), safearea: q('.mmsxx-gui-safearea'),
      tip: q('.mmsxx-gui-tip'),
    };
    this.touch.attach({
      dpad: this._el.left, shot: this._el.right,
      dpadCatch: this._el.catchL, shotCatch: this._el.catchR,
    });
    // **触りはじめたら薄くしていく。** 場所を覚えるまでは見えていてほしいが、
    // 覚えたあとは弾を隠すだけの邪魔もの。触れている＝分かっている合図。
    // **キーが立ったかではなく、指が触れたかで数える**
    // (十字は触れただけでは向きが立たないので、キーで数えると取りこぼす)
    for (const z of [this._el.left, this._el.right, this._el.catchL, this._el.catchR]) {
      z.addEventListener('pointerdown', () => {
        this._touchedAt = performance.now();
        this._root.classList.remove('attention');
        if (this.mode === 'game') this._useUp();
      });
    }
    // 引っ込めたあとに戻せるよう、素の文言を控えておく
    this._padLabels = { ...this.touch.labels };
    this._padLabelsOn = true;

    // ボタンは**押した瞬間**に効かせる(click を待つと 1 拍おくれる)。
    // ここで止めておけば、下のジェスチャには届かない
    // OK と ESC も、案内に `run` があればそちらを呼ぶ(無ければ既定のキー)。
    // 「押したら聞き返す」ような、キーに割り当てられない用事のため
    this._bindButton(this._el.ok, () => (this._guide.ok || {}).run || this.opts.okCode);
    this._bindButton(this._el.esc, () => (this._guide.esc || {}).run || this.opts.escCode);
    // **OPTION は場面ごとに割り当てが変わる**ので、送るキーも案内から取る
    this._bindButton(this._el.opt, () => {
      const o = this._guide.opt || {};
      return o.run || o.code;
    });
    // 借りているボタン(音の入切など)を押したぶんは、ジェスチャに数えない。
    // **preventDefault はしない**(click が飛ばなくなる)。止めるのは伝わるほうだけ
    for (const el of [this._el.tools, this._el.tools2]) {
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    this._bindTips();
    // 上を見ること。**指を離したら、どこで離されようと必ず引っ込める。**
    // 札は押した相手のものだが、離したことを知らせてくるのは器のほうなので、
    // 窓で受けるのがいちばん確か
    this._endTip = () => {
      if (this._tipTimer) { clearTimeout(this._tipTimer); this._tipTimer = 0; }
      setTimeout(() => this._hideTip(), 900);
    };
    for (const type of ['pointerup', 'pointercancel']) {
      window.addEventListener(type, this._endTip);
    }

    // ジェスチャは setMode() が出し入れする(下の _startGesture を見ること)

    this._relayout = () => {
      if (this._relayoutWait) return;
      this._relayoutWait = requestAnimationFrame(() => {
        this._relayoutWait = 0;
        this.layout();
      });
    };
    window.addEventListener('resize', this._relayout);
    window.addEventListener('orientationchange', this._relayout);
    // URL バーが出入りしたぶんも取り直す(resize が飛んでこないことがある)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this._relayout);
      window.visualViewport.addEventListener('scroll', this._relayout);
    }
    // html と body の**両方**に付ける。片方だけだと iOS のバウンスが残る
    // **まだ一度も触られていないときだけ光らせる。**
    // 薄くしてあるぶん、背景によっては本当に見えないことがある。
    // 触った瞬間に止め、**そのあとは二度と光らない**
    this._touchedAt = 0;
    this._blinkTimer = setInterval(() => {
      if (!this._root) return;
      // **光るのは最初に触られるまで。** 一度触ったらもう光らせない。
      // 遊んでいる最中に光り直すと、そのたび目を引いて弾から目が離れる
      const never = this._touchedAt === 0;
      this._root.classList.toggle('attention', never && this.mode === 'game');
    }, 500);
    document.documentElement.classList.add('mmsxx-gui-on');
    document.body.classList.add('mmsxx-gui-on');

    this.setMode(this.mode);
    this.layout();
    return this;
  }

  /** 外す。押しっぱなしは全部離してから */
  detach() {
    if (!this._root) return;
    this.releaseAll();
    this._stopGesture();
    if (this._blinkTimer) clearInterval(this._blinkTimer);
    this._blinkTimer = 0;
    this._hideTip();
    if (this._endTip) {
      for (const type of ['pointerup', 'pointercancel']) {
        window.removeEventListener(type, this._endTip);
      }
    }
    this.touch.detach();
    window.removeEventListener('resize', this._relayout);
    window.removeEventListener('orientationchange', this._relayout);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._relayout);
      window.visualViewport.removeEventListener('scroll', this._relayout);
    }
    document.documentElement.classList.remove('mmsxx-gui-on');
    document.body.classList.remove('mmsxx-gui-on');
    this._root.remove();
    this._root = null;
    this._el = {};
  }

  /**
   * **器そのもの。** 画面ぜんぶを覆っていて、**見た目の角度で回っている**。
   *
   * 画面いっぱいに重ねたいもの(遊びかたの板など)は、window ではなく
   * **ここへ入れること**。fixed で窓へ直に置くと、90 度回して見せている
   * 機種で**そこだけ回らずに横倒しで出る**(実機でそうなった)。
   * 中へ入れれば、回転も画角の枠も一緒に付いてくる
   */
  get el() { return this._root || null; }

  /**
   * ゲーム側のボタン(音の入切など)を右の空きへ置く場所。
   * **借りたものはこちらで消さない**ので、そのまま入れてよい
   */
  get toolsSlot() { return this._el.tools || null; }

  /**
   * **右の空きの置き場所**。十字を隠したくないものはこちらへ。
   * ESC / OPTION の下に来る(ボタンとは別の層なので、押しても十字へ届かない)
   */
  get toolsSlotRight() { return this._el.tools2 || null; }

  /**
   * **十字とショットに添える文言を書き替える**(`RUB TO FIRE` / `DRAG TO MOVE` など)。
   *
   *   gui.setPadLabels({ shotNote: 'RUB OR HOLD', dpadNote: 'DRAG TO MOVE' });
   *
   * 渡したぶんだけ差し替わる(全部書かなくてよい)。使える名前は
   * engine/util/touch.js の LABELS:
   *
   *   dpadTitle / dpadNote / dpadCallout / shotTitle / shotNote / shotCallout
   *
   * **touch.setLabels() を直に呼ばないこと。** こちらは狭い機種で文言を
   * 引っ込めている(_showPadLabels)ので、直に書くと引っ込めたはずのものが
   * 復活したり、広くなったときに前の文言へ戻ったりする。
   * ここへ渡せば、引っ込めているあいだは覚えておいて、戻すときに反映される
   */
  setPadLabels(patch) {
    if (!patch) return this;
    if (!this._padLabels) {
      // 取り付ける前。**下の TouchControls へ直に入れておく**
      // (attach がそれを控えるので、あとから引っ込めても戻ってくる)
      this.touch.setLabels(patch);
      return this;
    }
    Object.assign(this._padLabels, patch);
    // 引っ込めているあいだは覚えるだけ。戻すのは _showPadLabels(true)
    if (this._padLabelsOn) this.touch.setLabels(patch);
    return this;
  }

  /**
   * **どの指がどこで受けられるかを色で見せる**(確かめるときだけ)。
   *
   * 十字とショットは絵の外まで受けているので、**見た目からは境目が分からない**。
   * 「ここは効くはずなのに効かない」を追うときは、まずこれを出すこと
   */
  showAreas(on) {
    if (this._root) this._root.classList.toggle('areas', !!on);
    return this;
  }

  /**
   * **撃ちっぱなしを言い直す**(touch.js の idleFire)。**毎コマ呼ぶこと**。
   * 受け取る側が入力を捨てても(画面が非アクティブ・知らせを閉じた)、次のコマで戻る
   */
  keepFire() { this.touch.keepFire(); return this; }

  /**
   * **こすりかたを指で見せる**(touch.js の rubDemo)。
   * 速く撃てるほど効く場面に来たところで呼ぶ
   */
  rubDemo(sec) { this.touch.rubDemo(sec); return this; }

  /** 案内の言語を変える */
  setLang(lang) {
    this.opts.lang = lang;
    this._guideKey = '';        // 書き直させる
    this._applyGuide();
  }

  // ── モード ────────────────────────────────────────────

  /**
   * 出すものを丸ごと入れ替える。
   * **切り替えたときは押しっぱなしを全部離す**(十字を押したままメニューへ
   * 抜けると、その向きが残る)
   * @param {'game'|'menu'} mode
   */
  setMode(mode) {
    const next = mode === 'game' ? 'game' : 'menu';
    // **取り付けたときは、同じモードでも一度は反映させる**
    // (取り付ける前の setMode() は覚えるだけで、DOM がまだ無い)
    if (next === this.mode && this._modeShown === next) return;
    this.mode = next;
    this.releaseAll();
    if (!this._root) return;
    // 出しているものが丸ごと入れ替わるので、説明の札も残さない
    this._hideTip();
    this._modeShown = next;
    // **ポーズやタイトルを通るたびに、濃さを最初へ戻す。**
    // 手を止めた人には、もう一度はっきり見えたほうがよい
    if (next === 'menu') this._use = 0;
    this._applyAlpha();
    const game = next === 'game';
    this.touch.visible = game;
    // **出してから測り直させる。** 隠れているあいだ入れ物の幅は 0 なので、
    // そのとき測った大きさは既定値へ落ちている(小さくならない原因だった)。
    // 連射の受け場所も丸を測って決めているので、ここで取り直す
    if (game) { this.touch.setOptions({}); this._fitShotHit(); }
    this._root.classList.toggle('menu', !game);
    // ゲーム中は器を素通しにして、十字とショットの入れ物だけが指を受ける。
    // メニューでは器ぜんぶで受ける(canvas の上を払っても効く)
    this._root.style.pointerEvents = game ? 'none' : 'auto';
    // **見分けそのものを出し入れする。** 付けっぱなしにしてはいけない:
    // 十字やショットで触れた pointerdown は器まで上がってくるので、
    // そこで setPointerCapture を奪われ、以後の pointermove が
    // 入れ物へ届かなくなる。**こすり打ちが 1 発ずつのボタンに化ける**。
    // pointer-events: none はその要素の当たり判定を消すだけで、
    // 上がってきたイベントの受け取りは止めない
    if (game) this._stopGesture();
    else this._startGesture();
  }

  /** ジェスチャの見分けを付ける(メニューのときだけ) */
  _startGesture() {
    if (this.gesture || !this._root) return;
    this.gesture = createGesture({
      el: this._root,
      onGesture: (e) => this._onGesture(e),
    });
  }

  /** 外す。**指を捕まえたままにしない** */
  _stopGesture() {
    if (!this.gesture) return;
    this.gesture.detach();
    this.gesture = null;
    this._scrollAcc = 0;
    this._flicked = false;
  }

  /**
   * いま何ができるかを書き替える。**同じものなら組み直さない**
   * (毎コマ呼んでよい)
   * @param {{ left?: object[], right?: object[], ok?: boolean, esc?: boolean }} guide
   */
  setGuide(guide) {
    this._guide = {
      // **左は枠の数を決め打ちにする**(GUIDE_SLOTS)。
      // 場面ごとに数が変わると、出たり入ったりするうえ、
      // 残ったほうの位置まで動いて落ち着かない。
      // 足りないぶんは null で埋め、「出ているが使えない」枠として出す
      left: padSlots((guide && guide.left) || [], GUIDE_SLOTS),
      right: (guide && guide.right) || [],
      ok: (guide && guide.ok) || null,
      esc: (guide && guide.esc) || null,
      // **OPTION はその場かぎりの 3 つめ**。文言と一緒に、送るキーも受け取る
      // (名前入力では BACK = Backspace、ポーズでは RESET、など)
      opt: (guide && guide.opt) || null,
      // 縦に 1 歩送るのに要る指の移動(px)。**数個から選ぶ場面では大きく**
      step: (guide && guide.step) || 0,
      // **OK だけ大きくしたい場面がある**(タイトルで選んだものの名前を出すなど)。
      // 場所は動かさないまま、字と上下の余白だけ育てる
      okBig: !!(guide && guide.okBig),
      // **横払いの向き。** 既定はページをめくる向き
      // (左へ払うと次のページが左から来る = ArrowRight)。
      // カーソルを横に動かす場面では逆になる — 右へ払ったのに
      // カーソルが左へ行くので、実機で「左右が逆」と言われた。
      // 名前入力のように**指の先にあるものが動く**場面では true にする
      xFollow: !!(guide && guide.xFollow),
    };
    this._applyGuide();
  }

  _applyGuide() {
    if (!this._root) return;
    const g = this._guide;
    const key = JSON.stringify([this.opts.lang, g]);
    if (key === this._guideKey) return;
    this._guideKey = key;
    // **できることが変わったら、出ている説明は前の場面のもの。**
    // 説明を出したまま画面が移ることは実際にある(長押ししたまま
    // 払う、押している最中に自分でない理由で画面が変わる、など)
    this._hideTip();
    this._el.guideL.innerHTML = g.left.map((it, i) => guideItemHTML(it, this.opts.lang, i)).join('');
    this._el.guideR.innerHTML = g.right.map((it, i) => guideItemHTML(it, this.opts.lang, i)).join('');
    // **中の文言は場面ごとに変わる**(START / つぎへ / もどる ...)。
    // 変わるのは文字だけで、**場所と大きさは動かさない**。
    // 使えない場面では沈めるが、消しはしない(指が覚えた位置を残す)
    // **何もしない場面では文字も出さない。** 沈めた「ESC」が読めてしまうと、
    // 押せば何か起きるのかと考えさせる。**箱だけ残して中身を空に**すれば、
    // 場所は動かないまま「いまは使えない」が伝わる
    for (const [key, el] of [['ok', this._el.ok], ['esc', this._el.esc], ['opt', this._el.opt]]) {
      const v = g[key];
      // **押せるようになった瞬間だけ、ひととき光らせる。**
      // 場所は動かさない決めなので、**変わったことに気づく手がかりが色しか無い**。
      // 沈んでいた箱に字が入っても、目を向けていなければ見落とす
      const woke = !!v && el.classList.contains('off');
      el.classList.toggle('off', !v);
      el.textContent = pickText(v, this.opts.lang);
      if (woke) this._wake(el);
    }
    this._el.ok.classList.toggle('big', g.okBig);
  }

  /**
   * **押せるようになったことを 1 秒だけ光って知らせる。**
   * 光り終わったら印を外す(付けっぱなしにすると、次に光らない)
   */
  _wake(el) {
    el.classList.remove('wake');
    void el.offsetWidth;   // ここで巻き戻さないと、続けて変わったときに光り直さない
    el.classList.add('wake');
    // **終わりは時間で見る。** animationend を待つと、画面が背面にいるあいだは
    // アニメが止まっていて飛んでこず、**印が付いたまま**になる
    if (el._wakeTimer) clearTimeout(el._wakeTimer);
    el._wakeTimer = setTimeout(() => {
      el._wakeTimer = 0;
      el.classList.remove('wake');
    }, this.opts.wakeMs);
  }

  // ── 置き場所 ──────────────────────────────────────────

  /**
   * つまみを変える。**変えたぶんは測り直す**(置き場所に関わるものが多い)。
   * 中の TouchControls のつまみは `gui.touch.setOptions()` へ
   */
  setOptions(patch) {
    Object.assign(this.opts, patch || {});
    this.layout();
  }

  /**
   * canvas の外側に合わせる。**回っているときは器ごと回す**。
   * canvas を回しているのは engine/video.js で、こちらはそれに従うだけ
   */
  layout() {
    if (!this._root || !this.canvas) return;
    // **canvas と同じ角度で回す。** ここがずれると、見えている場所と
    // 触った場所が食い違う(上の「画面の向き」の節を見ること)
    const angle = normAngle(this.viewAngle());
    // 決め打ちの画角があれば、その大きさで窓の真ん中に置く
    // (canvas 側も同じ大きさに収まっている。engine/video.js の fitSize)
    const box = this.opts.frame ? this.opts.frame() : null;
    const vw = box ? box.w : window.innerWidth;
    const vh = box ? box.h : window.innerHeight;
    const ox = box ? Math.round((window.innerWidth - vw) / 2) : 0;
    const oy = box ? Math.round((window.innerHeight - vh) / 2) : 0;
    // 回すと、器の縦と横が入れ替わる(90 / 270 のとき)
    const view = viewTransform(angle, vw, vh);
    const w = view.w, h = view.h;
    const st = this._root.style;
    st.left = ox + 'px';
    st.top = oy + 'px';
    st.width = w + 'px';
    st.height = h + 'px';
    st.transform = view.css;
    // 画面の点を器の点へ戻す(上の変換の逆)。十字はこれを使って当たりを取る。
    // **回っていなければ変換は要らない**(どちらも画面の座標のまま)
    this.touch.toLocal = angle
      ? (x, y) => viewToLocal(angle, vw, vh, x - ox, y - oy)
      : null;

    // **端末に食われるぶん**(ノッチ・ホームバー・URL バー)を器の向きへ移す。
    // env() は画面の向きで返ってくるので、90 度回して見せているときは
    // 上下左右も一緒に回さないと、くびれていない側を空けることになる
    const ins = this._safeInsets();
    // **左右の端の帯は env() に出てこない。** OS の「戻る」に取られるところなので、
    // ここで足しておく。足すのは**画面の左右**(回す前)。OS のジェスチャは
    // 見た目の向きではなく、実際の画面の端に張り付いているため
    const guard = Math.max(0, this.opts.edgeGuard || 0);
    ins.left += guard;
    ins.right += guard;
    const s = turnInsets(angle, ins);
    this._root.style.setProperty('--safe-t', s.top + 'px');
    this._root.style.setProperty('--safe-b', s.bottom + 'px');
    this._applyFontSize();

    // offsetWidth は回す前の大きさ(枠のぶんも入っている)。
    // **どう割るかは planSideLayout にまかせる**(DOM を見ない、切り出した決めごと)
    const cw = this.canvas.offsetWidth || 0;
    const plan = planSideLayout({
      view: { w, h },
      canvasW: cw,
      safe: s,
      minSide: this.opts.minSide,
      guideMin: this.opts.guideMin,
    });
    // **GUI の置き場所がまったく無いときは、ゲーム画面を 1 段小さくしてもらう。**
    // 重ねるのは最後の手で、縮めて空きが作れるならそのほうがよい
    // (iPad のように画面が大きい機種では、少し縮めても十分大きい)。
    //
    // **往復しないようにする。** 頼むのは 1 回のレイアウトにつき 1 度きりで、
    // 頼んだあとの measure では頼み直さない。戻す(zoom を 1 へ)のも
    // このときは飛ばす。窓の大きさが変わったときは、また 1 から測り直す
    if (plan.overlap && this.opts.onNeedRoom && !this._askingRoom) {
      // **2px 余分に譲る。** ぴったりを狙うと、丸めのぶんで 1px 足りず
      // 縮めたのに重ねたまま、という間抜けなことになる
      const want = w - 2 * (Math.max(s.left, s.right) + this.opts.minSide) - 2;
      if (want > 0 && want < cw) {
        this._askingRoom = true;
        let changed = false;
        try { changed = this.opts.onNeedRoom(want, cw); } catch (e) { /* 転んでも続ける */ }
        if (changed) { this.layout(); this._askingRoom = false; return; }
        this._askingRoom = false;
      }
    }
    this.plan = plan;
    this._root.classList.toggle('overlap', plan.overlap);
    this._applyAlpha();
    // **下の段は遊びのもの。** 右下は連射ボタン、左下は十字が来るところなので、
    // 借りているボタン(音の入切など)は**上の段**へ回す。
    // 右上は ESC が座っているので、こちらは左上
    for (const name of ['guideL', 'tools']) {
      this._el[name].style.left = plan.left.x + 'px';
      this._el[name].style.width = plan.left.w + 'px';
    }
    for (const name of ['guideR', 'btns', 'tools2']) {
      this._el[name].style.left = plan.right.x + 'px';
      this._el[name].style.width = plan.right.w + 'px';
    }
    // **十字と連射だけは、ゲーム画面へ少しかぶせる。**
    // 帯の幅ぶんしか無いと絵が小さく、指を置きにいくのに狙いが要る。
    // GUI は半透明なので、下の弾も自機も透けて見える。
    // **かぶせるのはこの 2 つだけ**(案内・借りものボタン・OK / ESC は帯の中のまま)。
    // かぶせるのは案内が読めなくなるからではなく、**指のためなので、
    // 空きが足りているかどうかに関わらず いつもかぶせる**
    const bleed = Math.round(cw * Math.max(0, this.opts.padBleed || 0));
    // **左右の帯は同じ幅。** 片方だけ広いと、十字と連射で絵の置き場所が
    // 食い違って見える(実機でそう見えた)。外側の端からそれぞれ同じだけ取る
    const rightEdge = plan.right.x + plan.right.w;
    const zw = plan.left.w + bleed;
    const zoneL = { x: plan.left.x, w: zw };
    const zoneR = { x: rightEdge - zw, w: zw };
    for (const [name, z] of [['left', zoneL], ['right', zoneR]]) {
      this._el[name].style.left = z.x + 'px';
      this._el[name].style.width = z.w + 'px';
    }
    // **連射の丸を外側へ寄せる**(帯の真ん中からのずれ。px)。
    // 帯はゲーム画面へかぶせて広げてあるので、真ん中に置くとそのぶん
    // 丸が画面に掛かる。かぶせたぶんを戻す向きへ寄せれば、
    // **画面に掛からずに丸のまま置ける**(受け場所を切り詰めずに済む)。
    // どれだけかぶせたかを知っているのはここだけなので、ここで渡す
    this._el.right.style.setProperty('--shot-shift',
      Math.round(bleed * Math.max(0, Math.min(1, this.opts.shotShift))) + 'px');
    // **十字は帯の外もぜんぶ受ける。** 連射の丸のまわり(下で置く四角)だけは
    // あちらが取るが、それ以外は右の端まで十字のもの。
    // **指がずれるのは十字だけ**だから。連射は同じところを こすり続けるので
    // 広い受け場所が要らない
    this._el.catchL.style.left = (zoneL.x + zoneL.w) + 'px';
    this._el.catchL.style.width = Math.max(0, w - (zoneL.x + zoneL.w)) + 'px';
    // 案内は**隙間があるときだけ**。十字とショットが自分で出している
    // 名前や使いかたの文字も、同じときに引っ込める
    // (重なっているところへ文字を足すと、ゲーム画面も文字も読めなくなる)
    this._root.classList.toggle('narrow', !plan.guide);
    this._showPadLabels(plan.guide);
    // **十字とショットに「入れ物の幅が変わった」と伝える。**
    // あちらは窓の resize しか見ていないので、こちらが帯の幅を変えたことに
    // 気づけない。取り付けた直後は幅がまだ 0 で、既定の大きさのまま止まる
    // **借りているボタンと十字が重なるぶんを、内側へ逃がす。**
    // 狭い機種ではボタンが外側の端に縦一列で並ぶので、帯の真ん中に置いた
    // 十字がその上に掛かる。ボタンの並びを知っているのはこちらなので、
    // どれだけ逃がすかもこちらで出して渡す
    // ボタンが縦一列で端に寄るのは、帯が狭いとき(重ねている / 案内が出せない)
    const tools = this._el.tools.firstElementChild;
    const stacked = plan.overlap || !plan.guide;
    // **右の借りものボタンは、ESC / OPTION と同じ列に立てる。**
    // 狭い機種ではボタンが外側の端へ逃げるので、帯の真ん中に置いたままだと
    // こちらだけゲーム画面の側へ出っぱる。**ボタンの箱をそのまま借りる**
    // (幅を数字で持つと、CSS の min-width を変えたときに片方だけ取り残される)
    const esc = this._el.esc;
    if (stacked && esc && esc.offsetWidth) {
      this._el.tools2.style.left = (plan.right.x + esc.offsetLeft) + 'px';
      this._el.tools2.style.width = esc.offsetWidth + 'px';
    }
    this.touch.setOptions({
      anchorInset: (stacked && tools) ? Math.round(tools.offsetWidth) : 0,
      // **絵の大きさは、かぶせる前の帯の幅で決める。**
      // 入れ物の幅をそのまま使うと、かぶせたぶんだけ十字も連射の丸も育つ。
      // 広げたのは指を受けるためなので、絵は帯なりの大きさで据え置く
      areaWidth: bleed ? Math.min(plan.left.w, plan.right.w) : 0,
    });
    this._fitShotHit();
    this._paintSafeArea(s, w, h);
    // 画角を決め打ちにしているときは、その大きさを枠で見せる
    // (実機では窓がそのまま画角なので、囲むものが無い)
    this._root.classList.toggle('framed', !!box);
  }

  /**
   * **連射の受け場所を、丸のまわりの四角だけにする。**
   *
   * 十字は「触れたところが原点」なので指が上下左右へずれていくが、
   * **連射は同じところを こすり続ける**ので、広い受け場所が要らない。
   * 丸のまわりだけ取って、**残りは全部 十字に渡す**ほうが指に優しい。
   *
   * 場所は**丸そのものを測って**決める。同じ式を書き写すと、
   * touch.js 側の見た目を変えたときにここだけ取り残される。
   *
   * **絵が出ているときにしか測れない。** 隠れているあいだ大きさは 0 なので、
   * モードを切り替えて出したあとにも呼ぶこと(呼び忘れると受け場所が 0 のまま、
   * 連射がどこを押しても効かなくなる)
   */
  _fitShotHit() {
    const hit = this._el.catchR;
    const zone = this._el.right;
    const fire = this.touch._fire;
    if (!hit || !zone) return;
    if (!fire || !fire.offsetWidth) { hit.style.width = '0px'; hit.style.height = '0px'; return; }
    const m = Math.max(0, Math.round(this.opts.shotHitPad || 0));
    // **offsetLeft は当てにならない。** 丸は translateX(-50%) で置かれていて、
    // offsetLeft は動かす前の値なので、見た目より右半分ぶんずれる。
    // **帯の中での差**で取る(向きが回っていても、差なら同じ意味になる)
    const zr = this.touch._rectOf(zone);
    const fr = this.touch._rectOf(fire);
    let left = zone.offsetLeft + (fr.left - zr.left) - m;
    let width = fr.width + m * 2;
    // **ゲーム画面には掛けない**(上の shotHitOffCanvas を見ること)。
    // 画面の右端より内側にはみ出したぶんを、左から削る
    if (this.opts.shotHitOffCanvas && this.canvas) {
      const cr = this.touch._rectOf(this.canvas);
      const edge = zone.offsetLeft + (cr.right - zr.left);
      if (left < edge) {
        // **掛けないほうを先に取る。** 押しやすさより、
        // 「画面のここは押しても行き先が置けない」を作らないことを優先する
        const right = left + width;
        const rest = right - edge;
        // ただし**指が乗らないほど細くはしない**。そこまで削るしかない機種では、
        // わずかに掛かるのを飲む(24px は指の腹より狭いが、狙えば当たる)
        const min = 24;
        if (rest >= min) { left = edge; width = rest; }
        else { width = Math.min(min, right - left); left = right - width; }
      }
    }
    hit.style.left = Math.round(left) + 'px';
    hit.style.top = Math.round(zone.offsetTop + (fr.top - zr.top) - m) + 'px';
    hit.style.width = Math.round(width) + 'px';
    hit.style.height = Math.round(fr.height + m * 2) + 'px';
    hit.style.bottom = 'auto';
  }

  /**
   * **端末に食われるぶん**を px で読む。ノッチ・ホームバー・丸い角のぶん。
   * 返るのは**画面の向き**での上下左右(器の向きへ移すのは呼んだ側)。
   *
   * 横持ちのノッチは**左右のどちらに来るか分からない**ので、
   * 両側とも読んで、来ているほうだけ空ける。
   *
   * PC で試すときは、CSS の変数で上書きできる:
   *
   *   :root { --mmsxx-safe-left: 44px; }
   *
   * env() が効くのは `viewport-fit=cover` を書いたときだけ。
   * 書いていなければ 0 が返り、今までどおりの置きかたになる
   */
  _safeInsets() {
    const el = this._el.safe;
    if (!el) return { left: 0, right: 0, top: 0, bottom: 0 };
    const cs = getComputedStyle(el);
    const v = (s) => Math.max(0, parseFloat(s) || 0);
    return {
      left: v(cs.paddingLeft), right: v(cs.paddingRight),
      top: v(cs.paddingTop), bottom: v(cs.paddingBottom),
    };
  }

  /**
   * **画面の外の字を、画面の中の字と同じ大きさにする。**
   *
   * ゲーム画面の字は 8 ドット四方で、画面の倍率のぶん大きく見えている。
   * DOM の字も 8 ドットの枠なので、**fontUnit(8) に画面の倍率を掛ければ、
   * 画面の中の字とまったく同じ大きさ**になる。
   *
   * 倍率が 1.5 倍のような半端な値になる機種もあるが、
   * **8 の倍数から外すとドットがボケる**ので、近い整数倍へ丸める。
   *
   * **器の外にも配る**(シェアの窓など、ここが作っていない DOM でも使えるように)
   */
  _applyFontSize() {
    // clientWidth は枠を含まない中身の幅。canvas.width は等倍の中身
    const shown = this.canvas.clientWidth || 0;
    const real = this.canvas.width || 1;
    const n = Math.max(1, Math.round(shown / real));
    const px = (this.opts.fontUnit || 8) * n + 'px';
    this._root.style.setProperty('--mmsxx-gui-font-size', px);
    document.documentElement.style.setProperty('--mmsxx-gui-font-size', px);
  }

  /**
   * 十字とショットが自分で出している文字(名前・使いかた・誘い文句)の出し入れ。
   * **隙間が無いときは引っ込める。** PAUSE の札だけは残す(場所を覚えるもの)
   */
  _showPadLabels(on) {
    if (this._padLabelsOn === on) return;
    this._padLabelsOn = on;
    const keys = ['dpadTitle', 'dpadNote', 'dpadCallout',
      'shotTitle', 'shotNote', 'shotCallout'];
    const patch = {};
    for (const k of keys) patch[k] = on ? this._padLabels[k] : '';
    this.touch.setLabels(patch);
  }

  /**
   * **指を受けないところを斜線で見せる**。決め打ちの画角のときだけ
   * (実機ではそこに本物のノッチがあるので、上から描いても意味がない)。
   * ノッチ・ホームバーと、左右の端の帯(OS の「戻る」よけ)を**まとめて**描く。
   * どちらも「ここには指を置かない」という同じ意味なので、分けない
   */
  _paintSafeArea(s, w, h) {
    const box = this._el.safearea;
    if (!box) return;
    const put = (edge, x, y, bw, bh) => {
      const el = box.querySelector(`i[data-edge="${edge}"]`);
      if (!el) return;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.width = Math.max(0, bw) + 'px';
      el.style.height = Math.max(0, bh) + 'px';
    };
    put('left', 0, 0, s.left, h);
    put('right', w - s.right, 0, s.right, h);
    put('top', 0, 0, w, s.top);
    put('bottom', 0, h - s.bottom, w, s.bottom);
  }

  // ── ジェスチャ ────────────────────────────────────────

  /**
   * 見分けた結果をキーへ変える。**メニューのときだけ**。
   * 指の本数が 2 本以上のものは、ここでは相手にしない(ピンチなどは先の話)
   */
  _onGesture(e) {
    if (this.mode !== 'menu' || !this._root) return;
    if (e.fingers > 1) return;
    if (e.type === 'down') {
      this._scrollAcc = 0;
      this._flicked = false;
      this._axis = '';        // 触れ直すまで、向きは決め直さない
      return;
    }
    // **タップは受けない。** 「画面のどこを触っても決定」は、OK ボタンが
    // いつでも出ている以上ただの誤爆の元だった(ボタンを数 px 外すと
    // 帯を触ったことになり、ゲームが始まってしまう)。
    // 決定は OK ボタン、送りはフリックとスワイプ、と入口を分ける
    if (e.type === 'swipe') { this._swipe(e); return; }
    if (e.type === 'flick') { this._flick(e); return; }
  }

  /** 画面の上の動きを、遊びの上の動きへ直す(回しているぶんを戻す) */
  _turn(dx, dy) {
    return turnDelta(this.viewAngle(), dx, dy);
  }

  /**
   * 縦のスワイプ。**動いた量ぶん**上下キーを繰り返す。
   * 指を下ろすと中身も下がる(一覧の頭のほうへ戻る)ので ArrowUp
   */
  _swipe(e) {
    const d = this._turn(e.dx, e.dy);
    const total = this._turn(e.totalX, e.totalY);
    // **向きは一度きめたら、指を離すまで変えない。**
    // 毎回その場の合計で見ていると、縦へ送っている最中に少し横へ揺れただけで
    // ページがめくれてしまう(一覧を送っていたはずが順位表へ飛んだ)。
    // 決めるのは、どちらかがはっきり勝ってから
    if (!this._axis) {
      const ax = Math.abs(total.dx), ay = Math.abs(total.dy);
      if (Math.max(ax, ay) < this.opts.axisMinDist) return;
      this._axis = ax > ay * this.opts.axisBias ? 'x'
        : ay > ax * this.opts.axisBias ? 'y' : '';
      if (!this._axis) return;   // どちらとも言えないうちは何もしない
    }
    if (this._axis === 'x') {
      // **横は指を離すのを待たない。** しきい値を越えたその場でめくる。
      // 離してからだと、払い終わるまで何も起きず「重い」と感じる。
      // **めくり違えても戻せる**ので、早とちり気味でちょうどよい
      if (!this._flicked && Math.abs(total.dx) >= this.opts.flickMinDist) {
        this._flicked = true;
        this._pulse(this._xKey(total.dx));
      }
      return;
    }
    // **1 歩ぶんの距離は場面で変わる。** 何十行もある一覧は細かく送りたいが、
    // 数個から選ぶメニューを同じ細かさにすると、ちょっと動かしただけで飛ぶ
    const step = Math.max(1, this._guide.step || this.opts.scrollStep);
    this._scrollAcc += d.dy;
    while (this._scrollAcc >= step) { this._scrollAcc -= step; this._pulse('ArrowUp'); }
    while (this._scrollAcc <= -step) { this._scrollAcc += step; this._pulse('ArrowDown'); }
  }

  /**
   * 横に払ったとき、どちらの矢印を送るか。
   *
   * **既定はページをめくる向き。** 左へ払うと次のページが左から出てくるので、
   * 指が左(dx < 0)なら ArrowRight。紙をめくるのと同じで、動くのは中身のほう。
   *
   * **カーソルを動かす場面では逆にする**(setGuide の `xFollow`)。
   * こちらは指の先にあるものが動くので、右へ払えば右へ行ってほしい。
   * 名前入力を既定のままにしていて「左右が逆」になっていた
   *
   * @param {number} dx 指の横の動き(回転を戻したあとの値)
   */
  _xKey(dx) {
    const back = dx > 0;   // 右へ払った
    if (this._guide.xFollow) return back ? 'ArrowRight' : 'ArrowLeft';
    return back ? 'ArrowLeft' : 'ArrowRight';
  }

  /**
   * 横のフリック。**1 回で 1 ページ**
   */
  _flick(e) {
    if (this._flicked || this._axis === 'y') return;       // 縦と決めたぶんは送らない
    const d = this._turn(e.dx, e.dy);
    if (Math.abs(d.dx) <= Math.abs(d.dy)) return;          // 縦の払いは送りにまかせる
    if (Math.abs(d.dx) < this.opts.flickMinDist) return;   // 短すぎるものは数えない
    this._flicked = true;
    this._pulse(this._xKey(d.dx));
  }

  // ── 通知 ──────────────────────────────────────────────

  /**
   * ボタンを繋ぐ。`code()` が**キーを返せばそれを送り、関数を返せば呼ぶ**。
   * ゲーム側にキーが無い用事(リセットなど)は、関数で受け取るしかない
   */
  _bindButton(el, code) {
    el.addEventListener('pointerdown', (e) => {
      // ここで止めないと、下のジェスチャがタップとして数えてしまう
      e.stopPropagation();
      e.preventDefault();
      if (el.classList.contains('off')) return;
      el.classList.add('on');
      const v = code();
      if (typeof v === 'function') v();
      else this._pulse(v);
    });
    const off = () => el.classList.remove('on');
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      el.addEventListener(type, off);
    }
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * **借りているボタンを長押ししたら、何のボタンかを出す。**
   *
   * 絵だけのボタンは、覚えるまで何だか分からない。狭い機種では
   * 左右の案内も消えるので、**説明の受け皿がここになる**。
   * 文言は `title`(または `data-tip`)から読むので、置く側が書けばよい。
   *
   * 長押ししたぶんは**押したことにしない**。
   * 説明を読もうとしただけで音が切れるのでは、怖くて長押しできない
   */
  _bindTips() {
    // 借りているボタンと、**左右の案内の絵**。
    // 案内は狭い機種で文字を消してしまうので、長押しで読めるようにしておく
    for (const el of [this._el.tools, this._el.tools2, this._el.guideL, this._el.guideR]) {
      if (el) this._bindTipsOn(el);
    }
  }

  /**
   * **長押しの説明を引っ込める。** 出しっぱなしにしない口を 1 つにまとめてある。
   * 出した札は**その場面のもの**なので、画面が変わったら残してはいけない
   */
  _hideTip() {
    if (this._tipTimer) clearTimeout(this._tipTimer);
    this._tipTimer = 0;
    if (this._el.tip) this._el.tip.classList.remove('on');
  }

  _bindTipsOn(host) {
    const tip = this._el.tip;
    if (!tip) return;
    let held = false;
    const hide = () => { tip.classList.remove('on'); };
    const stop = () => this._hideTip();

    host.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('button, [data-tip], [title]');
      const text = el && (el.dataset.tip || el.getAttribute('title'));
      if (!text) return;
      held = false;
      stop();
      this._tipTimer = setTimeout(() => {
        this._tipTimer = 0;
        held = true;
        tip.textContent = text;
        // **押したものの高さに出す。** 画面の下に固定して出していたときは、
        // 遠すぎて出たことに気づけなかった。器の中での上からの位置を、
        // offsetParent をたどって出す(器ごと回っていても正しく出る)
        let x = 0, y = 0;
        for (let n = el; n && n !== this._root; n = n.offsetParent) {
          x += n.offsetLeft;
          y += n.offsetTop;
        }
        tip.style.bottom = 'auto';
        tip.style.transform = 'translate(-50%, 0)';
        // **押しているものの上へ逃がす。** 真ん中に重ねて出していたときは、
        // 読ませたい札を長押ししている指がそのまま隠していた。
        // 上に入らないもの(いちばん上のボタン)だけ下へ回す
        const gap = Math.round(this.opts.tipGap || 0);
        const above = y - gap - tip.offsetHeight;
        tip.style.top = Math.round(above >= 0 ? above : y + el.offsetHeight + gap) + 'px';
        // **横も押したものに合わせる。** 器の真ん中に出していたので、
        // 左の帯を押しているのに札はゲーム画面の上、という離れかたをしていた。
        // ただし札のほうが帯より広いことがあるので、器からははみ出させない
        tip.style.left = '0px';
        const half = tip.offsetWidth / 2;
        const cx = Math.min(Math.max(x + el.offsetWidth / 2, half),
          this._root.clientWidth - half);
        tip.style.left = Math.round(cx) + 'px';
        tip.classList.add('on');
      }, this.opts.tipHoldMs);
    });
    // **指を離したことは、押した相手には届かないことがある。**
    // メニューでは器(gesture.js)が pointerdown で setPointerCapture するので、
    // そのあとの pointerup / pointercancel は**器へ付け替えられて**しまい、
    // 押された案内の絵にも借りものボタンにも来ない。
    // 来ないままだと札が出しっぱなしになり、**画面を移っても前の場面の説明が
    // 残る**。窓ぜんぶで受けて必ず引っ込める(attach の _endTip)
    //
    // **pointerleave はここで見ない。** 器に捕まえられた瞬間、
    // 押した相手は指の通り道から外れたことになって leave が飛んでくる。
    // これを「指が離れた」と数えると、**案内の絵では長押しが必ず打ち切られ、
    // 説明がいつまでも出なかった**(借りものボタンは器へ渡していないので無事だった)。
    // 指が滑って外れたぶんも、離すまでは読ませたままでよい
    for (const type of ['pointerup', 'pointercancel']) {
      host.addEventListener(type, () => { stop(); setTimeout(hide, 900); });
    }
    // 長押しのあとの click は握りつぶす(読んだだけで押されては困る)
    host.addEventListener('click', (e) => {
      if (!held) return;
      held = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  _press(code, source) { if (this.onPress) this.onPress(code, source || SOURCE); }

  /** 使ったぶんだけ薄くする。下限より薄くはしない(見失うため) */
  _useUp() {
    if (this._use >= this.opts.fadeUses) return;
    this._use++;
    this._applyAlpha();
  }

  _applyAlpha() {
    if (!this._root) return;
    const o = this.opts;
    // 重なっているときは、はじめから薄いところを起点にする
    const from = this._root.classList.contains('overlap') ? o.alphaOverlap : o.alpha;
    const t = Math.min(1, this._use / Math.max(1, o.fadeUses));
    const a = from + (o.alphaMin - from) * t;
    this._root.style.setProperty('--gui-alpha', a.toFixed(3));
  }
  _release(code, source) { if (this.onRelease) this.onRelease(code, source || SOURCE); }

  /**
   * **1 コマだけ押す**。押した直後に離すとゲーム側の wasPressed() が拾えないので、
   * 離すのは次の描き替えまで待つ。待っているあいだに来た同じキーは捨てる
   * (貯めると、指を止めたあとも送られ続ける)
   */
  _pulse(code) {
    if (!code || this._pulsing.has(code)) return;
    this._pulsing.add(code);
    this._press(code);
    requestAnimationFrame(() => {
      this._pulsing.delete(code);
      this._release(code);
    });
  }

  /** 押しっぱなしを全部離す */
  releaseAll() {
    this.touch.releaseAll();
    for (const code of [...this._pulsing]) this._release(code);
    this._pulsing.clear();
    this._scrollAcc = 0;
    this._flicked = false;
  }
}

// ── DOM と CSS ──────────────────────────────────────────

const ROOT_HTML = `
  <!-- **指を受けるだけの場所**。絵は持たない(engine/util/touch.js の
       dpadCatch / shotCatch)。帯の幅だけだと指を下ろせるところが狭いので、
       左は十字、右はショットが、それぞれ**ゲーム画面の真ん中まで**受ける。
       **いちばん下に置く**ので、この上に載っているボタンや案内の絵のほうが
       先に指を取る -->
  <div class="mmsxx-gui-catch-left"></div>
  <div class="mmsxx-gui-catch-right"></div>
  <div class="mmsxx-gui-left"></div>
  <div class="mmsxx-gui-right"></div>
  <div class="mmsxx-gui-guide mmsxx-gui-guide-left"></div>
  <div class="mmsxx-gui-guide mmsxx-gui-guide-right"></div>
  <div class="mmsxx-gui-btns">
    <!-- **文字は入れない。** 何が書かれるかは場面ごとに決まるので、
         入れておくと最初の 1 コマだけ「ESC」「OK」が見えてしまう。
         沈めた状態(off)から始めて、案内が来たら書き替える -->
    <div class="mmsxx-gui-btn mmsxx-gui-esc off"></div>
    <div class="mmsxx-gui-btn mmsxx-gui-opt off"></div>
    <div class="mmsxx-gui-btn mmsxx-gui-ok off"></div>
  </div>
  <div class="mmsxx-gui-tools"></div>
  <!-- 右にも置き場所を用意する。**十字を隠したくないものはこちら**へ -->
  <div class="mmsxx-gui-tools mmsxx-gui-tools-right"></div>
  <div class="mmsxx-gui-safearea">
    <i data-edge="left"></i><i data-edge="right"></i>
    <i data-edge="top"></i><i data-edge="bottom"></i>
  </div>
  <div class="mmsxx-gui-tip"></div>
  <div class="mmsxx-gui-safe"></div>`;

/**
 * 文言を取り出す。`'START'` のような 1 つの文字列でも、
 * `{ ja, en }` のような組でも受ける。無ければ空文字
 */
function pickText(v, lang) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return (lang === 'ja' ? v.ja : v.en) || v.en || '';
}

/** 案内 1 つぶん。絵と文字を縦に並べる */
/**
 * 案内の 1 つぶん。**`null` を渡すと「出ているが使えない」枠**になる。
 *
 * 使える場面でだけ出す作りにしていたが、画面ごとに数が変わるので
 * **出たり入ったりが忙しく**、そのたびに残ったほうの位置も動いていた。
 * 枠は据え置きにして、使えないときは**文字を消して絵を沈める**
 */
function guideItemHTML(item, lang, slot) {
  // **空の枠にも同じ矢印を出す。** 塗りつぶした四角を置くと、
  // 沈んでいるのではなく**何かが乗っている**ように見える。
  // 絵を残したまま うんと沈めれば、「ここは同じ用事だが、いまは効かない」が伝わる。
  // どちらの矢印かは枠の位置で決まっている(1 つ目は左右、2 つ目は上下)
  if (!item) {
    const back = ICONS[slot === 0 ? 'leftright' : 'updown'] || '';
    return '<div class="mmsxx-gui-item off">'
      + `<svg class="mmsxx-gui-icon" viewBox="0 0 48 48" aria-hidden="true">${back}</svg>`
      + '</div>';
  }
  const icon = ICONS[item.icon] || '';
  const text = pickText(item, lang);
  // **長押しで出すぶんは、見えている文字より詳しくてよい。**
  // 無ければ見えている文字をそのまま使う(同じでも困りはしない)
  const tip = pickText({ ja: item.tipJa, en: item.tipEn }, lang) || text;
  return '<div class="mmsxx-gui-item"' + (tip ? ' data-tip="' + escapeHTML(tip) + '"' : '') + '>'
    + (icon ? `<svg class="mmsxx-gui-icon" viewBox="0 0 48 48" aria-hidden="true">${icon}</svg>` : '')
    + `<div class="mmsxx-gui-label">${escapeHTML(text)}</div>`
    + '</div>';
}

/**
 * **左の案内に置く枠の数。**
 * いまの画面はどれも 2 つまで(ページ送り + 一覧の送り、など)。
 * 増やすときはここだけ変えれば、場面ごとの並びはそのままでよい
 */
const GUIDE_SLOTS = 2;

/** 足りないぶんを null で埋める(多いぶんはそのまま出す) */
function padSlots(list, n) {
  const out = list.slice();
  while (out.length < n) out.push(null);
  return out;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

let styled = false;

/** CSS は 1 度だけ入れる。ドット絵風に、角は丸めない */
function injectStyle() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'mmsxx-gui-style';
  s.textContent = `
/* 指の動きでページごと持っていかれるのを止める(docs/SMARTPHONE.md の 8 節)。
   **バウンススクロールは overscroll-behavior では止まらない。** ページを固定する */
.mmsxx-gui-on {
  position: fixed; width: 100%; height: 100%; overflow: hidden;
}
/* 器。**canvas の外側だけ**を使う。ゲーム中は素通し(pointerEvents で切り替える) */
.mmsxx-gui {
  position: fixed; left: 0; top: 0;
  transform-origin: 0 0;
  touch-action: none;
  image-rendering: pixelated;
  z-index: 10;
}
/* 決め打ちの画角を見せる枠。**outline は場所を取らない**ので、
   中の置き場所を変えずに外側へ引ける(border だと 1px ぶん内側が狭くなる) */
.mmsxx-gui.framed { outline: 1px solid #777788; }
/* 端末に食われるぶん(ノッチ・ホームバー)を斜線で見せる。
   **決め打ちの画角のときだけ。** 実機ではそこに本物のノッチがあるので描かない */
.mmsxx-gui-safearea { display: none; }
.mmsxx-gui.framed .mmsxx-gui-safearea { display: block; }
.mmsxx-gui-safearea i {
  position: absolute; pointer-events: none;
  background: repeating-linear-gradient(45deg,
    rgba(255, 255, 255, 0.16) 0 4px, rgba(0, 0, 0, 0) 4px 8px);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
}
.mmsxx-gui, .mmsxx-gui * {
  user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
/* 長押しで出す説明。**画面の下の真ん中に札で出す**。
   ボタンの隣に出すと、狭い帯からはみ出したり指で隠れたりする */
.mmsxx-gui-tip {
  position: absolute; left: 50%; bottom: 6%; transform: translateX(-50%);
  max-width: 90%; padding: 6px 10px; pointer-events: none;
  background: #111122; border: 2px solid #8888aa; color: #ffffff;
  font: var(--mmsxx-gui-font-size, 16px) var(--mmsxx-gui-font, monospace);
  letter-spacing: 0; white-space: nowrap;
  opacity: 0; transition: opacity 120ms linear;
}
.mmsxx-gui-tip.on { opacity: 1; }

/* **端末に食われるぶんを読むためだけ**の当て板。場所は取らない。
   padding に env() を入れておき、getComputedStyle で px にして読む
   (env() は JS から直接は読めない)。
   PC で試すときは :root { --mmsxx-safe-left: 44px } のように上書きする */
.mmsxx-gui-safe {
  position: absolute; left: 0; top: 0; width: 0; height: 0;
  visibility: hidden; pointer-events: none;
  padding-left: var(--mmsxx-safe-left, env(safe-area-inset-left, 0px));
  padding-right: var(--mmsxx-safe-right, env(safe-area-inset-right, 0px));
  padding-top: var(--mmsxx-safe-top, env(safe-area-inset-top, 0px));
  padding-bottom: var(--mmsxx-safe-bottom, env(safe-area-inset-bottom, 0px));
}

/* **GUI はいつも半透明。** 重なっていないときも薄くしておく。
   道具であってゲームの絵ではないので、前へ出てこないほうがよい。
   重ねているときはさらに薄くして、下の弾と自機が透けるようにする */
/* **ボタンは薄くしない。** ここに入れていたせいで、START や RESUME まで
   72% の濃さで出ていて、実機では**押すところだと気づけなかった**
   (「ゲームを始めるのも迷った」)。薄くしてよいのは、場所を覚えたあとは
   邪魔になるもの(十字・ショット・案内の絵)だけ */
.mmsxx-gui-left, .mmsxx-gui-right,
.mmsxx-gui-guide {
  opacity: var(--gui-alpha, 0.72);
  /* 薄くなるのは**じわりと**。ぱっと変わると目を引いてしまう */
  transition: opacity 400ms linear;
}

/* **まだ触られていない / しばらく触られていないときの点滅。**
   薄くしてあるので、背景によっては本当に見えない。1 秒に 1 回ぱっと明るくして
   「ここに何かある」とだけ伝える。
   **明るさで光らせる**(opacity ではなく filter)。薄さは --gui-alpha が
   持っているので、そちらとけんかさせない。
   なめらかに明滅させず steps で切り替えるのは、昔の画面の感じに寄せるため。

   **光らせるのは動かすほうの帯だけ。** 連射のほうは、遊びはじめから
   ずっと右で点滅しているだけだった。とりわけ叩いて動かす遊びかたでは
   左の帯が空なので、**点いているのは連射側だけ**になって目障りになる。
   丸はそれと分かる形をしているので、教わらなくても押せる */
.mmsxx-gui.attention .mmsxx-gui-left {
  animation: mmsxx-gui-attention 1s steps(2, jump-none) infinite;
}
/* **光るものを 1 つにする。** 十字は自前でも目印を明滅させているが、
   周期が違う(1.4 秒)ので、こちらの 1 秒と噛み合わずばらばらに見える。
   あちらを止めて、帯ごと同じ拍で光らせる */
.mmsxx-gui .mmsxx-touch-hint { animation: none; }

/* **使いかたの文字は、斜線の帯まではみ出してよい。**
   あそこを空けているのは「指を置かない」ためで、字を置いてはいけない
   わけではない。帯の幅ぶんだけ広く使えれば、狭い機種でも 1 行に収まる。
   はみ出せるように、切り取りも外す(絵は真ん中に収まる大きさなので出ない) */
.mmsxx-gui .mmsxx-touch-zone { overflow: visible; }
.mmsxx-gui .mmsxx-touch-note { left: -22px; right: -22px; }
@keyframes mmsxx-gui-attention {
  0%   { filter: brightness(1); }
  50%  { filter: brightness(2.4); }
  100% { filter: brightness(1); }
}

/* 十字とショットの入れ物。中身は TouchControls が作る。
   **pointer-events は受け継がれる**ので、素通しにした器の中でも
   指を受けるところには それぞれ auto を書いておく。
   上下は食われるぶんだけ内側へ寄せる(ホームバーは指を吸う) */
.mmsxx-gui-left, .mmsxx-gui-right {
  position: absolute;
  top: var(--safe-t, 0px); bottom: var(--safe-b, 0px);
}
/* 十字は帯ぜんぶで受ける(指がずれていくので) */
.mmsxx-gui-left { pointer-events: auto; }
/* **連射の帯は受けない。** 受けるのは丸のまわりの四角だけ
   (.mmsxx-gui-catch-right。場所は layout の _fitShotHit が決める)。
   帯そのものは絵を置くためだけに残してある */
.mmsxx-gui-right { pointer-events: none; }
/* **受け場所を色で見せる**(showAreas。確かめるときだけ)。
   絵の外まで受けているので、ふだんは境目が見えない。
   色は「十字 = 青 / ショット = 赤」で、**絵のある帯は濃く、受けるだけは薄く**。
   名前も隅に出す(どれがどれか、色だけでは覚えられない) */
.mmsxx-gui.areas .mmsxx-gui-left,
.mmsxx-gui.areas .mmsxx-gui-catch-left { background: rgba(64, 132, 255, 0.30); }
.mmsxx-gui.areas .mmsxx-gui-catch-left { background: rgba(64, 132, 255, 0.13); }
.mmsxx-gui.areas .mmsxx-gui-right { background: rgba(255, 72, 72, 0.30); }
.mmsxx-gui.areas .mmsxx-gui-catch-right { background: rgba(255, 72, 72, 0.13); }
.mmsxx-gui.areas .mmsxx-gui-left,
.mmsxx-gui.areas .mmsxx-gui-right,
.mmsxx-gui.areas .mmsxx-gui-catch-left,
.mmsxx-gui.areas .mmsxx-gui-catch-right {
  outline: 1px dashed rgba(255, 255, 255, 0.55); outline-offset: -1px;
}
.mmsxx-gui.areas .mmsxx-gui-left::after,
.mmsxx-gui.areas .mmsxx-gui-right::after,
.mmsxx-gui.areas .mmsxx-gui-catch-left::after,
.mmsxx-gui.areas .mmsxx-gui-catch-right::after {
  position: absolute; left: 2px; top: 2px; pointer-events: none;
  font: 12px/1.2 monospace; color: #ffffff; text-shadow: 0 0 3px #000000;
  white-space: pre;
}
.mmsxx-gui.areas .mmsxx-gui-left::after { content: 'PAD'; }
.mmsxx-gui.areas .mmsxx-gui-catch-left::after { content: 'PAD\\A(catch)'; }
.mmsxx-gui.areas .mmsxx-gui-right::after { content: 'SHOT'; }
.mmsxx-gui.areas .mmsxx-gui-catch-right::after { content: 'SHOT\\Aここだけ'; }
/* 受けない帯は、受ける場所と見分けがつくように塗らない(枠だけ) */
.mmsxx-gui.areas .mmsxx-gui-right { background: rgba(255, 72, 72, 0.10); }

/* **指を受けるだけの場所。** 何も見せない。
   ゲーム画面の上に被るので、**触れたことが分かる印も出さない**
   (弾を隠さないため)。出し入れは touch.js の visible がやる */
.mmsxx-gui-catch-left {
  position: absolute; pointer-events: auto; background: none;
  top: var(--safe-t, 0px); bottom: var(--safe-b, 0px);
}
/* 連射の受け場所。**丸のまわりの四角だけ**。上下も layout が決めるので、
   ここでは帯のように伸ばさない */
.mmsxx-gui-catch-right {
  position: absolute; pointer-events: auto; background: none;
}

/* 案内。**メニューのときだけ**出す。指の邪魔をしないよう素通しにする */
.mmsxx-gui-guide {
  position: absolute; top: var(--safe-t, 0px); bottom: var(--safe-b, 0px);
  display: none; flex-direction: column;
  align-items: center; justify-content: center; gap: 22px;
  padding: 0 6px; box-sizing: border-box;
  pointer-events: none;
}
.mmsxx-gui.menu .mmsxx-gui-guide { display: flex; }
/* 左の上には借りもののボタンが来るので、そのぶん下へ寄せて真ん中を取る */
.mmsxx-gui.menu .mmsxx-gui-guide-left { padding-top: 72px; }
/* **狭いところでは案内ごと消す。** 文字だけ消して矢印を残すと、
   何を指しているのか分からない印がゲーム画面の上に居座ることになる。
   消したぶんの説明は、ボタンの長押しで出すツールヒントで補う */
.mmsxx-gui.narrow .mmsxx-gui-guide { display: none; }
/* **絵と文字を重ねる。** 縦に積むと 2 つぶんの高さが要るうえ、
   細い帯では文字が折り返してしまう。同じマスへ置けば場所は 1 つぶんで済む */
/* 案内そのものは素通しだが、**絵の上だけは指を受ける**。
   長押しで説明を読ませるため(狭い機種では文字を消してしまうので) */
.mmsxx-gui-item {
  display: grid; place-items: center; width: 100%; pointer-events: auto;
}
/* **出ているが使えない枠。** 絵は残して、うんと沈める。
   **塗りつぶさない** — 地を塗ると、沈んでいるのではなく
   何かが乗っているように見える(実機でそう見えた)。
   場所だけは取っておくので、使えるようになっても位置が動かない */
.mmsxx-gui-item.off { pointer-events: none; }
.mmsxx-gui-item.off .mmsxx-gui-icon { opacity: 0.14; }
.mmsxx-gui-icon, .mmsxx-gui-item .mmsxx-gui-label { grid-area: 1 / 1; }
/* 下敷きのシルエット。**沈めておく**(主役は上の文字) */
.mmsxx-gui-icon {
  width: 100%; max-width: 96px; aspect-ratio: 1;
  /* **文字より弱く。** 同じ濃さだと重なったところで読めなくなる */
  fill: #8890a8; stroke: none; opacity: 0.5;
}
/* **ドット絵フォントは決まった大きさでしか揃わない。** 8x12 なら 12px
   (その倍数)で出し、字間も広げない。広げると格子から外れて滲んで見える。
   借りる側が --mmsxx-gui-font を決める(無ければ等幅で出る) */
.mmsxx-gui-label {
  /* 下敷きの絵に重なるので、**文字は白**でいちばん強くする */
  color: #ffffff;
  font: var(--mmsxx-gui-font-size, 16px)/1.5 var(--mmsxx-gui-font, monospace);
  letter-spacing: 0; text-align: center; max-width: 100%;
  /* 入りきらないぶんは折り返す。8 ドットの格子から外さない */
  overflow-wrap: anywhere;
}

/* いつもの場所にあるボタン。**メニューのときだけ**出す。
   ESC は上、OK は下(親指の来るところ)。効かない場面でも場所は動かさない */
/* **上の 1 つ(ESC)は遊んでいる最中も出す。** ここは touch.js も
   同じ場所に PAUSE の札を持っているが、**あちらは出さない**(下で伏せる)。
   同じ場所に持ち主の違うボタンが 2 つあると、文言・大きさ・端寄せを
   片方だけ直して取り残す、ということが実際に何度も起きた */
/* **入れ物そのものは素通し。** ここは帯の高さいっぱいを覆っているので、
   受け取ってしまうとショットのエリアが丸ごと死ぬ(実際そうなった)。
   指を受けるのは中のボタンだけ */
.mmsxx-gui-btns {
  position: absolute; display: block; pointer-events: none;
  top: var(--safe-t, 0px); bottom: var(--safe-b, 0px);
}
.mmsxx-gui-btn { pointer-events: auto; }
.mmsxx-gui .mmsxx-touch-pause { display: none; }
/* 遊んでいる最中に要るのは ESC(= PAUSE)だけ。空の箱を並べない */
.mmsxx-gui:not(.menu) .mmsxx-gui-ok,
.mmsxx-gui:not(.menu) .mmsxx-gui-opt { display: none; }
.mmsxx-gui-btn {
  /* **幅は文字なり。** 帯いっぱいに伸ばすと、短い文言のときに間延びする。
     ただし短すぎても押しにくいので下限を持たせ、長い文言のときだけ
     帯いっぱいまで育てる(**そこまで長い文言は書かないのが本筋**) */
  position: absolute; left: 50%; transform: translateX(-50%);
  width: max-content; min-width: 62%; max-width: calc(100% - 4px);
  /* **効く場面ははっきり出す。** 半透明にしていたころは、実機で
     「押すところだ」と気づけなかった。地は透かさず、枠は白、字も白。
     沈めた off(下)との差が一目で分かる濃さにする */
  background: #2a2a3c; border: 2px solid #ffffff; color: #ffffff;
  font: var(--mmsxx-gui-font-size, 16px) var(--mmsxx-gui-font, monospace); letter-spacing: 0;
  display: flex; align-items: center; justify-content: center;
  box-sizing: border-box;
  /* **箱は字に合わせる。** 高さを決め打ちにすると、字が真ん中に浮いて
     間延びする。上下は控えめ、左右はゆったり(押しやすさは幅で稼ぐ) */
  padding: 7px 8px;
}
/* ゲーム中の ESC(TouchControls の PAUSE)と同じ高さに置く。
   **モードが変わっても場所が動かない**ようにするため */
.mmsxx-gui-esc { top: 22px; }
/* **その場かぎりの 3 つめ。** ESC のすぐ下に居座る。
   使わない場面でも箱は残す(位置を覚えたままにするため) */
.mmsxx-gui-opt { top: 62px; }
/* OK は箱を大きく取る。**字は ESC と同じ大きさ**(画面の中の字に合わせてある)。
   **ここだけ色を変える。** 先へ進む口はいつもこれなので、
   ほかのボタンと同じ顔にしておくと、初めての人が どれを押すか迷う
   (実機で「ゲームを始めるのも迷った」) */
.mmsxx-gui-ok {
  bottom: 10%; padding-top: 14px; padding-bottom: 14px;
  background: #ffe000; border-color: #ffe000; color: #111122;
}
/* 沈めるときは色も戻す(押せないのに目立つのがいちばん困る) */
.mmsxx-gui-ok.off { background: #2a2a3c; border-color: #ffffff; color: #ffffff; }
/* **選んだものの名前を出す場面だけ大きく**(タイトル)。
   ここは「何を選んだか」を読ませる場所でもあるので、字が小さいと
   画面の中の並びと見比べることになる。**8 の倍数**(16 -> 24)にする。

   **選ぶものによって箱の大きさは変えない。** 名前の長さはまちまちなので、
   字なりに伸ばすと**選ぶたびに押す場所が動く**(指が場所を覚えられない)。
   幅は帯いっぱいに決め打ちし、高さも 2 行ぶんで取っておく。
   入りきらない長い名前は、中で折り返して収める */
.mmsxx-gui-ok.big {
  font-size: calc(var(--mmsxx-gui-font-size, 16px) * 1.5);
  width: calc(100% - 4px);
  min-width: 0;
  /* **1 行に収まる名前しか置かない**ので、高さも 1 行ぶんで決め打ちにする
     (借りる側の決めごと。長い名前は短く書く — SCENE SEL / DEV SETTING)。
     折り返させると、そこだけ背が高くなって大きさが動く */
  min-height: calc(1.2em + 24px);
  line-height: 1.2;
  padding-top: 10px; padding-bottom: 10px;
  white-space: nowrap;
}
/* **横が窮屈な機種では左右も詰める。** 端の 6px と字の左右の余白を削って、
   長い文言(GO TITLE など)が入るところまで幅を稼ぐ */
/* **狭いところでは外側の端へ寄せる。** 真ん中に置くとゲーム画面の側へ
   はみ出す。端まで逃がせば、そのぶん画面に掛からない */
.mmsxx-gui.overlap .mmsxx-gui-btn, .mmsxx-gui.narrow .mmsxx-gui-btn {
  padding-left: 2px; padding-right: 2px; max-width: 100%;
  left: auto; right: 2px; transform: none;
}
/* 借りているボタンも、狭いところでは**縦 1 列**にする。
   2 列に折り返すと帯を広く取ることになり、そのぶん画面が小さくなる */
.mmsxx-gui.overlap .mmsxx-gui-tools #tools,
.mmsxx-gui.narrow .mmsxx-gui-tools #tools { flex-direction: column; flex-wrap: nowrap; }
/* 右のぶんは**いつも縦一列**。ESC / OPTION と同じ列に並ぶので、
   横へ広げると連射のエリアを削ってしまう */
.mmsxx-gui-tools-right { justify-content: center; }
/* 縦 1 列にしたら、**いちばん外側の端へ寄せる**。真ん中に置くと
   そのぶんゲーム画面の側へ出っぱる(ボタンを端へ逃がしたのと同じ理由) */
.mmsxx-gui.overlap .mmsxx-gui-tools,
.mmsxx-gui.narrow .mmsxx-gui-tools { justify-content: flex-start; }
/* **右のぶんは逆。** 上の行は名前が同じなので右の列にも当たってしまい、
   ボタン(ESC / OPTION)が外側の端へ逃げているのに、こちらだけ内側 =
   ゲーム画面の側へ寄っていた(キーボードのボタンが画面に掛かっていたのはこれ)。
   置き場所は layout() が ESC の箱に合わせるので、ここは真ん中でよい */
.mmsxx-gui.overlap .mmsxx-gui-tools-right,
.mmsxx-gui.narrow .mmsxx-gui-tools-right { justify-content: center; }
/* **押せるようになった直後の 1 秒。** ぱっぱっと 4 回 明るくして目を向けさせる。
   なめらかに明滅させず steps で切り替えるのは、昔の画面の感じに寄せるため
   (光るのは明るさだけ。地や枠の色は触らないので、押されたときの見た目と
   けんかしない) */
@keyframes mmsxx-gui-btn-wake {
  0%   { filter: brightness(1); }
  50%  { filter: brightness(2.2); }
  100% { filter: brightness(1); }
}
.mmsxx-gui-btn.wake { animation: mmsxx-gui-btn-wake 0.25s steps(2, jump-none) 4; }
.mmsxx-gui-btn.on { background: #8888aa; color: #111122; }
/* 効かない場面。**消さずに沈める** */
.mmsxx-gui-btn.off { opacity: 0.3; }

/* ゲーム側のボタン(音の入切など)を置く場所。中身は借りもの。
   **遊んでいる最中も出しておく。** 音を切るのに、わざわざポーズを
   通らせる理由が無い。
   置くのは**十字の側の上**。十字は「触れたところが原点」で、絵は下寄りに
   据えてあるので、上の隅を明け渡しても操作はほとんど落ちない。
   ボタンは十字の入れ物とは別の層なので、**押しても十字には届かない**
   (連射の側に置くと、そこだけこすりが切れてしまう) */
.mmsxx-gui-tools {
  position: absolute; pointer-events: auto; display: flex;
  top: calc(22px + var(--safe-t, 0px));
  justify-content: center; gap: 8px;
}
/* **入るだけ横に並べ、入らなくなったら下へ折り返す。**
   幅で場合分けせずに済むので、ボタンが増えても境目の値を足さなくてよい。
   帯が狭いところでは自然と縦積みになる */
/* 右のぶんは ESC(22) と OPTION(62) の下から。**下の段は遊びのもの**なので、
   ここも上寄せのまま */
.mmsxx-gui-tools-right { top: calc(112px + var(--safe-t, 0px)); }
.mmsxx-gui-tools #tools {
  flex-direction: row; flex-wrap: wrap;
  justify-content: center; align-content: flex-start;
}
`;
  document.head.appendChild(s);
}
