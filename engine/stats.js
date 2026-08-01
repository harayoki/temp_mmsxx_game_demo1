// プレイ統計。ゲームの出来事を時刻つきで記録して、あとから集計する。
//
// バランス調整の材料を集めるための仕組みで、記録する中身はゲーム側が自由に決める。
//
//   const stats = new StatsLog({ key: 'mygame-stats' });
//   stats.startSession({ mode: 'normal' });
//   stats.log('item', { kind: 'power' });
//   stats.log('death', { cause: 'ENEMY SHOT', stage: 2 });
//   stats.endSession({ score: 12300 });
//   stats.summary();     // 集計して見る
//   stats.compact();     // 集計結果だけ残して生ログを捨てる
//
// 保存先は差し替えられる(既定は localStorage)。
// あとから KV ストアやサーバーへ送る形にも移せる。

import { LocalStorageStore } from './storage.js';

export class StatsLog {
  /**
   * @param {{
   *   key: string,            保存に使うキー
   *   storage?: object,       保存先(既定は localStorage)
   *   maxEvents?: number,     生ログの上限(超えたら古いものから捨てる)
   *   maxSessions?: number,   まとめて残すセッション数
   *   now?: () => number,     時刻の取り方(テスト用に差し替えられる)
   * }} opts
   */
  constructor(opts) {
    this.key = opts.key;
    this.storage = opts.storage || new LocalStorageStore();
    this.maxEvents = opts.maxEvents ?? 5000;
    this.maxSessions = opts.maxSessions ?? 100;
    this.now = opts.now || (() => Date.now());
    /** @type {{t:number,type:string,s:number}[]} 生ログ(t = 時刻) */
    this.events = [];
    /** @type {object[]} セッションごとのまとめ */
    this.sessions = [];
    /** @type {object} 集計済みの累積(生ログを捨てても残る) */
    this.totals = {};
    this.session = null;
    this.load();
  }

  // ---- 保存 ----

  load() {
    const d = this.storage.load(this.key);
    if (d && typeof d === 'object') {
      this.events = Array.isArray(d.events) ? d.events : [];
      this.sessions = Array.isArray(d.sessions) ? d.sessions : [];
      this.totals = d.totals && typeof d.totals === 'object' ? d.totals : {};
    }
    return this;
  }

  save() {
    this.storage.save(this.key, {
      events: this.events, sessions: this.sessions, totals: this.totals,
    });
    return this;
  }

  /** 全部消す */
  reset() {
    this.events = [];
    this.sessions = [];
    this.totals = {};
    this.session = null;
    this.storage.remove(this.key);
    return this;
  }

  // ---- 記録 ----

  /**
   * セッション(1 プレイ)を始める。
   * @param {object} [meta] mode など、あとで絞り込みに使う情報
   */
  startSession(meta = {}) {
    this.session = Object.assign({ id: this.sessions.length, start: this.now() }, meta);
    return this.session;
  }

  /**
   * 出来事を 1 件記録する。時刻(t)とセッション番号(s)は自動で付く。
   * @param {string} type 種類(例 'item' / 'death' / 'stage')
   * @param {object} [data] 好きな中身
   */
  log(type, data = {}) {
    const e = Object.assign({ t: this.now(), type, s: this.session ? this.session.id : -1 }, data);
    this.events.push(e);
    // 増えすぎたら古いものから捨てる(集計済みの totals は残る)
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    return e;
  }

  /** セッションを終える(まとめを sessions に積む) */
  endSession(meta = {}) {
    if (!this.session) return null;
    const s = Object.assign(this.session, meta, { end: this.now() });
    s.seconds = Math.round((s.end - s.start) / 1000);
    this.sessions.push(s);
    if (this.sessions.length > this.maxSessions) {
      this.sessions.splice(0, this.sessions.length - this.maxSessions);
    }
    this.session = null;
    this.save();
    return s;
  }

  // ---- 集計 ----

  /** 種類で絞った生ログ */
  select(type) {
    return type ? this.events.filter(e => e.type === type) : this.events.slice();
  }

  /** 件数 */
  count(type) { return this.select(type).length; }

  /** ある項目の値ごとの件数(例: 死因ごとの回数) */
  countBy(type, field) {
    const out = {};
    for (const e of this.select(type)) {
      const k = String(e[field]);
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  /** ある項目の合計 */
  sum(type, field) {
    return this.select(type).reduce((a, e) => a + (Number(e[field]) || 0), 0);
  }

  /** ある項目の平均 */
  avg(type, field) {
    const list = this.select(type);
    return list.length ? this.sum(type, field) / list.length : 0;
  }

  /** ある項目の値ごとの平均(例: 面ごとの平均スコア) */
  avgBy(type, groupField, field) {
    const acc = {};
    for (const e of this.select(type)) {
      const k = String(e[groupField]);
      (acc[k] = acc[k] || []).push(Number(e[field]) || 0);
    }
    const out = {};
    for (const [k, xs] of Object.entries(acc)) {
      out[k] = xs.reduce((a, b) => a + b, 0) / xs.length;
    }
    return out;
  }

  /**
   * 生ログを集計して totals に足し込む。
   * @param {Object<string, (log: StatsLog) => any>} aggregators
   *   例 { deaths: (l) => l.countBy('death', 'cause') }
   *   数値は足し算、オブジェクトはキーごとに足し算でまとめる。
   */
  aggregate(aggregators) {
    for (const [name, fn] of Object.entries(aggregators)) {
      const v = fn(this);
      this.totals[name] = mergeTotals(this.totals[name], v);
    }
    this.save();
    return this.totals;
  }

  /**
   * 集計してから生ログを捨てる(容量を空ける)。
   * 集計結果(totals)とセッションのまとめは残る。
   * @param {Object<string, Function>} [aggregators]
   */
  compact(aggregators) {
    if (aggregators) this.aggregate(aggregators);
    this.events = [];
    this.save();
    return this.totals;
  }

  /** 生ログが多くなってきたか(自動で compact したいとき用) */
  needsCompact(threshold = this.maxEvents * 0.8) {
    return this.events.length >= threshold;
  }
}

/** 集計結果を足し合わせる(数値は加算、オブジェクトはキーごとに加算) */
function mergeTotals(a, b) {
  if (a === undefined) return b;
  if (typeof b === 'number') return (typeof a === 'number' ? a : 0) + b;
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    const out = Object.assign({}, a);
    for (const [k, v] of Object.entries(b)) out[k] = mergeTotals(out[k], v);
    return out;
  }
  return b;
}
