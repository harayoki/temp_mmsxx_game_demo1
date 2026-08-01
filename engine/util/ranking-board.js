// ランキング表(サーバ対応版)。エンジンの任意部品なので、使わなければ読み込まれない。
//
// ## なにが ranking.js と違うのか
//
// `ranking.js` の `Ranking` は保存先が同期(その場で値が返る)である前提で書いてある。
// サーバは非同期なので、そのままでは入れられない。かといって全部を async にすると
// 「毎回 await してから描く」ことになり、いまの“開いた瞬間に出る”手ざわりが壊れる。
//
// そこで **手元に一覧の写しを持ち、読み出しは同期のまま**にする。
// 通信するのは次の 2 か所だけ。
//
//   refresh()  … 一覧を取り直す。タイトルへ戻ったときに投げっぱなしで呼ぶ
//   submit()   … 記録を登録する。ここだけは応答を待って正しい順位を受け取る
//
// 順位が多少ずれていても構わない、という前提で作ってある。
// 遊んでいる最中の `qualifies()` / `rankOf()` は手元の写しで判定するので、
// 実際の順位と食い違うことがある。次に取り直したときに正しくなればよい。
//
// ## 使いかた
//
//   import { RankingBoard, LocalRankingSource, byScore } from './engine/util/ranking-board.js';
//
//   const board = new RankingBoard({
//     key: 'mygame-scores',
//     max: 100,
//     defaults: DEFAULT_SCORES,
//     compare: byScore,
//   });
//
//   // 読み出しは同期。今までどおり
//   if (board.qualifies({ score })) { ... }
//   for (const e of board.entries) { ... }
//
//   // タイトルへ戻ったら投げっぱなしで取り直す(待たせない)
//   board.refresh();
//
//   // 登録のときだけ待つ
//   const rank = await board.submit({ name, score });
//
// ## 供給元(source)の差し替え
//
// 「どこから取ってどこへ入れるか」は `source` で丸ごと入れ替えられる。
// ローカル保存もサーバも **同じ呼ばれ方**をするので、切り替えは source を渡す 1 行だけ。
//
//   {
//     fetch(key, ctx)          -> Promise<entries[]>       一覧を取る
//     submit(key, entry, ctx)  -> Promise<{rank, entries?}> 記録を送る
//     peek(key)                -> entries[] | null         任意。同期で出せる値があれば
//     replace(key, entries)    -> Promise<void>            任意。一覧を丸ごと差し替える
//     clear(key)               -> Promise<void>            任意。消す
//   }
//
// `peek()` は「起動した瞬間から並んでいてほしい」ための抜け道。
// ローカル保存は持っている(= 今までどおり即座に出る)。サーバは持たないので
// `defaults` から始まり、`refresh()` が終わった時点で本物に入れ替わる。
// 既定データをサーバにも同じ内容で入れておけば、この入れ替わりは目に見えない。
//
// `replace()` と `clear()` は手元の記録をいじる操作なので、ローカル保存だけが持つ。
// サーバ側の記録の削除・無効化は管理者の仕事で、ゲームからは触らない。

import { LocalStorageStore, MemoryStore } from '../storage.js';
// 保存先はほかからも使えるよう、ここからも取り出せるようにしておく
export { LocalStorageStore, MemoryStore };

/**
 * localStorage を供給元にしたもの(既定)。
 * サーバ版と同じ形にそろえるため、非同期でないものまで Promise で返す。
 * こうしておくと、あとでサーバへ替えても呼ぶ側のコードが 1 文字も変わらない。
 *
 * ## 通信の遅さを試す
 *
 * `delay` に秒数を渡すと、その秒数だけ待ってから返すようになる。
 * サーバがまだ無いうちに「取れるまでのあいだ何が見えているか」を
 * 手元で確かめるためのもの。
 *
 *   new LocalRankingSource({ delay: 5 })       // 5 秒かかることにする
 *   LocalRankingSource.defaultDelay = 5;       // 既定を 5 秒にする
 *
 * **遅れを入れているあいだは `peek()` が値を返さない。**
 * サーバには「同期で出せる値」が無いので、そこも同じにしてある。
 * つまり既定データから始まり、取れた時点で本物に入れ替わる ―― 本番と同じ道筋になる。
 */
export class LocalRankingSource {
  /** 既定の遅れ(秒)。ここを書き換えると、指定しなかったものすべてに効く */
  static defaultDelay = 0;

  /**
   * @param {{
   *   storage?: object,   保存先(既定は localStorage)
   *   delay?: number,     取得・登録にかかることにする秒数(既定 0 = 待たない)
   * }} [opts]
   */
  constructor(opts = {}) {
    this.storage = opts.storage || new LocalStorageStore();
    this.delay = opts.delay ?? LocalRankingSource.defaultDelay;
  }

  /** 通信にかかることにした時間だけ待つ */
  _wait() {
    if (!(this.delay > 0)) return Promise.resolve();
    return new Promise(done => setTimeout(done, this.delay * 1000));
  }

  /**
   * 同期で出せる値を返す。起動直後の初回表示に使う。
   * 遅れを入れているときは、サーバに合わせて何も返さない
   */
  peek(key) {
    if (this.delay > 0) return null;
    return this.storage.load(key);
  }

  /** 一覧を取り直す(手元なので本当は即返るが、遅れを入れていれば待つ) */
  async fetch(key) {
    await this._wait();
    return this.storage.load(key);
  }

  /**
   * 記録を登録する。
   * 手元の表は呼び出し側(RankingBoard)がすでに並べ替えたあとなので、
   * ここでは受け取った一覧をそのまま保存するだけでよい。
   * @param {string} key
   * @param {object} entry
   * @param {{ entries: object[], rank: number, max: number }} ctx
   */
  async submit(key, entry, ctx) {
    await this._wait();
    if (ctx && Array.isArray(ctx.entries)) this.storage.save(key, ctx.entries);
    return { rank: ctx ? ctx.rank : -1 };
  }

  // replace() と clear() は通信ではなく手元の手入れなので、遅れは入れない

  /** 一覧を丸ごと書き換える(古い記録の手入れなど、手元だけの用事) */
  async replace(key, entries) {
    this.storage.save(key, entries);
  }

  /** 消す(既定データに戻すとき) */
  async clear(key) {
    this.storage.remove(key);
  }
}

export class RankingBoard {
  /**
   * @param {{
   *   key: string,                  この表を指すキー
   *   max?: number,                 手元に持つ件数(既定 100)
   *   defaults?: object[],          記録が足りないときに埋める既定データ
   *   compare?: (a:object,b:object)=>number,  並び順(既定は score の降順)
   *   source?: object,              供給元(既定はローカル保存)
   *   meKey?: string,               「自分の記録」を覚えるキー
   *   meStore?: object,             自分の記録の保存先(既定は localStorage)
   *   minIntervalMs?: number,       取り直しの間隔の下限(既定 30 秒)
   * }} opts
   */
  constructor(opts) {
    this.key = opts.key;
    this.max = opts.max ?? 100;
    this.defaults = opts.defaults || [];
    this.compare = opts.compare || ((a, b) => (b.score || 0) - (a.score || 0));
    this.source = opts.source || new LocalRankingSource();
    this.meKey = opts.meKey || (opts.key + '-me');
    // 「自分の記録」は誰の端末かという話なので、供給元がサーバでも必ず手元に持つ
    this.meStore = opts.meStore || new LocalStorageStore();
    this.minIntervalMs = opts.minIntervalMs ?? 30000;

    /** @type {object[]} 手元に持っている一覧の写し(読み出しは常にこれ) */
    this.entries = [];
    /** @type {object|null} 自分が最後に登録した記録 */
    this.me = null;
    /** @type {boolean} いま取りに行っている最中か */
    this.busy = false;
    /** @type {number} 最後に取り直した時刻(0 = まだ取っていない) */
    this.fetchedAt = 0;
    /** @type {any} 直近の通信で起きた失敗(遊びは止めないので、見たい人だけ見る) */
    this.lastError = null;

    const me = this.meStore.load(this.meKey);
    this.me = me && typeof me === 'object' ? me : null;
    // 供給元が同期で出せる値を持っていれば、起動した瞬間から並べておく。
    // 持っていなければ既定データで始まり、refresh() のあとで本物になる
    const seed = typeof this.source.peek === 'function' ? this.source.peek(this.key) : null;
    this.entries = this._merge(seed);
  }

  // ---- ここから下は同期。描画や判定はすべてこちらを使う ----

  /**
   * 手元の記録を直接いじれるか(= ローカル保存を供給元にしているか)。
   * 古い記録の手入れのように「保存してあるものを書き換える」用事は、
   * サーバが相手のときは成り立たない(記録の書き換えは管理者の仕事)。
   * そういう処理を呼ぶ前にこれで確かめる。
   */
  get editable() {
    return typeof this.source.replace === 'function';
  }

  /** 1 位の記録(無ければ null) */
  top() { return this.entries[0] || null; }

  /** 表示用に n 件ぶん切り出す */
  page(top, rows) { return this.entries.slice(top, top + rows); }

  /** この記録が表に載るか(手元の写しでの判定なので、ずれることがある) */
  qualifies(entry) {
    const e = typeof entry === 'object' ? entry : { score: entry };
    if (this.entries.length < this.max) return true;
    return this.compare(e, this.entries[this.entries.length - 1]) < 0;
  }

  /**
   * この記録を今このまま入れたら何位になるか(0 起点)。載らないときは -1。
   * 登録する前に「何位です」と見せるために使う。
   * 同じ値の記録がすでにあるときは、その後ろ(= 登録したときと同じ扱い)になる。
   */
  rankOf(entry) {
    const e = typeof entry === 'object' ? entry : { score: entry };
    if (!this.qualifies(e)) return -1;
    let i = 0;
    while (i < this.entries.length && this.compare(e, this.entries[i]) >= 0) i++;
    return i;
  }

  /** 自分の記録が何番目か(無ければ -1) */
  myIndex() {
    if (!this.me) return -1;
    const i = this.entries.indexOf(this.me);
    if (i >= 0) return i;
    // 取り直したあとは別オブジェクトになっているので中身で探す
    return this.entries.findIndex(e => this._sameEntry(e, this.me));
  }

  /**
   * 記録を手元の表へ入れて、そのまま裏で登録も投げる(応答は待たない)。
   * 同期で順位を返すので、これまでの `Ranking.add()` と同じように書ける。
   * 正しい順位が要るときは `submit()` を使う。
   * @param {object} entry
   * @param {boolean} [asMine=true] 自分の記録として覚えるか
   * @returns {number} 手元での順位(0 起点)。載らなかったときは -1
   */
  add(entry, asMine = true) {
    const rank = this._apply(entry, asMine);
    this._send(entry, rank);   // 投げっぱなし。失敗しても遊びは止めない
    return rank;
  }

  /** 既定データに戻す(手元だけ。サーバの記録には触らない) */
  reset() {
    if (typeof this.source.clear === 'function') this._quiet(this.source.clear(this.key));
    this.meStore.remove(this.meKey);
    this.me = null;
    this.fetchedAt = 0;
    this.entries = this._merge(null);
    return this.entries;
  }

  /**
   * 手元の一覧を供給元へそのまま書き戻す。
   * 古い記録の手入れなど、**手元の保存にしか意味がない用事**のためのもの。
   * サーバを供給元にしているときは何も起きない。
   */
  save() {
    if (typeof this.source.replace === 'function') {
      this._quiet(this.source.replace(this.key, this.entries));
    }
    if (this.me) this.meStore.save(this.meKey, this.me);
  }

  // ---- ここから下は非同期。通信するのはこの 2 つだけ ----

  /**
   * 一覧を取り直す。**待たせないために投げっぱなしで呼ぶことを想定**している。
   * 失敗しても手元の写しはそのまま残るので、遊びは止まらない。
   * @param {{ force?: boolean }} [opts] force で間隔の下限を無視する
   * @returns {Promise<boolean>} 入れ替わったら true
   */
  async refresh(opts = {}) {
    if (this.busy) return false;   // 二重に取りに行かない
    const now = Date.now();
    if (!opts.force && this.fetchedAt && now - this.fetchedAt < this.minIntervalMs) return false;
    this.busy = true;
    try {
      const list = await this.source.fetch(this.key, { max: this.max });
      this.entries = this._merge(list);
      this.fetchedAt = Date.now();
      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = e;
      return false;
    } finally {
      this.busy = false;
    }
  }

  /**
   * 記録を登録して、**正しい順位**を受け取る。
   * 手元の表へは先に入れてしまうので、通信に失敗しても順位は返る(見込みの値)。
   * @param {object} entry
   * @param {boolean} [asMine=true]
   * @returns {Promise<number>} 順位(0 起点)。載らなかったときは -1
   */
  async submit(entry, asMine = true) {
    const rank = this._apply(entry, asMine);
    const real = await this._send(entry, rank);
    return typeof real === 'number' ? real : rank;
  }

  // ---- 内部 ----

  /** 手元の表へ入れて順位を返す(通信はしない) */
  _apply(entry, asMine) {
    const e = Object.assign({}, entry);
    if (asMine) {
      e.mine = true;
      this.me = e;
      this.meStore.save(this.meKey, e);
    }
    this.entries.push(e);
    this.entries.sort(this.compare);
    this.entries = this.entries.slice(0, this.max);
    return this.entries.indexOf(e);
  }

  /**
   * 供給元へ登録を投げる。**決して例外を投げない**(投げっぱなしで呼ぶため)。
   * @returns {Promise<number|null>} 供給元が返した順位。分からなければ null
   */
  async _send(entry, rank) {
    try {
      const res = await this.source.submit(this.key, entry, {
        entries: this.entries, rank, max: this.max,
      });
      this.lastError = null;
      // 登録のついでに新しい一覧をくれたら、それで入れ替える
      if (res && Array.isArray(res.entries)) {
        this.entries = this._merge(res.entries);
        this.fetchedAt = Date.now();
      }
      return res && typeof res.rank === 'number' ? res.rank : null;
    } catch (e) {
      this.lastError = e;
      return null;
    }
  }

  /**
   * 受け取った一覧と既定データを混ぜて、並べて、上位 max 件にする。
   * 既定データを他の表と共有してしまわないよう、必ず写しを作る。
   */
  _merge(saved) {
    const list = Array.isArray(saved) ? saved.slice(0, this.max) : [];
    const need = Math.max(0, this.max - list.length);
    const merged = list.concat(this.defaults.slice(0, need));
    const copy = merged.map(e => Object.assign({}, e));
    copy.sort(this.compare);
    const out = copy.slice(0, this.max);
    this._markMine(out);
    return out;
  }

  /**
   * 自分の記録に目印を付ける。
   * サーバから取り直した一覧には目印が入っていないので、ここで付け直す。
   * (すでに付いている目印は消さない。手元に残っている昔の記録のため)
   */
  _markMine(list) {
    if (!this.me) return;
    const i = list.findIndex(e => this._sameEntry(e, this.me));
    if (i >= 0) list[i].mine = true;
  }

  /** 同じ記録か(取り直すと別オブジェクトになるので中身で見る) */
  _sameEntry(a, b) {
    return !!a && !!b &&
      a.name === b.name &&
      a.score === b.score &&
      a.frames === b.frames;
  }

  /** 投げっぱなしの Promise を握りつぶす(失敗しても遊びは止めない) */
  _quiet(p) {
    if (p && typeof p.catch === 'function') p.catch(e => { this.lastError = e; });
  }
}

/** タイム(短いほど上位)向けの比較関数 */
export const byTime = (a, b) => (a.frames || 0) - (b.frames || 0);
/** 得点(高いほど上位)向けの比較関数 */
export const byScore = (a, b) => (b.score || 0) - (a.score || 0);
