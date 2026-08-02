// MSX1 (TMS9918A) 15色パレット + 透明色(0)
// 実機の代表的な近似RGB値。index 0 は透明。
export const VDP_PALETTE = [
  [0, 0, 0],       // 0: transparent (値は未使用)
  [0, 0, 0],       // 1: black
  [62, 184, 73],   // 2: medium green
  [116, 208, 125], // 3: light green
  [89, 85, 224],   // 4: dark blue
  [128, 118, 241], // 5: light blue
  [185, 94, 81],   // 6: dark red
  [101, 219, 239], // 7: cyan
  [219, 101, 89],  // 8: medium red
  [255, 137, 125], // 9: light red
  [204, 195, 94],  // 10: dark yellow
  [222, 208, 135], // 11: light yellow
  [58, 162, 65],   // 12: dark green
  [183, 102, 181], // 13: magenta
  [204, 204, 204], // 14: gray
  [255, 255, 255], // 15: white
];

/**
 * 色合いの流派。**同じ 15 色でも、機械や資料によって RGB がちがう**。
 *
 * TMS9918A はアンテナ(コンポジット)出力だったので、
 * 「本当の色」が 1 つに決まらない。実機を測った人・資料から起こした人で
 * 値が違い、エミュレータもいくつかの流派を切り替えられるようになっている。
 *
 * ここでは代表的なものを持っておいて、走らせたまま切り替えられるようにする。
 * 並びは番号 1..15(0 は透明なので持たない)。
 */
export const PALETTES = {
  // いままでの色。落ち着いた中間色寄りで、このエンジンの既定
  tms9918: [
    [0, 0, 0], [62, 184, 73], [116, 208, 125], [89, 85, 224], [128, 118, 241],
    [185, 94, 81], [101, 219, 239], [219, 101, 89], [255, 137, 125],
    [204, 195, 94], [222, 208, 135], [58, 162, 65], [183, 102, 181],
    [204, 204, 204], [255, 255, 255],
  ],
  // TI の資料(輝度・色差)から起こしたもの。少し明るく、緑が強い。
  // 多くのエミュレータが「TMS9918 の色」として持っている値
  tms9918a: [
    [0, 0, 0], [33, 200, 66], [94, 220, 120], [84, 85, 237], [125, 118, 252],
    [212, 82, 77], [66, 235, 245], [252, 85, 84], [255, 121, 120],
    [212, 193, 84], [230, 206, 128], [33, 176, 59], [201, 91, 186],
    [204, 204, 204], [255, 255, 255],
  ],
  // MSX2 以降(V9938)が「MSX1 の 15 色」として出す色。
  // デジタル RGB 出力なので値がきれいに揃っていて、原色がはっきり出る
  v9938: [
    [0x00, 0x00, 0x00], [0x22, 0xDD, 0x22], [0x66, 0xFF, 0x66], [0x22, 0x22, 0xFF],
    [0x44, 0x66, 0xFF], [0xAA, 0x22, 0x22], [0x44, 0xDD, 0xFF], [0xFF, 0x22, 0x22],
    [0xFF, 0x66, 0x66], [0xDD, 0xDD, 0x22], [0xDD, 0xDD, 0x88], [0x22, 0x88, 0x22],
    [0xDD, 0x44, 0xAA], [0xAA, 0xAA, 0xAA], [0xFF, 0xFF, 0xFF],
  ],
};

/** いま選んでいる色合いの名前 */
let paletteName = 'tms9918';

/** 色合いの名前の一覧(切り替えの順番でもある) */
export const PALETTE_NAMES = Object.keys(PALETTES);

/** いま選んでいる色合いの名前 */
export function currentPalette() { return paletteName; }

/**
 * 色合いを切り替える。**表そのものを書き換える**(番号は変えない)。
 * 絵は色番号で持っているので、描き直さずに色だけ変わる。
 * @param {string} name PALETTES の名前
 * @returns {boolean} 切り替えたか
 */
export function setPalette(name) {
  const p = PALETTES[name];
  if (!p) return false;
  for (let i = 1; i <= 15; i++) VDP_PALETTE[i] = p[i - 1].slice();
  paletteName = name;
  return true;
}

// 距離計算用の重み(輝度感度: G > R > B)
const WR = 3, WG = 6, WB = 1;

/** RGB値に最も近いMSXパレット番号(1..15)を返す */
export function nearestColor(r, g, b) {
  let best = 1;
  let bestD = Infinity;
  for (let i = 1; i <= 15; i++) {
    const p = VDP_PALETTE[i];
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = WR * dr * dr + WG * dg * dg + WB * db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * RGBA(8bit)画像を MSX1 SCREEN2 風の制約付きインデックス画像に変換する。
 * 制約: 横8ドット(x=0起点のブロック)ごとに使える色は2色まで。
 * alpha < 128 のピクセルは色0(透明)。
 * (8x8セル単位の黒不透明化はレイヤー描画時 = VDP.drawToLayer 側で行う)
 *
 * @param {Uint8Array|Uint8ClampedArray} data RGBA並びのバイト列
 * @param {number} width
 * @param {number} height
 * @returns {{width:number, height:number, pixels:Uint8Array}}
 */
export function convertRGBA(data, width, height) {
  const pixels = new Uint8Array(width * height);
  const count = new Uint32Array(16);
  for (let y = 0; y < height; y++) {
    for (let bx = 0; bx < width; bx += 8) {
      const bw = Math.min(8, width - bx);
      // ブロック内の各ピクセルを最近傍パレット色に量子化し、頻度を数える
      count.fill(0);
      for (let i = 0; i < bw; i++) {
        const o = (y * width + bx + i) * 4;
        if (data[o + 3] < 128) { pixels[y * width + bx + i] = 0; continue; }
        const c = nearestColor(data[o], data[o + 1], data[o + 2]);
        pixels[y * width + bx + i] = c;
        count[c]++;
      }
      // 頻度上位2色を選ぶ
      let c1 = 0, c2 = 0, n1 = 0, n2 = 0;
      for (let c = 1; c <= 15; c++) {
        if (count[c] > n1) { c2 = c1; n2 = n1; c1 = c; n1 = count[c]; }
        else if (count[c] > n2) { c2 = c; n2 = count[c]; }
      }
      if (c2 === 0) c2 = c1;
      if (c1 === 0) continue; // 全ピクセル透明
      // 3色目以降を c1/c2 の近い方へ寄せる
      const p1 = VDP_PALETTE[c1], p2 = VDP_PALETTE[c2];
      for (let i = 0; i < bw; i++) {
        const idx = y * width + bx + i;
        const c = pixels[idx];
        if (c === 0 || c === c1 || c === c2) continue;
        const o = (idx) * 4;
        const r = data[o], g = data[o + 1], b = data[o + 2];
        const d1 = WR * (r - p1[0]) ** 2 + WG * (g - p1[1]) ** 2 + WB * (b - p1[2]) ** 2;
        const d2 = WR * (r - p2[0]) ** 2 + WG * (g - p2[1]) ** 2 + WB * (b - p2[2]) ** 2;
        pixels[idx] = d1 <= d2 ? c1 : c2;
      }
    }
  }
  return { width, height, pixels };
}

/**
 * RGBA(8bit)画像を「画像全体で maxColors 色まで」のインデックス画像に変換する。
 * MSX1 の単色スプライト(1色)や、スプライト2枚重ね(2色)の再現に使う。
 * alpha < 128 のピクセルは色0(透明)。
 *
 * @param {Uint8Array|Uint8ClampedArray} data RGBA並びのバイト列
 * @param {number} maxColors 1..15
 * @returns {{width:number, height:number, pixels:Uint8Array}}
 */
export function convertRGBAFlat(data, width, height, maxColors) {
  const pixels = new Uint8Array(width * height);
  const count = new Uint32Array(16);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    const c = nearestColor(data[o], data[o + 1], data[o + 2]);
    pixels[i] = c;
    count[c]++;
  }
  // 使用頻度上位 maxColors 色を許可リストにする
  const allowed = [];
  for (let n = 0; n < maxColors; n++) {
    let best = 0, bestN = 0;
    for (let c = 1; c <= 15; c++) {
      if (!allowed.includes(c) && count[c] > bestN) { best = c; bestN = count[c]; }
    }
    if (best === 0) break;
    allowed.push(best);
  }
  if (allowed.length === 0) return { width, height, pixels };
  // 許可リスト外の色を最も近い許可色へ寄せる
  for (let i = 0; i < width * height; i++) {
    const c = pixels[i];
    if (c === 0 || allowed.includes(c)) continue;
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    let best = allowed[0], bestD = Infinity;
    for (const a of allowed) {
      const p = VDP_PALETTE[a];
      const d = WR * (r - p[0]) ** 2 + WG * (g - p[1]) ** 2 + WB * (b - p[2]) ** 2;
      if (d < bestD) { bestD = d; best = a; }
    }
    pixels[i] = best;
  }
  return { width, height, pixels };
}

/** FNV-1a ハッシュ(変換キャッシュのキー用) */
export function hashRGBA(data, width, height) {
  let h = 0x811c9dc5;
  h = Math.imul(h ^ width, 0x01000193);
  h = Math.imul(h ^ height, 0x01000193);
  for (let i = 0; i < data.length; i++) {
    h = Math.imul(h ^ data[i], 0x01000193);
  }
  return h >>> 0;
}
