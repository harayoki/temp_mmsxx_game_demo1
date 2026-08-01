// エラーログ。
// 日付ごとに 1 つのログにまとめ、3 日ぶんだけ残す(起動時に古いものを消す)。
// 保存先は localStorage(ブラウザだけで完結させるため)。
//
// 手元の開発中(msx.isLocal)は、エラーが出たらその場で止めて気づけるようにする。
// 公開版は、致命的でなければ記録だけしてゲームを続ける。

const PREFIX = 'mmsxx-errlog-';
const KEEP_DAYS = 3;

/** その日のキー(YYYY-MM-DD) */
function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readStore() {
  try { return window.localStorage; } catch (e) { return null; }
}

export class ErrorLog {
  /**
   * @param {{local?:boolean, keepDays?:number}} [opts]
   *   local = true なら、エラーで止める(開発中の取りこぼしを防ぐ)
   */
  constructor(opts = {}) {
    this.local = !!opts.local;
    this.keepDays = opts.keepDays ?? KEEP_DAYS;
    this.store = readStore();
    this.cleanup();
  }

  /** 3 日より古いログを消す(起動時に 1 回) */
  cleanup() {
    if (!this.store) return;
    const keep = new Set();
    const now = new Date();
    for (let i = 0; i < this.keepDays; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      keep.add(PREFIX + todayKey(d));
    }
    const drop = [];
    for (let i = 0; i < this.store.length; i++) {
      const k = this.store.key(i);
      if (k && k.startsWith(PREFIX) && !keep.has(k)) drop.push(k);
    }
    for (const k of drop) {
      try { this.store.removeItem(k); } catch (e) { /* 消せなくても続ける */ }
    }
  }

  /**
   * 1 件記録する。
   * @param {string} msg
   * @param {{fatal?:boolean, stack?:string}} [info]
   * @returns {boolean} true = このまま続けてよい / false = 止めるべき
   */
  log(msg, info = {}) {
    const line = `${new Date().toISOString()} ${info.fatal ? '[FATAL] ' : ''}${msg}` +
      (info.stack ? `\n${info.stack}` : '');
    if (this.store) {
      const key = PREFIX + todayKey();
      try {
        const prev = this.store.getItem(key) || '';
        // ログが太りすぎないよう、1 日ぶんは 64KB までにする
        const next = (prev + line + '\n').slice(-64 * 1024);
        this.store.setItem(key, next);
      } catch (e) { /* 書けなくてもゲームは続ける */ }
    }
    // 開発中は止めて気づけるように。公開版は致命的なときだけ止める
    return !(this.local || info.fatal);
  }

  /** その日のログを読む(デバッグ用) */
  read(day = todayKey()) {
    if (!this.store) return '';
    try { return this.store.getItem(PREFIX + day) || ''; } catch (e) { return ''; }
  }

  /** 残っているログの日付を新しい順に返す */
  days() {
    if (!this.store) return [];
    const out = [];
    for (let i = 0; i < this.store.length; i++) {
      const k = this.store.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out.sort().reverse();
  }

  /** 全部消す(デバッグ用) */
  clear() {
    if (!this.store) return;
    for (const d of this.days()) {
      try { this.store.removeItem(PREFIX + d); } catch (e) { /* ignore */ }
    }
  }

  /**
   * window のエラーを拾って記録する。
   * 開発中は握りつぶさずそのまま止める。
   */
  install() {
    if (typeof window === 'undefined') return this;
    window.addEventListener('error', (ev) => {
      const cont = this.log(String(ev.message || ev.error), {
        stack: ev.error && ev.error.stack,
      });
      if (cont) ev.preventDefault();   // 公開版は続行
    });
    window.addEventListener('unhandledrejection', (ev) => {
      const cont = this.log('unhandled rejection: ' + String(ev.reason), {
        stack: ev.reason && ev.reason.stack,
      });
      if (cont) ev.preventDefault();
    });
    return this;
  }
}
