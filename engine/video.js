import { VDP_PALETTE, convertRGBA, convertRGBAFlat, hashRGBA } from './palette.js';
import { getGlyph } from './font.js';

// 表示画面の既定サイズ。実機の SCREEN2 と同じ 256x192。
// 実際の大きさは VDP ごとに 8 ドット単位で変えられる(setScreenSize)。
export const SCREEN_W = 256;
export const SCREEN_H = 192;
// 表示画面として許す大きさ(8 の倍数)
const MIN_SCREEN = 64, MAX_SCREEN = 512;
// ボーダー(描画領域の外の遊び)の上限。左右・上下それぞれの厚み。
// ここは文字の升目とは関係ない余白なので、8 の倍数でなくてよい
const MAX_BORDER = 64;

/** ボーダーの厚みとして使える値か調べて返す(0〜MAX_BORDER の整数) */
function checkBorder(v, name) {
  if (!Number.isInteger(v) || v < 0 || v > MAX_BORDER) {
    throw new Error(`${name} は 0〜${MAX_BORDER} の整数で指定してください (指定値: ${v})`);
  }
  return v;
}
// 画面全体のずらし量。実機の SET ADJUST と同じ範囲
export const ADJUST_MIN = -15, ADJUST_MAX = 16;

/** 8 の倍数かどうか調べて返す */
function check8(v, name, min, max) {
  if (!Number.isInteger(v) || v % 8 !== 0 || v < min || v > max) {
    throw new Error(`${name} は ${min}〜${max} の 8 の倍数で指定してください (指定値: ${v})`);
  }
  return v;
}
/** 仮想画面(裏画面)の既定サイズ。256〜2048 の 2 の冪から選べる */
export const VIRTUAL_W = 1024;
export const VIRTUAL_H = 1024;
const MIN_VIRTUAL = 256, MAX_VIRTUAL = 2048;

/** 仮想画面サイズとして使える値かどうか検査する(2 の冪であることを利用してラップする) */
function checkVirtualSize(v, name) {
  if (!Number.isInteger(v) || v < MIN_VIRTUAL || v > MAX_VIRTUAL || (v & (v - 1)) !== 0) {
    throw new Error(`${name} は ${MIN_VIRTUAL}〜${MAX_VIRTUAL} の 2 の冪で指定してください (指定値: ${v})`);
  }
  return v;
}

/** パレット番号 c を、a と b のうち色が近い方に寄せる(透明 0 は黒 1 として扱う) */
function nearerColor(c, a, b) {
  const p = VDP_PALETTE[c === 0 ? 1 : c];
  const pa = VDP_PALETTE[a === 0 ? 1 : a];
  const pb = VDP_PALETTE[b === 0 ? 1 : b];
  const d = (q) => 3 * (p[0] - q[0]) ** 2 + 6 * (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  return d(pa) <= d(pb) ? a : b;
}

/** BG の座標は 8 ドット単位に丸める(負の値でも下方向に丸める) */
const snap8 = v => Math.floor(Math.round(v) / 8) * 8;
/** 幅・高さは 8 の倍数に切り上げる */
const ceil8 = v => Math.ceil(Math.round(v) / 8) * 8;

/** 画面上に置くスプライト。VDP.createSprite() で生成する。 */
export class Sprite {
  /** @param {{width:number,height:number,pixels:Uint8Array}} image */
  constructor(image) {
    this.image = image;
    this.x = 0;
    this.y = 0;
    this.visible = true;
    /** 大きいほど手前に描画される */
    this.priority = 0;
    /** 左右反転 */
    this.flipX = false;
    /** 上下反転 */
    this.flipY = false;
    /** 回転(0 / 90 / 180 / 270 度。時計回り) */
    this.rotate = 0;
    /**
     * 何フレームに 1 回表示するか。1 = 毎フレーム(既定)。
     * 2 なら 2 フレームに 1 回だけ出る(実機のスプライト多重表示のちらつき)。
     */
    this.blink = 1;
    /**
     * ちらつきで「続けて何コマ出すか」。既定 1。
     * blink = 4, blinkOn = 2 なら 2 コマ出て 2 コマ消える(2:2)。
     * blink = 2, blinkOn = 1 なら 1 コマずつ(1:1)。
     */
    this.blinkOn = 1;
    /**
     * ちらつきの位相。
     * null(既定) だと**エンジンが自動でずらす**ので、同じ blink を持つものが
     * いっせいに消えず、「少ない枚数を回している」ような見え方になる。
     * 数字を入れると明示的に決まる(0 をそろえて入れれば位相もそろう)。
     * @type {?number}
     */
    this.blinkPhase = null;
    /** 自動でずらすときに使う位相(生成順に割り振られる) */
    this._autoPhase = 0;
    /**
     * パラパラ動かすコマ。images を入れると image のかわりに順番に表示する。
     * 例: sp.frames = [a, b, c]; sp.frameRate = 6;  (6 フレームごとに次のコマ)
     * @type {?Array<{width:number,height:number,pixels:Uint8Array}>}
     */
    this.frames = null;
    /** コマを 1 つ進めるのにかけるフレーム数 */
    this.frameRate = 6;
    /** コマ送りの位相。同じ絵でもずらして動かせる */
    this.framePhase = 0;
    /** false にすると最後のコマで止まる(1 回だけのアニメ) */
    this.frameLoop = true;
    /**
     * 色の入れ替え表。{ 元の色: 新しい色 } のパレット番号で指定する。
     * 例: sp.colorMap = { 2: 7, 3: 5 };  (緑を水色にする)
     * 同じ絵から色違いを作れるので、色ごとに絵を定義しなくてよい。
     * null で入れ替えなし。
     * @type {?Object<number,number>}
     */
    this.colorMap = null;
    /**
     * 走査線。null = 入れない / 0 = 奇数行を抜く / 1 = 偶数行を抜く。
     * 毎コマ 0 と 1 を入れ替えると、抜ける行が交互に動く。
     * 抜いた絵は作り置きされるので、動かしても重くならない。
     */
    this.scanline = null;
  }
}

/**
 * 反転・回転を適用した絵を作る(結果はキャッシュされる)。
 * 90/270 度回転では幅と高さが入れ替わる。
 * @param {{width:number,height:number,pixels:Uint8Array}} img
 * @param {boolean} flipX @param {boolean} flipY @param {number} rot 0/90/180/270
 */
export function transformImage(img, flipX, flipY, rot) {
  const r = ((rot % 360) + 360) % 360;
  if (!flipX && !flipY && r === 0) return img;
  const swap = (r === 90 || r === 270);
  const w = img.width, h = img.height;
  const ow = swap ? h : w, oh = swap ? w : h;
  const out = new Uint8Array(ow * oh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = img.pixels[y * w + x];
      if (c === 0) continue;
      // 先に反転してから回す
      let sx = flipX ? w - 1 - x : x;
      let sy = flipY ? h - 1 - y : y;
      let dx, dy;
      if (r === 90) { dx = h - 1 - sy; dy = sx; }
      else if (r === 180) { dx = w - 1 - sx; dy = h - 1 - sy; }
      else if (r === 270) { dx = sy; dy = w - 1 - sx; }
      else { dx = sx; dy = sy; }
      out[dy * ow + dx] = c;
    }
  }
  return { width: ow, height: oh, pixels: out };
}

/**
 * MSX1 風の仮想 VDP。
 * - 表示画面 256x192。仮想画面(裏画面)のレイヤーを奥から順に合成する
 * - レイヤーの枚数に上限はなく、1 枚ごとに違う裏画面サイズを持てる
 *   (幅・高さは 256〜2048 の 2 の冪。既定 1024x1024)
 * - 各レイヤーは独立したスクロール位置を持ち、上下左右にリピート
 * - 色は MSX1 の 15 色 + 透明(0)。書き込みは常に SCREEN2 制約(横8ドット2色)に保たれる
 * - スプライトは枚数・横並び制限なし。レイヤーより手前に描画される
 */
export class VDP {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} scale 表示倍率(整数推奨)
   * @param {number} [virtualWidth=1024] 既定の裏画面の幅 (256〜2048 の 2 の冪)
   * @param {number} [virtualHeight=1024] 既定の裏画面の高さ (256〜2048 の 2 の冪)
   * @param {{width?:number,height?:number}[]} [layerSpecs]
   *   レイヤーごとの裏画面サイズ。配列の長さがレイヤー枚数になる(既定 4 枚)
   */
  constructor(canvas, scale = 3, virtualWidth = VIRTUAL_W, virtualHeight = VIRTUAL_H, layerSpecs, screen = {}) {
    // 既定の裏画面サイズ。2 の冪なので & でラップできる
    this.vw = checkVirtualSize(virtualWidth, 'virtualWidth');
    this.vh = checkVirtualSize(virtualHeight, 'virtualHeight');
    canvas.style.imageRendering = 'pixelated';
    this.canvas = canvas;
    this.scale = scale;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    /** 描画領域(実機の表示画面にあたる。8 ドット単位) */
    this.width = SCREEN_W;
    this.height = SCREEN_H;
    /** ボーダー(描画領域の外の遊び)の厚み。左右・上下それぞれ */
    this.borderX = 0;
    this.borderY = 0;
    /** 画面全体のずらし(実機の SET ADJUST 相当。-15..+16) */
    this.adjustX = 0;
    this.adjustY = 0;
    // 実描画は「描画領域そのままの大きさ」のオフスクリーンに行い、拡大転送する
    this.offscreen = document.createElement('canvas');
    this.offCtx = this.offscreen.getContext('2d');
    this._resize(screen.width ?? SCREEN_W, screen.height ?? SCREEN_H,
      screen.borderX ?? 0, screen.borderY ?? 0);

    // パレットを ABGR(リトルエンディアンの RGBA) 32bit 値に前計算
    this.pal32 = new Uint32Array(16);
    for (let i = 1; i <= 15; i++) {
      const [r, g, b] = VDP_PALETTE[i];
      this.pal32[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }

    /** 背景色(パレット番号 1..15)。全レイヤーが透明の場所に見える色 */
    this.backdrop = 1;

    // レイヤーは枚数無制限。1 枚ごとに裏画面サイズを持てる
    const specs = layerSpecs && layerSpecs.length ? layerSpecs : [{}, {}, {}, {}];
    this.layers = specs.map((spec, i) => {
      const w = checkVirtualSize(spec.width ?? this.vw, `layers[${i}].width`);
      const h = checkVirtualSize(spec.height ?? this.vh, `layers[${i}].height`);
      return {
        pixels: new Uint8Array(w * h),
        width: w,
        height: h,
        maskX: w - 1,
        maskY: h - 1,
        shift: Math.log2(w), // 行の先頭 = y << shift
        scrollX: 0,
        scrollY: 0,
        visible: true,
        // 0 = 滑らかスクロール / 8 などを入れると表示がその単位に量子化される
        // (MSX1 実機のキャラクタ単位スクロールの再現用)
        snap: 0,
        // 何も描かれていないレイヤーは合成をまるごと飛ばす(空の画面ぶんの無駄を省く)
        empty: true,
        // 走査線。null = 入れない / 0 か 1 = その位相の行を抜く。
        // 毎コマ 0 と 1 を入れ替えると、抜ける行が交互に動く
        scanline: null,
        // 画面の端で裏画面を繰り返すか。既定は繰り返す(流れる星空など)。
        // false にすると、はみ出した絵は反対側から出てこない
        repeatX: spec.repeatX !== false,
        repeatY: spec.repeatY !== false,
      };
    });

    /** @type {Set<Sprite>} */
    this.sprites = new Set();
    /** @type {Set<Sprite>} BG スプライト(8 ドット単位で動く、通常スプライトより奥) */
    this.bgSprites = new Set();

    // RGBA -> インデックス画像の変換キャッシュ
    this.convertCache = new Map();

    /**
     * BG に使う絵が「横 8 ドット 2 色(背景色込み)」を守れているかを、
     * **定義したときに自動で調べる**。BG スプライトを作ったとき・レイヤーへ描く絵を
     * 変換したときに 1 度だけ走るので、同じ絵を毎フレーム描いても手数は増えない。
     * レイヤー全体の検査は重いので自動ではやらない(checkLayer を自分で呼ぶ)。
     *
     * 'warn'(既定) 見つけたら console に出すだけで、そのまま動かす
     * 'throw'      見つけたら例外を投げる(作っている最中に取りこぼさない)
     * 'off'        調べない
     *
     * わざと破る絵もある(上にスプライトを重ねて隠すつもりの絵など)ので、
     * 描くとき・作るときに `{ bgCheck: 'off' }` を渡せば、その絵だけ見逃せる。
     * @type {'warn'|'throw'|'off'}
     */
    this.bgCheck = 'warn';
    /** 見つかった違反の記録(name と中身)。あとからまとめて見られるように残す */
    this.bgWarnings = [];
    /** 一度調べた絵(同じ絵を何度も調べない) */
    this._bgChecked = new WeakSet();
  }

  /**
   * BG 用の絵が「横 8 ドット 2 色」を守れているか調べる。
   * 透明(0)は BG では背景色(黒)になるので、黒(1)と同じものとして数える。
   * @param {{width:number,height:number,pixels:Uint8Array}} img 変換済みの絵
   * @returns {{runs:number, worst:number, samples:string[]}}
   *   runs = 3 色以上になっている 8 ドットの本数 / worst = 最大の色数
   */
  static inspectBgImage(img) {
    let runs = 0, worst = 0;
    const samples = [];
    const seen = new Set();
    for (let y = 0; y < img.height; y++) {
      for (let bx = 0; bx < img.width; bx += 8) {
        seen.clear();
        for (let i = 0; i < 8 && bx + i < img.width; i++) {
          const c = img.pixels[y * img.width + bx + i];
          seen.add(c === 0 ? 1 : c);   // 透明は黒として数える
        }
        if (seen.size > worst) worst = seen.size;
        if (seen.size <= 2) continue;
        runs++;
        if (samples.length < 3) samples.push(`(x=${bx},y=${y}) 色${[...seen].join(',')}`);
      }
    }
    return { runs, worst, samples };
  }

  /**
   * BG に使う絵を検査して、破っていたら知らせる(同じ絵は 1 度だけ)。
   * 直すのは素材側の仕事なので、ここでは絵に手を入れない。
   * @param {*} img 変換済みの絵
   * @param {string} where どこで見つけたか(BG スプライト / レイヤー描画)
   * @param {'warn'|'throw'|'off'} [mode] この 1 枚だけの指定(既定は this.bgCheck)
   */
  _checkBgImage(img, where, mode) {
    const how = mode || this.bgCheck;
    if (how === 'off' || !img || this._bgChecked.has(img)) return;
    this._bgChecked.add(img);
    const r = VDP.inspectBgImage(img);
    if (r.runs === 0) return;
    const msg = `[MMSXX] ${where}: 横8ドットに3色以上が ${r.runs} 本`
      + ` (最大 ${r.worst} 色) ${img.width}x${img.height} 例: ${r.samples.join(' / ')}`;
    this.bgWarnings.push({ where, ...r, width: img.width, height: img.height });
    if (how === 'throw') throw new Error(msg);
    console.warn(msg);
  }

  /**
   * レイヤー 1 枚をまるごと検査する(裏画面 1024x1024 ぶんを見るので重い)。
   * 自動では走らないので、確かめたいときだけ呼ぶ。
   * @param {number} layerIndex
   * @returns {{runs:number, worst:number, samples:string[]}}
   */
  checkLayer(layerIndex) {
    const L = this.layers[layerIndex];
    return VDP.inspectBgImage({ width: L.width, height: L.height, pixels: L.pixels });
  }

  /** 表示に出る全体の幅(描画領域 + 左右のボーダー) */
  get outWidth() { return this.width + this.borderX * 2; }
  /** 表示に出る全体の高さ(描画領域 + 上下のボーダー) */
  get outHeight() { return this.height + this.borderY * 2; }

  /**
   * 画面の大きさ・ボーダーを決め直して、描画用のバッファを作り直す。
   * 大きさを変えるのはまれなので、ここでまとめて作り直してしまう。
   */
  _resize(width, height, borderX, borderY) {
    this.width = check8(width, 'screen.width', MIN_SCREEN, MAX_SCREEN);
    this.height = check8(height, 'screen.height', MIN_SCREEN, MAX_SCREEN);
    this.borderX = checkBorder(borderX, 'screen.borderX');
    this.borderY = checkBorder(borderY, 'screen.borderY');
    const ow = this.outWidth, oh = this.outHeight;
    this.canvas.width = ow * this.scale;
    this.canvas.height = oh * this.scale;
    this.ctx.imageSmoothingEnabled = false;
    this.offscreen.width = ow;
    this.offscreen.height = oh;
    this.imageData = this.offCtx.createImageData(ow, oh);
    /** 画面に出るぶん全部(ボーダー込み) */
    this.frame32 = new Uint32Array(this.imageData.data.buffer);
    // 合成は描画領域の大きさで行い、最後にボーダーとずらしを付けて写す。
    // ボーダーもずらしも無いときは写す手間すら要らないので、同じものを指す
    this._plain = (this.borderX === 0 && this.borderY === 0);
    this.active32 = this._plain ? this.frame32 : new Uint32Array(this.width * this.height);
  }

  /**
   * 描画領域の大きさを変える(8 ドット単位)。
   * @param {number} width @param {number} height
   */
  setScreenSize(width, height) {
    this._resize(width, height, this.borderX, this.borderY);
  }

  /**
   * ボーダー(描画領域の外の遊び)の厚みを決める(1 ドット単位)。
   * ここには何も描かれず、いつも背景色で塗られる。
   * @param {number} x 左右それぞれの厚み @param {number} [y] 上下(省略で x と同じ)
   */
  setBorder(x, y = x) {
    this._resize(this.width, this.height, x, y);
  }

  /**
   * 画面全体を 1 ドット単位でずらす(実機の SET ADJUST 相当)。
   * ずらしたぶん反対側から回り込むことはなく、空いたところは背景色になる。
   * 画面をぶるっと揺らす演出に使う。
   * @param {number} x -15..+16 @param {number} y -15..+16
   */
  setAdjust(x, y) {
    const clamp = v => Math.max(ADJUST_MIN, Math.min(ADJUST_MAX, Math.round(v || 0)));
    this.adjustX = clamp(x);
    this.adjustY = clamp(y);
    // ずらしが入ったら、描画領域とは別のバッファが要る
    if (this._plain && (this.adjustX || this.adjustY)) {
      this._plain = false;
      this.active32 = new Uint32Array(this.width * this.height);
    }
  }

  /**
   * いまの画面を画像として取り出す。
   * 実描画そのものが等倍のオフスクリーンなので、等倍の取り出しがいちばん安い
   * (拡大した canvas から読むと、その倍率ぶんだけピクセルが増える)。
   * @param {{scale?:number, type?:'dataURL'|'blob'|'canvas', mime?:string}} [opts]
   * @returns {string|HTMLCanvasElement|Promise<Blob>}
   */
  capture(opts = {}) {
    const scale = Math.max(1, Math.round(opts.scale || 1));
    const mime = opts.mime || 'image/png';
    let src = this.offscreen;
    if (scale !== 1) {
      const c = document.createElement('canvas');
      c.width = this.outWidth * scale;
      c.height = this.outHeight * scale;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(this.offscreen, 0, 0, c.width, c.height);
      src = c;
    }
    if (opts.type === 'canvas') {
      if (src !== this.offscreen) return src;
      // オフスクリーンそのものを返すと次のフレームで上書きされるので、複製を渡す
      const c = document.createElement('canvas');
      c.width = this.outWidth; c.height = this.outHeight;
      c.getContext('2d').drawImage(this.offscreen, 0, 0);
      return c;
    }
    if (opts.type === 'blob') {
      return new Promise((resolve) => src.toBlob(resolve, mime));
    }
    return src.toDataURL(mime);
  }

  /**
   * RGBA画像を MSX 制約付きインデックス画像へ変換する(結果はキャッシュされる)。
   * @param {ImageData|{data:Uint8Array|Uint8ClampedArray,width:number,height:number}} src
   * @param {{colors?:number}} [opts]
   *   colors を指定すると「画像全体で N 色まで」の変換になる
   *   (MSX1 の単色スプライト=1, スプライト2枚重ね風=2)。
   *   省略時は SCREEN2 風「横8ドット2色」変換。
   * @returns {{width:number,height:number,pixels:Uint8Array}}
   */
  convert(src, opts) {
    const { data, width, height } = src;
    const colors = opts && opts.colors;
    const key = hashRGBA(data, width, height) + ':' + (colors || 's2');
    let img = this.convertCache.get(key);
    if (!img) {
      img = colors ? convertRGBAFlat(data, width, height, colors)
                   : convertRGBA(data, width, height);
      this.convertCache.set(key, img);
    }
    return img;
  }

  /** すでに変換済みのインデックス画像かどうか */
  static isConverted(img) {
    return img && img.pixels instanceof Uint8Array;
  }

  /**
   * レイヤーの仮想画面 (1024x1024) に画像を書き込む。座標はラップする。
   * @param {number} layerIndex 0..3
   * @param {number} x
   * @param {number} y
   * @param {*} src RGBA画像(自動変換) or 変換済み画像
   * @param {boolean} [transparent=true] false なら色0も書き込む(消去に使える)
   * @param {{flipX?:boolean, flipY?:boolean, rotate?:number,
   *          colorMap?:Object<number,number>}} [opts]
   *   colorMap は色番号の置き換え表(スプライトと同じ書き方)。
   *   1 枚の絵を色ちがいで描き分けられる。結果は絵ごとにキャッシュされるので、
   *   毎フレーム描き替えても作り直しは起きない。
   *   scanline は走査線。null = 入れない / 0 = 奇数行を抜く / 1 = 偶数行を抜く。
   *   こちらも抜いた絵をキャッシュするので、描く手数は変わらない。
   */
  drawToLayer(layerIndex, x, y, src, transparent = true, opts = {}) {
    let img = VDP.isConverted(src) ? src : this.convert(src);
    // 色の置き換えや走査線をかける**前の絵**を調べる(同じ絵は 1 度だけ)。
    // 置き換えは 1 対 1 なので、元が守れていれば後も守れている
    this._checkBgImage(img, 'BG パーツ', opts.bgCheck);
    if (opts.colorMap) img = this._recolored(img, opts.colorMap);
    if (opts.scanline != null) img = this._scanlined(img, opts.scanline);
    // BG は左右反転・上下反転・180 度回転だけ使える
    // (90/270 度は横8ドット2色の決まりが崩れるので対応しない)
    if (opts.flipX || opts.flipY || opts.rotate) {
      const rot = (opts.rotate === 180) ? 180 : 0;
      img = this._transformed(img, !!opts.flipX, !!opts.flipY, rot);
    }
    const L = this.layers[layerIndex];
    const layer = L.pixels;
    // BG は 8 ドット単位でしか置けない(実機のキャラクタ単位に合わせる)
    x = snap8(x); y = snap8(y);
    for (let iy = 0; iy < img.height; iy++) {
      const dy = (y + iy) & L.maskY;
      const rowBase = dy << L.shift;
      const srcBase = iy * img.width;
      for (let ix = 0; ix < img.width; ix++) {
        const c = img.pixels[srcBase + ix];
        if (transparent && c === 0) continue;
        layer[rowBase | ((x + ix) & L.maskX)] = c;
      }
    }
    L.empty = false;
    this._blackenCells(L, x, y, img.width, img.height);
    this._enforceRuns(L, x, y, img.width, img.height);
  }

  /**
   * レイヤーの 8x8 セル(レイヤー原点基準のグリッド)を走査し、色2以上の
   * パターンを含むセルの透明(0)を黒(1)にする。
   * 「キャラパターンのあるセルは不透明」という MSX1 実機 BG の見え方の再現。
   * 指定矩形にかかるセルだけを処理する。
   */
  _blackenCells(L, x, y, w, h) {
    const layer = L.pixels;
    const cx0 = Math.floor(x / 8) * 8;
    const cy0 = Math.floor(y / 8) * 8;
    for (let cy = cy0; cy < y + h; cy += 8) {
      for (let cx = cx0; cx < x + w; cx += 8) {
        let hasPattern = false;
        for (let iy = 0; iy < 8 && !hasPattern; iy++) {
          const rowBase = ((cy + iy) & L.maskY) << L.shift;
          for (let ix = 0; ix < 8; ix++) {
            if (layer[rowBase | ((cx + ix) & L.maskX)] >= 2) { hasPattern = true; break; }
          }
        }
        if (!hasPattern) continue;
        for (let iy = 0; iy < 8; iy++) {
          const rowBase = ((cy + iy) & L.maskY) << L.shift;
          for (let ix = 0; ix < 8; ix++) {
            const idx = rowBase | ((cx + ix) & L.maskX);
            if (layer[idx] === 0) layer[idx] = 1;
          }
        }
      }
    }
  }

  /**
   * 横 8 ドット(レイヤー原点基準)ごとに色が 2 色までになるよう均す。
   * 絵を重ねて描くと 3 色以上になってしまうので、書き込みのたびに実機と同じ
   * 制約へ戻す。多い方から 2 色を残し、それ以外は近い方の色に寄せる。
   */
  _enforceRuns(L, x, y, w, h) {
    const layer = L.pixels;
    const count = new Uint32Array(16);
    const rx0 = Math.floor(x / 8) * 8;
    for (let iy = 0; iy < h; iy++) {
      const rowBase = ((y + iy) & L.maskY) << L.shift;
      for (let rx = rx0; rx < x + w; rx += 8) {
        count.fill(0);
        for (let i = 0; i < 8; i++) count[layer[rowBase | ((rx + i) & L.maskX)]]++;
        // 使用色を数える
        let used = 0;
        for (let c = 0; c < 16; c++) if (count[c]) used++;
        if (used <= 2) continue;
        // 最も多い 2 色を残す
        let c1 = -1, c2 = -1;
        for (let c = 0; c < 16; c++) {
          if (!count[c]) continue;
          if (c1 < 0 || count[c] > count[c1]) { c2 = c1; c1 = c; }
          else if (c2 < 0 || count[c] > count[c2]) { c2 = c; }
        }
        for (let i = 0; i < 8; i++) {
          const idx = rowBase | ((rx + i) & L.maskX);
          const c = layer[idx];
          if (c === c1 || c === c2) continue;
          layer[idx] = nearerColor(c, c1, c2);
        }
      }
    }
  }

  /**
   * レイヤーの矩形を塗りつぶす(色0で透明クリア)。座標はラップする。
   * @param {number} layerIndex
   * @param {number} color パレット番号 0..15
   */
  fillLayer(layerIndex, color = 0, x = 0, y = 0, w, h, exact = false) {
    const L = this.layers[layerIndex];
    const layer = L.pixels;
    if (w === undefined) w = L.width;
    if (h === undefined) h = L.height;
    if (x === 0 && y === 0 && w === L.width && h === L.height) {
      layer.fill(color);
      L.empty = (color === 0);   // 全面を透明で塗ったら空になる
      return;
    }
    if (color !== 0) L.empty = false;
    // 塗りつぶしもキャラクタ単位に合わせる(exact 指定のときは 1 ドット単位)
    if (exact) {
      x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    } else {
      x = snap8(x); y = snap8(y); w = ceil8(w); h = ceil8(h);
    }
    for (let iy = 0; iy < h; iy++) {
      const rowBase = ((y + iy) & L.maskY) << L.shift;
      for (let ix = 0; ix < w; ix++) {
        layer[rowBase | ((x + ix) & L.maskX)] = color;
      }
    }
  }

  /**
   * 内蔵フォントでテキストを描く(1文字 8x8)。
   * @param {number} layerIndex
   * @param {number} x 仮想画面座標(ピクセル)
   * @param {number} y
   * @param {string} text
   * @param {number} color 文字色 1..15
   * @param {number} [bg=0] 背景色(0で透明のまま=重ね書き)
   */
  print(layerIndex, x, y, text, color = 15, bg = 0) {
    const L = this.layers[layerIndex];
    const layer = L.pixels;
    // 文字も 8 ドット単位に置く(1 文字 = 1 キャラクタ)
    x = snap8(x); y = snap8(y);
    for (let n = 0; n < text.length; n++) {
      const glyph = getGlyph(text[n]);
      const cx = x + n * 8;
      for (let iy = 0; iy < 8; iy++) {
        const row = glyph[iy] || '';
        const rowBase = ((y + iy) & L.maskY) << L.shift;
        for (let ix = 0; ix < 8; ix++) {
          const on = row[ix] === '#';
          const c = on ? color : bg;
          if (c === 0 && bg === 0 && !on) continue;
          layer[rowBase | ((cx + ix) & L.maskX)] = c;
        }
      }
    }
    L.empty = false;
    this._blackenCells(L, x, y, text.length * 8, 8);
    this._enforceRuns(L, x, y, text.length * 8, 8);
  }

  /**
   * スプライトを生成して登録する。src は RGBA 画像(自動変換)or 変換済み画像。
   * @param {{colors?:number}} [opts] convert() と同じ。colors:1 で単色スプライト
   */
  createSprite(src, opts) {
    const sprite = new Sprite(VDP.isConverted(src) ? src : this.convert(src, opts));
    sprite._autoPhase = this._blinkSeq = ((this._blinkSeq | 0) + 1) & 0xffff;
    this.sprites.add(sprite);
    return sprite;
  }

  /** スプライトを取り除く */
  removeSprite(sprite) {
    this.sprites.delete(sprite);
  }

  /**
   * BG スプライトを生成して登録する。
   * 通常のスプライトより奥(レイヤーより手前)に描かれ、位置は 8 ドット単位に丸められる。
   * 「大きな絵を BG のように動かす」用途向けで、枚数・大きさに制限はない。
   */
  createBgSprite(src, opts) {
    const sprite = new Sprite(VDP.isConverted(src) ? src : this.convert(src, opts));
    // BG スプライトはレイヤーと同じ決まりで見えるので、定義したここで調べる
    this._checkBgImage(sprite.image, 'BG スプライト', opts && opts.bgCheck);
    sprite._autoPhase = this._blinkSeq = ((this._blinkSeq | 0) + 1) & 0xffff;
    this.bgSprites.add(sprite);
    return sprite;
  }

  /**
   * 色を入れ替えた絵を作る(キャッシュ付き)。
   * 同じ絵と同じ入れ替え表なら作り直さない。
   */
  /**
   * 1 ライン おきに横線を抜いた絵を作る(走査線)。
   * phase 0 = 奇数行を抜く / 1 = 偶数行を抜く。
   * 毎フレーム間引くのではなく、**絵ごとに 1 度だけ作ってキャッシュ**する。
   * 描くときの手数は元の絵と変わらないので、非力な端末でも重くならない。
   */
  _scanlined(img, phase) {
    if (phase == null) return img;
    phase &= 1;
    if (!this._scanCache) this._scanCache = new WeakMap();
    let byPhase = this._scanCache.get(img);
    if (!byPhase) { byPhase = new Map(); this._scanCache.set(img, byPhase); }
    const hit = byPhase.get(phase);
    if (hit) return hit;
    const px = new Uint8Array(img.pixels);
    for (let y = 0; y < img.height; y++) {
      if (((y + phase) & 1) === 0) continue;
      px.fill(0, y * img.width, (y + 1) * img.width);
    }
    const out = { width: img.width, height: img.height, pixels: px };
    byPhase.set(phase, out);
    return out;
  }

  _recolored(img, map) {
    if (!map) return img;
    let key = '';
    for (const k of Object.keys(map)) key += k + '>' + map[k] + ',';
    if (!key) return img;
    if (!this._recolorCache) this._recolorCache = new WeakMap();
    let byKey = this._recolorCache.get(img);
    if (!byKey) { byKey = new Map(); this._recolorCache.set(img, byKey); }
    const hit = byKey.get(key);
    if (hit) return hit;
    const px = new Uint8Array(img.pixels);
    for (let i = 0; i < px.length; i++) {
      const to = map[px[i]];
      if (to !== undefined) px[i] = to;
    }
    const out = { width: img.width, height: img.height, pixels: px };
    byKey.set(key, out);
    return out;
  }

  /** BG スプライトを取り除く */
  removeBgSprite(sprite) {
    this.bgSprites.delete(sprite);
  }

  /**
   * BG スプライト用に、絵の 8x8 セルのうち色2以上を含むセルの透明を黒(1)で
   * 埋めた版を作る(キャッシュ付き)。BG と同じ「パターンのあるセルは不透明」の
   * 見え方になり、下のレイヤーと混ざって横8ドット2色を破ることがなくなる。
   */
  _bgCellFilled(img) {
    if (!this._bgFillCache) this._bgFillCache = new WeakMap();
    const hit = this._bgFillCache.get(img);
    if (hit) return hit;
    const px = new Uint8Array(img.pixels);
    for (let cy = 0; cy < img.height; cy += 8) {
      for (let cx = 0; cx < img.width; cx += 8) {
        let hasPattern = false;
        for (let iy = cy; iy < Math.min(cy + 8, img.height) && !hasPattern; iy++) {
          for (let ix = cx; ix < Math.min(cx + 8, img.width); ix++) {
            if (px[iy * img.width + ix] >= 2) { hasPattern = true; break; }
          }
        }
        if (!hasPattern) continue;
        for (let iy = cy; iy < Math.min(cy + 8, img.height); iy++) {
          for (let ix = cx; ix < Math.min(cx + 8, img.width); ix++) {
            const i = iy * img.width + ix;
            if (px[i] === 0) px[i] = 1;
          }
        }
      }
    }
    const out = { width: img.width, height: img.height, pixels: px };
    this._bgFillCache.set(img, out);
    return out;
  }

  /** 反転・回転した絵を取り出す(同じ組み合わせは使い回す) */
  _transformed(img, flipX, flipY, rot) {
    const r = ((rot | 0) % 360 + 360) % 360;
    if (!flipX && !flipY && r === 0) return img;
    if (!this._xformCache) this._xformCache = new WeakMap();
    let byImg = this._xformCache.get(img);
    if (!byImg) { byImg = new Map(); this._xformCache.set(img, byImg); }
    const key = (flipX ? 1 : 0) | (flipY ? 2 : 0) | (r << 2);
    let hit = byImg.get(key);
    if (!hit) { hit = transformImage(img, flipX, flipY, r); byImg.set(key, hit); }
    return hit;
  }

  /** スプライト列を画面に描く(bg=true なら 8 ドット単位に丸める) */
  _drawSprites(list, bg) {
    const sprites = [...list].sort((a, b) => a.priority - b.priority);
    for (const s of sprites) this._drawSprite(s, bg);
  }

  /** スプライトを 1 枚描く(bg=true なら 8 ドット単位に丸める) */
  _drawSprite(s, bg) {
    const frame = this.active32;
    const W = this.width, H = this.height;
    {
      if (!s.visible) return;
      // 「何フレームに 1 回出すか」の指定があれば、その回だけ描く
      const bl = s.blink | 0;
      // 位相は、指定が無ければ生成順に自動でずらす
      // (同じ blink のものがいっせいに消えないようにするため)
      const ph = (s.blinkPhase == null ? s._autoPhase : s.blinkPhase) | 0;
      if (bl > 1 && ((this.frames + ph) % bl) >= Math.max(1, s.blinkOn | 0)) return;
      // 反転・回転(BG スプライトは 90/270 度は使えない = 絵のルールが崩れるため)
      const rot = bg ? ((s.rotate === 180) ? 180 : 0) : s.rotate;
      // パラパラアニメの指定があれば、いまのコマを選ぶ
      let base = s.image;
      if (s.frames && s.frames.length) {
        const step = Math.max(1, s.frameRate | 0);
        let n = Math.floor((this.frames + (s.framePhase | 0)) / step);
        n = s.frameLoop ? (n % s.frames.length)
          : Math.min(n, s.frames.length - 1);
        base = s.frames[n] || s.image;
      }
      if (s.colorMap) base = this._recolored(base, s.colorMap);
      let src = this._transformed(base, s.flipX, s.flipY, rot);
      // 走査線は反転・回転のあとにかける(画面の行に対して抜きたいので)
      if (s.scanline != null) src = this._scanlined(src, s.scanline);
      const img = bg ? this._bgCellFilled(src) : src;
      const bx = bg ? snap8(s.x) : Math.round(s.x);
      const by = bg ? snap8(s.y) : Math.round(s.y);
      for (let iy = 0; iy < img.height; iy++) {
        const y = by + iy;
        if (y < 0 || y >= H) continue;
        const srcBase = iy * img.width;
        for (let ix = 0; ix < img.width; ix++) {
          const x = bx + ix;
          if (x < 0 || x >= W) continue;
          const c = img.pixels[srcBase + ix];
          if (c !== 0) frame[y * W + x] = this.pal32[c];
        }
      }
    }
  }

  /** 全レイヤー + 全スプライトを合成して canvas に描画する */
  render() {
    this.frames = (this.frames || 0) + 1;
    const frame = this.active32;
    const W = this.width, H = this.height;
    const back = this.pal32[this.backdrop] || this.pal32[1];

    // 背景色 + レイヤー合成 (layer0 が奥)。
    // BG スプライトはレイヤーと同じ優先度空間を使うので、ここで混ぜて描く。
    // BG スプライトの priority = n は「レイヤー n の手前」を意味する
    // (n が負なら全部のレイヤーより奥)。
    frame.fill(back);
    const bgList = [...this.bgSprites].sort((a, b) => a.priority - b.priority);
    let bi = 0;
    for (let li = 0; li < this.layers.length; li++) {
      // このレイヤーより奥に置かれた BG スプライトを先に描く
      while (bi < bgList.length && bgList[bi].priority < li) {
        this._drawSprite(bgList[bi++], true);
      }
      const L = this.layers[li];
      // 空のレイヤーは 1 ピクセルも見えないので、合成そのものを飛ばす
      if (!L.visible || L.empty) continue;
      const px = L.pixels;
      const snap = L.snap | 0;
      const sx = snap ? Math.floor(L.scrollX / snap) * snap : Math.round(L.scrollX);
      const sy = snap ? Math.floor(L.scrollY / snap) * snap : Math.round(L.scrollY);
      // 走査線: null 以外なら、その位相の行を飛ばして 1 ライン おきに描く。
      // 位相を毎コマ入れ替えると、抜ける行が交互になる
      const scan = L.scanline;
      for (let y = 0; y < H; y++) {
        if (scan !== null && ((y + scan) & 1)) continue;
        const vy = y + sy;
        if (!L.repeatY && (vy < 0 || vy >= L.height)) continue;
        const rowBase = (vy & L.maskY) << L.shift;
        let o = y * W;
        for (let x = 0; x < W; x++, o++) {
          const vx = x + sx;
          if (!L.repeatX && (vx < 0 || vx >= L.width)) continue;
          const c = px[rowBase | (vx & L.maskX)];
          if (c !== 0) frame[o] = this.pal32[c];
        }
      }
    }

    // いちばん手前のレイヤーより手前に置かれた BG スプライト
    while (bi < bgList.length) this._drawSprite(bgList[bi++], true);
    // スプライト (priority 昇順 = 大きいほど後=手前)
    this._drawSprites(this.sprites, false);

    // ボーダーと画面ずらしを付けて、実際に出す面へ写す。
    // どちらも無いときは active32 と frame32 が同じものなので、写す手間は要らない
    if (!this._plain || this.adjustX || this.adjustY) this._present(back);

    this.offCtx.putImageData(this.imageData, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.offscreen, 0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * 描画領域を、ボーダーとずらしのぶんだけ動かして表示面へ写す。
   * はみ出したところは切り落とし、空いたところは背景色のまま
   * (反対側から回り込ませない)。
   */
  _present(back) {
    const out = this.frame32, src = this.active32;
    const ow = this.outWidth, oh = this.outHeight;
    const W = this.width, H = this.height;
    out.fill(back);
    const ox = this.borderX + this.adjustX;
    const oy = this.borderY + this.adjustY;
    // 写す範囲を、はみ出さないところだけに切りそろえる
    const x0 = Math.max(0, -ox), x1 = Math.min(W, ow - ox);
    const y0 = Math.max(0, -oy), y1 = Math.min(H, oh - oy);
    if (x0 >= x1 || y0 >= y1) return;   // 全部はみ出した
    for (let y = y0; y < y1; y++) {
      const from = y * W + x0;
      out.set(src.subarray(from, from + (x1 - x0)), (y + oy) * ow + (x0 + ox));
    }
  }
}
