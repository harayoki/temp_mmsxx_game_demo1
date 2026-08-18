// **画面なしで回る**ことだけを見る、いちばん小さい試験。
//   node test/headless-smoke.mjs
import { MMSXXEngine } from '../engine/engine.js';

const t0 = Date.now();
const m = new MMSXXEngine(null, { screen: { width: 256, height: 192 } });
console.log('headless =', m.headless);

// 絵は**記号にしてから**渡す(素の RGBA は受けない決まり)
const rgba = new Uint8ClampedArray(16 * 16 * 4);
for (let i = 0; i < 16 * 16; i++) { rgba[i * 4] = 255; rgba[i * 4 + 3] = 255; }
const sym = m.spriteSymbol({ width: 16, height: 16, data: rgba });
const sp = m.sprite(sym);
sp.x = 10; sp.y = 20;

let ticks = 0;
m.run(() => { ticks++; sp.x = (sp.x + 1) & 255; });
console.log('run() のあと frame =', m.frame, '(画面が無いので回らない)');

m.advance(10000);
console.log('advance(10000) → frame =', m.frame, '/ ticks =', ticks, '/ sp.x =', sp.x);
console.log('かかった時間 =', Date.now() - t0, 'ms');
