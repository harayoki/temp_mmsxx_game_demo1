// スタッフロール。下から上へ文字が流れていくだけの、よくある表現。
// エンジン本体からは切り離した任意の部品。
//
//   import { StaffRoll } from './engine/util/staffroll.js';
//
//   const roll = new StaffRoll(mmsxx, {
//     layer: 4,
//     lines: ['STAFF', '', 'DIRECTOR', 'HARAYOKI'],
//     headings: new Set(['STAFF', 'DIRECTOR']),
//     onEnd: () => enterTitle(),
//   });
//   roll.start();
//   roll.update();   // 毎フレーム

import { SCREEN_W, SCREEN_H } from '../video.js';

const centerX = (text) => (SCREEN_W - text.length * 8) >> 1;

export class StaffRoll {
  /**
   * @param {object} mmsxx MMSXXEngine
   * @param {{
   *   lines: string[],          流す行(空文字は 1 行ぶんの空き)
   *   layer?: number,           描くレイヤー(既定 0)
   *   headings?: Set<string>,   見出しにする行(色を変える)
   *   step?: number,            行間(既定 16)
   *   tightStep?: number,       文が続いている行どうしの行間(既定 step の 3/4)
   *   speed?: number,           1 フレームに動くドット数(既定 0.35)
   *   color?: number,           ふつうの行の色(既定 15)
   *   headingColor?: number,    見出しの色(既定 11)
   *   top?: number,             この y より上には描かない(既定 8)
   *   bottom?: number,          この y より下には描かない(既定 画面下 - 8)
   *   skipKeys?: string[],      押すと最後まで飛ばすキー
   *   onEnd?: () => void,       流し終わったら呼ばれる
   * }} opts
   */
  constructor(mmsxx, opts) {
    this.mmsxx = mmsxx;
    this.lines = opts.lines || [];
    this.layerIndex = opts.layer ?? 0;
    this.headings = opts.headings || new Set();
    this.step = opts.step ?? 16;
    // 文が続いている行どうしの行間(既定は step の 3/4)
    // 既定は step と同じ = **行間はどこも同じ**。
    // 流れているあいだに行間が伸び縮みすると、かえって読みにくいので、
    // 詰めたいときだけ明示して渡す
    this.tightStep = opts.tightStep ?? (opts.step ?? 16);
    this.speed = opts.speed ?? 0.35;
    this.color = opts.color ?? 15;
    this.headingColor = opts.headingColor ?? 11;
    this.top = opts.top ?? 8;
    this.bottom = opts.bottom ?? (SCREEN_H - 8);
    this.skipKeys = opts.skipKeys || ['Space', 'KeyZ', 'Escape'];
    this.onEnd = opts.onEnd || null;
    this.scroll = 0;
    this.done = false;
  }

  /** 最後まで流れきるのに何フレームかかるか */
  /**
   * 行ごとの縦位置(先頭からの積み上げ)。
   * **文が続いている行のあいだは詰める**。
   * 行末が句読点で終わっていないのに、段落の切れ目と同じだけ空いていると、
   * 1 つの文が別々のことに見えてしまうため。
   */
  _layout() {
    if (this._offsets && this._offsetsFor === this.lines) return this._offsets;
    const out = [];
    let y = 0;
    for (let i = 0; i < this.lines.length; i++) {
      out.push(y);
      const line = this.lines[i];
      const next = this.lines[i + 1];
      // 次の行へ文が続いているか(行末に区切りが無く、次も文字がある)
      const goes = line && next && !/[.!?:,]$/.test(line) && !this.headings.has(line);
      y += goes ? this.tightStep : this.step;
    }
    this._offsets = out;
    this._offsetsFor = this.lines;
    this._total = y;
    return out;
  }

  /** 全部の行を積み上げた高さ */
  get totalHeight() { this._layout(); return this._total; }

  get length() {
    return Math.ceil((SCREEN_H + this.totalHeight) / this.speed);
  }

  /** 流し終わるまで、あと何フレームか(終わりぎわの演出に使う) */
  get remaining() {
    const left = SCREEN_H + this.totalHeight - this.scroll;
    return Math.max(0, Math.ceil(left / this.speed));
  }

  start() {
    this.scroll = 0;
    this.done = false;
    this.mmsxx.layer(this.layerIndex).clear();
  }

  update() {
    if (this.done) return true;
    for (const k of this.skipKeys) {
      if (this.mmsxx.input.wasPressed(k)) return this._finish();
    }
    this.scroll += this.speed;
    const layer = this.mmsxx.layer(this.layerIndex);
    layer.clear();
    const off = this._layout();
    this.lines.forEach((line, i) => {
      if (!line) return;
      const y = Math.round(SCREEN_H + off[i] - this.scroll);
      if (y < this.top || y > this.bottom) return;
      const c = this.headings.has(line) ? this.headingColor : this.color;
      layer.print(centerX(line), y, line, c);
    });
    if (this.scroll > SCREEN_H + this.totalHeight) return this._finish();
    return false;
  }

  _finish() {
    this.done = true;
    this.mmsxx.layer(this.layerIndex).clear();
    if (this.onEnd) this.onEnd();
    return true;
  }
}
