// 音を確かめるための曲。**エンジン側に持つ**(ゲームの素材ではなく、道具のため)。
// サウンドテストの「音色」欄などから鳴らす。
//
//   import { demoFor, scaleDemo } from './engine/util/demotunes.js';
//   mmsxx.audio.defineBGM('tone_saw', demoFor('saw'));
//   mmsxx.audio.defineBGM('scale', scaleDemo(['pulse50', 'saw']));
//
// **打楽器の音色にドレミを鳴らしても何も分からない**ので、
// 名前が打楽器のもの(fmDrum...)には、代わりにリズムの曲を鳴らす。
// どちらを鳴らすかは `demoFor()` が名前を見て決める。

import { isDrumTone } from '../fmpresets.js';

/**
 * 音階 1 回ぶん。`w` の音色で上って下りる。
 * **音の高さの並びはドレミのまま**で、譜割りだけ工夫して曲に聞こえるようにした
 * (上りは付点で跳ね、頂上を伸ばし、下りは走って最後に落ち着く)
 */
const SCALE_RUN = (w) => `@{${w}} o4 c8. d16 e8 f8 g4 a8 b8 `
  + '> c4. < b8 a8 g8 f8 e8 d4 c4 r4 ';

/**
 * 音色を次々に替えながらドレミを鳴らす 1 本の曲。聞き比べ用。
 * @param {string[]} names 順に鳴らす音色の名前
 */
export function scaleDemo(names) {
  // 打楽器は音程が無いので、この曲からは外す
  const tuned = names.filter((w) => !isDrumTone(w));
  return ['t150 q7 v12 l8 @e{soft} ' + tuned.map(SCALE_RUN).join('')];
}

// ---- 打楽器の音色を聞くための曲 ----
// **同じ音色を高さ違いで 3 本**鳴らして、ひと組の太鼓に仕立てる。
// 低い = 胴の太鼓 / 中 = 締め太鼓 / 高い = 刻み。実機のリズム音源も
// これと同じ考えかたで、1 つの音を高さと長さで打ち分けていた。
//
// 1 小節 = 16 分音符 16 個ぶん。4 小節めと 8 小節めがオカズ(手数を増やす)。
const DRUM_LOW = ['c4 r4 c8 c16 c16 r4', 'c4 r4 c8 c16 c16 r4',
  'c4 r4 c8 c16 c16 r4', 'c4 r4 c8 c8 c8 c8'];
const DRUM_MID = ['r4 c4 r4 c4', 'r4 c4 r4 c4',
  'r4 c4 r4 c4', 'r4 c4 r8 c16 c16 c16 c16 c16 c16'];
const DRUM_TOP = ['c8 c16 c16 c8 c16 c16 c8 c16 c16 c8 c16 c16',
  'c8 c16 c16 c8 c16 c16 c8 c16 c16 c8 c16 c16',
  'c8 c16 c16 c8 c16 c16 c8 c16 c16 c8 c16 c16',
  'c8 c16 c16 c8 c16 c16 c4 r4'];

/**
 * **打楽器の音色**で作った小曲。ドレミの代わりにこちらを鳴らす。
 * 高さを 3 つに分けて叩き分けるので、その音色が太鼓に向くかどうかが分かる。
 * @param {string} w 音色の名前
 * @returns {string[]} 3 本のトラック(低い / 中くらい / 高い)
 */
export function drumDemo(w) {
  const two = (list) => list.join(' ') + ' ' + list.join(' ');   // 8 小節にする
  return [
    `t150 q8 v13 l16 @{${w}} @e{percussive} o2 ` + two(DRUM_LOW),
    `t150 q8 v11 l16 @{${w}} @e{percussive} o4 ` + two(DRUM_MID),
    `t150 q8 v7 l16 @{${w}} @e{percussive} o6 ` + two(DRUM_TOP),
  ];
}

/**
 * その音色に合う小曲を返す。**打楽器ならリズム、それ以外はドレミ**。
 * 音色テストの欄はこれを通して作ると、名前が増えても勝手に振り分けられる。
 * @param {string} w 音色の名前
 */
export function demoFor(w) {
  return isDrumTone(w) ? drumDemo(w) : toneDemo(w);
}

/**
 * **1 つの音色だけ**で作った小曲。音色そのものの表情を聞くためのもの。
 * ドレミの上り下りを土台にして、低いベースを敷き、後半は 3 度のハモリを重ねる。
 * どの音色でも同じ曲が鳴るので、音の違いだけを聞き比べられる。
 * @param {string} w 音色の名前(`@{名前}` で呼べるもの)
 * @returns {string[]} 3 本のトラック(主旋律 / ベース / ハモリ)
 */
export function toneDemo(w) {
  return [
    // 主旋律。前半はドレミの上り下り、後半は少し跳ねて終わる
    `t138 q7 v12 l8 @{${w}} @e{soft} `
    + 'o4 c8. d16 e8 f8 g4 a8 b8  > c4. < b8 a8 g8 f8 e8 d4 c4 '
    + 'o4 e8. f16 g8 a8 > c4 < b8 a8  g4. e8 g8 a8 g8 e8 d2 ',
    // ベース。1 オクターブ下で拍を刻む(音色は主旋律と同じ)
    `t138 q6 v10 l8 @{${w}} @e{flat} `
    + 'o2 c4 g4 c4 g4  c4 g4 c4 g4 '
    + 'o2 a4 e4 f4 c4  g4 > d4 < g4 g4 ',
    // ハモリ。**後半だけ**鳴る(前半は休み)。主旋律の 3 度下
    `t138 q7 v8 l8 @{${w}} @e{soft} `
    + 'r1 r1 r1 r1 '
    + 'o3 c8. d16 e8 f8 a4 g8 f8  e4. c8 e8 f8 e8 c8 b2 ',
  ];
}
