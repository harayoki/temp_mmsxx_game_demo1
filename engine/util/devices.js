// **確かめたい機種の一覧。** PC の窓の中に、実機と同じ画角を作るための数字。
//
//   import { DEVICES, findDevice } from './engine/util/devices.js';
//
// 数字はどれも**横持ちの CSS px**。実機の dpr は 2 や 3 だが、
// CSS の px で測れば同じ枠になるので、見た目の大きさは実機と一致する。
//
// **dpr も持っている**のが要点。倍率は実画素で整数に丸めるので、
// dpr が違うと同じ画角でも倍率が変わってしまう(PC は 1、スマホは 3 が多い)。
//
//   w / h    … 横持ちの大きさ(CSS px)
//   dpr      … 実画素の細かさ
//   notch    … 横持ちで**左右どちらか**に来るノッチの幅(0 なら無い)
//   home     … 下のホームバーの厚み(0 なら無い)。**ここは指を吸われる**
//
// ここに並べてあるのは**まだ使われている機種だけ**。
// 寸法は同じでも名前が違うものが多いので、代表を 1 つずつ:
//
//   se     … iPhone 8 / SE2 / SE3 が同じ寸法
//   mini   … iPhone X / XS / 11 Pro / 12 mini / 13 mini が同じ寸法
//
// **左右が開くのは長い機種だけ**で、se・mini・ipad ではパッドが画面に重なる。

export const DEVICES = {
  se: { name: 'iPhone SE', w: 667, h: 375, dpr: 2, notch: 0, home: 0 },
  mini: { name: 'iPhone 13 mini', w: 812, h: 375, dpr: 3, notch: 44, home: 21 },
  iphone: { name: 'iPhone 14', w: 844, h: 390, dpr: 3, notch: 44, home: 21 },
  max: { name: 'iPhone 12 Pro Max', w: 926, h: 428, dpr: 3, notch: 44, home: 21 },
  pixel: { name: 'Pixel 7', w: 915, h: 412, dpr: 2.625, notch: 0, home: 24 },
  ipad: { name: 'iPad 10.9', w: 1180, h: 820, dpr: 2, notch: 0, home: 21 },
};

/** 名前を渡されなかったときに使う機種 */
export const DEFAULT_DEVICE = 'max';

/**
 * 名前から機種を引く。**知らない名前は null**(黙って既定へ落とさない。
 * 打ち間違いに気づけなくなるため)。'mobile' だけは既定の機種として通す
 * @param {string|null} name
 */
export function findDevice(name) {
  if (!name) return null;
  if (name === 'mobile') return DEVICES[DEFAULT_DEVICE];
  return DEVICES[name] || null;
}
