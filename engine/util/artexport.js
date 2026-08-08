// **絵を画像として書き出す**開発用の道具。
//
//   import { exportSymbol, exportSheet, downloadArt } from './engine/util/artexport.js';
//
//   downloadArt(exportSymbol(mmsxx, SPRITE_SYMBOLS.player, { scale: 4 }), 'player.png');
//   downloadArt(exportSheet(mmsxx, SPRITE_SYMBOLS, { scale: 2, width: 512 }), 'sheet.png');
//
// 何に使うか:
//   ・**外の道具で絵を見たり直したり**する(V2 で取り込み直す流れを作る)
//   ・素材の一覧を作って、抜けや重複を目で確かめる
//   ・記事や説明に貼る
//
// **色は画面と同じパレットから引く**ので、色合いを切り替えて書き出せば
// その色合いのまま出てくる。透明(色番号 0)は透けたまま残る。
//
// 出てくるのは canvas。**保存はしない**(呼んだ側が落とすなり送るなり決める)。

import { getGlyph } from '../font.js';

/** 色番号 -> CSS の色(パレットの 32bit は ABGR) */
function cssOf(mmsxx, i) {
  const v = mmsxx.vdp.pal32[i] >>> 0;
  return `rgb(${v & 0xff},${(v >> 8) & 0xff},${(v >> 16) & 0xff})`;
}

/**
 * 升目の下に名前を書く。**エンジンの 8x8 の字**をそのまま使うので、
 * 外の字を持ってこなくてよい(見た目も画面と揃う)。
 * 長い名前は升目の幅に収まるところまでで切る。
 */
function drawLabel(g, text, dx, dy, cw, color = '#8f8f8f') {
  const max = Math.max(1, Math.floor(cw / 4));      // 1 文字 4 ドット幅で描く
  const s = text.length > max ? text.slice(0, max) : text;
  g.fillStyle = color;
  for (let n = 0; n < s.length; n++) {
    const glyph = getGlyph(s[n]);
    for (let y = 0; y < 8; y++) {
      const row = glyph[y] || '';
      for (let x = 0; x < 8; x++) {
        // 8x8 の字を横半分に間引いて、4x8 として置く(名前が長いので)
        if (row[x] === '#' && (x & 1) === 0) g.fillRect(dx + n * 4 + (x >> 1), dy + y, 1, 1);
      }
    }
  }
}

/**
 * 透けているところが分かるように、**白と灰の市松**を敷く(絵を描くのは この上)。
 * 画像編集の道具で見慣れた見え方に合わせてある。
 * @param {CanvasRenderingContext2D} g @param {number} w @param {number} h
 * @param {number} [size=8] 市松 1 つの大きさ(出てくる画像のドット)
 */
function drawChecker(g, w, h, size = 8) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#cccccc';
  for (let y = 0; y < h; y += size) {
    for (let x = ((y / size) & 1) * size; x < w; x += size * 2) {
      g.fillRect(x, y, size, size);
    }
  }
}

/** 1 枚の絵を canvas に描く(倍率は整数。ドットはぼかさない) */
function drawSymbol(mmsxx, sym, g, dx, dy, k) {
  const { width: w, height: h, pixels } = sym;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = pixels[y * w + x];
      if (!c) continue;                 // 0 は透明。塗らずに残す
      g.fillStyle = cssOf(mmsxx, c);
      g.fillRect(dx + x * k, dy + y * k, k, k);
    }
  }
}

/**
 * **絵を 1 枚だけ**書き出す。
 * @param {object} mmsxx エンジン
 * @param {{width:number,height:number,pixels:Uint8Array}} sym 絵(スプライトでも BG でもよい)
 * @param {{scale?:number, background?:?number, checker?:boolean, checkerSize?:number}} [opts]
 *   scale = 何倍にするか(既定 1) / background = 下地の色番号(省略すると透明のまま)
 *   checker = 透けているところに**白と灰の市松**を敷くか(background を渡すとそちらが勝つ)
 * @returns {HTMLCanvasElement}
 */
export function exportSymbol(mmsxx, sym, opts = {}) {
  const k = Math.max(1, Math.round(opts.scale || 1));
  const c = document.createElement('canvas');
  c.width = sym.width * k;
  c.height = sym.height * k;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  // 市松を敷くと、**透けているところが一目で分かる**。色の下地を頼まれたらそちらを優先
  if (opts.background != null) {
    g.fillStyle = cssOf(mmsxx, opts.background);
    g.fillRect(0, 0, c.width, c.height);
  } else if (opts.checker) {
    drawChecker(g, c.width, c.height, opts.checkerSize);
  }
  drawSymbol(mmsxx, sym, g, 0, 0, k);
  return c;
}

/**
 * **まとめて 1 枚に並べる**。
 *
 * 幅を決めると、入るだけ横に並べて、あふれたら次の段へ送る。
 * 絵の大きさがまちまちでも、**いちばん大きいものに合わせた升目**へ置くので
 * 並びは崩れない。
 *
 * @param {object} mmsxx エンジン
 * @param {Object<string,*>|Array} symbols 絵の一覧(名前つきの入れものでも配列でもよい)
 * @param {{scale?:number, width?:number, cols?:number, padding?:number,
 *          background?:?number, checker?:boolean, checkerSize?:number,
 *          sort?:boolean}} [opts]
 *   scale = 何倍にするか(既定 1)
 *   width = 出す絵の幅(ドット)。ここへ入るだけ横に並べる
 *   cols = 横に並べる数。width より優先する
 *   padding = 升目のまわりの余白(既定 2)
 *   background = 下地の色番号(省略すると透明のまま)
 *   checker = 透けているところに**白と灰の市松**を敷くか(background を渡すとそちらが勝つ)
 *   checkerSize = 市松 1 つの大きさ(既定 8)
 *   sort = 名前の順に並べ替えるか(既定 false = 登録順)
 *   label = 升目の下に名前を出すか(既定 false)。エンジンの 8x8 の字を横半分に
 *     間引いて 4x8 で書くので、升目が狭くてもそこそこ入る
 *   labelColor = 名前の色(CSS。既定は灰色)
 * @returns {HTMLCanvasElement}
 */
export function exportSheet(mmsxx, symbols, opts = {}) {
  const k = Math.max(1, Math.round(opts.scale || 1));
  const pad = (opts.padding == null ? 2 : Math.max(0, Math.round(opts.padding)));
  // 受けるのは 3 通り: 名前つきの入れもの / 絵の配列 / **[名前, 絵] の配列**。
  // 3 つめは、**同じ名前が何枚あってもそのまま並べられる**ので一覧に向く
  // (入れものだと同じ名前は 1 つに潰れてしまう)
  let list;
  if (Array.isArray(symbols)) {
    const pairs = symbols.length && Array.isArray(symbols[0]) && symbols[0].length === 2;
    list = pairs
      ? symbols.map(([n, s]) => [String(n), s])
      : symbols.map((s, i) => [String(i), s]);
  } else {
    list = Object.entries(symbols);
  }
  // 絵らしくないもの(壊れているもの)は落とす
  list = list.filter(([, s]) => s && s.pixels && s.width && s.height);
  if (opts.sort) list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (!list.length) return document.createElement('canvas');

  // 升目の大きさは**いちばん大きい絵**に合わせる。
  // 名前を出すときは、そのぶん(9 ドット)だけ升目を縦に伸ばす
  const lh = opts.label ? 9 : 0;
  const cw = Math.max(...list.map(([, s]) => s.width)) * k;
  const ch = Math.max(...list.map(([, s]) => s.height)) * k + lh;
  const cols = Math.max(1, opts.cols
    ? Math.round(opts.cols)
    : Math.floor(((opts.width || 512) - pad) / (cw + pad)));
  const rows = Math.ceil(list.length / cols);

  const c = document.createElement('canvas');
  c.width = pad + cols * (cw + pad);
  c.height = pad + rows * (ch + pad);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  // 市松を敷くと、**透けているところが一目で分かる**。色の下地を頼まれたらそちらを優先
  if (opts.background != null) {
    g.fillStyle = cssOf(mmsxx, opts.background);
    g.fillRect(0, 0, c.width, c.height);
  } else if (opts.checker) {
    drawChecker(g, c.width, c.height, opts.checkerSize);
  }
  list.forEach(([label, sym], i) => {
    const col = i % cols, row = (i / cols) | 0;
    const cellX = pad + col * (cw + pad), cellY = pad + row * (ch + pad);
    // 升目の真ん中に置く(大きさがまちまちでも中心がそろう)
    const x = cellX + ((cw - sym.width * k) >> 1);
    const y = cellY + ((ch - lh - sym.height * k) >> 1);
    drawSymbol(mmsxx, sym, g, x, y, k);
    if (opts.label) drawLabel(g, label, cellX, cellY + ch - lh + 1, cw, opts.labelColor);
  });
  return c;
}

/**
 * できた絵を手元へ落とす。
 * @param {HTMLCanvasElement} canvas
 * @param {string} [filename]
 */
export function downloadArt(canvas, filename = 'art.png') {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  return url;
}
