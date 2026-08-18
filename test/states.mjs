// **局面の宣言をたしかめる。**
//   node test/states.mjs
//
// 宣言(`CRAB_STATES` など)が 1 か所にあるので、**書いたものがそのまま試験になる**。
// 見るのは 2 つ。
//
// 1. **宣言そのものの粗さがし** … 行き先の綴り間違い、誰も来ない局面、
//    いつ移るのか決まらない局面。`StateMachine.check()` がやる
// 2. **実際に回るか** … カニロボを出して、宣言どおりの順で局面が移るか。
//    宣言だけ直して呼ぶ側を直し忘れる、の逆(呼ぶ側だけ直す)も見つかる
import { installDomStub } from './dom-stub.mjs';
const { window: win } = installDomStub();
await import('../game/main.js');
const m = win.mmsxx;

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? '  OK   ' : '  NG   ') + name + (extra ? '  ' + extra : ''));
  if (!ok) bad++;
};

// ---- 1. 宣言そのもの ----
for (const kind of ['crab', 'dragon']) {
  const decl = win.mmsxxStates(kind);
  check(kind + ': 宣言を取り出せる', !!decl, decl ? decl.names.join(' / ') : '');
  check(kind + ': 宣言に粗が無い', decl && decl.bad.length === 0, decl ? decl.bad.join(' / ') : '');
  check(kind + ': 図を吐ける', !!decl && decl.mermaid.includes('stateDiagram-v2'));
}

// ---- 2. 実際に回るか ----
// カニロボは 2 面のボス。出したあと、**上から降りてくる(enter)** ので、
// しばらく回せば必ず壁に着く(attach)
win.mmsxxBoss(2);
const now = () => win.mmsxxDebug().boss.mode;

check('出したては enter', now() === 'enter', now());

// 壁に着くまで。降りる速さは 1 コマ 1 ドットなので、遅くとも 200 コマで着く
let seen = new Set([now()]);
for (let i = 0; i < 200 && now() === 'enter'; i++) { m.advance(1); seen.add(now()); }
check('降りきると attach', now() === 'attach', now());

// ハサミを撃ち尽くすと跳ぶ(jump)。撃つには自機と高さが合う必要があるので、
// **待つのではなく、跳ぶ条件をそろえて**確かめる。
// 何コマで跳ぶかは狙いが合うかどうか次第なので、上限だけ決めて回す
for (let i = 0; i < 3600 && !seen.has('jump'); i++) { m.advance(1); seen.add(now()); }
check('いずれ jump へ移る', seen.has('jump'), [...seen].join(' -> '));

// 渡りきったら壁へ戻る
for (let i = 0; i < 600 && now() === 'jump'; i++) m.advance(1);
check('渡りきると attach へ戻る', now() === 'attach', now());

// 甲羅が割れたら、どの局面からでも float。**行き止まり**なので戻らない
win.mmsxxCrabPhase2();
check('甲羅が割れると float', now() === 'float', now());
m.advance(120);
check('float は行き止まり', now() === 'float', now());

// ---- 3. ドラゴンの怒りが最後まで通るか ----
//
// **もとは `rage` の中を `hide` と `telegraph` の数え上げで分けていて**、
// 「突っ込んできているあいだ」が当たり判定の側にも写っていた。
// 開いたぶん、ここで**順に並ぶこと**をそのまま確かめられる
win.mmsxxBoss(3);
check('ドラゴンは spiral から', now() === 'spiral', now());

const order = [now()];   // 移った先だけを順に拾う
for (let i = 0; i < 3600 && !order.includes('descend'); i++) {
  m.advance(1);
  if (order[order.length - 1] !== now()) order.push(now());
}
const want = ['spiral', 'leave', 'hide', 'telegraph', 'charge', 'rest', 'descend'];
check('怒りが順に進む', want.every((s, i) => order[i] === s), order.join(' -> '));

console.log(bad ? '\n' + bad + ' 件おかしい' : '\n通りました');
process.exit(bad ? 1 : 0);
