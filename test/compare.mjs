// **前の版と挙動が変わっていないかを、遊ばずに確かめる。**
//
//   node test/compare.mjs        … 全部の面
//   node test/compare.mjs 3      … 3 面だけ
//   node test/compare.mjs 3 --tally … 当たり方(何発どこに当たったか)も並べる
//
// 決め打ちの操作台本を流して、節目ごとの数字を書き出すだけ。
// 同じものを前の版でも流して diff にかけると、
// **食い違った最初のコマ番号がそのまま出る**。何度も遊んで見比べなくてよい。
//
// 前の版を用意するには、タグから作業ツリーを出して、
// **画面なしで回せるエンジンだけ今のものに差し替える**(それ以外は触らない):
//
//   git worktree add ../rel engine-v0.50
//   cp -r vendor/mmsxx-mml-studio/sound ../rel/vendor/mmsxx-mml-studio/
//   cp game/gamedata.js ../rel/game/
//   cp engine/engine.js engine/input.js engine/video.js ../rel/engine/
//   mkdir ../rel/_h && cp test/dom-stub.mjs test/compare.mjs ../rel/_h/
//   ( cd ../rel && node _h/compare.mjs 3 ) > rel.tsv
//   node test/compare.mjs 3 > now.tsv && diff rel.tsv now.tsv
//
// **面ごとに別プロセスで回すこと。**自機の位置は面をまたいで残るので、
// 前の面の食い違いが次の面の見かけの違いになる。
//
// **入力はゲームの様子を見ない**(open loop)。ボスの位置を追いかけて撃つと、
// ほんの少しの違いがそこから雪だるまになって、どこが最初かが読めなくなる。
import { installDomStub } from './dom-stub.mjs';
const { window: win } = installDomStub();
await import('../game/main.js');
const m = win.mmsxx;

const SEED = 20260819;
const PER_BOSS = 900;     // 1 体につき回すコマ数
const SAMPLE = 30;        // 何コマごとに書き出すか

/** 何コマ目にどのキーを押しているか。**ゲームの様子は見ない** */
function keysAt(t) {
  const on = [];
  if (t % 3 === 0) on.push('Space');              // 3 コマに 1 回撃つ
  const phase = Math.floor(t / 50) % 4;           // 右→下→左→上 をくり返す
  on.push(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'][phase]);
  return on;
}

const num = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : '');

// **当たり方まで見るか。**既定は見ない —
// 数える口(mmsxxTally)が無い古い版と突き合わせるときに、全部の行が食い違ってしまう。
// 両方に口があるとき(これから先どうしの比較)だけ --tally を付ける
const WITH_TALLY = process.argv.includes('--tally');
const TALLY_KEYS = ['weak', 'hard', 'head', 'body', 'shield', 'muzzle', 'flame', 'dmg'];

/**
 * ボスが何をされたかを 1 列に畳む。**局面をまたいで合計する** —
 * 局面ごとの内訳は mmsxxTally() で見ればよく、ここで見たいのは
 * 「当たり方そのものが変わっていないか」だけ。
 * 体力と位置しか見ていないと、**当たる場所が変わっても結果が同じなら気づけない**
 */
function tallyCol() {
  const t = win.mmsxxTally && win.mmsxxTally();
  if (!t) return TALLY_KEYS.map(() => 0).join('/');
  const sum = {};
  for (const [k, row] of Object.entries(t)) {
    if (typeof row !== 'object') continue;   // 種類 などの見出し
    for (const [w, v] of Object.entries(row)) sum[w] = (sum[w] || 0) + v;
  }
  return TALLY_KEYS.map((k) => Math.round(sum[k] || 0)).join('/');
}

function digest(frame) {
  const d = win.mmsxxDebug();
  const b = d.boss || {};
  const mo = d.moai || {};
  return [
    frame, d.state, d.stageNo, num(d.playerX), d.bullets, d.stars,
    b.kind || '-', num(b.hp), num(b.bx), num(b.by), b.phase2 ? 1 : 0,
    mo.hp === undefined ? '-' : num(mo.hp), mo.angry ? 1 : 0,
  ].concat(WITH_TALLY ? [tallyCol()] : []).join('\t');
}

const lines = [];
let frame = 0;
// 面を 1 つだけ渡せる。**別プロセスで回すと持ち越しが消える** —
// 自機の位置は面をまたいで残るので、前の面の違いが次の面の見かけの違いになる
const only = Number(process.argv[2]);
for (const n of (only ? [only] : [1, 2, 3, 4, 5, 6, 103])) {
  // **ボスごとに種を撒き直す。**そうしないと、1 体目の食い違いが
  // あとの全部へ波及して、どこが最初かが読めなくなる
  m.rng.seed(SEED);
  win.mmsxxBoss(n);
  for (let i = 0; i < PER_BOSS; i++) {
    const on = keysAt(i);
    for (const k of on) m.input.press(k);
    m.advance(1);
    for (const k of on) m.input.release(k);
    frame++;
    if (i % SAMPLE === 0) lines.push('stage' + n + '\t' + digest(i));
  }
}
console.log(lines.join('\n'));
