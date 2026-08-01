// 生成した絵をターミナルに文字で表示して形を確認する(開発用)
// 使い方: node assets-src/preview.mjs crabR bossHead
import { GAME_DATA } from '../game/gamedata.js';

const names = process.argv.slice(2);
const CHARS = ' .:-=+*#%@$&0123456789';

for (const name of names) {
  const im = GAME_DATA.images[name];
  if (!im) { console.log(name + ': ない'); continue; }
  const bin = Buffer.from(im.b64, 'base64');
  const colors = new Map();     // 'r,g,b' -> 文字
  const rows = [];
  for (let y = 0; y < im.height; y++) {
    let line = '';
    for (let x = 0; x < im.width; x++) {
      const o = (y * im.width + x) * 4;
      if (bin[o + 3] < 128) { line += ' '; continue; }
      const key = bin[o] + ',' + bin[o + 1] + ',' + bin[o + 2];
      if (!colors.has(key)) colors.set(key, CHARS[colors.size + 1] || '?');
      line += colors.get(key);
    }
    rows.push(line);
  }
  console.log('=== ' + name + ' (' + im.width + 'x' + im.height + ') ===');
  console.log(rows.join('\n'));
  console.log('色: ' + [...colors].map(([k, c]) => c + '=' + k).join('  '));
}
