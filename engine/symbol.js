// 画面に出す絵の「型」。**スプライト用**と **BG 用**を別の型にする。
//
// 絵は作るときに一度だけ検査して、ここを通ったものは
// **もう決まりを破っていないことが確定している**。
// だから sprite() / bgSprite() / layer.draw() の側では何も調べない。
//
//   const SHIP = mmsxx.spriteSymbol(raw, { name: 'SHIP', colors: 2 });
//   const WALL = mmsxx.bgSymbol(raw, { name: 'WALL' });
//   const sp = mmsxx.sprite(SHIP);
//   layer.draw(0, 0, WALL);
//
// 型が違うものを渡すと、その場で分かる(遊ぶ人の前では止めずに知らせる)。

/** 絵の共通の入れ物。中身は色番号(0 = 透明)の並び */
export class ImageSymbol {
  /**
   * @param {number} width @param {number} height
   * @param {Uint8Array} pixels 1 ドット 1 バイトの色番号
   * @param {string} [name] 知らせに出す名前
   */
  constructor(width, height, pixels, name = '') {
    this.width = width;
    this.height = height;
    this.pixels = pixels;
    this.name = name;
  }

  /** 同じ型のまま、中身だけ差し替えた絵を作る(色替え・反転・走査線用) */
  derive(pixels, name) {
    const out = new this.constructor(this.width, this.height, pixels, name || this.name);
    return out;
  }
}

/**
 * スプライトとして出す絵。
 * 決まった色数まで減色済みで、大きさも 16 の倍数(16 以下はそのまま)。
 */
export class SpriteSymbol extends ImageSymbol {
  constructor(width, height, pixels, name, colors = 1) {
    super(width, height, pixels, name);
    /** 何色で作ったか(実機なら「何枚重ねるか」にあたる) */
    this.colors = colors;
  }

  derive(pixels, name) {
    return new SpriteSymbol(this.width, this.height, pixels, name || this.name, this.colors);
  }
}

/**
 * BG として出す絵。**横 8 ドット 2 色**を守っている。
 * 大きさは 8 の倍数(半端な絵は、作るときに広げて埋められる)。
 */
export class BgSymbol extends ImageSymbol {
  constructor(width, height, pixels, name, backdrop = 1) {
    super(width, height, pixels, name);
    /** BG スプライトにできるか(8 の倍数か)。作るときに決まる */
    this.canBgSprite = (width % 8 === 0) && (height % 8 === 0);
    /**
     * **セルの下地の色**。登録するときに決まり、派生した絵にも引き継がれる。
     * 走査線などで透明が戻ったときは、この色で埋め直す(既定 1 = 黒)
     */
    this.backdrop = backdrop;
  }

  derive(pixels, name) {
    return new BgSymbol(this.width, this.height, pixels, name || this.name, this.backdrop);
  }
}
