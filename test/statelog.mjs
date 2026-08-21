// **各ボスの局面の移り変わりを採る。**
//   node test/statelog.mjs           … 全部
//   node test/statelog.mjs 竜 2400   … 1 体だけ、コマ数を指定して
//
// 自機を**画面の下へ置いてから**狙って撃つ。ここが肝で、
// `mmsxxBoss()` で入っただけだと自機は前にいた場所(たいてい画面の上)のまま。
// 上へ飛ぶ弾が相手の下へ回り込めず、当たる場所が偏る
// (きんぐを「13 発とも頭に当たる」で読み違えた原因がこれ)。
//
// 出るのは 2 つ。
//   - **移り変わり** … 何コマ目に、どの機械が、どこからどこへ
//   - **されたこと** … 局面ごとに、どこへ何発当たって、どれだけ通ったか
//
// 短すぎる局面(技が数コマで終わっている)は、撃たれて崩されたということ。
// 記録に残っていない局面は、そこへ当てられていない。
import { installDomStub } from './dom-stub.mjs';
const { window: win } = installDomStub();
await import('../game/main.js');
const m = win.mmsxx;

const FRAMES = Number(process.argv[3] || 2400);
const only = process.argv[2];

const BOSSES = [
  ['タコ', 6], ['カニ', 2], ['竜', 3], ['貝', 4], ['王', 5], ['未実装', 103],
];

for (const [name, n] of BOSSES) {
  if (only && only !== name) continue;
  m.rng.seed(20260819);
  win.mmsxxBoss(n);
  if (n === 5) {
    // ラスボスは第 2 段階まで進めてから見る(技の機械はそこからしか動かない)
    for (let i = 0; i < 400 && win.mmsxxDebug().boss.stage !== 'rift'; i++) m.advance(1);
    win.mmsxxKing('break');
    for (let i = 0; i < 400 && win.mmsxxDebug().boss.stage !== 'man'; i++) m.advance(1);
  }
  m.advance(4);
  win.mmsxxPlacePlayer();
  const from = win.mmsxxLog(300).length;   // 記録は共有。ここから先だけ見る

  for (let i = 0; i < FRAMES; i++) {
    const d = win.mmsxxDebug();
    if (!d.boss) break;                    // 倒したら終わり
    const aim = d.boss.bx + 16;
    if (d.playerX < aim - 5) m.input.press('ArrowRight');
    else if (d.playerX > aim + 5) m.input.press('ArrowLeft');
    m.input.press('Space');
    m.advance(1);
    m.input.release('Space'); m.input.release('ArrowRight'); m.input.release('ArrowLeft');
    m.advance(1);
  }

  const mine = win.mmsxxLog(300).slice(from);
  console.log('===== ' + name + ' (' + mine.length + ' 回) =====');
  console.log(mine.join('\n'));
  console.log('--- されたこと:', JSON.stringify(win.mmsxxTally()));
  console.log('');
}
