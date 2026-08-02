// 最初から入っている波形メモリ。実機の SCC / PC エンジンにあたるもの。
// 名前は **wt で始める**(波形メモリだと見て分かるように)。
//
// どれも 1 周期 32 サンプル。実機もこの長さだった。
// bits は段階の細かさで、5 = 32 段階(PC エンジン風)、8 = 256 段階(SCC 風)。
// 粗いほど倍音が増えて、ジャリッとした古い音になる。
//
// 自分で足すときは engine 側をさわらず、ゲームから呼ぶ:
//   mmsxx.audio.addWave('wtMine', [...32 個...], 5);

import { registerWave } from './mml.js';

const N = 32;
/** 0..N-1 の位置ごとに f(位相 0..1) を並べる */
const build = (f) => Array.from({ length: N }, (_, i) => f(i / N, i));
/** 倍音を混ぜる(番号と大きさの組で指定) */
const harmonics = (list) => build((p) => {
  let v = 0;
  for (const [n, a] of list) v += a * Math.sin(2 * Math.PI * n * p);
  return v;
});

/**
 * ただのサイン波を波形メモリに載せたもの。
 * 作りつけの `sine` と形は同じでも、**32 段の階段**になるので
 * かすかに倍音が乗る。粗さのちがいを聞き比べる物差しにもなる
 */
export const WT_SINE = build((p) => Math.sin(2 * Math.PI * p));

/** 鐘・金属。奇数倍音を飛ばして混ぜると、澄んだ金属音になる */
export const WT_BELL = harmonics([[1, 1], [3, 0.5], [5, 0.35], [7, 0.2], [11, 0.12]]);

/** オルガン。基音 + 完全 5 度 + オクターブ。厚みがあってよく通る */
export const WT_ORGAN = harmonics([[1, 1], [2, 0.6], [3, 0.45], [4, 0.3], [6, 0.15]]);

/** ノコギリを階段に落としたもの。PC エンジンらしいジャリッとした音 */
export const WT_RAMP = build((p) => 1 - 2 * p);

/** 声。低い倍音を強めて、前半と後半で形を変える(「あー」に近い) */
export const WT_VOICE = build((p) => {
  const base = Math.sin(2 * Math.PI * p);
  const form = 0.5 * Math.sin(2 * Math.PI * 2 * p) + 0.35 * Math.sin(2 * Math.PI * 3 * p);
  // 前半だけ倍音を強くして、左右非対称にする(声の共鳴に近づく)
  return base + (p < 0.5 ? form : form * 0.25);
});

/** 角を丸めた矩形。矩形より柔らかく、メロディに使いやすい */
export const WT_SQUARE_SOFT = build((p) => {
  const edge = 0.06;                    // 角のなまり具合
  const d = Math.min(p, Math.abs(p - 0.5), 1 - p) / edge;
  const s = p < 0.5 ? 1 : -1;
  return s * Math.min(1, d);
});

/** 最初から使える 5 つを登録する(このファイルを読み込んだ時点で入る) */
export function registerDefaultWaves() {
  registerWave('wtSine', WT_SINE, 5);        // 粗さのちがいが分かるよう 5bit
  registerWave('wtBell', WT_BELL, 8);
  registerWave('wtOrgan', WT_ORGAN, 8);
  registerWave('wtRamp', WT_RAMP, 5);        // わざと粗く
  registerWave('wtVoice', WT_VOICE, 5);      // わざと粗く
  registerWave('wtSquareSoft', WT_SQUARE_SOFT, 8);
}
