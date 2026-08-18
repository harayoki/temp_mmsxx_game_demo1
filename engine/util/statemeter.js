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
   * @param {{corner?:'tl'|'tr'|'bl'|'br', color?:string}} [opts]
   *   corner = 出す隅(既定は左下。右上は FpsMeter が使う)
   */
  constructor(opts = {}) {
    this.el = document.createElement('div');
    const corner = opts.corner || 'bl';
    Object.assign(this.el.style, {
      position: 'fixed',
      [corner[0] === 't' ? 'top' : 'bottom']: '4px',
      [corner[1] === 'l' ? 'left' : 'right']: '4px',
      font: '12px monospace',
      color: opts.color || '#7f7',
      background: 'rgba(0,0,0,.55)',
      padding: '2px 6px',
      borderRadius: '4px',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: 9999,
      display: 'none',
    });
    document.body.appendChild(this.el);
    this.last = '';
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
    if (text === this.last) return;
    this.last = text;
    this.el.textContent = text;
    this.el.style.display = text ? 'block' : 'none';
  }

  /** 片づける(場面を抜けるときなど) */
  clear() { this.tick(null); }
}
