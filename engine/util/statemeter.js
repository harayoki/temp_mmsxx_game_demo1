// いまの局面を隅に出す。開発中の様子見に使う任意部品。
//
//   import { StateMeter } from './engine/util/statemeter.js';
//   const meter = DEV ? new StateMeter() : null;
//   mmsxx.run(() => { if (meter) meter.tick({ ボス: boss && boss.fsm }); ... });
//
// **画面ではなく DOM に出す**([fps.js](fps.js) と同じ理由)。
//   - キャンバスに描くと毎コマ合成をやり直すことになる
//   - `mmsxx.capture()` はキャンバスの中身を取るので、DOM なら**写真に写らない**
//
// 出すのは「いまの局面 / 残りコマ / 次の行き先」の 3 つ。
// 何コマ目に何が起きたかを追うのが目的なので、**残りコマを毎コマ書き換える**。

export class StateMeter {
  /**
   * @param {{canvas?:HTMLCanvasElement, corner?:'tl'|'tr'|'bl'|'br', color?:string,
   *          size?:number}} [opts]
   *   canvas = **ゲーム画面のすぐ上**に置く(渡さなければ画面の隅)
   *   corner = canvas が無いときの隅(既定は左下。右上は FpsMeter が使う)
   *   size   = 文字の大きさ(既定 24px。読めることを優先して大きめ)
   */
  constructor(opts = {}) {
    this.canvas = opts.canvas || null;
    this.el = document.createElement('div');
    const corner = opts.corner || 'bl';
    Object.assign(this.el.style, {
      position: 'fixed',
      font: (opts.size ?? 24) + 'px monospace',
      lineHeight: '1.15',
      color: opts.color || '#7f7',
      background: 'rgba(0,0,0,.55)',
      padding: '2px 6px',
      borderRadius: '4px',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: 9999,
      display: 'none',
    });
    if (!this.canvas) {
      // 隅に貼るとき。canvas があるときは tick のたびに置き直す
      this.el.style[corner[0] === 't' ? 'top' : 'bottom'] = '4px';
      this.el.style[corner[1] === 'l' ? 'left' : 'right'] = '4px';
    }
    document.body.appendChild(this.el);
    this.last = '';
    this.lastBox = '';
  }

  /**
   * ゲーム画面のすぐ上へ置き直す。**画面の外へはみ出さない**ように上で止める
   * (拡大率を上げると canvas が窓いっぱいになり、上に空きが無くなるため)
   */
  _place() {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect();
    const h = this.el.offsetHeight || 0;
    const box = r.left + ',' + r.top + ',' + h;
    if (box === this.lastBox) return;
    this.lastBox = box;
    this.el.style.left = Math.round(r.left) + 'px';
    this.el.style.top = Math.round(Math.max(2, r.top - h - 4)) + 'px';
  }

  /**
   * 毎コマ呼ぶ。**中身が変わったときだけ書き換える**。
   * @param {Record<string, {state:string,timer:number,nextName:()=>string}|null|undefined>} machines
   *   `{ 見出し: 機械 }`。機械が無いものは飛ばす(まだ作られていない技など)
   */
  tick(machines) {
    const lines = [];
    for (const [label, fsm] of Object.entries(machines || {})) {
      if (!fsm) continue;
      // 残りは `for` のある局面だけ。無い局面は「-」(何かが起きるまで居座る)
      const left = fsm.timer >= 0 ? String(fsm.timer) : '-';
      lines.push(label + ' ' + fsm.state + '  残り ' + left + '  → ' + fsm.nextName());
    }
    const text = lines.join('\n');
    if (text !== this.last) {
      this.last = text;
      this.el.textContent = text;
      this.el.style.display = text ? 'block' : 'none';
    }
    // 画面の大きさが変わることがあるので、置き場所は毎コマ見る
    // (変わっていなければ何も書き換えない)
    if (text) this._place();
  }

  /** 片づける(場面を抜けるときなど) */
  clear() { this.tick(null); }
}
