// 種つきの乱数。**同じ種なら、いつでも同じ順番で同じ数が出る**。
//
// 使いどころは 2 つ。
//   ・**プレイの再現**(操作の記録から同じプレイを作り直す)
//   ・**途中の状態の保存**(その瞬間から続きを遊ぶ)
//
// `Math.random()` は残しておいてよい。**見た目だけのもの**(爆発の粒、画面揺れ、
// 背景の賑やかし)はずれても困らないので、そのままでよい。
// ゲームの結果に効くところだけ、こちらへ移す。
//
//   mmsxx.rng.seed(12345);          // 親の種を決める(記録に残すのはこれだけ)
//   const r = mmsxx.rng('boss');    // 名前つきの流れ
//   r.next();                       // 0〜1
//   r.int(0, 5);                    // 0..5 の整数
//   r.pick(['a', 'b', 'c']);        // ひとつ選ぶ
//   r.chance(0.25);                 // 4 回に 1 回くらい true
//
// ## 流れを分ける意味
//
// 名前ごとに別の流れになるので、**片方が 1 回多く引いても、もう片方はずれない**。
// ステージのコードを直しても、ボスの引く数列は変わらない。
// 作っている最中に「ボス戦だけ同じ条件でくり返す」ができるのが利点。
//
// **どこまで分けるかはゲームが決める。** エンジンは仕組みだけ用意する。
// 名前なし(`mmsxx.rng()`)を 1 本使うだけでもよい。
//
// ## 気をつけること
//
// 流れを分けても、**操作の記録が版をまたいで再生できるようにはならない**。
// 敵の出かたが変わればプレイヤーの位置が変わり、結果は別物になる。
// 記録には版番号を添えて、違う版なら再生を断ること。

/** 名前と親の種から、その流れの種を作る(同じ組み合わせならいつも同じ) */
function deriveSeed(master, name) {
  // FNV-1a。短い名前でもよく散る
  let h = 0x811c9dc5 ^ (master | 0);
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

/** 1 本の流れ。mulberry32(短くて質がよく、状態が 32bit で済む) */
class RngStream {
  /** @param {string} name @param {number} seed */
  constructor(name, seed) {
    this.name = name;
    this._seed = seed >>> 0;
    this._state = this._seed;
  }

  /** 0 以上 1 未満 */
  next() {
    this._state = (this._state + 0x6d2b79f5) >>> 0;
    let t = this._state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** min 以上 max 以下の整数 */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** 配列からひとつ選ぶ(空なら undefined) */
  pick(list) {
    if (!list || !list.length) return undefined;
    return list[Math.floor(this.next() * list.length)];
  }

  /** p の見込みで true(p = 0.25 なら 4 回に 1 回くらい) */
  chance(p) { return this.next() < p; }

  /** 種から作り直す(この流れだけ最初へ戻す) */
  reset() { this._state = this._seed; }

  /** いまの状態を写す(途中の状態を保存するとき) */
  save() { return this._state; }

  /** 写した状態へ戻す */
  restore(state) { this._state = state >>> 0; }
}

/**
 * 種つき乱数の入れもの。`mmsxx.rng` として使う。
 * **関数としても呼べる**(`mmsxx.rng('boss')`)し、名前を省けば既定の流れになる。
 */
export function createRng(master) {
  const streams = new Map();
  let masterSeed = (master == null ? (Date.now() & 0x7fffffff) : master) >>> 0;

  /** 名前つきの流れを返す(同じ名前なら同じもの) */
  const rng = (name = 'main') => {
    let s = streams.get(name);
    if (!s) { s = new RngStream(name, deriveSeed(masterSeed, name)); streams.set(name, s); }
    return s;
  };

  /**
   * 親の種を決める。**記録に残すのはこの数だけ**。
   * 流れの種は名前から作るので、あとから流れを増やしても古い記録が読める。
   * @param {number} [n] 省略すると時計から作る
   * @returns {number} 決まった種
   */
  rng.seed = (n) => {
    masterSeed = (n == null ? (Date.now() & 0x7fffffff) : n) >>> 0;
    // すでに作ってある流れも、新しい種で作り直す
    for (const [name, s] of streams) {
      const fresh = new RngStream(name, deriveSeed(masterSeed, name));
      streams.set(name, fresh);
      s._seed = fresh._seed; s._state = fresh._state;   // 参照を持たれていても効くように
    }
    return masterSeed;
  };

  /** いまの親の種(記録に残す値) */
  Object.defineProperty(rng, 'masterSeed', { get: () => masterSeed });

  /** 作ってある流れの名前 */
  Object.defineProperty(rng, 'names', { get: () => [...streams.keys()] });

  /** 全部(または 1 本)を種から作り直す */
  rng.reset = (name) => {
    if (name != null) { rng(name).reset(); return; }
    for (const s of streams.values()) s.reset();
  };

  /** 全部の状態を写す(途中の状態を保存するとき) */
  rng.saveAll = () => {
    const out = { seed: masterSeed, streams: {} };
    for (const [name, s] of streams) out.streams[name] = s.save();
    return out;
  };

  /** 写した状態へ全部戻す */
  rng.restoreAll = (data) => {
    if (!data) return;
    rng.seed(data.seed);
    for (const [name, state] of Object.entries(data.streams || {})) rng(name).restore(state);
  };

  return rng;
}
