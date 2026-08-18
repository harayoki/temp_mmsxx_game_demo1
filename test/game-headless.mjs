// **STAR FABLE を画面なしで回す。**
//
//   node test/game-headless.mjs
//
// ここで見ているのは 2 つだけ。
//
//   1. **読み込みで落ちないか**(ゲーム本体は DOM を触るので、当て板が要る)
//   2. **タイトルから遊びへ入れるか**、そのあと詰まらずに回り続けるか
//
// 進めるのは `advance()`。時間も rAF も見ないので、**同じ入力から必ず同じ結果**
// になる(乱数は種つき)。回帰試験はここを土台にする。
import { installDomStub } from './dom-stub.mjs';

const { window: win } = installDomStub();
await import('../game/main.js');

const m = win.mmsxx;
const dbg = win.mmsxxDebug;
let bad = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  OK   ' : '  NG   ') + name + (extra ? '  ' + extra : ''));
  if (!ok) bad++;
};

check('ゲーム本体が読める', !!m);
check('画面を持たない', m && m.headless === true);
check('中を覗ける(mmsxxDebug)', typeof dbg === 'function');
if (!m || !dbg) process.exit(1);

check('はじめはタイトル', dbg().state === 'title', dbg().state);

// タイトルで SPACE を押して、遊びへ入る
m.advance(120);
m.input.press('Space');
m.advance(2);
m.input.release('Space');
m.advance(240);
check('SPACE で遊びへ入る', dbg().state === 'play', dbg().state);

// **詰まらずに回り続けるか。** 何もしないでいると自機はやられるが、
// 遊び直しへ戻って回り続けるはず(どこかで止まったら state が動かなくなる)
const t0 = Date.now();
const seen = new Set();
for (let i = 0; i < 60; i++) {
  m.advance(300);
  seen.add(dbg().state);
}
const ms = Date.now() - t0;
check('18000 コマ回っても止まらない', m.frame > 18000, m.frame + ' コマ / ' + ms + 'ms');
console.log('  通った場面 =', [...seen].join(', '));

console.log(bad === 0 ? '\n通りました' : `\n${bad} 件 だめでした`);
process.exit(bad === 0 ? 0 : 1);
