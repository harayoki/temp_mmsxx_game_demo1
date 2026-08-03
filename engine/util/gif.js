// 溜めてある画面から **GIF アニメ**を作る。エンジン本体から切り離した任意部品。
//
//   import { makeGif } from './engine/util/gif.js';
//   const blob = makeGif(mmsxx, { seconds: 3, fps: 30 });
//   saveGif(blob, 'play.gif');
//
// ## なぜ GIF が向いているか
//
// GIF は**パレット方式**の形式で、1 ドットが色番号 1 つ。
// このエンジンが溜めているコマは**すでに色番号**なので、
// ふつういちばん面倒な「色を減らす」工程が丸ごと要らない。
// 15 色なので 4bit に収まり、圧縮もよく効く。
//
// **外の部品は使わない。** 圧縮(LZW)もここに書いてある。
//
// ## 割り切っていること
//
// - **音は入らない**(GIF に音は無い)。音つきが要るなら別の道
// - 待ち時間は 1/100 秒きざみ。30fps なら 3(約 33ms)、
//   60fps は 1(100fps 扱い)になるので、**30fps を勧める**
// - 大きさは溜めたコマのまま。倍にすると量も倍々に増える

/** 1 ビットずつ詰めていく袋(LZW の出力用) */
class BitPacker {
  constructor() {
    this.bytes = [];
    this.cur = 0;
    this.bits = 0;
  }

  write(code, len) {
    this.cur |= code << this.bits;
    this.bits += len;
    while (this.bits >= 8) {
      this.bytes.push(this.cur & 0xff);
      this.cur >>= 8;
      this.bits -= 8;
    }
  }

  flush() {
    if (this.bits > 0) { this.bytes.push(this.cur & 0xff); this.cur = 0; this.bits = 0; }
    return this.bytes;
  }
}

/**
 * GIF の LZW 圧縮。色番号の並びを、決まった作法で縮める。
 * @param {Uint8Array} px 色番号(0..15)
 * @param {number} minCode 最小のビット数(16 色なら 4)
 */
function lzw(px, minCode) {
  const clear = 1 << minCode;        // 表を捨てる合図
  const eoi = clear + 1;             // 終わりの合図
  const out = new BitPacker();
  let size = minCode + 1;            // いま何ビットで書いているか
  let next = eoi + 1;                // 次に配る番号
  let dict = new Map();
  out.write(clear, size);
  let cur = px[0];
  for (let i = 1; i < px.length; i++) {
    const k = px[i];
    const key = cur * 4096 + k;      // 「いまの並び + 次の色」を 1 つの数にする
    const found = dict.get(key);
    if (found !== undefined) { cur = found; continue; }
    out.write(cur, size);
    dict.set(key, next++);
    if (next > (1 << size)) {
      if (size < 12) size++;
      else {
        // 表がいっぱい。捨てて最初からやり直す(GIF の決まり)
        out.write(clear, size);
        dict = new Map();
        next = eoi + 1;
        size = minCode + 1;
      }
    }
    cur = k;
  }
  out.write(cur, size);
  out.write(eoi, size);
  return out.flush();
}

/** バイトを並べていく袋 */
class ByteBag {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 0xff); }
  u16(v) { this.a.push(v & 0xff, (v >> 8) & 0xff); }
  str(s) { for (let i = 0; i < s.length; i++) this.a.push(s.charCodeAt(i)); }
  bytes(list) { for (const v of list) this.a.push(v); }
  /** GIF は中身を 255 バイトずつの小包に分けて置く */
  blocks(list) {
    for (let i = 0; i < list.length; i += 255) {
      const n = Math.min(255, list.length - i);
      this.a.push(n);
      for (let j = 0; j < n; j++) this.a.push(list[i + j]);
    }
    this.a.push(0);
  }
}

/**
 * 溜めてある画面から GIF アニメを作る。
 *
 * @param {object} mmsxx エンジン
 * @param {{seconds?:number, fps?:number, scale?:number}} [opts]
 *   seconds = 直前の何秒ぶんを使うか(省略すると溜まっているぶん全部)
 *   fps = 1 秒あたりのコマ数(既定 30。GIF の待ち時間は 1/100 秒きざみ)
 *   scale = 何倍に広げるか(既定 1。倍にすると量も増える)
 * @returns {Blob|null} image/gif。溜まっていなければ null
 */
export function makeGif(mmsxx, opts = {}) {
  const vdp = mmsxx.vdp;
  const have = vdp.frameCount;
  if (!have) return null;
  const fps = Math.max(1, Math.min(50, Math.round(opts.fps || 30)));
  const step = Math.max(1, Math.round(60 / fps));      // 何コマおきに拾うか
  const scale = Math.max(1, Math.round(opts.scale || 1));
  const want = opts.seconds ? Math.round(opts.seconds * 60) : have;
  const use = Math.min(have, want);

  const w = vdp.outWidth, h = vdp.outHeight;
  const ow = w * scale, oh = h * scale;
  const bag = new ByteBag();

  // ---- 見出し ----
  bag.str('GIF89a');
  bag.u16(ow); bag.u16(oh);
  // 0x93 = 色表あり / 色の深さ 4bit / 表の大きさ 16(2^(3+1))
  bag.u8(0x80 | (3 << 4) | 3);
  bag.u8(0);      // 背景の色番号
  bag.u8(0);      // 縦横比(指定なし)

  // ---- 色表(16 色) ----
  // 番号 0 は透明のしるしだが、GIF に透明は要らないので背景色を入れておく
  const pal = vdp.constructor.PALETTE || null;
  const rgb = (i) => {
    const p = (pal && pal[i]) || null;
    if (p) return p;
    // エンジンが持っている 32bit 値(ABGR)から戻す
    const v = vdp.pal32[i] >>> 0;
    return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
  };
  const bg = rgb(vdp.backdrop || 1);
  for (let i = 0; i < 16; i++) {
    const c = (i === 0) ? bg : rgb(i);
    bag.u8(c[0]); bag.u8(c[1]); bag.u8(c[2]);
  }

  // ---- くり返しの指定(NETSCAPE2.0) ----
  bag.u8(0x21); bag.u8(0xff); bag.u8(11);
  bag.str('NETSCAPE2.0');
  bag.u8(3); bag.u8(1); bag.u16(0);   // 0 = ずっとくり返す
  bag.u8(0);

  const delay = Math.max(1, Math.round(100 / fps));   // 1/100 秒きざみ
  const row = new Uint8Array(ow);
  // 古いほうから順に置く(frameBack は 0 が新しいので、後ろから数える)
  for (let back = use - 1; back >= 0; back -= step) {
    const idx = vdp.frameBack(back);
    if (!idx) continue;

    // ---- そのコマの見出し ----
    bag.u8(0x21); bag.u8(0xf9); bag.u8(4);
    bag.u8(0);          // 消しかたの指定なし・透明なし
    bag.u16(delay);
    bag.u8(0);          // 透明の色番号(使わない)
    bag.u8(0);

    bag.u8(0x2c);       // 絵の始まり
    bag.u16(0); bag.u16(0); bag.u16(ow); bag.u16(oh);
    bag.u8(0);          // この絵だけの色表は無し・並びはふつう

    // ---- 中身 ----
    let px = idx;
    if (scale > 1) {
      px = new Uint8Array(ow * oh);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const c = idx[y * w + x];
          for (let sx = 0; sx < scale; sx++) row[x * scale + sx] = c;
        }
        for (let sy = 0; sy < scale; sy++) px.set(row, (y * scale + sy) * ow);
      }
    }
    bag.u8(4);          // 最小のビット数(16 色なので 4)
    bag.blocks(lzw(px, 4));
  }

  bag.u8(0x3b);         // おしまい
  return new Blob([new Uint8Array(bag.a)], { type: 'image/gif' });
}

/** できた GIF をファイルとして落とす */
export function saveGif(blob, filename = 'play.gif') {
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // 少し待ってから片づける(押した直後に消すと落ちないことがある)
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}
