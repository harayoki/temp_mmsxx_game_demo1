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


// ---- リズムの曲(打楽器の使いかたの見本) ----
// `drumKitDemo()` が「打楽器を 1 つずつ確かめる」ものなのに対して、
// こちらは**曲として組んだときの見本**。ゲームからも BGM として使える。
//
//   mmsxx.audio.defineBGM('beat', beatTune());
//
// ここで見せたいのは 2 つ。
//
// **ベースは 2 本重ねる。** 波形メモリ(SCC にあたるもの)が 8 分で走り回り、
// 三角波が根音を伸ばす。走るほうだけだと軽すぎ、伸ばすほうだけだと重い。
//
// **FM の打楽器はどれも線が細いので、ほかの音を重ねて厚みを出す。**
//   ノイズ … 低い音でバスドラの胴、中くらいでスネアの砂、高い音でシンバル
//   矩形波 … 16 分の裏に小さな粒を置いて、刻みを細かく聞かせる
// 重ねる音は**それだけ聞くと意味が無いくらい小さく**しておくこと。
// 前に出ると、打楽器の音色そのものが変わって聞こえてしまう。

// 8 小節の流れ: Dm Dm B- C Dm Dm Gm A
// 走るベース(8 分)。根音 - 5 度 - 8 度 - 5 度 を軸に、3 度と 7 度で崩す
const BEAT_BASS = [
  'o2 d a o3 d o2 a f a d o3 c',
  'o2 d a o3 d o2 a f a d o3 c',
  'o2 b- f o3 b- o2 f d f b- a',
  'o2 c g o3 c o2 g e g c b-',
  'o2 d a o3 d o2 a f a d o3 c',
  'o2 d a o3 d o2 a f a d o3 c',
  'o2 g d g d b- d g f',
  'o2 a e a e o3 c o2 e a g',
].join(' ');

// 伸ばすベース。1 小節に 1 つ、根音だけ
const BEAT_ROOT = [
  'o2 d1', 'o2 d1', 'o2 b-1', 'o2 c1',
  'o2 d1', 'o2 d1', 'o2 g1', 'o2 a1',
].join(' ');

// バスドラ。1 拍目と、2 拍目の裏から食い込む 2 発
const BEAT_KICK_A = 'c8 r8 r8 c16 r16 c8 r8 r4';
const BEAT_KICK_B = 'c8 r8 c16 r16 r8 c8 r8 c8 r8';
const BEAT_KICK = [
  BEAT_KICK_A, BEAT_KICK_A, BEAT_KICK_A, BEAT_KICK_B,
  BEAT_KICK_A, BEAT_KICK_A, BEAT_KICK_A, BEAT_KICK_B,
].join(' ');

// スネアは 2 拍目 4 拍目の表。8 小節目だけ 16 分で追い込む
const BEAT_SNARE_A = 'r4 c8 r8 r4 c8 r8';
const BEAT_SNARE_B = 'r4 c8 r8 r4 c16 c16 c16 c16';
const BEAT_SNARE = [
  BEAT_SNARE_A, BEAT_SNARE_A, BEAT_SNARE_A, BEAT_SNARE_A,
  BEAT_SNARE_A, BEAT_SNARE_A, BEAT_SNARE_A, BEAT_SNARE_B,
].join(' ');

// シンバル(ハイハット)。8 分の刻みを通しで
const BEAT_HAT_A = 'c8 c8 c8 c8 c8 c8 c8 c8';
const BEAT_HAT = new Array(8).fill(BEAT_HAT_A).join(' ');

// タム。ふだんは休み、4 小節目と 8 小節目のおしまいでオカズ
const BEAT_TOM_FILL = 'r2 c16 c16 o3 c16 c16 o4 c8 o3 c8';
const BEAT_TOM = [
  'r1', 'r1', 'r1', BEAT_TOM_FILL,
  'r1', 'r1', 'r1', BEAT_TOM_FILL,
].join(' ');

// ノイズの重ね。バスドラ(低)・スネア(中)・シンバル(高)と同じ位置に置く
const BEAT_NOISE_A =
  'v11o2c16 r16 v3o6c8 v8o5c16 r16 v11o2c16 r16 v11o2c16 r16 v3o6c8 v8o5c16 r16 v3o6c8';
const BEAT_NOISE = new Array(8).fill(BEAT_NOISE_A).join(' ');

// 矩形波の粒。16 分の**裏だけ**に置く
const BEAT_BLIP_A = 'r16 c16 r16 c16 r16 c16 r16 c16 r16 c16 r16 c16 r16 c16 r16 c16';
const BEAT_BLIP = new Array(8).fill(BEAT_BLIP_A).join(' ');

// ブラスの短い和音。**和音は 1 本では鳴らせない**ので、3 音ぶんのトラックを
// 別々に持ち、同じ位置で同じ長さだけ鳴らす。
// 入れるのは小節の切れ目や、間が空くところだけ。鳴らしすぎると
// リズムの隙間が埋まって、走るベースが聞こえなくなる。
// % のところに音名が入る(和音の何番目かで差し替える)
const ST_REST = 'r1';
const ST_TAIL = 'r2 r4 r8 %16 %16';   // 小節のおしまいに 16 分 2 発
const ST_BACK = 'r2 r4 %8 r8';        // 4 拍目の頭に 1 発
const ST_TWO = 'r2 %8 r8 %8 r8';      // 後半に 2 発
const ST_HEAD = '%8 r8 r4 r2';        // 小節の頭に 1 発
const stab = (pattern, note) => pattern.split('%').join(note);

// 1・3・5 小節目は休んで、走るベースを聞かせる
const BEAT_STAB_RHYTHM = [ST_REST, ST_TAIL, ST_REST, ST_BACK, ST_REST, ST_TAIL, ST_TWO, ST_HEAD];
// 和音の積み方(上 / 中 / 下)
const BEAT_STAB_VOICES = [
  ['o4 a', 'o4 a', 'o4 f', 'o4 g', 'o4 a', 'o4 a', 'o5 d', 'o5 e'],
  ['o4 f', 'o4 f', 'o4 d', 'o4 e', 'o4 f', 'o4 f', 'o4 b-', 'o5 c+'],
  ['o4 d', 'o4 d', 'o3 b-', 'o4 c', 'o4 d', 'o4 d', 'o4 g', 'o4 a'],
];
const beatStabTrack = (voice) =>
  BEAT_STAB_RHYTHM.map((r, i) => stab(r, voice[i])).join(' ');

/**
 * ベースと FM 打楽器で組んだリズムの曲。8 小節を 2 回。
 * @returns {string[]} 11 本のトラック
 */
export function beatTune() {
  const T = 't152';
  return [
    // 走るベース(波形メモリ = SCC)。
    // **piano で頭を立てる**。flat だと平らに続いて 8 分が団子になるが、
    // pluck では 0.12 秒で消えてしまい、8 分(0.2 秒)が鳴り終わる前に落ちる。
    // piano は落ちきるまで 0.4 秒あるので、頭が立ったまま胴が残る
    `${T} q7 v13 l8 @{wtRamp} @e{piano} @s2 [` + BEAT_BASS + ']2',
    // 根音を伸ばすベース(三角波)
    `${T} q8 v10 l1 @{triangle} @e{flat} [` + BEAT_ROOT + ']2',
    // バスドラ
    `${T} q8 v13 l16 @{fmDrumKick} @e{percussive} o2 [` + BEAT_KICK + ']2',
    // スネア
    `${T} q8 v11 l16 @{fmDrumSnare} @e{percussive} o4 [` + BEAT_SNARE + ']2',
    // シンバル(刻み)
    `${T} q8 v6 l16 @{fmDrumCymbal} @e{percussive} o6 [` + BEAT_HAT + ']2',
    // タム(オカズ)
    `${T} q8 v10 l16 @{fmDrumTom} @e{percussive} o4 [` + BEAT_TOM + ']2',
    // 打楽器に重ねるノイズ
    `${T} q8 l16 @{noise} @e{percussive} [` + BEAT_NOISE + ']2',
    // 16 分の裏を埋める粒
    `${T} q8 v4 l16 @{pulse12} @e{percussive} o6 [` + BEAT_BLIP + ']2',
    // ブラスの和音(上 / 中 / 下)。短く切って合いの手にする
    `${T} q6 v9 l16 @{fmTrumpet} @e{soft} [` + beatStabTrack(BEAT_STAB_VOICES[0]) + ']2',
    `${T} q6 v8 l16 @{fmTrumpet} @e{soft} [` + beatStabTrack(BEAT_STAB_VOICES[1]) + ']2',
    `${T} q6 v8 l16 @{fmHorn} @e{soft} [` + beatStabTrack(BEAT_STAB_VOICES[2]) + ']2',
  ];
}
