// **多色の絵を、色ごとの単色スプライトに分けて 1 つとして扱う**部品。
//
//   import { SpriteCombo, splitByColor } from './engine/util/spritecombo.js';
//
//   const ship = new SpriteCombo(mmsxx, IMG.player, { priority: 10 });
//   ship.x = 120; ship.y = 150; ship.visible = true;
//   ship.image = IMG.playerTilt;   // 差し替え(色数が変わってもよい)
//   ship.remove();
//
// ## なぜ分けるか
//
// 実機のスプライトは **1 枚 1 色**。2 色の絵は「単色を 2 枚重ねている」ことに
// なるので、**1 行に出せる枚数(4 枚)の取り合いでも 2 枚ぶん**の席を食う。
// エンジンは多色の絵を 1 枚として数えるため、5 色の絵を置いても席は 1 つしか
// 取らず、実機なら消えるはずの場面で消えない。
//
// 色ごとに分けて置けば、**席の取り合いは自然に実機と同じ数**になる。
// そのぶん扱いが面倒になる(色の数だけ動かす)ので、ここでまとめて持つ。
//
// ## 重なりの順番
//
// **後ろの色ほど手前**に出る(`priority` を 0.001 ずつ足す)。
// 元の絵で重なっていた色は、分けても同じ見た目になる。
//
// ## 席の取り合い
//
// `rank` はすべての枚に配る。`'always'`(絶対に消えない)を渡せば、
// 分けた全部が消えなくなる。何も渡さなければふつうの扱い。

import { SpriteSymbol } from '../symbol.js';

/** 分けた結果を覚えておく(同じ絵を何度も分けない) */
const cache = new WeakMap();

/**
 * 多色の絵を**色ごとの単色の絵**に分ける。
 *
 * 透明(0)は数えない。返るのは**元の絵に出てくる色の数**ぶんで、
 * 並び順は色番号の小さいほうから。
 *
 * @param {import('../symbol.js').SpriteSymbol} img 分ける絵
 * @returns {import('../symbol.js').SpriteSymbol[]} 単色の絵の並び(1 色なら 1 枚)
 */
export function splitByColor(img) {
  const hit = cache.get(img);
  if (hit) return hit;
  const seen = [];
  for (const c of img.pixels) {
    if (c !== 0 && !seen.includes(c)) seen.push(c);
  }
  seen.sort((a, b) => a - b);
  // 1 色(と、色の無い絵)はそのまま返す。分ける意味がない
  if (seen.length <= 1) {
    const one = [img];
    cache.set(img, one);
    return one;
  }
  const parts = seen.map((color) => {
    const pixels = new Uint8Array(img.pixels.length);
    for (let i = 0; i < pixels.length; i++) {
      if (img.pixels[i] === color) pixels[i] = color;
    }
    // 分けたあとは**単色**なので、色数を 1 として持たせる
    return new SpriteSymbol(img.width, img.height, pixels,
      (img.name || '') + '(色' + color + ')', 1);
  });
  cache.set(img, parts);
  return parts;
}

/**
 * 分けた単色スプライトを、**1 つのスプライトのように**扱う入れもの。
 *
 * `x` / `y` / `visible` / `priority` / `image` は、ふつうのスプライトと
 * 同じように読み書きできる。中では色の数だけの枚に配っている。
 */
export class SpriteCombo {
  /**
   * @param {object} mmsxx エンジン
   * @param {import('../symbol.js').SpriteSymbol} img 多色でも単色でもよい
   * @param {{priority?:number, rank?:string, visible?:boolean,
   *          x?:number, y?:number}} [opts]
   */
  constructor(mmsxx, img, opts = {}) {
    this._mmsxx = mmsxx;
    this._x = opts.x || 0;
    this._y = opts.y || 0;
    this._priority = opts.priority || 0;
    this._visible = opts.visible !== false;
    this._rank = opts.rank || null;
    /** @type {object[]} 実際に置いているスプライト(色の数ぶん) */
    this.sprites = [];
    this._image = null;
    this.image = img;
  }

  /** いま出している枚数(= 元の絵の色数) */
  get count() { return this.sprites.length; }

  get image() { return this._image; }

  /** 絵を差し替える。色数が変わったら枚数も合わせる */
  set image(img) {
    this._image = img;
    const parts = img ? splitByColor(img) : [];
    // 足りない枚を作り、余った枚を片づける
    while (this.sprites.length > parts.length) {
      this._mmsxx.removeSprite(this.sprites.pop());
    }
    while (this.sprites.length < parts.length) {
      this.sprites.push(this._mmsxx.sprite(parts[this.sprites.length]));
    }
    parts.forEach((part, i) => { this.sprites[i].image = part; });
    this._apply();
  }

  get x() { return this._x; }
  set x(v) { this._x = v; for (const s of this.sprites) s.x = v; }

  get y() { return this._y; }
  set y(v) { this._y = v; for (const s of this.sprites) s.y = v; }

  get visible() { return this._visible; }
  set visible(v) { this._visible = !!v; for (const s of this.sprites) s.visible = !!v; }

  get priority() { return this._priority; }
  set priority(v) {
    this._priority = v;
    // **後ろの色ほど手前**。元の絵の重なりを保つ
    this.sprites.forEach((s, i) => { s.priority = v + i * 0.001; });
  }

  get rank() { return this._rank; }
  set rank(v) { this._rank = v; for (const s of this.sprites) s.rank = v; }

  /** 色の置き換え(色違いを作るとき)。全部の枚に配る */
  set colorMap(v) { for (const s of this.sprites) s.colorMap = v; }

  /** ちらつき。全部の枚に同じ位相で配る(ばらばらに消えないように) */
  set blink(v) { for (const s of this.sprites) s.blink = v; }
  set blinkPhase(v) { for (const s of this.sprites) s.blinkPhase = v; }

  /** 画面から取り除く */
  remove() {
    for (const s of this.sprites) this._mmsxx.removeSprite(s);
    this.sprites.length = 0;
  }

  /** いまの値を全部の枚へ配り直す(絵を差し替えたあとに使う) */
  _apply() {
    for (const s of this.sprites) {
      s.x = this._x;
      s.y = this._y;
      s.visible = this._visible;
      if (this._rank) s.rank = this._rank;
    }
    this.priority = this._priority;
  }
}
