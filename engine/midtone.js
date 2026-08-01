// MSX の 15 色と、そこから作れる「中間色」の表。
//
// 実機のパレットは 15 色しかない。けれど 2 色を **1 ライン おきのディザ**で
// 並べ、1 コマごとに 2 色を入れ替えると、目のなかで混ざってあいだの色に見える。
// この表は「どの 2 色を組にすると、きれいな中間色になるか」を先に決めたもの。
// **書き出しのときに 1 度だけ作る**。ゲーム中に計算することはない。
//
// エンジンとアセット作成スクリプトの両方から使う(色の決まりを 1 か所に置く)。

/** MSX1 の 16 色(0 は透明あつかい。1 が黒) */
export const MSX_PALETTE = [
  [0, 0, 0], [0, 0, 0], [62, 184, 73], [116, 208, 125], [89, 85, 224], [128, 118, 241],
  [185, 94, 81], [101, 219, 239], [219, 101, 89], [255, 137, 125], [204, 195, 94],
  [222, 208, 135], [58, 162, 65], [183, 102, 181], [204, 204, 204], [255, 255, 255],
];

/** 同じものの '#rrggbb' 版 */
export const MSX_HEX = [
  '#000000', '#000000', '#3eb849', '#74d07d', '#5955e0', '#8076f1',
  '#b95e51', '#65dbef', '#db6559', '#ff897d', '#ccc35e', '#ded087',
  '#3aa241', '#b766b5', '#cccccc', '#ffffff',
];

/** '#rrggbb' -> [r,g,b] */
export function hexRGB(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** いちばん近いパレット番号(1..15)。0 は透明なので候補に入れない */
export function nearestMsxColor(r, g, b) {
  let best = 1, bestD = Infinity;
  for (let i = 1; i <= 15; i++) {
    const p = MSX_PALETTE[i];
    const d = 3 * (r - p[0]) ** 2 + 6 * (g - p[1]) ** 2 + (b - p[2]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

const dist = (p, q) => 3 * (p[0] - q[0]) ** 2 + 6 * (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

/**
 * 使える中間色の表を作る。15 色の 1:1 総当たり 105 通りから選ぶ。
 *
 * ふるいにかける決まり:
 *   ・明るさの差が開きすぎている組は落とす。色が混ざる前に
 *     「明るい/暗い」の点滅として見えてしまうため
 *   ・できた中間色が元の 15 色とほとんど同じなら落とす。増えないので意味がない
 *
 * ただし **黒(1)との組だけは例外**。明るさの差は必ず大きくなるが、
 * 暗い色は黒と組ませるしか作りようがない。目にはきつい組なので
 * `harsh: true` の印を付けて、影など面積の小さいところで使う。
 */
function buildMidTones() {
  const out = [];
  for (let a = 1; a < 16; a++) {
    for (let b = a + 1; b < 16; b++) {
      const pa = MSX_PALETTE[a], pb = MSX_PALETTE[b];
      const harsh = (a === 1);              // 黒との組
      if (!harsh && Math.abs(lum(pa) - lum(pb)) > 70) continue;
      if (!harsh && dist(pa, pb) > 300000) continue;
      const rgb = [0, 1, 2].map(i => Math.round((pa[i] + pb[i]) / 2));
      let near = Infinity;
      for (let c = 1; c < 16; c++) near = Math.min(near, dist(rgb, MSX_PALETTE[c]));
      if (near < 400) continue;
      out.push({ a, b, rgb, harsh });
    }
  }
  return out;
}

/** 使える中間色の一覧 */
export const MID_TONES = buildMidTones();

/** 組(色番号 2 つ)が表にあるか。無ければ null */
export function findMidTone(a, b) {
  const [x, y] = a < b ? [a, b] : [b, a];
  return MID_TONES.find(t => t.a === x && t.b === y) || null;
}

/** '#rrggbb' 2 つで引く */
export function findMidToneHex(ca, cb) {
  return findMidTone(nearestMsxColor(...hexRGB(ca)), nearestMsxColor(...hexRGB(cb)));
}
