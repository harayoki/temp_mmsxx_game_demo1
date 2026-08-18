import { VDP, SCREEN_W, SCREEN_H, VIRTUAL_W, VIRTUAL_H } from './video.js';
import { PSGPlayer } from '../vendor/mmsxx-mml-studio/sound/audio.js';
import { Input } from './input.js';
import { ErrorLog } from './errorlog.js';
import { createRng } from './rng.js';

export { SCREEN_W, SCREEN_H, VIRTUAL_W, VIRTUAL_H };

/** よく使う縦横比。`startRecord({ aspect: '16:9' })` のように名前で渡せる */
export const ASPECTS = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:16': 9 / 16,
};

/**
 * 録画の重さ(1 秒あたりのビット数)につける名前。
 * `startRecord({ bitrate: BITRATE.low })` のように使う。
 * 数字をそのまま渡してもよい('low' のような文字列でも受ける)。
 *
 * この絵柄(色が少なく、平らな面ばかり)を目安にした値。
 * MID で 2 倍・5 秒が 300KB ほど。LOW まで落とすと、
 * 爆発が広がるところで背景の星がにじみはじめる。
 */
export const BITRATE = {
  low: 200000,
  mid: 400000,
  high: 800000,
  max: 1500000,
  auto: 0,        // ブラウザの見立てに任せる
};
export { ErrorLog };

/** レイヤー操作のハンドル。MMSXXEngine.layer(n) で取得する。 */
class LayerHandle {
  constructor(vdp, index) {
    this._vdp = vdp;
    this._index = index;
  }
  /**
   * RGBA画像(自動MSX変換・キャッシュ付き)または変換済み画像を仮想画面に描く。
   * opts で { flipX, flipY, rotate: 180 } を渡すと反転・180度回転して描ける
   * (90/270 度は横8ドット2色の決まりが崩れるので BG では使えない)。
   * opts.colorMap は色番号の置き換え表(スプライトと同じ書き方)。
   * 1 枚の絵を色ちがいで描き分けられる。
   * 交互に描けば、実機に無い中間色を目で作れる。
   * opts.scanline は走査線。null = 入れない / 0 = 奇数行を抜く / 1 = 偶数行を抜く。
   * 抜いた絵は作り置きされるので、描く手数は元の絵と変わらない。
   * opts.bgCheck に 'off' を渡すと、この絵だけ「横 8 ドット 2 色」の検査を見逃す。
   */
  draw(x, y, image, transparent = true, opts) {
    this._vdp.drawToLayer(this._index, x, y, image, transparent, opts);
  }
  /**
   * 矩形塗りつぶし。引数省略で全面。color 0 = 透明クリア。
   * ふだんは MSX らしく 8 ドット(キャラクタ)単位に丸める。
   * exact = true にすると 1 ドット単位でそのまま塗る
   * (細くなっていくレーザーのような、1 ドットずつ変える絵に使う)。
   */
  fill(color = 0, x, y, w, h, exact = false) {
    this._vdp.fillLayer(this._index, color, x, y, w, h, exact);
  }
  /** 全面透明クリア */
  clear() { this._vdp.fillLayer(this._index, 0); }
  /**
   * 画面の端で裏画面を繰り返すかどうか。
   * 既定は繰り返す(流れつづける星空など)。false にすると、
   * 右へはみ出した絵が左から出てくる、といったことがなくなる。
   */
  setRepeat(x = true, y = x) {
    const L = this._vdp.layers[this._index];
    L.repeatX = !!x; L.repeatY = !!y;
  }
  /**
   * 内蔵フォントでテキスト描画 (1文字 8x8)。
   * scale を渡すと大きく描ける(2 で 16x16 の「16 ドットフォント」)。
   * bg は**既定で黒**。文字のます目ごと塗るので下が透けない。
   * 重ね書きしたいときだけ bg に 0 を渡す
   */
  print(x, y, text, color = 15, bg = 1, scale = 1) {
    this._vdp.print(this._index, x, y, text, color, bg, scale);
  }
  /** スクロール位置を設定(仮想画面のどこを表示画面の左上にするか) */
  scroll(x, y) {
    const L = this._vdp.layers[this._index];
    L.scrollX = x; L.scrollY = y;
  }
  /** スクロール位置を相対移動 */
  scrollBy(dx, dy) {
    const L = this._vdp.layers[this._index];
    L.scrollX += dx; L.scrollY += dy;
  }
  get scrollX() { return this._vdp.layers[this._index].scrollX; }
  get scrollY() { return this._vdp.layers[this._index].scrollY; }
  get visible() { return this._vdp.layers[this._index].visible; }
  set visible(v) { this._vdp.layers[this._index].visible = v; }
  /**
   * 走査線。null = 入れない / 0 か 1 = その位相の行を抜いて 1 ライン おきに描く。
   * 毎コマ 0 と 1 を入れ替えると、抜ける行が交互に動く。
   * 絵は消さずに描画のときだけ間引くので、下に描いたものは残る。
   */
  get scanline() { return this._vdp.layers[this._index].scanline; }
  set scanline(n) { this._vdp.layers[this._index].scanline = (n == null) ? null : (n & 1); }
  /** 表示スクロールの量子化単位。8 で MSX1 実機風の8ドット単位スクロールになる (0=滑らか) */
  get snap() { return this._vdp.layers[this._index].snap; }
  set snap(n) { this._vdp.layers[this._index].snap = n; }
  /** このレイヤーの裏画面サイズ */
  get width() { return this._vdp.layers[this._index].width; }
  get height() { return this._vdp.layers[this._index].height; }
}

/**
 * MSX1 風仮想マシンのゲームエンジン本体。
 *
 * MMSXX = **MMS/XX (Mock Machine System, model XX)**。実在しなかった機械の型番。
 *
 * const mmsxx = new MMSXXEngine(canvas, { scale: 3 });
 * mmsxx.backdrop = 4;
 * mmsxx.layer(0).draw(0, 0, rgbaImage);
 * const ship = mmsxx.sprite(rgbaImage);
 * mmsxx.run((m) => { ship.x++; });
 */
export class MMSXXEngine {
  /** エンジンの版(コンソールの名乗りなどに使う) */
  static get version() { return '2.00'; }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{scale?:number, virtualWidth?:number, virtualHeight?:number,
   *          layers?: {width?:number,height?:number}[],
   *          screen?: {width?:number,height?:number,borderX?:number,borderY?:number}}} [opts]
   *   virtualWidth / virtualHeight は裏画面の既定サイズ(256〜2048 の 2 の冪、既定 1024x1024)。
   *   layers を渡すとレイヤーごとに別々のサイズを持てる。配列の長さが枚数になり、上限はない。
   *   screen は表示画面の大きさ(8 ドット単位、既定 256x192)とボーダーの厚み。
   *   maxVoices は同時に鳴らせる音の数(既定 8)。エンジン側に上限はない。
   *   maxNoise は同時に鳴らせるノイズの数(既定 1)。爆発など SE が
   *   ノイズを取り合って消えるときに増やす。
   */
  constructor(canvas, opts = {}) {
    this.vdp = new VDP(
      canvas, opts.scale ?? 3,
      opts.virtualWidth ?? VIRTUAL_W, opts.virtualHeight ?? VIRTUAL_H,
      opts.layers, opts.screen,
    );
    // 実機の「1 行に何枚まで」の再現。既定は無効(0)
    if (opts.spriteLimit) this.vdp.spriteLimit = Math.max(0, opts.spriteLimit | 0);
    if (opts.spriteMax) this.vdp.spriteMax = Math.max(0, opts.spriteMax | 0);
    /**
     * **1 秒あたりのコマ数**(既定 60)。実機に寄せて 50 にしたり、
     * 動きを見るために落としたりできる。溜めるコマの計算は 60 のままなので、
     * 大きく変えるとリプレイの秒数がずれる
     */
    this.fps = Math.max(1, Math.min(120, opts.fps | 0)) || 60;
    /**
     * **処理落ち**。出しているスプライトがこの数を超えたら、
     * コマ数を `slowFps` まで落とす(0 で無効)。
     *
     * 実機は「1 コマのうちに描き切れないと、次の割り込みまで待たされる」ので、
     * 画面が混むと**動きがそろって遅くなる**。あれを狙って起こす仕掛け。
     * 数えているのは BG スプライトも足した数(`vdp.shownSprites`)
     */
    this.slowAt = Math.max(0, opts.slowAt | 0);
    /** 処理落ちしているときのコマ数(既定 30 = 半分。'hard' のとき使う) */
    this.slowFps = Math.max(1, Math.min(120, opts.slowFps | 0)) || 30;
    /**
     * **落ちかた**。
     *
     *   'hard' … 超えたとたんに `slowFps` まで落ちる(既定)。
     *            アーケードの「はっきり半分になる」感じ。
     *            わざとそうしていた作品も多い
     *   'soft' … **混みぐあいに応じて、ときどき 1 コマ落とす**。
     *            少し超えただけなら たまにつっかえる程度で、
     *            混むほど回数が増えて半分の速さへ近づく。
     *            MSX の実機で起きていた「微妙に遅くなる」ほうに近い
     *
     * @type {'hard'|'soft'}
     */
    this.slowMode = (opts.slowMode === 'soft') ? 'soft' : 'hard';
    /**
     * 'soft' のときの重さ。**あふれた 1 枚あたり、どれだけ落ちやすくなるか**。
     * 既定 0.02 なら、50 枚ぶんあふれて はじめて毎コマ落ちる勘定
     */
    this.slowSoft = (opts.slowSoft > 0) ? opts.slowSoft : 0.02;
    /** いま処理落ちしているか(見るだけ) */
    this.slow = false;
    this._slowDebt = 0;   // 'soft' で溜めていく借り
    this._slowSkip = false;   // 直前のコマを落としたか(続けて落とさないため)
    if (opts.spriteRotate) {
      this.vdp.spriteRotate = (typeof opts.spriteRotate === 'string') ? opts.spriteRotate : true;
    }
    this.audio = new PSGPlayer({
      maxVoices: opts.maxVoices ?? 8,
      maxNoise: opts.maxNoise ?? 1,
    });
    // エラーは日付ごとのログに残す(3 日ぶん)。
    // 手元の開発中はエラーで止め、公開版は致命的でなければ続ける
    this.errors = new ErrorLog({ local: MMSXXEngine.isLocal }).install();
    this.input = new Input(() => this.audio.unlock());
    /**
     * **種つきの乱数**。同じ種なら、いつでも同じ順番で同じ数が出る。
     * プレイの再現(操作の記録から作り直す)と、途中の状態の保存に使う。
     *
     * 名前ごとに別の流れになるので、**片方が 1 回多く引いても、
     * もう片方はずれない**。どこまで分けるかはゲームが決める。
     * 見た目だけのもの(爆発の粒など)は `Math.random()` のままでよい。
     *
     * ```js
     * mmsxx.rng.seed(12345);        // 親の種(記録に残すのはこれだけ)
     * mmsxx.rng('boss').int(0, 3);  // ボスの流れから 0..3
     * mmsxx.rng().next();           // 名前を省くと既定の流れ
     * ```
     */
    this.rng = createRng(opts.seed);
    /**
     * 開発版のビルドか。既定は「手元で開いているか」だが、
     * opts.dev を渡せばビルドで固定できる(公開版は false)
     */
    this._dev = opts.dev ?? MMSXXEngine.isLocal;
    /** expose() で window に付けた名前 */
    this._exposed = [];
    // 素材の検査は、**作っている最中は例外で止め**(見落とさないように)、
    // 公開版は**警告だけ**にする(絵が間違っていても、遊ぶ人の前では止めない)
    this.vdp.bgCheck = this._dev ? 'throw' : 'warn';
    // 開発版では、合成のようすを一定間隔で console に出す(遅いところを見つける材料)
    this.vdp.profile = this._dev;
    // 開発版では、作った絵を控えておく(素材の一覧を書き出すため)。
    // 公開版で控えると、使い終わった派生の絵も捨てられなくなるので入れない
    this.vdp.trackSymbols = this._dev;
    this._layers = this.vdp.layers.map((_, i) => new LayerHandle(this.vdp, i));
    /** 経過フレーム数 (60fps) */
    this.frame = 0;
    this._running = false;
  }

  /** 裏画面の既定の幅(レイヤーごとの実サイズは layer(i).width) */
  get virtualWidth() { return this.vdp.vw; }
  /** 裏画面の既定の高さ(レイヤーごとの実サイズは layer(i).height) */
  get virtualHeight() { return this.vdp.vh; }
  /** レイヤーの枚数 */
  get layerCount() { return this.vdp.layers.length; }

  // ---- 表示画面 ----
  /** 描画領域の幅(8 ドット単位。既定 256) */
  get screenWidth() { return this.vdp.width; }
  /** 描画領域の高さ(8 ドット単位。既定 192) */
  get screenHeight() { return this.vdp.height; }
  /** ボーダー込みで実際に出ている幅 / 高さ */
  get outWidth() { return this.vdp.outWidth; }
  get outHeight() { return this.vdp.outHeight; }
  /** いまの画面ずらし量 */
  get adjustX() { return this.vdp.adjustX; }
  get adjustY() { return this.vdp.adjustY; }

  /** 描画領域の大きさを変える(8 ドット単位) */
  setScreenSize(width, height) { this.vdp.setScreenSize(width, height); }

  /**
   * ボーダー(描画領域の外の遊び)の厚みを決める(1 ドット単位)。
   * ここには何も描かれず、いつも背景色で塗られる。
   */
  setBorder(x, y = x) { this.vdp.setBorder(x, y); }

  /**
   * 画面全体を 1 ドット単位でずらす(実機の SET ADJUST 相当。-15..+16)。
   * 回り込みは起きず、空いたところは背景色になる。画面を揺らす演出に使う。
   */
  setAdjust(x, y) { this.vdp.setAdjust(x, y); }

  /**
   * いまの画面を画像として取り出す(原寸)。
   * 実描画そのものが原寸のオフスクリーンなので、これがいちばん安い。
   * @param {{scale?:number, type?:'dataURL'|'blob'|'canvas', mime?:string}} [opts]
   */
  capture(opts) { return this.vdp.capture(opts); }

  /**
   * **直前のコマを溜めておく**。あとから「何秒前の画面」を取り出せる。
   *
   * 色番号のまま(1 ドット 1 バイト)持つので、色に直したものより 4 分の 1 で済む。
   * 264x200 なら 1 コマ 51.6KB。**60fps で 3 秒なら 9MB ほど**。
   *
   * ```js
   * mmsxx.keepFrames(3);            // 直前 3 秒ぶんを持ちつづける
   * mmsxx.frameAgo(1);              // 1 秒前にいちばん近いコマ(canvas)
   * mmsxx.frameAgo(1, 2);           // 2 倍に広げて取り出す
   * mmsxx.frameBackCanvas(0);       // いちばん新しいコマ(再生に使う)
   * mmsxx.frameCount;               // いま持っているコマ数
   * mmsxx.keepFrames(0);            // やめて捨てる
   * ```
   *
   * 60fps を落とさないよう、写すのは**色に直す前の 1 回のコピー**だけ。
   * @param {number} seconds 何秒ぶん持つか
   */
  keepFrames(seconds) { this.vdp.keepFrames(seconds); }

  /** いま持っているコマ数 */
  get frameCount() { return this.vdp.frameCount; }

  /**
   * **直前の音も溜めておく**(絵と同じ考えかた)。
   * 出口の**手前**で拾うので、音を切って遊んでいても、残した音には
   * ちゃんと鳴っていたものが入る。生の波形なので 3 秒で 0.6MB ほど。
   *
   * ```js
   * mmsxx.keepSound(3);            // 直前 3 秒ぶんの音を溜める
   * await mmsxx.audio.soundBack(); // 溜まっているぶん(AudioBuffer)
   * mmsxx.audio.playSound();       // そのまま鳴らす(リプレイ用)
   * mmsxx.keepSound(0);            // やめて捨てる
   * ```
   * @param {number} seconds 何秒ぶん持つか
   */
  keepSound(seconds) { this.audio.keepSound(seconds); }

  /**
   * **溜めたコマを再生する**(やられたあとのリプレイなど)。
   *
   * 出しかたは 2 とおり。
   *
   * - **layer を渡さない … 画面ぜんぶを覆う。** 合成を飛ばして溜めたコマを
   *   そのまま出すので、レイヤーもスプライトも割り込めない。
   *   ドットが完全に一致するので、**録画するならこちら**
   * - **layer を渡す … そのレイヤーへ写す。** 上にスプライトや文字を重ねられる。
   *   渡したレイヤーは再生に占領されるので、空いているものを渡すこと
   *
   * どちらも溜めるのは自動で止まり、終わると元へ戻る。
   *
   * ```js
   * mmsxx.playFrames({ seconds: 3, onEnd: () => 次へ進む() });   // 覆う
   * mmsxx.playFrames({ layer: 5, seconds: 3 });                 // レイヤーへ
   * mmsxx.stopFrames();   // 途中でやめる(キーで飛ばすときなど)
   * ```
   *
   * **画面に出した文字は録画にも入る。** 「REPLAY」のような案内を
   * 録画へ入れたくないときは、canvas ではなく **DOM に出す**こと
   * (FPS の表示と同じ考えかた)。
   * ## 前と後ろに間を置く
   *
   * いきなり流しはじめると、**同じ場面をもう一度見せられただけ**に見える。
   * 最初のコマを少し出したままにして「これから巻き戻す」と分からせ、
   * 最後のコマでも止めて「何が起きたか」を残すと、ぐっと読めるようになる。
   *
   * ```js
   * mmsxx.playFrames({ seconds: 3, leadIn: 1, holdEnd: 1, onEnd: 次へ });
   * ```
   * @param {{layer?:number, seconds?:number, fps?:number, loop?:boolean,
   *          leadIn?:number, holdEnd?:number, onEnd?:() => void}} opts
   *   seconds = 何秒ぶん流すか(省略すると溜まっているぶん全部)
   *   fps = 1 秒あたりのコマ数(既定 60 = 溜めたまま)
   *   leadIn = 流しはじめる前に、**最初のコマ**を出したまま待つ秒数
   *   holdEnd = 流し終わったあと、**最後のコマ**を出したまま待つ秒数
   * @returns {boolean} 始められたか
   */
  playFrames(opts = {}) {
    const have = this.vdp.frameCount;
    if (!have) return false;
    const fps = Math.max(1, Math.min(60, Math.round(opts.fps || 60)));
    const want = opts.seconds ? Math.round(opts.seconds * 60) : have;
    this._replay = {
      layer: (opts.layer == null) ? null : opts.layer,
      // いちばん古いところから始めて、新しいほうへ進む
      back: Math.min(have, want) - 1,
      step: Math.max(1, Math.round(60 / fps)),
      hold: Math.max(1, Math.round(60 / fps)),   // 1 コマを何フレーム出すか
      wait: 0,
      loop: !!opts.loop,
      first: Math.min(have, want) - 1,
      // 前後の間(コマ数)。くり返し再生のときは置かない
      lead: opts.loop ? 0 : Math.max(0, Math.round((opts.leadIn || 0) * 60)),
      tail: opts.loop ? 0 : Math.max(0, Math.round((opts.holdEnd || 0) * 60)),
      end: 0,          // 後ろの間。数え終わったら onEnd
      onEnd: opts.onEnd || null,
    };
    this.holdCapture(true);   // 再生中は溜めない(自分の絵を溜め直さない)
    return true;
  }

  /** 再生をやめる(レイヤーへ写していたときは、消すのは呼んだ側) */
  stopFrames() {
    if (!this._replay) return;
    this._replay = null;
    this.vdp.showFrame(null);
    this.holdCapture(false);
  }

  /** いま再生中か */
  get replaying() { return !!this._replay; }

  /**
   * **スプライトをまとめて隠す / 戻す**。
   * リプレイのように「溜めた絵だけ」を見せたいときに使う
   * (1 枚ずつ visible を触らなくてよい)。
   * @param {boolean} on
   */
  hideSprites(on) { this.vdp.spritesHidden = !!on; }

  /**
   * **1 行に出せるスプライトの数**(0 で無制限、既定は 0)。
   *
   * 実機の VDP は 1 走査線に決まった枚数しか出せず、あふれたぶんは
   * **その行だけ**消える(MSX1 = 4 枚 / MSX2 = 8 枚)。消えるのは優先度の低いほう。
   *
   * ```js
   * mmsxx.spriteLimit = 4;     // MSX1 実機なみ
   * mmsxx.spriteRotate = true; // 同じ優先度のものはコマごとに順番を回す
   * ```
   *
   * 数えるのは**そのコマに実際に出ているものだけ**。`visible` が false のもの、
   * `blink` で消えているコマのものは席を取らない。
   * **BG スプライトは数に入れない**(ちらつかせない)。
   *
   * `blink` は狙ってやる点滅演出、こちらは実機の混みぐあいの再現、
   * という別々のもの。両方いっしょに使ってよい
   */
  get spriteLimit() { return this.vdp.spriteLimit; }

  set spriteLimit(n) { this.vdp.spriteLimit = Math.max(0, n | 0); }

  /**
   * **画面ぜんぶで出せるスプライトの数**(0 で無制限、既定は 0)。
   * 実機は置ける枚数そのものが決まっている(MSX は 32 枚)。
   *
   * ```js
   * mmsxx.spriteMax = 32;      // 画面に 32 枚まで
   * mmsxx.spriteRotate = true; // あふれたぶんは順ぐりに入れ替わる
   * ```
   *
   * あふれたものは**まるごと出ない**(1 行の制限と違い、行単位ではない)。
   * `rank` が 'always' のものはあぶれない。両方の制限はいっしょに使える
   */
  get spriteMax() { return this.vdp.spriteMax; }

  set spriteMax(n) { this.vdp.spriteMax = Math.max(0, n | 0); }

  /**
   * **同じ強さのものの順番をコマごとに回す**(いつも同じものが消えないように)。
   * 回しかたを選べる。
   *
   *   'step'   … 1 コマに 1 つずつ。公平だが、消える場所が**流れて見える**
   *   'stride' … 何個か飛ばしてずらす。公平さは同じで、流れて見えない
   *   'random' … コマごとに散らす。運が悪いと同じものが続けて消える
   *   'slow'   … 'step' を数コマに 1 回だけ動かす(穏やか)
   *
   * `true` は 'step' と同じ。`false` で回さない
   * @type {boolean|'step'|'stride'|'random'|'slow'}
   */
  get spriteRotate() { return this.vdp.spriteRotate; }

  set spriteRotate(v) { this.vdp.spriteRotate = (typeof v === 'string') ? v : !!v; }

  /** 回しかた 'slow' のとき、何コマに 1 回動かすか(既定 4) */
  get spriteRotateHold() { return this.vdp.spriteRotateHold; }

  set spriteRotateHold(n) { this.vdp.spriteRotateHold = Math.max(1, n | 0); }

  /**
   * **いまの画面を録画しはじめる**。canvas の中身をそのまま録る。
   *
   * 画面に映っているものではなく**キャンバスの中身**を録るので、
   * ウィンドウが隠れていても、別のタブが手前にあっても録れる。
   * 逆に、canvas に描いた文字は**そのまま動画にも入る**。
   * 入れたくない案内は DOM に出すこと。
   *
   * ```js
   * mmsxx.startRecord();                 // 録りはじめ
   * const blob = await mmsxx.stopRecord();  // 止めて受け取る(既定は mp4)
   * ```
   * @param {{sound?:boolean, fps?:number, type?:'mp4'|'webm', scale?:number}} [opts]
   *   sound = 音も入れるか(既定 true)。**ミュートの手前**から拾うので、
   *   音を切って遊んでいても動画には入る。
   *   type = 入れもの(既定 'mp4')。**mp4 はどこでも再生できる**が、
   *   作れない環境もあるので、その場合は webm に落ちる。
   *   border = 動画のまわりに残すボーダーの太さ(省略すると画面と同じ)。
   *   **画面のボーダーとは別に決められる**(画面は太いまま、動画は細く)。
   *   aspect = 縦横比('16:9' や 16/9)。足りないぶんは**黒で埋める**。
   *   どちらも画面には出ないので、遊んでいる人には見えない。
   *   scale = 何倍の大きさで録るか(既定 1、8 まで)。
   *   **1 ドットを四角に置き換えるだけ**なので、広げても角が立ったまま残る。
   *   等倍で録るとプレイヤー側が引き伸ばすときに色を混ぜてぼやける。
   *   bitrate = 絵に使う 1 秒あたりのビット数(既定 BITRATE.mid = 400000)。
   *   **小さくするほど軽くなる**が、動きの多いところがにじむ。
   *   数字のほか `BITRATE.low` や `'low'` のような名前でも渡せる
   *   (low / mid / high / max / auto)。0 か 'auto' でブラウザ任せ。
   *   soundBitrate = 音のほう(省略時はブラウザ任せ。64000 くらいで足りる)
   * @returns {boolean} 始められたか(使えない環境では false)
   */
  startRecord(opts = {}) {
    if (this._rec || typeof MediaRecorder === 'undefined') return false;
    const canvas = this.vdp.canvas;
    if (!canvas || !canvas.captureStream) return false;
    const fps = Math.max(1, Math.min(60, Math.round(opts.fps || 60)));
    // 大きく録るとき、**画面と違う枠**で録るときは、写し取り用の板を別に持つ。
    // **色を混ぜない**設定で毎コマ写すので、ドットの角が溶けない
    const scale = Math.max(1, Math.min(8, Math.round(opts.scale || 1)));
    // 枠の付け替え。画面のボーダーは太いまま、動画だけ細く(または比率に合わせて
    // 黒を足して)録れる。**画面には出ない**ので、遊んでいる人には見えない
    const border = (opts.border == null) ? null : Math.max(0, Math.round(opts.border));
    const aspect = ASPECTS[opts.aspect] || (opts.aspect > 0 ? opts.aspect : 0);
    const reframe = (border != null && border !== this.vdp.borderX) || aspect > 0;
    let from = canvas;
    if (scale > 1 || reframe) {
      this._recBig = { border, aspect, scale, canvas: null, ctx: null };
      from = this._blitRecord();   // 1 コマ目を入れておく(まっさらな板から始めない)
      if (!from) { this._recBig = null; return false; }
    }
    let stream;
    try { stream = from.captureStream(fps); }
    catch (e) { this._recBig = null; return false; }
    // 音は出口の手前(bus)から分けてもらう
    if (opts.sound !== false && this.audio.ctx) {
      try {
        const dest = this.audio.ctx.createMediaStreamDestination();
        this.audio.recordTo(dest);
        for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
        this._recDest = dest;
      } catch (e) { /* 音なしで続ける */ }
    }
    // 作れる形を上から順に試す(環境によって作れるものが違う)。
    // **mp4 が既定**。どこでも再生できるので、人に渡すならこちら。
    // 作れない環境(Firefox など)では webm に落ちる
    const MP4 = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'];
    const WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const types = (opts.type === 'webm') ? WEBM.concat(MP4) : MP4.concat(WEBM);
    const ok = (t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t);
    const type = types.find(ok);
    // 重さの指定。渡さなければブラウザの見立てに任せる
    const conf = {};
    if (type) conf.mimeType = type;
    const bitrate = this._bitrate(opts.bitrate);
    if (bitrate) conf.videoBitsPerSecond = Math.round(bitrate);
    if (opts.soundBitrate) conf.audioBitsPerSecond = Math.round(opts.soundBitrate);
    let rec;
    try { rec = new MediaRecorder(stream, conf); }
    catch (e) { this._recBig = null; return false; }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    this._rec = { rec, chunks, type: type || 'video/webm' };
    /** できたものの入れもの('mp4' か 'webm') */
    this.recordKind = (type || '').startsWith('video/mp4') ? 'mp4' : 'webm';
    /** できたものの大きさ(ドット数) */
    this.recordSize = { width: from.width, height: from.height };
    rec.start();
    return true;
  }

  /**
   * 録画を止めて、できたものを受け取る。
   * @returns {Promise<Blob|null>} 録れていなければ null
   */
  stopRecord() {
    const r = this._rec;
    if (!r) return Promise.resolve(null);
    this._rec = null;
    return new Promise((done) => {
      r.rec.onstop = () => {
        if (this._recDest) { this.audio.recordTo(null); this._recDest = null; }
        this._recBig = null;
        done(r.chunks.length ? new Blob(r.chunks, { type: r.type }) : null);
      };
      try { r.rec.stop(); } catch (e) { done(null); }
    });
  }

  /**
   * 重さの指定を数に直す。名前('low' など)でも数でも受ける。
   * 綴りを間違えたときに黙って別の値で録ってしまわないよう、知らない名前は止める
   */
  _bitrate(v) {
    if (v === undefined) return BITRATE.mid;
    if (typeof v !== 'string') return v;
    const n = BITRATE[v];
    if (n === undefined) {
      throw new Error(`bitrate: 知らない名前 '${v}'(${Object.keys(BITRATE).join(' / ')})`);
    }
    return n;
  }

  /** いま録画中か */
  get recording() { return !!this._rec; }

  /**
   * 録画用の板へ、いまの画面を写し取る(描いた直後に呼ばれる)。
   * 枠の付け替えが要らないときは canvas をそのまま広げるだけ
   */
  _blitRecord() {
    const b = this._recBig;
    if (!b) return null;
    if (b.border != null || b.aspect > 0) {
      // 枠を付け替える(描画領域だけを切り出して、まわりを塗り直す)
      b.canvas = this.vdp.reframed(b.scale, b.border, b.aspect, b.canvas);
      return b.canvas;
    }
    if (!b.canvas) {
      b.canvas = document.createElement('canvas');
      b.canvas.width = this.vdp.canvas.width * b.scale;
      b.canvas.height = this.vdp.canvas.height * b.scale;
      b.ctx = b.canvas.getContext('2d');
      b.ctx.imageSmoothingEnabled = false;
    }
    b.ctx.drawImage(this.vdp.canvas, 0, 0, b.canvas.width, b.canvas.height);
    return b.canvas;
  }

  /** 再生を 1 コマ進める(run のなかで呼ばれる) */
  _tickReplay() {
    const r = this._replay;
    if (!r) return;
    if (r.wait > 0) { r.wait--; return; }
    // 最後のコマで止めているところ(出したまま数えるだけ)
    if (r.end > 0) {
      r.end--;
      if (r.end === 0) { const done = r.onEnd; this.stopFrames(); if (done) done(); }
      return;
    }
    const atFirst = (r.back === r.first);
    let ok;
    if (r.layer == null) {
      const idx = this.vdp.frameBack(r.back);
      this.vdp.showFrame(idx);
      ok = !!idx;
    } else {
      ok = this.vdp.frameToLayer(r.layer, r.back);
    }
    if (!ok) { this.stopFrames(); return; }
    // 1 コマ目だけは長めに出す(これから巻き戻すと分かるように)
    r.wait = (atFirst && r.lead) ? r.lead : r.hold - 1;
    r.back -= r.step;
    if (r.back < 0) {
      if (r.loop) { r.back = r.first; return; }
      // 最後のコマは出したまま残す。数え終わってから次へ
      if (r.tail) { r.end = r.tail; return; }
      const done = r.onEnd;
      this.stopFrames();
      if (done) done();
    }
  }

  /**
   * **溜めるのをいったん止める / 再開する**(溜めたものは捨てない)。
   * 絵と音の両方に効く。**ポーズ中は必ず止めること**。
   * 止めないと、輪っかが「止まった画面」と「無音」で埋まってしまい、
   * せっかくの直前の数秒が消える。
   * @param {boolean} on true で止める
   */
  holdCapture(on) { this.vdp.holdFrames(on); this.audio.holdSound(on); }

  /**
   * **何秒前の画面**を取り出す。持っているなかでいちばん近いコマを返す。
   * 溜めていない・足りないときは null。
   * @param {number} secondsAgo 何秒前か
   * @param {number} [scale=1] 何倍に広げるか(ドットはぼかさない)
   */
  frameAgo(secondsAgo, scale = 1) {
    const back = Math.max(0, Math.round(secondsAgo * 60));
    const len = this.vdp.frameCount;
    if (!len) return null;
    // 足りなければ、持っているなかでいちばん古いものを返す
    return this.vdp.frameCanvas(Math.min(back, len - 1), scale);
  }

  /**
   * 溜めたコマを番号で取り出す(0 = いちばん新しい)。再生に使う。
   * @param {number} back @param {number} [scale=1]
   */
  frameBackCanvas(back, scale = 1) { return this.vdp.frameCanvas(back, scale); }

  /** いまの画面を画像ファイルとして保存する(原寸) */
  download(filename = 'screenshot.png', opts) {
    const url = this.vdp.capture(opts);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    return filename;
  }

  /**
   * 開発版のビルドかどうか。**細かい出し分けはこれを見て決める**。
   * 既定は「手元で開いているか(isLocal)」だが、
   * `new MMSXXEngine(canvas, { dev: false })` のように**ビルドで固定できる**。
   * こうしておくと、本番のビルドを手元のサーバで開いても開発機能は出てこないし、
   * 開発版をスマホへ持っていっても開発機能が使える。
   */
  get dev() { return this._dev; }

  /**
   * コンソールから触れる関数を登録する。
   * **開発版のときだけ window に付く**。本番のビルドでは登録しないので、
   * `mmsxxDebug` などの名前そのものが存在しなくなる。
   *
   * 関数を作る手間も惜しいときは、**関数を返す関数**を渡せばよい。
   * 本番では中身が呼ばれないので、関数そのものが作られない。
   *
   * ```js
   * mmsxx.expose('gameDebug', () => ({ stage, score }));       // そのまま
   * mmsxx.expose({ gameBoss: (n) => warp(n), gameKill: kill }); // まとめて
   * mmsxx.expose('gameHeavy', () => () => 重い準備がいる関数);   // 遅らせる
   * ```
   * @param {string|Object<string,Function>} name 名前 or 名前と関数の表
   * @param {Function} [fn] name が文字列のときの中身
   * @param {{lazy?:boolean}} [opts] lazy:true なら fn() を呼んだ結果を登録する
   * @returns {boolean} 登録したか(本番では false)
   */
  expose(name, fn, opts = {}) {
    if (!this._dev || typeof window === 'undefined') return false;
    const put = (k, v) => {
      window[k] = opts.lazy ? v() : v;
      this._exposed.push(k);
    };
    if (typeof name === 'object') {
      for (const k of Object.keys(name)) put(k, name[k]);
    } else {
      put(name, fn);
    }
    return true;
  }

  /** expose した名前を全部 window から外す(消し忘れの確認用) */
  unexposeAll() {
    for (const k of this._exposed) { try { delete window[k]; } catch (e) { window[k] = undefined; } }
    const n = this._exposed.length;
    this._exposed = [];
    return n;
  }

  /** expose してある名前の一覧 */
  get exposed() { return [...this._exposed]; }

  /**
   * 手元の開発中かどうか(localhost / file: で開いているか)。
   * ビルドで決め打ちしたいときは dev を使う。
   */
  get isLocal() { return MMSXXEngine.isLocal; }
  static get isLocal() {
    if (typeof location === 'undefined') return true;   // ブラウザ以外(テスト等)
    if (location.protocol === 'file:') return true;
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
  }

  /** レイヤーハンドルを取得 (0 が奥、数字が大きいほど手前) */
  layer(i) { return this._layers[i]; }

  /**
   * **色合い(パレットの流派)を切り替える**。
   *
   * TMS9918A はアンテナ出力だったので「本当の色」が 1 つに決まらず、
   * 資料や実機の測り方でいくつもの流派がある。
   * 絵は色番号で持っているので、切り替えても描き直しは要らない。
   *
   * - `'tms9918'`  いままでの色(既定。落ち着いた中間色寄り)
   * - `'tms9918a'` TI の資料から起こした色(明るく、緑が強い)
   * - `'v9938'`    MSX2 以降が出す MSX1 の色(原色がはっきり)
   * @param {string} name
   */
  setPalette(name) { return this.vdp.setPalette(name); }
  /** いまの色合いの名前 */
  get palette() { return this.vdp.palette; }
  /** 選べる色合いの名前(切り替えの順番) */
  get paletteNames() { return this.vdp.paletteNames; }
  /** 画面に出すときの名乗り(省略すると、いまの色合いのもの) */
  paletteLabel(name) { return this.vdp.paletteLabel(name); }
  /** どの機械の色か('msx1' / 'msx2')。省略すると、いまの色合いのもの */
  paletteFamily(name) { return this.vdp.paletteFamily(name); }

  /** 背景色(パレット番号 1..15)。全レイヤー透明の場所に見える色 */
  get backdrop() { return this.vdp.backdrop; }
  set backdrop(c) { this.vdp.backdrop = c; }

  /**
   * **スプライトに使う絵を作る**。RGBA を渡すと、15 色へ寄せてから
   * 宣言した色数まで減らした `SpriteSymbol` が返る。
   * 決まりの検査はここだけで走る(`sprite()` の側では調べない)。
   * @param {*} image RGBA の絵 @param {{name?:string,colors?:number}} [opts]
   */
  spriteSymbol(image, opts) { return this.vdp.spriteSymbol(image, opts); }

  /**
   * **BG に使う絵を作る**。RGBA を渡すと、横 8 ドット 2 色へ均した
   * `BgSymbol` が返る。レイヤーにも BG スプライトにも使える
   * (BG スプライトにするなら、大きさが 8 の倍数であること)。
   * @param {*} image RGBA の絵 @param {{name?:string}} [opts]
   */
  bgSymbol(image, opts) { return this.vdp.bgSymbol(image, opts); }

  /**
   * **作った絵の一覧**(開発版だけ中身がある)。
   * 登録した絵も、色替え・走査線・反転で派生した絵も、作った順に並ぶ。
   * 素材の書き出し(engine/util/artexport.js)に渡して使う。
   */
  symbols() { return this.vdp.symbols(); }

  /**
   * **自前で派生させた絵を控えに足す**(開発用)。
   * ゲーム側で `sym.derive()` を使って色違いなどを作ったときに通しておくと、
   * `symbols()` の一覧と素材の書き出しに出てくる。
   * 公開版では何もしない。渡した絵をそのまま返すので、そのまま包める。
   *
   * ```js
   * return mmsxx.trackSymbol(img.derive(pixels, name));
   * ```
   */
  trackSymbol(sym, from) { return this.vdp._track(sym, sym.backdrop == null ? 'sprite' : 'bg', from || sym); }

  /**
   * スプライトを生成(枚数・横並び制限なし)。opts は convert() と同じ。
   * 生成したスプライトは flipX / flipY / rotate(0,90,180,270) を持ち、
   * 1 枚の絵から向き違いを作れる(BG スプライトは 90/270 度は無視される)。
   */
  sprite(image, opts) { return this.vdp.createSprite(image, opts); }

  /** スプライトを削除 */
  removeSprite(sprite) { this.vdp.removeSprite(sprite); }

  /**
   * BG スプライトを生成。通常スプライトより奥(レイヤーより手前)に描かれ、
   * 位置は 8 ドット単位に丸められる。大きさ・枚数に制限はない。
   * opts に `{ bgCheck: 'off' }` を渡すと、この絵だけ「横 8 ドット 2 色」の
   * 検査を見逃す(わざと破って、上にスプライトを重ねて隠す使い方のため)。
   */
  bgSprite(image, opts) { return this.vdp.createBgSprite(image, opts); }

  /** BG スプライトを削除 */
  removeBgSprite(sprite) { this.vdp.removeBgSprite(sprite); }

  /**
   * BG の絵が「横 8 ドット 2 色(背景色込み)」を守れているかの検査のしかた。
   * BG スプライトを作ったとき・レイヤーへ描く絵を変換したときに、
   * **その絵につき 1 度だけ**走る(毎フレーム描いても手数は増えない)。
   *
   * - `'throw'` 例外を投げる(**開発版の既定**。取りこぼさないため)
   * - `'warn'` console に出して、そのまま動かす(**公開版の既定**。
   *   絵が間違っていても、遊ぶ人の前では止めない)
   * - `'off'` 調べない
   *
   * 絵 1 枚だけ見逃したいときは、`bgSprite` / `layer.draw` の opts に
   * `{ bgCheck: 'off' }` を渡す。
   * @type {'warn'|'throw'|'off'}
   */
  get bgCheck() { return this.vdp.bgCheck; }
  set bgCheck(v) { this.vdp.bgCheck = v; }

  /** 見つかった違反の記録(まとめて見たいとき) */
  get bgWarnings() { return this.vdp.bgWarnings; }

  /**
   * レイヤー 1 枚をまるごと検査する。裏画面(既定 1024x1024)を全部見るので重い。
   * 自動では走らないので、確かめたいときだけ呼ぶ。
   * @param {number} layerIndex
   * @returns {{runs:number, worst:number, samples:string[]}}
   */
  checkLayer(layerIndex) { return this.vdp.checkLayer(layerIndex); }

  /**
   * base64 RGBA からエンジンに渡せる画像オブジェクトを作る(makedata の出力用)。
   * @returns {{data:Uint8Array,width:number,height:number}}
   */
  static imageFromBase64(b64, width, height) {
    const bin = atob(b64);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { data, width, height };
  }

  /**
   * メインループを開始する。update は毎秒 `fps` 回(既定 60)呼ばれる。
   * @param {(mmsxx: MMSXXEngine) => void} update
   */
  run(update) {
    this._running = true;
    this._update = update;
    // **画面が無いときは回さない。** 進めるのは advance() の仕事。
    // ここで rAF を呼ぶと、窓の無いところでその場で落ちる
    if (this.vdp.headless) return;
    let last = performance.now();
    let acc = 0;
    const tick = (now) => {
      if (!this._running) return;
      // 1 コマの長さは**毎回見る**。遊んでいる最中に fps を変えられるうえ、
      // 混んでいるときは処理落ちさせられる
      const over = this.slowAt > 0 ? (this.vdp.shownSprites - this.slowAt) : 0;
      this.slow = over > 0;
      let STEP = 1000 / this.fps;
      if (over > 0 && this.slowMode !== 'soft') STEP = 1000 / this.slowFps;
      acc += Math.min(now - last, 100); // タブ復帰時の暴走防止
      last = now;
      if (over > 0 && this.slowMode === 'soft') {
        // **混みぐあいのぶんだけ借りを溜めて、1 になったら 1 コマ落とす**。
        // 落とすぶんは**溜めた時間ごと捨てる**(あとで取り返すと、
        // 詰まっただけで遅くならない)。
        // 少し超えただけなら たまにつっかえるだけ、混むほど回数が増える。
        //
        // **続けて 2 回は落とさない。** 落とし続けると画面が止まってしまうので、
        // いくら混んでも半分の速さで止まる(いちばん重いときは 'hard' と同じ)
        this._slowDebt = Math.min(2, this._slowDebt + over * this.slowSoft);
        if (this._slowDebt >= 1 && !this._slowSkip) {
          this._slowDebt -= 1;
          this._slowSkip = true;
          acc = Math.max(0, acc - STEP);
        } else {
          this._slowSkip = false;
        }
      } else if (over <= 0) {
        this._slowDebt = 0;
        this._slowSkip = false;
      }
      let steps = 0;
      while (acc >= STEP && steps < 4) {
        // リプレイ中は、ゲームより先に 1 コマ進める
        // (ゲーム側がそのレイヤーへ描いても、上書きされないように)
        if (this._replay) this._tickReplay();
        update(this);
        this.input.endFrame();
        this.frame++;
        acc -= STEP;
        steps++;
      }
      if (steps === 4) acc = 0;
      this.vdp.render();
      if (this._recBig) this._blitRecord();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** メインループを停止する */
  stop() { this._running = false; }

  /** **画面を持たないか**(canvas を渡さずに作ったとき)。試験のための道 */
  get headless() { return this.vdp.headless; }

  /**
   * **画面なしで n コマ進める**(試験用)。
   *
   *   const mmsxx = new MMSXXEngine(null);   // 画面を持たない
   *   mmsxx.run(update);                     // 回さずに update を覚えるだけ
   *   mmsxx.advance(10000);                  // 1 万コマ回す
   *
   * `step()` との違いは**描かないこと**と、**時間を見ないこと**。
   * コマ落ちも rAF も関わらないので、**同じ入力から必ず同じ結果**になる
   * (乱数は種つき、時計は見ない)。回帰試験はこれを土台にする。
   *
   * **入力はこちらで入れる。** 窓が無いところではキーが飛んでこないので、
   * `mmsxx.input.press('ArrowRight')` のように直に入れてから進める
   * @param {number} [n=1] 進めるコマ数
   * @param {(m:MMSXXEngine, i:number)=>void} [before] 1 コマごと、進める前に呼ぶ
   */
  advance(n = 1, before) {
    for (let i = 0; i < n; i++) {
      if (before) before(this, i);
      if (this._replay) this._tickReplay();
      if (this._update) this._update(this);
      this.input.endFrame();
      this.frame++;
    }
    return this.frame;
  }

  /** デバッグ用: 手動で n フレームぶん進めて描画する */
  step(n = 1) {
    for (let i = 0; i < n; i++) {
      if (this._update) this._update(this);
      this.input.endFrame();
      this.frame++;
    }
    this.vdp.render();
    if (this._recBig) this._blitRecord();
  }
}
