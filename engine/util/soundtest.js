// サウンドテスト。曲と効果音を列で並べて、選んで鳴らすだけのページ。
// エンジン本体からは切り離した任意の部品。
//
//   import { SoundTest } from './engine/util/soundtest.js';
//
//   const page = new SoundTest(mmsxx, {
//     layer: 4,
//     columns: [
//       { title: 'BGM', items: bgmNames, play: (n) => mmsxx.audio.playBGM(n, true, true) },
//       { title: 'SE',  items: seNames,  play: (n) => mmsxx.audio.playSE(n, 9) },
//     ],
//     stop: () => { mmsxx.audio.stopBGM(); mmsxx.audio.stopSE(); },
//     onExit: () => enterTitle(),
//   });
//   page.open();
//   page.update();   // 毎フレーム

import { SCREEN_W } from '../video.js';

const centerX = (text) => (SCREEN_W - text.length * 8) >> 1;
/**
 * 画面からはみ出した文字を**落として**書く。
 * レイヤーは画面と同じ幅で左右がつながっているので、
 * そのまま負の x へ書くと**反対の端に回り込んで**しまう。
 * 見切れさせたいだけなので、外に出る文字は捨てる
 */
function printClip(layer, x, y, text, color) {
  const from = Math.max(0, Math.ceil(-x / 8));
  const to = Math.min(text.length, Math.floor((SCREEN_W - x) / 8));
  if (to <= from) return;
  layer.print(x + from * 8, y, text.slice(from, to), color);
}
const ARROW_L = String.fromCharCode(0x1a), ARROW_R = String.fromCharCode(0x1b);

export class SoundTest {
  /**
   * @param {object} mmsxx MMSXXEngine
   * @param {{
   *   columns: Array<{
   *     title: string,
   *     items: string[],                 並べる名前
   *     play: (name:string, index:number) => void,
   *     x?: number,                      使わない(左右送りで並べるため)
   *   }>,
   *   layer?: number,       描くレイヤー(既定 0)
   *   rows?: number,        一度に出す行数(既定 8)
   *   titleY?: number,      見出しの y(既定 8)
   *   listY?: number,       一覧の 1 行目の y(既定 48)
   *   lineStep?: number,    行間(既定 16)
   *   listX?: number,       真ん中の列の左端(既定 88)
   *   slotStep?: number,    隣の列までの距離(既定 136。画面外へ見切れる)
   *   header?: string,      いちばん上の見出し(既定 '- SOUND TEST -')
   *   help?: string,        下に出す案内
   *   helpY?: number,       その y(既定 180)
   *   note?: () => string,  いま鳴っているものなどを出したいとき(毎フレーム呼ぶ)
   *   noteY?: number,       その y(既定 168)
   *   playKeys?: string[],  鳴らすキー(既定 Space)
   *   stopKeys?: string[],  止めるキー(既定 Z)
   *   exitKeys?: string[],  閉じるキー(既定 Escape)
   *   stop?: () => void,    止める処理
   *   onExit?: () => void,
   * }} opts
   */
  constructor(mmsxx, opts) {
    this.mmsxx = mmsxx;
    this.columns = opts.columns || [];
    this.layerIndex = opts.layer ?? 0;
    this.rows = opts.rows ?? 8;
    this.titleY = opts.titleY ?? 8;
    this.listY = opts.listY ?? 48;
    this.lineStep = opts.lineStep ?? 16;
    // 列は**左右送り**で見せる。いま選んでいる列が真ん中、
    // 隣の列は両端で見切れる(隣に何があるか気配だけ伝える)
    this.listX = opts.listX ?? 88;
    this.slotStep = opts.slotStep ?? 136;
    this.header = opts.header ?? '- SOUND TEST -';
    this.help = opts.help || 'SP:PLAY  Z:STOP  ESC:EXIT';
    this.helpY = opts.helpY ?? 180;
    this.note = opts.note || null;
    this.noteY = opts.noteY ?? 168;
    this.playKeys = opts.playKeys || ['Space'];
    this.stopKeys = opts.stopKeys || ['KeyZ'];
    this.exitKeys = opts.exitKeys || ['Escape'];
    this.stop = opts.stop || null;
    this.onExit = opts.onExit || null;
    this.col = 0;
    this.sel = this.columns.map(() => 0);
    this._lastNote = null;
  }

  open() {
    this.col = 0;
    this.sel = this.columns.map(() => 0);
    this._lastNote = null;
    this.draw();
  }

  /** いま選んでいる名前 */
  get current() {
    const c = this.columns[this.col];
    return c ? c.items[this.sel[this.col]] : null;
  }

  draw() {
    const layer = this.mmsxx.layer(this.layerIndex);
    layer.clear();
    layer.print(centerX(this.header), this.titleY, this.header, 15);
    const n = this.columns.length;
    // 真ん中(0)と、その左右(-1 / +1)だけ描く。左右は端で見切れてよい
    for (const d of (n > 1 ? [-1, 1, 0] : [0])) {
      const ci = ((this.col + d) % n + n) % n;
      const c = this.columns[ci];
      if (!c) continue;
      const here = d === 0;
      const x = this.listX + d * this.slotStep;
      // 見出し。真ん中のものだけ矢印を添えて「左右に動ける」ことを伝える
      const title = here ? ARROW_L + ' ' + c.title + ' ' + ARROW_R : c.title;
      if (here) layer.print(centerX(title), this.titleY + 20, title, 11);
      else printClip(layer, x, this.titleY + 20, title, 4);
      const sel = this.sel[ci];
      // 選んでいる行が真ん中あたりに来るように切り出す
      const top = Math.max(0, Math.min(c.items.length - this.rows, sel - (this.rows >> 1)));
      for (let r = 0; r < this.rows; r++) {
        const i = top + r;
        if (i >= c.items.length) break;
        const on = i === sel;
        const mark = (on && here) ? ARROW_R : ' ';
        const color = here ? (on ? 11 : 14) : 4;
        printClip(layer, x, this.listY + r * this.lineStep, mark + c.items[i].toUpperCase(), color);
      }
    }
    if (this.help) layer.print(centerX(this.help), this.helpY, this.help, 10);
    this._drawNote(true);
  }

  /** 「いま鳴っているもの」の行だけ描き直す */
  _drawNote(force = false) {
    if (!this.note) return;
    const text = this.note() || '';
    if (!force && text === this._lastNote) return;
    this._lastNote = text;
    const layer = this.mmsxx.layer(this.layerIndex);
    layer.fill(0, 0, this.noteY, SCREEN_W, 8);
    if (text) layer.print(centerX(text), this.noteY, text, 11);
  }

  /** 毎フレーム呼ぶ。閉じたら true */
  update() {
    const input = this.mmsxx.input;
    for (const k of this.exitKeys) {
      if (input.wasPressed(k)) {
        if (this.stop) this.stop();
        if (this.onExit) this.onExit();
        return true;
      }
    }
    let moved = false;
    const n = this.columns.length;
    if (n > 1 && (input.wasPressed('ArrowLeft') || input.wasPressed('ArrowRight'))) {
      const d = input.wasPressed('ArrowRight') ? 1 : -1;
      this.col = (this.col + d + n) % n;
      moved = true;
    }
    const list = this.columns[this.col];
    if (list && list.items.length) {
      const len = list.items.length;
      if (input.wasPressed('ArrowUp')) { this.sel[this.col] = (this.sel[this.col] + len - 1) % len; moved = true; }
      if (input.wasPressed('ArrowDown')) { this.sel[this.col] = (this.sel[this.col] + 1) % len; moved = true; }
    }
    for (const k of this.playKeys) {
      if (input.wasPressed(k) && list) {
        list.play(list.items[this.sel[this.col]], this.sel[this.col]);
        moved = true;
      }
    }
    for (const k of this.stopKeys) {
      if (input.wasPressed(k) && this.stop) { this.stop(); moved = true; }
    }
    if (moved) this.draw();
    else this._drawNote();
    return false;
  }
}
