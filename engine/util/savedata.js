// ローカル保存のデータ管理。ゲームの進行、プレイ統計、あとからのトロフィーなど、
// 「消えても致命的でない値」をまとめて面倒みる部品。
//
// ブラウザに置くだけなので、別のブラウザや別のマシンでは引き継がれない。
// アカウント管理はしない前提で、消えてもよいものだけを入れること。
//
//   import { SaveGroup, T, R, ok } from './engine/util/savedata.js';
//
//   const progress = new SaveGroup('starfable-progress', {
//     bossRush: { type: T.KEYS, keys: ['zeela', 'gamma', 'nova'], label: 'BOSS RUSH' },
//     cleared:  { type: T.FLAG },
//     lastRank: { type: T.ENUM, values: ['C', 'B', 'A', 'S'], init: 'C', ordered: true },
//   });
//
//   progress.addKey('bossRush', 'zeela');
//   progress.max('lastRank', 'A');
//   progress.flush();                     // ここで初めて保存される
//
// ## 型
//
//   STR        文字列。min / max 文字数の可変長、または len で固定長
//              (固定長は長ければ切り、短ければ空白で埋める)
//   COUNT      0 以上の整数。max(既定は安全な整数の上限)
//   NUMBER     数値。min / max / digits(小数の桁)。digits: 0 で整数(負も可)
//   FLAG       true / false
//   KEYS       キーの集合。有る/無いだけを持つ(図鑑、解放ずみの一覧)
//   INVENTORY  キーごとの個数。持ち物のように同じものを複数持てる
//   ENUM       決まった文字列のどれか。ordered: true なら max / min が使える
//
// ## 書き込みの結果
//
// 例外は投げない。ゲームループの中から呼ぶので、止まらないことを優先する。
// 戻り値は R の定数で、**正なら成功、負なら失敗**。ok(r) で判定できる。
//
//   R.UPDATED    書き換わった
//   R.UNCHANGED  もともと同じ値だった(成功あつかい)
//   R.INVALID    値が不正、または範囲外で拒否した
//   R.ERROR      定義が無いなど、呼びかたの間違い
//
// 範囲外の値を渡したときに「範囲へ収める」か「拒否する」かは、
// 書き込みのたびに { clamp: true / false } で選べる。既定は収める。
//
// ## 定義があとから変わったとき
//
// 保存してある生の値は**次の書き込みまでそのまま残る**。読み出すときだけ、
// いまの定義に合わせて丸めて返す。範囲が狭まっただけなら値は生き残るし、
// あとで範囲を戻せば元の値がまた読める。
//
// 定義が消えた値は一覧(names)には出ず、get でも読めない。
// orphanNames / orphanGet / orphanRemove でだけ触れる。
//
// ## 保存のタイミング
//
// 書き込みは印を付けるだけで、実際に保存するのは flush() を呼んだとき。
// 面クリア、死亡、ボス前、ゲーム開始前、設定変更後あたりで呼ぶ想定。
// 保存先はグループごとに分かれているので、flush もグループ単位になる。
//
// ## 中身を読みにくくする(secret)
//
// 定義ごとに secret: true を付けると、保存する値を軽く変換して、
// 見ただけでは何の値か分からないようにする。解析されれば読めるし、
// 書き換えも防げない。**JS のゲームなので、そこは許容する。**
// 重い処理や非同期処理は使わない(保存の流れが非同期に染まるため)。
//
// ## チェックサムを入れなかった理由(考察のまとめ)
//
// 値ごとにチェックサムを添えれば「外から書き換えられた」ことを検出できる。
// ただし今回は入れていない。
//
//   - 壊れたデータで落ちないことは、変換の失敗とバリデーションで既に足りている。
//     チェックサムが足すのは「意図的な書き換えの検出」だけ。
//   - 生データをいじられること自体を許容するので、その1点に見合わない。
//   - 保存する項目と、方式を変えたときの移行対象が増えて管理が重くなる。
//
// あとで必要になったら、そのときの状況に合った作りを足すこと。
// 入れる場合の要点だけ書き残しておく。
//
//   - 検証は**書き込み時ではなく読み出し時**。書き換える人はこちらの
//     書き込みを通らず、保存先を直接いじるため。
//   - チェックサムの材料に**グループ名と定義名を混ぜる**。値だけで固めると、
//     同じ形の値を別の場所から貼り付けられたときに素通りしてしまう。
//
// ## 値が変わったときの通知(V1 では作らない)
//
// トロフィーは「撃破数が N を超えた」「図鑑が全部埋まった」といった判定なので、
// 値の変化を1か所で拾えれば、トロフィー側は条件を並べるだけで済む。
// そのため将来 onChange(group, name, newValue, oldValue) のような
// 購読口をここに足す予定。書き込みが実際に値を変えたときだけ呼べばよく、
// R.UPDATED を返している場所がそのまま通知の位置になる。
// V1 では要らないので作っていない。

import { LocalStorageStore, MemoryStore } from '../storage.js';
export { LocalStorageStore, MemoryStore };

/** 型の名前 */
export const T = {
  STR: 'STR',
  COUNT: 'COUNT',
  NUMBER: 'NUMBER',
  FLAG: 'FLAG',
  KEYS: 'KEYS',
  INVENTORY: 'INVENTORY',
  ENUM: 'ENUM',
};

/** 書き込みの結果。正なら成功、負なら失敗 */
export const R = {
  UPDATED: 1,
  UNCHANGED: 2,
  INVALID: -1,
  ERROR: -2,
};

/** 書き込みの結果が成功だったか */
export const ok = (r) => r > 0;

/** COUNT の既定の上限 */
const COUNT_MAX = Number.MAX_SAFE_INTEGER;

/** 読みにくくした値の目印。数字は変換のしかたの版で、方式を変えても古い値を読めるようにする */
const ENC = '1:';

// ---- 定義 ----

/** 定義を型ごとに整える(足りないところに既定値を入れる) */
function normalize(name, def) {
  const d = Object.assign({}, def);
  d.name = name;
  d.label = def.label != null ? def.label : name;   // 表示名。重複してよい
  d.secret = !!def.secret;
  switch (d.type) {
    case T.STR:
      d.min = def.min ?? 0;
      d.max = def.max ?? 255;
      d.len = def.len ?? null;                       // ちょうどこの文字数(min/max より優先)
      d.init = def.init ?? '';
      break;
    case T.COUNT:
      d.max = def.max ?? COUNT_MAX;
      d.init = def.init ?? 0;
      break;
    case T.NUMBER:
      d.min = def.min ?? -Infinity;
      d.max = def.max ?? Infinity;
      d.digits = def.digits ?? 0;                    // 0 なら整数(負も可)
      d.init = def.init ?? 0;
      break;
    case T.FLAG:
      d.init = def.init ?? false;
      break;
    case T.KEYS:
      d.keys = def.keys || null;                     // 省略すると任意のキーを許す
      d.init = def.init || [];
      break;
    case T.INVENTORY:
      d.keys = def.keys || null;
      d.max = def.max ?? COUNT_MAX;                  // 1 種類あたりの上限
      d.init = def.init || {};
      break;
    case T.ENUM:
      d.values = def.values || [];
      d.ordered = !!def.ordered;
      d.init = def.init ?? d.values[0];
      break;
    default:
      d.type = null;                                 // 知らない型は無いものとして扱う
  }
  return d;
}

// ---- 値を定義に合わせる ----

// 戻りは { value, fitted, broken }
//   fitted … 収めるために手を入れた
//   broken … 手の入れようがない(初期値に倒す)

function fitStr(d, v) {
  if (typeof v !== 'string') return { value: d.init, fitted: true, broken: true };
  let s = v;
  let fitted = false;
  if (d.len != null) {
    // 固定長。長ければ切り、短ければ空白で埋める
    if (s.length > d.len) { s = s.slice(0, d.len); fitted = true; }
    if (s.length < d.len) { s = s + ' '.repeat(d.len - s.length); fitted = true; }
    return { value: s, fitted, broken: false };
  }
  if (s.length > d.max) { s = s.slice(0, d.max); fitted = true; }
  if (s.length < d.min) return { value: d.init, fitted: true, broken: true };  // 足す文字を決められない
  return { value: s, fitted, broken: false };
}

function fitCount(d, v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return { value: d.init, fitted: true, broken: true };
  let x = Math.floor(n);
  let fitted = x !== n;
  if (x < 0) { x = 0; fitted = true; }
  if (x > d.max) { x = d.max; fitted = true; }
  return { value: x, fitted, broken: false };
}

function fitNumber(d, v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return { value: d.init, fitted: true, broken: true };
  const p = Math.pow(10, d.digits);
  let x = Math.round(n * p) / p;
  let fitted = x !== n;
  if (x < d.min) { x = d.min; fitted = true; }
  if (x > d.max) { x = d.max; fitted = true; }
  return { value: x, fitted, broken: false };
}

function fitFlag(d, v) {
  if (typeof v === 'boolean') return { value: v, fitted: false, broken: false };
  return { value: !!v, fitted: true, broken: false };
}

function fitKeys(d, v) {
  if (!Array.isArray(v)) return { value: d.init.slice(), fitted: true, broken: true };
  const out = [];
  let fitted = false;
  for (const k of v) {
    if (typeof k !== 'string') { fitted = true; continue; }
    if (d.keys && d.keys.indexOf(k) < 0) { fitted = true; continue; }  // 定義から消えたキー
    if (out.indexOf(k) >= 0) { fitted = true; continue; }              // 重複
    out.push(k);
  }
  return { value: out, fitted, broken: false };
}

function fitInventory(d, v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { value: Object.assign({}, d.init), fitted: true, broken: true };
  }
  const out = {};
  let fitted = false;
  for (const [k, raw] of Object.entries(v)) {
    if (d.keys && d.keys.indexOf(k) < 0) { fitted = true; continue; }
    const c = fitCount(d, raw);
    if (c.broken || c.value <= 0) { fitted = true; continue; }         // 0 個は持っていないのと同じ
    if (c.fitted) fitted = true;
    out[k] = c.value;
  }
  return { value: out, fitted, broken: false };
}

function fitEnum(d, v) {
  if (typeof v === 'string' && d.values.indexOf(v) >= 0) {
    return { value: v, fitted: false, broken: false };
  }
  // 範囲に丸めようがないので、候補から消えた値は初期値へ落とす
  return { value: d.init, fitted: true, broken: true };
}

function fit(d, v) {
  switch (d.type) {
    case T.STR: return fitStr(d, v);
    case T.COUNT: return fitCount(d, v);
    case T.NUMBER: return fitNumber(d, v);
    case T.FLAG: return fitFlag(d, v);
    case T.KEYS: return fitKeys(d, v);
    case T.INVENTORY: return fitInventory(d, v);
    case T.ENUM: return fitEnum(d, v);
    default: return { value: undefined, fitted: true, broken: true };
  }
}

/** 同じ値か(配列とオブジェクトも中身で見る) */
function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
  }
  return false;
}

/** 中身を持ち回るときは複製する(外からいじられて保存値が変わらないように) */
function copy(v) {
  if (Array.isArray(v)) return v.slice();
  if (v && typeof v === 'object') return Object.assign({}, v);
  return v;
}

// ---- 読みにくくする ----

function toB64(s) {
  if (typeof btoa === 'function') return btoa(s);
  return Buffer.from(s, 'binary').toString('base64');
}

function fromB64(s) {
  if (typeof atob === 'function') return atob(s);
  return Buffer.from(s, 'base64').toString('binary');
}

/** グループ名と定義名から、変換に使う種を作る */
function seed(salt) {
  let h = 0x9e37;
  for (let i = 0; i < salt.length; i++) h = ((h << 5) - h + salt.charCodeAt(i)) & 0xffff;
  return h;
}

function scramble(text, salt) {
  const h = seed(salt);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    out += String.fromCharCode(text.charCodeAt(i) ^ ((h + i * 31) & 0x7f));
  }
  return out;
}

/** 値を読みにくい文字列にする。日本語も通るよう、いったんエスケープしてから混ぜる */
function encode(value, salt) {
  const json = encodeURIComponent(JSON.stringify(value));
  return ENC + toB64(scramble(json, salt));
}

/** encode の逆。読めなければ undefined(呼び側で初期値に倒す) */
function decode(text, salt) {
  try {
    const json = decodeURIComponent(scramble(fromB64(text.slice(ENC.length)), salt));
    return JSON.parse(json);
  } catch (e) {
    return undefined;
  }
}

// ---- 本体 ----

/** 作られたグループ。まとめて消したいときに使う */
const groups = [];

export class SaveGroup {
  /**
   * @param {string} key 保存に使うキー(グループごとに分ける)
   * @param {Object<string, object>} defs 定義。名前は重複できない(表示名は重複してよい)
   * @param {{
   *   storage?: object,   保存先(既定は localStorage)
   *   version?: number,   スキーマの版。合わなければ捨てて初期値から始める
   *   clamp?: boolean,    範囲外を収めるか(既定 true)。false なら拒否
   * }} [opts]
   */
  constructor(key, defs, opts = {}) {
    this.key = key;
    this.version = opts.version ?? 1;
    this.storage = opts.storage || new LocalStorageStore();
    this.clamp = opts.clamp !== false;
    /** @type {Map<string, object>} */
    this.defs = new Map();
    for (const [name, def] of Object.entries(defs || {})) {
      this.defs.set(name, normalize(name, def));
    }
    /** @type {Object<string, any>} 保存してある生の値(丸める前) */
    this.raw = {};
    /** 書き込みがあってまだ保存していない */
    this.dirty = false;
    this.load();
    groups.push(this);
  }

  // ---- 保存 ----

  /** 保存先から読み込む */
  load() {
    this.raw = {};
    this.dirty = false;
    const d = this.storage.load(this.key);
    if (!d || typeof d !== 'object') return this;
    if (d.v !== this.version) return this;            // 版が違うものは捨てる
    const data = d.d && typeof d.d === 'object' ? d.d : {};
    for (const [name, stored] of Object.entries(data)) {
      let v = stored;
      if (typeof v === 'string' && v.slice(0, ENC.length) === ENC) {
        v = decode(v, this.key + '/' + name);
        if (v === undefined) continue;                // 読めない値は無かったことにする
      }
      this.raw[name] = v;
    }
    return this;
  }

  /** 印が付いていれば保存する。面クリアや設定変更のあとなどで呼ぶ */
  flush(force = false) {
    if (!this.dirty && !force) return false;
    const data = {};
    for (const [name, v] of Object.entries(this.raw)) {
      const d = this.defs.get(name);
      data[name] = d && d.secret ? encode(v, this.key + '/' + name) : v;
    }
    const done = this.storage.save(this.key, { v: this.version, d: data });
    if (done !== false) this.dirty = false;
    return done !== false;
  }

  // ---- 定義を見る ----

  /** いま生きている定義の名前 */
  names() { return Array.from(this.defs.keys()); }

  /** 表示名(定義に無ければ定義名) */
  label(name) {
    const d = this.defs.get(name);
    return d ? d.label : undefined;
  }

  /** 型 */
  typeOf(name) {
    const d = this.defs.get(name);
    return d ? d.type : undefined;
  }

  // ---- 読み書き ----

  /** いまの定義に合わせて丸めた値。生の値は書き換えない */
  get(name) {
    const d = this.defs.get(name);
    if (!d) return undefined;
    const raw = Object.prototype.hasOwnProperty.call(this.raw, name) ? this.raw[name] : d.init;
    const r = fit(d, raw);
    return copy(r.broken ? d.init : r.value);
  }

  /** 初期値のままか(まだ一度も書かれていないか、書いた結果が初期値) */
  isInit(name) {
    const d = this.defs.get(name);
    if (!d) return false;
    return same(this.get(name), d.init);
  }

  /**
   * 値を入れる。
   * @param {string} name
   * @param {*} value
   * @param {{clamp?: boolean}} [opt] clamp: false なら範囲外を拒否する
   * @returns {number} R の定数
   */
  set(name, value, opt) {
    const d = this.defs.get(name);
    if (!d) return R.ERROR;
    const clamp = opt && opt.clamp !== undefined ? opt.clamp : this.clamp;
    const r = fit(d, value);
    if (r.broken) return R.INVALID;                   // 型からして合っていない
    if (r.fitted && !clamp) return R.INVALID;         // 収めずに拒否する
    return this._store(name, d, r.value);
  }

  /** 生の値を書き換える。同じなら何もしない */
  _store(name, d, value) {
    const before = Object.prototype.hasOwnProperty.call(this.raw, name)
      ? this.raw[name] : d.init;
    if (same(before, value)) return R.UNCHANGED;
    this.raw[name] = value;
    this.dirty = true;
    // ここが「値が変わった」場所。将来 onChange を足すならこの位置になる
    return R.UPDATED;
  }

  /** 足す(COUNT / NUMBER)。上限で止まったときも成功あつかい */
  add(name, amount = 1, opt) {
    const d = this.defs.get(name);
    if (!d) return R.ERROR;
    if (d.type !== T.COUNT && d.type !== T.NUMBER) return R.ERROR;
    const n = Number(amount);
    if (!Number.isFinite(n)) return R.INVALID;
    return this.set(name, this.get(name) + n, opt);
  }

  /** 記録の更新(いまより大きいときだけ入れる)。COUNT / NUMBER / 順序つき ENUM */
  max(name, value, opt) {
    return this._compare(name, value, 1, opt);
  }

  /** いまより小さいときだけ入れる */
  min(name, value, opt) {
    return this._compare(name, value, -1, opt);
  }

  _compare(name, value, dir, opt) {
    const d = this.defs.get(name);
    if (!d) return R.ERROR;
    if (d.type === T.ENUM) {
      if (!d.ordered) return R.ERROR;                 // 並び順が無いものは比べられない
      const now = d.values.indexOf(this.get(name));
      const next = d.values.indexOf(value);
      if (next < 0) return R.INVALID;
      if ((next - now) * dir <= 0) return R.UNCHANGED;
      return this.set(name, value, opt);
    }
    if (d.type !== T.COUNT && d.type !== T.NUMBER) return R.ERROR;
    const n = Number(value);
    if (!Number.isFinite(n)) return R.INVALID;
    if ((n - this.get(name)) * dir <= 0) return R.UNCHANGED;
    return this.set(name, n, opt);
  }

  // ---- KEYS ----

  /** キーを立てる(図鑑に載せる、解放する) */
  addKey(name, key) {
    const d = this.defs.get(name);
    if (!d || d.type !== T.KEYS) return R.ERROR;
    if (typeof key !== 'string' || !key) return R.INVALID;
    if (d.keys && d.keys.indexOf(key) < 0) return R.INVALID;
    const now = this.get(name);
    if (now.indexOf(key) >= 0) return R.UNCHANGED;
    now.push(key);
    return this._store(name, d, now);
  }

  /** キーを落とす */
  removeKey(name, key) {
    const d = this.defs.get(name);
    if (!d || d.type !== T.KEYS) return R.ERROR;
    const now = this.get(name);
    const i = now.indexOf(key);
    if (i < 0) return R.UNCHANGED;
    now.splice(i, 1);
    return this._store(name, d, now);
  }

  /** そのキーが立っているか */
  hasKey(name, key) {
    const d = this.defs.get(name);
    if (!d || d.type !== T.KEYS) return false;
    return this.get(name).indexOf(key) >= 0;
  }

  /** 立っているキーの数 */
  keyCount(name) {
    const d = this.defs.get(name);
    if (!d || d.type !== T.KEYS) return 0;
    return this.get(name).length;
  }

  /** 全部埋まったか(定義に候補の一覧があるときだけ意味がある) */
  filled(name) {
    const d = this.defs.get(name);
    if (!d || d.type !== T.KEYS || !d.keys) return false;
    return this.keyCount(name) >= d.keys.length;
  }

  /** 進みぐあい(0〜1)。候補の一覧が無ければ 0 */
  progress(name) {
    const d = this.defs.get(name);
    if (!d || d.type !== T.KEYS || !d.keys || !d.keys.length) return 0;
    return this.keyCount(name) / d.keys.length;
  }

  // ---- INVENTORY ----

  /** 持ち物を足す */
  addItem(name, key, amount = 1) {
    const d = this.defs.get(name);
    if (!d || d.type !== T.INVENTORY) return R.ERROR;
    if (typeof key !== 'string' || !key) return R.INVALID;
    if (d.keys && d.keys.indexOf(key) < 0) return R.INVALID;
    const n = Number(amount);
    if (!Number.isFinite(n)) return R.INVALID;
    const now = this.get(name);
    const next = Math.min(d.max, Math.max(0, Math.floor((now[key] || 0) + n)));
    if (next <= 0) delete now[key];                   // 0 個は持っていないのと同じ
    else now[key] = next;
    return this._store(name, d, now);
  }

  /** 持ち物を減らす */
  removeItem(name, key, amount = 1) {
    return this.addItem(name, key, -Math.abs(Number(amount) || 0));
  }

  /** 持ち物をまるごと捨てる */
  dropItem(name, key) {
    const d = this.defs.get(name);
    if (!d || d.type !== T.INVENTORY) return R.ERROR;
    const now = this.get(name);
    if (!(key in now)) return R.UNCHANGED;
    delete now[key];
    return this._store(name, d, now);
  }

  /** その持ち物の個数 */
  itemCount(name, key) {
    const d = this.defs.get(name);
    if (!d || d.type !== T.INVENTORY) return 0;
    return this.get(name)[key] || 0;
  }

  /** 持っているものの名前 */
  itemKeys(name) {
    const d = this.defs.get(name);
    if (!d || d.type !== T.INVENTORY) return [];
    return Object.keys(this.get(name));
  }

  // ---- 消す ----

  /** ひとつだけ初期値に戻す */
  reset(name) {
    const d = this.defs.get(name);
    if (!d) return R.ERROR;
    if (!Object.prototype.hasOwnProperty.call(this.raw, name)) return R.UNCHANGED;
    delete this.raw[name];
    this.dirty = true;
    return R.UPDATED;
  }

  /** グループごと消す(定義が消えた値もまとめて消える) */
  resetAll() {
    this.raw = {};
    this.dirty = false;
    this.storage.remove(this.key);
    return this;
  }

  // ---- 定義が消えた値 ----

  /** 定義が無くなった値の名前 */
  orphanNames() {
    return Object.keys(this.raw).filter((n) => !this.defs.has(n));
  }

  /** 定義が無くなった値。丸めようがないので生のまま返す */
  orphanGet(name) {
    if (this.defs.has(name)) return undefined;
    return copy(this.raw[name]);
  }

  /** 定義が無くなった値を消す */
  orphanRemove(name) {
    if (this.defs.has(name)) return R.ERROR;
    if (!Object.prototype.hasOwnProperty.call(this.raw, name)) return R.UNCHANGED;
    delete this.raw[name];
    this.dirty = true;
    return R.UPDATED;
  }

  /** 定義が無くなった値をまとめて消す */
  orphanPurge() {
    let n = 0;
    for (const name of this.orphanNames()) {
      delete this.raw[name];
      n++;
    }
    if (n) this.dirty = true;
    return n;
  }

  // ---- まとめて ----

  /** 作られたグループ全部 */
  static all() { return groups.slice(); }

  /** 全グループを保存する */
  static flushAll() { for (const g of groups) g.flush(); }

  /** 全グループを消す(セーブデータの初期化) */
  static resetAll() { for (const g of groups) g.resetAll(); }

  /** 全グループの、定義が無くなった値を消して保存する */
  static orphanPurgeAll() {
    let n = 0;
    for (const g of groups) {
      const c = g.orphanPurge();
      if (c) { n += c; g.flush(); }
    }
    return n;
  }
}

// ---- 簡単なテスト ----

// 別ファイルにせず、ここに置いてある。
//
//   node -e "import('./engine/util/savedata.js').then(m => process.exit(m.selfTest().fail))"
//
// ブラウザの開発版なら、コンソールから selfTest() を呼んでも同じ。

/**
 * 自己テスト。保存先は MemoryStore なので何も残さない。
 * @param {(msg: string) => void} [log]
 * @returns {{pass: number, fail: number}}
 */
export function selfTest(log = (m) => console.log(m)) {
  let pass = 0, fail = 0;
  const check = (name, cond) => {
    if (cond) { pass++; } else { fail++; log('FAIL: ' + name); }
  };
  const eq = (name, a, b) => check(name + ' (got ' + JSON.stringify(a) + ')', same(a, b) || a === b);

  const defs = () => ({
    playerName: { type: T.STR, len: 3, init: 'YOU', label: 'NAME' },
    memo: { type: T.STR, min: 1, max: 8, init: 'X' },
    shots: { type: T.COUNT },
    deaths: { type: T.COUNT, max: 99 },
    rapid: { type: T.NUMBER, min: 0, max: 30, digits: 1 },
    balance: { type: T.NUMBER, min: -100, max: 100, digits: 0 },
    cleared: { type: T.FLAG },
    zukan: { type: T.KEYS, keys: ['a', 'b', 'c'] },
    bag: { type: T.INVENTORY, max: 9 },
    rank: { type: T.ENUM, values: ['C', 'B', 'A', 'S'], init: 'C', ordered: true },
    difficulty: { type: T.ENUM, values: ['easy', 'normal', 'hard'], init: 'normal' },
  });

  const store = new MemoryStore();
  let g = new SaveGroup('test', defs(), { storage: store });

  // 初期値
  eq('init STR', g.get('playerName'), 'YOU');
  eq('init COUNT', g.get('shots'), 0);
  eq('init FLAG', g.get('cleared'), false);
  eq('init KEYS', g.get('zukan'), []);
  eq('init ENUM', g.get('rank'), 'C');
  eq('label falls back to name', g.label('shots'), 'shots');
  eq('label from def', g.label('playerName'), 'NAME');

  // 結果の定数
  check('unknown name is ERROR', g.set('nope', 1) === R.ERROR);
  check('set returns UPDATED', g.set('cleared', true) === R.UPDATED);
  check('same value is UNCHANGED', g.set('cleared', true) === R.UNCHANGED);
  check('UNCHANGED counts as ok', ok(R.UNCHANGED) && !ok(R.INVALID));

  // STR
  check('exact length ok', ok(g.set('playerName', 'ABC')));
  check('too long is trimmed', ok(g.set('playerName', 'ABCDE')));
  eq('trimmed to len', g.get('playerName'), 'ABC');
  check('too short is padded', ok(g.set('playerName', 'AB')));
  eq('padded with spaces', g.get('playerName'), 'AB ');
  check('empty is padded too', ok(g.set('playerName', '')));
  eq('all spaces', g.get('playerName'), '   ');
  g.set('playerName', 'ABC');
  check('reject when clamp off', g.set('memo', 'ABCDEFGHIJ', { clamp: false }) === R.INVALID);
  eq('rejected write keeps old value', g.get('memo'), 'X');
  check('clamp on trims', ok(g.set('memo', 'ABCDEFGHIJ')));
  eq('trimmed to max', g.get('memo'), 'ABCDEFGH');

  // COUNT
  check('add returns UPDATED', g.add('shots', 3) === R.UPDATED);
  g.add('shots', 2);
  eq('add accumulates', g.get('shots'), 5);
  g.add('deaths', 200);
  eq('count stops at max', g.get('deaths'), 99);
  check('negative is clamped to 0', ok(g.set('shots', -5)));
  eq('count never goes below 0', g.get('shots'), 0);
  check('non number is INVALID', g.set('shots', 'x') === R.INVALID);

  // NUMBER
  g.set('rapid', 12.34);
  eq('rounded to digits', g.get('rapid'), 12.3);
  check('max updates record', g.max('rapid', 15) === R.UPDATED);
  check('max ignores lower', g.max('rapid', 9) === R.UNCHANGED);
  eq('record kept', g.get('rapid'), 15);
  g.set('balance', -12.6);
  eq('digits 0 allows negative', g.get('balance'), -13);

  // KEYS
  check('addKey UPDATED', g.addKey('zukan', 'a') === R.UPDATED);
  check('addKey again UNCHANGED', g.addKey('zukan', 'a') === R.UNCHANGED);
  check('unknown key INVALID', g.addKey('zukan', 'z') === R.INVALID);
  check('hasKey', g.hasKey('zukan', 'a') && !g.hasKey('zukan', 'b'));
  g.addKey('zukan', 'b');
  eq('progress', Math.round(g.progress('zukan') * 100), 67);
  check('not filled yet', !g.filled('zukan'));
  g.addKey('zukan', 'c');
  check('filled', g.filled('zukan'));
  check('removeKey', g.removeKey('zukan', 'c') === R.UPDATED && !g.filled('zukan'));

  // INVENTORY
  g.addItem('bag', 'bomb', 2);
  g.addItem('bag', 'bomb', 3);
  eq('items stack', g.itemCount('bag', 'bomb'), 5);
  g.addItem('bag', 'bomb', 99);
  eq('item stops at max', g.itemCount('bag', 'bomb'), 9);
  g.removeItem('bag', 'bomb', 4);
  eq('removeItem subtracts', g.itemCount('bag', 'bomb'), 5);
  g.addItem('bag', 'shield', 1);
  eq('two kinds', g.itemKeys('bag').length, 2);
  g.dropItem('bag', 'shield');
  eq('dropItem removes the kind', g.itemKeys('bag').length, 1);
  g.removeItem('bag', 'bomb', 100);
  eq('emptied item disappears', g.itemKeys('bag').length, 0);

  // ENUM
  check('ordered max works', g.max('rank', 'A') === R.UPDATED);
  check('ordered max ignores lower', g.max('rank', 'B') === R.UNCHANGED);
  check('unordered max is ERROR', g.max('difficulty', 'hard') === R.ERROR);
  check('unknown value INVALID', g.set('rank', 'Z') === R.INVALID);
  check('known value ok', ok(g.set('difficulty', 'hard')));

  // 保存と読み直し
  check('dirty before flush', g.dirty === true);
  check('flush saves', g.flush() === true);
  check('not dirty after flush', g.dirty === false);
  check('flush without change does nothing', g.flush() === false);
  g = new SaveGroup('test', defs(), { storage: store });
  eq('reloaded COUNT', g.get('deaths'), 99);
  eq('reloaded ENUM', g.get('rank'), 'A');
  eq('reloaded INVENTORY', g.itemKeys('bag').length, 0);
  eq('reloaded KEYS', g.get('zukan'), ['a', 'b']);

  // 定義が変わったとき
  const narrowed = defs();
  narrowed.deaths = { type: T.COUNT, max: 10 };        // 上限を下げた
  narrowed.zukan = { type: T.KEYS, keys: ['a'] };      // 候補を減らした
  delete narrowed.memo;                                // 定義そのものを消した
  narrowed.added = { type: T.COUNT, init: 7 };         // あとから足した
  let n = new SaveGroup('test', narrowed, { storage: store });
  eq('narrowed range is rounded on read', n.get('deaths'), 10);
  eq('dropped key hidden on read', n.get('zukan'), ['a']);
  eq('added def uses its init', n.get('added'), 7);
  eq('deleted def is not listed', n.names().indexOf('memo'), -1);
  eq('deleted def not readable', n.get('memo'), undefined);
  eq('deleted def listed as orphan', n.orphanNames(), ['memo']);
  eq('orphan readable raw', n.orphanGet('memo'), 'ABCDEFGH');
  check('raw kept until next write', n.dirty === false);

  // 定義を戻すと元の値が読める
  n = new SaveGroup('test', defs(), { storage: store });
  eq('original value survived', n.get('deaths'), 99);
  eq('original keys survived', n.get('zukan'), ['a', 'b']);

  // orphan を消す
  n = new SaveGroup('test', narrowed, { storage: store });
  check('orphanRemove on live def is ERROR', n.orphanRemove('deaths') === R.ERROR);
  check('orphanRemove works', n.orphanRemove('memo') === R.UPDATED);
  eq('orphan gone', n.orphanNames().length, 0);
  n.flush();
  n = new SaveGroup('test', defs(), { storage: store });
  eq('purged value is back to init', n.get('memo'), 'X');

  // reset
  check('reset one', n.reset('deaths') === R.UPDATED);
  eq('reset back to init', n.get('deaths'), 0);
  eq('untouched value stays', n.get('rank'), 'A');
  n.resetAll();
  eq('resetAll clears everything', n.get('rank'), 'C');
  eq('storage cleared', store.load('test'), null);

  // 版が違うと捨てる
  const s2 = new MemoryStore();
  const v1 = new SaveGroup('ver', { a: { type: T.COUNT } }, { storage: s2, version: 1 });
  v1.set('a', 5);
  v1.flush();
  const v2 = new SaveGroup('ver', { a: { type: T.COUNT } }, { storage: s2, version: 2 });
  eq('version mismatch starts fresh', v2.get('a'), 0);

  // 読みにくくする
  const s3 = new MemoryStore();
  const sec = new SaveGroup('sec', {
    plain: { type: T.COUNT },
    hidden: { type: T.COUNT, secret: true },
    word: { type: T.STR, max: 20, secret: true },
  }, { storage: s3 });
  sec.set('plain', 1234);
  sec.set('hidden', 1234);
  sec.set('word', 'ボス撃破');
  sec.flush();
  const stored = s3.load('sec').d;
  eq('plain value is stored as is', stored.plain, 1234);
  check('secret value is not readable', typeof stored.hidden === 'string' && stored.hidden.indexOf('1234') < 0);
  check('secret text is not readable', String(stored.word).indexOf('ボス') < 0);
  const sec2 = new SaveGroup('sec', {
    plain: { type: T.COUNT },
    hidden: { type: T.COUNT, secret: true },
    word: { type: T.STR, max: 20, secret: true },
  }, { storage: s3 });
  eq('secret number round trips', sec2.get('hidden'), 1234);
  eq('secret text round trips', sec2.get('word'), 'ボス撃破');
  s3.save('sec', { v: 1, d: { hidden: ENC + 'garbage!!' } });
  const sec3 = new SaveGroup('sec', { hidden: { type: T.COUNT, secret: true } }, { storage: s3 });
  eq('broken secret falls back to init', sec3.get('hidden'), 0);

  // 壊れた保存データ
  const s4 = new MemoryStore();
  s4.save('bad', { v: 1, d: { shots: 'xxx', zukan: 'not an array', rank: 'Q' } });
  const bad = new SaveGroup('bad', defs(), { storage: s4 });
  eq('broken COUNT falls back', bad.get('shots'), 0);
  eq('broken KEYS falls back', bad.get('zukan'), []);
  eq('broken ENUM falls back', bad.get('rank'), 'C');

  log(pass + ' passed, ' + fail + ' failed');
  return { pass, fail };
}
