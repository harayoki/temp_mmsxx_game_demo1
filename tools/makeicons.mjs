// **ホーム画面に置くアイコンを作る。**
//
//   node tools/makeicons.mjs        # icons/ に並ぶ
//   node tools/makeicons.mjs --dev  # icons-dev/ に並ぶ(自機の色が違う)
//
// ## 手で描いた PNG を持たない
//
// アイコンは**ゲームの中の絵そのもの**(game/gamedata.js の自機)から起こす。
// 別に描き起こすと、絵を直したときにアイコンだけ古いまま取り残される。
// ここを走らせ直せば、いつでも今の自機の姿になる。
//
// ## 入れるものは無い
//
// PNG は zlib(node に入っている)だけで書く。画像の部品を npm から入れない。
// 出すのは 8bit RGBA の、圧縮していない PNG(小さい絵なので十分)。
//
// ## 3 枚 作る
//
//   icon-192.png          … ふつうのアイコン(小)
//   icon-512.png          … ふつうのアイコン(大)
//   icon-maskable-512.png … **端を切られてもよい**もの
//
// maskable は OS が好きな形(丸・角丸・雫)に切り抜く。切られても残るのは
// **真ん中の直径 80% の円の中**だけなので、そこへ収まる大きさにしてある。
// ふつうのほうは切られないので、そのぶん大きく置ける。

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_DATA } from '../game/gamedata.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * **開発版のぶんは色を変えて別に出す。**
 *
 * ホーム画面に本番と開発版を両方置くと、**アイコンが同じなので取り違える**。
 * どちらを触っているのか分からないまま遊ぶことになるので、
 * 自機の色で見分けが付くようにする(build-deploy.ps1 が -Local のとき
 * こちらを配る)
 */
const DEV_ICONS = process.argv.includes('--dev');
const outDir = path.join(root, DEV_ICONS ? 'icons-dev' : 'icons');

/** 地の色。**ゲームの宇宙と同じ黒**(manifest の background_color と揃える) */
const BG = [0, 0, 0];
/** 星の色。MSX の白と灰(明るさを 2 段に分けると、平らに見えない) */
const STARS = [[255, 255, 255], [170, 170, 170]];

/**
 * 絵の中の 1 枚を、幅・高さ・RGBA の並びにして取り出す。
 * gamedata.js は base64 の RGBA(1 ドット 4 バイト)で持っている
 */
function image(name) {
  const src = GAME_DATA.images[name];
  if (!src) throw new Error(`game/gamedata.js に "${name}" がありません`);
  return { w: src.width, h: src.height, rgba: Buffer.from(src.b64, 'base64') };
}

/**
 * **星を撒く。** 毎回同じ絵になるよう、乱数は自前の数え上げで作る
 * (走らせるたびに違う絵になると、差分を見ても何が変わったか分からない)。
 * 置くのは**ドットの格子の上**。半端な位置に置くと、そこだけ滲んで見える
 * @param {number} cells 1 辺が何ドットぶんか
 * @param {number} skip このドットより内側は空ける(自機の居場所)
 */
function starField(cells, skip) {
  const out = [];
  let seed = 20260810;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < cells * cells; i++) {
    if (rnd() > 0.045) continue;
    const x = i % cells, y = (i / cells) | 0;
    // 自機に掛かるところは置かない(重なると自機の輪郭が読めなくなる)
    if (Math.abs(x - (cells - 1) / 2) < skip && Math.abs(y - (cells - 1) / 2) < skip) continue;
    out.push([x, y, STARS[rnd() < 0.4 ? 0 : 1]]);
  }
  return out;
}

/**
 * アイコンを 1 枚 組む。
 * @param {number} size 出来上がりの 1 辺(px)
 * @param {number} scale 絵の 1 ドットを何 px にするか
 */
function draw(size, scale) {
  const art = image('player');
  const px = Buffer.alloc(size * size * 4);
  // 地を塗る(透かさない。**透けると OS が白を敷いて、黒い自機が消える**)
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = BG[0]; px[i * 4 + 1] = BG[1]; px[i * 4 + 2] = BG[2]; px[i * 4 + 3] = 255;
  }
  // 星。格子の 1 マスは自機のドットと同じ大きさにそろえる
  const cells = Math.floor(size / scale);
  const pad = Math.round((size - cells * scale) / 2);
  const put = (cx, cy, rgb) => {
    for (let y = 0; y < scale; y++) {
      for (let x = 0; x < scale; x++) {
        const gx = pad + cx * scale + x, gy = pad + cy * scale + y;
        if (gx < 0 || gy < 0 || gx >= size || gy >= size) continue;
        const o = (gy * size + gx) * 4;
        px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
      }
    }
  };
  for (const [x, y, rgb] of starField(cells, art.w / 2 + 1)) put(x, y, rgb);
  // 自機を真ん中へ。**格子の上に載せる**ので、星と同じ目の粗さになる
  const ox = Math.floor((cells - art.w) / 2), oy = Math.floor((cells - art.h) / 2);
  for (let y = 0; y < art.h; y++) {
    for (let x = 0; x < art.w; x++) {
      const o = (y * art.w + x) * 4;
      if (art.rgba[o + 3] < 128) continue;      // 透いているところは地のまま
      put(ox + x, oy + y, tint([art.rgba[o], art.rgba[o + 1], art.rgba[o + 2]]));
    }
  }
  return png(size, size, px);
}

/**
 * **開発版だけ、自機の色をずらす。**
 *
 * 色の輪を回すのではなく、**RGB の並びをずらす**([r,g,b] → [g,b,r])。
 * こうすると**白と灰はそのまま**(3 つが同じ値なので動かない)で、
 * 色の付いているところだけが変わる ── 青い機体が緑になり、
 * 白いところは白のまま残るので、絵の形は崩れない
 */
function tint(rgb) {
  return DEV_ICONS ? [rgb[1], rgb[2], rgb[0]] : rgb;
}

/** 8bit RGBA の PNG を組み立てる */
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                   // フィルタ無し
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;      // 1 色 8bit
  ihdr[9] = 6;      // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

await mkdir(outDir, { recursive: true });
// **切られないほうは大きく、maskable は小さく。**
// maskable で残るのは真ん中の直径 80% の円の中。自機は正方形なので、
// 対角がその円に収まる大きさ(1 辺 <= 0.8 * size / √2 = 約 0.56 * size)にする
const jobs = [
  ['icon-192.png', 192, 9],              // 自機 144px(1 辺の 75%)
  ['icon-512.png', 512, 24],             // 自機 384px(同上)
  ['icon-maskable-512.png', 512, 16],    // 自機 256px(1 辺の 50%。円に収まる)
];
for (const [name, size, scale] of jobs) {
  const file = path.join(outDir, name);
  await writeFile(file, draw(size, scale));
  console.log(`${name.padEnd(24)} ${size}x${size}  自機 ${16 * scale}px  ${path.relative(root, file)}`);
}
console.log('');
console.log('できました:', path.relative(root, outDir));
