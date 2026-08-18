// **片づけ忘れの検出。**
//   node test/leftover.mjs
//
// 場面を抜けたのに、その場面のスプライトが残っていないかを見る。
// 「青い裂け目が次のゲームまで残る」たぐいは、これで自動で見つかる。
//
// **数えるのは残数だけ。** 誰が何を持っているかは見ない ──
// 見ようとすると、ゲームの中身を試験が知っていることになって、
// ゲームを直すたびに試験も直す羽目になる。
import { installDomStub } from './dom-stub.mjs';
const { window: win } = installDomStub();
await import('../game/main.js');
const m = win.mmsxx;

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  OK   ' : '  NG   ') + name + (extra ? '  ' + extra : ''));
  if (!ok) bad++;
};
const count = () => ({ sp: m.vdp.sprites.size, bg: m.vdp.bgSprites.size });
const show = (c) => 'スプライト ' + c.sp + ' / BG ' + c.bg;

// タイトルに居るときの数を「土台」とする。
// ここから増えたものは、その場面が作ったもの
m.advance(120);
const base = count();
console.log('  タイトルでの土台 =', show(base));

// **ボスを 1 体ずつ出して、タイトルへ戻したときに戻るか。**
// 面ごとに見るのは、片づけ忘れがボスの部位で起きやすいため
const stages = [1, 2, 3, 4, 5];
for (const n of stages) {
  win.mmsxxBoss(n);
  m.advance(600);
  const during = count();
  win.mmsxxTitle ? win.mmsxxTitle() : null;
  m.advance(240);
  const after = count();
  const ok = after.sp <= base.sp && after.bg <= base.bg;
  check('STAGE ' + n + ' のあと片づく', ok,
    '出ていた ' + show(during) + ' → 戻り ' + show(after));
}

console.log(bad === 0 ? '\n通りました' : `\n${bad} 件 だめでした`);
process.exit(bad === 0 ? 0 : 1);
