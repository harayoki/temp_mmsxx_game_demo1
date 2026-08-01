// サウンドテスト。曲と効果音を列で並べて、選んで鳴らすだけのページ。
// エンジン本体からは切り離した任意の部品。
//
//   import { SoundTest } from './engine/util/soundtest.js';
//
//   const page = new SoundTest(msx, {
//     layer: 4,
//     columns: [
//       { title: 'BGM', items: bgmNames, play: (n) => msx.audio.playBGM(n, true, true) },
//       { title: 'SE',  items: seNames,  play: (n) => msx.audio.playSE(n, 9) },
//     ],
//     stop: () => { msx.audio.stopBGM(); msx.audio.stopSE(); },
//     onExit: () => enterTitle(),
//   });
//   page.open();
//   page.update();   // 毎フレーム

import { SCREEN_W } from '../video.js';

const centerX = (text) => (SCREEN_W - text.length * 8) >> 1;
const ARROW_R = String.fromCharCode(0x1b);

export class SoundTest {
  /**
   * @param {object} msx MMSXXEngine
   * @param {{
   *   columns: Array<{
   *     title: string,
   *     items: string[],                 並べる名前
   *     play: (name:string, index:number) => void,
   *     x?: number,                      左端(既定は列を等分)
   *   }>,
   *   layer?: number,       描くレイヤー(既定 0)
   *   rows?: number,        一度に出す行数(既定 8)
   *   titleY?: number,      見出しの y(既定 8)
   *   listY?: number,       一覧の 1 行目の y(既定 48)
   *   lineStep?: number,    行間(既定 16)
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
  constructor(msx, opts) {
    this.msx = msx;
    this.columns = opts.columns || [];
    this.layerIndex = opts.layer ?? 0;
    this.rows = opts.rows ?? 8;
    this.titleY = opts.titleY ?? 8;
    this.listY = opts.listY ?? 48;
    this.lineStep = opts.lineStep ?? 16;
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
    const layer = this.msx.layer(this.layerIndex);
    layer.clear();
    layer.print(centerX(this.header), this.titleY, this.header, 15);
    const width = Math.floor(SCREEN_W / Math.max(1, this.columns.length));
    this.columns.forEach((c, ci) => {
      const x = c.x ?? (ci * width + 16);
      layer.print(x + 8, this.titleY + 20, c.title, this.col === ci ? 11 : 14);
      const sel = this.sel[ci];
      // 選んでいる行が真ん中あたりに来るように切り出す
      const top = Math.max(0, Math.min(c.items.length - this.rows, sel - (this.rows >> 1)));
      for (let r = 0; r < this.rows; r++) {
        const i = top + r;
        if (i >= c.items.length) break;
        const here = i === sel;
        const mark = (here && this.col === ci) ? ARROW_R : ' ';
        const color = here ? (this.col === ci ? 11 : 7) : 14;
        layer.print(x, this.listY + r * this.lineStep, mark + c.items[i].toUpperCase(), color);
      }
    });
    if (this.help) layer.print(centerX(this.help), this.helpY, this.help, 10);
    this._drawNote(true);
  }

  /** 「いま鳴っているもの」の行だけ描き直す */
  _drawNote(force = false) {
    if (!this.note) return;
    const text = this.note() || '';
    if (!force && text === this._lastNote) return;
    this._lastNote = text;
    const layer = this.msx.layer(this.layerIndex);
    layer.fill(0, 0, this.noteY, SCREEN_W, 8);
    if (text) layer.print(centerX(text), this.noteY, text, 11);
  }

  /** 毎フレーム呼ぶ。閉じたら true */
  update() {
    const input = this.msx.input;
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
