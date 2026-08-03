// 最初から入っている FM 音色。MSX-MUSIC(FM-PAC などに載っていた YM2413 = OPLL)の
// **内蔵音色 15 種**の並びに合わせてある。名前は **fm で始める**。
//
// **ことわり**: 実機の音色は 8 バイトのレジスタで決まり、
// 4 種類の波形・フィードバック・レベルの段など、ここで扱っていない要素が多い。
// なので**そっくり同じ音にはならない**。「その楽器を狙った 2 オペの近似」であり、
// 並びと名前を実機に合わせてある、という位置づけ。
//
// 自分で足すときは engine 側をさわらず、ゲームから呼ぶ:
//   mmsxx.audio.addFM('fmMine', { ratio: 2, depth: 5, decay: 0.2 });

import { registerFM, WAVE } from './mml.js';

/**
 * OPLL の内蔵音色の並び。
 * ratio = 変調側の比 / depth = 揺らしの深さ / decay = 倍音の減り方(秒) /
 * sustain = 減りきったあとに残る倍音
 */
export const FM_PRESETS = {
  // 1 バイオリン。弓のこすれを出すため、比を少しずらして倍音を残す
  fmViolin: { ratio: 3, depth: 3.2, attack: 0.06, decay: 0.5, sustain: 0.5, wave: WAVE.SINE },
  // 2 ギター。はじいた瞬間だけ硬く、あとは丸くなる
  fmGuitar: { ratio: 2, depth: 5, attack: 0.002, decay: 0.18, sustain: 0.05 },
  // 3 ピアノ。低い比で芯を作り、減りは中くらい
  fmPiano: { ratio: 1, depth: 4, attack: 0.002, decay: 0.35, sustain: 0.08 },
  // 4 フルート。倍音が少なく、息の立ち上がりがゆっくり
  fmFlute: { ratio: 1, depth: 1.2, attack: 0.09, decay: 0.4, sustain: 0.35 },
  // 5 クラリネット。奇数倍音が立つので比は 3
  fmClarinet: { ratio: 3, depth: 2.2, attack: 0.04, decay: 0.4, sustain: 0.45 },
  // 6 オーボエ。細く鼻にかかった音。比を高めに取る
  fmOboe: { ratio: 4, depth: 2.6, attack: 0.05, decay: 0.35, sustain: 0.4 },
  // 7 トランペット。吹き込むほど倍音が増える(深さを大きく、残りも多め)
  fmTrumpet: { ratio: 2, depth: 6, attack: 0.03, decay: 0.25, sustain: 0.5 },
  // 8 オルガン。倍音が動かないので、減らさずそのまま持続させる
  fmOrgan: { ratio: 2, depth: 2.4, attack: 0.01, decay: 0.05, sustain: 1 },
  // 9 ホルン。丸く、奥から鳴る。立ち上がりはゆっくり
  fmHorn: { ratio: 1, depth: 2.4, attack: 0.08, decay: 0.4, sustain: 0.45 },
  // 10 シンセ。作り物らしく、比をずらして濁らせる
  fmSynth: { ratio: 2.5, depth: 5, attack: 0.01, decay: 0.3, sustain: 0.3 },
  // 11 ハープシコード。はじく音。硬くて減りが速い
  fmHarpsichord: { ratio: 3, depth: 6, attack: 0.001, decay: 0.12, sustain: 0.03 },
  // 12 ビブラフォン。金属らしく、比を半端にする
  fmVibraphone: { ratio: 3.5, depth: 4, attack: 0.002, decay: 0.5, sustain: 0.05 },
  // 13 シンセベース。低音でぶ厚く、アタックだけ硬い
  fmSynthBass: { ratio: 1, depth: 6, attack: 0.002, decay: 0.15, sustain: 0.2 },
  // 14 アコースティックベース。指ではじいた丸い低音
  fmAcousticBass: { ratio: 1, depth: 3, attack: 0.004, decay: 0.3, sustain: 0.06 },
  // 15 エレキギター。歪んだ持続音。深さを保ったままにする
  fmElecGuitar: { ratio: 2, depth: 7, attack: 0.002, decay: 0.3, sustain: 0.4 },

  // ---- このエンジン独自のもの(実機には無い) ----
  // 硬い金属質のリード。比を半端にして倍音を濁らせ、伸ばすほど澄んでいく
  fmLead: { ratio: 2.5, depth: 7, attack: 0.004, decay: 0.22, sustain: 0.25 },
  // 唸る低音。出だしだけ深く歪ませて、あとは芯だけ残す
  fmGrowl: { ratio: 1.5, depth: 9, attack: 0.002, decay: 0.14, sustain: 0.12 },
  // 鐘のように響く合いの手。倍音が長く残る
  fmChime: { ratio: 4.7, depth: 5, attack: 0.002, decay: 0.6, sustain: 0.1 },

  // ---- リズム ----
  // 実機のリズム音源も、専用の回路ではなく**濁らせた FM を短く切って**作っていた。
  // 比を整数から外して音程感を消し、深さを大きく、減衰を極端に短くする。
  // ノイズを使わないので、**SE のノイズ枠を食わない**のも利点。
  //
  // 名前は **fmDrum で始める**。一覧に並んだときに打楽器だと分かるうえ、
  // 道具の側も名前だけで見分けられる(音色テストはこれを見て、
  // ドレミではなくリズムの曲を鳴らす)
  // バスドラム。**音程が落ちる**のがこの楽器の正体なので drop を使う。
  // 高いところから一瞬で落ちる「ドッ」があって、はじめて胴の音に聞こえる
  fmDrumKick: {
    ratio: 1, depth: 5, attack: 0.001, decay: 0.12, sustain: 0,
    drop: 7, dropTime: 0.045,
  },
  // スネアドラム。**胴の音と、裏に張った響き線のざらつき**が重なった楽器。
  // 2 オペでノイズは作れないので、比を整数から大きく外して深く揺らし、
  // 倍音をびっしり詰めて**ノイズに近い濁り**を作る。
  // そこへ短い落ち(drop)を足すと、皮を張った胴を叩いた感じになる
  fmDrumSnare: {
    ratio: 3.7, depth: 18, attack: 0.001, decay: 0.14, sustain: 0.02,
    drop: 1.6, dropTime: 0.02,
  },
  // タムも少しだけ落ちる(バスドラムほどではない)
  fmDrumTom: {
    ratio: 1.7, depth: 9, attack: 0.001, decay: 0.12, sustain: 0,
    drop: 1.4, dropTime: 0.05,
  },
  fmDrumRim: { ratio: 5.7, depth: 10, attack: 0.001, decay: 0.03, sustain: 0 },
  fmDrumCymbal: { ratio: 9.3, depth: 14, attack: 0.001, decay: 0.25, sustain: 0.02 },
};

/** 打楽器として作ってある音色か(名前で見分ける) */
export const isDrumTone = (name) => String(name).startsWith('fmDrum');

/** 最初から使える FM 音色を登録する(このファイルを読み込んだ時点で入る) */
export function registerDefaultFM() {
  for (const [name, p] of Object.entries(FM_PRESETS)) {
    registerFM(name, p, { overwrite: true });
  }
}
