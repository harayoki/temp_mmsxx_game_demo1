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
for (const kind of ['crab', 'dragon', 'king', 'kingActs', 'nautilus', 'moai', 'octopus', 'octoGun', 'todo']) {
  const decl = win.mmsxxStates(kind);
  check(kind + ': 宣言を取り出せる', !!decl, decl ? decl.names.join(' / ') : '');
  check(kind + ': 宣言に粗が無い', decl && decl.bad.length === 0, decl ? decl.bad.join(' / ') : '');
  check(kind + ': 図を吐ける', !!decl && decl.mermaid.includes('stateDiagram-v2'));
}

// ---- 2. 挙動確認の面(いちばん先にやる) ----
//
// **動かない的を決まった場所に並べた面**(`mmsxxBoss(110)`)。
// ふつうの面は敵の湧きが時間まかせで、狙ったものに当てられない。
//
// **自機を定位置へ置くのが肝。** `mmsxxBoss()` で入ると自機は前にいた場所
// (たいてい画面の上)のままで、上へ飛ぶ弾が的に永久に届かない。
// これに気づかず「当たらない」を何度も読み違えた。
let diag = '';
const shotAt = (X) => {
  win.mmsxxBoss(110);
  m.advance(90);
  for (let i = 0; i < 500; i++) {
    const cur = win.mmsxxHitTargets().find((z) => z.x === X);
    if (!cur || !cur.生きている) return i;
    const d = win.mmsxxDebug();
    // **幅を広めに取る。**狭いと自機が行き過ぎて往復し、撃つ回数が安定しない
    if (d.playerX < X - 5) m.input.press('ArrowRight');
    else if (d.playerX > X + 5) m.input.press('ArrowLeft');
    m.input.press('Space');
    m.advance(1);
    m.input.release('Space'); m.input.release('ArrowRight'); m.input.release('ArrowLeft');
    m.advance(1);
    // 撃ったあとにも見る(最後の 1 発で壊れたのを取りこぼさない)
    const now2 = win.mmsxxHitTargets().find((z) => z.x === X);
    if (!now2 || !now2.生きている) return i + 1;
  }
  const d = win.mmsxxDebug();
  diag = '自機 ' + d.playerX + ',' + d.playerY + ' / ' + d.state + ' / 弾 ' + d.bullets
    + ' / 的 ' + win.mmsxxHitTargets().map((z) => z.x + (z.生きている ? '' : '×')).join(' ');
  return -1;
};

win.mmsxxBoss(110);
m.advance(2);
const targets = win.mmsxxHitTargets();
check('的が並ぶ', targets.length >= 5, targets.map((t) => t.種類 + t.型).join(' '));

const before = win.mmsxxHitTargets().map((t) => t.x + ',' + t.y).join(' ');
m.advance(600);
const after = win.mmsxxHitTargets().map((t) => t.x + ',' + t.y).join(' ');
check('的は動かない', before === after, after);

// **数えるのは 1 回だけ。**呼ぶたびに入り直すので、2 回呼ぶと判定と表示がずれる
const soft = shotAt(24), hard = shotAt(104), ring = shotAt(32), plain = shotAt(72);
check('やわらかい敵は壊せる', soft > 0, soft + ' 回 ' + (soft < 0 ? diag : ''));
check('硬い敵のほうが手数が要る', hard > soft, hard + ' 回');
check('撃ち落とせる弾は落とせる', ring > 0, ring + ' 回');
check('撃ち落とせない弾は残る', plain === -1, plain === -1 ? '残った' : '落ちた');

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

// ハサミを撃ち尽くすと跳ぶ(jump)。何コマで跳ぶかは狙いが合うかどうか次第。
//
// **跳ぶのは最初の 1 回だけ**なので、「跳んだか」と「渡りきったか」を
// 1 回の走査で拾う。あとから jump を待ち直すと、もう来なくて空振りする
let wasJump = false, afterJump = null;
for (let i = 0; i < 3600 && !afterJump; i++) {
  m.advance(1);
  const s = now();
  seen.add(s);
  if (s === 'jump') wasJump = true;
  else if (wasJump) afterJump = s;
}
check('いずれ jump へ移る', wasJump, [...seen].join(' -> '));
check('渡りきると attach へ戻る', afterJump === 'attach', String(afterJump));

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

// ---- 4. ラスボスの段階 ----
//
// open -> rift は時間で、rift -> break は**撃ち抜いたとき**だけ。
// そこから先は時間で pose -> man まで進む
win.mmsxxBoss(5);
const stage = () => win.mmsxxDebug().boss.stage;
check('ラスボスは open から', stage() === 'open', stage());

for (let i = 0; i < 400 && stage() === 'open'; i++) m.advance(1);
check('裂け目が開くと rift', stage() === 'rift', stage());

// 撃ち抜くまでは rift のまま(時間では進まない)
m.advance(600);
check('撃つまで rift のまま', stage() === 'rift', stage());

win.mmsxxKing('break');
check('撃ち抜くと break', stage() === 'break', stage());

for (let i = 0; i < 400 && stage() !== 'man'; i++) m.advance(1);
check('break から man まで進む', stage() === 'man', stage());

// ---- 5. ラスボスの技 ----
//
// 第 2 段階に入ってからの 8 つ。**もとは act の 6 つに加えて
// `meditate` と `stun` を数え上げで持っていた**ので、「いま技を出せるのか」が
// その組み合わせに散っていた。並べたぶん、1 つずつ確かめられる
const act = () => win.mmsxxDebug().boss.act;
for (let i = 0; i < 400 && stage() !== 'man'; i++) m.advance(1);
check('第 2 段階に入ったコマはまだ戦わない', act() === null, String(act()));
m.advance(1);
check('その次のコマから技が始まる', act() === 'idle', String(act()));

// ふつうに回していると出る技(サマーソルトと座禅は条件つきなので出ない)
const acts = new Set([act()]);
for (let i = 0; i < 3000; i++) { m.advance(1); acts.add(act()); }
check('蹴りと波動がひととおり出る',
  ['idle', 'orbit', 'kickCircle', 'kickWind', 'kick'].every((a) => acts.has(a)),
  [...acts].join(' / '));

// 珍しい技は mmsxxState で飛ばして確かめる。
// **ピヨりから明けたら、その場で 1 発返してくる**のがここの見どころ
for (const [name, want] of [['moon', 'idle'], ['meditate', 'idle'], ['stun', null]]) {
  win.mmsxxState(name, 'act');
  const seen = [act()];
  for (let i = 0; i < 900 && seen.length < 2; i++) {
    m.advance(1);
    if (seen[seen.length - 1] !== act()) seen.push(act());
  }
  const ok = seen[0] === name && (want ? seen[1] === want : ['moon', 'kickWind'].includes(seen[1]));
  check(name + ' から抜けられる', ok, seen.join(' -> '));
}

// ---- 6. オウムガイとモアイ ----
//
// オウムガイはもとは `arrived` と `phase2` の**旗 2 つの組み合わせ**、
// モアイは `hold` / `wait` / `timer` の**どれが残っているか**で局面を表していた
win.mmsxxBoss(4);
const naut = () => win.mmsxxState().stage;
check('オウムガイは arrive から', naut() === 'arrive', naut());
for (let i = 0; i < 300 && naut() === 'arrive'; i++) m.advance(1);
check('降りきると guard', naut() === 'guard', naut());
win.mmsxxState('core');
m.advance(60);
check('装甲が外れると core', naut() === 'core', naut());

// モアイは遊んでいる最中に出る中ボス。合体するまでを順に通る
win.mmsxxBoss(1);
m.advance(1);
win.mmsxxMoai();
const moai = () => { const o = win.mmsxxDebug().moai; return o && o.state; };
const shape = () => { const o = win.mmsxxDebug().moai; return o && o.shape; };
const path = [moai()];
for (let i = 0; i < 4000; i++) {
  m.advance(1);
  const s = moai();
  if (s && path[path.length - 1] !== s) path.push(s);
}
check('モアイが順に合体する',
  ['hold', 'merge1', 'wait', 'merge2', 'one', 'leave'].every((s, i) => path[i] === s),
  path.join(' -> '));

// ---- 7. タコと未実装さん ----
//
// タコはもとは `charging` と `firing` の**数え上げが残っているか**で局面を
// 表していて、動きの側も当たり判定の側も `charging > 0 || firing > 0` と書いていた
win.mmsxxBoss(6);
const octo = () => win.mmsxxState().act;   // レーザーは別の機械
const cycle = [octo()];
for (let i = 0; i < 2500; i++) {
  m.advance(1);
  if (cycle[cycle.length - 1] !== octo()) cycle.push(octo());
}
check('タコがレーザーを回す',
  ['wait', 'charge', 'fire', 'wait'].every((s, i) => cycle[i] === s),
  cycle.slice(0, 4).join(' -> '));

// 未実装さんは攻撃してこない仮ボス。降りて漂うだけ
win.mmsxxBoss(103);   // RUSH_TODO(仮ボスの面)
const todo = () => win.mmsxxState().stage;
check('未実装さんは arrive から', todo() === 'arrive', todo());
for (let i = 0; i < 300 && todo() === 'arrive'; i++) m.advance(1);
check('降りきると drift', todo() === 'drift', todo());

// ---- 8. 装甲を壊す道は、どのボスでも通るか ----
//
// `breakShip()` は**ボス共通の入り口**で、体力が 2 割を切ったときにも呼ばれる。
// ここへタコ専用の `go('swing')` を置いてしまい、カニで例外になったことがある。
// 局面の名前はボスごとに違うので、**共通の道から go() を呼ぶときは種類を見る**
for (const [name, n] of [['crab', 2], ['dragon', 3], ['nautilus', 4],
  ['king', 5], ['octopus', 6], ['todo', 103]]) {
  win.mmsxxBoss(n);
  m.advance(2);
  let err = null;
  try {
    win.mmsxxPhase2();
    m.advance(60);
  } catch (e) { err = String(e.message || e); }
  check(name + ': 装甲を壊しても落ちない', !err, err || win.mmsxxState().stage);
}

// ---- 9. モアイは怒らせたら帰りきるか ----
//
// 局面を宣言に移したとき、**当たり判定の側の `moai.state` を 11 か所取りこぼした**。
// 形は moaiShape() から導くようにしたので、持ちものは残っていない。
// (`undefined === 'q2'` は黙って false になるだけなので、
//  エラーも出ずに「撃っても怒らない」という形で出た)
win.mmsxxBoss(1);
m.advance(1);
win.mmsxxMoai();
m.advance(2);
check('形を導ける', win.mmsxxDebug().moai.shape === 'q4', String(win.mmsxxDebug().moai.shape));

win.mmsxxMoai('angry');
const angry = win.mmsxxDebug().moai;
check('怒らせられる', !!angry.angry, JSON.stringify({ angry: angry.angry, state: angry.state }));

// 怒ったら 30 秒で帰る。**帰りきって片づく**か
// (leave のまま画面に居座るのを見つけるため、消えるまで回す)
let left = false;
for (let i = 0; i < 3600; i++) {
  m.advance(1);
  if (!win.mmsxxDebug().moai) { left = true; break; }
}
check('怒ったら帰りきって片づく', left,
  left ? '片づいた' : ('居座り: ' + JSON.stringify(win.mmsxxDebug().moai.state)));

// ---- 10. ドラゴンに弾が通るか ----
//
// 局面ごとに通り方が変わる相手なので、**実際に撃って削れるか**を見る。
//   突進の口 > ふだんの目 > 構え中の顔 > 胴(0)
// 「宣言は正しいのに当たり判定の側が古い」たぐいは、これでしか見つからない
// 倒しきってしまうと boss が消えるので、そのときは「じゅうぶん通った」とみなす
const dragonHp = () => { const b = win.mmsxxDebug().boss; return b ? b.hp : 0; };

/**
 * ドラゴンの真下へ寄りながら撃ち、減ったぶんを返す。
 * **自機は左端から始まる**ので、狙わせないと弾がどこにも当たらない
 * (これに気づかず「通らない」と読み違えたことがある)
 */
// **局面は固定しない。** go() で引き戻すと exit が走って頭が飛ぶので、
// 弾が当たらなくなる。ふつうに戦わせて、通しで削れるかを見る
const shootDragon = (n) => {
  win.mmsxxBoss(3);
  m.advance(90);            // 登場が終わるまで
  const before = dragonHp();
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const d = win.mmsxxDebug();
    if (!d.boss) break;
    seen.add(win.mmsxxState().stage);
    const aim = d.boss.bx + 16;   // 頭のまん中へ寄る
    if (d.playerX < aim - 2) m.input.press('ArrowRight');
    else if (d.playerX > aim + 2) m.input.press('ArrowLeft');
    m.input.press('Space');
    m.advance(1);
    m.input.release('Space');
    m.input.release('ArrowRight');
    m.input.release('ArrowLeft');
    m.advance(1);
  }
  return { 減り: before - dragonHp(), 通った局面: [...seen].join(' ') };
};

const shot = shootDragon(600);
check('狙って撃てば削れる', shot.減り > 0,
  '減ったぶん ' + shot.減り.toFixed(1) + ' / ' + shot.通った局面);

console.log(bad ? '\n' + bad + ' 件おかしい' : '\n通りました');
process.exit(bad ? 1 : 0);
