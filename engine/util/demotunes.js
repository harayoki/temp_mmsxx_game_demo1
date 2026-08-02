// 音を確かめるための曲。**エンジン側に持つ**(ゲームの素材ではなく、道具のため)。
// サウンドテストの「音色」欄などから鳴らす。
//
//   import { toneDemo, scaleDemo } from './engine/util/demotunes.js';
//   mmsxx.audio.defineBGM('tone_saw', toneDemo('saw'));
//   mmsxx.audio.defineBGM('scale', scaleDemo(['pulse50', 'saw']));

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
  return ['t150 q7 v12 l8 @e{soft} ' + names.map(SCALE_RUN).join('')];
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
