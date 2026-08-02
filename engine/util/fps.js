// 出ているコマ数(FPS)を隅に出す。開発中の様子見に使う任意部品。
//
//   import { FpsMeter } from './engine/util/fps.js';
//   const fps = DEV ? new FpsMeter() : null;
//   mmsxx.run(() => { if (fps) fps.tick(); ... });
//
// **画面ではなく DOM に出す**。理由は 2 つ:
//   - キャンバスに描くと毎コマ合成をやり直すことになる。
//     DOM なら数字が変わったときだけ書き換えれば済む
//   - `mmsxx.capture()` はキャンバスの中身を取るので、
//     DOM に出しておけば**写真に写らない**

export class FpsMeter {
  /**
   * @param {{corner?:'tl'|'tr'|'bl'|'br', every?:number, color?:string}} [opts]
   *   corner = 出す隅(既定は右上) / every = 何ミリ秒ごとに数え直すか(既定 500)
   */
  constructor(opts = {}) {
    this.every = opts.every ?? 500;
    this.frames = 0;
    this.last = performance.now();
    this.value = 0;
    this.el = document.createElement('div');
    const corner = opts.corner || 'tr';
    Object.assign(this.el.style, {
      position: 'fixed',
      [corner[0] === 't' ? 'top' : 'bottom']: '4px',
      [corner[1] === 'l' ? 'left' : 'right']: '4px',
      font: '12px monospace',
      color: opts.color || '#7f7',
      background: 'rgba(0,0,0,0.55)',
      padding: '1px 5px',
      borderRadius: '3px',
      zIndex: '9999',
      pointerEvents: 'none',   // 下のものを触れなくしない
      whiteSpace: 'pre',
    });
    this.el.textContent = '-- fps';
    document.body.appendChild(this.el);
  }

  /** 毎コマ呼ぶ。数字が変わったときだけ書き換える */
  tick() {
    this.frames++;
    const now = performance.now();
    const dt = now - this.last;
    if (dt < this.every) return;
    const fps = Math.round(this.frames * 1000 / dt * 10) / 10;
    this.frames = 0;
    this.last = now;
    if (fps === this.value) return;
    this.value = fps;
    this.el.textContent = fps.toFixed(1) + ' fps';
  }

  /** 表示を消す */
  remove() {
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
  }
}
