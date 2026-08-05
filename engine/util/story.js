// ストーリー画面(オープニング / エンディング)。
//
// 「絵を出して、下に文章を添えて、何秒かしたら次の場面へ」という
// ゲームでよくある表現をまとめたもの。エンジン本体からは切り離してあるので、
// 使わないゲームは import しなければ 1 バイトも読み込まれない。
//
//   import { StoryScenes } from './engine/util/story.js';
//
//   const ending = new StoryScenes(mmsxx, {
//     artLayer: 3, textLayer: 4,
//     scenes: [
//       { hold: 240, text: ['THE KING FLED', 'INTO A BLUE RIFT.'],
//         draw: (m, art) => { art.draw(64, 32, IMG.rift); } },
//     ],
//     onEnd: () => enterTitle(),
//   });
//   ending.start();
//   // 毎フレーム
//   ending.update();

import { SCREEN_W, SCREEN_H } from '../video.js';

/** 文字列を画面の真ん中に置くときの x */
const centerX = (text) => (SCREEN_W - text.length * 8) >> 1;

export class StoryScenes {
  /**
   * @param {object} mmsxx MMSXXEngine
   * @param {{
   *   scenes: Array<{
   *     hold?: number,        この場面を見せるフレーム数(既定 240 = 4 秒)
   *     text?: string[],      下に出す文章(1 行 8 ドット)
   *     textColor?: number,   文字色(既定 15)
   *     draw?: (mmsxx:object, artLayer:object) => void,   絵を描く
   *     sprites?: () => object[],   出したいスプライト(場面が終わると隠す)
   *     onEnter?: (mmsxx:object) => void,   曲を変えるなど
   *   }>,
   *   artLayer?: number,      絵を描くレイヤー番号(既定 0)
   *   textLayer?: number,     文字を描くレイヤー番号(既定は artLayer と同じ)
   *   textY?: number,         文章の 1 行目の y(既定は下から 2 行ぶん上)
   *   lineStep?: number,      行間(既定 12)
   *   typing?: number,        1 フレームに出す文字数(0 = 一度に全部。既定 0.5)
   *   textWait?: number,      絵が出てから文章を出しはじめるまでの間(フレーム)
   *   gap?: number,           場面と場面のあいだの暗転(既定 12 フレーム)
   *   skipKeys?: string[],    押すと次の場面へ進むキー
   *   manual?: boolean,       true にすると時間では進まず、キーを押すまで待つ
   *   prompt?: {              「押すと次へ行けます」を伝える 8x8 の絵
   *     frames: image[],        パラパラ動かすコマ(2 枚以上)
   *     rate?: number,          1 コマ何フレームか(既定 10)
   *     x?: number, y?: number, 置く場所(省略すると文章の最後の行のうしろ)
   *     after?: number,         文章が出そろってから何フレームで出すか(既定 0)
   *   },
   *   onEnd?: () => void,     最後の場面が終わったら呼ばれる
   * }} opts
   */
  constructor(mmsxx, opts) {
    this.mmsxx = mmsxx;
    this.scenes = opts.scenes || [];
    this.artLayer = opts.artLayer ?? 0;
    this.textLayer = opts.textLayer ?? this.artLayer;
    this.lineStep = opts.lineStep ?? 12;
    this.textY = opts.textY ?? (SCREEN_H - 8 - this.lineStep * 2);
    this.typing = opts.typing ?? 0.5;
    this.textWait = opts.textWait ?? 0;
    this.gap = opts.gap ?? 12;
    this.skipKeys = opts.skipKeys || ['Space'];
    // true = 時間では進まない。読み終わったら自分で送ってもらう
    this.manual = !!opts.manual;
    // 「押してほしそう」を文字ではなく小さい絵の動きで伝える
    this.prompt = opts.prompt || null;
    if (this.prompt) {
      this.prompt.rate = this.prompt.rate ?? 10;
      this.prompt.after = this.prompt.after ?? 0;
    }
    this._promptWait = 0;
    this._promptAt = null;   // いま合図を出している場所(消すときに使う)
    this.onEnd = opts.onEnd || null;
    /** いま何場面目か(-1 = まだ始めていない) */
    this.index = -1;
    /** 終わったか */
    this.done = false;
    this._timer = 0;
    this._gapLeft = 0;
    this._shown = 0;      // タイプライタで出した文字数
    this._textWait = 0;   // 文章を出すまでの間の残り
    this._sprites = [];
  }

  /**
   * いま場面と場面のあいだの暗転中か。
   * true のあいだは絵もスプライトもまだ出ていない。
   * 外から絵を描き足すときは、ここが false になってからにする
   * (でないと、絵だけ暗転中に出てしまってスプライトとずれる)。
   */
  get entering() { return this._gapLeft > 0; }

  /** 全部でどれくらいの長さになるか(フレーム数)。手送りのときは意味を持たない */
  get length() {
    return this.scenes.reduce((n, s) => n + (s.hold ?? 240) + this.gap, 0);
  }

  start() {
    this.index = -1;
    this.done = false;
    this._gapLeft = 0;
    // 始めた合図のキー(タイトルやシーン選択の決定)が、そのまま
    // 1 枚目を送ってしまわないよう、最初の 1 フレームは送りを見ない
    this._ignoreKeys = true;
    this._next();
  }

  /** いまの場面を片づけて、次の場面へ進む(最後まで行ったら終わる) */
  _next() {
    this._hideSprites();
    this._textWait = 0;
    this._promptAt = null;   // レイヤーごと消すので、位置も忘れる
    const art = this.mmsxx.layer(this.artLayer);
    const text = this.mmsxx.layer(this.textLayer);
    art.clear();
    if (text !== art) text.clear();
    this.index++;
    if (this.index >= this.scenes.length) {
      this.done = true;
      if (this.onEnd) this.onEnd();
      return;
    }
    const s = this.scenes[this.index];
    this._timer = s.hold ?? 240;
    this._shown = 0;
    this._gapLeft = this.gap;   // 暗転してから絵を出す
  }

  _hideSprites() {
    for (const sp of this._sprites) sp.visible = false;
    this._sprites = [];
  }

  /** 場面の絵を実際に置く(暗転が明けた最初のフレーム) */
  _enter() {
    const s = this.scenes[this.index];
    const art = this.mmsxx.layer(this.artLayer);
    if (s.draw) s.draw(this.mmsxx, art);
    if (s.sprites) {
      this._sprites = s.sprites() || [];
      for (const sp of this._sprites) sp.visible = true;
    }
    if (s.onEnter) s.onEnter(this.mmsxx);
  }

  /** 文章を今の「出した文字数」まで描く */
  _drawText() {
    const s = this.scenes[this.index];
    const lines = s.text || [];
    if (!lines.length) return;
    const layer = this.mmsxx.layer(this.textLayer);
    const color = s.textColor ?? 15;
    let left = this.typing > 0 ? Math.floor(this._shown) : Infinity;
    lines.forEach((line, i) => {
      const y = this.textY + i * this.lineStep;
      // 1 文字ずつ出す。行をまたいで数えるので、上の行から順に埋まっていく
      const n = Math.max(0, Math.min(line.length, left));
      left -= line.length;
      if (n <= 0) return;
      layer.print(centerX(line), y, line.slice(0, n), color);
    });
  }

  /** 文章が出そろったか */
  _textDone() {
    const s = this.scenes[this.index];
    const total = (s.text || []).reduce((n, l) => n + l.length, 0);
    return this.typing <= 0 || this._shown >= total;
  }

  /**
   * 「押すと次へ行けます」の合図。文字は出さず、小さい絵を動かして伝える。
   * 文章が出そろってから出す(まだ読んでいる途中に急かさない)。
   */
  _drawPrompt() {
    const p = this.prompt;
    if (!p || !p.frames || !p.frames.length) return;
    const layer = this.mmsxx.layer(this.textLayer);
    if (!this._textDone()) { this._promptWait = 0; this._clearPrompt(); return; }
    if (this._promptWait < p.after) { this._promptWait++; return; }
    const at = this._promptPos();
    this._clearPrompt();
    const n = Math.floor(this.mmsxx.frame / p.rate) % p.frames.length;
    layer.draw(at[0], at[1], p.frames[n]);
    this._promptAt = at;
  }

  /** 合図を置く場所。省略されていれば「文章の最後の行のうしろ」 */
  _promptPos() {
    const p = this.prompt;
    if (p.x != null && p.y != null) return [p.x, p.y];
    const lines = (this.scenes[this.index] || {}).text || [];
    let last = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i]) last = i;
    if (last < 0) return [SCREEN_W - 16, SCREEN_H - 16];
    const line = lines[last];
    // 行の右はしの少しうしろ。画面からはみ出さないところまで
    const x = Math.min(SCREEN_W - 8, centerX(line) + line.length * 8 + 4);
    return [x, this.textY + last * this.lineStep];
  }

  _clearPrompt() {
    if (!this._promptAt) return;
    this.mmsxx.layer(this.textLayer).fill(0, this._promptAt[0], this._promptAt[1], 8, 8, true);
    this._promptAt = null;
  }

  /** いまの場面を飛ばして次へ */
  skip() {
    if (this.done) return;
    // まだ文章が出そろっていなければ、まず全部出す(2 回押しで次の場面)
    const s = this.scenes[this.index];
    const total = (s.text || []).reduce((n, l) => n + l.length, 0);
    if (this.typing > 0 && this._shown < total) {
      this._shown = total;
      this._drawText();
      return;
    }
    this._next();
  }

  /** 毎フレーム呼ぶ。終わっていれば true */
  update() {
    if (this.done) return true;
    if (this._gapLeft > 0) {
      // 場面と場面のあいだの暗転。明けた瞬間に絵を置く
      if (--this._gapLeft === 0) this._enter();
      return false;
    }
    if (this._ignoreKeys) {
      this._ignoreKeys = false;
    } else {
      for (const k of this.skipKeys) {
        if (this.mmsxx.input.wasPressed(k)) { this.skip(); return this.done; }
      }
    }
    // 場面ごとの「文章を出しはじめるまでの間」
    const s0 = this.scenes[this.index] || {};
    const wait = s0.textWait ?? this.textWait;
    if (this._textWait < wait) { this._textWait++; this._drawPrompt(); return this.done; }
    if (this.typing > 0) {
      this._shown += this.typing;
      this._drawText();
    } else if (this._shown === 0) {
      this._shown = 1;
      this._drawText();
    }
    this._drawPrompt();
    // 手送りのときは時間で進まない(押されるまでその場面のまま)
    if (!this.manual && --this._timer <= 0) this._next();
    return this.done;
  }

  /** 途中でやめるとき(タイトルへ戻るなど)の後始末 */
  stop() {
    this._clearPrompt();
    this._hideSprites();
    this.mmsxx.layer(this.artLayer).clear();
    const text = this.mmsxx.layer(this.textLayer);
    if (text !== this.mmsxx.layer(this.artLayer)) text.clear();
    this.done = true;
  }
}
