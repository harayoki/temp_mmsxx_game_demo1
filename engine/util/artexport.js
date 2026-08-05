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

/** 色番号 -> CSS の色(パレットの 32bit は ABGR) */
function cssOf(mmsxx, i) {
  const v = mmsxx.vdp.pal32[i] >>> 0;
  return `rgb(${v & 0xff},${(v >> 8) & 0xff},${(v >> 16) & 0xff})`;
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
 * @param {{scale?:number, background?:?number}} [opts]
 *   scale = 何倍にするか(既定 1) / background = 下地の色番号(省略すると透明のまま)
 * @returns {HTMLCanvasElement}
 */
export function exportSymbol(mmsxx, sym, opts = {}) {
  const k = Math.max(1, Math.round(opts.scale || 1));
  const c = document.createElement('canvas');
  c.width = sym.width * k;
  c.height = sym.height * k;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  if (opts.background != null) {
    g.fillStyle = cssOf(mmsxx, opts.background);
    g.fillRect(0, 0, c.width, c.height);
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
 *          background?:?number, sort?:boolean}} [opts]
 *   scale = 何倍にするか(既定 1)
 *   width = 出す絵の幅(ドット)。ここへ入るだけ横に並べる
 *   cols = 横に並べる数。width より優先する
 *   padding = 升目のまわりの余白(既定 2)
 *   background = 下地の色番号(省略すると透明のまま)
 *   sort = 名前の順に並べ替えるか(既定 false = 登録順)
 * @returns {HTMLCanvasElement}
 */
export function exportSheet(mmsxx, symbols, opts = {}) {
  const k = Math.max(1, Math.round(opts.scale || 1));
  const pad = (opts.padding == null ? 2 : Math.max(0, Math.round(opts.padding)));
  let list = Array.isArray(symbols)
    ? symbols.map((s, i) => [String(i), s])
    : Object.entries(symbols);
  // 絵らしくないもの(壊れているもの)は落とす
  list = list.filter(([, s]) => s && s.pixels && s.width && s.height);
  if (opts.sort) list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (!list.length) return document.createElement('canvas');

  // 升目の大きさは**いちばん大きい絵**に合わせる
  const cw = Math.max(...list.map(([, s]) => s.width)) * k;
  const ch = Math.max(...list.map(([, s]) => s.height)) * k;
  const cols = Math.max(1, opts.cols
    ? Math.round(opts.cols)
    : Math.floor(((opts.width || 512) - pad) / (cw + pad)));
  const rows = Math.ceil(list.length / cols);

  const c = document.createElement('canvas');
  c.width = pad + cols * (cw + pad);
  c.height = pad + rows * (ch + pad);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  if (opts.background != null) {
    g.fillStyle = cssOf(mmsxx, opts.background);
    g.fillRect(0, 0, c.width, c.height);
  }
  list.forEach(([, sym], i) => {
    const col = i % cols, row = (i / cols) | 0;
    // 升目の真ん中に置く(大きさがまちまちでも中心がそろう)
    const x = pad + col * (cw + pad) + ((cw - sym.width * k) >> 1);
    const y = pad + row * (ch + pad) + ((ch - sym.height * k) >> 1);
    drawSymbol(mmsxx, sym, g, x, y, k);
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
