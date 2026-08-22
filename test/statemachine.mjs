// **道具そのものの試験。**ゲームもブラウザも使わない。
//   node test/statemachine.mjs
//
// [test/states.mjs](states.mjs) が見るのは「ゲームの宣言が正しいか」で、
// こちらは「**道具が宣言どおりに動くか**」。これから新しいゲームの土台にするので、
// 移る順・数えかた・粗さがし を 1 つずつ確かめておく。
import { StateMachine } from '../engine/util/statemachine.js';

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  OK   ' : '  NG   ') + name + (extra ? '  ' + extra : ''));
  if (!ok) bad++;
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify(got) + (JSON.stringify(got) === JSON.stringify(want) ? '' : ' ≠ ' + JSON.stringify(want)));

// ---- 1. 入る・いる・出る の順 ----
{
  const log = [];
  const defs = {
    a: {
      enter: () => log.push('a入'), update: () => log.push('a中'), exit: () => log.push('a出'),
      for: 2, next: 'b',
    },
    b: { enter: () => log.push('b入'), update: () => log.push('b中') },
  };
  const fsm = new StateMachine(defs, { name: '順' });
  fsm.step({}); fsm.step({}); fsm.step({});
  // **移ったコマは移った先を走らせない。**行き先が決まるのはコマの終わり
  eq('入る・いる・出る の順', log, ['a入', 'a中', 'a中', 'a出', 'b入', 'b中']);
}

// ---- 2. for はきっかりそのコマ数 ----
{
  const fsm = new StateMachine({ a: { for: 3, next: 'b' }, b: {} });
  for (let i = 0; i < 3; i++) fsm.step({});
  check('for: 3 は 3 コマで移る', fsm.is('b'), fsm.state);
}
{
  const fsm = new StateMachine({ a: { for: 3, next: 'b' }, b: {} });
  fsm.step({}); fsm.step({});
  check('for: 3 は 2 コマでは移らない', fsm.is('a'), fsm.state);
}
{
  // **その場で次へ。**0 ちょうどで見ていたころは素通りしていた
  const fsm = new StateMachine({ a: { for: 0, next: 'b' }, b: {} });
  fsm.step({});
  check('for: 0 はその場で移る', fsm.is('b'), fsm.state);
}

// ---- 3. for を関数で書く(相手が要る) ----
{
  const ctx = { len: 2 };
  const fsm = new StateMachine({ a: { for: (c) => c.len, next: 'b' }, b: {} }, { ctx });
  fsm.step(ctx); fsm.step(ctx);
  check('for を関数で書ける', fsm.is('b'), fsm.state);
}
{
  // **相手が分からないときは -1。**宣言だけ見たいとき(粗さがしや図)はここを通る
  const fsm = new StateMachine({ a: { for: (c) => c.len, next: 'b' }, b: {} });
  eq('相手が無ければ長さは -1', fsm.timer, -1);
}

// ---- 4. when と to ----
{
  const c = { go: false };
  const fsm = new StateMachine({ a: { when: (x) => x.go, next: 'b' }, b: {} });
  fsm.step(c);
  check('when が偽なら移らない', fsm.is('a'), fsm.state);
  c.go = true;
  fsm.step(c);
  check('when が真なら移る', fsm.is('b'), fsm.state);
}
{
  const c = { pick: null };
  const fsm = new StateMachine({
    a: { goes: ['b', 'c'], to: (x) => x.pick }, b: {}, c: {},
  });
  fsm.step(c);
  check('to が偽を返すうちは移らない', fsm.is('a'), fsm.state);
  c.pick = 'c';
  fsm.step(c);
  check('to の返した先へ移る', fsm.is('c'), fsm.state);
}
{
  // **for -> when -> to の順。**先に決まったものが勝つ
  const fsm = new StateMachine({
    a: { for: 1, next: 'b', when: () => true, goes: ['c'], to: () => 'c' }, b: {}, c: {},
  });
  fsm.step({});
  check('for が when と to に勝つ', fsm.is('b'), fsm.state);
}

// ---- 5. 合図(cues) ----
{
  const got = [];
  const fsm = new StateMachine(
    { a: { for: 5, next: 'b', cues: { 3: 'みっつ', 1: 'ひとつ' } }, b: {} },
    { on: (name) => got.push(name) });
  for (let i = 0; i < 5; i++) fsm.step({});
  // 合図は**残り**で書く。近づいてくる数字のほうが読みやすい
  eq('合図が残りの数で鳴る', got, ['みっつ', 'ひとつ']);
}

// ---- 6. go() ----
{
  const log = [];
  const fsm = new StateMachine({
    a: { enter: () => log.push('a入'), exit: () => log.push('a出') },
    b: { enter: () => log.push('b入') },
  });
  fsm.step({});          // a に入る
  fsm.go('b', {});
  fsm.step({});
  // **割り込んでも後始末は飛ばさない**
  eq('go() でも出る・入るを通る', log, ['a入', 'a出', 'b入']);
}
{
  const fsm = new StateMachine({ a: {} });
  let threw = false;
  try { fsm.go('無い', {}); } catch { threw = true; }
  check('知らない先へは飛ばせない', threw);
}
{
  // 入る前に go() したら、出るは走らない(まだ入っていないので)
  const log = [];
  const fsm = new StateMachine({ a: { exit: () => log.push('a出') }, b: {} });
  fsm.go('b', {});
  eq('入る前の go() では出るを呼ばない', log, []);
}

// ---- 7. 粗さがし ----
{
  const ok = new StateMachine({
    a: { for: 1, next: 'b' },
    b: { when: () => true, next: 'a' },
    c: { viaGo: true },
  });
  eq('健全な宣言は粗なし', ok.check(), []);
}
{
  const cases = [
    ['行き先が無い', { a: { for: 1, next: 'どこか' } }, '行き先が無い'],
    ['for があるのに行き先が無い', { a: { for: 1 } }, '行き先'],
    ['next があるのに いつ移るか決まらない', { a: { next: 'b' }, b: {} }, 'いつ移るのか'],
    ['cues は for が要る', { a: { when: () => 1, next: 'b', cues: { 1: 'x' } }, b: {} }, 'cues'],
    ['to があるのに goes が無い', { a: { to: () => null } }, 'goes が無い'],
    ['goes があるのに to が無い', { a: { goes: ['b'] }, b: {} }, 'to が無い'],
    ['誰も来ない局面', { a: { for: 1, next: 'a' }, b: {} }, '来る道が'],
  ];
  for (const [name, defs, hint] of cases) {
    const bads = new StateMachine(defs).check();
    check('粗さがし: ' + name, bads.some((x) => x.includes(hint)), bads.join(' / ') || '(見つからず)');
  }
}

// ---- 8. 図 ----
{
  const fsm = new StateMachine({
    a: { for: 2, next: 'b' },
    b: { goes: ['a'], to: () => 'a' },
    c: { viaGo: true },
  }, { name: 'ず' });
  const mer = fsm.toMermaid('ず');
  check('図が出る', mer.includes('stateDiagram-v2'));
  check('決まった移りは実線', mer.includes('a --> b'));
  check('to で選ぶ先は点線', mer.includes('b -.-> a'));
  // **go() でしか来ない局面も描く。**描かないと図から抜け落ちる
  check('go() でしか来ない局面も出る', mer.includes('GO -.-> c'), mer);
}

// ---- 9. 次の行き先の見せかた ----
{
  const fsm = new StateMachine({
    a: { for: 1, next: 'b' }, b: { goes: ['a', 'c'], to: () => null }, c: {},
  });
  eq('next はそのまま', fsm.nextName(), 'b');
  fsm.go('b', {});
  eq('to は候補を並べる', fsm.nextName(), 'a | c');
  fsm.go('c', {});
  eq('行き止まりは -', fsm.nextName(), '-');
}

// ---- 10. 移り変わりの記録 ----
{
  StateMachine.clearLog();
  StateMachine.logMax = 300;
  let now = 0;
  StateMachine.clock = () => now;
  const fsm = new StateMachine({ a: { for: 1, next: 'b' }, b: {} }, { name: '記録' });
  now = 10;
  fsm.step({});
  const h = StateMachine.history();
  check('記録に残る', h.length === 1 && h[0].includes('記録 a -> b'), h.join(' / '));
  check('コマ番号が入る', h[0].includes('10'), h[0]);
}
{
  // **本番では取らない。**logMax が 0 なら 1 つも積まない
  StateMachine.clearLog();
  StateMachine.logMax = 0;
  const fsm = new StateMachine({ a: { for: 1, next: 'b' }, b: {} }, { name: '止' });
  fsm.step({});
  eq('logMax が 0 なら取らない', StateMachine.log.length, 0);
  StateMachine.logMax = 300;
}

// ---- 11. is / in / 通ってきた道 ----
{
  const fsm = new StateMachine({ a: { for: 1, next: 'b' }, b: { for: 1, next: 'c' }, c: {} });
  check('is', fsm.is('a') && !fsm.is('b'));
  check('in', fsm.in('a', 'z') && !fsm.in('y', 'z'));
  fsm.step({}); fsm.step({});
  eq('通ってきた道', fsm.trail, ['a', 'b', 'c']);
}

// ---- 12. 中で飛んだとき ----
{
  const log = [];
  const fsm = new StateMachine({
    a: {
      update: (c, f) => { log.push('a中'); f.go('b', c); },
      exit: () => log.push('a出'),
    },
    b: { update: () => log.push('b中') },
  });
  fsm.step({});
  // **いるあいだの処理の中で飛んでも、そのコマで移った先は走らない**
  eq('update の中で飛べる', log, ['a中', 'a出']);
  fsm.step({});
  eq('次のコマから移った先が走る', log, ['a中', 'a出', 'b中']);
}

console.log(bad ? '\n' + bad + ' 件おかしい' : '\n通りました');
process.exit(bad ? 1 : 0);
