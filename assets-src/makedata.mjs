// ゲームデータ生成スクリプト
//   node assets-src/makedata.mjs
// を実行すると game/gamedata.js が生成される。
// アセット(ドット絵 / 曲 / 効果音 / 敵出現テーブル)はすべてこのファイルの
// コードとして記述する。画像は RGB8bit(RGBA) で出力され、エンジン側が
// 実行時に MSX1 制約(15色 + 横8ドット2色)へ自動変換する。

import { writeFileSync, mkdirSync } from 'node:fs';
// 色の決まりはエンジン側に置いてある(ここと実行時で同じものを使う)
import { VDP_PALETTE, VDP_HEX, MID_TONES, nearestVdpColor, findMidToneHex }
  from '../engine/midtone.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- ユーティリティ

/** 幅x高さの透明RGBA画像 */
function createImage(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function setPixel(img, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
}

/** 1 ドットを透明に戻す(抜き文様を入れるときに使う) */
function clearPixel(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data[(y * img.width + x) * 4 + 3] = 0;
}

/** '#rrggbb' -> [r,g,b] */
function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** ASCIIアートからRGBA画像を作る。'.'は透明。 */
function fromAscii(rows, colors) {
  const height = rows.length;
  const width = rows[0].length;
  const img = createImage(width, height);
  for (let y = 0; y < height; y++) {
    if (rows[y].length !== width) {
      throw new Error(`fromAscii: row ${y} の長さが不一致 (${rows[y].length} != ${width})`);
    }
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      const c = colors[ch];
      if (!c) throw new Error(`fromAscii: 未定義の色文字 '${ch}'`);
      setPixel(img, x, y, hex(c));
    }
  }
  return img;
}

/**
 * 好きな大きさの枠の真ん中に収める(はみ出したところは切る)。
 * スプライトの大きさは **16 の倍数**にそろえたいので、その調整に使う
 */
function padTo(src, w, h, anchor = 'center') {
  const img = createImage(w, h);
  // 'topleft' は元の絵の位置をずらさない(置き場所の指定を変えずに枠だけ広げる)
  const ox = anchor === 'topleft' ? 0 : (w - src.width) >> 1;
  const oy = anchor === 'topleft' ? 0 : (h - src.height) >> 1;
  for (let y = 0; y < src.height; y++) {
    const dy = y + oy;
    if (dy < 0 || dy >= h) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x + ox;
      if (dx < 0 || dx >= w) continue;
      const si = (y * src.width + x) * 4;
      if (src.data[si + 3] < 128) continue;
      const di = (dy * w + dx) * 4;
      img.data[di] = src.data[si]; img.data[di + 1] = src.data[si + 1];
      img.data[di + 2] = src.data[si + 2]; img.data[di + 3] = 255;
    }
  }
  return img;
}

function pad16(src) {
  const img = createImage(16, 16);
  const ox = (16 - src.width) >> 1, oy = (16 - src.height) >> 1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      if (src.data[s + 3] < 128) continue;
      const d = ((y + oy) * 16 + (x + ox)) * 4;
      img.data[d] = src.data[s]; img.data[d + 1] = src.data[s + 1];
      img.data[d + 2] = src.data[s + 2]; img.data[d + 3] = 255;
    }
  }
  return img;
}

/**
 * MML のキーを半音単位で移調する。
 * 音符だけを動かし、テンポ・音量・波形などの命令はそのまま通す。
 * `>` `<` の相対オクターブは読み取り側で解釈して、出力では `o<n>` に直す。
 * @param {string} mml
 * @param {number} semitones 半音いくつ上げるか(負なら下げる)
 */
function transposeMML(mml, semitones) {
  const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const NAME = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'];
  let inOct = 4;     // 読んでいる側のいまのオクターブ
  let outOct = null; // 書き出した側のいまのオクターブ
  let out = '';
  for (let i = 0; i < mml.length;) {
    const ch = mml[i];
    // オクターブ指定
    if (ch === 'o' && /\d/.test(mml[i + 1] || '')) {
      let j = i + 1, n = '';
      while (/\d/.test(mml[j] || '')) n += mml[j++];
      inOct = parseInt(n, 10);
      i = j;
      continue;
    }
    if (ch === '>') { inOct++; i++; continue; }
    if (ch === '<') { inOct--; i++; continue; }
    // 音符
    if (NOTE[ch] !== undefined) {
      let j = i + 1, acc = 0;
      while (mml[j] === '+' || mml[j] === '#' || mml[j] === '-') {
        acc += (mml[j] === '-') ? -1 : 1;
        j++;
      }
      let tail = '';
      while (/[\d.]/.test(mml[j] || '')) tail += mml[j++];
      const abs = inOct * 12 + NOTE[ch] + acc + semitones;
      const oct = Math.floor(abs / 12);
      const idx = ((abs % 12) + 12) % 12;
      if (oct !== outOct) { out += 'o' + oct + ' '; outOct = oct; }
      out += NAME[idx] + tail;
      i = j;
      continue;
    }
    // 命令や記号はそのまま。@ のあとの英字 1 文字も一緒に通す
    if (ch === '@') {
      out += ch;
      i++;
      if (/[a-z]/.test(mml[i] || '')) out += mml[i++];
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** MML を「段ばしご番号(オクターブ*7 + 度数)」の並びに直す。ハ長調の 7 音で数える */
function mmlToLadder(mml, startOct = 4) {
  const DEG = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };
  let o = startOct;
  const out = [];
  for (let i = 0; i < mml.length;) {
    const ch = mml[i];
    if (ch === 'o' && /[0-9]/.test(mml[i + 1] || '')) {
      let j = i + 1, n = '';
      while (/[0-9]/.test(mml[j] || '')) n += mml[j++];
      o = parseInt(n, 10); i = j; continue;
    }
    if (ch === '>') { o++; i++; continue; }
    if (ch === '<') { o--; i++; continue; }
    if (DEG[ch] !== undefined) {
      let j = i + 1;
      while (mml[j] === '+' || mml[j] === '#' || mml[j] === '-') j++;
      let tail = '';
      while (/[0-9.]/.test(mml[j] || '')) tail += mml[j++];
      out.push({ step: o * 7 + DEG[ch], tail });
      i = j; continue;
    }
    i++;
  }
  out.endOct = o;
  return out;
}

/** 段ばしご番号の並びを MML に戻す(オクターブは必要なときだけ書く) */
function ladderToMML(notes, startOct = null) {
  const NAME = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
  let outOct = startOct;
  let out = '';
  for (const n of notes) {
    const oct = Math.floor(n.step / 7);
    const deg = ((n.step % 7) + 7) % 7;
    if (oct !== outOct) { out += 'o' + oct + ' '; outOct = oct; }
    out += NAME[deg] + (n.tail || '') + ' ';
  }
  return out.trim();
}

// 和音の構成音(ハ長調の度数。c=0 d=1 e=2 f=3 g=4 a=5 b=6)
const CHORD_TONES = {
  C: [0, 2, 4], Am: [5, 0, 2], F: [3, 5, 0], G: [4, 6, 1],
  Dm: [1, 3, 5], Em: [2, 4, 6], E: [2, 4, 6],
};

/**
 * 主旋律から「反行するハモリ」を作る。
 *  1. 軸を中心に上下をひっくり返す(主旋律が上がるところで下がる)
 *  2. その音を、その小節の和音の構成音へ寄せる(ぶつからない)
 *  3. 主旋律より 3 度以上は上に置く(下に潜らない)
 * @param {string[]} bars 小節ごとの主旋律 MML
 * @param {string[]} chords 小節ごとの和音名
 * @param {number} axis 折り返しの軸(段ばしご番号)
 */
function makeCounterHarmony(bars, chords, axis) {
  const out = [];
  let oct = 4, outOct = null;
  bars.forEach((bar, bi) => {
    const notes = mmlToLadder(bar, oct);
    oct = notes.endOct;
    const tones = CHORD_TONES[chords[bi]] || CHORD_TONES.C;
    const made = notes.map((n, i) => {
      const target = 2 * axis - n.step;      // 反行させた位置
      const floor = n.step + 2;              // 主旋律の 3 度以上は上に
      // 拍の頭は和音の構成音に置いてしっかり重ね、
      // 裏拍は音階のまま通す(経過音)。こうしないと同じ音が続いて動かなくなる
      const onBeat = (i % 2) === 0;
      if (!onBeat) return { step: Math.max(floor, target), tail: n.tail };
      let best = null, bestD = Infinity;
      for (let step = floor; step <= floor + 14; step++) {
        if (!tones.includes(((step % 7) + 7) % 7)) continue;
        const d = Math.abs(step - target);
        if (d < bestD) { bestD = d; best = step; }
      }
      return { step: best, tail: n.tail };
    });
    const mml = ladderToMML(made, outOct);
    const m = mml.match(/o([0-9]+)(?!.*o[0-9])/s);
    if (m) outOct = parseInt(m[1], 10);
    out.push(mml);
  });
  return out.join(' ');
}

/** 再現性のある疑似乱数 (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toB64(img) {
  return Buffer.from(img.data).toString('base64');
}

// ---------------------------------------------------------------- ドット絵

// 自機は**2 色**(単色スプライト 2 枚重ねという体)。
// 白い機体と、影になる青の 2 色だけ。
// もとは 6 色で描いてエンジンに落とさせていたが、
// **素材の時点で 2 色**にした(見た目は落としていたころと同じ)
const SHIP_COLORS = { W: '#ffffff', B: '#5955e0' };

const player = fromAscii([
  '.......WW.......',
  '.......WW.......',
  '......WBBW......',
  '......WBBW......',
  '......WBBW......',
  '.....WWBBWW.....',
  '..B..WWWWWW..B..',
  '..B.BWWWWWWB.B..',
  '..BBBWWBBWWBBB..',
  '.BBBBWWBBWWBBBB.',
  'BBBBBWWWWWWBBBBB',
  'BBBWBWWWWWWBWBBB',
  'BBWWWWWBBWWWWWBB',
  'BBBBWWB..BWWBBBB',
  '..W.WB....BW.W..',
  '..W..........W..',
], SHIP_COLORS);

// 自機の推進炎。スピードアップの段階で大きくなる(段階1では出ない)。
// どちらも単色スプライト 1 枚ぶん。
const flameSmall = fromAscii([
  '......####......',
  '.....######.....',
  '......####......',
  '.......##.......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
], { '#': '#7ce8ff' });

const flameBig = fromAscii([
  '.....######.....',
  '....########....',
  '....########....',
  '.....######.....',
  '.....######.....',
  '......####......',
  '......####......',
  '.......##.......',
  '.......##.......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
], { '#': '#7ce8ff' });

// ドラゴンのアイテムを取ったあとの推進炎。
// 「当たり判定が広がった」ことが一目で分かるよう、色を緑に変えて一回り大きくする。
// 死んでも消えない強化なので、見た目もはっきり別物にしてある
const flameDragon = fromAscii([
  '...##########...',
  '..############..',
  '.##############.',
  '.##############.',
  '.##############.',
  '..############..',
  '..############..',
  '...##########...',
  '....########....',
  '....########....',
  '.....######.....',
  '.....######.....',
  '......####......',
  '......####......',
  '.......##.......',
  '.......##.......',
], { '#': '#3eb849' });

// 推進炎は 2 コマのパラパラアニメ。**外わく**と**中身**を交互に描くと、
// 1 色のままでも炎が脈打って見える(実機のスプライトらしい見せかた)。
// A = 外わくだけ / B = 中身だけ
const flameSmallB = fromAscii([
  '.....######.....',
  '......####......',
  '......####......',
  '.......##.......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
], { '#': '#7ce8ff' });
const flameBigA = fromAscii([
  '.....##..##.....',
  '....##....##....',
  '....#......#....',
  '....#......#....',
  '.....#....#.....',
  '.....#....#.....',
  '......#..#......',
  '......#..#......',
  '.......##.......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
], { '#': '#7ce8ff' });
const flameBigB = fromAscii([
  '................',
  '.....######.....',
  '.....######.....',
  '......####......',
  '......####......',
  '......####......',
  '.......##.......',
  '.......##.......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
], { '#': '#7ce8ff' });
const flameDragonA = fromAscii([
  '...###....###...',
  '..##........##..',
  '.##..........##.',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '..#..........#..',
  '..#..........#..',
  '...#........#...',
  '....#......#....',
  '....#......#....',
  '.....#....#.....',
  '.....#....#.....',
  '......#..#......',
  '......#..#......',
  '.......##.......',
], { '#': '#3eb849' });
const flameDragonB = fromAscii([
  '................',
  '....########....',
  '...##########...',
  '...##########...',
  '...##########...',
  '....########....',
  '....########....',
  '.....######.....',
  '.....######.....',
  '.....######.....',
  '......####......',
  '......####......',
  '......####......',
  '.......##.......',
  '.......##.......',
  '................',
], { '#': '#3eb849' });

const enemyA = fromAscii([
  '..G..........G..',
  '...G........G...',
  '...GGGGGGGGGG...',
  '..GG.GGGGG.GGG..',
  '.GGG..GGGG..GGG.',
  '.GGGGGGGGGGGGGG.',
  'GG.GGGGGGGGGG.GG',
  'GG.GGGGGGGGGG.GG',
  'G..GGGGGGGGGG..G',
  'G..GG.GGGG.GG..G',
  '...GG.GGGG.GG...',
  '..GG..GGGG..GG..',
  '.GG....GG....GG.',
  '.G.....GG.....G.',
  '................',
  '................',
  // 単色スプライトなので**緑 1 色**。目は抜き(黒)で表す
], { G: '#4fd44f' });

const enemyB = fromAscii([
  '................',
  '......RRRR......',
  '....RRYYYYRR....',
  '...RRYYWWYYRR...',
  '..RRRYYYYYYRRR..',
  '.RRRRRRRRRRRRRR.',
  'RM.RRM.RRM.RRM.R',
  '.RRRRRRRRRRRRRR.',
  '..RR..RRRR..RR..',
  '...R...RR...R...',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  // 単色スプライトなので**赤 1 色**。目や口は抜きで表す
], { R: '#f04848', Y: '#f04848', W: '#f04848', M: '#f04848' });

// 自機の弾。ミサイル型だと斜め撃ちで向きが合わないので、敵弾と同じ大きさのただの丸にする
const bulletP = fromAscii([
  '.YYY.',
  'YYYYY',
  'YYYYY',
  'YYYYY',
  '.YYY.',
], { Y: '#ffe34d' });

// ボスの弾。グラディウスのモアイのような、ぽわぽわ飛ぶ 16x16 のリング
const bulletRing = fromAscii([
  '.....######.....',
  '...##########...',
  '..####....####..',
  '.###........###.',
  '.##..........##.',
  '###..........###',
  '##............##',
  '##............##',
  '##............##',
  '##............##',
  '###..........###',
  '.##..........##.',
  '.###........###.',
  '..####....####..',
  '...##########...',
  '.....######.....',
], { '#': '#ff5ad0' });

// 敵弾。斜めに飛んでも自然に見えるよう丸くする
const bulletE = fromAscii([
  '.MMM.',
  'MMMMM',
  'MMMMM',
  'MMMMM',
  '.MMM.',
], { M: '#ff5ad0' });

// 硬いキューブ (10発当てないと壊せない)。自機を追わずに落ちてくるだけ
// 色違いで使い回していた敵に、それぞれ専用の絵を用意する。
// 単色スプライトなので、色ではなく「形」で見分けが付くようにしてある。

/** UFO S。硬くて高得点。円盤に装甲と側面のポッドを足した重い姿 */
const enemyC = fromAscii([
  '................',
  '.......##.......',
  '......####......',
  '.....##..##.....',
  '....########....',
  '..############..',
  '.##############.',
  '################',
  '##.##########.##',
  '##.##########.##',
  '.####......####.',
  '..###......###..',
  '...##......##...',
  '....##....##....',
  '................',
  '................',
], { '#': '#65dbef' });

/** RISER。下からゆらゆら上がってくる。上を向いた砲弾形で、下にひれ */
const enemyF = fromAscii([
  '.......##.......',
  '......####......',
  '.....######.....',
  '....########....',
  '...###....###...',
  '...##########...',
  '..############..',
  '..###......###..',
  '..############..',
  '...##########...',
  '....########....',
  '..#..######..#..',
  '.##...####...##.',
  '##.....##.....##',
  '#.......#.......',
  '................',
], { '#': '#ccc35e' });

/** WALLER。画面の左右の端を上から下へ降りるだけ。定期的に 3WAY を撃つ。
 *  横向きの砲塔を 3 つ並べた、壁づたいの機械 */
const enemyH = fromAscii([
  '..############..',
  '.##..........##.',
  '##....####....##',
  '##...######...##',
  '#....##..##....#',
  '#...##....##...#',
  '#...##....##...#',
  '#....##..##....#',
  '##...######...##',
  '##....####....##',
  '.##..........##.',
  '..####....####..',
  '...##......##...',
  '..###......###..',
  '..##........##..',
  '................',
], { '#': '#b766b5' });

/** SPREADER。真ん中で止まって 360 度へ撃つ。
 *  とげを回りに生やした球。止まっているあいだが撃ちどき */
const enemyI = fromAscii([
  '...##..##..##...',
  '....#..##..#....',
  '.....######.....',
  '...##########...',
  '..############..',
  '#.####....####.#',
  '###.##....##.###',
  '###..######..###',
  '###..######..###',
  '###.##....##.###',
  '#.####....####.#',
  '..############..',
  '...##########...',
  '.....######.....',
  '....#..##..#....',
  '...##..##..##...',
], { '#': '#db6559' });

/** DIVER。上から放物線を描いて入り、また上へ抜ける。
 *  前へ突き出した細い機首と、後ろへ流れた翼 */
const enemyJ = fromAscii([
  '.......##.......',
  '.......##.......',
  '......####......',
  '......####......',
  '.....######.....',
  '.....######.....',
  '..#..######..#..',
  '.###.######.###.',
  '###############.',
  '###..######..###',
  '##....####....##',
  '.#....####....#.',
  '......####......',
  '.....##..##.....',
  '....##....##....',
  '................',
], { '#': '#3eb849' });

/** GLOWER。ふわふわ浮いている光る敵。硬いが、撃つほど殻が開いていく。
 *  3 段階。開くほど中の光がむき出しになり、倒すと $ をばらまく */
const glower0 = fromAscii([
  '................',
  '.....######.....',
  '...##########...',
  '..############..',
  '.##############.',
  '.####......####.',
  '###..######..###',
  '###.########.###',
  '###.########.###',
  '###..######..###',
  '.####......####.',
  '.##############.',
  '..############..',
  '...##########...',
  '.....######.....',
  '................',
], { '#': '#ccc35e' });
const glower1 = fromAscii([
  '..##........##..',
  '..###......###..',
  '...####..####...',
  '..#####..#####..',
  '.####......####.',
  '.##..######..##.',
  '#...########...#',
  '#..##########..#',
  '#..##########..#',
  '#...########...#',
  '.##..######..##.',
  '.####......####.',
  '..#####..#####..',
  '...####..####...',
  '..###......###..',
  '..##........##..',
], { '#': '#ded087' });
const glower2 = fromAscii([
  '##............##',
  '.##..........##.',
  '..##...##...##..',
  '...##.####.##...',
  '....#######.....',
  '...##########...',
  '..############..',
  '.##############.',
  '.##############.',
  '..############..',
  '...##########...',
  '....#######.....',
  '...##.####.##...',
  '..##...##...##..',
  '.##..........##.',
  '##............##',
], { '#': '#ffffff' });

/**
 * ラスボスがパンチで飛ばす「黒い波動」。
 * 大・中・小の 3 枚を少しずらして重ねて撃つと、進む向きが見えてくる。
 * まわりに赤いふちを付けて、赤い空間の中でも形が分かるようにしてある。
 */
/**
 * ラスボスの衝撃波(黒 1 色)。
 * 枠は 16x16(スプライトは 16 の倍数)。中身は半径 x2 の大きさになる
 * @param {number} r 半径(8 = 16 ドット / 6 = 12 ドット / 4 = 8 ドット)
 */
function makeKingWave(r) {
  const S = 16, img = createImage(S, S);
  const cx = S / 2, cy = S / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      // 進む向き(右)へ少しふくらませた丸。中まで詰めた黒い玉
      const grow = 1 + Math.cos(a) * 0.18;
      if (d > r * grow) continue;
      setPixel(img, x, y, hex('#000000'));
    }
  }
  // **黒 1 色**。シルエットの王が出す波なので、色を足さない
  return img;
}
const kingWaveL = makeKingWave(8);
const kingWaveM = makeKingWave(6);
const kingWaveS = makeKingWave(4);

/**
 * 16t のおもり(48x32 スプライト)。
 * モンティ・パイソンに出てくる、上から落ちてくる分銅がもと。
 * 上に持ち手の輪、下へ向かって広がる台形、抜き文字で 16TONS。
 * 「箱」ではなく「おもり」に見えるよう、持ち手と台形の広がりを付けてある。
 */
const weight16t = fromAscii([
  '................................................',
  '................................................',
  '.....................#######....................',
  '..................#############.................',
  '.................###############................',
  '................######.....######...............',
  '................###...........###...............',
  '...............###.............###..............',
  '...............##...............##..............',
  '............########################............',
  '............########################............',
  '............########################............',
  '...........##########################...........',
  '...........##########################...........',
  '..........############################..........',
  '..........############################..........',
  '.........##############################.........',
  '.........##############################.........',
  '.........##############################.........',
  '........################################........',
  '........#######..#####....####..######..........',
  '.......#######...####..#######..#########.......',
  '.......########..####..######.....#######.......',
  '......#########..####.....####..##########......',
  '......#########..####..##..###..#########.......',
  '......#########..####..##..###..#..######.......',
  '.....########......###....#####...#########.....',
  '.....######################################.....',
  '....########################################....',
  '....########################################....',
  '...##########################################...',
  '...##########################################...',
], { '#': '#5955e0' });

/** CHASER。旋回しながら近づいてくる。羽を広げた蛾のような姿 */
const enemyG = fromAscii([
  '................',
  '.##..........##.',
  '.####......####.',
  '..#####..#####..',
  '...##########...',
  '....########....',
  '...##########...',
  '..#####..#####..',
  '..###......###..',
  '...##......##...',
  '....######......',
  '.....####.......',
  '......##........',
  '.....####.......',
  '....##..##......',
  '................',
], { '#': '#74d07d' });

/** ワープ機。中が抜けた輪(ゲート)。跳ね回る敵とは形からして違う */
const warper = fromAscii([
  '................',
  '.....######.....',
  '...##########...',
  '..####....####..',
  '.###........###.',
  '.##..........##.',
  '###..........###',
  '##............##',
  '##............##',
  '###..........###',
  '.##..........##.',
  '.###........###.',
  '..####....####..',
  '...##########...',
  '.....######.....',
  '................',
], { '#': '#65dbef' });

const cube = fromAscii([
  '################',
  '#..............#',
  '#.############.#',
  '#.#..........#.#',
  '#.#.########.#.#',
  '#.#.#......#.#.#',
  '#.#.#.####.#.#.#',
  '#.#.#.#..#.#.#.#',
  '#.#.#.#..#.#.#.#',
  '#.#.#.####.#.#.#',
  '#.#.#......#.#.#',
  '#.#.########.#.#',
  '#.#..........#.#',
  '#.############.#',
  '#..............#',
  '################',
], { '#': '#cccccc' });

// 跳ね回る敵 (最大パワー時に出現)。3発で倒せる
const bouncer = fromAscii([
  '.......##.......',
  '.......##.......',
  '...#...##...#...',
  '....#..##..#....',
  '.....######.....',
  '..#..######..#..',
  '...##########...',
  '##.##########.##',
  '##.##########.##',
  '...##########...',
  '..#..######..#..',
  '.....######.....',
  '....#..##..#....',
  '...#...##...#...',
  '.......##.......',
  '.......##.......',
], { '#': '#8076f1' });

// 挟み撃ち機 (最大パワー時に左右から突っ込んでくる)。右向きの矢の形
const rammer = fromAscii([
  '................',
  '................',
  '.....##.........',
  '...####.........',
  '.#########......',
  '..###########...',
  '.###############',
  '####..#####..###',
  '####..#####..###',
  '.###############',
  '..###########...',
  '.#########......',
  '...####.........',
  '.....##.........',
  '................',
  '................',
], { '#': '#ff8ce8' });

// ---------------------------------------------------------------- メカ用タイル
// ボスは「8x8 のパーツ(タイル)を組み合わせて作る」方式で描く。
// 1 タイルにつき色は 2 色までなので、横8ドット2色の制約が自動的に守られ、
// パーツごとに色を変えても破綻しない(実機の SCREEN2 と同じ考え方)。
// '#' = 前景色 / '.' = 背景色(null を渡すと透明のまま)

const MECH_TILE = {
  // 平らな装甲板(面の上下に陰影を入れて厚みを出す)
  plate:     ['########', '########', '########', '########', '########', '########', '########', '########'],
  plateTop:  ['........', '..####..', '.######.', '########', '########', '########', '########', '########'],
  plateBot:  ['########', '########', '########', '########', '########', '.######.', '..####..', '........'],
  // 装甲板の継ぎ目(板が重なっている表現)
  seamH:     ['########', '########', '........', '########', '########', '########', '........', '########'],
  seamV:     ['###.####', '###.####', '###.####', '###.####', '###.####', '###.####', '###.####', '###.####'],
  // ボルト留めの装甲板
  bolt:      ['########', '#..##..#', '#..##..#', '########', '########', '#..##..#', '#..##..#', '########'],
  // 排気口 / スリット
  vent:      ['########', '#.#.#.#.', '#.#.#.#.', '########', '#.#.#.#.', '#.#.#.#.', '########', '########'],
  grill:     ['########', '........', '########', '........', '########', '........', '########', '########'],
  // 関節・軸(円形の可動部)
  joint:     ['..####..', '.##..##.', '#.#..#.#', '#..##..#', '#..##..#', '#.#..#.#', '.##..##.', '..####..'],
  // シリンダー(伸縮する腕)
  cylinder:  ['.######.', '.#....#.', '.######.', '.#....#.', '.######.', '.#....#.', '.######.', '.######.'],
  // 壁に打ち込むアンカー(脚)
  anchor:    ['....####', '..######', '########', '###..###', '###..###', '########', '..######', '....####'],
  // センサー(光る帯)。前景に明るい色を入れる
  sensorL:   ['........', '.#######', '.#......', '.#..####', '.#..####', '.#......', '.#######', '........'],
  sensorR:   ['........', '#######.', '......#.', '####..#.', '####..#.', '......#.', '#######.', '........'],
  // 警告色の斜めストライプ(武器まわり)
  hazard:    ['##..##..', '#..##..#', '..##..##', '.##..##.', '##..##..', '#..##..#', '..##..##', '.##..##.'],
  // 角の面取り(輪郭に段差を作る)
  cornerTL:  ['.....###', '...#####', '..######', '.#######', '########', '########', '########', '########'],
  cornerTR:  ['###.....', '#####...', '######..', '#######.', '########', '########', '########', '########'],
  cornerBL:  ['########', '########', '########', '########', '.#######', '..######', '...#####', '.....###'],
  cornerBR:  ['########', '########', '########', '########', '#######.', '######..', '#####...', '###.....'],
  // 半分だけのタイル(輪郭の張り出し)
  halfT:     ['########', '########', '########', '########', '........', '........', '........', '........'],
  halfB:     ['........', '........', '........', '........', '########', '########', '########', '########'],
  halfL:     ['####....', '####....', '####....', '####....', '####....', '####....', '####....', '####....'],
  halfR:     ['....####', '....####', '....####', '....####', '....####', '....####', '....####', '....####'],
  // ハサミの先(開いた口)
  clawUp:    ['..######', '.#######', '########', '########', '###.....', '##......', '###.....', '#####...'],
  clawDn:    ['#####...', '###.....', '##......', '###.....', '########', '########', '.#######', '..######'],
  clawTipU:  ['######..', '#####...', '####....', '###.....', '........', '........', '........', '........'],
  clawTipD:  ['........', '........', '........', '........', '###.....', '####....', '#####...', '######..'],
  // 砲口
  muzzle:    ['########', '#......#', '#.####.#', '#.####.#', '#.####.#', '#.####.#', '#......#', '########'],
  blank:     ['........', '........', '........', '........', '........', '........', '........', '........'],
};

/** タイルを 1 枚描く。bg に null を渡すと背景は透明のまま */
function drawTile(img, tx, ty, name, fg, bg) {
  const pat = MECH_TILE[name];
  if (!pat) throw new Error('unknown tile: ' + name);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const on = pat[y][x] === '#';
      if (on) setPixel(img, tx * 8 + x, ty * 8 + y, fg);
      else if (bg) setPixel(img, tx * 8 + x, ty * 8 + y, bg);
    }
  }
}

/**
 * タイル並び(文字マップ)から絵を作る。
 * legend: 文字 -> [タイル名, 前景色, 背景色(省略で透明)]
 */
function buildMech(rows, legend) {
  const img = createImage(rows[0].length * 8, rows.length * 8);
  rows.forEach((row, ty) => {
    if (row.length !== rows[0].length) {
      throw new Error(`buildMech: 行 ${ty} の長さが不一致`);
    }
    [...row].forEach((ch, tx) => {
      if (ch === ' ') return;                 // 空白 = 何も置かない
      const def = legend[ch];
      if (!def) throw new Error('unknown mech char: ' + ch);
      drawTile(img, tx, ty, def[0], hex(def[1]), def[2] ? hex(def[2]) : null);
    });
  });
  return img;
}

// メカの配色(パーツごとに使い分ける。全体をまたぐグラデーションはしない)
const MECH_COLORS = {
  armor: '#db6559',      // 外装装甲(基本色)
  armorHi: '#ff897d',    // 装甲の明るい面
  frame: '#5955e0',      // 関節・内部フレーム(暗い機械色)
  frameHi: '#8076f1',    // フレームの明るい面
  sensor: '#65dbef',     // センサー・発光部
  warn: '#ded087',       // 警告色(武器まわり)
  hull: '#cccccc',       // 船体の装甲
  hullDark: '#7c7c7c',   // 船体の陰
};
/** 配色の短縮参照 */
const C = MECH_COLORS;

// ---- 2 面ボス「カニロボ」----
// 24x16 で描いてから 2 倍に拡大する(48x32)。
// 目は別スプライトで重ねるので、本体は 1 行 1 色にしてある。
const CRAB_ART = [
  '.AA..................AA.',
  'AAAA................AAAA',
  'AA.AA..............AA.AA',
  '.AAAA....AAAAAA....AAAA.',
  '..AA....AAAAAAAA....AA..',
  '..AA...BBBBBBBBBB...AA..',
  '..AA..BBBBBBBBBBBB..AA..',
  '..BBBBBBBBBBBBBBBBBBBB..',
  '.....BBBBBBBBBBBBBB.....',
  '......BBBBBBBBBBBB......',
  '.......CCCCCCCCCC.......',
  '......CC.CCCCCC.CC......',
  '.....CC...CCCC...CC.....',
  '....CC....CCCC....CC....',
  '...CC.....C..C.....CC...',
  '..CC......C..C......CC..',
];
const crabSmall = fromAscii(CRAB_ART, {
  A: '#ff9c5a', B: '#ff5a5a', C: '#c04040',
});

/** 絵を整数倍に拡大する */
function scaleImage(src, n) {
  const img = createImage(src.width * n, src.height * n);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      if (src.data[s + 3] < 128) continue;
      const rgb = [src.data[s], src.data[s + 1], src.data[s + 2]];
      for (let dy = 0; dy < n; dy++) {
        for (let dx = 0; dx < n; dx++) setPixel(img, x * n + dx, y * n + dy, rgb);
      }
    }
  }
  return img;
}

/** 絵を num/den 倍に縮める(近いドットを拾うだけの、素朴な縮小) */
function scaleDown(src, den, num) {
  const W = Math.round(src.width * num / den), H = Math.round(src.height * num / den);
  const img = createImage(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.round(x * den / num), sy = Math.round(y * den / num);
      if (sx >= src.width || sy >= src.height) continue;
      const o = (sy * src.width + sx) * 4;
      if (!src.data[o + 3]) continue;
      setPixel(img, x, y, [src.data[o], src.data[o + 1], src.data[o + 2]]);
    }
  }
  return img;
}

/** 上下を反転した絵を作る(ひっくり返ったカニ用) */
function flipY(src) {
  const img = createImage(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      if (src.data[s + 3] < 128) continue;
      setPixel(img, x, src.height - 1 - y, [src.data[s], src.data[s + 1], src.data[s + 2]]);
    }
  }
  return img;
}

const crabBody = scaleImage(crabSmall, 2);
const crabFlip = flipY(crabBody);   // ひっくり返って泡を吹くだけになった姿

// 横向き(壁に張り付いた状態)のカニロボ。16x24 で描いて 2 倍 = 32x48。
// 右向き(画面左の壁に張り付いている)。A = ハサミ, B = 甲羅, C = 脚
const CRAB_SIDE = [
  'CCC.............',
  'CCCBBB..........',
  '.CBBBBBB........',
  'CCBBBBBB.AAAA...',
  'CCBBBBBBAAAAAA..',
  '..BBBBBBAA..AAA.',
  '..BBBBBBBAAAAAA.',
  'CCBBBBBBB.AAAA..',
  'CCBBB.BBB.......',
  '..BB...BB.......',
  '..BB.C.BB.......',
  'CCBB.C.BB.......',
  'CCBB.C.BB.......',
  '..BB.C.BB.......',
  '..BB...BB.......',
  'CCBBB.BBB.......',
  'CCBBBBBBB.AAAA..',
  '..BBBBBBBAAAAAA.',
  '..BBBBBBAA..AAA.',
  'CCBBBBBBAAAAAA..',
  'CCBBBBBB.AAAA...',
  '.CBBBBBB........',
  'CCCBBB..........',
  'CCC.............',
];
// ハサミを撃ち尽くした姿(ハサミだけ消す)
const CRAB_SIDE_NOCLAW = CRAB_SIDE.map(r => r.replace(/A/g, '.'));
const CRAB_SIDE_COLORS = { A: '#ff9c5a', B: '#ff5a5a', C: '#c04040' };

// ---- 2 面ボス「KING FOSSIL」: 壁に張り付いた装甲メカ ----
// 64x96。右向き(画面左の壁に張り付いた姿)で描き、
// 右の壁にいるときは左右反転して使う。
// カニらしさは「大きなハサミ」だけに任せ(ハサミはスプライトで飛ばす)、
// 本体は角のある装甲艦のような形にしてある。
function makeCrabSide() {
  const W = 64, H = 96;
  const img = createImage(W, H);
  const SHELL = hex('#db6559'), SHELL_HI = hex('#ff897d'), SHELL_D = hex('#b95e51');
  const LEG = hex('#5955e0'); void LEG;

  // 色の置き場所は縦に分けてある(横 8 ドット 2 色の制約に引っかからないよう)。
  //   x 0-7   : 脚(青)
  //   x 8-47  : 装甲(赤系。行ごとに 1 色)
  //   x 48-63 : ハサミ(橙。別の絵として重ねて描く)
  const SHELL_TOP = 4, SHELL_BOT = 91;
  const K1 = 14, K2 = 24, K3 = 72, K4 = 82;   // 輪郭の折れ点
  const lerp = (a, b, t) => a + (b - a) * t;

  // 前(右)のふち。楕円ではなく角のある形にしてメカらしく見せる
  function front(y) {
    if (y < K1) return Math.round(lerp(30, 40, (y - SHELL_TOP) / (K1 - SHELL_TOP)));
    if (y < K2) return Math.round(lerp(40, 47, (y - K1) / (K2 - K1)));
    if (y <= K3) return 47;
    if (y <= K4) return Math.round(lerp(47, 40, (y - K3) / (K4 - K3)));
    return Math.round(lerp(40, 30, (y - K4) / (SHELL_BOT - K4)));
  }
  // 後ろ(左)のふち。壁に沿ってまっすぐ
  function back(y) {
    if (y < K2) return Math.round(lerp(18, 8, (y - SHELL_TOP) / (K2 - SHELL_TOP)));
    if (y <= K4) return 8;
    return Math.round(lerp(8, 18, (y - K4) / (SHELL_BOT - K4)));
  }
  // 上を光源にした色分け。境目は 1 行おきの混色でなじませる
  function rowColor(y) {
    if (y < 26) return SHELL_HI;
    if (y < 34) return (y & 1) ? SHELL : SHELL_HI;
    if (y < 70) return SHELL;
    if (y < 78) return (y & 1) ? SHELL_D : SHELL;
    return SHELL_D;
  }

  const SEAMS = [20, 36, 68, 84];   // 装甲の合わせ目(バイザーの帯は避ける)
  for (let y = SHELL_TOP; y <= SHELL_BOT; y++) {
    const c = rowColor(y);
    const x0 = back(y), x1 = front(y);
    for (let x = x0; x <= x1; x++) setPixel(img, x, y, c);
    if (SEAMS.includes(y)) {
      for (let x = x0 + 2; x <= x1 - 2; x++) clearPixel(img, x, y);
    }
  }
  // 前面を段差にする(真ん中の帯だけ前へ張り出して見える)
  for (let y = 26; y <= 36; y++) for (let x = 44; x <= 47; x++) clearPixel(img, x, y);
  for (let y = 60; y <= 70; y++) for (let x = 44; x <= 47; x++) clearPixel(img, x, y);
  // 目は前寄りに開けた 2 つの黒い穴だけで表す。
  // しきい値に r を足すと、角の欠けが埋まってまん丸に近くなる
  const hole = (hx, hy, r) => {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r + r) continue;
        clearPixel(img, hx + x, hy + y);
      }
    }
  };
  hole(38, 42, 5);
  hole(38, 58, 5);
  // 後ろ(腹側)の板。段になった切れ目を入れる
  for (const sy of [24, 40, 56, 72]) {
    for (let y = sy; y < sy + 2; y++) for (let x = 8; x <= 14; x++) clearPixel(img, x, y);
  }
  // 装甲の上をパイプが這っている(中まで塗りつぶされた場所だけを使うので、
  // 8 ドットの中は「装甲の色 + パイプの色」の 2 色に収まる)
  const pipe = (x0, x1, y, c) => {
    for (let x = x0; x <= x1; x++) { setPixel(img, x, y, c); setPixel(img, x, y + 1, c); }
  };
  const bend = (x, y0, y1, c) => {
    for (let y = y0; y <= y1; y++) { setPixel(img, x, y, c); setPixel(img, x + 1, y, c); }
  };
  const pc = (y) => rowColor(y) === SHELL_D ? SHELL_HI : SHELL_D;
  // 縦に 2 本、上下へ長く這わせてから横へ折れる
  bend(14, 26, 62, SHELL_D);
  bend(22, 34, 78, SHELL_HI);
  pipe(14, 30, 26, pc(26));
  pipe(22, 38, 78, pc(78));
  pipe(14, 26, 62, pc(62));
  // 継ぎ手(パイプの途中にある太い輪)
  for (const [jx, jy] of [[13, 40], [21, 52], [13, 56], [21, 66]]) {
    for (let y = jy; y < jy + 3; y++) {
      for (let x = jx; x < jx + 4; x++) setPixel(img, x, y, pc(y));
    }
  }
  // リベット(中まで塗りつぶされている 8 ドットの中だけなので 2 色に収まる)
  for (const [rx, ry] of [[18, 30], [18, 46], [18, 60], [18, 76]]) {
    setPixel(img, rx, ry, SHELL_D === rowColor(ry) ? SHELL_HI : SHELL_D);
    setPixel(img, rx + 1, ry, SHELL_D === rowColor(ry) ? SHELL_HI : SHELL_D);
  }

  // 脚は別パーツ(crabLeg)にした。1 本ずつ壊せるようにするため、
  // 本体の絵には描かない

  return img;

}

// ハサミはスプライト(crabBigClaw)なので、本体の絵は 1 枚だけ
const crabR = makeCrabSide();
const crabRNo = crabR;

/** 脚を折られてひっくり返った姿。
 *  そのままだと縦 96 ドットの壁になって邪魔なので、斜めに傾けた絵を作る。
 *  ずらす量は必ず 8 の倍数。こうすると元の絵の「横 8 ドット 2 色」の
 *  かたまりがそのまま平行移動するだけになり、制約を壊さずに済む。 */
function makeCrabTilt(src, step = 16) {
  const groups = Math.ceil(src.height / step);
  const shift = (y) => (Math.floor(y / step) - (groups - 1) / 2) * 8;
  // いちばん大きくずれるぶんだけ横に広げる
  const pad = Math.ceil((groups - 1) / 2) * 8;
  const img = createImage(src.width + pad * 2, src.height);
  for (let y = 0; y < src.height; y++) {
    const dx = pad + Math.round(shift(y) / 8) * 8;
    for (let x = 0; x < src.width; x++) {
      const o = (y * src.width + x) * 4;
      if (!src.data[o + 3]) continue;
      setPixel(img, x + dx, y, [src.data[o], src.data[o + 1], src.data[o + 2]]);
    }
  }
  return img;
}
const crabTilt = makeCrabTilt(crabR);

// 発射される大きなハサミ(壊せるが壊すと弾が散る)
const crabClaw = scaleImage(fromAscii([
  '.AAAA...',
  'AAAAAA..',
  'AA..AAA.',
  'AAAAAAA.',
  '.AAAAAA.',
  '..AAAA..',
  '...AA...',
  '........',
], CRAB_SIDE_COLORS), 2);

// 長距離ロケット弾 (24x96 の BG スプライト)。前からまっすぐ飛んでくる。
// 3 タイル x 12 タイルをメカ用タイルで組む。
// ---- ミサイル(24x96) ----
// 画面の上から自機めがけて落ちてくるので、弾頭は下向き。
// 上から 噴射口 -> 尾翼 -> 円筒の胴 -> 警告帯 -> 弾頭 の順に並ぶ。
// 行ごとに 1 色だけ使うので、横 8 ドット 2 色の決まりを自然に守れる。
/**
 * ミサイル本体(BG スプライト)。
 * @param {boolean} alt 1 コマおきに灰と白を入れ替えた版
 * @param {boolean} glow 白いところを黄色にした版(弾頭の光り)。
 *   胴の縞は**行ごとに 1 色**なので、白を黄に読み替えても色数は増えない
 */
function makeRocket(alt = false, glow = false) {
  const W = 24, H = 96, img = createImage(W, H);
  // alt = 1 コマおきに灰と白を入れ替えた版。
  // 背景の岩などと見間違えないよう、当たり判定のある BG は必ずちらつかせる
  const WHITE = glow ? '#ffe97c' : '#ffffff';
  const BODY = hex(alt ? WHITE : '#cccccc'), LIT = hex(alt ? '#cccccc' : WHITE);
  const WARN = hex('#b95e51'), NOZZLE = hex('#5955e0');
  const rowColor = (y) => {
    if (y < 10) return NOZZLE;                        // 噴射口
    if (y >= 76) return WARN;                         // 弾頭
    if ((y >= 30 && y < 36) || (y >= 56 && y < 62)) return WARN;   // 警告帯
    return (Math.floor(y / 4) % 2) ? LIT : BODY;      // 縞で円筒に見せる
  };
  // 胴体
  for (let y = 10; y < 78; y++) {
    for (let x = 6; x < 18; x++) setPixel(img, x, y, rowColor(y));
  }
  // 噴射口(上へ向かって少し広がる)
  for (let y = 0; y < 10; y++) {
    const half = 3 + Math.round((9 - y) * 0.3);
    for (let x = 12 - half; x < 12 + half; x++) setPixel(img, x, y, rowColor(y));
  }
  // 尾翼(後ろほど大きく張り出す。胴と同じ行の色にして色数を増やさない)
  for (let i = 0; i < 22; i++) {
    const y = 10 + i;
    const w = Math.round(6 * (1 - i / 22));
    for (let k = 0; k <= w; k++) {
      setPixel(img, 5 - k, y, rowColor(y));
      setPixel(img, 18 + k, y, rowColor(y));
    }
  }
  // 弾頭(下へとがる)
  for (let i = 0; i < 18; i++) {
    const y = 78 + i;
    const half = Math.max(1, Math.round(6 * (1 - i / 18)));
    for (let x = 12 - half; x < 12 + half; x++) setPixel(img, x, y, rowColor(y));
  }
  // 胴のつなぎ目(彫って影に見せる)
  for (const y of [22, 44, 70]) {
    for (let x = 7; x < 17; x++) clearPixel(img, x, y);
  }
  return img;
}
const rocket = makeRocket();
const rocketAlt = makeRocket(true);
// 弾頭が光るコマ。スプライトを重ねるかわりに、BG スプライトのコマ送りで見せる
const rocketGlow = makeRocket(false, true);
const rocketGlowAlt = makeRocket(true, true);

/** ミサイルの尾を引く炎(単色スプライト)。長さ違いを 3 コマ + 透明 1 コマ */
function makeRocketFlame(n) {
  const W = 24, H = 48, img = createImage(W, H);
  const C = hex('#ffe97c');
  if (n === 0) return img;      // 透明のコマ(点滅用)
  const len = 16 + n * 12;
  for (let i = 0; i < len; i++) {
    const y = H - 1 - i;                       // 下(ミサイル側)から上へ伸ばす
    const t = i / len;
    const half = Math.max(1, Math.round(5 * (1 - t) + Math.sin(i * 0.9) * 1.2));
    for (let x = 12 - half; x < 12 + half; x++) setPixel(img, x, y, C);
  }
  return img;
}
const rocketFlame0 = makeRocketFlame(0);
const rocketFlame1 = makeRocketFlame(1);
const rocketFlame2 = makeRocketFlame(2);
const rocketFlame3 = makeRocketFlame(3);
// 弾頭まわりの光(重ねてちらつかせる単色スプライト)。
// ロケットの明るいところだけを抜き出して使う
const rocketHi = extractHighlight(rocket, '#ffe97c');

// ---- レーザーの溜めエフェクト(単色スプライト) ----
// 砲口の前で光の玉がふくらみ、外側の輪が縮んでいく。

/** 中心の光の玉。とげとげの光をまとった球(size は 16/24/32) */
function makeChargeOrb(size, color) {
  const img = createImage(size, size);
  const c = (size - 1) / 2, r = size * 0.28;
  const C = hex(color);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c, dy = y - c;
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = Math.atan2(dy, dx);
      // 8 方向へとげが伸びる
      const spike = r + Math.abs(Math.cos(a * 4)) * (size * 0.18);
      if (d <= spike) setPixel(img, x, y, C);
    }
  }
  return img;
}
const chargeOrb0 = makeChargeOrb(16, '#ffe97c');
// スプライトは 16 の倍数にそろえる。絵は真ん中に置くので見え方は変わらない
const chargeOrb1 = padTo(makeChargeOrb(24, '#ffe97c'), 32, 32);
const chargeOrb2 = makeChargeOrb(32, '#ffffff');

/** 外側の輪。溜めが進むほど小さい輪に差し替えて、集まってくるように見せる */
function makeChargeRing(size, thick, color) {
  const img = createImage(size, size);
  const c = (size - 1) / 2, r = size / 2 - 1;
  const C = hex(color);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c, dy = y - c;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r || d < r - thick) continue;
      // 輪は破線にして「エネルギーが集まる」感じを出す
      const a = Math.atan2(dy, dx);
      if (Math.cos(a * 6) < -0.3) continue;
      setPixel(img, x, y, C);
    }
  }
  return img;
}
const chargeRing0 = makeChargeRing(48, 3, '#65dbef');
const chargeRing1 = makeChargeRing(32, 3, '#65dbef');
const chargeRing2 = padTo(makeChargeRing(24, 4, '#ffffff'), 32, 32);

// ---- ボスに重ねる専用パーツ(単色スプライト。2 コマに 1 回だけ表示する) ----

/** タコの足。頭の下から 5 本、うねりながら垂れ下がる(吸盤つき) */
function makeOctoArms() {
  const W = 64, H = 32, img = createImage(W, H);
  const C = hex('#ff897d');
  for (let i = 0; i < 5; i++) {
    const x0 = 6 + i * 13;
    const sway = (i % 2 === 0) ? 1 : -1;
    for (let y = 0; y < H; y++) {
      const t = y / H;
      // 先へ行くほど細くなり、左右にうねる
      const x = x0 + Math.sin(t * 3.2 + i) * 5 * sway;
      const w = Math.max(1, Math.round(4 * (1 - t * 0.8)));
      for (let k = 0; k < w; k++) setPixel(img, Math.round(x) + k, y, C);
      // 吸盤(内側に点を並べる)
      if (y % 6 === 3 && t < 0.8) setPixel(img, Math.round(x) + w, y, C);
    }
  }
  return img;
}
const octoArms = makeOctoArms();

/** タコの王冠(単色スプライト)。斜めにかぶせるので、まっすぐ描いてから回す */
// 王冠は 32x16 の枠に収める(スプライトは 16 の倍数)。
// **左上ぞろえ**で広げるので、かぶせる位置の指定は前のままでよい。
// 帯を 5 行から 3 行に詰めて、回したあとの高さを 16 に収めてある
const octoCrown = padTo(rotateImage(fromAscii([
  '..#.......#.......#.',
  '.###.....###.....###',
  '#####...#####...####',
  '####.....###.....###',
  '###.......#.......##',
  '##...............###',
  '####################',
  '##.####.####.####.##',
  '####################',
], { '#': '#ded087' }), 20), 32, 16, 'topleft');

// 気絶したときに頭のまわりを回る**ひよこ**(単色スプライト・8x8)。
// 2 コマで羽ばたかせる。まん丸にして、小さくても鳥だと分かるようにする
const chick0 = fromAscii([
  '..####..',
  '.######.',
  '####.##.',
  '#######.',
  '.######.',
  '..####..',
  '..#..#..',
  '........',
], { '#': '#ded087' });
const chick1 = fromAscii([
  '........',
  '..####..',
  '.###.##.',
  '.######.',
  '.######.',
  '..####..',
  '..#..#..',
  '........',
], { '#': '#ded087' });

/** カニの大きなハサミ(BG 用・16x28)。本体の前に重ねて描く。
 *  x 48-63 の帯だけを使うので、赤い装甲と色がぶつからない */
function makeCrabClawBig(stub = false) {
  const W = 64, H = 48, img = createImage(W, H);
  // ハサミは青。BG(多色が使える)なので、根元の装甲を開いて
  // 中の機械(シリンダーと歯車)を見せる
  const CLAW = hex('#5955e0'), CLAW_HI = hex('#8076f1'), CLAW_D = hex('#3a3ab0');
  const MECH = hex('#cccccc');
  const rowColor = (y) => y < 12 ? CLAW_HI
    : y < 18 ? ((y & 1) ? CLAW : CLAW_HI)
    : y < 34 ? CLAW
    : y < 40 ? ((y & 1) ? CLAW_D : CLAW) : CLAW_D;

  // 腕(本体につながる根元)
  for (let y = 16; y < 32; y++) {
    for (let x = 0; x < 22; x++) setPixel(img, x, y, rowColor(y));
  }
  // ちょうつがい(丸いふくらみ)
  for (let y = 10; y < 38; y++) {
    const dy = (y - 24) / 14;
    const half = 13 * Math.sqrt(Math.max(0, 1 - dy * dy));
    for (let x = Math.round(22 - half); x <= Math.round(22 + half); x++) {
      setPixel(img, x, y, rowColor(y));
    }
  }
  // 上下のあご。ペンチの先のように、まっすぐ細くなって先端で合わさる。
  // stub = 撃った直後に にょきっと生えかけている短い状態
  const jawLen = stub ? 10 : 42;
  for (let i = 0; i < jawLen; i++) {
    const x = 22 + i;
    const t = i / 41;
    // 外側の輪郭: 根元 15 ドット -> 先端 4 ドット(直線的に細く)
    const outer = Math.round(4 + 11 * (1 - t));
    // 内側の輪郭: 先端まで閉じきらない = 開いたままのペンチ
    const inner = Math.round(2 + 9 * (1 - t) * (1 - t));
    for (let k = inner; k <= outer; k++) {
      setPixel(img, x, 23 - k, rowColor(23 - k));
      setPixel(img, x, 24 + k, rowColor(24 + k));
    }
  }
  // かみ合わせのギザギザ(ペンチの歯)
  for (let i = 4; i < (stub ? 6 : 34); i += 5) {
    const x = 26 + i;
    const t = (x - 22) / 41;
    const inner = Math.round(2 + 9 * (1 - t) * (1 - t));
    for (let k = 0; k < 2; k++) {
      for (let dx = 0; dx < 3; dx++) {
        setPixel(img, x + dx, 23 - inner + 1 + k, rowColor(23 - inner + 1 + k));
        setPixel(img, x + dx, 24 + inner - 1 - k, rowColor(24 + inner - 1 - k));
      }
    }
  }
  // --- 露出した内部メカ ---
  // 塗りつぶされている場所の中だけに描くので、8 ドットあたり 2 色に収まる。
  for (const ry of [19, 27]) {
    for (let y = ry; y < ry + 2; y++) {
      for (let x = 1; x < 16; x++) setPixel(img, x, y, MECH);
    }
  }
  for (let y = 17; y < 31; y++) {
    for (let x = 9; x < 12; x++) setPixel(img, x, y, MECH);
  }
  // ちょうつがいの歯車
  for (let y = -5; y <= 5; y++) {
    for (let x = -5; x <= 5; x++) {
      const d = x * x + y * y;
      if (d > 25 || d < 4) continue;
      setPixel(img, 22 + x, 24 + y, MECH);
    }
  }
  for (const [dx, dy] of [[0, -7], [0, 7], [-7, 0], [7, 0], [5, 5], [-5, -5]]) {
    setPixel(img, 22 + dx, 24 + dy, MECH);
    setPixel(img, 22 + dx + (dy ? 1 : 0), 24 + dy + (dx ? 1 : 0), MECH);
  }
  return img;
}
const crabClawBig = makeCrabClawBig();
// 撃ったあとに「次のハサミの先端」だけが にょきっと出ている姿。
// 根元ではなく先端が見えるよう、完成形の先のほう(x 44 以降)を切り出して
// 画面の内側(x=0)へ寄せる
function makeCrabClawTip(CUT = 52) {
  const src = makeCrabClawBig();
  const W = 64, H = 48, img = createImage(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = CUT; x < W; x++) {
      const si = (y * W + x) * 4;
      if (src.data[si + 3] < 128) continue;
      const di = (y * W + (x - CUT)) * 4;
      img.data[di] = src.data[si]; img.data[di + 1] = src.data[si + 1];
      img.data[di + 2] = src.data[si + 2]; img.data[di + 3] = 255;
    }
  }
  return img;
}
const crabClawStub = makeCrabClawTip(52);
// 生えかけの途中(半分ほど出た状態)
const crabClawMid = makeCrabClawTip(26);

/** ドラゴンが吐く炎(単色スプライト)。
 *  丸い火の玉を 3 つ(小・中・大)並べて噴射に見せる。
 *  形はすっきりした水滴型にして、ふちだけ少し欠けさせる */
function makeFlame(size, n) {
  const img = createImage(size, size);
  const C = hex('#ffffff');   // 色はゲーム側で塗り替える
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / (size * 0.46);
      // 下(進む向き)を少しふくらませた水滴型
      const dy = (y - c) / (size * (y < c ? 0.40 : 0.50));
      if (dx * dx + dy * dy > 1) continue;
      setPixel(img, x, y, C);
    }
  }
  // ふちを少し欠けさせて、炎らしいゆらぎを出す(コマごとに位置を変える)
  const notches = size <= 8 ? 2 : size <= 12 ? 3 : 4;
  for (let i = 0; i < notches; i++) {
    const a = (Math.PI * 2 * i) / notches + n * 0.9;
    const px = Math.round(c + Math.cos(a) * size * 0.42);
    const py = Math.round(c + Math.sin(a) * size * 0.42);
    clearPixel(img, px, py);
    clearPixel(img, px + 1, py);
    if (size > 8) clearPixel(img, px, py + 1);
  }
  return img;
}
const fireBall = makeFlame(16, 0);
const fireBall1 = makeFlame(16, 1);
const fireBall2 = makeFlame(16, 2);

const fireS0 = makeFlame(8, 0);
const fireS1 = makeFlame(8, 1);
const fireM0 = makeFlame(12, 0);
const fireM1 = makeFlame(12, 1);

/** カニの脚(壊せるパーツ)。壁側(左)へ伸びる関節つきの脚。
 *  付け根の球 -> 太もも -> ひざの球 -> すね -> かぎ爪 でメカらしく見せる。
 *  上下反転して使い分ける */
function makeCrabLeg(bend = 0) {
  // BG スプライトは「パターンのあるセルの透明を黒で埋める」ので、
  // すき間の多い絵にすると黒い箱に見えてしまう。
  // そこで 24x16(3x2 セル)をほぼ埋める、ずんぐりした関節脚にする。
  // 壁を歩いているときの「もしゃもしゃ」した感じは、この太さで出ている
  const W = 24, H = 16, img = createImage(W, H);
  const LEG = hex('#5955e0'), LEG_HI = hex('#8076f1');
  // 行ごとに 1 色(上を明るく)。横 8 ドット 2 色の決まりを自然に守れる
  const rowColor = (y) => y < 5 ? LEG_HI : (y < 8 ? ((y & 1) ? LEG : LEG_HI) : LEG);
  // bend 0 = 折りたたんだ姿 / 1 = 踏ん張って伸ばした姿。
  // 伸ばすと足先が前(左)へ出て、まっすぐになる
  const toeY = Math.round(11 - bend * 3);   // 11(曲げ) .. 8(伸ばし)
  const toeX = Math.round(4 - bend * 4);    // 4 .. 0

  // 付け根(甲羅に差さる四角い塊)。ここは必ず全部埋める
  for (let y = 0; y < H; y++) {
    for (let x = 14; x < W; x++) setPixel(img, x, y, rowColor(y));
  }
  // 太もも(付け根から前へ、上下いっぱいに近い太さ)
  for (let y = 2; y < 14; y++) {
    for (let x = 8; x < 15; x++) setPixel(img, x, y, rowColor(y));
  }
  // すね(足先へ向かって細くなる)
  for (let i = 0; i < 9; i++) {
    const x = 9 - i;
    const t = i / 8;
    const y0 = Math.round(4 + (toeY - 8) * t), y1 = Math.round(11 + (toeY - 11) * t);
    for (let y = y0; y <= y1; y++) setPixel(img, x, y, rowColor(y));
  }
  // 関節の切れ目(内側を彫るだけなので、黒く埋まっても溝に見える)
  for (let y = 4; y < 12; y++) clearPixel(img, 13, y);
  for (let y = 5; y < 11; y++) clearPixel(img, 7, y);
  // 付け根のボルト
  for (const [bx, by] of [[17, 3], [17, 11], [21, 7]]) {
    clearPixel(img, bx, by); clearPixel(img, bx + 1, by);
  }
  return img;
}

/**
 * ジャンプ中の、伸ばしきった脚(24x8)。
 * 壁にいるときの太い脚のままだと、宙に浮いたときにやたら太く見えたので、
 * ここだけ厚みを半分にする。
 * 3x1 セルにぴったり収め、**全面を暗い青で塗ってから**明るい青で形を描く。
 * こうすると細くしても黒い箱が出ない(横 8 ドット 2 色も守れる)。
 */
function makeCrabLegExt() {
  // 24x16 のまま、**描く脚だけを細く**する。
  // 全面を塗ってしまうと、ただの四角い板に見えてしまうので塗らない。
  // 透明のところは BG スプライトの決まりで黒く埋まるが、
  // 宇宙の黒と同じ色なので目には見えない(壁にいるときの脚と同じ理屈)
  const W = 24, H = 16, img = createImage(W, H);
  const LEG = hex('#5955e0'), LEG_HI = hex('#8076f1');
  const rowColor = (y) => (y < 8 ? LEG_HI : LEG);
  // 付け根(甲羅に差さるところ)。ここだけは上下いっぱいに取って、
  // 胴にしっかりめり込ませる
  for (let y = 3; y < 13; y++) for (let x = 15; x < W; x++) setPixel(img, x, y, rowColor(y));
  // 太もも(細め)
  for (let y = 5; y < 11; y++) for (let x = 9; x < 16; x++) setPixel(img, x, y, rowColor(y));
  // すね。まっすぐ前へ伸ばして、先を細くする
  for (let i = 0; i < 10; i++) {
    const x = 9 - i;
    const t = i / 9;
    const y0 = Math.round(6 - t), y1 = Math.round(9 - t * 2);
    for (let y = y0; y <= y1; y++) setPixel(img, x, y, rowColor(y));
  }
  // 関節の切れ目
  for (let y = 5; y < 11; y++) clearPixel(img, 14, y);
  for (let y = 6; y < 10; y++) clearPixel(img, 8, y);
  // 付け根のボルト
  for (const [bx, by] of [[18, 5], [18, 10], [21, 7]]) {
    clearPixel(img, bx, by); clearPixel(img, bx + 1, by);
  }
  return img;
}

const crabLeg = makeCrabLeg(0);
// 途中まで伸ばした姿(壁にいるあいだ、脚を動かして見せるのに使う)
const crabLegMid = makeCrabLeg(0.5);
// ジャンプ中の、伸びきった脚
const crabLegExt = makeCrabLegExt();

// 1. 点検パネル(ボルト留めのハッチ)
const crabPod = fromAscii([
  '................',
  '.##############.',
  '.#............#.',
  '.#.#........#.#.',
  '.#............#.',
  '.#..##########..',
  '.#..##########..',
  '.#............#.',
  '.#..##########..',
  '.#..##########..',
  '.#............#.',
  '.#.#........#.#.',
  '.#............#.',
  '.##############.',
  '................',
  '................',
], { '#': '#cccccc' });
// 2. 燃料タンク(帯の入ったシリンダー)
const crabPod2Unused = fromAscii([
  '....########....',
  '...##########...',
  '..############..',
  '..############..',
  '..##......####..',
  '..############..',
  '..############..',
  '..##......####..',
  '..############..',
  '..############..',
  '..##......####..',
  '..############..',
  '..############..',
  '...##########...',
  '....########....',
  '................',
], { '#': '#65dbef' });
// 3. レーダー皿(前を向いているセンサー)
const crabPod3Unused = fromAscii([
  '.....######.....',
  '...##########...',
  '..####....####..',
  '.###........###.',
  '.##....##....##.',
  '.##...####...##.',
  '.##....##....##.',
  '.###...##...###.',
  '..####.##.####..',
  '...#########....',
  '.....##.##......',
  '......#.##......',
  '.....#####......',
  '....#######.....',
  '...#########....',
  '................',
], { '#': '#65dbef' });

/** カニの大きなハサミ(単色)。開いた口がはっきり分かる形 */
const crabBigClaw = fromAscii([
  '.....########...',
  '...############.',
  '..######..######',
  '.#####......####',
  '.####........###',
  '.####.......####',
  '.#####....######',
  '..#############.',
  '..############..',
  '..#####.........',
  '..######........',
  '..#######.......',
  '..######........',
  '..#####.........',
  '...####.........',
  '....###.........',
], { '#': '#ff9c5a' });

// ---- 3 面ボス「SPACE DRAGON」: 骨のドラゴン ----
// 頭部 48x48。角のある頭蓋骨。目は落ちくぼんだ穴で、顎には牙が並ぶ。
// 骨なので色は白と灰色だけ。行ごとに 1 色にして「横 8 ドット 2 色」を守る。
function makeDragonHead(open = false) {
  const W = 48, H = 48, img = createImage(W, H);
  const BONE = hex('#ffffff'), BONE_D = hex('#cccccc');
  // 上を明るく、下(顎)を暗くして立体に見せる
  const rowColor = (y) => y < 20 ? BONE
    : y < 28 ? ((y & 1) ? BONE_D : BONE)
    : BONE_D;

  for (let y = 6; y < 46; y++) {
    const c = rowColor(y);
    let half;
    if (y < 28) {
      // 頭蓋(上は丸く張り出す)
      half = 15 * Math.sqrt(Math.max(0, 1 - ((y - 22) / 17) ** 2));
    } else if (y < 34) {
      // 頬骨から鼻づらへ、段をつけて細くする
      half = 12 - (y - 28) * 0.5;
    } else if (y < 42) {
      half = 9 - (y - 34) * 0.5;   // あごは短く詰める
    } else {
      half = 0;                    // ここから下はあご(牙)だけ
    }
    const x0 = Math.round(W / 2 - half), x1 = Math.round(W / 2 + half);
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) setPixel(img, x, y, c);
  }
  // リュウグウノツカイの頭にある「冠」。長い背びれの骨が扇のように立つ。
  // ここだけピンクにして、骨の白と描き分ける
  const CREST = hex('#b766b5'), CREST_D = hex('#ff5ad0');
  for (let n = 0; n < 5; n++) {
    const bx = 14 + n * 5;              // 付け根
    const lean = (n - 2) * 0.55;        // 外側ほど寝かせる
    const len = 20 - Math.abs(n - 2) * 3;   // リュウグウノツカイらしく長い
    for (let i = 0; i < len; i++) {
      const w = i < len - 4 ? 2 : 1;
      for (let k = 0; k < w; k++) {
        setPixel(img, Math.round(bx + lean * i) + k, 10 - i, i < 6 ? CREST_D : CREST);
      }
    }
  }
  // 落ちくぼんだ眼窩(大きな黒い穴)
  const hole = (hx, hy, rx, ry) => {
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        if ((x / rx) ** 2 + (y / ry) ** 2 > 1) continue;
        clearPixel(img, hx + x, hy + y);
      }
    }
  };
  hole(16, 21, 7, 5);
  hole(32, 21, 7, 5);
  // 眼窩の内側上を斜めに削って、にらんでいる顔にする
  for (let i = 0; i < 8; i++) {
    for (let k = 0; k <= 3; k++) {
      clearPixel(img, 21 + i, 14 + Math.floor(i * 0.55) + k);
      clearPixel(img, 27 - i, 14 + Math.floor(i * 0.55) + k);
    }
  }
  // 鼻の穴
  hole(21, 30, 2, 2);
  hole(27, 30, 2, 2);
  // 頬のすき間(骨がむき出しなのが分かるよう、横に切れ目を入れる)
  for (let x = 8; x < 18; x++) clearPixel(img, x, 27);
  for (let x = 30; x < 40; x++) clearPixel(img, x, 27);
  // 口を開けた姿では、あごをまるごと下へずらして大きな口をあける
  const jaw = open ? 6 : 0;
  if (open) {
    // 上あごの下を削って、口の中(黒い空間)を作る
    for (let y = 34; y < 41; y++) {
      for (let x = 16; x < 32; x++) clearPixel(img, x, y);
    }
  }
  // 牙。細かい歯を並べ、両端に大きな牙を垂らす
  for (let i = 0; i < 9; i++) {
    const x = 16 + i * 2;
    const len = (i % 2) ? 2 : 4;
    for (let y = 0; y < len; y++) {
      setPixel(img, x, 40 + jaw + y, BONE_D);
      setPixel(img, x + 1, 40 + jaw + y, BONE_D);
    }
  }
  for (const tx of [14, 32]) {
    for (let i = 0; i < 6; i++) {
      const w = i < 3 ? 2 : 1;
      for (let k = 0; k < w; k++) setPixel(img, tx + k, 40 + jaw + i, BONE_D);
    }
  }
  // えらの後ろから伸びるひげ(細く長く後ろへ流れる)。冠と同じピンクにそろえる
  for (let n = 0; n < 3; n++) {
    for (let i = 0; i < 12; i++) {
      const y = 26 + n * 5 + Math.floor(i * 0.5);
      const c = i < 5 ? CREST_D : CREST;
      setPixel(img, 9 - i, y, c);
      setPixel(img, W - 10 + i, y, c);
    }
  }
  return img;
}

// 胴体の節 24x24。背骨(椎骨)と、左右に張り出したあばら
function makeDragonBody() {
  // 骨らしい姿に戻した版。
  // BG スプライトなので、絵のあるマスの透明部分は黒く埋まる。
  // (マス単位で埋める描き方も試したが、骨に見えなくなるのでこちらを採る)
  const S = 24, img = createImage(S, S);
  const BONE = hex('#ffffff'), BONE_D = hex('#cccccc');
  const c = (S - 1) / 2;
  for (let y = 0; y < S; y++) {
    const col = y < 10 ? BONE : (y < 14 ? ((y & 1) ? BONE_D : BONE) : BONE_D);
    // 椎骨(中央のかたまり)
    const dy = (y - c) / 7;
    if (Math.abs(dy) <= 1) {
      const half = 6 * Math.sqrt(1 - dy * dy);
      for (let x = Math.round(c - half); x <= Math.round(c + half); x++) {
        setPixel(img, x, y, col);
      }
    }
    // あばら(左右へ 2 本ずつ張り出す)
    if (y >= 6 && y <= 8) {
      for (let x = 1; x < 8; x++) setPixel(img, x, y + Math.floor((8 - x) / 4), col);
      for (let x = 16; x < 23; x++) setPixel(img, x, y + Math.floor((x - 15) / 4), col);
    }
    if (y >= 14 && y <= 16) {
      for (let x = 2; x < 9; x++) setPixel(img, x, y - Math.floor((9 - x) / 4), col);
      for (let x = 15; x < 22; x++) setPixel(img, x, y - Math.floor((x - 14) / 4), col);
    }
  }
  // 背びれの骨。リュウグウノツカイらしく、背中側へ長く 1 本立てる
  for (let k = 0; k < 9; k++) {
    setPixel(img, c, k, BONE);
    if (k < 6) setPixel(img, c + 1, k, BONE);
  }
  // 腹側は短いとげ
  for (let k = 0; k < 3; k++) {
    setPixel(img, c, S - 2 - k, BONE_D);
    setPixel(img, c + 1, S - 2 - k, BONE_D);
  }
  return img;
}

// しっぽの先(胴体の最後の 1 節だけ形を変える)。骨の矢じり型
function makeDragonTail() {
  const S = 24, img = createImage(S, S);
  const BONE = hex('#ffffff'), BONE_D = hex('#cccccc');
  const rowColor = (y) => y < 8 ? BONE : (y < 12 ? ((y & 1) ? BONE_D : BONE) : BONE_D);
  // 中央の骨(縦に走る芯)
  for (let y = 2; y < 22; y++) {
    for (let x = 10; x < 14; x++) setPixel(img, x, y, rowColor(y));
  }
  // 矢じりのひれ(左右へ広がってから先細り)
  for (let i = 0; i < 10; i++) {
    const half = Math.round(10 - Math.abs(i - 4) * 1.6);
    for (let x = 12 - half; x <= 11 + half; x++) setPixel(img, x, 8 + i, rowColor(8 + i));
  }
  // 先端のとげ
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 3 - Math.floor(i / 2); k++) {
      setPixel(img, 11 + k, 21 + i, BONE_D);
    }
  }
  return img;
}

const dragonTail = makeDragonTail();
const dragonHead = makeDragonHead();
// 突進のときは口を大きく開ける(ここが弱点だと分かるように)
const dragonHeadOpen = makeDragonHead(true);
const dragonBody = makeDragonBody();

// ---- 目玉(各ステージに 1 回だけ 2 体で現れる中ボス) ----
// 本体は 32x32 の BG スプライト。瞳は通常スプライトで重ねる。
// 行ごとに白と灰色を混ぜて、丸みを出す(横8ドット2色は守る)。
// 目玉ユニット (32x32 = 4x4 タイル)。
// 装甲リングの中央にレンズ用の暗い筐体があり、そこへ瞳スプライトを重ねる。
const EYEBALL_LEGEND = {
  a: ['cornerTL', C.hull, null],
  b: ['cornerTR', C.hull, null],
  c: ['cornerBL', C.hull, null],
  e: ['cornerBR', C.hull, null],
  T: ['plateTop', C.hull, C.hullDark],
  U: ['plateBot', C.hull, C.hullDark],
  B: ['bolt', C.hullDark, C.hull],     // 側面のボルト留め装甲
  F: ['plate', C.frame, null],         // レンズの筐体(暗い機械色)
};
const EYEBALL_MAP = [
  'aTTb',
  'BFFB',
  'BFFB',
  'cUUe',
];

// 目玉の本体は「白い球体 + 横じまの陰影」の元のデザインに戻す
function makeEyeball() {
  const S = 32, img = createImage(S, S);
  const c = (S - 1) / 2, r = 15;
  for (let y = 0; y < S; y++) {
    // 1 行 1 色。白 / 明るい灰 / シアンで球の陰影を作る
    const t = y / (S - 1);
    let col = '#cccccc';
    if (t < 0.16) col = '#65dbef';
    else if (t < 0.28) col = (y % 2 ? '#cccccc' : '#65dbef');
    else if (t < 0.60) col = '#ffffff';
    else if (t < 0.74) col = (y % 2 ? '#cccccc' : '#ffffff');
    else if (t < 0.86) col = (y % 2 ? '#65dbef' : '#cccccc');
    else col = '#65dbef';
    const cc = hex(col);
    for (let x = 0; x < S; x++) {
      const dx = x - c, dy = y - c;
      if (dx * dx + dy * dy <= r * r) setPixel(img, x, y, cc);
    }
    // 左右の支持アーム
    if (y > 10 && y < 21 && y % 3 !== 0) {
      setPixel(img, 0, y, cc); setPixel(img, 1, y, cc);
      setPixel(img, S - 2, y, cc); setPixel(img, S - 1, y, cc);
    }
  }
  return img;
}
const eyeball = makeEyeball();

// 血管のスプライト (32x32・赤 1 色)。眼球に重ねて使う。
// 中心から外へ枝分かれしながら伸びる筋を描く。
function makeEyeVein() {
  const S = 32, img = createImage(S, S);
  const c = (S - 1) / 2, r = 15;
  const RED = hex('#ff897d');
  const draw = (ang, from, to, wob, thick) => {
    let px = c + Math.cos(ang) * from, py = c + Math.sin(ang) * from;
    const len = to - from;
    for (let i = 0; i < len; i++) {
      const a2 = ang + Math.sin(i * wob) * 0.45;
      px += Math.cos(a2); py += Math.sin(a2);
      const x = Math.round(px), y = Math.round(py);
      const dx = x - c, dy = y - c;
      if (dx * dx + dy * dy > r * r) break;   // 眼球の外には出さない
      setPixel(img, x, y, RED);
      if (thick && i < len * 0.6) setPixel(img, x, y + 1, RED);
    }
  };
  for (let k = 0; k < 10; k++) {
    const ang = (Math.PI * 2 * k) / 10 + 0.2;
    draw(ang, 6, 15, 0.6, true);     // 太い幹
    draw(ang + 0.32, 9, 15, 1.0);    // 枝
    draw(ang - 0.28, 10, 15, 1.3);   // 枝
  }
  return img;
}
const eyeVein = makeEyeVein();

// 瞳(16x16 スプライト・1 色)。カメラの絞り。
// ダメージを受けるほど絞りが閉じていく 4 段階。
const IRIS_FRAMES = [
  [ // 0: 大きく開いた丸い瞳
    '................',
    '................',
    '.....######.....',
    '...##########...',
    '..############..',
    '..############..',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '..############..',
    '..############..',
    '...##########...',
    '.....######.....',
    '................',
    '................',
  ],
  [ // 1: 上下のまぶたが少し下りた
    '................',
    '................',
    '................',
    '...##########...',
    '..############..',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '..############..',
    '...##########...',
    '................',
    '................',
    '................',
    '................',
  ],
  [ // 2: 半分閉じた
    '................',
    '................',
    '................',
    '................',
    '................',
    '..############..',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '..############..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  [ // 3: ほとんど閉じた(細い線)
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '...##########...',
    '.##############.',
    '.##############.',
    '...##########...',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
];
const irisImgs = IRIS_FRAMES.map(rows => fromAscii(rows, { '#': '#101010' }));
const [eyeIris0, eyeIris1, eyeIris2, eyeIris3] = irisImgs;

// ★アイテム (水色UFOを倒すと出る)。5 つ集めるとボスが現れる
// 神秘の宝珠。集めるとボスが現れる(星ではなく、古代の遺物めいた球)
const star = fromAscii([
  '....####....',
  '..##....##..',
  '.#..####..#.',
  '.#.##..##.#.',
  '#..#....#..#',
  '#.#..##..#.#',
  '#.#..##..#.#',
  '#..#....#..#',
  '.#.##..##.#.',
  '.#..####..#.',
  '..##....##..',
  '....####....',
], { '#': '#7ce8ff' });

// ボム (取ると画面上の敵を一掃する)。単色で、爆弾ではなく広がる衝撃波の絵
const bomb = fromAscii([
  '...######...',
  '..#......#..',
  '.#..####..#.',
  '#..#....#..#',
  '#.#......#.#',
  '#.#......#.#',
  '#.#......#.#',
  '#.#......#.#',
  '#..#....#..#',
  '.#..####..#.',
  '..#......#..',
  '...######...',
], { '#': '#ffffff' });

// スピードアップ (上向きの二重シェブロン)
const speedUp = fromAscii([
  '.....##.....',
  '....####....',
  '...##..##...',
  '..##....##..',
  '............',
  '.....##.....',
  '....####....',
  '...##..##...',
  '..##....##..',
  '............',
  '............',
  '............',
], { '#': '#7cff7c' });

// 連射アップ (三段の弾)
const rapidUp = fromAscii([
  '..##########',
  '..##########',
  '............',
  '....########',
  '....########',
  '............',
  '......######',
  '......######',
  '............',
  '............',
  '............',
  '............',
], { '#': '#ff8ce8' });

// 1UP (自機のミニアイコン)
const oneUp = fromAscii([
  '.....##.....',
  '.....##.....',
  '....####....',
  '...######...',
  '..########..',
  '.##########.',
  '############',
  '.##.####.##.',
  '.#..####..#.',
  '....#..#....',
  '...##..##...',
  '............',
], { '#': '#ffffff' });

// 威力アップ (上向きの太い矢印)
const powerUp = fromAscii([
  '.....##.....',
  '....####....',
  '...######...',
  '..########..',
  '.##########.',
  '############',
  '....####....',
  '....####....',
  '....####....',
  '....####....',
  '............',
  '............',
], { '#': '#ff5a5a' });

// バリア (自機を包むリング)
const barrierItem = fromAscii([
  '...######...',
  '..##....##..',
  '.##......##.',
  '##...##...##',
  '#...####...#',
  '#...####...#',
  '#...####...#',
  '#...####...#',
  '##...##...##',
  '.##......##.',
  '..##....##..',
  '...######...',
], { '#': '#7ce8ff' });

// スコアアイテム ($ マーク。連続で取ると点数が倍々になる)
const coinItem = fromAscii([
  '.....##.....',
  '...######...',
  '..##.##.##..',
  '..##.##.....',
  '...#####....',
  '.....##.##..',
  '.....##.##..',
  '..##.##.##..',
  '...######...',
  '.....##.....',
  '............',
  '............',
], { '#': '#ffe97c' });

// おまかせアイテム (? マーク。オート連射になる)
const autoItem = fromAscii([
  '...######...',
  '..##....##..',
  '.##......##.',
  '.........##.',
  '........##..',
  '......###...',
  '.....##.....',
  '.....##.....',
  '............',
  '.....##.....',
  '.....##.....',
  '............',
], { '#': '#ff9c5a' });

// 自機を包むバリアの表示 (16x16 スプライト)
const barrier = fromAscii([
  '.....######.....',
  '...##......##...',
  '..#..........#..',
  '.#............#.',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '.#............#.',
  '..#..........#..',
  '...##......##...',
  '.....######.....',
], { '#': '#7ce8ff' });


// ワイドショット (左右に広がる矢羽根 = 弾が横に広がることを表す)
const wideShot = fromAscii([
  '#..........#',
  '##........##',
  '###......###',
  '.###....###.',
  '..###..###..',
  '...######...',
  '....####....',
  '.....##.....',
  '....####....',
  '...######...',
  '............',
  '............',
], { '#': '#7cff7c' });

// パワーアップアイテム (黄色いカプセルに P)
// ワイドショット: 弾が左右に広がる様子をそのまま形にする
const item = fromAscii([
  'Y..........Y',
  '.Y...YY...Y.',
  '.YY..YY..YY.',
  '..YY.YY.YY..',
  '..YY.YY.YY..',
  '...YYYYYY...',
  '....YYYY....',
  '.....YY.....',
  '....YYYY....',
  '...YY..YY...',
  '..YY....YY..',
  '............',
], { Y: '#ffd84d' });


// ---- タコ型ボス ----
// 頭は BG(レイヤー)に描いてスクロールで動かすため、単色シルエット + 透明の穴で構成する。
// (透明部分はレイヤー描画時に黒不透明化されるので、目と口は黒く見える)
// 目だけはスプライトを重ねて見栄えを良くする。

const BOSS_W = 48, BOSS_H = 32;

// ---- 1 面ボス「GREAT THING」: タコツボ型 UFO に乗ったタコ星人 ----
// タイルの組み合わせではなく、意味が伝わるように 1 枚ずつ描く。
// BG なので「横 8 ドットに 2 色まで」を守るため、色は行ごとに切り替える。

// 頭部(48x32)。丸い頭 + 太い眉 + 目のくぼみ + くちばし。
// 目のくぼみは透明にして、上から目のスプライトを重ねる。
function makeBossHead() {
  const W = BOSS_W, H = BOSS_H;
  const img = createImage(W, H);
  const SKIN = hex('#db6559'), SKIN_HI = hex('#ff897d');
  const cx = W / 2, cy = 18, rx = 22, ry = 15;
  for (let y = 0; y < H; y++) {
    // 上ほど明るい肌色。境目は 1 行おきに混ぜて丸みを出す
    const t = y / H;
    const c = t < 0.28 ? SKIN_HI
      : t < 0.42 ? ((y & 1) ? SKIN : SKIN_HI) : SKIN;
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPixel(img, x, y, c);
    }
    // 頭の左に垂れ下がる短い足(タコらしさ)
    if (y > 24) {
      const w = 4 - (y - 24) / 3;
      for (let k = 0; k < w; k++) setPixel(img, 6 + k, y, c);
    }
    // 右側は 1 本の手が頭に伸びていて、頭をかいているように見せる
    // (斜めに立ち上がって、先が頭の上に乗る)
    if (y >= 6 && y <= 26) {
      const t = (y - 6) / 20;
      const ax = Math.round(W - 8 - t * 10);        // 下から頭の方へ寄っていく
      const w = Math.max(2, Math.round(4 - t * 2));
      for (let k = 0; k < w; k++) setPixel(img, ax + k, y, c);
    }
  }
  // 太い眉(横に走る溝。透明に抜いて影に見せる)
  for (let x = 10; x < W - 10; x++) {
    if ((x - 10) % 8 === 7) continue;   // 8 ドットごとに橋を残して形を保つ
    clearPixel(img, x, 9);
    clearPixel(img, x, 10);
  }
  // 目のくぼみ(スプライトの目を重ねる位置)
  const socket = (hx, hy, r) => {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        clearPixel(img, hx + x, hy + y);
      }
    }
  };
  socket(16, 16, 6);
  socket(32, 16, 6);
  // くちばし(下の中央。透明の穴 + 牙のような形)
  for (let y = 24; y <= 29; y++) {
    const inset = (y === 24 || y === 29) ? 3 : 1;
    for (let x = 19 + inset; x <= 28 - inset; x++) clearPixel(img, x, y);
  }
  return img;
}

// 第2形態(壺から降りたタコ星人)。頭の下に 4 本の足が生える
function makeBossHead2() {
  const H = BOSS_H + 16;
  const img = createImage(BOSS_W, H);
  const head = makeBossHead();
  img.data.set(head.data.subarray(0, BOSS_W * BOSS_H * 4));
  const SKIN = hex('#db6559'), SKIN_HI = hex('#ff897d');
  for (const [i, lx] of [5, 16, 27, 38].entries()) {
    for (let y = 0; y < 14; y++) {
      const c = (y & 1) ? SKIN : SKIN_HI;       // 行ごとに 2 色を混ぜる
      const w = y < 8 ? 6 : 4;                  // 先へ行くほど細く
      const sway = Math.round(Math.sin(y * 0.4 + i) * 2);
      for (let x = 0; x < w; x++) setPixel(img, lx + x + sway, BOSS_H - 2 + y, c);
    }
  }
  return img;
}

const bossHead = makeBossHead();
const bossHead2 = makeBossHead2();

// カメラアイ。実機のスプライトに合わせて単色 2 枚に分け、
// 1 フレームずつ交互に出して 2 色に見せる。
// **左右・上下とも対称**にしてある。黒目を寄せた向きちがいを
// 反転で作るので、対称でないと反転したときに絵がずれて見える
const EYE_ART = [
  '....KKKK....',
  '..KKKKKKKK..',
  '.KKKCCCCKKK.',
  '.KKCCCCCCKK.',
  'KKCCCCCCCCKK',
  'KKCCCKKCCCKK',
  'KKCCCKKCCCKK',
  'KKCCCCCCCCKK',
  '.KKCCCCCCKK.',
  '.KKKCCCCKKK.',
  '..KKKKKKKK..',
  '....KKKK....',
];
/**
 * 黒目(まん中の 2x2)を dx, dy だけずらした目の絵を作る。
 *
 * 目玉そのものを動かすと、置き場所が 1 ドット単位でずれて泳いで見える。
 * **目玉は動かさず、黒目だけを寄せて**「こちらを見ている」を出す。
 *
 * 向きは 16 方向いるが、**左右・上下の反転が効く**ので、
 * 用意するのは「右下 4 分の 1」ぶんの 5 枚 + まん中の 1 枚だけでよい。
 * @param {number} dx -2..2 @param {number} dy -2..2
 */
function eyeArt(dx, dy) {
  const rows = EYE_ART.map(r => r.split(''));
  // もとの黒目(5,5)-(6,6)をレンズに戻してから、ずらした先へ置き直す
  for (let y = 5; y <= 6; y++) for (let x = 5; x <= 6; x++) rows[y][x] = 'C';
  for (let y = 5; y <= 6; y++) for (let x = 5; x <= 6; x++) rows[y + dy][x + dx] = 'K';
  return rows.map(r => r.join(''));
}
/** 枠(暗い機械色)だけの絵。黒目もこちら側 */
const eyeFrame = (art) => fromAscii(art.map(r => r.replace(/C/g, '.')), { K: '#5955e0' });
/** レンズ(シアン)だけの絵。黒目のところは抜ける */
const eyeLens = (art) => fromAscii(art.map(r => r.replace(/K/g, '.').replace(/C/g, '#')),
  { '#': '#65dbef' });

const bossEye = eyeFrame(EYE_ART);
const bossEye2 = eyeLens(EYE_ART);
// 黒目を寄せた版。**右下 4 分の 1 ぶんだけ**持ち、あとは反転で作る。
// 名前のうしろの 2 桁が、ずらす量 (dx, dy)
const EYE_LOOKS = [[2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
const eyeLookFrames = {};
const eyeLookLens = {};
for (const [dx, dy] of EYE_LOOKS) {
  const art = eyeArt(dx, dy);
  eyeLookFrames['bossEye' + dx + dy] = eyeFrame(art);
  eyeLookLens['bossEye2_' + dx + dy] = eyeLens(art);
}

// チューブ状の口(単色スプライト)。頭の下に重ねて、
// 筒が前へ突き出しているように見せる
const octoMouth = fromAscii([
  '..########..',
  '.##########.',
  '##..####..##',
  '#..######..#',
  '#..######..#',
  '##..####..##',
  '.##########.',
  '..########..',
  '...######...',
  '...######...',
  '....####....',
  '............',
], { '#': '#db6559' });

// まだ作っていないボスの代わりに出す顔「未実装君」(BG)。
// 何もしてこないので、連射だけで壊せる。
function makeTodoFace() {
  const W = 48, H = 48, img = createImage(W, H);
  const SKIN = hex('#ded087'), SKIN_D = hex('#ccc35e');
  for (let y = 0; y < H; y++) {
    // 行ごとに 1 色。下へ行くほど暗くして丸みを出す
    const c = y < 10 ? SKIN : y < 16 ? ((y & 1) ? SKIN_D : SKIN)
      : y < 34 ? SKIN : ((y & 1) ? SKIN_D : SKIN);
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - W / 2) / (W / 2 - 2);
      const dy = (y + 0.5 - H / 2) / (H / 2 - 2);
      if (dx * dx + dy * dy <= 1) setPixel(img, x, y, c);
    }
  }
  // 顔は透明に抜いて黒く見せる。
  // ちいかわ風: 大きな黒い楕円の目 + 小さな口。まゆは描かない
  const dot = (x, y) => clearPixel(img, x, y);
  const oval = (cx, cy, rx, ry) => {
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        if ((x / rx) ** 2 + (y / ry) ** 2 > 1) continue;
        dot(cx + x, cy + y);
      }
    }
  };
  // まゆげ。おだやかに見えるよう、ゆるい弧を目の真上に 1 本ずつ
  for (const cx of [17, 31]) {
    for (let i = 0; i < 5; i++) {
      const x = cx - 2 + i;
      const y = 15 - (i === 2 ? 1 : (i === 1 || i === 3 ? 1 : 0));
      dot(x, y); dot(x, y + 1);
    }
  }
  // まん丸で小さめの目。少し離して置く
  oval(17, 23, 3, 3);
  oval(31, 23, 3, 3);
  // 小さな口(ω のような形。ふたつの山が真ん中で合わさる)
  // 口はネコの鼻と口。小さめに。
  //   上: 丸みのある逆三角の鼻
  //   下: ω 型の小さな口(開いている)
  const MOUTH = [
    '..####..',
    '.######.',
    '..####..',
    '...##...',
    '##....##',
    '###..###',
    '.######.',
  ];
  for (let y = 0; y < MOUTH.length; y++) {
    for (let x = 0; x < MOUTH[y].length; x++) {
      if (MOUTH[y][x] === '#') dot(20 + x, 30 + y);
    }
  }
  // ほおの赤みは単色スプライトで重ねる(BG の色数を気にせず描けるため)
  return img;
}

/** 赤らんだほお(2 色スプライト)。赤のベタ塗りに黒い斜線が入る */
const todoBlush = (() => {
  const W = 12, H = 8, img = createImage(W, H);
  const C = hex('#ff897d'), LINE = hex('#101010');
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - (W - 1) / 2) / (W / 2 - 0.5);
      const dy = (y - (H - 1) / 2) / (H / 2 - 0.5);
      if (dx * dx + dy * dy > 1) continue;
      // 斜線のところは黒
      const line = ((x - y) % 4 + 4) % 4 < 1;
      setPixel(img, x, y, line ? LINE : C);
    }
  }
  return img;
})();

/**
 * 目の中の反射(白の単色スプライト)。左右の目ぶんをまとめて 1 枚に。
 * 中身は 19 ドット幅(目の間が 14 ドット空いているため)なので 16 には収まらない。
 * 枠だけ 32 に広げて、スプライトの大きさを 16 の倍数にそろえる
 */
const todoGlint = (() => {
  const W = 32, H = 8, img = createImage(W, H);
  const C = hex('#ffffff');
  // 目 1 つにつき、大きい反射と小さい反射の 2 つ。
  // 小さいほうが点にしか見えなかったので、一回り大きくした
  for (const cx of [0, 14]) {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) setPixel(img, cx + x, y, C);
    }
    for (let y = 3; y < 5; y++) {
      for (let x = 3; x < 5; x++) setPixel(img, cx + x, y, C);
    }
  }
  return img;
})();
const todoFace = makeTodoFace();

// UFO のまわりを回るガード(単色スプライト)。壊せる。
// 手のひら。単色なので細かい指は描かず、「4 本の指のかたまり」と
// 「親指」の 2 つの塊で手に見せる。右向きに作り、左側では反転して使う。
// 大きさはリング弾(16x16)とそろえてある。
const ufoGuard = fromAscii([
  '...######.......',
  '..########......',
  '..########......',
  '..########......',
  '..########.###..',
  '..########.####.',
  '..#########.###.',
  '..#############.',
  '..#############.',
  '..############..',
  '..###########...',
  '..##########....',
  '...#########....',
  '...########.....',
  '....######......',
  '.....####.......',
], { '#': '#ff897d' });

// レーザー発射中、顔のまわりに縮こまったときの姿(グー)。
// この形のあいだは無敵なので、開いた手のひらと見分けが付くようにしてある。
const ufoFist = fromAscii([
  '....########....',
  '...##########...',
  '..############..',
  '..############..',
  '..##.##.##.###..',
  '..##.##.##.###..',
  '..############..',
  '.#############..',
  '.##############.',
  '.##############.',
  '..############..',
  '..############..',
  '..############..',
  '...##########...',
  '....########....',
  '.....######.....',
], { '#': '#ff897d' });

// 頭をかくタコの手(単色スプライト)。頭の横から 1 本だけ出す
const octoHand = fromAscii([
  '.......###..',
  '......#####.',
  '.....###.##.',
  '....###..##.',
  '...###...##.',
  '..###...##..',
  '.###...##...',
  '####..##....',
  '####.##.....',
  '.#####......',
  '..###.......',
  '............',
], { '#': '#ff897d' });

// タコツボ型の UFO (64x24)。
// 壺の口(縁) -> ふくらんだ胴(窓が並ぶ) -> 底の中央にレーザー砲、
// その左右に「斜めの弾をはじくガード」を張り出させる。
function makeBossShip() {
  // 高さ 40 = 壺の胴 24 + 下に 16 ドットはみ出すガード
  const W = 64, HULL_H = 24, H = HULL_H + 16;
  const img = createImage(W, H);
  const HULL = hex('#cccccc'), HULL_D = hex('#7c7c7c');
  // 砲口の内側は水色。レーザーの色ともそろえる
  const FRAME = hex('#5955e0'), WARN = hex('#65dbef');
  for (let y = 0; y < HULL_H; y++) {
    // 行ごとに 1 色。上の縁は明るく、下へ行くほど暗くする
    const c = y < 3 ? HULL : y < 6 ? ((y & 1) ? HULL_D : HULL)
      : y < 16 ? HULL : ((y & 1) ? HULL_D : HULL);
    // 壺の形: 上が細く、真ん中がふくらみ、底で少しすぼまる
    const t = y / (HULL_H - 1);
    const half = 20 + Math.sin(t * Math.PI * 0.9) * 12;
    const x0 = Math.round(W / 2 - half), x1 = Math.round(W / 2 + half);
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) setPixel(img, x, y, c);
  }
  // 壺の口(いちばん上に横一文字の縁)
  for (let x = 8; x < W - 8; x++) { setPixel(img, x, 0, HULL); setPixel(img, x, 1, HULL_D); }
  // 胴に並ぶ窓(透明に抜く)
  for (let x = 14; x < W - 14; x += 6) {
    for (let dx = 0; dx < 3; dx++) {
      clearPixel(img, x + dx, 8);
      clearPixel(img, x + dx, 9);
    }
  }
  // 底の中央にレーザー砲(枠は暗い機械色、内側は警告色)
  for (let y = HULL_H - 8; y < HULL_H; y++) {
    for (let x = 24; x < 40; x++) {
      const inner = x >= 26 && x < 38 && y >= HULL_H - 6;
      setPixel(img, x, y, inner ? WARN : FRAME);
    }
  }
  // 砲口の左右のガード。壺の外へ 16 ドット張り出して、
  // 斜めから飛んでくる弾をここで受け止める(真下からしか通らない)。
  for (let y = HULL_H - 4; y < H; y++) {
    const t = (y - (HULL_H - 4)) / (H - (HULL_H - 4));
    const w = Math.max(3, Math.round(7 - t * 3));   // 先へ行くほど細くなる
    // 行ごとに 1 色(内側は明るく見せる)
    const c = (y & 1) ? FRAME : HULL_D;
    for (let k = 0; k < w; k++) {
      setPixel(img, 21 - k, y, c);        // 左のガード
      setPixel(img, W - 22 + k, y, c);    // 右のガード
    }
    // ガードの内側の面(砲口に沿って伸びる薄い板)
    setPixel(img, 22, y, c);
    setPixel(img, W - 23, y, c);
  }
  return img;
}
const bossShip = makeBossShip();

// 爆発 3 フレームは手続き生成
function makeBoom(seed, radius, colors) {
  const img = createImage(16, 16);
  const rand = rng(seed);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius) continue;
      const edge = d / radius;
      // 中心ほど確実に、外周ほどまばらに
      if (rand() < 1.1 - edge * edge) {
        const c = colors[Math.min(colors.length - 1, Math.floor(edge * colors.length))];
        setPixel(img, x, y, hex(c));
      }
    }
  }
  return img;
}
// **どれも白 1 色**で作る。色はゲーム側がコマごとに差し替える
// (単色スプライトなので、絵を色数ぶん持つ必要がない)
const boom0 = makeBoom(11, 4.5, ['#ffffff']);
const boom1 = makeBoom(22, 7.0, ['#ffffff']);
const boom2 = makeBoom(33, 8.0, ['#ffffff']);

/**
 * 星空タイル(128x128)。遠・中・近の 3 段階を別レイヤーに分けて速度差を付けるため、
 * それぞれ色と密度を変えて作る。
 * @param {'far'|'mid'|'near'} kind
 */
function makeStars(seed, count, kind) {
  const img = createImage(128, 128);
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * 128);
    const y = Math.floor(rand() * 128);
    let c;
    if (kind === 'far') c = rand() < 0.5 ? '#8888aa' : '#556077';   // 暗い青灰
    else if (kind === 'mid') c = rand() < 0.5 ? '#7ce8ff' : '#59a8d8'; // 水色
    else c = '#ffffff';                                             // 白
    setPixel(img, x, y, hex(c));
    if (kind === 'near' && rand() < 0.35) { // 近い星はたまに十字に光る
      setPixel(img, x + 1, y, hex(c));
      setPixel(img, x - 1, y, hex(c));
      setPixel(img, x, y + 1, hex(c));
      setPixel(img, x, y - 1, hex(c));
    }
  }
  return img;
}
const starsFar = makeStars(101, 60, 'far');
const starsMid = makeStars(303, 34, 'mid');
const starsNear = makeStars(202, 11, 'near'); // 最前面は速いので少なめに

// 星雲タイル(128x128) : layer2 用のぼんやりした青紫の雲
function makeNebula(seed, colors) {
  const [C1, C2] = colors || ['#4b3f9e', '#2c2a6b'];
  const img = createImage(128, 128);
  const rand = rng(seed);
  for (let blob = 0; blob < 4; blob++) {
    const cx = rand() * 128, cy = rand() * 128, r = 10 + rand() * 16;
    for (let y = -r; y < r; y++) {
      for (let x = -r; x < r; x++) {
        const d = Math.sqrt(x * x + y * y) / r;
        if (d > 1) continue;
        if (rand() < (1 - d) * 0.55) {
          const c = rand() < 0.3 ? C1 : C2;
          // タイル境界もラップさせて継ぎ目をなくす
          setPixel(img, (Math.round(cx + x) + 128) % 128, (Math.round(cy + y) + 128) % 128, hex(c));
        }
      }
    }
  }
  return img;
}
const nebula = makeNebula(303);
// 4 面だけに出る赤い星雲。ラスボスの面へ近づいた感じを出す
const nebulaRed = makeNebula(404, ['#b95e51', '#5c2a2a']);

// 遠くに見える小さな月(40x40 の円盤)
function makeMoonDisc(seed) {
  const img = createImage(40, 40);
  const rand = rng(seed);
  // 横8ドット2色の制約は行ごとに独立しているので、上下で色の組を変えて階調を出す。
  // (左上が明るく、右下へ向かって暗くなる。仕上げは reduceBgImage が行ごとに整える)
  const WHITE = hex('#e8e8e8'), GRAY = hex('#b0b0b0'), DARK = hex('#101010');
  const R = 18;
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      const dx = x - 19.5, dy = y - 19.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > R) continue;
      const light = (-dx - dy) / (R * 2) + 0.5; // 左上ほど明るい
      // 明暗の境目では 1 ラインおきに色を混ぜて中間調にする(市松にはしない)
      const dither = (y & 1) === 0;
      let c;
      if (light > 0.68) c = WHITE;
      else if (light > 0.58) c = dither ? WHITE : GRAY;
      else if (light > 0.34) c = GRAY;
      else if (light > 0.24) c = dither ? GRAY : DARK;
      else c = DARK;
      setPixel(img, x, y, rand() < 0.04 ? DARK : c);
    }
  }
  for (let c = 0; c < 5; c++) { // クレーター
    const cx = 8 + rand() * 24, cy = 8 + rand() * 24, r = 2 + rand() * 3;
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      const dx = x - 19.5, dy = y - 19.5;
      if (Math.sqrt(dx * dx + dy * dy) < R - 1) setPixel(img, x, y, DARK);
    }
  }
  return img;
}
const moon = makeMoonDisc(404);

// 最背面に流れる宇宙ステーション。
// 回転リング + 中央コア + スポーク + 左右のソーラーパネル、という
// 見てそれと分かるシルエットにする。単色 + 透明(=黒)のディテール。
function makeStation() {
  const W = 56, H = 32;
  const img = createImage(W, H);
  // 横8ドット2色の制約は行ごとに独立しているので、行によって
  // 明るい色/暗い色を使い分けて金属の立体感を出す(市松は使わない)。
  const WHITE = hex('#e8f0ff'), GRAY = hex('#b8c4d8'), STEEL = hex('#6f7d99');
  const PANEL = hex('#3b6bff'), PANEL2 = hex('#8076f1');
  const cx = 28, cy = 16;
  const hole = (x, y) => { const o = (y * W + x) * 4; if (o >= 0 && o < img.data.length) img.data[o + 3] = 0; };
  // 上ほど明るく、下へ行くほど暗い金属色。境目は 1 ラインおきに混ぜる
  const metal = (y) => {
    const t = (y - (cy - 13)) / 26;
    const odd = (y & 1) === 1;
    if (t < 0.22) return WHITE;
    if (t < 0.34) return odd ? GRAY : WHITE;
    if (t < 0.62) return GRAY;
    if (t < 0.74) return odd ? STEEL : GRAY;
    return STEEL;
  };

  // 外周リング(太め)
  for (let a = 0; a < Math.PI * 2; a += 0.008) {
    for (let t = 0; t < 3; t++) {
      const x = Math.round(cx + Math.cos(a) * (17 - t));
      const y = Math.round(cy + Math.sin(a) * (12 - t));
      setPixel(img, x, y, metal(y));
    }
  }
  // 中央コア(円筒)とスポーク
  for (let y = cy - 5; y <= cy + 5; y++) {
    for (let x = cx - 7; x <= cx + 7; x++) setPixel(img, x, y, metal(y));
  }
  for (let x = cx - 17; x <= cx + 17; x++) {
    for (let d = -1; d <= 1; d++) setPixel(img, x, cy + d, metal(cy + d));
  }
  for (let y = cy - 12; y <= cy + 12; y++) {
    for (let d = -1; d <= 1; d++) setPixel(img, cx + d, y, metal(y));
  }
  // 左右のソーラーパネル(支柱 + 板)。板は行ごとに 2 色を交互に使う
  for (let x = 6; x < 12; x++) { setPixel(img, x, cy, metal(cy)); setPixel(img, W - 1 - x, cy, metal(cy)); }
  for (let y = cy - 6; y <= cy + 6; y++) {
    const c = (y & 1) ? PANEL : PANEL2;
    for (let x = 0; x < 7; x++) { setPixel(img, x, y, c); setPixel(img, W - 1 - x, y, c); }
  }
  // ディテール: コアの窓とパネルの継ぎ目
  for (let y = cy - 3; y <= cy + 3; y += 3) {
    for (let x = cx - 5; x <= cx + 5; x += 3) hole(x, y);
  }
  for (let y = cy - 6; y <= cy + 6; y += 3) {
    for (let x = 0; x < 7; x++) { hole(x, y); hole(W - 1 - x, y); }
  }
  return img;
}
const station = makeStation();

// ---- にぎやかし用の背景オブジェクト ----
// いずれも「行ごとに違う 2 色」を使って階調を出す(仕上げは reduceBgImage)。

/**
 * 木星風のガス惑星。月と同じように右下側が陰で欠ける。
 * 横縞なので「行ごとに違う 2 色」がそのまま模様になる。
 */
function makeJupiter(seed) {
  const W = 144, H = 144, R = 70;
  const img = createImage(W, H);
  const rand = rng(seed);
  const BANDS = ['#e8d8a0', '#c8a060', '#a06840', '#e8d8a0', '#d8b880', '#8f5a3a', '#c8a060'];
  for (let y = 0; y < H; y++) {
    const i = Math.floor((y / H) * 11);
    const band = hex(BANDS[i % BANDS.length]);
    const band2 = hex(BANDS[(i + 1) % BANDS.length]);
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - W / 2, dy = y + 0.5 - H / 2;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > R) continue;
      // 球の法線と光の向きから明暗を出す(輪郭は真円のまま、境目だけ弧を描く)
      const nx = dx / R, ny = dy / R;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const bright = nx * -0.55 + ny * -0.55 + nz * 0.63;
      if (bright < 0.02) continue;                  // 影の側は描かない(黒)
      if (bright < 0.12 && (y & 1)) continue;       // 境目は 1 ラインおきに欠かす
      setPixel(img, x, y, rand() < 0.18 ? band2 : band);
    }
  }
  // 大赤斑
  for (let y = -10; y <= 10; y++) {
    for (let x = -20; x <= 20; x++) {
      if ((x / 20) ** 2 + (y / 10) ** 2 > 1) continue;
      const px = W / 2 - 16 + x, py = H / 2 + 6 + y;
      const dx = px + 0.5 - W / 2, dy = py + 0.5 - H / 2;
      if (Math.sqrt(dx * dx + dy * dy) > R - 2) continue;
      const nx = dx / R, ny = dy / R;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      if (nx * -0.55 + ny * -0.55 + nz * 0.63 < 0.1) continue; // 影にかかる部分は描かない
      setPixel(img, px, py, hex('#b04030'));
    }
  }
  return img;
}
const jupiter = makeJupiter(909);

/** 地球。青い海と白い雲・緑の陸を、行ごとの 2 色で描き分ける */
function makeEarth(seed) {
  const W = 96, H = 96, R = 46;
  const img = createImage(W, H);
  const rand = rng(seed);
  const SEA = hex('#3b6bff'), SEA2 = hex('#8076f1');
  const LAND = hex('#3ea249'), LAND2 = hex('#74d07d');
  const CLOUD = hex('#ffffff');
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - W / 2, dy = y + 0.5 - H / 2;
      if (Math.sqrt(dx * dx + dy * dy) > R) continue;
      // 球の陰影(左上が明るい)。右下は夜側として描かない
      const nx = dx / R, ny = dy / R;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const bright = nx * -0.5 + ny * -0.5 + nz * 0.7;
      if (bright < 0.05) continue;
      if (bright < 0.16 && (y & 1)) continue;
      // 大陸っぽいまだら
      const land = Math.sin(x * 0.14 + y * 0.05) + Math.cos(y * 0.11 - x * 0.03) > 0.65;
      const odd = (y & 1) === 1;
      let c;
      // 雲は帯状にまとめて出す(散らしすぎると砂嵐に見える)
      const cloudBand = Math.sin(y * 0.22 + Math.cos(x * 0.08) * 1.4) > 0.72;
      if (cloudBand && rand() < 0.7) c = CLOUD;
      else if (land) c = odd ? LAND2 : LAND;              // 陸
      else c = (bright > 0.55 && odd) ? SEA2 : SEA;       // 海
      setPixel(img, x, y, c);
    }
  }
  return img;
}
const earth = makeEarth(2024);

/**
 * エンディングの地球(192x192)。**道中の背景を流れていく地球(earth / 96x96)
 * とは別の絵**にしてある。大きさだけでなく絵柄が違う:
 *   ・へりに大気の光の輪を回す(近くから見ている感じ)
 *   ・南北に氷の極冠を置く
 *   ・大陸は別の形。丸をいくつか重ねて、大きな陸のかたまりを作る
 *   ・雲は帯ではなく渦(低気圧)を 3 つ
 * 色は **中間色パレット** から選び、1 ライン おきのディザで出す。
 * 走査線の位相が毎コマ動くので、目のなかで混ざって中間色になる。
 */
const EARTH_MID = {
  //          目印(偶数行/奇数行)  1 コマ目     2 コマ目      見える色
  sea:     { even: 1,  odd: 2,  pair: ['#5955e0', '#8076f1'] },  // 海       深い青
  seaLit:  { even: 3,  odd: 4,  pair: ['#8076f1', '#65dbef'] },  // 明るい海 水色がかった青
  land:    { even: 5,  odd: 6,  pair: ['#3eb849', '#3aa241'] },  // 陸       深い緑
  landLit: { even: 8,  odd: 9,  pair: ['#74d07d', '#3eb849'] },  // 明るい陸 黄みの緑
  cloud:   { even: 10, odd: 11, pair: ['#ffffff', '#cccccc'] },  // 雲と極冠 灰みの白
  dusk:    { even: 12, odd: 13, pair: ['#b95e51', '#b766b5'] },  // 夕暮れ   桃がかった紅
  // いちばん暗いところ。黒と組ませるしか作りようがないので、
  // 目にはきついが表で許してある組(harsh)を使う。面積は小さく抑える
  night:   { even: 14, odd: 15, pair: ['#000000', '#b766b5'] },  // 夜のふち 黒みの桃
};
// ディザにしない 1 色。目印に使っていない番号だけを使う
const EARTH_FLAT = { air: '#65dbef' };   // 大気の輪(パレット 7。目印に使っていない番号)

function makeEarthBig(seed) {
  const W = 192, H = 192, R = 92;
  const img = createImage(W, H);
  const rand = rng(seed);
  // 中間色は行の偶奇で目印を塗り分ける = 1 ライン おきのディザ
  const mid = (m, y) => hex(VDP_HEX[(y & 1) ? m.odd : m.even]);
  // 大陸: 丸をいくつか重ねて、道中の地球とは違う形の陸を作る
  const LANDS = [
    [-40, -34, 36], [-18, -14, 30], [-50, 6, 24], [-30, 14, 20],  // 左上の大陸
    [22, -50, 28], [44, -26, 22], [56, -6, 16],                   // 右上の島つづき
    [12, 24, 34], [34, 46, 26], [-4, 54, 22], [24, 66, 16],       // 右下の大きな陸
    [-58, 44, 20], [-40, 62, 16], [62, 30, 14], [-64, -6, 14],    // まわりの島
  ];
  const onLand = (px, py) =>
    LANDS.some(([lx, ly, lr]) => (px - lx) ** 2 + (py - ly) ** 2 < lr * lr);
  // 雲の渦(低気圧)。中心・半径・巻きの強さ
  const SWIRLS = [
    [-32, 30, 42, 1.9], [34, -18, 36, -2.3], [8, 62, 28, 1.4], [-46, -34, 32, -1.6],
  ];
  const onCloud = (px, py) => SWIRLS.some(([sx, sy, sr, tw]) => {
    const dx = px - sx, dy = py - sy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > sr) return false;
    // 中心から離れるほどねじれる渦巻き。2 本の腕を出す
    const a = Math.atan2(dy, dx) + (d / sr) * tw;
    return Math.cos(a * 2) > 0.55 - (1 - d / sr) * 0.75;
  });

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - W / 2, dy = y + 0.5 - H / 2;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r > R) continue;
      const nx = dx / R, ny = dy / R;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const bright = nx * -0.5 + ny * -0.5 + nz * 0.7;
      // 大気の光の輪。日の当たっているがわのへりだけ光らせる
      if (r > R - 5 && bright > 0.02) { setPixel(img, x, y, hex(EARTH_FLAT.air)); continue; }
      if (bright < 0.05) continue;
      // 影は 2 段。外側は黒と桃の中間、その内は紅と桃の中間
      if (bright < 0.13) { setPixel(img, x, y, mid(EARTH_MID.night, y)); continue; }
      if (bright < 0.26) { setPixel(img, x, y, mid(EARTH_MID.dusk, y)); continue; }
      // 極冠。球の上下(ny が端)は氷
      if (Math.abs(ny) > 0.78) { setPixel(img, x, y, mid(EARTH_MID.cloud, y)); continue; }
      // 球のふくらみを考えて、絵柄を中心寄りに縮めて貼る
      const px = dx / Math.max(0.35, nz) * 0.55, py = dy;
      if (onCloud(px, py) && rand() < 0.92) {
        setPixel(img, x, y, mid(EARTH_MID.cloud, y)); continue;
      }
      const land = onLand(px, py);
      if (bright < 0.62) setPixel(img, x, y, mid(land ? EARTH_MID.land : EARTH_MID.sea, y));
      else setPixel(img, x, y, mid(land ? EARTH_MID.landLit : EARTH_MID.seaLit, y));
    }
  }
  return img;
}
const earthBig = makeEarthBig(2024);

/**
 * エンディングの最後に出す「宇宙に走った青いひび」(224x192)。
 * まっすぐでない縦の裂け目が、まわりをぼうっと光らせている。
 * 色は中間色だけ。1 コマごとにディザを入れ替えると、
 * 光がゆらいでいるようにも見える。
 */
const END_RIFT_MID = {
  //          目印(偶数行/奇数行)  1 コマ目     2 コマ目      見える色
  glow:  { even: 1, odd: 2, pair: ['#000000', '#5955e0'] },   // まわりのにじみ 黒みの青
  outer: { even: 3, odd: 4, pair: ['#5955e0', '#8076f1'] },   // 外がわ         青
  inner: { even: 5, odd: 6, pair: ['#8076f1', '#65dbef'] },   // 内がわ         明るい青
  core:  { even: 8, odd: 9, pair: ['#65dbef', '#ffffff'] },   // 芯             白っぽい水色
};
let LAST_RIFT_LINE = null;
function makeEndRift(seed) {
  const W = 224, H = 192, img = createImage(W, H);
  const rand = rng(seed);
  const mid = (m, y) => hex(VDP_HEX[(y & 1) ? m.odd : m.even]);
  const CX = W / 2;
  // 中心線をふらつかせながら上から下へ。中ほどがいちばん太い
  // 画面いっぱいには広げず、縦横とも 2/3 の大きさに収める
  const SPAN = Math.round(H * 2 / 3), TOP = Math.round((H - SPAN) / 2);
  // 横幅だけ半分にして「倍の縦長」に見せる。
  // 画面の高さは決まっているので、細くすることで細長さを出す
  const K = 1 / 3;
  let jitter = 0, wob = 1;
  const line = [];
  for (let y = 0; y < H; y++) {
    if (y < TOP || y >= TOP + SPAN) { line.push([CX, 0]); continue; }
    // 中心線を大きくふらつかせる。まっすぐだと「ひび」に見えない
    jitter = Math.max(-34 * K, Math.min(34 * K, jitter + (rand() - 0.5) * 4.6 * K));
    // 太さも行ごとに揺らす。ところどころ細くくびれる
    // 太さは大きく揺らす。ところどころ糸のように細くくびれて、
    // ところどころ大きく口を開ける = めりはりが出る
    wob = Math.max(0.12, Math.min(1.8, wob + (rand() - 0.5) * 0.9));
    const t = Math.sin((Math.PI * (y + 0.5 - TOP)) / SPAN);   // 上下の端は細く
    line.push([CX + jitter, Math.pow(t, 0.5) * 6.5 * K * wob]);
  }
  // にじみ -> 外 -> 内 -> 芯 の順に細くしながら重ねる
  // にじみ -> 外 -> 内 -> 芯 の順に細くしながら重ねる。
  // 外側ほど行をとばして薄く見せ、芯は必ず 1 ドット残す = 明暗の差が出る
  const bands = [
    [3.4, END_RIFT_MID.glow, 0.45],
    [1.9, END_RIFT_MID.outer, 0.75],
    [1.0, END_RIFT_MID.inner, 1.0],
    [0.30, END_RIFT_MID.core, 1.0],
  ];
  for (const [scale, m, density] of bands) {
    for (let y = 0; y < H; y++) {
      const [cx, w0] = line[y];
      if (w0 <= 0) continue;
      if (density < 1 && rand() > density) continue;
      const w = w0 * scale * (0.7 + rand() * 0.6);
      const x0 = Math.round(cx - w), x1 = Math.round(cx + w);
      if (x1 < x0) { setPixel(img, Math.round(cx), y, mid(m, y)); continue; }
      for (let x = x0; x <= x1; x++) setPixel(img, x, y, mid(m, y));
    }
  }
  LAST_RIFT_LINE = { line, TOP, SPAN };
  // 縦の真ん中をいちばん明るくする。芯の色を中ほどだけ太く重ねる
  for (let y = TOP; y < TOP + SPAN; y++) {
    const t = Math.sin((Math.PI * (y + 0.5 - TOP)) / SPAN);
    if (t < 0.55) continue;                       // 上下の端では入れない
    const [cx, w0] = line[y];
    const w = Math.max(0.5, w0 * 0.55 * (t - 0.4) * 2);
    for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) {
      setPixel(img, x, y, mid(END_RIFT_MID.core, y));
    }
  }

  // 横へ走る細かいひび。芯から外へ、だんだん暗い色へ変わる
  for (let k = 0; k < 110; k++) {
    const y0 = Math.floor(rand() * H);
    const [cx, w0] = line[y0];
    if (w0 < 1.5) continue;
    const dir = rand() < 0.5 ? -1 : 1;
    // 横へ広がりすぎると割れ目に見えないので、短めに抑える
    const len = Math.round((6 + rand() * 20) * K);
    let bx = cx + dir * w0 * 1.4, by = y0;
    for (let i = 0; i < len; i++) {
      bx += dir * (0.7 + rand() * 0.7);
      by += (rand() - 0.5) * 1.6;
      // 根もとだけ太く、先へ行くほど細く暗くする。
      // ずっと同じ太さだと「伸びた線」に見えて、裂け目より目立ってしまう
      const t = i / len;
      const m = t < 0.25 ? END_RIFT_MID.inner : t < 0.6 ? END_RIFT_MID.outer : END_RIFT_MID.glow;
      const yy = Math.round(by);
      if (t > 0.55 && rand() < 0.35) continue;    // 先のほうはとぎれとぎれ
      setPixel(img, Math.round(bx), yy, mid(m, yy));
      if (t < 0.18) setPixel(img, Math.round(bx), yy + 1, mid(m, yy + 1));
    }
  }
  return img;
}
const endRift = makeEndRift(7);
const endRiftLine = LAST_RIFT_LINE;

/**
 * 割れ目が「じわじわ現れる」ところを 4 コマのパラパラアニメにする。
 * 明るさを落とす手が無い(15 色しかない)ので、
 * **真ん中から上下へ裂けていく**形で「出てくる」を見せる。
 * 3 コマ目までを切り出し、4 コマ目は元の絵そのもの。
 */
function riftGrow(src, t) {
  const img = createImage(src.width, src.height);
  const cy = endRiftLine.TOP + endRiftLine.SPAN / 2;
  const half = (endRiftLine.SPAN / 2) * t;
  for (let y = 0; y < src.height; y++) {
    if (Math.abs(y + 0.5 - cy) > half) continue;
    const o = y * src.width * 4;
    img.data.set(src.data.subarray(o, o + src.width * 4), o);
  }
  return img;
}
const endRiftGrow = [0.18, 0.45, 0.72].map(t => riftGrow(endRift, t));

/**
 * エンディング 2 枚目「基地への帰還」(224x192)。
 * みんなが待っている基地へ、戦闘機が降りてくるところ。
 * 色はすべて中間色(1 ライン おきのディザ)。
 */
const BASE_MID = {
  //          目印(偶数行/奇数行)  1 コマ目     2 コマ目      見える色
  // 空と建物は面積が広く、1 コマごとに色が入れ替わると画面全体が
  // ちらついて目が痛い。**広い面はベタ塗り**にする(2 コマとも同じ色)
  sky:   { even: 1,  odd: 2,  pair: ['#65dbef', '#65dbef'], flat: true },  // 空   水色
  ground:{ even: 3,  odd: 4,  pair: ['#8076f1', '#8076f1'], flat: true },  // 地面 藤色
  wall:  { even: 5,  odd: 6,  pair: ['#cccccc', '#cccccc'], flat: true },  // 建物 灰
  lamp:  { even: 8,  odd: 9,  pair: ['#ff897d', '#ccc35e'] },  // 誘導灯   あたたかい金
  crowd: { even: 10, odd: 11, pair: ['#000000', '#b95e51'] },  // 人かげ   黒みの赤茶
  flame: { even: 12, odd: 13, pair: ['#ff897d', '#ded087'] },  // 噴射     桃がかった金
};
const BASE_FLAT = { hull: '#ffffff', glass: '#65dbef' };   // 機体と風防
function makeBaseScene(seed) {
  const W = 224, H = 192, img = createImage(W, H);
  const rand = rng(seed);
  const mid = (m, y) => hex(VDP_HEX[(y & 1) ? m.odd : m.even]);
  const span = (y, x0, x1, c) => {
    if (y < 0 || y >= H) return;
    for (let x = Math.max(0, Math.round(x0)); x <= Math.min(W - 1, Math.round(x1)); x++) {
      setPixel(img, x, y, c);
    }
  };
  const HORIZON = 126;

  // ---- 空。昼の青空。地平の近くほど白っぽくする ----
  for (let y = 0; y < HORIZON; y++) span(y, 0, W - 1, mid(BASE_MID.sky, y));
  for (let y = HORIZON - 26; y < HORIZON; y++) {
    if ((y & 1) === 0 || rand() < 0.6) span(y, 0, W - 1, mid(BASE_MID.wall, y));
  }
  // ちぎれ雲をいくつか流す
  for (let k = 0; k < 7; k++) {
    const cx = rand() * W, cy = 14 + rand() * 60, cw = 18 + rand() * 34;
    for (let y = cy; y < cy + 6 + rand() * 5; y++) {
      const t = (y - cy) / 8;
      span(y, cx - cw * (1 - t * 0.4), cx + cw * (1 - t * 0.5), mid(BASE_MID.wall, y));
    }
  }
  // 空に浮かぶ環のある惑星(この星の空から見えている隣の星)
  for (let y = 8; y < 56; y++) {
    const dy = (y - 32) / 24;
    const w = Math.sqrt(Math.max(0, 1 - dy * dy)) * 24;
    // 左上が明るく、右下は欠ける
    if ((y & 1) === 0) continue;   // 昼の空なので、うっすらとだけ見せる
    span(y, 176 - w, 176 + w, mid(BASE_MID.wall, y));
  }
  for (let k = -34; k <= 34; k++) {                       // 環(斜めにかかる)
    const y = 32 + Math.round(k * 0.28);
    const x = 176 + k;
    if (Math.abs(k) < 12) continue;                        // 惑星の裏は描かない
    setPixel(img, x, y, mid(BASE_MID.lamp, y));
    setPixel(img, x, y + 1, mid(BASE_MID.lamp, y + 1));
  }

  // ---- 地面(着陸場)。奥ほど細い横線にして遠近を出す ----
  for (let y = HORIZON; y < H; y++) {
    const t = (y - HORIZON) / (H - HORIZON);
    span(y, W / 2 - 26 - t * 132, W / 2 + 26 + t * 132, mid(BASE_MID.ground, y));
  }
  // 着陸場の光る枠。手前へ広がる 2 本のライン
  for (let k = 0; k < 7; k++) {
    const y = HORIZON + 6 + k * 10;
    const t = (y - HORIZON) / (H - HORIZON);
    span(y, W / 2 - 22 - t * 116, W / 2 - 14 - t * 100, mid(BASE_MID.lamp, y));
    span(y, W / 2 + 14 + t * 100, W / 2 + 22 + t * 116, mid(BASE_MID.lamp, y));
  }

  // ---- 基地 ----
  // 左: 段になったドーム。上に細いアンテナ塔
  for (let y = 78; y < HORIZON; y++) {
    const t = (y - 78) / (HORIZON - 78);
    const w = Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))) * 44;
    span(y, 34 - w, 34 + w, mid(BASE_MID.wall, y));
  }
  for (let y = 92; y < HORIZON; y += 12) span(y, 12, 56, mid(BASE_MID.lamp, y));
  for (let y = 56; y < 80; y++) span(y, 32, 36, mid(BASE_MID.wall, y));   // アンテナの柱
  for (let k = 0; k < 3; k++) {                                          // 皿
    const y = 58 + k * 2, w = 16 - k * 5;
    span(y, 34 - w, 34 + w, mid(BASE_MID.wall, y));
  }
  // 右: 角ばった管制塔。上に張り出した展望部
  for (let y = 52; y < HORIZON; y++) span(y, 182, 198, mid(BASE_MID.wall, y));
  for (let y = 52; y < 70; y++) span(y, 170, 210, mid(BASE_MID.wall, y));
  for (let y = 56; y < 66; y++) span(y, 174, 206, mid(BASE_MID.lamp, y));
  for (let y = 44; y < 52; y++) span(y, 188, 192, mid(BASE_MID.wall, y));   // 頂上の灯
  span(42, 186, 194, mid(BASE_MID.lamp, 42));
  // 中央奥: 格納庫。入口にエネルギーの膜が張っている
  for (let y = 96; y < HORIZON; y++) span(y, 88, 152, mid(BASE_MID.wall, y));
  for (let y = 88; y < 98; y++) span(y, 96, 144, mid(BASE_MID.wall, y));    // ひさし
  for (let y = 102; y < HORIZON; y++) {
    // 膜は横しまで、うっすら光っている
    span(y, 98, 142, mid((y & 3) < 2 ? BASE_MID.lamp : BASE_MID.sky, y));
  }
  // 左右をつなぐ連絡橋(細い柱で持ち上げてある)
  for (let y = 84; y < 90; y++) span(y, 56, 90, mid(BASE_MID.wall, y));
  for (let y = 84; y < 90; y++) span(y, 150, 184, mid(BASE_MID.wall, y));
  for (const bx of [66, 80, 158, 172]) {
    for (let y = 90; y < HORIZON; y++) span(y, bx, bx + 2, mid(BASE_MID.sky, y));
  }

  // ---- 待っている人たち ----
  // 頭・胴・腕・脚をちゃんと描き分ける。手前ほど大きく、
  // 半分くらいは腕を上げて振っている
  const person = (px, py, h, wave, flip) => {
    const u = h / 22;                             // この人の大きさ
    const headR = Math.round(3.2 * u);
    const bodyTop = py - h + headR * 2;
    const legTop = py - Math.round(7 * u);
    // 頭
    for (let y = py - h; y < py - h + headR * 2; y++) {
      const dy = (y - (py - h + headR)) / headR;
      const w = Math.sqrt(Math.max(0, 1 - dy * dy)) * headR;
      span(y, px - w, px + w, mid(BASE_MID.crowd, y));
    }
    // 胴(肩が広く、腰で少ししぼる)
    for (let y = bodyTop; y < legTop; y++) {
      const t = (y - bodyTop) / Math.max(1, legTop - bodyTop);
      const w = (4.4 - t * 1.2) * u;
      span(y, px - w, px + w, mid(BASE_MID.crowd, y));
    }
    // 脚 2 本
    for (let y = legTop; y < py; y++) {
      span(y, px - 3.6 * u, px - 1.0 * u, mid(BASE_MID.crowd, y));
      span(y, px + 1.0 * u, px + 3.6 * u, mid(BASE_MID.crowd, y));
    }
    // 腕。振っているほうは上へ、もう片方は下ろす
    const sx = flip ? -1 : 1;
    for (let k = 0; k < Math.round(10 * u); k++) {   // 下ろした腕
      const y = bodyTop + k;
      span(y, px - sx * (5.6 * u), px - sx * (4.0 * u), mid(BASE_MID.crowd, y));
    }
    if (wave) {
      for (let k = 0; k < Math.round(11 * u); k++) { // 上げた腕
        const y = bodyTop + Math.round(2 * u) - k;
        const dx = (4.2 + k * 0.28) * u;
        span(y, px + sx * dx, px + sx * (dx + 1.8 * u), mid(BASE_MID.crowd, y));
      }
      // 手のひら
      const hy = bodyTop + Math.round(2 * u) - Math.round(11 * u);
      for (let y = hy - Math.round(2 * u); y < hy + Math.round(u); y++) {
        span(y, px + sx * (7.2 * u), px + sx * (10 * u), mid(BASE_MID.crowd, y));
      }
    } else {
      for (let k = 0; k < Math.round(10 * u); k++) {
        const y = bodyTop + k;
        span(y, px + sx * (4.0 * u), px + sx * (5.6 * u), mid(BASE_MID.crowd, y));
      }
    }
  };
  // 奥(小さい)から手前(大きい)へ
  const PEOPLE = [
    [26, 166, 17], [206, 164, 17], [46, 172, 20], [188, 173, 20],
    [70, 179, 23], [166, 180, 23], [96, 188, 27], [142, 189, 27],
  ];
  for (const [px, py, h] of PEOPLE) person(px, py, h, rand() < 0.6, rand() < 0.5);

  // ---- 降りてくる戦闘機 ----
  // ゲーム中の自機とちがう形だと別の機体に見えるので、
  // 同じ絵(player)をそのまま 3 倍にして置く
  const SX = W / 2, SY = 52;
  const ship = scaleImage(player, 3);
  for (let y = 0; y < ship.height; y++) {
    for (let x = 0; x < ship.width; x++) {
      const o = (y * ship.width + x) * 4;
      if (!ship.data[o + 3]) continue;
      setPixel(img, Math.round(SX - ship.width / 2) + x, SY + y,
        [ship.data[o], ship.data[o + 1], ship.data[o + 2]]);
    }
  }
  // 左右のエンジンから噴射
  for (let y = ship.height; y < ship.height + 14; y++) {
    const t = (y - ship.height) / 14;
    for (const ex of [SX - 15, SX + 15]) {
      const w = (4 - t * 3) * (0.7 + rand() * 0.6);
      span(SY + y, ex - w, ex + w, mid(BASE_MID.flame, SY + y));
    }
  }
  // 着陸灯。機体から地面へ広がる光(すけて見えるよう行をとばす)
  for (let y = 36; y < H - SY; y++) {
    const t = y / (H - SY);
    const w = 8 + t * 42;
    if ((y & 3) === 0 && rand() < 0.7) span(SY + y, SX - w, SX + w, mid(BASE_MID.lamp, SY + y));
  }
  return img;
}
const endBase = makeBaseScene(11);

/** ブラックホール。中心は真っ黒、周りに降着円盤のリングが広がる */
function makeBlackHole(seed) {
  const W = 112, H = 72;
  const img = createImage(W, H);
  const rand = rng(seed);
  const HOT = hex('#ffffff'), MID = hex('#ffd84d'), COOL = hex('#ff8c1a'), FAR = hex('#b95e51');
  const cx = W / 2, cy = H / 2;
  const SLANT = 0.45;  // 傾き(大きいほど斜め)
  // 降着円盤(つぶれた同心円)。行ごとに 2 色の組が変わるよう色を段階的にする
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 水平だと模様に見えるので、円盤を斜めに倒す(行ごとに中心をずらす)
      const dy0 = (y + 0.5 - cy);
      const dx = (x + 0.5 - cx - dy0 * SLANT) / 52, dy = dy0 / 16;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1 || d < 0.28) continue;
      const odd = (y & 1) === 1;
      let c;
      if (d < 0.42) c = odd ? HOT : MID;
      else if (d < 0.6) c = MID;
      else if (d < 0.78) c = odd ? MID : COOL;
      else c = odd ? COOL : FAR;
      if (rand() < 0.12) continue; // まばらに抜いて渦の粒感を出す
      setPixel(img, x, y, c);
    }
  }
  // 事象の地平面(真っ黒な穴)とその縁の光
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const o = (y * W + x) * 4;
      if (d < 13) { img.data[o + 3] = 0; }                  // 穴(透明 = 黒)
      else if (d < 15) setPixel(img, x, y, (y & 1) ? MID : HOT); // 光の輪
    }
  }
  return img;
}
// 水平だと模様に見えるので少し傾ける
const blackhole = makeBlackHole(777);

/** 円筒形の宇宙コロニー。斜めに傾け、ガンダム風の大きなミラー(羽)を広げる */
function makeColony() {
  const W = 56, H = 48;
  const img = createImage(W, H);
  const LIGHT = hex('#dfe6f2'), BODY = hex('#9aa8c0'), DARK = hex('#5a6478');
  const GLASS = hex('#7ce8ff');
  const LEN = 30, RAD = 4;
  // 左下から右上へ伸びる円筒。中心線に沿って断面を積む
  const x0 = 12, y0 = H - 13, slope = -0.62;
  // 先にミラー(羽)を描く。円筒から左右へ大きく開いた 3 枚の板
  const MIRROR = hex('#7f8aa4'), MIRROR2 = hex('#c3cddf');
  for (const [side, spread] of [[-1, 0.9], [1, 0.9], [-1, 0.35]]) {
    for (let t = 3; t < LEN - 3; t += 1) {
      const cx = x0 + t, cy = Math.round(y0 + slope * t);
      // 円筒から離れるほど幅が広がる板
      for (let d = RAD + 2; d < RAD + 13; d++) {
        const px = Math.round(cx + side * d * spread * 0.55);
        const py = Math.round(cy + side * d * (1 - spread * 0.45));
        // 1 ラインおきに明るさを変えて金属板らしくする
        setPixel(img, px, py, ((py & 1) === 0) ? MIRROR2 : MIRROR);
      }
    }
  }
  for (let t = 0; t < LEN; t++) {
    const cx = x0 + t, cy = Math.round(y0 + slope * t);
    for (let d = -RAD; d <= RAD; d++) {
      const y = cy + d;
      // 上側が明るく下側が影。境目は 1 ラインおきに混ぜる
      const u = (d + RAD) / (RAD * 2);
      const odd = (y & 1) === 1;
      let c = u < 0.25 ? LIGHT : u < 0.35 ? (odd ? BODY : LIGHT)
            : u < 0.7 ? BODY : u < 0.8 ? (odd ? DARK : BODY) : DARK;
      // 両端のリングは一段明るく
      if (t < 3 || t > LEN - 4) c = BODY;
      setPixel(img, cx, y, c);
    }
    // 居住区の窓(2 本の帯)
    if (t > 3 && t < LEN - 4 && t % 3 === 0) {
      setPixel(img, cx, cy - 2, GLASS);
      setPixel(img, cx, cy + 2, GLASS);
    }
  }
  return img;
}
const colony = makeColony();

/** 宇宙に浮かぶモアイ像(左を向いた横顔)。額・鼻・唇・あごの出っぱりで顔に見せる */
/** 小惑星(自機の 3 倍ほど)。2 面以降、当たり判定を持って流れてくる */
function makeAsteroid(seed) {
  const S = 48, R = 22;
  const img = createImage(S, S);
  const rand = rng(seed);
  // いちばん暗い面を真っ黒にすると背景に溶けて見えなくなるので、
  // 「暗い緑」と黒の横じまを中間色として使う(行ごとに 2 色なので制約も守れる)
  const ROCK = hex('#cccccc'), HI = hex('#ffffff');
  const SHADE = hex('#3aa241'), BLACK = hex('#101010');
  // でこぼこした輪郭(角度ごとに半径を変える)
  const bump = [];
  for (let i = 0; i < 32; i++) bump.push(0.78 + rand() * 0.26);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - S / 2, dy = y + 0.5 - S / 2;
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2) * 32;
      const i0 = Math.floor(a) % 32, i1 = (i0 + 1) % 32, f = a - Math.floor(a);
      const rr = R * (bump[i0] * (1 - f) + bump[i1] * f);
      if (d > rr) continue;
      // 左上が明るい岩肌。行ごとに 2 色の組を変える
      const lit = (-dx - dy) / (R * 2) + 0.5;
      const odd = (y & 1) === 1;
      // 1 行 1 組の 2 色でグラデーションを作る。
      // いちばん明るい面は白のハイライト、暗い面は灰と黒の混ぜで表す
      let c = lit > 0.76 ? HI : lit > 0.66 ? (odd ? ROCK : HI)
            : lit > 0.42 ? ROCK : lit > 0.28 ? (odd ? SHADE : ROCK)
            : (odd ? SHADE : BLACK);
      setPixel(img, x, y, rand() < 0.05 ? SHADE : c);
    }
  }
  return img;
}
const asteroid = makeAsteroid(1234);

/** 明るい部分(白)だけを抜き出した絵を作る(重ねるハイライト用) */
function extractHighlight(src, color) {
  const img = createImage(src.width, src.height);
  const c = hex(color);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const o = (y * src.width + x) * 4;
      if (src.data[o + 3] < 128) continue;
      // 元の絵で白に近いところだけ残す
      if (src.data[o] > 200 && src.data[o + 1] > 200 && src.data[o + 2] > 200) {
        setPixel(img, x, y, c);
      }
    }
  }
  return img;
}
// 小惑星に重ねる白いハイライト(スプライト 1 枚。ちらつかせて使う)
const asteroidHi = extractHighlight(asteroid, '#ffffff');

/**
 * 宇宙に浮かぶモアイ像(左を向いた横顔)。
 * 左側の輪郭を y ごとにずらして、額 -> 眉 -> 鼻すじ -> 鼻先 -> 唇 -> あご を作る。
 */
function makeMoai() {
  const W = 28, H = 46;   // 一回り小さく
  const img = createImage(W, H);
  const C = hex('#b95e51'); // 暗い赤(MSX の dark red)
  const backX = W - 4;      // 後頭部(右端)
  // 左の輪郭(横顔)。値が小さいほど左へ出っぱる。
  // モアイと分かるように「長い頭 / せり出した眉 / まっすぐな鼻 / 突き出たあご」を強調する
  const profile = (y) => {
    const t = y / H;
    if (t < 0.08) return 12 - t * 90;            // 頭のてっぺん(斜めに落ちる)
    if (t < 0.26) return 5;                      // 長い額
    if (t < 0.34) return 1;                      // せり出した眉(ここが目印)
    if (t < 0.40) return 4;                      // 目のくぼみ
    if (t < 0.56) return 4 - (t - 0.40) * 25;    // まっすぐ下りる鼻すじ
    if (t < 0.60) return 0;                      // 鼻先
    if (t < 0.66) return 7;                      // 鼻の下(引っこむ)
    if (t < 0.76) return 5;                      // 唇
    if (t < 0.86) return 2;                      // 突き出たあご
    return 2 + (t - 0.86) * 70;                  // 首元
  };
  for (let y = 0; y < H; y++) {
    const x0 = Math.max(0, Math.round(profile(y)));
    for (let x = x0; x <= backX; x++) setPixel(img, x, y, C);
  }
  // 目と口のくぼみ(透明 = 背景の黒になる)
  const hole = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const o = (y * W + x) * 4;
        if (o >= 0 && o < img.data.length) img.data[o + 3] = 0;
      }
    }
  };
  hole(5, Math.round(H * 0.35), 6, 4);   // 眉の下の深い目
  hole(4, Math.round(H * 0.70), 7, 3);   // 口
  // 長い耳(後ろ寄りに縦の溝を彫って、耳の輪郭を出す)
  hole(backX - 5, Math.round(H * 0.32), 1, Math.round(H * 0.28));
  return img;
}

/**
 * 下のほうを市松で抜いて影のグラデーションにする。
 * 単色の絵なので、市松でも「横 8 ドット 2 色」に収まる。
 * 回すと市松が崩れてただのノイズになるので、必ず回したあとに掛ける。
 */
function addBottomShade(img) {
  const { width: W, height: H } = img;
  for (let y = Math.round(H * 0.6); y < H; y++) {
    const t = (y - H * 0.6) / (H * 0.4);
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (img.data[o + 3] < 128) continue;
      const check = ((x + y) & 1) === 0;
      const sparse = ((x * 2 + y) & 3) === 0;
      if (t > 0.5 ? check : sparse) img.data[o + 3] = 0;
    }
  }
  return img;
}

/** 画像を時計回りに deg 度まわす(空いたところは透明のまま) */
function rotateImage(src, deg) {
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  // 回転後に収まる大きさを求める
  const W = Math.ceil(Math.abs(src.width * cos) + Math.abs(src.height * sin));
  const H = Math.ceil(Math.abs(src.width * sin) + Math.abs(src.height * cos));
  const img = createImage(W, H);
  const scx = src.width / 2, scy = src.height / 2;
  const dcx = W / 2, dcy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 出力側から入力側へ逆回転して色を拾う
      const dx = x + 0.5 - dcx, dy = y + 0.5 - dcy;
      const sx = Math.floor(dx * cos + dy * sin + scx);
      const sy = Math.floor(-dx * sin + dy * cos + scy);
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const o = (sy * src.width + sx) * 4;
      if (src.data[o + 3] < 128) continue;
      setPixel(img, x, y, [src.data[o], src.data[o + 1], src.data[o + 2]]);
    }
  }
  return img;
}

/** 画像を左右反転する */
function flipX(src) {
  const img = createImage(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      if (src.data[s + 3] < 128) continue;
      setPixel(img, src.width - 1 - x, y, [src.data[s], src.data[s + 1], src.data[s + 2]]);
    }
  }
  return img;
}

// 真横だと硬いので、時計回りに 30 度かたむける。左右反転版も用意する
const moaiBase = makeMoai();
const moai = addBottomShade(rotateImage(moaiBase, 30));
const moaiFlip = addBottomShade(rotateImage(flipX(moaiBase), -30));

/** 土星。遠くに見える小さめの背景オブジェクト(72x44)。
 *  行ごとに 1 色を守るため、輪も本体もその行の色で描く(形で見せる) */
function makeSaturn() {
  const W = 72, H = 44, img = createImage(W, H);
  const PALE = hex('#ded087'), BAND = hex('#ccc35e'), LIT = hex('#ffffff');
  const cx = W / 2, cy = H / 2, R = 15;
  // 行ごとの色。上を明るく、しま模様を入れる
  const rowColor = (y) => {
    const t = (y - (cy - R)) / (R * 2);
    if (y < cy - R + 3) return LIT;               // てっぺんの光
    if (t < 0.30) return (y & 1) ? BAND : PALE;   // しま
    if (t < 0.45) return PALE;
    if (t < 0.60) return (y & 1) ? PALE : BAND;   // しま
    return PALE;
  };
  // 本体
  for (let y = 0; y < H; y++) {
    const dy = (y - cy) / R;
    if (Math.abs(dy) > 1) continue;
    const half = R * Math.sqrt(1 - dy * dy);
    const c = rowColor(y);
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      setPixel(img, x, y, c);
    }
  }
  // 輪。細い帯にして、本体の円と見分けが付くようにする。
  // 輪の上半分は本体の裏に回るので描かない
  const RX = 34, RY = 9, TH = 0.13;   // TH = 帯の太さ(楕円の比で)
  for (let y = 0; y < H; y++) {
    const dy = (y - cy) / RY;
    if (Math.abs(dy) > 1) continue;
    const c = rowColor(y);
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / RX;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1 || d < 1 - TH) continue;              // 細い帯だけ
      // 本体の裏に回る上半分は描かない
      const inBody = Math.hypot(x - cx, y - cy) < R - 1;
      if (inBody && y <= cy) continue;
      setPixel(img, x, y, c);
    }
  }
  return img;
}
const saturn = makeSaturn();


// 天の川。斜めに走る帯を、行ごとに白/灰/水色を混ぜて濃淡にする
function makeMilkyWay(seed) {
  const W = 128, H = 128, img = createImage(W, H);
  let st = seed || 99;
  const rand = () => (st = (st * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const COLS = ['#ffffff', '#cccccc', '#65dbef'].map(hex);
  for (let y = 0; y < H; y++) {
    // 1 行 1 色(行ごとに切り替えて中間色に見せる)
    const c = COLS[(y % 6 < 3) ? (y % 2) : (y % 3 === 0 ? 2 : 1)];
    const center = 24 + y * 0.55;              // 斜めに流れる帯
    const halfW = 16 + Math.sin(y * 0.05) * 8;
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x - center) / halfW;
      if (d > 1) continue;
      // 中心ほど密に、外へ行くほどまばらに
      if (rand() < 0.55 * (1 - d * d)) setPixel(img, x, y, c);
    }
  }
  return img;
}
const milkyway = makeMilkyWay(4321);

// 宇宙デブリ。壊れた機体の破片が漂っている帯
function makeDebris(seed) {
  const W = 96, H = 64, img = createImage(W, H);
  let st = seed || 55;
  const rand = () => (st = (st * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const COLS = ['#cccccc', '#7c7c7c', '#5955e0'].map(hex);
  for (let i = 0; i < 26; i++) {
    const bx = Math.floor(rand() * (W - 10));
    const by = Math.floor(rand() * (H - 8));
    const bw = 3 + Math.floor(rand() * 7);
    const bh = 2 + Math.floor(rand() * 4);
    for (let y = by; y < by + bh; y++) {
      // 破片ごとに 1 行 1 色
      const c = COLS[(y + i) % COLS.length];
      for (let x = bx; x < bx + bw; x++) setPixel(img, x, y, c);
    }
  }
  return img;
}
const debris = makeDebris(777);

// ---------------------------------------------------------------- タイトルロゴ

// ロゴ用の太い 8x8 字形。これを 3 倍に拡大し、斜体にして縁取りを付ける。
const LOGO_FONT = {
  S: ['.######.', '##......', '##......', '.######.', '......##', '......##', '.######.', '........'],
  T: ['########', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '........'],
  A: ['..####..', '.##..##.', '##....##', '########', '##....##', '##....##', '##....##', '........'],
  R: ['######..', '##...##.', '##...##.', '######..', '##.##...', '##..##..', '##...##.', '........'],
  I: ['########', '...##...', '...##...', '...##...', '...##...', '...##...', '########', '........'],
  D: ['######..', '##...##.', '##....##', '##....##', '##....##', '##...##.', '######..', '........'],
  F: ['########', '##......', '##......', '######..', '##......', '##......', '##......', '........'],
  B: ['######..', '##...##.', '##...##.', '######..', '##...##.', '##...##.', '######..', '........'],
  L: ['##......', '##......', '##......', '##......', '##......', '##......', '########', '........'],
  E: ['########', '##......', '##......', '######..', '##......', '##......', '########', '........'],
};

/**
 * タイトルロゴ。**2 段にずらして重ねる**。
 *   STAR  を左上に、FABLE を右下に置き、影を右下へ 3 ドット付ける。
 * 1 行に詰めていたころより 1 段大きい字が使えて、斜体の流れも出る。
 *
 * 横 8 ドット 2 色は、書き出しのときに BG 素材として自動で均される
 * (BG_IMAGES に 'logo' が入っている)。ここでは色を自由に置いてよい。
 */
const LOGO_W = 256, LOGO_H = 64;

/** 字の並びを作って「インクのある座標」の集合を返す */
function logoLayout(text, { sc, slant, top, cx, gap = 2, spaceAdv = 12 }) {
  const inkL = (g) => {
    for (let c = 0; c < 8; c++) for (let r = 0; r < 8; r++) if (g[r][c] === '#') return c;
    return 0;
  };
  const inkR = (g) => {
    for (let c = 7; c >= 0; c--) for (let r = 0; r < 8; r++) if (g[r][c] === '#') return c;
    return 7;
  };
  // 次の字までの送り = 今の字の右端 -> 次の字の左端が gap ドットになる距離
  const advance = (ch, next) => {
    const g = LOGO_FONT[ch];
    if (!g) return spaceAdv;
    const ng = LOGO_FONT[next];
    if (!ng) return (inkR(g) + 1) * sc;
    return (inkR(g) + 1) * sc + gap - inkL(ng) * sc;
  };
  const chars = [...text];
  const textW = chars.reduce((w, ch, i) => w + advance(ch, chars[i + 1]), 0);
  let pen = Math.round(cx - (textW + 8 * sc * slant) / 2);
  const pts = new Set();
  for (let i = 0; i < chars.length; i++) {
    const glyph = LOGO_FONT[chars[i]];
    if (!glyph) { pen += spaceAdv; continue; }
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (glyph[r][c] !== '#') continue;
        for (let sy = 0; sy < sc; sy++) {
          const y = top + r * sc + sy;
          // 上へ行くほど右へ倒す(斜体)
          const sl = Math.round((8 * sc - (y - top)) * slant);
          for (let sx = 0; sx < sc; sx++) pts.add((pen + c * sc + sx + sl) + ',' + y);
        }
      }
    }
    pen += advance(chars[i], chars[i + 1]);
  }
  return pts;
}

function makeLogo() {
  const W = LOGO_W, H = LOGO_H, img = createImage(W, H);
  const OUT = hex('#101010'), SHADOW = hex('#3f37c9');
  const put = (x, y, col) => {
    if (x >= 0 && x < W && y >= 0 && y < H) setPixel(img, x, y, col);
  };
  // 影 -> 縁取り -> 本体 の順に置く。あとから置いたものが上に来る
  const shadow = (pts) => {
    for (const k of pts) {
      const [x, y] = k.split(',').map(Number);
      for (let d = 1; d <= 3; d++) put(x + d, y + d, SHADOW);
    }
  };
  const outline = (pts) => {
    for (const k of pts) {
      const [x, y] = k.split(',').map(Number);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!pts.has((x + dx) + ',' + (y + dy))) put(x + dx, y + dy, OUT);
        }
      }
    }
  };
  // 本体は横じまのグラデーション。1 行 = 1 色なので制約に収まりやすい
  const body = (pts, ramp, top, span) => {
    for (const k of pts) {
      const [x, y] = k.split(',').map(Number);
      const i = Math.min(ramp.length - 1, Math.max(0, Math.floor(((y - top) * ramp.length) / span)));
      put(x, y, hex(ramp[i]));
    }
  };

  const SC = 4, SLANT = 0.3;
  // 影と斜体のぶんだけ中身が右へ寄るので、置き場所を 10 ドット左へ寄せてある
  const star = logoLayout('STAR', { sc: SC, slant: SLANT, top: 4, cx: 86 });
  const fable = logoLayout('FABLE', { sc: SC, slant: SLANT, top: 28, cx: 146 });
  // 下の段(FABLE)を先に置いて、上の段(STAR)を手前に重ねる
  shadow(fable); outline(fable);
  body(fable, ['#65dbef', '#8076f1', '#5955e0', '#3f37c9'], 28, 32);
  shadow(star); outline(star);
  body(star, ['#ffffff', '#ffffff', '#65dbef', '#8076f1'], 4, 32);
  return img;
}
const logo = makeLogo();

// ---------------------------------------------------------------- サウンド (MML)

// ---- カノン進行(マイナー・セブンス多用) ----
// Am7 - Em7 - FM7 - CM7 - Dm7 - Am7 - Dm7 - E7 の 8 小節。
// 和音は「根音 - 第3音 - 第5音 - 第7音」の分散和音(アルペジオ)で鳴らす。
// アルペジオは 7th / 9th を積極的に混ぜ、上下動を抑えて近い音でつなぐ
// アルペジオ(分散和音)。1 行 = 1 小節。4 音の型を 4 回まわす
// 4 小節ごとに後半を休符にして、伴奏にも息継ぎを作る
const CANON_ARP = [
  'o4 [a>ceg<]4',        // Am7  (A C E G)
  'o4 [egb>d<]4',        // Em7  (E G B D)
  'o4 [fa>ce<]4',        // FM7  (F A C E)
  'o4 [cegb]2 r2',       // CM7  後半を抜く
  'o4 [dfa>c<]4',        // Dm7  (D F A C)
  'o4 [a>ceg<]4',        // Am7
  'o4 [dfa>c<]4',        // Dm7
  'o4 [eg+b>d<]2 r2',    // E7   後半を抜いて次へつなぐ
].join(' ');

// アルペジオとは別に鳴らす歌メロ。跳ばずに順次進行でつなぎ、
// コードの構成音と 7th の範囲でまとめる(9th は踏まない)。
// 1 行 = 1 小節 = 8 分音符 8 個ぶん。
// だらだら鳴り続けないよう、要所で音を切って休符を入れ、
// 決めの小節では三連符(l12)で畳みかける。
const CANON_MELODY = [
  'o5 e4. d8 c4 r4',              // Am7: 4 拍目を休んで間をとる
  'o5 d4. b8 g4 b4',              // Em7
  'o5 c4. a8 f4 r4',              // FM7: ここも休符
  'o5 l12 b b >c< l8 b4 g4 r4',   // CM7: 三連符で走ってから止まる
  'o5 a4. f8 d4 r4',              // Dm7
  'o5 g4. e8 c4 e4',              // Am7
  'o5 l12 f g a l8 f4 d4 r4',     // Dm7: 三連符の駆け上がり
  'o5 e2 g+4 b4',                 // E7: 決め
].join(' ');

// ベース(1 小節 8 分音符 x8 のオクターブ奏法)
// ベースは跳ねるリズム(付点8分 + 16分)でオクターブを行き来する
const CANON_BASS = [
  'o2 [a8. >a16< ]4', 'o2 [e8. >e16< ]4', 'o2 [f8. >f16< ]4', 'o2 [c8. >c16< ]4',
  'o2 [d8. >d16< ]4', 'o2 [a8. >a16< ]4', 'o2 [d8. >d16< ]4', 'o2 [e8. >e16< ]4',
].join(' ');

// A' : A メロの変奏。コード進行は同じだが、歌い出しを高く取り、
// 三連符の位置をずらして「2 回目」だと分かるようにする。
// A と同じ骨格のまま、装飾と終わり方だけ変える(大きくは動かさない)。
// 各小節の頭はコードの構成音に置いて、外れて聞こえないようにしてある。
const CANON_MELODY_A2 = [
  'o5 e4. d8 c4 e4',              // Am7  (A C E G) 最後を e にして続ける
  'o5 d4. b8 g4 r4',              // Em7  (E G B D)
  'o5 c4. a8 f4 a4',              // FM7  (F A C E)
  'o5 l12 b b >c< l8 b4 g4 r4',   // CM7  (C E G B)
  'o5 a4. f8 d4 f4',              // Dm7  (D F A C)
  'o5 g4. e8 c4 r4',              // Am7
  'o5 l12 f g a l8 f4 d4 f4',     // Dm7
  'o5 e2 b4 g+4',                 // E7   (E G# B D) 下りで締める
].join(' ');

// ---- 展開(B メロ) ----
// Dm7 - G7 - CM7 - Am7 - Dm7 - E7 - Am7 - E7。A メロを 2 回まわしたあとに 1 回だけ入る。
const BRIDGE_ARP = [
  'o4 [dfa>c<]4',    // Dm7
  'o3 [gb>df<]4',    // G7  (G B D F)
  'o4 [cegb]4',      // CM7
  'o4 [a>ceg<]4',    // Am7
  'o4 [dfa>c<]4',    // Dm7
  'o4 [eg+b>d<]4',   // E7
  'o4 [a>ceg<]4',    // Am7
  'o4 [eg+b>d<]4',   // E7
].join(' ');

const BRIDGE_BASS = [
  'o2 [d>d<]4', 'o2 [g>g<]4', 'o2 [c>c<]4', 'o2 [a>a<]4',
  'o2 [d>d<]4', 'o2 [e>e<]4', 'o2 [a>a<]4', 'o2 [e>e<]4',
].join(' ');

// 9th は踏まず、コードの構成音と 7th だけで歌う
const BRIDGE_MELODY = [
  'o5 f4. d8 a4 f4',       // Dm7 (D F A C)
  'o5 g4. f8 d4 g4',       // G7  (G B D F)
  'o5 e4. c8 g4 e4',       // CM7 (C E G B)
  'o5 a4. g8 e4 a4',       // Am7 (A C E G)
  'o5 f4. a8 d4 f4',       // Dm7
  'o5 g+4. e8 b4 g+4',     // E7  (E G# B D)
  'o5 a4. g8 e4 c4',       // Am7
  'o5 b2 g+4 e4',          // E7
].join(' ');

// ---- 終結部(C メロ) ----
// F - G - Em - Am - Dm - G - CM7 - E7。B のあとに置いて、
// 一段明るくしてから元の Am へ帰る 8 小節。
// テンポや音数は落とさず、そのまま走り抜ける。
const CODA_ARP = [
  'o4 [fa>ce<]4',    // FM7
  'o3 [gb>df<]4',    // G7
  'o4 [egb>d<]4',    // Em7
  'o4 [a>ceg<]4',    // Am7
  'o4 [dfa>c<]4',    // Dm7
  'o3 [gb>df<]4',    // G7
  'o4 [cegb]4',      // CM7
  'o4 [eg+b>d<]2 r2',// E7
].join(' ');

const CODA_BASS = [
  'o2 [f>f<]4', 'o2 [g>g<]4', 'o2 [e>e<]4', 'o2 [a>a<]4',
  'o2 [d>d<]4', 'o2 [g>g<]4', 'o2 [c>c<]4', 'o2 [e>e<]4',
].join(' ');

// 旋律は各コードの構成音と 7th までにとどめる(9th は踏まない)
const CODA_MELODY = [
  'o5 >c4.< a8 f4 a4',            // FM7 (F A C E)
  'o5 b4. g8 d4 g4',              // G7  (G B D F)
  'o5 g4. e8 b4 r4',              // Em7 (E G B D)
  'o5 l12 a b >c< l8 a4 e4 r4',   // Am7 (A C E G)
  'o5 f4. d8 a4 r4',              // Dm7 (D F A C)
  'o5 g4. b8 >d4< r4',            // G7
  'o5 e4. g8 >c4< r4',            // CM7 (C E G B)
  'o5 b2 g+4 e4',                 // E7  (E G# B D)
].join(' ');

// A' だけに重ねるハモリ。歌メロの 3 度下を、同じリズムでなぞる。
// 2 周目に入ったことが耳で分かるように、ここだけ厚くする
// (A / B / C のあいだは休符。ノイズは使わないので声の取り合いにならない)
const CANON_HARMONY_A2 = [
  'o5 c4. <b8 a4 >c4',            // Am7
  'o4 b4. g8 e4 r4',              // Em7
  'o4 a4. f8 d4 f4',              // FM7
  'o4 l12 g g a l8 g4 e4 r4',     // CM7
  'o5 f4. d8 <b4 >d4',            // Dm7
  'o5 e4. c8 <a4 r4',             // Am7
  'o5 l12 d e f l8 d4 <b4 >d4',   // Dm7
  'o4 b2 >g+4 e4',                // E7
].join(' ');
// 前(A)と後ろ(B, C)は休む。1 小節 = l1 の休符 1 つ
const REST_BARS = (n) => 'l1 ' + 'r '.repeat(n);

// メイン BGM: 明るいパルス波のアルペジオ + 三角波ベース + ノイズドラム
// 構成は A - A'(変奏) - B(展開) - C(終結) の 32 小節でループする
const BGM_MAIN = [
  // 歌メロ(デチューンはかけずに輪郭をはっきりさせる)
  // 音色はゲーム側で足した波形メモリ wtLead(main.js の addWave)。
  // 1 オクターブ下を重ねて太くし(@o1)、デチューンで少しにじませる(@d12)
  // 重ね(@o1)とデチューン(@d12)で 1 音が 3 つぶんの厚みになるので、
  // そのぶん音量を下げてつり合いを取る(v12 -> v10、エコーも浅く)
  't150 q7 v10 l8 @{wtLead} @e{soft} @s2 @o1 @d12 ' + CANON_MELODY + ' ' + CANON_MELODY_A2 + ' ' +
    BRIDGE_MELODY + ' ' + CODA_MELODY,
  // アルペジオ(伴奏)。25% パルスで軽く
  't150 q7 v9 l16 @{pulse25} @e{flat} @s2 [' + CANON_ARP + ']2 ' +
    BRIDGE_ARP + ' ' + CODA_ARP,
  // ベースは三角波(ファミコン風)
  't150 q8 v12 l8 @{triangle} @e{flat} [' + CANON_BASS + ']2 ' +
    BRIDGE_BASS + ' ' + CODA_BASS,
  // ドラム(ノイズ)。@e{percussive} = 打楽器エンベロープ
  '@{noise} @e{percussive} t150 l8 [v12o2c v6o6c v10o4c v6o6c v12o2c v6o6c v10o4c v6o6c]32',
  // A' のハモリ(歌メロの 3 度下)。A / B / C のあいだは休む
  't150 q7 v9 l8 @{pulse25} @e{soft} @s2 ' + REST_BARS(8) + 'l8 ' + CANON_HARMONY_A2 +
    ' ' + REST_BARS(16),
];

// 最大パワー時の BGM。ここだけカノン進行から離れて、
// 縦シューらしい快速のメジャー調リフで押していく。
// コードは C - F - G - C / C - Am - F - G の 8 小節。
// 裏拍を食う 16 分をまぜたフック(1 行 = 1 小節 = 16 分 16 個)。
// 使う音はコードの構成音(1/3/5)と sus4 の 4 度だけに絞って、
// 濁らず勢いだけが出るようにしてある。
// 音程を上下させず、同じ音を何度も刻んで押していくフック。
// 使う音はコードの構成音(1/3/5)と sus4 の 4 度だけ。
// メロディは出ずっぱりにせず、2 小節に 1 回は後半を休んで
// そこへ別の音色(POWER_CALL)の合いの手が入る。
const POWER_MELODY = [
  'o5 g8 g16 g16 g8 g8  e8 e16 e16 e8 e8',    // C
  'o5 g+8 g+16 g+16 g+8 b8  r2',              // E7  半音上げて緊張を作る
  'o5 a8 a16 a16 a8 a8  >c8 c16 c16< a8 a8',  // Am
  'o5 f8 f16 f16 f8 g8  r2',                  // F   休符(合いの手へ)
  'o5 g8 g16 g16 g8 g8  e8 e16 e16 e8 e8',    // C
  'o5 b8 b16 b16 b8 b8  >d8 d16 d16< b8 b8',  // G
  'o5 a8 a16 a16 a8 a8  r2',                  // F   休符
  'o5 b8 b16 b16 b8 >d8<  g4 r4',             // G   決め
].join(' ');

// 合いの手。メロディが休んでいるところだけ、三角波の短いフレーズで応える
const POWER_CALL = [
  'r1',
  'r2 o5 b16 b16 g+8 b8 >e8<',        // E7 の裏
  'r1',
  'r2 o6 c16 c16 <a8 f8 a8',          // F  の裏
  'r1',
  'r1',
  'r2 o6 c16 c16 <a8 f8 >c8<',        // F  の裏
  'r2 o5 g16 g16 b8 >d8 g8<',         // G  決めの裏
].join(' ');

// コード進行は C - E7 - Am - F / C - G - F - G(半終止) の 8 小節。
// 2 小節目のセカンダリドミナント(E7)で色を付け、Am へ落として盛り上げる。
const POWER_BASS = [
  'o2 [c8. >c16< ]4', 'o2 [e8. >e16< ]4', 'o2 [a8. >a16< ]4', 'o2 [f8. >f16< ]4',
  'o2 [c8. >c16< ]4', 'o2 [g8. >g16< ]4', 'o2 [f8. >f16< ]4', 'o2 [g8. >g16< ]4',
].join(' ');

const BGM_POWER = [
  // メロディはこのエンジン独自の FM 音色。デチューンを重ねて厚くする
  't178 q7 v11 l8 @{fmLead} @e{flat} @s2 @d12 [' + POWER_MELODY + ']2',
  // 合いの手は鐘のような FM。長く響かせて隙間を埋める
  't178 q8 v11 l8 @{fmChime} @e{soft} @s4 [' + POWER_CALL + ']2',
  // ベースは三角波のまま(FM だと重くなりすぎる)
  't178 q8 v12 l8 @{triangle} @e{flat} [' + POWER_BASS + ']2',
  '@{noise} @e{percussive} t178 l16 [v13o2c v5o6c v5o6c v5o6c v11o4c v5o6c v5o6c v5o6c]32',
];

// ボス BGM。ダライアス風に、休みなく刻む 16 分のベースオスティナートの上へ、
// 半音でぶつかる重いメロディを乗せる。コードは Dm - Dm - E♭ - Dm(半音上下)。
const BOSS_BASS = [
  'o2 [d d d d]4', 'o2 [d d d d]4',
  'o2 [e- e- e- e-]4', 'o2 [d d d d]4',
  'o2 [d d d d]4', 'o2 [c c c c]4',
  'o2 [e- e- e- e-]4', 'o2 [d d d d]4',
].join(' ');

const BOSS_MELODY = [
  'o4 d4 f4 e-4 d4',
  'o4 a2 g+4 a4',
  'o4 b-4 a4 g4 f4',
  'o4 d2 r2',
  'o4 d4 f4 a4 >c4<',
  'o4 >d2< b-4 a4',
  'o4 g+4 a4 b-4 a4',
  'o4 d1',
].join(' ');

const BGM_BOSS = [
  // 主旋律: 12.5% パルス + 深いビブラートで不穏に
  't168 q8 v12 l4 @{pulse12} @e{soft} @v5 @s4 @d12 [' + BOSS_MELODY + ']2',
  // 刻みの裏メロ(3 度上をなぞる)
  't168 q7 v8 l16 @{pulse25} @e{flat} @s3 [' + BOSS_MELODY + ']2',
  // 16 分で走り続けるベース
  't168 q8 v13 l16 @{saw} @e{flat} [' + BOSS_BASS + ']2',
  // ドラムも詰めて圧をかける
  '@{noise} @e{percussive} t168 l16 [v13o2c v5o6c v9o4c v5o6c v12o2c v5o6c v9o4c v5o6c]32',
];


// ---- ラスボス専用曲「KING OF KINGS」----
// ボス曲(ニ短調)をそのまま素材にした、速くて畳みかけるアレンジ。
// A: ボス曲の主旋律をオクターブ上げて歌わせる
// B: 同じ動機を半音でずり下げていく、落ち着かない変奏
// 伴奏は 1 小節 1 音の長い和音で霧をかけ、ベースは半音符で歩かせる。
const LAST_MELODY_A = [
  'o5 d4 f4 e-4 d4',
  'o5 a2 g+4 a4',
  'o5 b-4 a4 g4 f4',
  'o5 d2 r4 o4 a4',
  'o5 d4 f4 a4 o6 c4',
  'o6 d2 o5 b-4 a4',
  'o5 g+4 a4 b-4 o6 c4',
  'o6 d1',
].join(' ');

// B: 半音で下りていく変奏(ボス曲の動機のまま、色だけ怪しくする)
const LAST_MELODY_B = [
  'o5 a4 g+4 g4 f+4',
  'o5 f2 e4 e-4',
  'o5 d4 e-4 f4 g4',
  'o5 a2 r2',
  'o5 b-4 a4 f4 d4',
  'o5 e-2 c+4 d4',
  'o5 f4 a4 o6 c4 d4',
  'o5 a1',
].join(' ');

const LAST_MELODY = LAST_MELODY_A + ' ' + LAST_MELODY_B;

// ハモリ。主旋律の 3 度下をゆるくなぞる(はっきり聞こえる音量で)
const LAST_HARMONY = [
  'o4 a4 d4 c4 a4', 'o4 f2 e4 f4', 'o4 g4 f4 e-4 d4', 'o4 a2 r4 f4',
  'o4 a4 d4 f4 a4', 'o5 a2 g4 f4', 'o4 e4 f4 g4 a4', 'o5 a1',
  'o4 f4 e4 e-4 d4', 'o4 d2 c4 b-4', 'o4 a4 c4 d4 e-4', 'o4 f2 r2',
  'o4 g4 f4 d4 a4', 'o4 c2 a4 f4', 'o4 d4 f4 a4 b-4', 'o4 f1',
].join(' ');

const LAST_BASS = [
  'o2 d2 a2', 'o2 d2 f2', 'o2 a+2 f2', 'o2 a2 e2',
  'o2 d2 a2', 'o2 a+2 f2', 'o2 a2 e2', 'o2 d2 d2',
  'o2 f2 c2', 'o2 e2 b2', 'o2 d+2 a+2', 'o2 a2 e2',
  'o2 a+2 f2', 'o2 g2 d2', 'o2 f2 c2', 'o2 a2 a2',
].join(' ');

const BGM_LASTBOSS = [
  // 主旋律: 25% パルス。ビブラートとエコーでゆらめかせる
  't176 q7 v13 l4 @{pulse25} @e{soft} @v4 @s5 [' + LAST_MELODY + ']2',
  // ハモリ: 三角波で控えめに寄り添う
  't176 q7 v8 l4 @{triangle} @e{soft} @s3 [' + LAST_HARMONY + ']2',
  // 半音符で歩くベース
  't176 q8 v13 l2 @{saw} @e{flat} [' + LAST_BASS + ']2',
  // ドラムは打点を減らして、間を怖くする
  '@{noise} @e{percussive} t176 l4 [v13o2c r v6o5c r]32',
];

/** 流れ星。尾の伸び方が違う 4 コマ(アニメーション BG スプライト用) */
function makeShootingStar(n) {
  const W = 32, H = 32, img = createImage(W, H);
  const HEAD = hex('#ffffff'), TAIL = hex('#cccccc');
  // 右下から左上へ流れる筋。n が進むほど尾が長く、頭は先へ進む
  const len = 6 + n * 6;
  for (let i = 0; i < len; i++) {
    const x = 24 - i, y = 4 + i;
    if (x < 0 || y >= H) break;
    const c = i < 3 ? HEAD : TAIL;
    setPixel(img, x, y, c);
    if (i < 6) setPixel(img, x + 1, y, c);
    if (i % 3 === 0 && i > 6) setPixel(img, x + 1, y, TAIL);
  }
  return img;
}
const shootStar0 = makeShootingStar(0);
const shootStar1 = makeShootingStar(1);
const shootStar2 = makeShootingStar(2);
const shootStar3 = makeShootingStar(3);

/** タイトルロゴのまわりを回る光(3 コマのアニメーション) */
const SPARK_ART = [
  [
    '........',
    '........',
    '...##...',
    '..####..',
    '..####..',
    '...##...',
    '........',
    '........',
  ],
  [
    '........',
    '...##...',
    '.######.',
    '.######.',
    '.######.',
    '.######.',
    '...##...',
    '........',
  ],
  [
    '...##...',
    '.#.##.#.',
    '..####..',
    '########',
    '########',
    '..####..',
    '.#.##.#.',
    '...##...',
  ],
];
const spark0 = fromAscii(SPARK_ART[0], { '#': '#ffffff' });
const spark1 = fromAscii(SPARK_ART[1], { '#': '#ffffff' });
const spark2 = fromAscii(SPARK_ART[2], { '#': '#ffffff' });

// ---- 4 面ボス「KING NAUTILUS」----
// 回る装甲ギアの輪の中に、オウムガイ型の生き物が守られている。
// 装甲は 1 か所だけ作りが違い(配線がむき出し)、そこだけ壊せる。

/** ギアの装甲ブロック(16x16・BG)。ふつうの装甲 */
function makeGearBlock() {
  const W = 16, H = 16, img = createImage(W, H);
  const PLATE = hex('#cccccc'), PLATE_D = hex('#7c7c7c');
  const GEM = hex('#65dbef');
  for (let y = 0; y < H; y++) {
    // 行ごとに 1 色。上を明るく、下を暗くして厚みを出す
    const c = y < 5 ? PLATE : y < 8 ? ((y & 1) ? PLATE_D : PLATE) : PLATE_D;
    for (let x = 1; x < W - 1; x++) setPixel(img, x, y, c);
  }
  // 四隅のボルト(抜いて穴に見せる)
  for (const [bx, by] of [[2, 2], [12, 2], [2, 12], [12, 12]]) {
    clearPixel(img, bx, by); clearPixel(img, bx + 1, by);
    clearPixel(img, bx, by + 1); clearPixel(img, bx + 1, by + 1);
  }
  // 中央の宝石(塗りつぶしの中なので 2 色目が使える)
  for (let y = 6; y < 10; y++) {
    for (let x = 6; x < 10; x++) setPixel(img, x, y, GEM);
  }
  return img;
}

/** 弱点の装甲(16x16・BG)。ボルトが抜けて配線と火花が見えている */
function makeGearWeak(lit) {
  const W = 16, H = 16, img = createImage(W, H);
  // ここだけ作りが違うと分かるよう、黄色っぽい装甲にする
  const PLATE = hex('#ded087'), PLATE_D = hex('#ccc35e');
  const WIRE = hex('#b95e51'), SPARK = hex('#ffffff');
  for (let y = 0; y < H; y++) {
    const c = y < 4 ? PLATE : ((y & 1) ? PLATE_D : PLATE);
    for (let x = 1; x < W - 1; x++) setPixel(img, x, y, c);
  }
  // まんなかを大きく抜いて、内部の配線を見せる
  for (let y = 4; y < 12; y++) {
    for (let x = 3; x < 13; x++) clearPixel(img, x, y);
  }
  for (let y = 5; y < 11; y += 2) {
    for (let x = 4; x < 12; x++) setPixel(img, x, y, WIRE);
  }
  // 火花(コマによって出たり消えたり)
  if (lit) {
    for (const [sx, sy] of [[5, 4], [9, 7], [7, 11], [11, 5]]) {
      setPixel(img, sx, sy, SPARK);
      setPixel(img, sx + 1, sy, SPARK);
    }
  }
  return img;
}

/** オウムガイ本体(48x48・BG)。渦巻きの殻と、下に垂れる触手 */
function makeNautilus(hurt) {
  const W = 48, H = 48, img = createImage(W, H);
  const SHELL = hex(hurt ? '#b766b5' : '#ded087');
  const BAND = hex(hurt ? '#8076f1' : '#b95e51');
  const SKIN = hex(hurt ? '#b766b5' : '#ff897d');
  const cx = 22, cy = 20;
  // 殻(渦巻き)。行ごとに 1 色 + しま模様を 2 色目で入れる
  for (let y = 0; y < 34; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 18) continue;
      const a = Math.atan2(dy, dx);
      // うずまきのしま(角度と半径で縞を作る)
      const band = ((a / Math.PI * 5 + d * 0.55) % 2 + 2) % 2 < 1;
      setPixel(img, x, y, band ? SHELL : BAND);
    }
  }
  // 殻の口(左下が開いていて、そこから体が出る)
  for (let y = 0; y < 34; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx > -4 && dy > 6 && Math.sqrt(dx * dx + dy * dy) > 9) clearPixel(img, x, y);
    }
  }
  // 頭(殻の下から出ている)
  for (let y = 26; y < 34; y++) {
    for (let x = 14; x < 32; x++) setPixel(img, x, y, SKIN);
  }
  // 触手(下へ 6 本、ゆるく広がる)
  for (let n = 0; n < 6; n++) {
    const x0 = 15 + n * 3;
    for (let i = 0; i < 12; i++) {
      const x = Math.round(x0 + (n - 2.5) * i * 0.22);
      setPixel(img, x, 33 + i, SKIN);
      if (i < 7) setPixel(img, x + 1, 33 + i, SKIN);
    }
  }
  // 目のくぼみ(ほかのボスと同じ目のスプライトを重ねる穴)
  for (let y = -6; y <= 6; y++) {
    for (let x = -6; x <= 6; x++) {
      if (x * x + y * y > 36 + 6) continue;
      clearPixel(img, 18 + x, 29 + y);
    }
  }
  return img;
}

/** 輪の内側を走る電撃(単色スプライト)。ぎざぎざの稲妻を 2 コマぶん */
function makeSpark(n) {
  const W = 16, H = 16, img = createImage(W, H);
  const C = hex('#65dbef');
  // 中心から四方へ、折れながら伸びる稲妻
  for (let dir = 0; dir < 4; dir++) {
    const a = (Math.PI / 2) * dir + (n ? 0.5 : 0);
    let x = 8, y = 8;
    for (let i = 0; i < 7; i++) {
      const j = ((i + n) % 2 ? 1 : -1) * (i % 3 === 2 ? 2 : 1);
      x += Math.cos(a) * 1.1 - Math.sin(a) * j * 0.5;
      y += Math.sin(a) * 1.1 + Math.cos(a) * j * 0.5;
      setPixel(img, Math.round(x), Math.round(y), C);
      setPixel(img, Math.round(x) + 1, Math.round(y), C);
    }
  }
  // 中心の粒
  for (let y = 7; y < 10; y++) for (let x = 7; x < 10; x++) setPixel(img, x, y, C);
  return img;
}
const gearGem = makeSpark(0);
const gearSpark1 = makeSpark(1);

const gearBlock = makeGearBlock();
const gearWeak0 = makeGearWeak(false);
const gearWeak1 = makeGearWeak(true);
const nautilus = makeNautilus(false);
const nautilusHurt = makeNautilus(true);


// ---- 中ボス「モアイ」: 正面向きの巨大石像(64x80) ----
// 十字に 4 分割された姿で現れ、上下 -> 左右 の順にくっついて 1 体になる。
// 苔むした石なので緑 3 色(明・中・暗)。行ごとに 1 色を基本にしつつ、
// 塗りつぶされた内側だけ 2 色目(欠けやひび)を置いて石らしさを出す。
function makeMoaiFront(blue = false) {
  // 大きすぎたので、台座の下をさらに 8 ドット削って 64x64 にした
  const W = 64, H = 64, img = createImage(W, H);
  // 同じドット構成のまま、緑と青の 2 種類を作る。
  // ゲーム中は上の行から 1 段ずつ青へ置き換えていって、特別な感じを出す
  const LIT = hex(blue ? '#65dbef' : '#74d07d');
  const STONE = hex(blue ? '#8076f1' : '#3eb849');
  const DARK = hex(blue ? '#5955e0' : '#3aa241');
  // 輪郭: 上は細く、あごに向かって広がり、下は台座
  const span = (y) => {
    if (y < 6) return [18, 45];
    if (y < 54) {   // あごを 4 ドット伸ばした
      const t = (y - 6) / 48;
      return [Math.round(18 - t * 8), Math.round(45 + t * 8)];
    }
    if (y < 59) return [8, 55];
    return [4, 59];   // 台座
  };
  // 上を明るく、下を暗くして、境目は 1 行おきの混色でなじませる
  const rowColor = (y) => y < 13 ? LIT
    : y < 18 ? ((y & 1) ? STONE : LIT)
    : y < 50 ? STONE
    : y < 56 ? ((y & 1) ? DARK : STONE) : DARK;

  for (let y = 0; y < H; y++) {
    const [x0, x1] = span(y);
    for (let x = x0; x <= x1; x++) setPixel(img, x, y, rowColor(y));
  }
  // 耳(左右に張り出す)
  for (let y = 22; y < 44; y++) {
    for (let x = 4; x < 10; x++) setPixel(img, x, y, rowColor(y));
    for (let x = 54; x < 60; x++) setPixel(img, x, y, rowColor(y));
  }
  // ひさしのように張り出した眉
  for (let y = 16; y < 22; y++) {
    for (let x = 12; x < 52; x++) setPixel(img, x, y, LIT);
  }
  // 落ちくぼんだ目(黒い穴)。
  // 傾けて彫ってみたが、まっ四角のほうがモアイらしいので戻した。
  // 下を 3 ドット削って、細めの目にしてある
  for (let y = 24; y < 30; y++) {
    for (let x = 16; x < 28; x++) clearPixel(img, x, y);
    for (let x = 36; x < 48; x++) clearPixel(img, x, y);
  }
  // 鼻(中央にまっすぐ通る)
  for (let y = 20; y < 47; y++) {
    const w = 3 + Math.floor((y - 20) / 11);
    for (let x = 32 - w; x <= 31 + w; x++) setPixel(img, x, y, LIT);
  }
  for (let y = 43; y < 46; y++) {
    clearPixel(img, 28, y); clearPixel(img, 29, y);
    clearPixel(img, 34, y); clearPixel(img, 35, y);
  }
  // への字の口
  for (let y = 50; y < 55; y++) {
    for (let x = 20; x < 44; x++) clearPixel(img, x, y);
  }
  // 4 分割されていた名残として、十字に 1 ドットの筋を彫っておく
  for (let y = 0; y < H; y++) clearPixel(img, 31, y);
  for (let x = 0; x < W; x++) clearPixel(img, x, 35);

  // --- 石らしさ: 欠けとひび ---
  // 内側(まわりが塗りつぶされている場所)にだけ置くので、
  // 8 ドットあたりの色は「その行の色 + 暗い緑」の 2 色に収まる。
  let seed = 20260729;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const inside = (x, y) => {
    const [x0, x1] = span(y);
    return x > x0 + 2 && x < x1 - 2 && y > 2 && y < H - 3;
  };
  // ざらついた欠け
  for (let i = 0; i < 90; i++) {
    const x = 4 + Math.floor(rnd() * (W - 8));
    const y = 3 + Math.floor(rnd() * (H - 6));
    if (!inside(x, y)) continue;
    const c = rowColor(y) === DARK ? STONE : DARK;
    setPixel(img, x, y, c);
    if (rnd() < 0.4) setPixel(img, x + 1, y, c);
  }
  // 斜めに走るひび
  for (const [sx, sy, len, dx] of [[20, 10, 10, 1], [44, 34, 12, -1], [14, 47, 9, 1]]) {
    for (let i = 0; i < len; i++) {
      const x = sx + i * dx, y = sy + i;
      if (!inside(x, y)) continue;
      setPixel(img, x, y, rowColor(y) === DARK ? STONE : DARK);
    }
  }
  return img;
}
const moaiFront = makeMoaiFront();
const moaiFrontBlue = makeMoaiFront(true);
// モアイは BG スプライトとしてレイヤーに描くので、**横 8 ドット 2 色**を守る必要がある。
// 切り出し(4 分割・上下 2 枚)や色変わりの途中絵はここから作るので、
// **切り出す前に**均しておく。こうすれば派生した絵もすべて制約に収まる
// (行ごと丸ごと入れ替える色変わりも、行が制約を守っていれば守られる)
reduceBgImage(moaiFront);
reduceBgImage(moaiFrontBlue);

/** 画像の一部を切り出す(モアイの分割に使う) */
function cropImage(src, sx, sy, w, h) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((sy + y) * src.width + (sx + x)) * 4;
      if (src.data[si + 3] < 128) continue;
      const di = (y * w + x) * 4;
      img.data[di] = src.data[si]; img.data[di + 1] = src.data[si + 1];
      img.data[di + 2] = src.data[si + 2]; img.data[di + 3] = 255;
    }
  }
  return img;
}
// 4 分割 -> 上下がくっついて左半分・右半分 -> 最後に 1 体
const moaiTL = cropImage(moaiFront, 0, 0, 32, 32);
const moaiTR = cropImage(moaiFront, 32, 0, 32, 32);
const moaiBL = cropImage(moaiFront, 0, 32, 32, 32);
const moaiBR = cropImage(moaiFront, 32, 32, 32, 32);
/**
 * 色が変わっていく途中の 1 枚絵。
 * 全体を 8 ブロック(各 10 行)に分け、どのブロックも上から k 行ぶんだけ
 * 「後の色」に置き換わっている。重ね絵ではなく完成した 1 枚なので、
 * BG スプライトの「セルを黒で埋める」決まりに引っかからない。
 */
function makeMoaiWave(baseImg, overImg, k) {
  const W = 64, H = 72, img = createImage(W, H);
  for (let y = 0; y < H; y++) {
    const inBlock = (y % 9) < k;       // このブロックのうち、もう変わった行か
    const src = inBlock ? overImg : baseImg;
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      if (src.data[si + 3] < 128) continue;
      img.data[si] = src.data[si]; img.data[si + 1] = src.data[si + 1];
      img.data[si + 2] = src.data[si + 2]; img.data[si + 3] = 255;
    }
  }
  return img;
}
// 緑 -> 青 の途中(2 行ずつ)と、青 -> 緑 の途中
const moaiBlueSteps = [];
const moaiGreenSteps = [];
for (let n = 1; n <= 4; n++) {
  moaiBlueSteps.push(makeMoaiWave(moaiFront, moaiFrontBlue, n * 2));
  moaiGreenSteps.push(makeMoaiWave(moaiFrontBlue, moaiFront, n * 2));
}
const moaiTop = cropImage(moaiFront, 0, 0, 64, 32);
const moaiBottom = cropImage(moaiFront, 0, 32, 64, 32);
// 青版(出現中の色変化に使う)
// 合体前(4 分割・上下 2 枚)でも「線で色が変わる」ように、
// 色が変わっていく途中の 1 枚絵から、同じ切り出しを作っておく。
// 縞は 9 行ごとの繰り返しで、切り出す位置(0 と 36)はどちらも 9 の倍数なので
// つなぎ目でも模様がずれない。
const moaiWaveCrops = {};
[['B', moaiBlueSteps], ['G', moaiGreenSteps]].forEach(([d, arr]) => {
  arr.forEach((img, i) => {
    const n = i + 1;
    moaiWaveCrops[`moaiW${d}${n}TL`] = cropImage(img, 0, 0, 32, 32);
    moaiWaveCrops[`moaiW${d}${n}TR`] = cropImage(img, 32, 0, 32, 32);
    moaiWaveCrops[`moaiW${d}${n}BL`] = cropImage(img, 0, 32, 32, 32);
    moaiWaveCrops[`moaiW${d}${n}BR`] = cropImage(img, 32, 32, 32, 32);
    moaiWaveCrops[`moaiW${d}${n}TOP`] = cropImage(img, 0, 0, 64, 32);
    moaiWaveCrops[`moaiW${d}${n}BOT`] = cropImage(img, 0, 32, 64, 32);
  });
});

const moaiTLb = cropImage(moaiFrontBlue, 0, 0, 32, 32);
const moaiTRb = cropImage(moaiFrontBlue, 32, 0, 32, 32);
const moaiBLb = cropImage(moaiFrontBlue, 0, 32, 32, 32);
const moaiBRb = cropImage(moaiFrontBlue, 32, 32, 32, 32);
const moaiTopB = cropImage(moaiFrontBlue, 0, 0, 64, 32);
const moaiBottomB = cropImage(moaiFrontBlue, 0, 32, 64, 32);



// ---- 中ボス「モアイ」戦の曲 ----
// ニ短調。減七(dim7)を挟んで、石像が組み上がるまでの不安をコードで作る。
//   | Dm | Bdim7 | Gm | A7 | Dm | E-dim7 | Dm | A7 |
// 主旋律は和音の中の音を歩くだけにして、耳に痛い半音のぶつかりを避ける。
const MOAI_MELODY = [
  'o5 d4 a4 f4 d4',            // Dm
  'o4 b4 o5 d4 f4 o4 a-4',     // Bdim7
  'o5 g4 d4 o4 a+4 o5 g4',     // Gm
  'o5 a4 g4 f4 e4',            // A7
  'o5 d4 a4 f4 d4',            // Dm
  'o5 e-4 g-4 a4 o6 c4',       // E-dim7
  'o5 d4 f4 a4 f4',            // Dm
  'o5 e4 c+4 e4 a4',           // A7 -> Dm へ戻る
].join(' ');

// 分散和音。和音の音だけを 16 分で回して、走りながら不安をあおる
const MOAI_ARPEGGIO = [
  '[o4 d f a o5 d]4', '[o4 b o5 d f a-]4', '[o4 g a+ o5 d g]4', '[o4 a o5 c+ e g]4',
  '[o4 d f a o5 d]4', '[o4 e- g- a o5 c]4', '[o4 f a o5 d f]4', '[o4 e a o5 c+ e]4',
].join(' ');

const MOAI_BASS = [
  'o2 d4 d4 a4 d4', 'o2 b4 b4 f4 b4', 'o2 g4 g4 d4 g4', 'o2 a4 a4 e4 a4',
  'o2 d4 d4 a4 d4', 'o2 e-4 e-4 a4 e-4', 'o2 d4 d4 a4 f4', 'o2 a4 a4 e4 a4',
].join(' ');

// キーを半音下げて、もう一段重くする。ドラムのノイズは音階ではないので触らない
const DOWN1 = (m) => transposeMML(m, -1);

const BGM_MOAI = [
  // 主旋律
  't160 q7 v13 l4 @{pulse25} @e{soft} @s3 ' + DOWN1(MOAI_MELODY),
  // 分散和音(裏で回り続ける)
  't160 q6 v9 l16 @{pulse12} @e{flat} @s2 ' + DOWN1(MOAI_ARPEGGIO),
  // ベース
  't160 q8 v13 l4 @{saw} @e{flat} ' + DOWN1(MOAI_BASS),
  // ドラム
  '@{noise} @e{percussive} t160 l8 [v13o2c r v6o5c r]16',
];


// ---- 仮ボス「未実装君」専用の曲 ----
// 力が抜ける音痴なオルガン。わざと半音ずれた音とデチューンで調子はずれにする。
// テンポも遅く、ベースはとぼけた 3 度跳ね。
const BGM_TODO = [
  // 主旋律。ところどころ半音ずれていて、伸ばした音が下がっていく
  // 音色は FM。とぼけたオルガンにして、デチューンで音痴さを残す
  't96 q7 v12 l4 @{fmOrgan} @e{soft} @d24 @v3 ' +
  'o4 c8 e8 g4 f+4 e4  o4 d8 f8 a4 g+2 ' +
  'o4 e8 g8 b-4 a4 g4  o4 c2 o3 b4 o4 c4 ' +
  'o4 c8 e8 g4 f+4 e4  o4 d8 f8 a-4 g2 ' +
  'o4 f8 a8 o5 c-4 o4 b-4 a4  o4 c1',
  // ふらふらした対旋律(わざと 3 度でぶつける)
  // 対旋律はホルン。丸い音でぶつけると、気が抜けた和音になる
  't96 q6 v8 l4 @{fmHorn} @e{soft} @d18 ' +
  'o3 e8 g8 b4 a+4 g4  o3 f8 a8 o4 c4 o3 b2 ' +
  'o3 g8 b8 o4 d-4 o3 c+4 b4  o3 e2 d4 e4 ' +
  'o3 e8 g8 b4 a+4 g4  o3 f8 a8 o4 c-4 o3 b2 ' +
  'o3 a8 o4 c8 e-4 d4 c4  o3 e1',
  // とぼけたベース
  // ベースは指ではじいた低音
  't96 q8 v11 l8 @{fmAcousticBass} @e{flat} ' +
  '[o2 c r e r g r e r]1 [o2 d r f r a r f r]1 ' +
  '[o2 e r g r b- r g r]1 [o2 c r e- r g r e- r]1 ' +
  '[o2 c r e r g r e r]1 [o2 d r f r a- r f r]1 ' +
  '[o2 f r a r >c< r a r]1 [o2 c r c r c r c r]1',
  // ドラムは間の抜けた 2 拍
  '@{noise} @e{percussive} t96 l4 [v10o2c r v5o5c r]8',
];


// ゲーム開始時のジングル。2オクターブ駆け上がるファンファーレで、
// 後半のロングトーンに合わせて自機が画面下から入ってくる。
// 開始ジングル(3 小節)。一気に駆け上がってから決めの和音でロングトーン。
// 本編がイ短調なので、ここも Am -> E7 -> Am でつなぐ。
// 開始ジングル(3 小節)。歯切れのよい刻み -> 駆け上がり -> 決めのロングトーン。
const BGM_START = [
  // メロディ
  't152 q8 v13 @{pulse25} @e{flat} @d10 @s2' +
  ' l16 o5 a8 r a >c8< a8  e8 r e g8 e8' +          // 休符を食う刻み
  ' l16 o4 a b >c d e f g a b >c d e f g a b' +     // 一気に駆け上がる
  ' l8 o6 c2 r o5 b o6 c4',                         // 決め
  // ハモリ(3 度下)
  't152 q8 v9 @{pulse50} @e{flat} @s3' +
  ' l16 o5 e8 r e a8 e8  c8 r c e8 c8' +
  ' l16 o4 f g a b >c d e f g a b >c d e f g' +
  ' l8 o5 a2 r g a4',
  // ベース
  't152 q8 v12 @{triangle} @e{flat}' +
  ' l8 o2 a a >a< a  e e >e< e' +
  ' l8 o2 a a >a< a  e e >e< e' +
  ' l8 o2 a4 r4 o1 a2',
  // ドラム
  '@{noise} @e{percussive} t152 l8' +
  ' v13o2c v6o6c v11o4c v6o6c v13o2c v6o6c v11o4c v6o6c' +
  ' v13o2c v6o6c v11o4c v6o6c v13o2c v6o6c v11o4c v6o6c' +
  ' v13o2c v6o6c v11o4c v6o6c v14o1c2',
];

// 1UP のファンファーレ。BGM をいったん黙らせてこれを鳴らす。
// 短いが、3 声できっちり終止させて「やった感」を出す。
const BGM_FANFARE = [
  't160 q8 v14 @{pulse25} @e{flat} @d8 @s2 l16' +
  ' o5 c e g >c  e8 >c8<  <b >c d e  g2',
  't160 q8 v10 @{pulse50} @e{flat} l16' +
  ' o4 e g >c e  g8 e8  d e f g  e2',
  't160 q8 v12 @{triangle} @e{flat} l8' +
  ' o2 c c g g  c g  o2 c2',
];

// 目玉 2 体を同時に倒したときの特別ファンファーレ(1UP とは別の曲)。
// 高いところで華やかに駆け上がって決める。
// 最後は V -> I で終止させて落ち着かせる
const BGM_BONUS = [
  't168 q8 v14 @{pulse25} @e{flat} @d10 @s3 l16' +
  ' o5 g >c e g  >c< g e c  o5 g b >d g  >c2<',
  't168 q8 v11 @{pulse50} @e{flat} @s2 l16' +
  ' o4 e g >c e  g e c <g  o4 e g b >d  g2',
  't168 q8 v12 @{triangle} @e{flat} l8' +
  ' o2 c g >c< g  o2 g g >c2<',
];

// スタッフロール(エンディング)用。静かにメロディだけが流れ、
// ドラムはかすかに鳴る程度にする。
const STAFF_MELODY = [
  'o5 e2 g4 a4', 'o5 b2. a4', 'o5 g2 e4 d4', 'o5 e1',
  'o5 a2 >c4< b4', 'o5 a2. g4', 'o5 e2 d4 c4', 'o5 d1',
  'o5 g2 b4 >d4<', 'o5 c2. b4', 'o5 a2 g4 e4', 'o5 a1',
  'o5 e2 f4 g4', 'o5 a2. b4', 'o5 >c2< b4 g4', 'o5 a1',
].join(' ');
const STAFF_BASS = [
  'o2 a1', 'o2 e1', 'o2 f1', 'o2 c1',
  'o2 d1', 'o2 a1', 'o2 e1', 'o2 a1',
  'o2 g1', 'o2 c1', 'o2 f1', 'o2 a1',
  'o2 d1', 'o2 e1', 'o2 a1', 'o2 a1',
].join(' ');
const BGM_STAFF = [
  // 主旋律だけをゆっくり、やわらかい三角波で
  't104 q8 v12 l4 @{triangle} @e{soft} @s5 ' + STAFF_MELODY,
  // 支えの低音(かすかに)
  't104 q8 v7 l4 @{sine} @e{soft} ' + STAFF_BASS,
  // ドラムはごく小さく、拍の頭だけ
  '@{noise} @e{percussive} t104 l4 [v5o2c r v3o4c r]16',
];

// ---- クラシックのアレンジ ----
// 名旋律をコナミ進行(bVI→bVII→I)で組み直したもの。
// elise = ハイスコア画面 / fate = 面クリア で使う。

// コードは F - G - Am - Am / F - G - E7 - Am の 8 小節
const KONAMI_ARP = [
  'o4 [fa>ce<]4', 'o3 [gb>df<]4', 'o4 [a>ceg<]4', 'o4 [a>ceg<]4',
  'o4 [fa>ce<]4', 'o3 [gb>df<]4', 'o4 [eg+b>d<]4', 'o4 [a>ceg<]4',
].join(' ');
const KONAMI_BASS = [
  'o2 [f8. >f16< ]4', 'o2 [g8. >g16< ]4', 'o2 [a8. >a16< ]4', 'o2 [a8. >a16< ]4',
  'o2 [f8. >f16< ]4', 'o2 [g8. >g16< ]4', 'o2 [e8. >e16< ]4', 'o2 [a8. >a16< ]4',
].join(' ');
const KONAMI_DRUM = '[v12o2c v6o6c v10o4c v6o6c v12o2c v6o6c v10o4c v6o6c]8';

// ハイスコア画面の曲: ベートーヴェン「エリーゼのために」
const ELISE_MELODY = [
  'o5 e8 e-8 e8 e-8 e8 b8 >d8 c8<',   // F
  'o4 a8 r8 c8 e8 a8 b4 r8',          // G
  'o5 e8 e-8 e8 e-8 e8 b8 >d8 c8<',   // Am
  'o4 a4 r8 e8 a8 b8 >c8 e8<',        // Am
  'o5 e8 e-8 e8 e-8 e8 b8 >d8 c8<',   // F
  'o4 a8 r8 c8 e8 a8 b4 r8',          // G
  'o5 e8 >c8< b8 a8 g+4 b4',          // E7
  'o5 a2 r2',                         // Am
].join(' ');

const BGM_ELISE = [
  't132 q7 v12 l8 @{pulse25} @e{soft} @s3 ' + ELISE_MELODY,
  't132 q7 v8 l16 @{pulse25} @e{flat} @s2 ' + KONAMI_ARP,
  't132 q8 v12 l8 @{triangle} @e{flat} ' + KONAMI_BASS,
  '@{noise} @e{percussive} t132 l8 ' + KONAMI_DRUM,
];

// 面クリアの曲: ベートーヴェン「運命」をメジャーに直してコナミ進行へ。
// 元の短調の動機(タタタターン)を長調に置き換え、
// コード進行は A♭ - B♭ - C (bVI - bVII - I) のコナミ進行で回す。
// 1 小節 = 16 分音符 16 個。4 音の型を 4 回まわす
const FATE_ARP = [
  'o4 [a- >c e- <a-]4', 'o4 [b- >d f <b-]4', 'o4 [c e g e]4', 'o4 [c e g e]4',
  'o4 [a- >c e- <a-]4', 'o4 [b- >d f <b-]4', 'o4 [c e g e]4', 'o4 [c e g e]4',
].join(' ');
const FATE_BASS = [
  'o2 [a-8. >a-16< ]4', 'o2 [b-8. >b-16< ]4', 'o2 [c8. >c16< ]4', 'o2 [c8. >c16< ]4',
  'o2 [a-8. >a-16< ]4', 'o2 [b-8. >b-16< ]4', 'o2 [c8. >c16< ]4', 'o2 [c8. >c16< ]4',
].join(' ');
const FATE_MELODY = [
  'r8 o5 c8 c8 c8 a-2',        // A♭: タタタターン(長調に置き換え)
  'r8 o5 b-8 b-8 b-8 f2',      // B♭: 一段下げて繰り返す
  'r8 o5 g8 g8 g8 e2',         // C : 原曲と同じ形をハ長調で
  'r8 o5 e8 e8 e8 c2',         // C : さらに下げて落ち着ける
  'o5 a-8 >c8< e-8 a-8 >c4< a-4',   // A♭: 展開(分散和音で駆け上がる)
  'o5 b-8 >d8 f8 d8< b-4 f4',       // B♭
  'o5 g8 e8 c8 e8 g4 >c4<',         // C
  'o5 c1',                          // C : 決め
].join(' ');
const BGM_FATE = [
  't144 q7 v12 l8 @{pulse25} @e{soft} @s3 ' + FATE_MELODY,
  't144 q7 v8 l16 @{pulse25} @e{flat} @s2 ' + FATE_ARP,
  't144 q8 v12 l8 @{triangle} @e{flat} ' + FATE_BASS,
  '@{noise} @e{percussive} t144 l8 ' + KONAMI_DRUM,
];

// ショパン「幻想即興曲」嬰ハ短調 Op.66 のアレンジ。
// 長調(ハ長調)に直し、流れるような 16 分の走句はそのまま、
// 低音は力強いオクターブ刻みにしてある。
// コードは C - Am - F - G / C - Am - Dm - G の 8 小節。

// 右手の走句(主旋律)。原曲の形をそのまま長調に直したもの。
// 音階をなぞるのではなく、和音の音と隣の音をジグザグに行き来しながら
// 駆け上がって駆け下りる、あの流れる形。
// 1 小節 = 16 分音符 16 個(上り 8 + 下り 8)。音色は上下で変えない。
const IMPROMPTU_RUN_BARS = [
  'o4 c e d f e g f a  g e f d e c d <b',   // C
  'o4 a >c< b d >c e d f  e c d <b >c< a b g',   // Am
  'o4 f a g b a >c< b d  >c< a b g a f g e',   // F
  'o4 g b a >c< b d >c e  d <b >c< a b g a f',  // G
  'o4 c e d f e g f a  g e f d e c d <b',   // C
  'o4 a >c< b d >c e d f  e c d <b >c< a b g',   // Am
  'o4 d f e g f a g >c<  a f g e f d e c',  // Dm
  'o4 g b a >c< b d >c e  d <b >c< a b g a f',  // G
];
const IMPROMPTU_RUN = IMPROMPTU_RUN_BARS.join(' ');

// B メロ。同じ走句のまま Am へ寄せ、E(属和音)の借用で色を変える
const IMPROMPTU_RUN_B_BARS = [
  'o4 a >c< b d >c e d f  e c d <b >c< a b g',   // Am
  'o4 e g+ f+ a g+ b a >c+<  b g+ a f+ g+ e f+ d+',  // E
  'o4 a >c< b d >c e d f  e c d <b >c< a b g',   // Am
  'o4 f a g b a >c< b d  >c< a b g a f g e',     // F
  'o4 d f e g f a g >c<  a f g e f d e c',       // Dm
  'o4 e g+ f+ a g+ b a >c+<  b g+ a f+ g+ e f+ d+',  // E
  'o4 a >c< b d >c e d f  e c d <b >c< a b g',   // Am
  'o4 g b a >c< b d >c e  d <b >c< a b g a f',   // G
];
const IMPROMPTU_RUN_B = IMPROMPTU_RUN_B_BARS.join(' ');

const IMPROMPTU_BASS_B = [
  'o2 [a a >a< a]2', 'o2 [e e >e< e]2', 'o2 [a a >a< a]2', 'o2 [f f >f< f]2',
  'o2 [d d >d< d]2', 'o2 [e e >e< e]2', 'o2 [a a >a< a]2', 'o2 [g g >g< g]2',
].join(' ');

// ハモリは主旋律から作る。反行(主旋律が上がるときは下がる)させたうえで、
// その小節の和音の構成音へ寄せるので、動きが逆でもきれいに重なる。
// 軸 35 = だいたい主旋律の 6 度上あたりを通る高さ
const IMPROMPTU_CHORDS = ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G'];
const IMPROMPTU_CHORDS_B = ['Am', 'E', 'Am', 'F', 'Dm', 'E', 'Am', 'G'];
const IMPROMPTU_HARMONY = makeCounterHarmony(IMPROMPTU_RUN_BARS, IMPROMPTU_CHORDS, 35);
const IMPROMPTU_HARMONY_B = makeCounterHarmony(IMPROMPTU_RUN_B_BARS, IMPROMPTU_CHORDS_B, 35);

// 力強い低音。オクターブを行き来しながら 8 分で刻み続ける
const IMPROMPTU_BASS = [
  'o2 [c c >c< c]2', 'o2 [a a >a< a]2', 'o2 [f f >f< f]2', 'o2 [g g >g< g]2',
  'o2 [c c >c< c]2', 'o2 [a a >a< a]2', 'o2 [d d >d< d]2', 'o2 [g g >g< g]2',
].join(' ');

// キーを 1 音(全音 = 半音 2 つ)上げる。ハ長調 -> ニ長調。
// ドラムのノイズは音階ではないので触らない
const UP = (m) => transposeMML(m, 2);

const BGM_IMPROMPTU = [
  // 走句が主旋律。いちばん大きく前に出す
  't168 q6 v15 l16 @{pulse25} @e{flat} @s4 @d8 ' + UP(IMPROMPTU_RUN + ' ' + IMPROMPTU_RUN_B),
  // ハモリ(主旋律の上)。同じ形をはっきり聞こえる音量でなぞる
  't168 q6 v11 l16 @{pulse25} @e{flat} @s2 ' + UP(IMPROMPTU_HARMONY + ' ' + IMPROMPTU_HARMONY_B),
  // 低音は力強さを保ちつつ、主旋律を邪魔しない音量に
  't168 q8 v10 l8 @{saw} @e{flat} ' + UP(IMPROMPTU_BASS + ' ' + IMPROMPTU_BASS_B),
  // ドラムもごく控えめ
  '@{noise} @e{percussive} t168 l8 [v7o2c r v4o4c r v7o2c r v4o4c r]16',
];

// 面クリアのジングル。FANFARE や BONUS にくらべて細かったので、
// 同じ音色(主旋律 @{pulse25} / 対旋律 @{pulse50} / 低音 @{triangle})にそろえ、長さも 2 倍に。
// 付点のリズムと行進する低音でマーチらしく決める
const BGM_CLEAR = [
  't132 q8 v14 @{pulse25} @e{flat} @d8 @s2 l8' +
  ' o5 c. c16 e g  >c< g e c' +
  ' o5 d. d16 f a  >d< a f d' +
  ' o5 e. e16 g >c<  d. d16 b >d<' +
  ' o5 c. e16 g. >c16  e4 >c4<',
  't132 q8 v10 @{pulse50} @e{flat} l8' +
  ' o4 e. e16 g >c  e< g e c' +
  ' o4 f. f16 a >d  f< a f d' +
  ' o4 g. g16 >c e<  b. b16 g b' +
  ' o4 e. g16 >c. e16  g4 >e4<',
  't132 q8 v12 @{triangle} @e{flat} l8' +
  ' o2 c g c g  c g c g' +
  ' o2 d a d a  d a d a' +
  ' o2 e b e b  g >d< g >d<' +
  ' o2 c g c g  c4 c4',
];

// ゲームオーバーは「月光」(ベートーヴェン ピアノソナタ第14番 第1楽章)の冒頭。
// 右手の三連符アルペジオ + 左手のオクターブ、という原曲の形をそのまま使う。
const BGM_GAMEOVER = [
  // 右手: c#m -> c#m -> A -> D/F#(原曲どおりの流れ) の三連アルペジオ
  // 波形メモリの鐘の音。減衰させると、こもったチェレスタのように響く
  't58 q8 v10 @{wtBell} @e{piano} @s7 l12' +
  ' o4 [g+>c+e<]4 [g+>c+e<]4' +
  ' o4 [a>c+e<]4  [a>d f+<]4' +
  ' o4 [g+>c+e<]2 [g+>c+d+<]2 [g+ b>d+<]2 [g+ b>e<]2',
  // 左手: オクターブの低音(右手 8 小節ぶんに合わせる)。
  // 埋もれず出すぎずの音量にし、倍音のある三角波で輪郭だけ出す
  // 低音はオルガンの波形で、下から支える
  't58 q8 v10 @{wtOrgan} @e{soft} @s4 l1 o2 c+ c+ o1 a o2 d o1 g+ g+',
];

// SE の音量は「聞こえ方」でそろえてある。
// ノイズや低音は同じ v でも大きく聞こえるので低めに、
// 短く高い音は埋もれやすいので高めにしてある。
//   目安: 常時鳴る音(shot/hit) < 状況の合図(clink/thud/armor)
//         < 目立たせたい音(item/weak/warning/爆発)
// タコのレーザー発射音。矩形波を 4 本重ねた和音(1 度 + 5 度 + オクターブ)で
// ぶ厚く鳴らす。1 発ぶんを撃っているあいだ鳴らしっぱなしにするので、
// ほかの長い SE と違って 0.4 秒に切り分けていない。
// 低い音だと BGM に埋もれて聞こえなかったので、
// 高いところで細い矩形波(デューティ 12.5%)を鳴らして通るようにした
// **q8 を付けて音を目いっぱい伸ばす**。既定の q7 だと音符の終わりに
// 1/8 ぶんの無音が入り、くり返して鳴らしたときに切れ目が出てしまう。
// 長さは t92 で 1 回 2.6 秒(t150 のころは 1.6 秒)。
// くり返しの切れ目は完全には消せないので、**1 回を長くして目立たなくする**
const LASER_SE = [
  '@{pulse12} @e{flat} q8 t92 v15 o5 l2 c&c',           // よく通る細い矩形波
  '@{pulse12} @e{flat} @d14 q8 t92 v15 o5 l2 g&g',      // 5 度を重ねて厚く
  '@{pulse50} @e{flat} q8 t92 v14 o4 l2 c&c',           // 1 オクターブ下で芯を作る
  '@{pulse25} @e{flat} @v5 q8 t92 v13 o6 l2 c&c',       // さらに上でうねらせる
];

const SE = {
  // 常に鳴る音。うるさくならないよう控えめ
  // ショット。常時鳴るが埋もれないよう、2 声を重ねてしっかり聞かせる
  shot: ['@{pulse25} @e{percussive} t255 v14 o7 l64 b g e c < a f',
         '@{pulse12} @e{percussive} @d10 t255 v11 o6 l64 b g e c < a f'],
  // 命中音。ノイズだけだと弾の音に埋もれるので、高い矩形波を重ねて通るようにする
  hit: ['@{noise} @e{percussive} t255 v13 o5 l32 c c',
        '@{pulse12} @e{percussive} t255 v12 o6 l32 g > c4'],
  // 爆発。ノイズは体感が大きいので数値は下げる
  boom: ['@{noise} @e{percussive} t120 v15 l8 o3c o2c4 o1c2',
         '@{saw} @e{percussive} t120 v11 l8 o2 c- o1 c-2'],
  bossboom: ['@{noise} @e{percussive} t60 v15 l4 o4c o3c o2c o1c1',
             '@{saw} @e{percussive} t60 v12 l2 o2 c- o1 c-1'],
  // とても硬い物(小惑星・ロケット弾)を壊したときの派手な爆発
  // 長すぎて、鳴っているあいだ他の音が聞こえなかったので短くした。
  // **音が聞こえている長さ**ではなく「声をふさいでいる長さ」が問題なので、
  // テンポを上げて 9.6 秒 -> 2.1 秒にしてある(音の並びはそのまま)
  // おしりの伸ばしを 1 -> 2. にして、鳴り終わりを 0.4 秒ほど早めた
  bigboom: ['@{noise} @e{percussive} t150 v15 l4 o5c o4c o3c o2c o1c2.',
            '@{saw} @e{percussive} t150 v14 l2 o2 c- o1 c-2.',
            '@{noise} @e{piano} t150 v12 l8 o3 c c c c o2 c2.'],
  // 取得音は矩形波で高く抜ける音にして、ほかの SE より目立たせる
  item: '@{pulse50} @e{flat} @s3 t255 v14 o6 l32 c e g > c < g > c e g > c4',
  start: '@{pulse50} @e{flat} t180 v12 o5 l16 ceg>c4',
  // 壊せる硬い敵に当たったときの鈍い「ごわっ!」(低音なので控えめ)
  panel: [
    // 黄色い装甲を叩いたときの音。高い金属音 + 下がるノイズで「カンッ」
    '@{pulse25} @e{piano} t210 v15 l32 o7 e c o6 a',
    '@{noise} @e{percussive} t210 v12 l32 o6 c o5 g r',
  ],
  clink: ['@{noise} @e{percussive} t255 v13 o3 l16 c c',
          '@{saw} @e{percussive} t255 v11 o2 l16 g g'],
  // 回るガードに当たったときの音(高く硬い「カツン」)
  guardhit: ['@{pulse12} @e{percussive} t255 v15 o6 l32 g > c4',
             '@{pulse50} @e{percussive} @d10 t255 v12 o5 l32 g > c4',
             '@{noise} @e{percussive} t255 v9 o4 l32 c c'],
  // 壊せない物(小惑星など)に弾かれたときの「キンキン」
  // 16t のおもりが落ちてくる音。低くにぶい「ゴゴ…」から「ドスン」
  // 16t のおもりが落ちてくる合図。矩形波で高いところから
  // 「ひゅーん」と下りてきて、最後に重い着地音を置く
  weight: ['@{pulse25} @e{soft} t150 v15 o6 l32 c < b a g f e d c < b a g f e d c @e{percussive} v14 o2 c8',
           '@{pulse25} @e{soft} t150 v12 o5 l32 c < b a g f e d c < b a g f e d c @e{percussive} v12 o2 c8',
           '@{pulse50} @e{flat} t150 v10 o1 l4 r c'],
  thud: ['@{pulse12} @e{percussive} @s2 t255 v14 o7 l32 e b >e4<',
         '@{pulse50} @e{percussive} @d14 t255 v12 o6 l32 b >e< b4'],
  // ボスの弱点に当たったとき(高く抜ける音。手応えを出すので少し大きめ)
  weak: ['@{pulse25} @e{percussive} @s3 t255 v15 o6 l32 c > e g >c4<',
         '@{pulse50} @e{percussive} @d12 t255 v12 o5 l32 g > c e g4'],
  // ボスの装甲に弾かれたとき(低く重い音。低音なので数値は下げる)
  armor: ['@{saw} @e{percussive} t255 v12 o2 l32 c c c4',
          '@{noise} @e{percussive} t255 v9 o4 l32 c c c4'],
  // 目玉が現れるときの合図。「どががががが」と、
  // ノイズを鳴らしながら音階が駆け上がっていく
  eyeAppear: ['@{noise} @e{flat} t220 v15 o2 l16 c e g > c e g > c e g > c4',
              '@{saw} @e{flat} @v4 t220 v13 o2 l16 c e g > c e g > c e g > c4',
              '@{pulse12} @e{flat} @s4 t220 v10 o4 l16 r8 c e g > c e g > c4'],
  // 気絶しているあいだのピヨピヨ。小鳥が回っている感じの高い 2 音
  piyo: ['@{pulse12} @e{percussive} t200 v10 o6 l16 e g > c8',
         '@{pulse25} @e{percussive} @d18 t200 v7 o6 l16 g > c e8'],
  // 残り 1 機の警告。ここは埋もれては困るので全体でいちばん大きい
  warning: ['@{pulse12} @e{flat} @s3 t255 v14 o6 l32 e g > c e g > c e g > c4',
            '@{pulse50} @e{flat} @d16 t255 v11 o5 l32 e g > c e g > c e g > c4'],
  // レーザーを溜めているときの音(だんだん高くなる唸り)。
  // 長い音は途中で止められず、ポーズしても鳴り続けてしまうので、
  // 0.4 秒ほどの短いかたまりにして、鳴らす側でくり返す形にした
  charging: ['@{sine} @e{soft} @v6 t150 v14 o3 l16 c e g > c',
             '@{pulse12} @e{soft} @s5 t150 v10 o5 l16 r c e g'],
  // ボスのレーザー発射音。低い唸り + 高い放電 + ノイズを重ねる。
  // こちらも短いかたまりにして、撃っているあいだ鳴らし続ける
  // 2 段目(細いビーム)。素のままだと大きいので 2 段下げる
  laser: LASER_SE.map((m) => m.replace(/v(\d+)/g, (_, n) => 'v' + Math.max(1, Number(n) - 2))),
  // 太いビームを撃っているあいだの音。**半音高い版**。
  // 細くなる段階で元の高さへ落ちるので、「弱まった」ことが音でも分かる
  // 半音上げると倍音が増えて、同じ音量でも耳につく。5 段下げてつり合いを取る
  laserHi: LASER_SE.map((m) => transposeMML(m, 1)
    .replace(/v(\d+)/g, (_, n) => 'v' + Math.max(1, Number(n) - 5))),
  // ドラゴンの突進。「ゴギャ――――」と叫ぶ
  dragonRoar: ['@{noise} @e{percussive} t120 v15 o2 l32 c c r16 @e{flat} v9 o1 l2 c&c',
               '@{saw} @e{flat} @v7 t120 v15 o3 l32 g > d < b a g f e d @e{flat} l2 o2 c&c',
               '@{pulse25} @e{flat} @d25 @v6 t120 v12 o4 l32 g > d < b a g f e d l2 o3 c&c'],
  // ドラゴンが狙いを定めているあいだのカウント。声のように聞こえるよう、
  // 少しずらした 2 本のパルス波を 2 音ずつ滑らせる(3 -> 2 -> 1 で音が上がる)
  // 3・2・1 の読み上げ。埋もれて聞こえなかったので、
  // 矩形波のまま**音量を上げ、少し長く**して、オクターブ上を重ねる
  // 3・2・1 の読み上げ。短くて聞き取れなかったので、
  // **音を伸ばして** はっきり鳴らす(@e{flat} = 伸ばしっぱなしの音)。
  // 矩形波の 3 声(下・中・上)を重ねて、弾幕の中でも抜けてくるようにする
  count3: ['@{pulse25} @e{flat} @v5 t150 v15 o5 l4 g l8 f4', '@{pulse25} @e{flat} @d18 t150 v13 o4 l4 g l8 f4',
           '@{pulse25} @e{flat} t150 v11 o6 l4 g l8 f4'],
  count2: ['@{pulse25} @e{flat} @v5 t150 v15 o5 l4 b l8 a4', '@{pulse25} @e{flat} @d18 t150 v13 o4 l4 b l8 a4',
           '@{pulse25} @e{flat} t150 v11 o6 l4 b l8 a4'],
  count1: ['@{pulse25} @e{flat} @v5 t150 v15 o6 l4 e l8 d4', '@{pulse25} @e{flat} @d18 t150 v13 o5 l4 e l8 d4',
           '@{pulse25} @e{flat} t150 v12 o7 l4 e l8 d4'],
  // 画面をクリップボードへコピーしたときの「カシャッ」。
  // ミラーが上がる短い音 -> シャッターが閉じる音、の 2 つ重ね。
  // ゲームの音より上に鳴らしたいので、呼ぶ側でいちばん強い優先度を渡す
  shutter: ['@{noise} @e{percussive} t255 v15 o4 l32 c r64 c16',
            '@{pulse25} @e{percussive} @s6 t255 v15 o7 l64 c r32 c',
            // 低いほうを 1 声足して、音の芯を太くする(小さく聞こえたため)
            '@{saw} @e{percussive} t255 v15 o3 l32 c r64 c16'],
  // 「?」からオート連射が出たときの、短い当たりの音。
  // ジングルほど派手にはせず、上へ 3 段だけ跳ねて終わる
  // 「ピロリロリロ」。矩形波で上下に跳ねる細かい音を並べて、
  // ほかの音にまぎれないようにする(? から出る特別なアイテム)
  autofire: ['@{pulse25} @e{soft} @s4 t240 v15 o5 l32 c g e >c< g >e c g >c2<',
             '@{pulse25} @e{soft} @d12 t240 v12 o6 l32 c g e >c< g >e c g >c2<',
             '@{pulse12} @e{flat} t240 v9 o4 l16 c e g >c2<'],
  // 「そこじゃない!」の音。まだ石のうちに切り口を撃つと鳴る。
  // わざと調子はずれ(半音のぶつかり)にして、ほかの音と間違えないようにする
  scold: ['@{pulse25} @e{percussive} @d20 t200 v15 o4 l16 f e- d- c8',
          '@{pulse25} @e{percussive} @d40 t200 v13 o4 l16 e d c- <b8',
          '@{noise} @e{percussive} t200 v10 o3 l16 c r c r'],
  // 体力が満ちていく音。低いところから上へ、やわらかく駆け上がる。
  // 瞑想(座禅)で回復するときに鳴らす
  heal: ['@{pulse50} @e{soft} @s3 t190 v13 o4 l16 c e g >c e g >c2<',
         '@{pulse12} @e{soft} @s2 t190 v10 o5 l16 e g >c e g >c e2<',
         '@{triangle} @e{flat} t190 v12 o2 l8 c g >c4<'],
  // 空間がひび割れて広がる音(バキョ)。ラスボスの裂け目が開くときに使う
  rifttear: ['@{noise} @e{percussive} t200 v15 o3 l16 c c32 c32 c8',
             '@{saw} @e{percussive} t200 v14 o4 l16 c o3 g32 e32 c8',
             '@{pulse12} @e{percussive} @s5 t200 v11 o6 l16 c o5 g32 e32 c8'],
  // 小惑星に弾かれたときの「ピキーン」
  ricochet: ['@{pulse12} @e{percussive} @s6 t255 v12 o7 l32 b > e4',
             '@{pulse12} @e{percussive} @d18 t255 v9 o6 l32 b > e4'],
  // 「これは壊せない」ことを伝える、低くつまった音
  nobreak: ['@{saw} @e{percussive} t255 v14 o2 l16 c c32 o1 b32 c8',
            '@{noise} @e{percussive} t255 v11 o2 l16 c c32 c32 c8'],
  // ポーズの出入り(短い 2 音)
  pause: '@{pulse50} @e{flat} t255 v12 o5 l16 c > c4',
  powerdown: '@{saw} @e{percussive} t255 v12 o6 l16 g e c <g e c',   // 下降音(パワーダウン)
  appear: '@{pulse50} @e{soft} t255 v11 o3 l32 c e g > c e g > c', // 上昇音(復帰時)
};


// ---------------------------------------------------------------- 敵出現テーブル

// 1 ステージぶんの出現スケジュールをコードで生成する。
// frame: 出現フレーム(60fps), type: 'A'|'B', x: 出現X, phase: 動きの位相
// moonStart: 月面背景が現れるフレーム / bossStart: ボス出現フレーム
function makeStage() {
  const list = [];
  const cubes = [];
  const rand = rng(777);
  const END = 5200; // ステージ本編の長さ(フレーム)

  // 種類ごとに周期と位相をずらすことで、重なる瞬間と静かな瞬間が
  // 場所によって入れ替わり、単調な繰り返しにならないようにする。
  // 周期は互いに割り切れない値にしてある。

  // 降ってくる編隊 (周期 620)。ステージ最初の敵はこれ(SCOUT)
  for (let t = 180; t < END; t += 620) {
    const baseX = 40 + Math.floor(rand() * 160);
    for (let i = 0; i < 6; i++) {
      list.push({ frame: t + i * 14, type: 'A', x: baseX, phase: rand() * 6.28 });
    }
  }

  // 円盤(UFO)の編隊。ボス戦が主戦場だが、通常ステージでもたまに通り過ぎる (周期 1560)
  for (let t = 1300; t < END; t += 1560) {
    const fromLeft = rand() < 0.5;
    const cIndex = Math.floor(rand() * 5);
    for (let i = 0; i < 5; i++) {
      list.push({
        frame: t + i * 20,
        type: i === cIndex ? 'C' : 'B',
        x: fromLeft ? -20 - i * 24 : 260 + i * 24,
        phase: fromLeft ? 1 : -1,
      });
    }
  }

  // 下からゆらゆら上がってきて、上へ抜けていく敵 (周期 880)
  for (let t = 620; t < END; t += 880) {
    for (let i = 0; i < 4; i++) {
      list.push({
        frame: t + i * 26, type: 'F',
        x: 30 + Math.floor(rand() * 190), phase: rand() * 6.28,
      });
    }
  }

  // ゆっくり自機へ近づいてくる敵 (周期 1240)
  for (let t = 760; t < END; t += 1240) {
    for (let i = 0; i < 2; i++) {
      list.push({
        frame: t + i * 70, type: 'G',
        x: 40 + Math.floor(rand() * 170), phase: 0,
      });
    }
  }

  // 硬いキューブの隊列 (周期 1010)。SCOUT のあとに続けて出す。
  // 宝珠はこの隊列からしか出ない
  for (let t = 420; t < END; t += 1010) cubes.push(t);

  list.sort((a, b) => a.frame - b.frame);
  // ★を 5 つ集めるとボス戦。集まるまで list / cubes はループして出続ける
  return { list, cubes, length: END, starsForBoss: 3, moonStars: 2 };
}

// ---------------------------------------------------------------- 最終面 THE KING
// 「ざ・きんぐ」の第 1 段階。宇宙の真ん中にできる赤い裂け目と、
// そこから出てくる真っ黒なシルエットマン。
// シルエットは「黒 1 色のスプライト」で、暗い赤ベタの背景に浮かせて見せる。

// ---- 図形を塗るための小道具(シルエットを描くのに使う) ----

/** 線分 (x0,y0)-(x1,y1) を太さ r で塗る。手足の 1 本ぶんになる */
function capsule(img, x0, y0, x1, y1, r, color) {
  const c = hex(color);
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = Math.floor(Math.min(y0, y1) - r); y <= Math.ceil(Math.max(y0, y1) + r); y++) {
    for (let x = Math.floor(Math.min(x0, x1) - r); x <= Math.ceil(Math.max(x0, x1) + r); x++) {
      // 線分上のいちばん近い点までの距離で内外を決める
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
      const px = x0 + dx * t - x, py = y0 + dy * t - y;
      if (px * px + py * py <= r * r) setPixel(img, x, y, c);
    }
  }
}

/** 円を塗る(頭や拳) */
function disc(img, cx, cy, r, color) {
  const c = hex(color);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) setPixel(img, x, y, c);
    }
  }
}

/** 多角形を塗る(胴体)。走査線ごとに交点を求める昔ながらのやり方 */
function fillPoly(img, pts, color) {
  const c = hex(color);
  const ys = pts.map(p => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) setPixel(img, x, y, c);
    }
  }
}

// ---- シルエットマン(64x64・黒 1 色のスプライト) ----
// 関節の座標だけを表にしておき、コマを増やすときは座標を足すだけで済むようにする。
// (資料のコマ一覧 00〜09 を、あとから同じ形で書き足せる)
const KING_BLACK = '#000000';
// 1 体ぶんの大きさ。もっと大きく作っていたが、締まりが無かったので細身にした
const KING_MAN_W = 48, KING_MAN_H = 48;

/**
 * シルエットマンを 1 コマ描く。
 * @param {object} p 関節の座標。head=[x,y,半径] / shL,shR,hipL,hipR=[x,y] /
 *                   armL,armR,legL,legR=[付け根, 中間, 先端]
 */
function makeSilhouette(src) {
  const img = createImage(KING_MAN_W, KING_MAN_H);
  // ポーズは縦 64 の目安で書いてある。実際の大きさ(48x48)に合わせて縦を縮める
  const KY = KING_MAN_H / 64;
  const sy = (v) => v * KY;
  const pt = (a) => [a[0], sy(a[1]), a[2]];
  const p = {
    head: [src.head[0], sy(src.head[1]), src.head[2]],
    shL: pt(src.shL), shR: pt(src.shR), hipL: pt(src.hipL), hipR: pt(src.hipR),
    armL: src.armL.map(pt), armR: src.armR.map(pt),
    legL: src.legL.map(pt), legR: src.legR.map(pt),
    hairTilt: src.hairTilt,
  };
  // 胴(肩 2 点 - 腰 2 点の四角)
  fillPoly(img, [p.shL, p.shR, p.hipR, p.hipL], KING_BLACK);
  // 首 -> 頭
  capsule(img, (p.shL[0] + p.shR[0]) / 2, (p.shL[1] + p.shR[1]) / 2,
    p.head[0], p.head[1], 3, KING_BLACK);
  disc(img, p.head[0], p.head[1], p.head[2], KING_BLACK);
  // ぼさぼさの髪。頭のまわりへ、長さのちがうとげを放射状に生やす
  const [hx, hy, hr] = p.head;
  for (const [ang, len, w] of KING_HAIR) {
    const a = ang + (p.hairTilt || 0);
    capsule(img, hx + Math.cos(a) * (hr - 1), hy + Math.sin(a) * (hr - 1),
      hx + Math.cos(a) * (hr + len), hy + Math.sin(a) * (hr + len), w, KING_BLACK);
  }
  // 腕(上腕は太く、前腕は細く。先に拳の玉を置く)。
  // 拳が出っぱりすぎて見えたので、前腕の先を 3 ドットぶん手前で止める
  for (const [a, b, c] of [p.armL, p.armR]) {
    const dx = c[0] - b[0], dy = c[1] - b[1];
    const d = Math.hypot(dx, dy) || 1;
    // 前腕は少しだけ手前で止め、その先に**こぶしの玉**を置く。
    // 玉が前腕と同じ太さだと腕が伸びているようにしか見えないので、
    // 前腕を細く・こぶしを大きくして、握りこぶしだと分かるようにする
    const k = Math.max(0, (d - 4) / d);
    const hand = [b[0] + dx * k, b[1] + dy * k];
    capsule(img, a[0], a[1], b[0], b[1], 3, KING_BLACK);
    capsule(img, b[0], b[1], hand[0], hand[1], 2, KING_BLACK);
    disc(img, hand[0], hand[1], 4, KING_BLACK);
  }
  // 脚(ももは太く、すねは細く)
  for (const [a, b, c] of [p.legL, p.legR]) {
    capsule(img, a[0], a[1], b[0], b[1], 4, KING_BLACK);
    capsule(img, b[0], b[1], c[0], c[1], 3, KING_BLACK);
  }
  return img;
}

// 髪のとげ。[向き(ラジアン), 長さ, 太さ]。上と横へ乱雑に散らす
const KING_HAIR = [
  [-1.9, 9, 2], [-1.55, 11, 2.5], [-1.2, 8, 2], [-2.3, 7, 2],
  [-2.7, 6, 2], [-0.8, 7, 2], [-0.35, 5, 1.5], [3.0, 5, 1.5],
  [-2.05, 5, 1.5], [-1.35, 6, 1.5],
];

// 00 構え。格闘家の身がまえ。腰を落として脚を開き、こぶしを顔の前へ。
// 棒立ちにならないよう、これを待機の姿にする。2 コマで呼吸させる
const kingMan00 = makeSilhouette({
  head: [24, 14, 6],
  shL: [17, 24], shR: [31, 24], hipL: [20, 41], hipR: [29, 41],
  armL: [[17, 25], [12, 32], [18, 23]], armR: [[31, 25], [37, 33], [30, 25]],
  legL: [[20, 41], [14, 51], [10, 61]], legR: [[28, 41], [35, 51], [39, 61]],
  hairTilt: 0.08,
});
const kingMan00b = makeSilhouette({
  head: [24, 15, 6],
  shL: [17, 25], shR: [31, 25], hipL: [20, 42], hipR: [29, 42],
  armL: [[17, 26], [11, 33], [17, 24]], armR: [[31, 26], [38, 34], [31, 26]],
  legL: [[20, 42], [13, 52], [9, 62]], legR: [[28, 42], [36, 52], [40, 62]],
  hairTilt: -0.05,
});

// 01 腕組み。赤い空間から出てくるときの姿。
// 両の前腕を胸の前で交差させ、脚はまっすぐ揃えて立つ。
// 「まだ本気を出していない」ことを、構えないことで見せる
const kingMan01 = makeSilhouette({
  head: [24, 13, 6],
  shL: [17, 23], shR: [31, 23], hipL: [20, 41], hipR: [29, 41],
  // 左腕は右へ、右腕は左へ。高さをずらして重なりを作る
  armL: [[17, 25], [13, 32], [31, 33]], armR: [[31, 25], [35, 32], [17, 30]],
  // つま先立ち。ひざから下をまっすぐ下ろし、つま先を内へすぼめて浮いて見せる
  legL: [[20, 41], [19, 52], [21, 63]], legR: [[28, 41], [29, 52], [27, 63]],
  hairTilt: 0.02,
});
const kingMan01b = makeSilhouette({
  head: [24, 14, 6],
  shL: [17, 24], shR: [31, 24], hipL: [20, 42], hipR: [29, 42],
  armL: [[17, 26], [13, 33], [31, 34]], armR: [[31, 26], [35, 33], [17, 31]],
  legL: [[20, 42], [19, 53], [21, 63]], legR: [[28, 42], [29, 53], [27, 63]],
  hairTilt: -0.03,
});

// 02 ガード。頭以外を撃たれたときの構え。
// 両腕を顔の前に立てて身を固め、腰を落として耐える。
// 撃たれるたびにこの姿になり、そのぶん動きが鈍っていく
const kingMan02 = makeSilhouette({
  head: [24, 16, 6],
  shL: [17, 26], shR: [31, 26], hipL: [20, 42], hipR: [29, 42],
  // ひじを締めて、前腕を顔の高さまで立てる
  armL: [[17, 27], [16, 34], [20, 19]], armR: [[31, 27], [32, 34], [28, 19]],
  legL: [[20, 42], [14, 52], [11, 61]], legR: [[28, 42], [35, 52], [38, 61]],
  hairTilt: 0.3,
});

// 06 パンチ。腰をひねって右こぶしを前へ突き出す(2 コマ: ため -> 打つ)
const kingMan06 = makeSilhouette({
  head: [22, 15, 6],
  shL: [16, 25], shR: [30, 24], hipL: [20, 42], hipR: [29, 42],
  armL: [[16, 26], [10, 30], [16, 22]], armR: [[30, 25], [34, 30], [30, 22]],
  legL: [[20, 42], [14, 52], [10, 61]], legR: [[28, 42], [35, 52], [39, 61]],
  hairTilt: -0.2,
});
const kingMan06b = makeSilhouette({
  head: [25, 16, 6],
  shL: [18, 26], shR: [32, 25], hipL: [20, 42], hipR: [29, 42],
  armL: [[18, 27], [13, 32], [19, 25]], armR: [[32, 26], [38, 36], [44, 48]],
  legL: [[20, 42], [13, 52], [8, 61]], legR: [[28, 42], [36, 52], [41, 60]],
  hairTilt: 0.35,
});

// 07 とびげり。体を横に倒して片脚をまっすぐ伸ばす
const kingMan07 = makeSilhouette({
  head: [13, 22, 6],
  shL: [19, 24], shR: [21, 30], hipL: [30, 26], hipR: [31, 34],
  armL: [[19, 25], [14, 32], [10, 38]], armR: [[21, 30], [16, 36], [12, 42]],
  legL: [[30, 27], [38, 27], [46, 27]], legR: [[31, 34], [34, 41], [27, 44]],
  hairTilt: 1.5,
});

// 08 ムーンサルトキック。逆さまになって脚を上へ振り上げる
const kingMan08 = makeSilhouette({
  head: [24, 44, 6],
  shL: [18, 36], shR: [30, 36], hipL: [20, 22], hipR: [29, 22],
  armL: [[18, 36], [13, 44], [10, 52]], armR: [[30, 36], [35, 44], [38, 52]],
  legL: [[20, 22], [16, 12], [20, 2]], legR: [[28, 22], [33, 12], [29, 2]],
  hairTilt: 3.1,
});
// 09 やられて崩れ落ちる。ひざを折ってしゃがみこむ姿
// 10 サマーソルトの空中姿勢。横を向いて、ひざを抱え込んだ「かかえ込み宙返り」。
// ただ逆さまで昇ると遊んでいるように見えたので、体を丸めた姿にして
// これを 90 度ずつ回す(回っていることが形で分かる)
const kingMan10 = makeSilhouette({
  head: [30, 24, 6],
  shL: [23, 31], shR: [33, 30], hipL: [21, 43], hipR: [30, 44],
  // 腕は前へ回して、抱えたひざをつかむ
  armL: [[23, 32], [19, 39], [27, 43]], armR: [[33, 31], [35, 38], [30, 44]],
  // ももを胸まで引き上げ、すねを折りたたむ
  legL: [[21, 43], [17, 34], [26, 30]], legR: [[30, 44], [35, 35], [29, 30]],
  hairTilt: 1.2,
});

// 12 気絶。ひざが完全に落ち、頭が肩のあいだへ沈んで、腕は真下へ垂れる。
// 立っているほかの姿と見分けがつくよう、**背を低く・幅を広く**取る
const kingMan12 = makeSilhouette({
  // **うつむいて腕をぶら下げた姿**。立ってはいるが、
  // 頭が前に落ち、腕は力が抜けて体の横に垂れている。
  // 立ち姿との差は「頭の低さ」と「腕が動いていないこと」で見せる
  head: [21, 34, 6],
  shL: [18, 41], shR: [30, 41], hipL: [21, 51], hipR: [30, 51],
  // 腕は肩から真下へ。胴から少し離して、輪郭が分かれるようにする
  armL: [[18, 42], [14, 51], [13, 61]], armR: [[30, 42], [35, 51], [36, 61]],
  // 足は立ったまま、ひざを少しゆるめる
  legL: [[21, 51], [18, 58], [17, 64]], legR: [[30, 51], [32, 58], [33, 64]],
  hairTilt: 1.4,
});

// 11 座禅。2 度動けなくなったあと、腰を下ろして瞑想する姿。
// あぐらの足を横に広げ、手はひざの上で組む。無敵で体力を戻す
const kingMan11 = makeSilhouette({
  head: [24, 28, 6],
  shL: [17, 38], shR: [31, 38], hipL: [18, 50], hipR: [30, 50],
  // ひじを張って、手はひざの上で合わせる
  armL: [[17, 39], [11, 46], [22, 52]], armR: [[31, 39], [37, 46], [26, 52]],
  // あぐら。ももを外へ張り出し、すねを内側へ折りたたむ
  legL: [[19, 50], [9, 57], [23, 60]], legR: [[29, 50], [39, 57], [25, 60]],
  hairTilt: 0,
});

const kingMan09 = makeSilhouette({
  head: [24, 30, 6],
  shL: [17, 38], shR: [31, 38], hipL: [19, 50], hipR: [29, 50],
  armL: [[17, 39], [12, 47], [10, 56]], armR: [[31, 39], [36, 47], [38, 56]],
  legL: [[20, 50], [13, 57], [19, 62]], legR: [[28, 50], [35, 57], [29, 62]],
  hairTilt: 0.5,
});
// 05 ダメージ。頭と上体を後ろへ大きくのけぞらせ、腕は前へ流れる。
// 撃たれているあいだと、名乗りのあいだに使う
const kingMan05 = makeSilhouette({
  head: [21, 15, 6],
  shL: [17, 24], shR: [29, 24], hipL: [21, 41], hipR: [30, 41],
  armL: [[17, 25], [15, 34], [18, 43]], armR: [[29, 25], [33, 33], [36, 41]],
  legL: [[21, 41], [17, 52], [13, 61]], legR: [[29, 41], [32, 52], [34, 61]],
  hairTilt: 0.45,
});
const kingMan05b = makeSilhouette({
  head: [20, 17, 6],
  shL: [17, 26], shR: [29, 26], hipL: [21, 42], hipR: [30, 42],
  armL: [[17, 27], [14, 35], [17, 44]], armR: [[29, 27], [34, 34], [37, 42]],
  legL: [[21, 42], [16, 53], [12, 62]], legR: [[29, 42], [33, 53], [35, 62]],
  hairTilt: 0.62,
});

// 04 バーン!登場。手足を大きく開いた決めポーズ
const kingMan04 = makeSilhouette({
  head: [24, 14, 6],
  shL: [16, 24], shR: [32, 24], hipL: [19, 42], hipR: [29, 42],
  armL: [[16, 25], [8, 20], [3, 12]], armR: [[32, 25], [40, 20], [45, 12]],
  legL: [[20, 42], [13, 52], [6, 60]], legR: [[28, 42], [35, 52], [42, 60]],
  hairTilt: -0.1,
});

// ---- 赤い裂け目(64x96・BG スプライト) ----
// 「横 8 ドット 2 色」を確実に守るため、色は行ごとに 1 色だけ使う
// (黒 + その行の赤 = 2 色)。行が変われば別の赤を使ってよいので、
// 真ん中の行ほど明るい赤にすると、奥から光が漏れているように見える。
// 裂け目は 32x48。もっと大きく作っていたが、画面を占領しすぎたので半分にした
const RIFT_W = 32, RIFT_H = 48;
const RIFT_EDGE = '#b95e51', RIFT_MID = '#db6559', RIFT_CORE = '#ff897d';

// 撃破後に逃げ込む「別の青い空間」の裂け目。色だけ差し替えて使い回す
const RIFT_BLUE = ['#20308f', '#5955e0', '#65dbef'];

// 段階ごとの太さ。0=細い / 1=広がった / 2=大きく口を開けた
const RIFT_BASE = [2.25, 4.5, 7];
// 開くまでの途中の姿。[太さ, 縦にどれだけ伸びているか]。
// じわじわ広がるのを見せたいので、コマ数は多めに取る
const RIFT_OPEN = Array.from({ length: 9 }, (_, i) => {
  const t = (i + 1) / 10;
  return [0.3 + t * 2.0, 0.12 + t * 0.9];
});

/**
 * 裂け目を 1 枚描く。
 * @param {number} base 太さ
 * @param {number} seed 乱数の種
 * @param {string[]} [colors] [ふち, 中間, 中心] の色(省略で赤)
 * @param {number} [span=1] 縦にどれだけ伸びているか(0..1。開くまでの途中で使う)
 * @param {number} [branch=1] 枝分かれのひびを出す度合い(0 で出さない)
 */
function makeRiftBase(base, seed, colors, span = 1, branch = 1) {
  const [EDGE, MID, CORE] = colors || [RIFT_EDGE, RIFT_MID, RIFT_CORE];
  const img = createImage(RIFT_W, RIFT_H);
  const rand = rng(seed);
  const cx = RIFT_W / 2;
  // 上下の真ん中を基準に、span のぶんだけ縦に伸びている
  const half = (RIFT_H * span) / 2;
  const top = RIFT_H / 2 - half, bot = RIFT_H / 2 + half;
  let jitter = 0;
  for (let y = 0; y < RIFT_H; y++) {
    // 中心線をふらつかせて、まっすぐでない「ひび」にする
    jitter = Math.max(-3, Math.min(3, jitter + (rand() - 0.5) * 1.8));
    if (y < top || y >= bot) continue;
    const t = Math.sin((Math.PI * (y + 0.5 - top)) / (bot - top));   // 上下の端は細く
    const w = base * Math.pow(t, 0.75) * (0.85 + rand() * 0.3);
    if (w < 0.5) continue;
    // 行ごとの色。真ん中ほど明るく、境目は少し乱して段差を目立たなくする
    const g = t + (rand() - 0.5) * 0.12;
    const color = g > 0.82 ? CORE : g > 0.5 ? MID : EDGE;
    const c0 = cx + jitter;
    for (let x = Math.round(c0 - w); x <= Math.round(c0 + w); x++) setPixel(img, x, y, hex(color));
    // 広がってきたら、横へ枝分かれしたひびが走る(色は同じ行の色のまま)
    if (branch > 0 && rand() < 0.06 * branch) {
      const dir = rand() < 0.5 ? -1 : 1;
      // 左へ伸びるひびが長すぎて目立っていたので、そちらだけ短くする
      const span = dir < 0 ? 4 : 8;
      const len = 3 + Math.floor(rand() * span * branch);
      let bx = c0 + dir * w, by = y;
      for (let i = 0; i < len; i++) {
        bx += dir; by += (rand() - 0.5) * 1.4;
        setPixel(img, Math.round(bx), Math.round(by), hex(color));
      }
    }
  }
  return img;
}
/**
 * 裂け目のまわりに走る細かいひび(96x112・BG スプライト)。
 * 中心から外へ、枝分かれしながら伸びる細い線。
 * 削るほど本数が増えるので 3 段階ぶん作る。
 * @param {number} n ひびの本数 @param {number} seed 乱数の種
 */
function makeCracks(n, seed) {
  const W = 96, H = 112, img = createImage(W, H);
  const rand = rng(seed);
  const cx = W / 2, cy = H / 2;
  const draw = (a, r0, len, depth) => {
    let x = cx + Math.cos(a) * r0, y = cy + Math.sin(a) * r0;
    let ang = a;
    for (let i = 0; i < len; i++) {
      ang += (rand() - 0.5) * 0.5;   // ふらつかせて、まっすぐでない線に
      x += Math.cos(ang); y += Math.sin(ang);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      // 中心から遠いほど暗くして、消えていくように見せる
      const t = Math.hypot(x - cx, y - cy) / (W / 2);
      setPixel(img, Math.round(x), Math.round(y),
        hex(t < 0.45 ? RIFT_MID : RIFT_EDGE));
      // ときどき枝分かれ
      if (depth > 0 && rand() < 0.04) {
        draw(ang + (rand() < 0.5 ? -0.9 : 0.9),
          Math.hypot(x - cx, y - cy), Math.max(3, Math.floor(len * 0.4)), depth - 1);
      }
    }
  };
  for (let i = 0; i < n; i++) {
    // 裂け目の縁(上下)から外へ向かって伸ばす。
    // 横へ向かうひびは長いと目立ちすぎるので、真横に近いものほど短くする
    const a = (Math.PI * 2 * (i + rand() * 0.6)) / n;
    const side = Math.abs(Math.cos(a));            // 1 に近いほど真横
    const len = Math.round((9 + rand() * 11) * (1 - side * 0.6));
    if (len < 3) continue;
    draw(a, 14 + rand() * 6, len, side > 0.7 ? 0 : 2);
  }
  return img;
}
const kingCracks0 = makeCracks(5, 4101);
const kingCracks1 = makeCracks(10, 4102);
const kingCracks2 = makeCracks(18, 4103);

const kingRift0 = makeRiftBase(RIFT_BASE[0], 4001, null, 1, 0);
const kingRift1 = makeRiftBase(RIFT_BASE[1], 4002, null, 1, 1);
const kingRift2 = makeRiftBase(RIFT_BASE[2], 4003, null, 1, 2);
// 出てくるまでの途中の姿(細い線から、じわじわ縦へ伸びて広がっていく)
const kingRiftOpen = RIFT_OPEN.map(([b, sp], i) =>
  makeRiftBase(b, 4010 + i, null, sp, 0));
// エンディングで逃げ込む青い裂け目(赤いのと同じ形、色だけ違う)
const kingRiftBlue = makeRiftBase(RIFT_BASE[2], 4003, RIFT_BLUE, 1, 2);
// 倒したあとに逃げ込む裂け目。開ききった太いものではなく、
// 細く走った 1 本にする(そっと開いて消える見せかた)
const kingRiftBlueThin = makeRiftBase(RIFT_BASE[0], 4004, RIFT_BLUE, 1, 0);

/**
 * 回転レーザー(16x16)。2 ドット幅の水色の線を、角度違いでたくさん用意しておく。
 * 1 発 = 1 枚のスプライトで、自分の角度に合う絵をそのまま使う。
 * 線は 180 度回すと同じ見た目になるので、180 度ぶんを刻めばよい。
 */
const KING_LINE_STEPS = 16;
const kingLines = [];
for (let i = 0; i < KING_LINE_STEPS; i++) {
  const a = (Math.PI * i) / KING_LINE_STEPS;
  const img = createImage(16, 16);
  const C = hex('#65dbef');
  const cx = 7.5, cy = 7.5;
  const dx = Math.cos(a), dy = Math.sin(a);
  // 中心から両方向へ伸ばす。法線方向へ 1 ドットずらした 2 本で太さ 2 ドットにする
  for (let t = -11; t <= 11; t += 0.25) {
    for (const off of [-0.5, 0.5]) {
      setPixel(img, Math.round(cx + dx * t - dy * off), Math.round(cy + dy * t + dx * off), C);
    }
  }
  kingLines.push(img);
}

/**
 * 同じレーザーの「2 倍長い」版(48x48 の枠に 32 ドットの線)。
 * 5 面で、はるか前方からほぼまっすぐ飛んでくるもの。
 * 遠くから来るので線が長く見える、という見立て。
 */
const kingLinesLong = [];
for (let i = 0; i < KING_LINE_STEPS; i++) {
  const a = (Math.PI * i) / KING_LINE_STEPS;
  const img = createImage(48, 48);
  const C = hex('#65dbef');
  const cx = 23.5, cy = 23.5;
  const dx = Math.cos(a), dy = Math.sin(a);
  // 絵の枠(48)で切れるので、実際に見えていたのは 48 ドット。
  // その 2/3 = 32 ドットになるよう ±16 で引く
  for (let t = -16; t <= 16; t += 0.25) {
    for (const off of [-0.5, 0.5]) {
      setPixel(img, Math.round(cx + dx * t - dy * off), Math.round(cy + dy * t + dx * off), C);
    }
  }
  kingLinesLong.push(img);
}

// ---- 未実装さんのふきだし ----
// せりふ(英語)は画面の下の行に出すので、ふきだしの中は「・・・」だけ。
// 48x24(中は 48x16 + 上に尻尾 8)。中は白、ふちと点は黒
function makeTalkBubble() {
  // 56x16。**左に尻尾**(顔のほうを指す) + 48x16 の箱。
  // 相手の右横に出すので、尻尾は上ではなく左に付ける
  const W = 56, H = 16, img = createImage(W, H);
  const WHITE = hex('#ffffff'), BLACK = hex('#000000');
  const LEFT = 8;                 // 箱の左はし(ここより左は尻尾)
  // 白い紙。角は 2 ドット落として丸くする
  for (let y = 0; y < H; y++) {
    for (let x = LEFT; x < W; x++) {
      const dx = Math.min(x - LEFT, W - 1 - x), dy = Math.min(y, H - 1 - y);
      if (dx + dy < 2) continue;
      setPixel(img, x, y, WHITE);
    }
  }
  // ふち。**尻尾の付け根には線を引かない**(つながって見えるように)
  for (let x = LEFT; x < W; x++) { setPixel(img, x, 0, BLACK); setPixel(img, x, H - 1, BLACK); }
  for (let y = 0; y < H; y++) {
    if (y < 4 || y > 11) setPixel(img, LEFT, y, BLACK);
    setPixel(img, W - 1, y, BLACK);
  }
  // 角の丸み
  for (const [cx, cy] of [[LEFT + 1, 1], [W - 2, 1], [LEFT + 1, H - 2], [W - 2, H - 2]]) {
    setPixel(img, cx, cy, BLACK);
  }
  for (const [cx, cy] of [[LEFT, 0], [W - 1, 0], [LEFT, H - 1], [W - 1, H - 1]]) {
    clearPixel(img, cx, cy);
  }
  // 尻尾(左向きの三角)。左はしが先で、箱に向かって広がる。
  // 上下のふちを黒でなぞり、箱とは地続きにする
  for (let i = 0; i < 8; i++) {
    const half = 1 + Math.round((i * 3) / 7);   // 1 -> 4
    const y0 = 8 - half, y1 = 7 + half;
    for (let y = y0; y <= y1; y++) setPixel(img, i, y, WHITE);
    setPixel(img, i, y0, BLACK);
    setPixel(img, i, y1, BLACK);
  }
  // 「・・・」。太くならないよう 2x2 の点を 3 つ
  for (const cx of [22, 30, 38]) {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      setPixel(img, cx + x, 7 + y, BLACK);
    }
  }
  return img;
}
const talkBubble = makeTalkBubble();

// ---- スタッフロールの背景に置くパイロットの女の子 ----

/** 楕円を塗る */
function ellipse(img, cx, cy, rx, ry, color) {
  const c = hex(color);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPixel(img, x, y, c);
    }
  }
}

/** 長方形を塗る */
function rect(img, x0, y0, w, h, color) {
  const c = hex(color);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPixel(img, x, y, c);
}

/** 1 ドットおきに抜いて走査線に見せる(BG に描くと抜けたところが黒くなる) */
function scanlines(src) {
  const img = { width: src.width, height: src.height, data: src.data.slice() };
  for (let y = 1; y < img.height; y += 2) {
    for (let x = 0; x < img.width; x++) img.data[(y * img.width + x) * 4 + 3] = 0;
  }
  return img;
}

// こちらを向いて手を振っているパイロットの女の子(宇宙服)。
// ヘルメットは脱いで下ろしたほうの手で抱え、片目はウインク。
// そばに宇宙リスが浮かんでいる。224x192 = 画面いっぱいに腰から上が入る。
//
// **中間色は 1 ライン おきのディザ**で出す。
// ディザの 2 本の線にはそれぞれ別の「目印の色」を塗ってあり、
// 書き出しの表(duo)で実際の色へ置き換える。
// 目のなかで混ざって中間色になる。走査線の位相を毎コマ動かすと、
// 両方の色が順番に見えて混ざりがよくなる。
const PILOT_COLORS = {
  S: '#ff897d',   // 肌
  P: '#db6559',   // ほお
  H: '#ccc35e',   // 髪
  Y: '#ded087',   // 髪の照り
  h: '#b95e51',   // 目・口・まゆ
  W: '#ffffff',   // 宇宙服(明)
  G: '#cccccc',   // 宇宙服
  C: '#65dbef',   // ガラス・パネル
  B: '#5955e0',   // 青(袖・ベルト・リス)
  K: '#000000',   // 目の点
};
// 中間色。even/odd = ディザの偶数行用・奇数行用の目印。
// 目印にはこの絵で使っていないパレット番号を当ててある
const PILOT_MID = {
  face: { even: 2,  odd: 3,  pair: ['#ff897d', '#db6559'] },   // 顔の陰
  hair: { even: 5,  odd: 12, pair: ['#ccc35e', '#b95e51'] },   // 髪の陰
  suit: { even: 13, odd: 1,  pair: ['#cccccc', '#8076f1'] },   // 宇宙服の陰
};
const PILOT_MID_CH = { m: ['face', 0], n: ['face', 1],
  v: ['hair', 0], w: ['hair', 1], x: ['suit', 0], z: ['suit', 1] };
const PILOT_ART = [
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '................................................................................................................................................................................................................................',
  '..............................YY................................................................................................................................................................................................',
  '.............................YY.....................................................................................................SS...SS.....................................................................................',
  '...................................................................................................................................SSSS.SSSS....................................................................................',
  '...................................................................................................................................SSSS.SSSS....................................................................................',
  '.......YYY.....................................................................................................................SS..SSSS.SSSS..SS................................................................................',
  '..............................................................................................................................SSSS.SSSS.SSSS.SSSS...............................................................................',
  '..............................................................................................................................SSSS.SSSS.SSSS.SSSS...............................................................................',
  '....................................CCC.......................................................................................SSSS.SSSS.SSSS.SSSS..............................................HH...............................',
  '....................................CCC...............................................HHHHHHHHHHHHHHHHHHHHHHHHHHHHH...........SSSS.SSSS.SSSS.SSSS..............................................HH...............................',
  '....................................................................................HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH.........SSSS.SSSS.SSSS.SSSS...............................................................................',
  '..................................................................................HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH.......SSSS.SSSS.SSSS.SSSS...............................................................................',
  '................................................................................HHHHHHHHHHHHHYYYYYYYYYYYHHHHHHHHHHHHHHHHH.....SSSS.SSSS.SSSS.SSSS...............................................................................',
  '...............................................................................HHHHHHHHHHYYYYYYYYYYYYYYYYYYYHHHHHHHHHHHHHH....SSSS.SSSS.SSSS.SSSS...............................................................................',
  '.............................................................................HHHHHHHHHYYYYYYYYYYYYYYYYYYYYYYYYYHHHHHHHHHHHHH..SSSS.SSSS.SSSS.SSSS...............................................................................',
  '............................................................................HHHHHHHHYYYYYYYYYHHHHHHHHHHHYYYYYYYYYHHHHHHHHHHHH.SSSSSSSSSSSSSSSSSSSm..............................................................................',
  '...........................................................................HHHHHHHYYYYYYYHHHHHHHHHHHHHHHHHHHYYYYYYYHHHHHHHHHHHSSSSSSSSSSSSSSSSSSSnBBBY..........................................................................',
  '..........................................................................HHHHHHHYYYYYHHHHHHHHHHHHHHHHHHHHHHHHHYYYYYHHHHHHHHHHHSSSSSSSSSSSSSSmmmmm.BBBY...............................................WW........................',
  '..........................................................................HHHHHHHYYYHHHHHHHHHHHHHHHHHHHHHHHHHHHHHYYYYYHHHHHHHHHSSSSSSSSSSSSSSnnnnn....................................................WW........................',
  '.........................................................................HHHHHHHHYHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHYYYYHHHHHHHHHSSSSSSSSSSSSmmmmm..............HHH..............................................................',
  '........................................................................HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHYYYHHHHHHHHHHSSSSSSSSSSSnnnnn..............HHH.............YYY..............................................',
  '........................................................................HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHSSSSSSSSSSSmmmmm..............................YYY..............................................',
  '..........................................CC............................HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHSSSSSSSSSSSnnnnn...............................................................................',
  '.......................................................................HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHSSSSSSSSSSmmmmm...............................................................................',
  '.....................BB...............................................HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHSSSSSSSSSnnnnn...............................................................................',
  '....................BB................................................HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHSSSSSSSSSmmmmm...............................................................................',
  '......................................................................HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHSSSSSSSSSnnnnn........................................................YY.....................',
  '............................................................CC........HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHSSSSSSSSmmmmm........................................................YY......................',
  '......................................................................HHHHHHHHHHHHHHHSSHHHHHHSSSSHHHHHHHHSSSSSSSHHHHHHHSSSHHHHHHHHHSSSSSSSSnnnnn............................................................YY..................',
  '......................................................................HHHHHHHHHHHHHHSSSHHHHHHSSSSSHHHHHHSSSSSSSSHHHHHHSSSSHHHHHHHHHSSSSSSSSmmmmm................................................................................',
  '.....................................................................HHHHHHHHHHHHHHHSSSHHHHHHSSSSSHHHHHHSSSSSSSSHHHHHHSSSSSHHHHHHHHHSSSSSSSSSS..................................................................................',
  '.....................................................................HHHHHHHHHHHHHHSSSSSHHHHSSSSSSHHHHHHSSSSSSSSHHHHHHmmmmmHHHHHHHHHSSSSSSSSSS..................................................................................',
  '.....................................................................HHHHHHHHHHHHHHSSSSSSSSSSSSSSSHHHHHHSSSSSSSSHHHHHnnnnnnHHHHHHHHHSSSSSSSSSSS.................................................................................',
  '.....................................................................HHHHHHHHHHHHHHSSSSSSSSSShhhhhhhhhHSSSSSSSSSShhhhhhhhmmHHHHHHHHHSSSSSSSSSSSHH...............................................................................',
  '.....................................................................HHHHHHHHHHHHHHSSSSSSSSSShhhhhhhhhHSSSSSSSSSShhhhhhhhnnHHHHHHHHHHHHHHHHHHHHHH........................................................................HHH....',
  '.....................................................................HHHHHHHHHHHHHHSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSmmmmmmHHHHHHHHHHHHHHHHHHHHHH.........................................................................HHH...',
  '.....................................................................HHHHHHHHHHHHHHSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSnnnnnnHHHHHHHHHHHHHHHHHHHHHH...............................................................................',
  '.........................HHH......................................HHHHHHHHHHHHHHHHHSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSmmmmmmHHHHHHHHHHHHHHHHHHHHHH...............................................................................',
  '.....WWW.................HHH......................................HHHHHHHHHHHHHHHHHSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSnnnnnnHHHHHHHHHHHHHHHHHHHHHH...............................................................................',
  '.....WWW..........................................................HHHHHHHHHHHHHHHHHSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSmmmmmmHHHHHHHHHHHBBBBBBBBBBB.........................................................CC....................',
  '..................................................................HHHHHHHHHHHHHHHHHSSSSSSSSSSSSSSSSKSSSSSSSSSSSSSSKSSnnnnnnHHHHHHHHHHHBBBBBBBBBBB........................................................CC.....................',
  '..................................................................HHHHHHHHHHHHHHHHHSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSmmmmmmHHHHHHHHHHHBBBBBBBBBBB...............................................................................',
  '..................................................................HHHHHHHHHHHHHHHHHSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSnnnnnnHHHHHHHHHHHBBBBBBBBBBB...............................................................................',
  '.................................................................HHHHHHHHHHHHHHHHHHSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSmmmmmmHHHHHHHHHHHHBBBBBBBBBB...............................................................................',
  '.................................................................HHHHHHHHHHHHHHHHHHSSSSSSSSSSSSSSSSSSSSSSSSSSPSSSSSSSnnnnnnHHHHHHHHHHHHBBBBBBBBBB...............................................................................',
  '.................................................................HHHHHHHHHHHHHHHHHHSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSmmmmmmHHHHHHHHHHHHGGxxxxxxxx...............................................................................',
  '.................................................................HHHHHHHHHHHHHHHHHHSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSnnnnnnHHHHHHHHHHHHGGzzzzzzzz...............................................................................',
  '..............BBCC...............................................HHHHHHHHHHHHHHHH..SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSmmmmmm.HHHHHHHHHHHGGxxxxxxxx..............................................................CC...............',
  '..............BBCC...............................................HHHHHHHHHHHHHHHH..SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSnnnnnn.HHHHHHHHHHHGzzzzzzzz...............................................................CC...............',
  '.................................................................HHHHHHHHHHHHHHHH..SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSmmmmmm.HHHHHHHHHHHGxxxxxxxx................................................................................',
  '.................................................................HHHHHHHHHHHHHHHH...SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSnnnnnn.HHHHHHHHHHHGzzzzzzzz................................................................................',
  '.................................................................HHHHHHHHHHHHHHHH...SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSmmmmmm..HHHHHHHHHHHGxxxxxxxx................................................................................',
  '.................................................................HHHHHHHHHHHHHHHH...SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSnnnnnn..HHHHHHHHHHHzzzzzzzz.................................................................................',
  '.................................................................HHHHHHHHHHHHHHHH....SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSmmmmmm..HHHHHHHHHHHxxxxxxxx.................................................................................',
  '.................................................................HHHHHHHHHHHHHHHH....SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSnnnnnn...HHHHHHHHHHHzzzzzzzz.................................................................................',
  '.................................................................HHHHHHHHHHHHHHHH....WSSSSSSSSSSSSmmmmmmmmmmmmmmmSSmmmmmm...HHHHHHHHHHHxxxxxxxx........................................................................HH.......',
  '...................BB............................................HHHHHHHHHHHHHHHH....WWSSSSSSSSSSSnnnnnnnnnnnnnnnSnnnnnn...GHHHHHHHHHHHzzzzzzz......................................CC..........................................',
  '................HHHBB............................................HHHHHHHHHHHHHHHH....WWWSSSSSSSSSSSmmmmmmmmmmmmmSmmmmmm....GHHHHHHHHHHHxxxxxxx..................................................................................',
  '.................................................................HHHHHHHHHHHHHHHH...WWWWWSSSSSSSSSSSnnnnnnnnnnnSnnnnnn.....GHHHHHHHHHHHzzzzzzz........................YY........................................................',
  '................................HH...............................HHHHHHHHHHHHHHHH...WWWWWWSSSSSSSSSSmmmmmmmmmmmmmmmmm......GHHHHHHHHHHHxxxxxxx...................................................CCC............................',
  '................................HH...............................HHHHHHHHHHHHHHHH...WWWWWWWSSSSSSSSSnnnnnnnnnnnnnnnnn......GHHHHHHHHHHHzzzzzzz...................................................CCC............................',
  '.................................................................HHHHHHHHHHHHHHHH...WWWWWWWWWSSSSSSSSSSSSSSSSSSSSSSSW.....GGHHHHHHHHHHHxxxxxx...................................................................................',
  '.................................................................HHHHHHHHHHHHHHHH...WWWWWWWWWWSSSSSSSSSSSSSSSSSSSSWWW.....GGHHHHHHHHHHHzzzzzz...................................................................................',
  '..................................................................HHHvvvvvHHHHHHH.xxxxxxxxxxxxxxSSSSSSSSSSSSSSSSSxxxxxx...GGHHHvvvvvHHxxxxxxx...................................................................................',
  '..................................................................HHHwwwwwHHHHHHH.zzzzzzzzzzzzzzzSSSSSSSSSSSSSSSzzzzzzz...GGHHHwwwwwHHzzzzzzz...................................................................................',
  '........................................CC........................HHHvvvvvHHHHHHH.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..GGGHHHvvvvvHHxxxxxx....................................................................................',
  '..................................................................HHHwwwwwHHHHHHH.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz..GGGHHHwwwwwHHzzzzzz........................WW..........................................................',
  '...............................BBBBBB...........BBBBBB............HHHvvvvvHHHHHHHHGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG.GGHHHHvvvvvHHxxxxxx....................................................................................',
  '...........................HH..BBBBBB...........BBBBBB............HHHwwwwwHHHHHHHHGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGHHHHwwwwwHHzzzzzz....................................................................................',
  '......................HHH.HH....BBBBB...........BBBBB.............HHHvvvvvHHHHHHHHGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGHHHHvvvvvHHxxxxx.....................................................................................',
  '................................BBBBB...........BBBBB.............HHHwwwwwHHHHHHHHGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGHHHHwwwwwHHzzzzz.....................................................................................',
  '.................................BBBB...........BBBB..............HHHvvvGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxxHHHHvvvvvHH...............................................WWW........................................',
  '..........................HHH....BBBB...........BBBB..............HHHwwGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzHHHHwwwwwHH................................................WWW.......................................',
  '..................................BBB.....YYY...BBB................HHHvGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxHHHvvvvvHH...........................................................................................',
  '..................................BBBBBBBBBBBBBBBBB................HHHGGGGGGGGGGGGGGGGGGzzzzzzzzzzzzzzzzGGGGGGGGzzzzzzzzzzzHHHwwwwwHH...........................................................................................',
  '....................................BBBBBBBBBBBBB..................HHHGGGGGGGGGGGGGGGGGGxxxxxxxxxxxxxxxxGGGGGGGGxxxxxxxxxxxHHHvvvvvHH...........................................................................................',
  '..................................BBBBBBBBBBBBBBBBB................HHGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzzzzzzGGGGGGGGzzzzzzzzzzzHHHwwwwwHH................................................HH.........................................',
  '.................................BBBBBBBBBBBBBBBBBBB...............HHGGGGGGGGGGGGHGGGGGGxxCCCCCCCCCCCCxxGGGGGGGGGxxxxxxxxxxHHHvvvvvHH...........................................................................................',
  '................................BBBBBBBBBBBBBBBBBBBBB..............HGGGGGGGGGGGGCCGGGGGGzzCCCCCCCCCCCCzzGGGGGGGGGzzzzzzzzzzHHHwwwwwHH..........................................HH...............................................',
  '................................BBBBBBBBBBBBBBBBBBBBB..............HGGGGGGGGGGGGCCGGGGGGxxCCCCCCCCCCCCxxGGGGGGGGGxxxxxxxxxxHHHvvvvvHH.................YYY......................HH...............................................',
  '...............................BBBBBBBBBBBBBBBBBBBBBBB.............GGGGGGGGGGGGGHHGGGGGGzzCCCCCCCCCCCCzzGGGGGGGGGzzzzzzzzzzHHwwwwwHH............................................................................................',
  '..............................BBBBBBBBBBBBBBBBBBBBBBBBB............GGGGGGGGGGGGHHHGGGGGGxxCCCCCCCCCCCCxxGGGGGGGGGxxxxxxxxxxHHvvvvvHH......................................................................WWW...................',
  '..............................BBBBBBBBBBBBBBBBBBBBBBBBB...........GGGGGGGGGGGGGHHHGGGGGGzzCCCCCCCCCCCCzzGGGGGGGGzzzzzzzzzzzHHwwwwwHH......................................................................WWW...................',
  '..............................BBBBBBBBBBBBBBBBBBBBBBBBB...........GGGGGGGGGGGGHHHHGGGGGGxxCCCCCCCCCCCCxxGGGGGGGGxxxxxxxxxxxHHvvvvvHH............CC..............................................................................',
  '..............................BBBBBBBhBBBBBBBBBhBBBBBBB..........GGGGGGGGGGGGGHHHHGGGGGGzzzzzzzzzzzzzzzzGGGGGGGGzzzzzzzzzzzHHwwwwwHH............CC..............................................................................',
  '.........................C....BBBBBhhhhhBBBBBhhhhhBBBBB..........GGGGGGGGGGGGHHHHHGGGGGGxxxxxxxxxxxxxxYYYGGGGGGGxxxxxxxxxxxHvvvvvHH.............................................................................................',
  '....WW..............CCCCCCCCCBBBBBBhhhhhBBBBBhhhhhBBBBBB........GGGGGGGGGGGGGHHHHHHGGGGGzzzzzzzzzzzzzYYYGGGGGGGGzzzzzzzzzzHHwwwwwHH.............................................................................................',
  '....WW..YY.......CCCCCCCCCCCCCBBBBhhhhhhhBBBhhhhhhhBBBB.........GGGGGGGGGGGGvHHHHHHGGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxHHvvvvvHH.............................................................................................',
  '.......YY.......CCCCCCCCCCCCCCBBBBBhhhhhBBBBBhhhhhBBBBB........GGGGGGGGGGGGGwHHHHHHGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzHHwwwwwHH..................................................................CC.........................',
  '..............CCCCCCCCCCCCCCCCBBBBBhhhhhBBBBBhhhhhBBBBB........GGGGGGGGGGGGvvHHHHHHGGGGGGGGGGGGGGGGGGGGGGGGHHGGxxxxxxxxxxxHHvvvvvHH........................................HHH......................CC..........................',
  '.............CCCCCCCCCCCCCCCCCBBBBBBBhBBBBBBBBBhBBBBBBB.......GGGGGGGGGGGGGwwwHHHHHGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzHwwwwwHH...................................................YY.........................................',
  '............CCCCCCCCCCCCCCCCCCBBBBBBBBBBBBhBBBBBBBBBBBB......GGGGGGGGGGGGGGvvvHHHHHGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxxCCCvvvHH....................................................YY........................................',
  '...........CCCCCCCCCCCCCCCCCBCCBBBBBBBBBBhhhBBBBBBBBBBBB.....GGGGGGGGGGGGGwwwwHHHHHGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzzHwwwwwHH..............................................................................................',
  '...........CCCCCCCCCCCCCBBBBBBBBBBBBBBBBhhhhhBBBBBBBB.BB....GGGGGGGGGGGGGGvvvvHHHHHWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWHvvvvvHH.........CCC..................................................................................',
  '..........CCCCCCCCCCCCBBBBBBBBBBBBBBBBBBBhhhBBBBBBBBB.......GGGGGGGGGGGGGHwwwwwHHHHWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWwwwwwHH.......CCCCC...................................................................................',
  '.........CCCCCCCCCCCCBBBBBBBBBBBBBBBBBBBBBhBBBBBBBBBB......GGGGGGGGGGGGGG.......WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW.......................................................................................................',
  '.........CCCCCCCCCCCBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB......GGGGGGGGGGGGG........WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW.......................................................................................................',
  '.........CCCCCCCCCCBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB.....GGGGGGGGGGGGGG........WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW.......................................................................................................',
  '........CCCCCCCCCCCBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB.....GGGGGGGGGGGGG.........WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW.....................................................YYY...............................................',
  '........CCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWBWWWWWBBBBB....GGGGGGGGGGGGGG..........WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW......................................................YYY...............................................',
  '........CCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWWWWWWWBBBBB....GGGGGGGGGGGGG............GGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz.........................................................................................................',
  '........CCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWWWWWWWBBBBB...GGGGGGGGGGGGGG............GGGGGGGGGGGGGGGGGGGGGGGWWxxxxxxxxxxxx.........................................................................................................',
  '........CCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWWWWWWWBBBBBWW.GGGGGGGGGGGGG..............GGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz..........................................................................................................',
  '.......CCCCCCCCCCBBBBBBBBBBBBBBBBBBBBWWWWWWWWWWWBBBBBWWGGGGGGGGGGGGGG..............GGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx....HHH...................................................................................................',
  '........CCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWWWWWWWBBBBBWWGGGGGGGGGGGGG...............GGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz..........................................................................................................',
  '........CCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWWWWWWWBBBBBGGGGGGGGGGGGGGG...............GGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx..........................................................................................................',
  '........CCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWWWWWWWBBBBGGGGGGGGGGGGGGG................GGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz..........................................................................................................',
  '........CCCCCCCCCCBBBBBBBBBBBBBBBBBBBBWHHWWWWWWBBBBBGGGGGGGGGGGGGGG................BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB..................................................................BBB.....................................',
  '........CCCCCCCCCCCBBBBBBBBBBBBBBBBBBBWHHWWWWWWBBBBBGGGGGGGGGGGGGG.................BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB..................................................................BBB.....................................',
  '.........CCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWWWWWBBBBBWWWWWWWWGGGG...................BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB...........................HHH............................................................................',
  '.........CCCCCCCCCCCBBBBBBBBBBBBBBBBBBWWWWWWWWWBBBBBWWWWWWWWGGGWW..................BBBBBBBBBBBBHHHHHHHHHHHHHHHHHBBBBBB..........................................................................................................',
  '.........CCCCCCCCCCCCBBBBBBBBBBBBBBBBBWWWWWWWWWBBBBBWWWWWWWWGGGWW..................BBBBBBBBBBBBHHHHHHHHHHHHHHHHHBBBBBB..................................................................YY......................................',
  '..........CCCCCCCCCCCCBBBBWWBBBBBBBBBBBBBBBBBBBBBBBBWWWWWWWGGGGWWW.................BBBBBBBBBBBBHHHHHHHHHHHHHHHHHBBBBBB...................................................................YY.....................................',
  '...........CCCCCCCCCCCCCBBBBBBBBBBBBBBBBBBBBBBBBBBBBWWWWWCCGGGGWWWW................BBBBBBBBBBBBHHHHHHHHHHHHHHHHHBBBBBB..........................................................................................................',
  '...........CCCCCCCCCCCCCCCCCBCCCCBBBBBBBBBBBBBBBBBBBWWWWCCWGGGGWWWW................BBBBBBBBBBBBHHHHHHHHHHHHHHHHHBBBBBB..........................................................................................................',
  '...........GCCCCCCCCCCCCCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWWWGGGGWWWHHH...HH....YYY..BBBBBBBBBBBBHHHHHHHHHHHHHHHHHBBBBBB..........................................................................................................',
  '..........GGGCCCCCCCCCCCCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWWWGGGGWWWWHHH..HH.........BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB..........................................................................................................',
  '.........GGGGGCCCCCCCCCCCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWWWGGGGWWWWWW..............BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB..........................................................................................................',
  '.........GGGGGGGCCCCCCCCCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWWWGGGGWWWWWW..............GGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz..........................................................................................................',
  '........GGGGGGGGGCCCCCCCCCCCCCCCCBBBBBBBBBBBBBBBBBBBWWWWWWGGGGGWWWWWW..............GGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx..........................................................................................................',
  '........GGGGGGGGGGGGCCCCCCCCCCCWWBBBBBBBBBBBBBBBBBWWWWWWWWGGGGGWWWWWWW.............GGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz..........................................................................................................',
  '........GGGGGGGGGGGGGGGGGCGGGGGGGBBBBBBBBBBBBBBBBBGGGGGGGGGGGGWWWWWWWW............GGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx.........................................................................................................',
  '........GGGGGGGGGGGGGGGGGGGGGGGGGGBBBBBBBBBBBBBBBGGGGGGGGGGGGGWWWWWWWW............GGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz.........................................................................................................',
  '.......GGGGGGGGGGGGGGGGGGGGGGGGGGGBBBBBBBBBBBBBBBGGGGGGGGGGGGGWWWWWWWW...........GGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx........................................................................................................',
  '........GGGGGGGGGGGGGGGGGGGGGGGGGGGBBBBBBBBBBBBBGGGGGGGGYYYGGGWWWWWWWW...........GGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz........................................................................................................',
  '.......YYGGGGGGGGGGGGGGGGGGGGCCCCWWCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWW..........GGGGGGGGGGGGGGGGGGGGGGGGGCCCxxxxxxxxxxxxx.......................................................................................................',
  '.......YYGGGGGGGGGGGGGGGGGGGGCCCCWWCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWW..........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz.......................................................................................................',
  '........GGGGGGGGGGGGGGGGGGGGGCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWW.........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx.................BBB...............................YY..................................................',
  '.........GGGGGGGGGGGGGGGGGGGCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWW.........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz................BBB...............................YY..................................................',
  '.........GGGGGGGGGGGGGGGGGGGCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWW.........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx......................................................................................................',
  '..........GGGGGGGGGGGGGGGGGCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWW........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz.....................................................................................................',
  '...........GGGGGGGGGGGGGGGCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWW........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx...............HH....................................................................................',
  '............GGGGGGGGGGGGGCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWW........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz..................YY.................................................................................',
  '..............GGGGGGGGGWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWW.......GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx.................YY.................................................................................',
  '...............WWWGWWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWWW.......GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz..........................................................BBB.......................................',
  '...............CCWWWWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWW........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx....................................................................................................',
  '................WWWWWWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWWW.......GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz.........................................................................BBB.......................',
  '................WWWWWWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWWW.......GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx...................................................................................................',
  '.................WWWWWWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWWW........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz...................................................................................................',
  '.................WWWWWWWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWWWW.......GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx..................................................................................................',
  '..................WWWWWWWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWWWW........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz..................................................................................................',
  '..................WWWWWWWWWWWWCCCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWWWWW........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGBBGGGGGGxxxxxxxxxxxx..................CC..............................................................................',
  '...................WWWWWWWWWWWWCCCCCCCCCCCCCCCCCCCCCCCWWWWWWWWWWWW........GGGGGGGGGGGGGGGGWWGGGGGGGGGGGGGGBBGGGGGGGzzzzzzzzzzzz.................................................................................................',
  '....................WWWWWWWWWWWWCCCCCCCCCCCCCCCCCCCCCWWWWWWWWWWWW.........GGGGGGGGGGGGGGGGWWGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx.................................................................................................',
  '....................WWWWWWWWWWWWWWCCCCCCCCCCCCCCCCCWWWWWWWWWWWWWW.........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz.................................................................................................',
  '.....................WWWWWWWWWWWWWWWCCCCCCCCCCCCCWWWWWWWWWWWWWWW..........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxxxxxx.................................................................................................',
  '......................WWWWWWWWWWWWWWWWWWWWCWWWWWWWWWWWWWWWWWWWW..........GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzzzzzz................................................................................................',
  '.......................WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW...........GGGGGGGGGGGGGGGGGGGGGGGGGxxxxxGGGGGGGGGGGGGxxxxxxxxxxxx........................CC......................................................................',
  '........................WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW............GGGGGGGGGGGGGGGGGGGGGGGGGzzzzzGGGGGGGGGGGGGzzzzzzzzzzzz................................................................................................',
  '.........................WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW.............GGGGGGGGGGGGGGGGGGGGGGGGGxxxxxGGGGGGGGGGGGGxxxxxxxxxxxx................................................................................................',
  '...........................WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW..............GGGGGGGGGGGGGGGGGGGGGGGGGHHHzzzGGGGGGGGGGGGGzzzzzzzzzzzzz............................................YY.................................................',
  '................xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...GGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxGGGGGGGGGGGGGGxxxxxxxxxxxx............................................YY........................BB.......................',
  '................zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz...GGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzGGGGGGGGGGGGGGzzzzzzzzzzzz.......................................................................BB......................',
  '................xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...GGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxGGGGGGGGGGGGGGxxxxxxxxxxxx...............................WWW.............................................................',
  '................zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz...GGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzGGGGGGGGGGGGGGzzzzzzzzzzzz...............................WWW.............................................................',
  '................xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..GGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxGGGGGGGGGGGGGGGxxxxxxxxxxxx..............................................................................................',
  '................zzzzzzzzzCCzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz..GGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzGGGGGGGGGGGGGGGzzzzzzzzzzzz..............................................................................................',
  '................xxxxxxxxCCxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..GGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxGGGGGGGGGGGGGGGxxxxxxxxxxxx..............................................................................................',
  '................zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz..GGGGGGGGGGGGGGGGGGGGGGGGGGHHzzzzGGGGGGGGGGGGGGGzzzzzzzzzzzz..............................................................................................',
  '.......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxGGGGGGGGGGGGGGGxxxxxxxxxxxx..............................................................................................',
  '.......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzGGGGGGGGGGGGGGGzzzzzzzzzzzz..............................................................................................',
  '.......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxGGGGGGGGGGGGGGGxxxxxxxxxxxx...................................YY.........................................................',
  '.......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzGGGGGGGGGGGGGGGzzzzzzzzzzzz....................................YY........................................................',
  '..........................................BB...........................GGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxGGGGGGGGGGGGGGGxxxxxxxxxWWx............................................................................BB................',
  '..........................................BB..........................GGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzGGGGGGGGGGGGGGGzzzzzzzzzzzzz............................................................................BB...............',
  '......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxGGGGGGGGGGGGGGGGxxxxxxxxxxxx.............................................................................................',
  '......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzGGGGGGGGGGGGGGGGzzzzzzzzzzzz.............................................................................................',
  '......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxGGHHGGGGGGGGGGGGxxxxxxxxxxxx.............................................................................................',
  '......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzGHHGGGGGGGGGGGGGzzzzzzzzzzzz.CC..........................................................................................',
  '......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxGGGGGGGGGGGGGGGGxxxxxxxxxxxxCC...........................................................................................',
  '......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzGGGGGGGGGGGGGGGzzzzzzzzzzzz.............................................................................................',
  '......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxGGGGGGGGGGGGGGGxxxxxxxxxxxx.............................................................................................',
  '......................CC..............................................GGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzGGGGGGGGGGGGGGGzzzzzzzzzzzz.............................................................................................',
  '......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGxxxxxxxGGGGGGGGGGGGGGGxxxxxxxxxxxx.............................................................................................',
  '......................................................................GGGGGGGGGGGGGGGGGGGGGGGGGGGzzzzzzzGGGGGGGGGGGGGGGzzzzzzzzzzzz.............................................................................................',
];
// 目はスプライトで顔の上に置く。絵に描き込むとディザに混ざって
// つぶれてしまうので、小さいまま はっきり見せたいものだけ分けてある
// 青い裂け目の縦の真ん中を、白く光らせて補うスプライト。
// レイヤーの走査線で半分の行が消えるので、そのぶんの明るさをここで足す。
// 上下へ細くなる紡すい形
const riftGlow = (() => {
  // 背景の裂け目と同じ中心線をたどって、同じように くねらせる。
  // まっすぐな帯だと背景から浮いてしまう
  const W = 32, H = 64, img = createImage(W, H);
  const { line, TOP, SPAN } = endRiftLine;
  const Y0 = TOP + Math.round((SPAN - H) / 2);   // 裂け目の中ほどを切り出す
  const CX = 112;                                 // 裂け目の絵の中心
  for (let y = 0; y < H; y++) {
    // 絵のほうと同じく 1 ライン おきに抜いておく。
    // スプライトは走査線の対象外なので、開けておかないとここだけ浮いてしまう
    if ((y & 1) === 0) continue;
    const [lx] = line[Math.min(line.length - 1, Y0 + y)] || [CX, 0];
    const t = Math.sin((Math.PI * (y + 0.5)) / H);
    const w = Math.pow(t, 1.4) * 5;
    const cx = W / 2 + (lx - CX);                 // 背景と同じだけ左右へずらす
    for (let x = -w; x <= w; x++) {
      const core = Math.abs(x) < w * 0.45;
      setPixel(img, Math.round(cx + x), y, hex(core ? '#ffffff' : '#65dbef'));
    }
  }
  return img;
})();

const pilotEye = fromAscii([
  '..####..',
  '.######.',
  '#WW#####',
  '#WW#####',
  '########',
  '.######.',
  '..####..',
  '........',
], { '#': '#20308f', W: '#ffffff' });
const pilotWink = fromAscii([
  '........',
  '........',
  '#.....#.',
  '.#...#..',
  '..###...',
  '........',
  '........',
  '........',
], { '#': '#20308f' });

// 笑った口。絵に描き込むとディザでつぶれるので目と同じくスプライトで置く。
// 顔を少し右へ振っているぶん、右がわの上がりを短くして自然な笑顔にする
const pilotSmile = fromAscii([
  '................',
  '................',
  '.##...........#.',
  '..##.........##.',
  '...###.....###..',
  '.....######.....',
  '................',
  '................',
], { '#': '#b95e51' });

// ひとみ。絵のほうに置いた 1 ドットの点の上に重ねる、5x5 のふつうの丸。
// (絵の点は残したまま、スプライトで大きさと丸みを足す)
const pilotPupil = fromAscii([
  '.###.',
  '#####',
  '#####',
  '#####',
  '.###.',
], { '#': '#000000' });

// 飴ちゃん。未実装さんを見逃すと置いていく。
// 取っても何も起きない(ねぎらいの品)。ひねった包み紙の形にする
const candyItem = fromAscii([
  '................',
  '................',
  '.#............#.',
  '.##..........##.',
  '.###...####...##',
  '.####.######.###',
  '..###WWWWWWWW###',
  '...##WW####WW##.',
  '...##WW####WW##.',
  '..###WWWWWWWW###',
  '.####.######.###',
  '.###...####...##',
  '.##..........##.',
  '.#............#.',
  '................',
  '................',
], { '#': '#ff897d', W: '#65dbef' });

const pilot = fromAscii(PILOT_ART, {
  ...PILOT_COLORS,
  ...Object.fromEntries(Object.entries(PILOT_MID_CH)
    .map(([ch, [key, n]]) => [ch, VDP_HEX[PILOT_MID[key][n ? 'odd' : 'even']]])),
});

// ひとつ前の案(図形を組み合わせて描いた正面の姿)。
// いまは使っていないが、戻せるようデータとして残してある。
const pilotFront = (() => {
  const W = 128, H = 160, img = createImage(W, H);
  const HAIR = '#ccc35e', HAIR_D = '#b95e51';
  const SKIN = '#ff897d', BLUSH = '#db6559';
  const SUIT = '#cccccc', SUIT_W = '#ffffff', SUIT_D = '#7c7c7c';
  const GLASS = '#65dbef';
  const ACC = '#db6559', ACC2 = '#3eb849';
  const EYE = '#20308f';
  const BELT = '#5955e0';

  // ---- 体(宇宙服) ----
  fillPoly(img, [[10, 160], [26, 100], [92, 100], [112, 160]], SUIT);
  for (let y = 116; y < 160; y += 12) capsule(img, 30, y, 90, y, 2, SUIT_D);
  rect(img, 46, 108, 34, 22, SUIT_D);            // 胸のパネル
  rect(img, 50, 112, 26, 14, '#3a3a3a');
  rect(img, 53, 115, 6, 4, ACC);
  rect(img, 63, 115, 6, 4, ACC2);
  rect(img, 53, 121, 14, 3, GLASS);
  rect(img, 22, 142, 84, 8, BELT);               // 腰のベルト
  // 首まわりのリング(ヘルメットを付けるところ)
  rect(img, 46, 88, 38, 14, SUIT_W);
  rect(img, 44, 93, 42, 5, SUIT_D);

  // ---- 振っている手(右) ----
  capsule(img, 86, 106, 106, 74, 11, SUIT);
  capsule(img, 106, 74, 114, 46, 9, SUIT_W);
  disc(img, 116, 34, 13, SUIT_W);
  for (const [fx, fy] of [[106, 22], [113, 18], [121, 19], [127, 25]]) {
    capsule(img, fx, fy + 10, fx, fy, 4, SUIT_W);
  }
  capsule(img, 104, 48, 124, 44, 3, SUIT_D);

  // ---- 抱えているヘルメット(左手で腰に抱える) ----
  disc(img, 26, 128, 24, SUIT_W);                // ドームの外枠
  disc(img, 26, 128, 19, GLASS);                 // ガラス
  capsule(img, 10, 120, 22, 112, 3, SUIT_W);     // 映り込み
  rect(img, 6, 138, 40, 6, SUIT_D);              // 首のリング
  // それを抱える腕
  capsule(img, 30, 104, 22, 124, 10, SUIT);
  disc(img, 20, 130, 9, SUIT_W);                 // グローブ

  // ---- 髪(顔より先に置く) ----
  ellipse(img, 58, 52, 37, 40, HAIR);
  capsule(img, 24, 56, 30, 100, 8, HAIR);        // 横の毛束
  capsule(img, 92, 56, 86, 100, 8, HAIR);
  capsule(img, 22, 82, 28, 104, 5, HAIR_D);      // 毛先
  capsule(img, 94, 82, 88, 104, 5, HAIR_D);

  // ---- 顔 ----
  ellipse(img, 58, 62, 26, 27, SKIN);
  // 前髪(顔の上にかぶせる)
  ellipse(img, 58, 36, 32, 16, HAIR);
  for (let k = 0; k < 5; k++) {
    const x = 34 + k * 12;
    capsule(img, x, 40, x + 4, 52 + (k % 2) * 4, 5, HAIR);
  }
  // 目。右(向かって右)はぱっちり、左はウインク
  ellipse(img, 71, 64, 7, 9, EYE);
  ellipse(img, 69, 61, 3, 3, SUIT_W);            // 目の光
  // ウインクは下に凸のカーブ
  for (let x = 38; x <= 54; x++) {
    const t = (x - 46) / 8;
    const y = 66 - Math.round(4 * (1 - t * t));
    for (let d = 0; d < 3; d++) setPixel(img, x, y + d, hex(EYE));
  }
  // ほお
  ellipse(img, 40, 76, 6, 4, BLUSH);
  ellipse(img, 76, 76, 6, 4, BLUSH);
  // 笑った口
  for (let x = 52; x <= 66; x++) {
    const t = (x - 59) / 7;
    const y = 84 + Math.round(3 * (1 - t * t));
    for (let d = 0; d < 2; d++) setPixel(img, x, y + d, hex(HAIR_D));
  }
  return img;
})();

const pilotBig = scanlines(pilot);

// ひとつ前の案のパイロット(体は斜め向き・顔だけこちらへ振り返る姿)。
// いまは画面に出していないが、いつでも戻せるようデータとして残してある。
const pilotTurn = (() => {
  const W = 128, H = 176, img = createImage(W, H);
  const HAIR = '#ccc35e', HAIR_D = '#b95e51';
  const SKIN = '#ff897d', BLUSH = '#db6559';
  const SUIT = '#cccccc', SUIT_W = '#ffffff', SUIT_D = '#7c7c7c';
  const GLASS = '#65dbef';
  const ACC = '#db6559', ACC2 = '#3eb849';
  const EYE = '#20308f';
  const BELT = '#5955e0';

  // ---- 体。斜めを向いているので、肩幅を狭く見せて右へ傾ける ----
  fillPoly(img, [[30, 176], [40, 104], [90, 100], [108, 176]], SUIT);
  for (let y = 118; y < 176; y += 12) capsule(img, 44, y, 100, y + 3, 2, SUIT_D);
  // 背中側(向こう側)の肩は一段暗くして、奥行きを出す
  fillPoly(img, [[86, 104], [98, 102], [110, 176], [96, 176]], SUIT_D);
  rect(img, 52, 116, 30, 20, SUIT_D);            // 胸のパネル(斜めなので右寄り)
  rect(img, 56, 120, 22, 12, '#3a3a3a');
  rect(img, 59, 123, 5, 4, ACC);
  rect(img, 67, 123, 5, 4, ACC2);
  capsule(img, 40, 150, 104, 154, 5, BELT);      // 腰のベルト
  // 首まわりのリング(斜め)
  fillPoly(img, [[46, 96], [86, 92], [88, 104], [48, 108]], SUIT_W);
  fillPoly(img, [[46, 102], [88, 98], [88, 103], [47, 107]], SUIT_D);

  // ---- 振っている手(右) ----
  capsule(img, 88, 108, 108, 74, 11, SUIT);
  capsule(img, 108, 74, 115, 46, 9, SUIT_W);
  disc(img, 117, 34, 13, SUIT_W);
  for (const [fx, fy] of [[107, 22], [114, 18], [122, 19], [127, 25]]) {
    capsule(img, fx, fy + 10, fx, fy, 4, SUIT_W);
  }
  capsule(img, 105, 48, 125, 44, 3, SUIT_D);

  // ---- 抱えているヘルメット(左手) ----
  disc(img, 26, 136, 23, SUIT_W);
  disc(img, 26, 136, 18, GLASS);
  capsule(img, 12, 128, 22, 121, 3, SUIT_W);     // 映り込み
  rect(img, 8, 145, 38, 6, SUIT_D);
  capsule(img, 44, 110, 30, 130, 10, SUIT);      // 抱えている腕
  disc(img, 24, 136, 9, SUIT_W);                 // グローブ

  // ---- 頭。体より少し左に置いて「振り返っている」ように見せる ----
  ellipse(img, 62, 50, 34, 38, HAIR);
  ellipse(img, 78, 56, 22, 30, HAIR);            // 後頭部のふくらみ
  capsule(img, 84, 60, 92, 104, 8, HAIR);        // 背中へ流れる髪
  capsule(img, 88, 78, 94, 106, 5, HAIR_D);
  capsule(img, 32, 58, 36, 96, 7, HAIR);         // こちら側の毛束
  capsule(img, 30, 80, 34, 100, 5, HAIR_D);

  ellipse(img, 54, 60, 24, 26, SKIN);            // 顔(左寄り = こちらを向いている)
  ellipse(img, 56, 36, 30, 15, HAIR);            // 前髪
  for (let k = 0; k < 5; k++) {
    const x = 34 + k * 11;
    capsule(img, x, 40, x + 3, 50 + (k % 2) * 4, 5, HAIR);
  }
  // 目。向かって右はぱっちり、左はウインク
  ellipse(img, 66, 62, 6, 8, EYE);
  ellipse(img, 64, 59, 3, 3, SUIT_W);
  for (let x = 38; x <= 52; x++) {
    const t = (x - 45) / 7;
    const y = 64 - Math.round(4 * (1 - t * t));
    for (let d = 0; d < 3; d++) setPixel(img, x, y + d, hex(EYE));
  }
  // ほおと、笑った口
  ellipse(img, 40, 74, 6, 4, BLUSH);
  ellipse(img, 70, 74, 5, 4, BLUSH);
  for (let x = 48; x <= 62; x++) {
    const t = (x - 55) / 7;
    const y = 82 + Math.round(3 * (1 - t * t));
    for (let d = 0; d < 2; d++) setPixel(img, x, y + d, hex(HAIR_D));
  }
  return img;
})();
const pilotTurnBig = scanlines(pilotTurn);

// ---- スタッフロールの背景に置く星座 ----
// 骨組みを「点をつないだ線」で渡すと、頂点に星を置いた星座の絵を作る。
//
// 横 8 ドット 2 色を守るために、星のまわりでは線を消してある
// (星のある 8 ドットには「星の色 + 透明」しか入らない)。
// 星座の線が星の手前で途切れるのは、星座早見盤の描き方そのものでもある。
//
// @param {number[][][]} paths 折れ線の配列。頂点がそのまま星になる
// @param {{w,h,tilt?,cx?,cy?}} opts tilt はラジアン(傾けたいとき)
function makeConstellation(paths, opts) {
  const { w: W, h: H, tilt = 0, cx: CX = W / 2, cy: CY = H / 2 } = opts;
  const img = createImage(W, H);
  const LINE = hex('#20308f');     // 星をつなぐ線(暗い青)
  const STAR = hex('#ffffff');     // ふつうの星
  const STAR_B = hex('#65dbef');   // 明るい星(水色)

  const put = ([x, y]) => {
    const dx = x - CX, dy = y - CY;
    return [Math.round(CX + dx * Math.cos(tilt) - dy * Math.sin(tilt)),
      Math.round(CY + dx * Math.sin(tilt) + dy * Math.cos(tilt))];
  };
  // 線は 1 ドット。星は線を引いたあとで上に置く
  const line = ([x0, y0], [x1, y1]) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) {
      setPixel(img, Math.round(x0 + (x1 - x0) * i / n),
        Math.round(y0 + (y1 - y0) * i / n), LINE);
    }
  };
  const stars = [];
  for (const path of paths) {
    const pts = path.map(put);
    for (let i = 0; i < pts.length - 1; i++) line(pts[i], pts[i + 1]);
    for (const p of pts) stars.push(p);
    // 長い線の途中にも星を足して、星座らしく粒を増やす
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      if (Math.hypot(x1 - x0, y1 - y0) < 40) continue;
      stars.push([Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)]);
    }
  }
  // 星を置く。近すぎる星は 1 つにまとめる
  const placed = [];
  for (const [sx, sy] of stars) {
    if (placed.some(q => Math.abs(q[0] - sx) < 10 && Math.abs(q[1] - sy) < 6)) continue;
    // 3 つに 1 つだけ大きい水色の星にして、明るさに差を付ける
    const big = placed.length % 3 === 0;
    placed.push([sx, sy]);
    const c = big ? STAR_B : STAR;
    const r = big ? 2 : 1;
    // まず星のまわりの線を消す。横は 8 ドットぶんより広く取る
    for (let y = sy - r; y <= sy + r; y++) {
      for (let x = sx - 10; x <= sx + 10; x++) clearPixel(img, x, y);
    }
    // 十字に光らせる(丸より星らしく見える)
    for (let d = -r; d <= r; d++) {
      setPixel(img, sx + d, sy, c);
      setPixel(img, sx, sy + d, c);
    }
    if (big) { setPixel(img, sx - 1, sy - 1, c); setPixel(img, sx + 1, sy + 1, c); }
  }
  return img;
}

// ---- スタッフロールの背景に流す星座 4 つ ----
// 大きさをそろえず、図柄も向きもばらばらにしてある。
// どれも「まっすぐ」「左右対称」を避けてある(そろっていると星座に見えない)。

// 1. くじら。空を泳いでいくように右上へ向かう
const whaleStar = makeConstellation([
  // 背中。ほぼ平らで、尾に向かって細くなっていく
  [[8, 72], [22, 58], [50, 48], [88, 46], [124, 52], [152, 62]],
  // 腹。頭のほうを深くふくらませ、尾へ向けてしぼる(背中と形をそろえない)
  [[8, 72], [14, 92], [40, 108], [78, 112], [114, 100], [152, 62]],
  // 口(頭の中を短く切る 1 本)
  [[8, 72], [26, 80], [48, 84]],
  // 尾びれ。上の葉は大きく、下の葉は小さく開いたまま閉じない
  [[152, 62], [182, 40], [190, 52], [160, 64]],
  [[152, 62], [178, 80], [186, 72]],
  // 胸びれ(片方だけ。もう片方は向こう側で見えない)
  [[56, 106], [58, 128], [80, 120]],
  // 潮吹き(2 本に分かれて散る)
  [[30, 44], [26, 22], [16, 8]],
  [[26, 22], [40, 10]],
], { w: 200, h: 136 });

// 最終面に流れてくる「そらのドラゴン」。1 画面(256x192)に入りきらない大きさ。
// 顔のあたりを撃つと、力を分けてくれる。
// 顔の中心は下の DRAGON_SKY_FACE に書いてある(ゲーム側の当たり判定に使う)
const dragonSky = makeConstellation([
  // 頭。角のある四角い顔
  [[92, 22], [128, 12], [156, 30], [136, 54], [100, 48], [92, 22]],
  [[96, 8], [110, -2], [120, 10]],                     // 左の角
  [[142, 6], [156, -4], [164, 10]],                    // 右の角
  [[104, 34], [118, 30]],                              // 目のあたり
  [[136, 32], [148, 28]],
  // 首から胴。大きくうねらせる
  [[136, 54], [150, 92], [120, 124], [138, 164], [178, 186], [214, 176]],
  [[214, 176], [232, 208], [206, 244], [162, 258], [120, 246]],
  [[120, 246], [86, 268], [70, 306], [96, 338], [140, 348]],
  // しっぽ
  [[140, 348], [180, 362], [206, 388], [216, 416]],
  [[206, 388], [232, 396]],
  // 背びれ(胴の内がわに沿わせる)
  [[150, 92], [176, 84], [196, 96]],
  [[138, 164], [166, 148], [190, 160]],
  [[162, 258], [148, 288], [166, 312]],
  // 手足
  [[120, 124], [78, 130], [52, 156]],
  [[178, 186], [212, 148], [244, 152]],
  [[86, 268], [44, 262], [20, 286]],
  [[96, 338], [58, 350], [36, 380]],
], { w: 256, h: 430 });
// 画面に対して大きすぎたので 2/3 に縮める
const dragonSkySmall = scaleDown(dragonSky, 3, 2);
// 顔の中心(絵の中の座標)と、撃てる四角の大きさ
// 顔の位置も 2/3 に合わせる
const DRAGON_SKY_FACE = { x: Math.round(124 * 2 / 3), y: Math.round(32 * 2 / 3), size: 20, need: 16 };

/** ドラゴンの顔のアイテム。取るとフルパワー */
const dragonItem = fromAscii([
  '..##........##..',
  '.####......####.',
  '.##############.',
  '################',
  '##..##....##..##',
  '##..##....##..##',
  '################',
  '#..############.',
  '#.##.######.##..',
  '..#..######..#..',
  '...############.',
  '....##....##....',
  '.....######.....',
  '................',
], { '#': '#3eb849' });

// 2. とり。翼を広げて左下へ滑空している。いちばん小さい
const birdStar = makeConstellation([
  [[10, 40], [30, 46], [52, 52], [78, 62], [96, 78]],        // 頭から背へ
  [[30, 46], [38, 60], [58, 70], [78, 62]],                  // 胸のふくらみ
  [[52, 52], [62, 24], [86, 8], [110, 12]],                  // 上の翼(長い)
  [[110, 12], [96, 30], [74, 44], [52, 52]],
  [[62, 70], [70, 96], [92, 112], [116, 108]],               // 下の翼(短い)
  [[116, 108], [100, 92], [80, 78], [62, 70]],
  [[96, 78], [124, 86], [140, 96]],                          // 尾
  [[96, 78], [122, 100]],
], { w: 150, h: 122 });

// 3. りゅう。長い体をうねらせ、頭を左上へもたげている。いちばん大きい
const dragonStar = makeConstellation([
  [[22, 26], [44, 20], [58, 32], [46, 44], [26, 40], [22, 26]],   // 頭
  [[24, 14], [36, 4], [46, 12]],                                  // つの
  [[46, 44], [60, 66], [50, 92], [66, 118], [96, 128], [126, 118]],  // うねる胴
  [[126, 118], [152, 100], [170, 110], [178, 134], [160, 148]],      // しっぽへ
  [[50, 92], [24, 100], [10, 116]],                               // 前あし
  [[96, 128], [92, 150], [76, 146]],                              // 後ろあし
  [[66, 118], [86, 96], [116, 88], [138, 96]],                    // 背びれ
], { w: 190, h: 156 });

// 4. ふね。帆をふくらませて右へ進む
const shipStar = makeConstellation([
  [[10, 76], [30, 88], [80, 90], [104, 74]],                 // 船体
  [[10, 76], [104, 74]],                                     // 甲板
  [[52, 74], [50, 16]],                                      // マスト
  [[50, 16], [86, 40], [54, 46]],                            // 上の帆
  [[50, 46], [88, 66], [54, 70]],                            // 下の帆
  [[50, 16], [16, 44], [48, 48]],                            // 逆の小さい帆
  [[104, 74], [118, 60]],                                    // 船首の飾り
], { w: 130, h: 104 });

// ---- エンディング曲 ----
// エルガー「愛の挨拶(Salut d'amour) Op.12」のチップチューン編曲。
// 2/4 のアンダンティーノ。1 小節 = 4 分音符 2 つぶんで書いてある。
// (原曲はホ長調だが、鳴らしやすいハ長調に置き換えてある)
const SALUT_MELODY = [
  'o5 g4 >c4', 'o5 b4. a8', 'g4 e4', 'f2',
  'e4 a4', 'g4. f8', 'e4 d4', 'c2',
  'a4 >d4', 'o6 c4. o5 b8', 'a4 f4', 'g2',
  // ここから終わりの 4 小節。半音下げの音を混ぜて泣きを作る
  'e4 a4', 'g4. g-8', 'f4 e-4', 'e2',
].join(' ');

// 和音は 1 チャンネル 1 声で、3 本使ってちゃんと鳴らす。
// 基本は調の中の和音で素直に進み、調の外の音は 2 か所だけ。
// どの和音も主旋律の音を必ず含むので濁らない。
//   1 Cmaj7 | 2 G9 | 3 C7(!) | 4 Fmaj7 | 5 Am7 | 6 F | 7 Em7 | 8 Cmaj7
//   9 D7(!) | 10 G7sus4-G7 | 11 Dm7 | 12 G7 | 13 Am7 | 14 Am7 | 15 G7 | 16 Cmaj9
const SALUT_CH_A = [
  'o3 b2', 'o3 b2', 'o3 a+2', 'o3 a2',
  'o3 g2', 'o3 a2', 'o3 b2', 'o3 b2',
  'o3 a2', 'o4 c4 o3 b4', 'o3 a2', 'o3 b2',
  'o3 g2', 'o3 g2', 'o3 a-2', 'o3 b2',
].join(' ');
const SALUT_CH_B = [
  'o3 g2', 'o3 f2', 'o3 g2', 'o3 f2',
  'o3 e2', 'o3 f2', 'o3 g2', 'o3 g2',
  'o3 f+2', 'o3 g2', 'o3 f2', 'o3 g2',
  'o3 e2', 'o3 e2', 'o3 f2', 'o3 g2',
].join(' ');
const SALUT_CH_C = [
  'o3 e2', 'o3 d2', 'o3 e2', 'o3 c2',
  'o3 c2', 'o3 c2', 'o3 d2', 'o3 e2',
  'o3 c2', 'o3 f2', 'o3 c2', 'o3 f2',
  'o3 c2', 'o3 c2', 'o3 d2', 'o3 e2',
].join(' ');

// サロン風の低音。「ぼん・ちゃっ」と 2 拍で刻む
const SALUT_BASS = [
  'o2 c4 o3 g4', 'o2 g4 o3 d4', 'o2 c4 o3 g4', 'o2 f4 o3 c4',
  'o2 a4 o3 e4', 'o2 f4 o3 c4', 'o2 e4 o3 b4', 'o2 c4 o3 g4',
  'o2 d4 o3 a4', 'o2 g4 o3 d4', 'o2 d4 o3 a4', 'o2 g4 o3 d4',
  'o2 a4 o3 e4', 'o2 a4 o3 e4', 'o2 g4 o3 d4', 'o2 c4 o3 g4',
].join(' ');

const BGM_SALUT = [
  // 主旋律。ビブラートとエコーで弦のように歌わせる(少し音量を下げてある)
  "t100 q7 v11 l8 @{pulse50} @e{soft} @v5 @s4 " + SALUT_MELODY,
  // 低音
  't100 q6 v11 l8 @{saw} @e{flat} ' + SALUT_BASS,
  // 和音は 3 本のチャンネルで鳴らす。25% パルスでギターに寄せる
  't100 q7 v10 l8 @{pulse25} @e{soft} @s2 ' + SALUT_CH_A,
  't100 q7 v9 l8 @{pulse25} @e{soft} ' + SALUT_CH_B,
  't100 q7 v9 l8 @{pulse25} @e{soft} ' + SALUT_CH_C,
];

// ---------------------------------------------------------------- 書き出し

// スプライトはすべて 16x16 にそろえる(小さい絵は中央に収める)
// 「押すと次へ進めます」を伝える 8x8 の合図。文字は出さない。
// 下向きの三角が浮いて沈み、いちばん下で少しつぶれる。
// この動きだけで「押してほしそう」に見せる。
const guiNext = [
  ['........', '........', '.CCCCCC.', '.CCCCCC.', '..CCCC..', '...CC...', '........', '........'],
  ['........', '........', '........', '.CCCCCC.', '.CCCCCC.', '..CCCC..', '...CC...', '........'],
  ['........', '........', '........', '........', '.CCCCCC.', '.CCCCCC.', '..CCCC..', '...CC...'],
  ['........', '........', '........', '........', 'WWWWWWWW', '.WWWWWW.', '..WWWW..', '........'],
].map(rows => fromAscii(rows, { C: '#65dbef', W: '#ffffff' }));

const images = {
  player, enemyA, enemyB, enemyC, enemyF, enemyG, enemyH, enemyI, enemyJ,
  glower0, glower1, glower2, weight16t, kingWaveL, kingWaveM, kingWaveS, warper, cube, bouncer, rammer, logo, station, jupiter, saturn, colony, moai, moaiFlip, asteroid, earth, earthBig, blackhole,
  bulletP: pad16(bulletP), bulletE: pad16(bulletE), bulletRing,
  item: pad16(item), star: pad16(star), bomb: pad16(bomb),
  speedUp: pad16(speedUp), rapidUp: pad16(rapidUp), oneUp: pad16(oneUp),
  powerUp: pad16(powerUp), barrierItem: pad16(barrierItem), barrier,
  coinItem: pad16(coinItem), autoItem: pad16(autoItem), candyItem,
  talkBubble,
  flameSmall, flameSmallB, flameBig, flameBigA, flameBigB,
  flameDragon, flameDragonA, flameDragonB,
  bossHead, bossHead2, bossShip,
  bossEye: pad16(bossEye), bossEye2: pad16(bossEye2),
  // 黒目を寄せた目(右下 4 分の 1 ぶん。残りは反転で作る)
  ...Object.fromEntries(Object.entries(eyeLookFrames).map(([k, v]) => [k, pad16(v)])),
  ...Object.fromEntries(Object.entries(eyeLookLens).map(([k, v]) => [k, pad16(v)])),
  octoHand: pad16(octoHand), octoMouth: pad16(octoMouth), ufoGuard: pad16(ufoGuard),
  ufoFist: pad16(ufoFist), todoFace, todoBlush, todoGlint,
  gearBlock, gearGem, gearSpark1, gearWeak0, gearWeak1, nautilus, nautilusHurt,
  pilotEye, pilotWink, pilotSmile, pilotPupil, riftGlow,
  spark0, spark1, spark2, guiNext0: guiNext[0], guiNext1: guiNext[1],
  guiNext2: guiNext[2], guiNext3: guiNext[3], pilot, pilotBig, pilotTurnBig, whaleStar, birdStar, dragonStar, shipStar,
  dragonSky: dragonSkySmall, dragonItem: pad16(dragonItem),
  endRift0: endRiftGrow[0], endRift1: endRiftGrow[1], endRift2: endRiftGrow[2],
  shootStar0, shootStar1, shootStar2, shootStar3,
  moaiFront, moaiFrontBlue, moaiTL, moaiTR, moaiBL, moaiBR, moaiTop, moaiBottom,
  moaiTLb, moaiTRb, moaiBLb, moaiBRb, moaiTopB, moaiBottomB,
  ...moaiWaveCrops,
  ...Object.fromEntries(moaiBlueSteps.map((img, i) => ['moaiWaveB' + (i + 1), img])),
  ...Object.fromEntries(moaiGreenSteps.map((img, i) => ['moaiWaveG' + (i + 1), img])),
  crabR, crabRNo, crabTilt, crabClaw, crabClawBig, crabClawStub, crabClawMid, crabPod, crabLeg, crabLegMid, crabLegExt, fireBall, fireBall1, fireBall2, fireS0, fireS1, fireM0, fireM1,
  dragonHead, dragonHeadOpen, dragonBody, dragonTail, octoArms, octoCrown, crabBigClaw, rocketHi,
  chargeOrb0, chargeOrb1, chargeOrb2, chargeRing0, chargeRing1, chargeRing2, asteroidHi,
  chick0, chick1,
  rocketAlt, rocketGlow, rocketGlowAlt, rocketFlame0, rocketFlame1, rocketFlame2, rocketFlame3, eyeball, eyeVein, eyeIris0, eyeIris1, eyeIris2, eyeIris3, rocket,
  boom0, boom1, boom2, starsFar, starsMid, starsNear, nebula, nebulaRed, moon,
  milkyway, debris,
  kingRift0, kingRift1, kingRift2, kingRiftBlue, kingRiftBlueThin, endRift, endBase,
  kingCracks0, kingCracks1, kingCracks2,
  ...Object.fromEntries(kingLinesLong.map((img, i) => ['kingLineL' + i, img])),
  ...Object.fromEntries(kingRiftOpen.map((img, i) => ['kingRiftOpen' + i, img])),
  kingMan00, kingMan00b, kingMan01, kingMan01b, kingMan02, kingMan04, kingMan05, kingMan05b,
  kingMan06, kingMan06b, kingMan07, kingMan08, kingMan09, kingMan10, kingMan11, kingMan12,
  ...Object.fromEntries(kingLines.map((img, i) => ['kingLine' + i, img])),
};

// ---------------------------------------------------------------- 絵素材のチェック

// MSX1 (SCREEN2) の 15 色。makedata 側でも同じ表を使って、
// 「素材の時点で 横8ドット2色(背景色込み) を守れているか」を検査する。

// BG(レイヤー)に描く素材。これらは「横8ドット2色」を守る必要がある。
// それ以外はスプライトなので、単色 or 2色スプライトとして使えるかを見る。
const BG_IMAGES = new Set([
  'logo', 'station', 'moon', 'nebula', 'starsFar', 'starsMid', 'starsNear',
  'jupiter', 'saturn', 'colony', 'earthBig', 'nebulaRed', 'moai', 'moaiFlip', 'earth', 'blackhole', 'milkyway', 'debris',
  'bossHead', 'bossHead2', 'bossShip', 'asteroid',
  'rocketGlow', 'rocketGlowAlt', 'rocketAlt', 'endRift0', 'endRift1', 'endRift2',
  // BG スプライトとして使う絵(レイヤーと同じ決まりで見えるので、ここに入れる)
  'nautilus', 'nautilusHurt', 'gearBlock', 'gearWeak0', 'gearWeak1', 'gearGem',
  'crabClawBig', 'crabClawMid', 'kingRiftBlueThin', 'shootStar0', 'dragonTail',
  // モアイの BG スプライト(合体していく途中の絵も含めて全部)
  'moaiFront', 'moaiFrontBlue', 'moaiTop', 'moaiBottom', 'moaiTopB', 'moaiBottomB',
  'moaiTL', 'moaiTR', 'moaiBL', 'moaiBR', 'moaiTLb', 'moaiTRb', 'moaiBLb', 'moaiBRb',
  ...[1, 2, 3, 4].flatMap(n => ['B', 'G'].flatMap(d =>
    ['', 'TL', 'TR', 'BL', 'BR', 'TOP', 'BOT'].map(k => 'moaiW' + d + n + k))),
  ...[1, 2, 3, 4].flatMap(n => ['moaiWaveB' + n, 'moaiWaveG' + n]),
  'crabR', 'crabRNo', 'crabTilt', 'eyeball', 'rocket', 'dragonHead', 'dragonHeadOpen', 'dragonBody', 'todoFace', 'pilot', 'pilotBig', 'pilotTurnBig', 'whaleStar', 'birdStar', 'dragonStar', 'shipStar', 'dragonSky',
  'kingRift0', 'kingRift1', 'kingRift2', 'kingRiftBlue', 'kingRiftBlueThin', 'endRift', 'endBase',
  'kingCracks0', 'kingCracks1', 'kingCracks2',
  ...RIFT_OPEN.map((_, i) => 'kingRiftOpen' + i),
]);

/** 1 ピクセルのパレット番号。透明は BG では背景色(黒)になるので 1 として数える */
function pixelIndex(img, x, y) {
  const o = (y * img.width + x) * 4;
  if (img.data[o + 3] < 128) return 1;
  return nearestVdpColor(img.data[o], img.data[o + 1], img.data[o + 2]);
}

/** BG 用: 横 8 ドットごとに 3 色以上使っていないか調べる */
function checkBgImage(img) {
  let runs = 0, worst = 0;
  const samples = [];
  for (let y = 0; y < img.height; y++) {
    for (let bx = 0; bx < img.width; bx += 8) {
      const set = new Set();
      for (let i = 0; i < 8 && bx + i < img.width; i++) set.add(pixelIndex(img, bx + i, y));
      if (set.size > worst) worst = set.size;
      if (set.size > 2) {
        runs++;
        if (samples.length < 3) samples.push(`(x=${bx},y=${y}) 色${[...set].join(',')}`);
      }
    }
  }
  return { runs, worst, samples };
}

/** スプライト用: 絵全体で何色使っているか(透明を除く) */
function countSpriteColors(img) {
  const set = new Set();
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      if (img.data[o + 3] >= 128) set.add(nearestVdpColor(img.data[o], img.data[o + 1], img.data[o + 2]));
    }
  }
  return set.size;
}

/**
 * BG 素材を「横 8 ドット 2 色」に均す。
 * 制約は行ごとに独立しているので、行が変われば別の 2 色を使ってよい。
 * これを利用して、素材側は自由に階調をつけて描き、ここで自動的に
 * 行ごとの 2 色へ落とす(結果として走査線が中間色に見える)。
 */
function reduceBgImage(img) {
  const count = new Array(16).fill(0);
  for (let y = 0; y < img.height; y++) {
    for (let bx = 0; bx < img.width; bx += 8) {
      const idx = [];
      count.fill(0);
      for (let i = 0; i < 8 && bx + i < img.width; i++) {
        const c = pixelIndex(img, bx + i, y); // 透明は黒(1)として数える
        idx.push(c);
        count[c]++;
      }
      let used = 0;
      for (let c = 0; c < 16; c++) if (count[c]) used++;
      if (used <= 2) continue;
      // 多い順に 2 色を残し、それ以外は色の近い方へ寄せる
      let c1 = -1, c2 = -1;
      for (let c = 0; c < 16; c++) {
        if (!count[c]) continue;
        if (c1 < 0 || count[c] > count[c1]) { c2 = c1; c1 = c; }
        else if (c2 < 0 || count[c] > count[c2]) { c2 = c; }
      }
      for (let i = 0; i < idx.length; i++) {
        const c = idx[i];
        if (c === c1 || c === c2) continue;
        const p = VDP_PALETTE[c], p1 = VDP_PALETTE[c1], p2 = VDP_PALETTE[c2];
        const d = (q) => 3 * (p[0] - q[0]) ** 2 + 6 * (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
        const to = d(p1) <= d(p2) ? c1 : c2;
        const o = (y * img.width + bx + i) * 4;
        const rgb = VDP_PALETTE[to];
        img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2];
        img.data[o + 3] = 255;
      }
    }
  }
  return img;
}

console.log('--- 絵素材チェック ---');
// BG 素材は書き出す前に自動で制約へ収める(行ごとに違う 2 色になる)
for (const name of BG_IMAGES) if (images[name]) reduceBgImage(images[name]);
let bgNg = 0, spriteNg = 0;
for (const [name, img] of Object.entries(images)) {
  if (BG_IMAGES.has(name)) {
    const r = checkBgImage(img);
    if (r.runs > 0) {
      bgNg++;
      console.warn(`  [BG違反] ${name}: 横8ドットに3色以上が ${r.runs} 本 (最大 ${r.worst} 色) 例: ${r.samples.join(' / ')}`);
    }
  } else {
    // スプライトは「単色スプライトを 2 枚まで重ねる」体なので 2 色まで。
    // サイズは 8 の倍数(8/16/…/64)まで。
    const n = countSpriteColors(img);
    if (n > 2) {
      spriteNg++;
      console.warn(`  [スプライト色] ${name}: ${n} 色使用(2 色までを推奨。エンジンが落とします)`);
    }
    const badSize = img.width % 8 || img.height % 8 || img.width > 64 || img.height > 64;
    if (badSize) {
      spriteNg++;
      console.warn(`  [スプライトサイズ] ${name}: ${img.width}x${img.height} (8 の倍数で 64 まで)`);
    }
  }
}
console.log(bgNg === 0
  ? '  BG素材: すべて 横8ドット2色(背景色込み) を満たしています'
  : `  BG素材: ${bgNg} 個に違反があります`);
if (spriteNg) console.log(`  スプライト素材: ${spriteNg} 個が 3 色以上(意図的なら問題なし)`);

// 目印の色 -> 実際の色 の置き換え表を 2 つ作る(1 コマ目 / 2 コマ目)。
// 色番号は MSX パレットの番号なので、ここで引いておく
// 地球もパイロットと同じ作り。目印の色 -> 実際の色 の表を 2 つ作り、
// 1 コマごとにディザの 2 色を入れ替える
const earthDuo = [0, 1].map((n) => {
  const map = {};
  for (const m of Object.values(EARTH_MID)) {
    map[m.even] = nearestVdpColor(...hex(m.pair[n]));
    map[m.odd] = nearestVdpColor(...hex(m.pair[1 - n]));
  }
  return map;
});

// 基地の絵も同じ作り
const baseDuo = [0, 1].map((n) => {
  const map = {};
  for (const m of Object.values(BASE_MID)) {
    map[m.even] = nearestVdpColor(...hex(m.pair[n]));
    map[m.odd] = nearestVdpColor(...hex(m.pair[1 - n]));
  }
  return map;
});

// 裂け目も同じ作り
const riftDuo = [0, 1].map((n) => {
  const map = {};
  for (const m of Object.values(END_RIFT_MID)) {
    map[m.even] = nearestVdpColor(...hex(m.pair[n]));
    map[m.odd] = nearestVdpColor(...hex(m.pair[1 - n]));
  }
  return map;
});

const pilotDuo = [0, 1].map((n) => {
  const map = {};
  for (const m of Object.values(PILOT_MID)) {
    map[m.even] = nearestVdpColor(...hex(m.pair[n]));
    map[m.odd] = nearestVdpColor(...hex(m.pair[1 - n]));
  }
  return map;
});

// 中間色の表はエンジン側(engine/midtone.js)にある。ここでは使うだけ。
console.log(`  中間色: ${MID_TONES.length} 色(15 色の 1:1 総当たりから)`);

let midNg = 0;
const midUsed = [
  ...Object.entries(PILOT_MID).map(([n, m]) => ['パイロット/' + n, m.pair]),
  ...Object.entries(EARTH_MID).map(([n, m]) => ['地球/' + n, m.pair]),
  ...Object.entries(END_RIFT_MID).map(([n, m]) => ['裂け目/' + n, m.pair]),
  ...Object.entries(BASE_MID).filter(([, m]) => !m.flat).map(([n, m]) => ['基地/' + n, m.pair]),
];
for (const [name, pair] of midUsed) {
  if (!findMidToneHex(pair[0], pair[1])) {
    console.log(`  中間色 ${name}: ${pair[0]}+${pair[1]} は表に無い`);
    midNg++;
  }
}
if (!midNg) console.log(`  中間色つかいどころ ${midUsed.length} か所: すべて表の中から選ばれています`);

const imagesOut = {};
for (const [name, img] of Object.entries(images)) {
  imagesOut[name] = { width: img.width, height: img.height, b64: toB64(img) };
}

const out =
  '// AUTO-GENERATED by assets-src/makedata.mjs — 手で編集しないこと\n' +
  'export const GAME_DATA = ' + JSON.stringify({
    images: imagesOut,
    bgm: {
      start: BGM_START, fanfare: BGM_BONUS, main: BGM_MAIN,
      // フルパワー時は「幻想即興曲」。前の曲は没曲 1 として残す
      power: BGM_IMPROMPTU, botsu1: BGM_POWER,
      boss: BGM_BOSS, lastboss: BGM_LASTBOSS, moai: BGM_MOAI, todo: BGM_TODO, // 面クリアのマーチ。いまは鳴らしていない(そのうち使う)ので UNUSED1 の名前で置いてある
      unused1: BGM_CLEAR, gameover: BGM_GAMEOVER,
      // 1UP と目玉ボーナスは曲を入れ替えてある
      fanfare2: BGM_FANFARE, bonus: BGM_FANFARE, staff: BGM_STAFF,
      elise: BGM_ELISE, fate: BGM_FATE, salut: BGM_SALUT,
    },
    se: SE,
    // しゃべる言葉(TALK)。録音は持たず、鳴らすときに合成する。
    // text はカタカナ。opts で声の高さ・粗さ・速さを決める
    talk: {
      // ラスボスの名乗り(いまは試しに置いてあるだけ。要らなくなったら消す)
      // 技を出すときの短い掛け声(0.3 秒ほど)。画面は止めずに鳴らす
      kiaiA: { text: 'ハッ', opts: { pitch: 420, speed: 1.5, growl: 0.5, fall: 6, gain: 1.15 } },
      kiaiB: { text: 'ショウ', opts: { pitch: 235, speed: 1.6, growl: 0.6, fall: 8, gain: 1.6 } },
      kiaiC: { text: 'フッ', opts: { pitch: 175, speed: 1.5, growl: 0.7, fall: 5, gain: 1.6 } },
      kozorite: {
        text: 'ワタシハ ウチュウノ テイオウ コゾリテ。 モロビト アルカギリ、 キサマラゴトキニ タオサレハセン！',
        // gain で声だけ少し大きくする(ほかの SE より前に出す)
        opts: { pitch: 132, rate: 8000, bits: 6, growl: 0.7, fall: 4, speed: 1.05, gain: 3.2 },
      },
      // ラスボスにやられたときの高笑い。名乗りと同じ声で、少し速く
      kingLaugh: {
        text: 'ハッハッハッハッ、 オマエハ ヨワイ、 ハッハッハッハッ',
        opts: { pitch: 138, rate: 8000, bits: 6, growl: 0.75, fall: 5, speed: 1.15, gain: 0.9 },
      },
    },
    stage: makeStage(),
    // そらのドラゴンの顔(撃てる場所)
    dragonFace: DRAGON_SKY_FACE,
    // 中間色を出すためのパレット置き換え表(1 コマ目 / 2 コマ目)
    duo: { pilot: pilotDuo, earth: earthDuo, rift: riftDuo, base: baseDuo },
  }, null, 1) + ';\n';

mkdirSync(join(ROOT, 'game'), { recursive: true });
writeFileSync(join(ROOT, 'game', 'gamedata.js'), out);
console.log('game/gamedata.js を生成しました (' + (out.length / 1024).toFixed(1) + ' KB)');
