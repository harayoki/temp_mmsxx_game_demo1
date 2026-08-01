// 保存先(ストア)。ハイスコア表やプレイ統計から共通で使う。
// load / save / remove の 3 つを持つオブジェクトなら何でも差し替えられるので、
// あとから KV ストアやサーバー API へ移せる。

/** localStorage に JSON で読み書きする保存先(既定) */
export class LocalStorageStore {
  /** @param {string} key */
  load(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;   // プライバシー設定などで読めないことがある
    }
  }
  save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;  // 容量オーバーなどで書けなくても続行する
    }
  }
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* 消せなくても続行 */ }
  }
}

/** 何も保存しない保存先(テストや「保存したくない」場面用) */
export class MemoryStore {
  constructor() { this.data = new Map(); }
  load(key) { return this.data.has(key) ? this.data.get(key) : null; }
  save(key, value) { this.data.set(key, value); return true; }
  remove(key) { this.data.delete(key); }
}
