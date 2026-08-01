// ランキング表。得点でもタイムでも使えるよう、並び順は比較関数で決める。
// エンジン本体からは切り離した任意の部品なので、使わなければ読み込まれない。
//
//   import { Ranking, byScore } from './engine/util/ranking.js';
//
//   const table = new Ranking({
//     key: 'mygame-scores',
//     max: 100,
//     defaults: [{ name: 'CPU', score: 10000 }],
//   });
//   if (table.qualifies(score)) table.add({ name: 'YOU', score });
//
// ## 保存先の差し替え
//
// 保存先は `storage` で丸ごと入れ替えられる。
// 同じ形さえ持っていれば、localStorage でもサーバでも構わない。
//
//   {
//     load(key)          -> 値(あるいは Promise)
//     save(key, value)   -> void(あるいは Promise)
//     remove(key)        -> void(あるいは Promise)
//   }
//
// サーバ上の共通ランキングに差し替えるときは、この 3 つを実装したものを渡す。
// いまは同期の保存先しか使っていないが、非同期に広げられるよう
// 戻り値を見ない作りにしてある。

import { LocalStorageStore, MemoryStore } from '../storage.js';
// 保存先はほかからも使えるよう、ここからも取り出せるようにしておく
export { LocalStorageStore, MemoryStore };

export class Ranking {
  /**
   * @param {{
   *   key: string,                  保存に使うキー
   *   max?: number,                 記録する件数(既定 100)
   *   defaults?: object[],          記録が足りないときに埋める既定データ
   *   compare?: (a:object,b:object)=>number,  並び順(既定は score の降順)
   *   storage?: object,             保存先(既定は localStorage)
   *   meKey?: string,               「自分の記録」を覚えるキー
   * }} opts
   */
  constructor(opts) {
    this.key = opts.key;
    this.max = opts.max ?? 100;
    this.defaults = opts.defaults || [];
    this.compare = opts.compare || ((a, b) => (b.score || 0) - (a.score || 0));
    this.storage = opts.storage || new LocalStorageStore();
    this.meKey = opts.meKey || (opts.key + '-me');
    /** @type {object[]} */
    this.entries = [];
    /** @type {object|null} 自分が最後に登録した記録 */
    this.me = null;
    this.load();
  }

  /** 保存先から読み込む(足りないぶんは既定データで埋める) */
  load() {
    const saved = this.storage.load(this.key);
    const list = Array.isArray(saved) ? saved.slice(0, this.max) : [];
    const merged = list.concat(this.defaults.slice(0, Math.max(0, this.max - list.length)));
    merged.sort(this.compare);
    this.entries = merged.slice(0, this.max);
    const me = this.storage.load(this.meKey);
    this.me = me && typeof me === 'object' ? me : null;
    return this.entries;
  }

  /** 保存先へ書き出す */
  save() {
    this.storage.save(this.key, this.entries);
    if (this.me) this.storage.save(this.meKey, this.me);
  }

  /** 既定データに戻す */
  reset() {
    this.storage.remove(this.key);
    this.storage.remove(this.meKey);
    this.entries = this.defaults.slice(0, this.max);
    this.me = null;
    return this.entries;
  }

  /** 1 位の記録(無ければ null) */
  top() { return this.entries[0] || null; }

  /** この記録が表に載るか */
  qualifies(entry) {
    const e = typeof entry === 'object' ? entry : { score: entry };
    if (this.entries.length < this.max) return true;
    return this.compare(e, this.entries[this.entries.length - 1]) < 0;
  }

  /**
   * 記録を追加して保存する。
   * @param {object} entry
   * @param {boolean} [asMine=true] 自分の記録として覚えるか
   * @returns {number} 入った順位(0 起点)。載らなかったときは -1
   */
  add(entry, asMine = true) {
    const e = Object.assign({}, entry);
    if (asMine) { e.mine = true; this.me = e; }
    this.entries.push(e);
    this.entries.sort(this.compare);
    this.entries = this.entries.slice(0, this.max);
    this.save();
    return this.entries.indexOf(e);
  }

  /**
   * この記録を今このまま入れたら何位になるか(0 起点)。載らないときは -1。
   * add() する前に「何位です」と見せるために使う。
   * 同じ値の記録がすでにあるときは、その後ろ(= add() と同じ扱い)になる。
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
    // 読み直したあとは別オブジェクトになるので中身で探す
    return this.entries.findIndex(e =>
      e.name === this.me.name &&
      e.score === this.me.score &&
      e.frames === this.me.frames);
  }

  /** 表示用に n 件ぶん切り出す */
  page(top, rows) {
    return this.entries.slice(top, top + rows);
  }
}

// 旧名(エンジン本体に置いていたころの名前)。既存のコードのために残す
export { Ranking as HiScoreTable };

/** タイム(短いほど上位)向けの比較関数 */
export const byTime = (a, b) => (a.frames || 0) - (b.frames || 0);
/** 得点(高いほど上位)向けの比較関数 */
export const byScore = (a, b) => (b.score || 0) - (a.score || 0);
