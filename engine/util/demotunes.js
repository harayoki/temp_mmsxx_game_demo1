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

// ---- 打楽器を全部使った曲 ----
// **5 つの音色を 1 曲に組む**。それぞれの受け持ちは、ふつうのドラムセットと同じ。
//   キック = 土台 / スネア = 2 拍 4 拍 / タム = オカズ /
//   リム = 裏の刻み / シンバル = 刻みと決め
//
// 16 小節。導入 - たたき台 - オカズ - 手数を増やす - 抜き - 追い込み - 締め。
// 1 小節 = 16 分音符 16 個ぶん。どの声も 1 小節ぴったりに収める。
const KIT_KICK = [
  'r1',                                   // 1  導入(リムだけ)
  'c4 r4 c8 c16 c16 r4',                  // 2
  'c4 r4 c8 c16 c16 r4',                  // 3  たたき台
  'c8 c16 c16 r4 c8 r8 c8 r8',            // 4
  'c4 r4 c8 c16 c16 r4',                  // 5
  'c8 c16 c16 r4 c8 r8 c8 r8',            // 6
  'c4 r4 c8 c16 c16 r4',                  // 7
  'c4 r4 r2',                             // 8  オカズに場所をゆずる
  'c8 c16 c16 r4 c8 r8 c8 r8',            // 9  手数を増やす
  'c8 c16 c16 r4 c8 r8 c8 r8',            // 10
  'c8 c16 c16 r4 c8 r8 c8 r8',            // 11
  'c4 r4 c8 c8 c4',                       // 12
  'c4 r4 c4 r4',                          // 13 抜き(タムが歌う)
  'c4 r4 c4 r4',                          // 14
  'c8 c8 c8 c8 c8 c8 c8 c8',              // 15 追い込み
  'c4 r4 r2',                             // 16 締め
];

const KIT_SNARE = [
  'r1',                                   // 1
  'r1',                                   // 2
  'r4 c4 r4 c4',                          // 3
  'r4 c4 r4 c4',                          // 4
  'r4 c4 r4 c4',                          // 5
  'r4 c4 r8 c8 c8 c8',                    // 6
  'r4 c4 r4 c4',                          // 7
  'c16 c16 c16 c16 c8 c8 c16 c16 c16 c16 c8 c8',  // 8  オカズ
  'r4 c4 r4 c4',                          // 9
  'r4 c4 r8 c8 c8 c8',                    // 10
  'r4 c4 r4 c4',                          // 11
  'r4 c4 r8 c8 c8 c8',                    // 12
  'r1',                                   // 13 抜き
  'r1',                                   // 14
  'c16 c16 c16 c16 c8 c8 c16 c16 c16 c16 c8 c8',  // 15
  'c4 r4 r2',                             // 16
];

// タムは高さを変えて打ち分ける(高いタム o4 / 低いタム o3)
const KIT_TOM = [
  'r1', 'r1', 'r1', 'r1', 'r1', 'r1', 'r1',
  'r2 o4 c8 c8 o3 c8 c8',                 // 8  スネアのオカズに続けて落とす
  'r1', 'r1', 'r1',
  'o4 c8 c8 c8 c8 o3 c8 c8 c8 c8',        // 12
  'o4 c8 c16 c16 o3 c8 c16 c16 o4 c8 o3 c8 c4',   // 13 抜き。タムが歌う
  'o4 c8 c16 c16 o3 c8 c16 c16 o4 c4 o3 c4',      // 14
  'o4 c8 c8 c8 c8 o3 c8 c8 c8 c8',        // 15
  'r1',                                   // 16
];

// リムは裏を刻む。導入では拍を数える役
const KIT_RIM = [
  'c8 c8 c8 c8 c8 c8 c8 c8',              // 1  数える
  'r8 c16 r16 r4 r8 c16 r16 r4',
  'r8 c16 r16 r4 r8 c16 r16 r4',
  'r8 c16 r16 r4 r8 c16 r16 r4',
  'r8 c16 r16 r4 r8 c16 r16 r4',
  'r8 c16 r16 r4 r8 c16 r16 r4',
  'r8 c16 r16 r4 r8 c16 r16 r4',
  'r1',                                   // 8  オカズのじゃまをしない
  'r8 c16 r16 r4 r8 c16 r16 r4',
  'r8 c16 r16 r4 r8 c16 r16 r4',
  'r8 c16 r16 r4 r8 c16 r16 r4',
  'r1',
  'r1', 'r1', 'r1',                       // 13-15 抜きと追い込みは休む
  'r1',
];

// シンバルは刻み(o6)と、決めの一発(o5 の長い音)を持ち替える
const KIT_CYM = [
  'o5 c4 r4 r2 o6',                       // 1  頭の一発
  'c8 c16 c16 c8 c16 c16 c8 c16 c16 c8 c16 c16',
  'c8 c16 c16 c8 c16 c16 c8 c16 c16 c8 c16 c16',
  'c8 c16 c16 c8 c16 c16 c8 c16 c16 c8 c16 c16',
  'c8 c16 c16 c8 c16 c16 c8 c16 c16 c8 c16 c16',
  'c8 c16 c16 c8 c16 c16 c8 c16 c16 c8 c16 c16',
  'c8 c16 c16 c8 c16 c16 c8 c16 c16 c8 c16 c16',
  'r1',                                   // 8
  'o5 c4 o6 r4 c8 c16 c16 c8 c16 c16',    // 9  ここから 16 分の刻み
  'c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16',
  'c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16',
  'c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16',
  'r1', 'r1',                             // 13-14 抜き
  'c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16 c16',
  'o5 c4 r4 r2 o6',                       // 16 締めの一発
];

/**
 * **打楽器を全部使った曲**。5 つの音色がそれぞれの役を持つ。
 * 音色を確かめるだけでなく、組にしたときの鳴りを聞くためのもの。
 * @returns {string[]} 5 本のトラック(キック / スネア / タム / リム / シンバル)
 */
export function drumKitDemo() {
  const T = 't150 q8 l16 @e{percussive}';
  return [
    `${T} v13 @{fmDrumKick} o2 ` + KIT_KICK.join(' '),
    `${T} v11 @{fmDrumSnare} o4 ` + KIT_SNARE.join(' '),
    `${T} v11 @{fmDrumTom} o4 ` + KIT_TOM.join(' '),
    `${T} v8 @{fmDrumRim} o5 ` + KIT_RIM.join(' '),
    `${T} v6 @{fmDrumCymbal} o6 ` + KIT_CYM.join(' '),
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
