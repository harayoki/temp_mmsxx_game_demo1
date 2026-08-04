import { VDP_PALETTE, convertRGBA, convertRGBAFlat, hashRGBA,
  setPalette, currentPalette, PALETTE_NAMES, PALETTE_LABELS,
  PALETTE_FAMILY } from './palette.js';
import { ImageSymbol, SpriteSymbol, BgSymbol } from './symbol.js';
import { MID_TONES } from './midtone.js';
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

/**
 * 派生した絵に、元の名前を引き継ぐ。
 * 検査で引っかかったときに「どの絵から作ったものか」が分かるようにする
 */
function nameOf(img, how) {
  return img && img.name ? img.name + '(' + how + ')' : undefined;
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
     * **拡大**。1(既定)か 2。2 にすると 1 ドットが 2x2 の四角になり、
     * 16x16 の絵が 32x32 で出る(実機の拡大スプライト)。
     * 置く位置(x, y)は左上のまま。当たり判定はゲームが持つので、
     * 大きくしたぶんは**ゲーム側でも見てやること**。
     *
     * 実機は VDP のビット 1 つで**全部のスプライトが同時に**大きくなるが、
     * ここでは 1 枚ずつ決められる
     */
    this.mag = 1;
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
  // 90/270 度は縦横が入れ替わるので、型は同じでも大きさが変わる
  return img.derive
    ? (swap ? new img.constructor(ow, oh, out, nameOf(img, '向き替え'))
      : img.derive(out, nameOf(img, '向き替え')))
    : { width: ow, height: oh, pixels: out, name: nameOf(img, '向き替え') };
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
    // canvas そのものを**等倍**で持ち、拡大は CSS(ブラウザ側)にまかせる。
    // 別のオフスクリーンへ描いてから拡大転送すると、画面ぜんぶを 2 回塗ることになり、
    // 塗る面積の効くスマホでそこが重くなる。
    // 取り出し(capture)も等倍のこの canvas から読むので、名前だけ残してある
    this.offscreen = canvas;
    this.offCtx = this.ctx;
    this._resize(screen.width ?? SCREEN_W, screen.height ?? SCREEN_H,
      screen.borderX ?? 0, screen.borderY ?? 0);
    // 窓の大きさや向きが変わったら、整数倍を取り直す。
    // resize は最終的な大きさになる前にも飛んでくるので、
    // **次の描き替えまで待ってから**測り直す
    if (typeof window !== 'undefined') {
      let waiting = 0;
      const refit = () => {
        if (waiting) cancelAnimationFrame(waiting);
        waiting = requestAnimationFrame(() => { waiting = 0; this.refitCss(); });
      };
      window.addEventListener('resize', refit);
      window.addEventListener('orientationchange', refit);
    }

    // パレットを ABGR(リトルエンディアンの RGBA) 32bit 値に前計算
    this.pal32 = new Uint32Array(16);
    this._buildPal32();
    // 直前のコマを溜める輪っか(keepFrames で始める)
    this._keepFrames = 0; this._frames = null; this._frameAt = 0; this._frameLen = 0;
    this._frameHold = false;   // ポーズ中など、溜めるのを止めているあいだ
    this._showFrame = null;    // これが入っていると、合成せずにそれを出す
    this.spritesHidden = false; // true のあいだ、スプライトを 1 枚も描かない
    /**
     * **1 行に出せるスプライトの数**(0 で無制限)。
     * 実機の VDP は 1 走査線に決まった枚数しか出せず、あふれたぶんは
     * その行だけ消える(MSX1 = 4 枚 / MSX2 = 8 枚)。
     * 消えるのは**優先度の低いほう**で、単位は「スプライト」ではなく「行」。
     *
     * 数えるのは**その コマに実際に出ているものだけ**。`visible` が false のもの、
     * `blink` で消えているコマのものは席を取らない(実機で画面外へ逃がした
     * スプライトが席を取らないのと同じ)。
     * **BG スプライトは数に入れない**(このエンジン独自の仕組みなので、
     * ちらつかせない)
     */
    this.spriteLimit = 0;
    /**
     * **同じ優先度のものの順番をコマごとに回す**。
     * 上の制限で消えるとき、いつも同じものが消えると気づかれてしまうので、
     * 順ぐりに入れ替えて「みんなが少しずつちらつく」形にする。
     * 実機のゲームがやっていた並べ替えと同じ考えかた
     */
    this.spriteRotate = false;
    this._lineUse = null;      // 行ごとに何枚出したか
    this._rowOk = null;        // スプライトごとに「どの行を描いてよいか」

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
        // **8x8 セルごとの「何か描いてあるか」**。合成のときに、
        // 空のセルは 8 ドットまとめて飛ばす(星空はほとんど空なので効く)。
        // 描いたら 1、透明で塗りつぶしたら 0 にする
        cellW: w >> 3,
        cells: new Uint8Array((w >> 3) * (h >> 3)),
        // 立っているセルの数。**まばらなときだけ**セル飛ばしを使う
        // (星空のように全セルが埋まっていると、飛ばす判定のぶんだけ損をする)
        cellsOn: 0,
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
    /**
     * セル飛ばしに切り替える境目。
     * 「絵の入っているセルが、全体のこの割合より少なければ飛ばす道を通る」。
     * 0.5 = 半分未満なら飛ばす。0 にすると常に元の道、1 にすると常に飛ばす道。
     * **どこが得かは絵の入りかたで変わる**ので、あとから変えられるようにしてある
     */
    this.sparseRatio = 0.5;
    /** 合成のようすを一定間隔で console に出す(開発版だけ) */
    this.profile = false;
    /** 何コマぶんためてから出すか */
    this.profileEvery = 600;
    this._profTimes = [];
    /** 見つかった違反の記録(name と中身)。あとからまとめて見られるように残す */
    this.bgWarnings = [];
    /** 一度調べた絵(同じ絵を何度も調べない) */
    this._bgChecked = new WeakSet();
    /** 色数を調べ終えた絵 */
    this._colorChecked = new WeakSet();
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
    const msg = `[MMSXX] ${where} "${img.name || '名前なし'}": `
      + `横8ドットに3色以上が ${r.runs} 本`
      + ` (最大 ${r.worst} 色) ${img.width}x${img.height} 例: ${r.samples.join(' / ')}`;
    this.bgWarnings.push({ where, name: img.name, ...r, width: img.width, height: img.height });
    if (how === 'throw') throw new Error(msg);
    console.warn(msg);
  }

  /**
   * **絵を減色する(スプライト用)**。
   *
   * 15 色のパレットのうち、**使われている数の多い順に指定色数ぶんだけ残し**、
   * 残らなかった色は RGB でいちばん近い許可色へ寄せる。
   * 透明はそのまま残るので、穴あきのスプライトが作れる。
   *
   * **エンジンからは自動で呼ばない。** 素材の時点で色数をそろえるのが本筋で、
   * これはやむを得ないときに手で呼ぶためのもの。
   *
   * TODO(v2): 外から絵を取り込む口を作るときに、もっと賢い変換にする。
   *   いまは「多い順に残して近い色へ寄せる」だけなので、面積の小さい
   *   大事な色(目のハイライトなど)が消えることがある。
   *
   * @param {ImageData|{data:Uint8ClampedArray,width:number,height:number}} src
   * @param {number} [colors=1] 残す色数(1 = 実機の単色スプライト)
   * @returns {{width:number,height:number,pixels:Uint8Array}}
   */
  reduceForSprite(src, colors = 1) {
    return convertRGBAFlat(src.data, src.width, src.height, colors);
  }

  /**
   * **絵を減色する(BG 用)**。実機の SCREEN2 と同じ見え方に落とす。
   *
   * 1. **15 色 + 中間色(2 色のディザで作れる色)**の中でいちばん近い色を選ぶ
   *    (中間色は 2 色の組なので、まずどちらか片方に置く)
   * 2. **横 8 ドットに 3 色以上**あれば、多い順に 2 色を残して近いほうへ寄せる
   * 3. **8x8 のセル**を見て、1 ドットでも絵があるセルは、
   *    残りの透明を背景色(既定は黒)で埋める
   *
   * **エンジンからは自動で呼ばない。** 手で呼ぶためのもの。
   *
   * TODO(v2): 外から絵を取り込む口を作るときに、ここを作り直す。
   *   - 中間色を**ディザとして 2 色に振り分ける**(いまは片方に寄せるだけ)
   *   - **8x1 のグリッドで見るモード**を足す(8x8 のセル塗りをしない。
   *     行ごとに 2 色だけ守る絵にしたいとき用)
   *   - 誤差拡散(ディザ)を選べるようにする
   *
   * @param {ImageData|{data:Uint8ClampedArray,width:number,height:number}} src
   * @param {{backdrop?:number, cellFill?:boolean}} [opts]
   *   backdrop = セルを埋める色(既定 1 = 黒) /
   *   cellFill = 8x8 セルを埋めるか(既定 true)
   * @returns {{width:number,height:number,pixels:Uint8Array}}
   */
  reduceForBG(src, opts = {}) {
    const { width: w, height: h, data } = src;
    const backdrop = opts.backdrop ?? 1;
    // 1) 15 色 + 中間色でいちばん近いものを選ぶ。
    //    中間色は 2 色の組なので、ここでは組の片方(明るいほう)へ置く
    const cand = [];
    for (let c = 1; c < 16; c++) cand.push({ rgb: VDP_PALETTE[c], to: c });
    for (const t of MID_TONES) cand.push({ rgb: t.rgb, to: t.a });
    const pixels = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (data[o + 3] < 128) continue;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      let best = 1, bestD = Infinity;
      for (const c of cand) {
        const d = 3 * (r - c.rgb[0]) ** 2 + 6 * (g - c.rgb[1]) ** 2 + (b - c.rgb[2]) ** 2;
        if (d < bestD) { bestD = d; best = c.to; }
      }
      pixels[i] = best;
    }
    // 2) 横 8 ドット 2 色に均す(多い順に 2 色残す)
    const count = new Uint32Array(16);
    for (let y = 0; y < h; y++) {
      for (let bx = 0; bx < w; bx += 8) {
        count.fill(0);
        const end = Math.min(bx + 8, w);
        for (let x = bx; x < end; x++) count[pixels[y * w + x] || backdrop]++;
        let used = 0;
        for (let c = 0; c < 16; c++) if (count[c]) used++;
        if (used <= 2) continue;
        let c1 = -1, c2 = -1;
        for (let c = 0; c < 16; c++) {
          if (!count[c]) continue;
          if (c1 < 0 || count[c] > count[c1]) { c2 = c1; c1 = c; }
          else if (c2 < 0 || count[c] > count[c2]) { c2 = c; }
        }
        for (let x = bx; x < end; x++) {
          const i = y * w + x;
          const c = pixels[i] || backdrop;
          if (c === c1 || c === c2) continue;
          pixels[i] = nearerColor(c, c1, c2);
        }
      }
    }
    // 3) 絵のあるセルは、透明を背景色で埋める
    if (opts.cellFill !== false) {
      for (let cy = 0; cy < h; cy += 8) {
        for (let cx = 0; cx < w; cx += 8) {
          let has = false;
          for (let y = cy; y < Math.min(cy + 8, h) && !has; y++) {
            for (let x = cx; x < Math.min(cx + 8, w); x++) {
              if (pixels[y * w + x] >= 2) { has = true; break; }
            }
          }
          if (!has) continue;
          for (let y = cy; y < Math.min(cy + 8, h); y++) {
            for (let x = cx; x < Math.min(cx + 8, w); x++) {
              const i = y * w + x;
              if (pixels[i] === 0) pixels[i] = backdrop;
            }
          }
        }
      }
    }
    return { width: w, height: h, pixels };
  }

  /**
   * スプライトの色数を調べる。**減らさない**。
   * 実機のスプライトは 1 枚 1 色で、2 色なら「2 枚重ねという体」。
   * 宣言より多ければ知らせる(直すのは素材側の仕事)
   * @param {*} img @param {number} want 使ってよい色数
   */
  _checkSpriteColors(img, want) {
    const how = this.bgCheck;
    if (how === 'off' || this._colorChecked.has(img)) return;
    this._colorChecked.add(img);
    const seen = new Set();
    for (let i = 0; i < img.pixels.length; i++) {
      const c = img.pixels[i];
      if (c !== 0) seen.add(c);
    }
    if (seen.size <= want) return;
    const msg = `[MMSXX] スプライト "${img.name || '名前なし'}": `
      + `色は ${want} 色までです (いまは ${seen.size} 色: ${[...seen].join(',')})`;
    this.bgWarnings.push({ where: 'スプライト色', name: img.name, colors: seen.size, want });
    if (how === 'throw') throw new Error(msg);
    console.warn(msg);
  }

  /**
   * 絵の大きさが 8 の倍数かどうか調べる。
   *
   * **BG スプライトは 8 の倍数**。
   * 「絵のあるセルを黒で埋めて、下を丸ごと上書きする」ことで
   * 横 8 ドット 2 色を守っているので、半端な大きさだと端のセルだけ
   * 半分しか埋まらず、そこで下の色と混ざる。
   *
   * **通常スプライトは 16 の倍数を推奨**。実機のスプライトが 16x16 単位なので、
   * そろえておくとレトロゲームらしい見え方になる。
   * 16x16 に収まる小さいものは、そのままでよい(調べない)。
   *
   * レイヤーへ描く BG パーツは縛らない。半端な大きさでも、
   * はみ出したセルは黒で埋められて規則は保たれる(drawToLayer を見ること)。
   * @param {*} img @param {string} where @param {'warn'|'throw'|'off'} how
   * @param {number} [unit] そろえたい刻み(既定 8)
   */
  _checkSize(img, where, how, unit = 8) {
    if (how === 'off') return;
    // 16 の倍数を見るときは、**16 に収まる辺はそのままでよい**
    // (8x8 や 16x8 の小さいスプライトまで縛らない)
    const ok = (d) => d % unit === 0 || (unit === 16 && d <= 16);
    if (ok(img.width) && ok(img.height)) return;
    const msg = `[MMSXX] ${where} "${img.name || '名前なし'}": `
      + `大きさは ${unit} の倍数にしてください (いまは ${img.width}x${img.height})`;
    this.bgWarnings.push({ where, name: img.name, size: `${img.width}x${img.height}`, runs: 0, worst: 0, samples: [] });
    if (how === 'throw') throw new Error(msg);
    console.warn(msg);
  }

  /**
   * **スプライトに使う絵を作る**(ここでしか作れない)。
   *
   * 15 色へ寄せてから、宣言した色数まで減らす。大きさも調べる。
   * ここを通った絵は決まりを守っているので、`sprite()` の側では何も調べない。
   *
   * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} src RGBA の絵
   * @param {{name?:string, colors?:number}} [opts] colors = 使う色数(既定 1)
   * @returns {SpriteSymbol}
   */
  spriteSymbol(src, opts = {}) {
    const colors = opts.colors || 1;
    const name = opts.name || src.name || '';
    // 色番号で組み立てた絵(HUD の部品など)は、そのまま受けて色数だけ調べる。
    // RGBA なら 15 色へ寄せてから、宣言した色数まで減らす
    let sym;
    if (src.pixels instanceof Uint8Array) {
      sym = new SpriteSymbol(src.width, src.height, src.pixels, name, colors);
      this._checkSpriteColors(sym, colors);
    } else {
      const im = this._cached(src, 'spr' + colors,
        () => convertRGBAFlat(src.data, src.width, src.height, colors));
      sym = new SpriteSymbol(im.width, im.height, im.pixels, name, colors);
    }
    // 実機のスプライトは 16x16 単位。16 に収まる小さいものはそのままでよい
    this._checkSize(sym, 'スプライト', this.bgCheck, 16);
    return sym;
  }

  /**
   * **BG に使う絵を作る**(ここでしか作れない)。
   *
   * 15 色へ寄せながら、横 8 ドットごとに 2 色へ均す。
   * ここを通った絵は決まりを守っているので、描く側では何も調べない。
   * 大きさは自由だが、8 の倍数でないものは BG スプライトにできない。
   *
   * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} src RGBA の絵
   * @param {{name?:string}} [opts]
   * @returns {BgSymbol}
   */
  bgSymbol(src, opts = {}) {
    const name = opts.name || src.name || '';
    // 色番号で組み立てた絵(体力バーの升目など)は、そのまま受けて決まりだけ調べる。
    // RGBA なら 15 色へ寄せながら、横 8 ドット 2 色へ均す
    if (src.pixels instanceof Uint8Array) {
      const sym = new BgSymbol(src.width, src.height, src.pixels, name);
      this._checkBgImage(sym, 'BG シンボル', opts.bgCheck);
      return sym;
    }
    const im = this._cached(src, 'bg', () => convertRGBA(src.data, src.width, src.height));
    return new BgSymbol(im.width, im.height, im.pixels, name);
  }

  /** 同じ RGBA を同じやり方で二度変換しない(結果を覚えておく) */
  _cached(src, how, make) {
    const key = hashRGBA(src.data, src.width, src.height) + ':' + how;
    let im = this.convertCache.get(key);
    if (!im) { im = make(); this.convertCache.set(key, im); }
    return im;
  }

  /**
   * 渡された絵が求める型かどうか調べる。ちがえば知らせる(公開版では止めない)。
   * @param {*} sym @param {Function} want SpriteSymbol か BgSymbol
   * @param {string} where
   */
  _needSymbol(sym, want, where) {
    if (sym instanceof want) return true;
    const got = sym instanceof ImageSymbol ? sym.constructor.name
      : (sym && sym.pixels) ? '変換済みの絵(型なし)' : 'RGBA の絵';
    const msg = `[MMSXX] ${where}: ${want.name} を渡してください `
      + `(いまは ${got} "${(sym && sym.name) || '名前なし'}")`;
    this.bgWarnings.push({ where, name: sym && sym.name, runs: 0, worst: 0, samples: [] });
    if (this.bgCheck === 'throw') throw new Error(msg);
    console.warn(msg);
    return false;
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
    // 中身は等倍。見た目の大きさは CSS で決める(拡大はブラウザがやる)
    this.canvas.width = ow;
    this.canvas.height = oh;
    this.ctx.imageSmoothingEnabled = false;
    this._applyCssSize();
    this.imageData = this.ctx.createImageData(ow, oh);
    /** 画面に出るぶん全部(ボーダー込み) */
    this.frame32 = new Uint32Array(this.imageData.data.buffer);
    // 合成は描画領域の大きさで行い、最後にボーダーとずらしを付けて写す。
    // ボーダーもずらしも無いときは写す手間すら要らないので、同じものを指す
    this._plain = (this.borderX === 0 && this.borderY === 0);
    // **合成はパレット番号(1 バイト)のまま**行い、色(4 バイト)に直すのは最後の 1 回だけ。
    // 番号のまま重ねると、書き込む量が 1/4 で済み、
    // 色の引き当ても「重なった回数ぶん」ではなく「画面のドット数ぶん」で済む
    this.activeIdx = new Uint8Array(this.width * this.height);
    // ボーダーやずらしがあるときは、出す面のぶんも番号で持つ
    this.outIdx = this._plain ? this.activeIdx : new Uint8Array(ow * oh);
  }

  /**
   * 見た目の大きさを CSS で決める。中身(canvas.width)は等倍のまま。
   *
   * **倍率は「実際の画素で」整数**にする。
   * 中途半端な倍率だと、1 ドットが 2 画素だったり 3 画素だったりまだらになり、
   * 斜めの線がガタつく。画面に収まる いちばん大きな整数倍を選び、
   * 指定された scale は上限として使う(大きな画面で無闇に拡大しない)。
   * 余ったところは、まわりの余白になる。
   */
  _applyCssSize() {
    const st = this.canvas.style;
    const ow = this.outWidth, oh = this.outHeight;
    let n = this.scale;
    if (typeof window !== 'undefined') {
      // ボーダーのぶんは中身の外なので、置ける大きさから引いておく
      let bw = 0, bh = 0;
      try {
        const cs = getComputedStyle(this.canvas);
        bw = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
        bh = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      } catch (e) { /* 取れなくても続ける */ }
      const dpr = window.devicePixelRatio || 1;
      // 置ける大きさは documentElement から取る。
      // innerWidth はスクロールバーのぶんを含んでいて、はみ出しの原因になる
      const el = document.documentElement;
      const availW = (el && el.clientWidth) || window.innerWidth;
      const availH = (el && el.clientHeight) || window.innerHeight;
      // **画面の長いほうへ、ゲームの長いほうを合わせる**。
      // 向きが食い違っていたら 90 度回して見せる(端末の傾きに関係なく同じ形)。
      // ただし**指で触る端末のときだけ**。PC で窓を縦長にしただけで
      // 回ってしまうと、作っている最中に困る
      let touchLike = false;
      try {
        touchLike = window.matchMedia('(pointer: coarse)').matches;
      } catch (e) { /* 古い環境では回さない */ }
      const rot = touchLike && (ow >= oh) !== (availW >= availH);
      // 回すと、置き場所として要る幅と高さが入れ替わる
      const needW = rot ? oh : ow, needH = rot ? ow : oh;
      // 実際の画素で何倍まで置けるか
      const fitX = Math.floor(((availW - bw) * dpr) / needW);
      const fitY = Math.floor(((availH - bh) * dpr) / needH);
      n = Math.max(1, Math.min(this.scale * dpr, fitX, fitY));
      // 実画素で整数倍になる大きさを、CSS の大きさへ戻す
      st.width = (ow * n / dpr) + 'px';
      st.height = (oh * n / dpr) + 'px';
      st.imageRendering = 'pixelated';
      // 幅いっぱいに引き伸ばされて まだらにならないよう、上限も外す
      st.maxWidth = 'none';
      st.maxHeight = 'none';
      // 回すときは、回した見た目で真ん中に来るように置き直す。
      // (回転は見た目だけで、置き場所の大きさは変わらないため)
      if (rot) {
        st.position = 'fixed';
        st.left = '50%';
        st.top = '50%';
        st.transform = 'translate(-50%, -50%) rotate(90deg)';
      } else {
        st.position = '';
        st.left = '';
        st.top = '';
        st.transform = '';
      }
      this.rotated = rot;
      return;
    }
    st.width = (ow * n) + 'px';
    st.height = (oh * n) + 'px';
    st.imageRendering = 'pixelated';
  }

  /**
   * 表示の大きさを取り直す(窓の大きさが変わったとき・向きが変わったとき)。
   * 中身は等倍のままなので、描き直しは要らない
   */
  refitCss() { this._applyCssSize(); }

  // ---- 直前のコマを溜める(あとで「何秒前」を取り出す) ----
  //
  // **色番号のまま**輪っかに溜める。1 ドット 1 バイトなので、
  // 264x200 なら 1 コマ 51.6KB。60fps で 3 秒でも 9MB ほどで収まる。
  // 色に直すのは取り出すときだけ。パレットを切り替えていれば、
  // **取り出した絵も新しい色**になる。

  /**
   * 直前のコマを溜めはじめる(0 でやめて捨てる)。
   * @param {number} seconds 何秒ぶん持つか(60fps で数える)
   */
  keepFrames(seconds) {
    const n = Math.max(0, Math.round(seconds * 60));
    this._keepFrames = n;
    // **止めたままにしない**。溜めはじめるのに止まっている、という
    // 組み合わせがあると、気づかないまま 1 コマも溜まらなくなる
    this._frameHold = false;
    this._frames = n ? [] : null;
    this._frameAt = 0;   // 次に書く場所(輪っか)
    this._frameLen = 0;  // いま何コマ持っているか
  }

  /**
   * **溜めるのをいったん止める / 再開する**(溜めたものは捨てない)。
   * ポーズ中も画面は描き続けているので、止めておかないと
   * 輪っかが「止まった画面」で埋まってしまう
   */
  holdFrames(on) { this._frameHold = !!on; }

  /** 1 コマ写す(合成の最後に呼ばれる) */
  _pushFrame() {
    const n = this._keepFrames;
    if (!n || this._frameHold) return;
    const src = this.outIdx;
    let buf = this._frames[this._frameAt];
    // 画面の大きさが変わったら作り直す
    if (!buf || buf.length !== src.length) buf = new Uint8Array(src.length);
    buf.set(src);
    this._frames[this._frameAt] = buf;
    this._frameAt = (this._frameAt + 1) % n;
    if (this._frameLen < n) this._frameLen++;
  }

  /** いま持っているコマ数 */
  get frameCount() { return this._frameLen || 0; }

  /**
   * 溜めたコマを取り出す。**新しいほうから数える**(0 = いちばん新しい)。
   * 持っていない番号なら null。
   * @param {number} back 何コマ前か
   * @returns {Uint8Array|null} 色番号の並び
   */
  frameBack(back) {
    const len = this._frameLen || 0;
    if (!len || back < 0 || back >= len) return null;
    const i = (this._frameAt - 1 - back + this._keepFrames * 2) % this._keepFrames;
    return this._frames[i] || null;
  }

  /**
   * 溜めたコマを canvas にして返す。
   * @param {number} back 何コマ前か(0 = いちばん新しい)
   * @param {number} [scale=1] 何倍に広げるか(ドットはぼかさない)
   */
  frameCanvas(back, scale = 1) {
    const idx = this.frameBack(back);
    if (!idx) return null;
    const w = this.outWidth, h = this.outHeight;
    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    const im = src.getContext('2d').createImageData(w, h);
    const px = new Uint32Array(im.data.buffer), pal = this.pal32;
    for (let i = 0; i < idx.length; i++) px[i] = pal[idx[i]];
    src.getContext('2d').putImageData(im, 0, 0);
    if (scale === 1) return src;
    const out = document.createElement('canvas');
    out.width = w * scale; out.height = h * scale;
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, out.width, out.height);
    return out;
  }

  /**
   * **溜めたコマをそのまま出す**(合成を飛ばす)。null で元へ戻す。
   * レイヤーへ写すやりかたと違い、スプライトも割り込めない
   * @param {Uint8Array|null} idx 色番号の並び(frameBack が返すもの)
   */
  showFrame(idx) { this._showFrame = idx || null; }

  /**
   * 溜めたコマを**レイヤーへ写す**(リプレイの再生に使う)。
   * 溜めてあるのはボーダー込みの絵なので、**描画領域のぶんだけ**切り出す。
   * 透明(0)は背景色に置き換えるので、下のレイヤーは透けない。
   * @param {number} layerIndex 写す先
   * @param {number} back 何コマ前か(0 = いちばん新しい)
   * @returns {boolean} 写せたか
   */
  frameToLayer(layerIndex, back) {
    const idx = this.frameBack(back);
    const L = this.layers[layerIndex];
    if (!idx || !L) return false;
    const ow = this.outWidth;
    const bx = this.borderX, by = this.borderY;
    const w = Math.min(this.width, L.width), h = Math.min(this.height, L.height);
    const bg = this.backdrop || 1;
    for (let y = 0; y < h; y++) {
      const src = (y + by) * ow + bx;
      const dst = y * L.width;
      for (let x = 0; x < w; x++) {
        const c = idx[src + x];
        L.pixels[dst + x] = c === 0 ? bg : c;
      }
    }
    // セルの持ち物(どこに絵があるか)も埋めておく。合成の間引きに使われる
    if (L.cells) L.cells.fill(1);
    if (L.cellsOn !== undefined) L.cellsOn = L.cells ? L.cells.length : 0;
    // **「空」の印を消す。** これを忘れると、合成のときにこのレイヤーが
    // まるごと飛ばされ、写したはずのコマが画面に出ない
    L.empty = false;
    return true;
  }

  /** パレットの 32bit 値を作り直す(色合いを切り替えたとき) */
  _buildPal32() {
    for (let i = 1; i <= 15; i++) {
      const [r, g, b] = VDP_PALETTE[i];
      this.pal32[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
  }

  /**
   * **色合い(パレットの流派)を切り替える**。
   * 絵は色番号で持っているので、描き直さずに色だけ変わる。
   * @param {string} name 'tms9918' / 'tms9918a' / 'v9938'
   */
  setPalette(name) {
    if (!setPalette(name)) return false;
    this._buildPal32();
    return true;
  }

  /** いまの色合いの名前 */
  get palette() { return currentPalette(); }
  /** 選べる色合いの名前(切り替えの順番) */
  get paletteNames() { return PALETTE_NAMES.slice(); }
  /** 画面に出すときの名乗り(省略すると、いまの色合いのもの) */
  paletteLabel(name) { return PALETTE_LABELS[name || currentPalette()] || (name || ''); }
  /** どの機械の色か('msx1' / 'msx2')。省略すると、いまの色合いのもの */
  paletteFamily(name) { return PALETTE_FAMILY[name || currentPalette()] || ''; }

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
      this.outIdx = new Uint8Array(this.outWidth * this.outHeight);
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
   * レイヤーの仮想画面 (1024x1024) に画像を書き込む。座標はラップする。
   *
   * **絵の大きさは 8 の倍数でなくてよい**(BG スプライトとちがって縛らない)。
   * ただし実機と同じく「絵のあるセルは不透明」になるので、
   * **半端なぶんは 8 の倍数まで黒で埋まる**。
   * 20x12 の絵を置けば、右と下が伸びて 24x16 の黒い升目に収まって見える。
   * 気にしないなら そのままでよい(規則は保たれる)。
   * ぴったり出したいときだけ、絵を 8 の倍数で作ること。
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
    // 絵は bgSymbol() で作ったものだけ。決まりはそこで済んでいる。
    // 色の置き換え・走査線・反転は 1 対 1 なので、あとも守れている
    this._needSymbol(src, BgSymbol, 'BG パーツ');
    let img = src;
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
    this._markCells(L, x, y, img.width, img.height, 1);
  }

  /**
   * 8x8 セルの「何か描いてあるか」を塗り替える。
   * 描いたとき(on=1)は、かかったセルを全部立てる。
   * 透明で消したとき(on=0)は、**まるごと入るセルだけ**倒す
   * (半端にかかったセルは、ほかの絵が残っているかもしれないので触らない)。
   */
  _markCells(L, x, y, w, h, on) {
    const cw = L.cellW, ch = L.height >> 3;
    const x0 = on ? Math.floor(x / 8) : Math.ceil(x / 8);
    const x1 = on ? Math.floor((x + w - 1) / 8) : Math.floor((x + w) / 8) - 1;
    const y0 = on ? Math.floor(y / 8) : Math.ceil(y / 8);
    const y1 = on ? Math.floor((y + h - 1) / 8) : Math.floor((y + h) / 8) - 1;
    for (let cy = y0; cy <= y1; cy++) {
      const ry = ((cy % ch) + ch) % ch;
      for (let cx = x0; cx <= x1; cx++) {
        const rx = ((cx % cw) + cw) % cw;
        const i = ry * cw + rx;
        if (L.cells[i] === on) continue;
        L.cells[i] = on;
        L.cellsOn += on ? 1 : -1;
      }
    }
  }

  /**
   * レイヤーの 8x8 セル(レイヤー原点基準のグリッド)を走査し、色2以上の
   * パターンを含むセルの透明(0)を黒(1)にする。
   * 「キャラパターンのあるセルは不透明」という MSX1 実機 BG の見え方の再現。
   * 指定矩形にかかるセルだけを処理する。
   *
   * ここが効くので、**8 の倍数でない絵は右と下が黒で埋まる**。
   * 1 セルの中身が必ず「絵 + 黒」になるため、横 8 ドット 2 色は保たれる。
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
      L.cells.fill(color === 0 ? 0 : 1);
      L.cellsOn = color === 0 ? 0 : L.cells.length;
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
    this._markCells(L, x, y, w, h, color === 0 ? 0 : 1);
  }

  /**
   * 内蔵フォントでテキストを描く(1文字 8x8)。
   *
   * `scale` を渡すと**1 ドットを四角に置き換えて大きく**する。
   * 2 なら 1 文字 16x16 の「16 ドットフォント」になる。
   * 別の書体を持つのではなく同じ字を太らせるだけなので、字面は変わらない。
   * @param {number} layerIndex
   * @param {number} x 仮想画面座標(ピクセル)
   * @param {number} y
   * @param {string} text
   * @param {number} color 文字色 1..15
   * @param {number} [bg=0] 背景色(0で透明のまま=重ね書き)
   * @param {number} [scale=1] 何倍の大きさで描くか
   */
  print(layerIndex, x, y, text, color = 15, bg = 0, scale = 1) {
    const L = this.layers[layerIndex];
    const layer = L.pixels;
    const k = Math.max(1, Math.round(scale));
    const cw = 8 * k;                        // 1 文字の幅(と高さ)
    // 文字も 8 ドット単位に置く(1 文字 = 1 キャラクタ)
    x = snap8(x); y = snap8(y);
    for (let n = 0; n < text.length; n++) {
      const glyph = getGlyph(text[n]);
      const cx = x + n * cw;
      for (let iy = 0; iy < 8; iy++) {
        const row = glyph[iy] || '';
        for (let sy = 0; sy < k; sy++) {
          const rowBase = ((y + iy * k + sy) & L.maskY) << L.shift;
          for (let ix = 0; ix < 8; ix++) {
            const on = row[ix] === '#';
            const c = on ? color : bg;
            if (c === 0 && bg === 0 && !on) continue;
            for (let sx = 0; sx < k; sx++) {
              layer[rowBase | ((cx + ix * k + sx) & L.maskX)] = c;
            }
          }
        }
      }
    }
    L.empty = false;
    const w = text.length * cw;
    this._blackenCells(L, x, y, w, cw);
    this._enforceRuns(L, x, y, w, cw);
    this._markCells(L, x, y, w, cw, 1);
  }

  /**
   * スプライトを生成して登録する。src は RGBA 画像(自動変換)or 変換済み画像。
   * @param {{colors?:number}} [opts] convert() と同じ。colors:1 で単色スプライト
   */
  createSprite(src, opts) {
    // 絵は spriteSymbol() で作ったものだけ。検査はそこで済んでいる
    this._needSymbol(src, SpriteSymbol, 'スプライト');
    const sprite = new Sprite(src);
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
    // 絵は bgSymbol() で作ったものだけ。横 8 ドット 2 色はそこで済んでいる。
    // BG スプライトは 8 の倍数でなければならない(半端だと端のセルで下と混ざる)。
    // これは絵の大きさで決まるので、作ったときに canBgSprite として持っている
    if (this._needSymbol(src, BgSymbol, 'BG スプライト') && !src.canBgSprite) {
      const msg = `[MMSXX] BG スプライト "${src.name || '名前なし'}": `
        + `大きさは 8 の倍数にしてください (いまは ${src.width}x${src.height})`;
      if (this.bgCheck === 'throw') throw new Error(msg);
      console.warn(msg);
    }
    const sprite = new Sprite(src);
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
    const out = img.derive(px, nameOf(img, '走査線'));
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
    const out = img.derive(px, nameOf(img, '色替え'));
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
    const out = img.derive(px, nameOf(img, 'セル埋め'));
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
  /** そのコマに出ているか(見えない / 点滅で消えているコマは出ていない) */
  _spriteShows(s) {
    if (!s.visible) return false;
    const bl = s.blink | 0;
    if (bl <= 1) return true;
    const ph = (s.blinkPhase == null ? s._autoPhase : s.blinkPhase) | 0;
    return ((this.frames + ph) % bl) < Math.max(1, s.blinkOn | 0);
  }

  /** いま出している絵の、画面での高さ(回転と拡大を入れたもの) */
  _spriteHeight(s) {
    let img = s.image;
    if (s.frames && s.frames.length) {
      const step = Math.max(1, s.frameRate | 0);
      let n = Math.floor((this.frames + (s.framePhase | 0)) / step);
      n = s.frameLoop ? (n % s.frames.length) : Math.min(n, s.frames.length - 1);
      img = s.frames[n] || s.image;
    }
    if (!img) return 0;
    const r = ((s.rotate | 0) % 360 + 360) % 360;
    const h = (r === 90 || r === 270) ? img.width : img.height;
    return h * Math.max(1, Math.min(2, s.mag | 0) || 1);
  }

  _drawSprites(list, bg) {
    const all = [...list];
    const sprites = all.sort(this._spriteOrder(all.length));
    // BG スプライトと、制限を切っているときは今までどおり
    if (bg || !this.spriteLimit) {
      for (const s of sprites) this._drawSprite(s, bg);
      return;
    }
    const H = this.height;
    if (!this._lineUse || this._lineUse.length < H) this._lineUse = new Uint8Array(H);
    this._lineUse.fill(0);
    const n = sprites.length;
    if (!this._rowOk || this._rowOk.length < n * 2) this._rowOk = new Uint32Array(n * 2);
    const ok = this._rowOk;
    // **数えるのは手前から。** あふれた行は、優先度の低いほうが落ちる。
    // 並びは奥 -> 手前なので、後ろから見ていく
    for (let i = n - 1; i >= 0; i--) {
      ok[i * 2] = 0; ok[i * 2 + 1] = 0;
      const s = sprites[i];
      if (!this._spriteShows(s)) continue;   // 出ていないものは席を取らない
      const h = Math.min(64, this._spriteHeight(s));
      const top = Math.round(s.y);
      for (let r = 0; r < h; r++) {
        const y = top + r;
        if (y < 0 || y >= H) continue;
        if (this._lineUse[y] >= this.spriteLimit) continue;   // この行はもう埋まった
        this._lineUse[y]++;
        ok[i * 2 + (r >> 5)] |= (1 << (r & 31));
      }
    }
    // **描くのは奥から**(重なりの前後は今までどおり)
    for (let i = 0; i < n; i++) this._drawSprite(sprites[i], bg, ok, i * 2);
  }

  /**
   * 並べ替えのしかた。優先度が同じものは、`spriteRotate` が true なら
   * **コマごとに順番を回す**(いつも同じものが消えないように)
   */
  _spriteOrder(n) {
    if (!this.spriteRotate || n < 2) return (a, b) => a.priority - b.priority;
    // **枚数で割った余り**で並べる。コマが進むごとに、いちばん先だったものが
    // 最後へ回る(実機のゲームがやっていた「順ぐりに入れ替える」やりかた)
    const t = this.frames | 0;
    const key = (s) => (((s._autoPhase | 0) + t) % n);
    return (a, b) => (a.priority - b.priority) || (key(a) - key(b));
  }

  /**
   * スプライトを 1 枚描く(bg=true なら 8 ドット単位に丸める)。
   * @param {?Uint32Array} [rowOk] 行ごとの「描いてよい」印(1 行制限が入っているとき)
   * @param {number} [rowAt] rowOk の中のこのスプライトの位置
   */
  _drawSprite(s, bg, rowOk, rowAt) {
    const frame = this.activeIdx;
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
      // 拡大(1 ドットを mag x mag の四角にする)。1 のときは今までと同じ道を通る
      const mag = Math.max(1, Math.min(2, s.mag | 0)) || 1;
      const dh = img.height * mag, dw = img.width * mag;
      for (let dy = 0; dy < dh; dy++) {
        // 1 行に出せる数を超えていた行は、この 1 枚ぶんだけ描かない
        if (rowOk && dy < 64 && !((rowOk[rowAt + (dy >> 5)] >>> (dy & 31)) & 1)) continue;
        const y = by + dy;
        if (y < 0 || y >= H) continue;
        const srcBase = ((mag === 1) ? dy : (dy / mag) | 0) * img.width;
        for (let dx = 0; dx < dw; dx++) {
          const x = bx + dx;
          if (x < 0 || x >= W) continue;
          const c = img.pixels[srcBase + ((mag === 1) ? dx : (dx / mag) | 0)];
          if (c !== 0) frame[y * W + x] = c;
        }
      }
    }
  }

  /** 全レイヤー + 全スプライトを合成して canvas に描画する */
  render() {
    this.frames = (this.frames || 0) + 1;
    const profAt = this.profile ? performance.now() : 0;
    // **溜めたコマをそのまま出す**ときは、合成をまるごと飛ばす。
    // レイヤーもスプライトも割り込めないので、ドットが完全に一致する
    // (録画するときは、余計なものが混じらないこちらを使う)
    if (this._showFrame) {
      const src = this._showFrame, dst2 = this.frame32, pal2 = this.pal32;
      for (let i = 0; i < src.length; i++) dst2[i] = pal2[src[i]];
      this.ctx.putImageData(this.imageData, 0, 0);
      return;
    }
    // 合成のあいだは**パレット番号のまま**扱う(色に直すのは最後の 1 回だけ)
    const frame = this.activeIdx;
    const W = this.width, H = this.height;
    const back = this.backdrop || 1;

    // 背景色 + レイヤー合成 (layer0 が奥)。
    // BG スプライトはレイヤーと同じ優先度空間を使うので、ここで混ぜて描く。
    // BG スプライトの priority = n は「レイヤー n の手前」を意味する
    // (n が負なら全部のレイヤーより奥)。
    frame.fill(back);
    // スプライトをまとめて隠しているあいだは、1 枚も描かない
    // (リプレイのように「溜めた絵だけ」を見せたいときに使う)
    const bgList = this.spritesHidden ? [] : [...this.bgSprites].sort((a, b) => a.priority - b.priority);
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
      const cells = L.cells, cw = L.cellW;
      // **まばらなときだけ**セル単位で飛ばす。
      // 星空のように全部のセルに何か入っていると、飛ばす判定が丸損になる
      const sparse = L.cellsOn < cells.length * this.sparseRatio;
      for (let y = 0; y < H; y++) {
        if (scan !== null && ((y + scan) & 1)) continue;
        const vy = y + sy;
        if (!L.repeatY && (vy < 0 || vy >= L.height)) continue;
        const rowBase = (vy & L.maskY) << L.shift;
        let o = y * W;
        if (!sparse) {
          for (let x = 0; x < W; x++, o++) {
            const vx = x + sx;
            if (!L.repeatX && (vx < 0 || vx >= L.width)) continue;
            const c = px[rowBase | (vx & L.maskX)];
            if (c !== 0) frame[o] = c;
          }
          continue;
        }
        // このセル行の先頭。**空のセルは 8 ドットまとめて飛ばす**
        const cellRow = ((vy & L.maskY) >> 3) * cw;
        for (let x = 0; x < W;) {
          const vxRaw = x + sx;
          const vx = vxRaw & L.maskX;
          // このセルに残っている幅(セルの切れ目でそろえる)
          const run = Math.min(8 - (vx & 7), W - x);
          if ((L.repeatX || (vxRaw >= 0 && vxRaw < L.width))
              && cells[cellRow + (vx >> 3)]) {
            // セルの中では折り返しが起きないので、添字の丸めが要らない
            const base = rowBase | vx;
            for (let i = 0; i < run; i++) {
              const c = px[base + i];
              if (c !== 0) frame[o + i] = c;
            }
          }
          x += run; o += run;
        }
      }
    }

    // いちばん手前のレイヤーより手前に置かれた BG スプライト
    while (bi < bgList.length) this._drawSprite(bgList[bi++], true);
    // スプライト (priority 昇順 = 大きいほど後=手前)
    if (!this.spritesHidden) this._drawSprites(this.sprites, false);

    // ボーダーと画面ずらしを付けて、実際に出す面へ写す。
    // どちらも無いときは activeIdx と outIdx が同じものなので、写す手間は要らない
    if (!this._plain || this.adjustX || this.adjustY) this._present(back);

    // 直前のコマを溜めている最中なら、**色に直す前**に写しておく。
    // 番号のままなら 1 ドット 1 バイトで済むので、色に直したものより 4 分の 1 で持てる
    if (this._keepFrames > 0) this._pushFrame();

    // ここで初めて「番号 -> 色」に直す。画面のドット数ぶんだけで済む
    const out = this.outIdx, dst = this.frame32, pal = this.pal32;
    for (let i = 0; i < out.length; i++) dst[i] = pal[out[i]];

    // canvas は等倍なので、そのまま置くだけ。拡大は CSS(ブラウザ)がやる
    this.ctx.putImageData(this.imageData, 0, 0);
    if (this.profile) this._profile(performance.now() - profAt);
  }

  /**
   * 合成にかかった時間をためて、ときどき console に出す(開発版だけ)。
   * レイヤーごとの「絵の入っているセルの割合」と、
   * **どちらの道を通ったか**もいっしょに出す(境目を決める材料にする)。
   */
  _profile(ms) {
    const t = this._profTimes;
    t.push(ms);
    if (t.length < this.profileEvery) return;
    t.sort((a, b) => a - b);
    const mid = t[t.length >> 1];
    const avg = t.reduce((a, b) => a + b, 0) / t.length;
    const worst = t[t.length - 1];
    const rows = this.layers.map((L, i) => {
      const pct = Math.round((L.cellsOn * 100) / L.cells.length);
      const how = L.empty ? 'まるごと飛ばす'
        : (L.cellsOn < L.cells.length * this.sparseRatio ? 'セル飛ばし' : '通常');
      return `  レイヤー${i}: 埋まり ${pct}% ${how}`;
    });
    const nl = String.fromCharCode(10);
    console.log(`[MMSXX] 合成 ${t.length} コマ: `
      + `中央値 ${mid.toFixed(3)}ms / 平均 ${avg.toFixed(3)}ms / 最悪 ${worst.toFixed(3)}ms`
      + ` (境目 ${this.sparseRatio})` + nl + rows.join(nl));
    this._profTimes = [];
  }

  /**
   * 描画領域を、ボーダーとずらしのぶんだけ動かして表示面へ写す。
   * はみ出したところは切り落とし、空いたところは背景色のまま
   * (反対側から回り込ませない)。
   */
  _present(back) {
    const out = this.outIdx, src = this.activeIdx;
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
