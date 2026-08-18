// **面の頭へ戻せるか**を、画面なしで見る試験。
//   node test/rewind.mjs
import { installDomStub } from './dom-stub.mjs';
const { window: win } = installDomStub();
await import('../game/main.js');
const m = win.mmsxx, dbg = win.mmsxxDebug;

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  OK   ' : '  NG   ') + name + (extra ? '  ' + extra : ''));
  if (!ok) bad++;
};

// 3 面のボスから始めて、点と装備を積む
win.mmsxxBoss(3);
m.advance(60);
const before = { stage: dbg().stageNo, score: dbg().score, gear: { ...dbg().gear } };
console.log('  控えた時点 =', JSON.stringify(before));
win.mmsxxMark();

// **控えたあとで、実際に別の面へ移ってしまう。**
// (画面なしでは点が動かないので、確実に変わるものでやり直しを試す)
win.mmsxxBoss(1);
m.advance(60);
const moved = { stage: dbg().stageNo, score: dbg().score };
console.log('  やり直す前 =', JSON.stringify(moved));
if (moved.stage === before.stage) { console.log('  NG   下ごしらえが効いていない'); process.exit(1); }

const msg = win.mmsxxRewind();
m.advance(2);
const after = { stage: dbg().stageNo, score: dbg().score, gear: { ...dbg().gear } };
console.log(' ', msg);

check('面が戻る', after.stage === before.stage, after.stage + ' / ' + before.stage);
check('点が戻る', after.score === before.score, after.score + ' / ' + before.score);
check('装備が戻る', JSON.stringify(after.gear) === JSON.stringify(before.gear),
  JSON.stringify(after.gear));
check('遊びが続いている', dbg().state === 'play', dbg().state);

console.log(bad === 0 ? '\n通りました' : `\n${bad} 件 だめでした`);
process.exit(bad === 0 ? 0 : 1);
