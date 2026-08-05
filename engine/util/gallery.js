// 図鑑(グラフィック一覧)。1 ページに 1 枚ずつ見せて、左右でめくる。
// 見出しと「何ページ中の何ページ目か」も出す。
// エンジン本体からは切り離した任意の部品。
//
//   import { Gallery } from './engine/util/gallery.js';
//
//   const book = new Gallery(mmsxx, {
//     hudLayer: 4, artLayer: 3,
//     pages: [
//       { title: 'PLAYER', draw: (m, art) => art.draw(96, 64, IMG.player) },
//     ],
//     onExit: () => enterTitle(),
//   });
//   book.open();
//   book.update();   // 毎フレーム

import { SCREEN_W } from '../video.js';

const centerX = (text) => (SCREEN_W - text.length * 8) >> 1;

export class Gallery {
  /**
   * @param {object} mmsxx MMSXXEngine
   * @param {{
   *   pages: Array<{
   *     title: string,
   *     bare?: boolean,                    最初は文字を出さず、絵だけ見せる
   *     draw?: (mmsxx:object, artLayer:object, hudLayer:object) => void,
   *     update?: (mmsxx:object) => void,   毎フレームの動き(明滅など)
   *     leave?: (mmsxx:object) => void,    そのページを離れるときの後始末
   *   }>,
   *   hudLayer?: number,     見出し・文字のレイヤー(既定 0)
   *   artLayer?: number,     絵のレイヤー(既定は hudLayer と同じ)
   *   titleY?: number,       見出しの y(既定 8)
   *   showCount?: boolean,   「3/17」を右上に出すか(既定 true)
   *   help?: string,         下に出す操作の案内
   *   helpY?: number,        その y(既定 180)
   *   wrap?: boolean,        端で反対側へ回り込むか(既定 true)
   *   exitKeys?: string[],   閉じるキー
   *   onExit?: () => void,
   * }} opts
   */
  constructor(mmsxx, opts) {
    this.mmsxx = mmsxx;
    this.pages = opts.pages || [];
    this.hudLayer = opts.hudLayer ?? 0;
    this.artLayer = opts.artLayer ?? this.hudLayer;
    this.titleY = opts.titleY ?? 8;
    this.showCount = opts.showCount !== false;
    this.help = opts.help || '';
    this.helpY = opts.helpY ?? 180;
    this.wrap = opts.wrap !== false;
    this.exitKeys = opts.exitKeys || ['Escape'];
    this.onExit = opts.onExit || null;
    this.index = 0;
    this._held = 0;
    // bare のページで、文字をもう出したか
    this._revealed = false;
  }

  open(index = 0) {
    this.index = Math.max(0, Math.min(this.pages.length - 1, index));
    this._held = 0;
    this._revealed = false;
    this.draw();
  }

  /** いまのページを描き直す */
  draw() {
    const page = this.pages[this.index];
    if (!page) return;
    const hud = this.mmsxx.layer(this.hudLayer);
    const art = this.mmsxx.layer(this.artLayer);
    hud.clear();
    if (art !== hud) art.clear();
    // 絵だけのページは、何かキーを押すまで文字を出さない(絵を全画面で見せる)
    const bare = page.bare && !this._revealed;
    if (!bare) {
      const t = '- ' + page.title + ' -';
      hud.print(centerX(t), this.titleY, t, 15);
      if (this.showCount) {
        // 何ページ中の何ページ目かを右上に出す(あと何枚あるか分かるように)
        const pos = (this.index + 1) + '/' + this.pages.length;
        hud.print(SCREEN_W - pos.length * 8 - 8, this.titleY, pos, 14);
      }
    }
    if (page.draw) page.draw(this.mmsxx, art, hud);
    if (!bare && this.help) hud.print(centerX(this.help), this.helpY, this.help, 10);
  }

  /** ページを n ぶん送る */
  turn(n) {
    const len = this.pages.length;
    if (!len) return;
    const cur = this.pages[this.index];
    if (cur && cur.leave) cur.leave(this.mmsxx);
    this.index = this.wrap
      ? (this.index + n + len) % len
      : Math.max(0, Math.min(len - 1, this.index + n));
    this._revealed = false;
    this.draw();
  }

  /** 毎フレーム呼ぶ。閉じたら true */
  update() {
    // 文字を消しているページは、最初のひと押しで文字を出すだけにする。
    // そのあとは他のページと同じ操作(めくる・閉じる)に戻る
    const cur0 = this.pages[this.index];
    if (cur0 && cur0.bare && !this._revealed) {
      if (this.mmsxx.input.pressed.size) { this._revealed = true; this.draw(); }
      if (cur0.update) cur0.update(this.mmsxx);
      return false;
    }
    for (const k of this.exitKeys) {
      if (this.mmsxx.input.wasPressed(k)) {
        const cur = this.pages[this.index];
        if (cur && cur.leave) cur.leave(this.mmsxx);
        if (this.onExit) this.onExit();
        return true;
      }
    }
    // ページ送りは**左右だけ**。上下は一覧のスクロールに取っておく
    // (どの画面でも「上下 = スクロール / 左右 = ページ送り」で揃える)。
    // SPACE は**先へ進むだけ**。戻るのは左キーにまかせる
    if (this.mmsxx.input.wasPressed('ArrowRight') || this.mmsxx.input.wasPressed('Space')) this.turn(1);
    else if (this.mmsxx.input.wasPressed('ArrowLeft')) this.turn(-1);
    const page = this.pages[this.index];
    if (page && page.update) page.update(this.mmsxx);
    return false;
  }
}
