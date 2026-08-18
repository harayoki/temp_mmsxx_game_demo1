// **クリアしたら背景が減速して止まるか**を、画面なしで見る。
//   node test/bg-stop.mjs
//
// 面ごとに録った動画をつなぐとき、継ぎ目で背景が飛ぶと目立つ。
// 結果画面のあいだ宇宙が止まっていれば、そこが必ず同じ絵になる。
import { installDomStub } from './dom-stub.mjs';
const { window: win } = installDomStub();
await import('../game/main.js');
const m = win.mmsxx;

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  OK   ' : '  NG   ') + name + (extra ? '  ' + extra : ''));
  if (!ok) bad++;
};

const near = m.layer(2);
const speed = (frames = 30) => {
  const a = near.scrollY;
  m.advance(frames);
  return Math.abs(near.scrollY - a) / frames;
};

win.mmsxxBoss(1);
m.advance(60);
const running = speed();
check('遊んでいるあいだは流れている', running > 1.5, running.toFixed(2) + ' ドット/コマ');

console.log(' ', win.mmsxxClear());
const during = speed(40);      // 減速のさなか
m.advance(80);                 // 落ちきるまで待つ(減速は 90 コマ)
const stopped = speed(60);     // 落ちきったあと
check('クリアで減速する', during < running, during.toFixed(2) + ' ドット/コマ');
check('結果画面では止まっている', stopped === 0, stopped.toFixed(2) + ' ドット/コマ');

console.log(bad === 0 ? '\n通りました' : `\n${bad} 件 だめでした`);
process.exit(bad === 0 ? 0 : 1);
