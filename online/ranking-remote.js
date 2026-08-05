// ランキングサーバを供給元にしたもの。RankingBoard に渡して使う。
//
//   import { RankingBoard } from './engine/util/ranking-board.js';
//   const { RemoteRankingSource } = await import('./online/ranking-remote.js');
//
// **サーバを使わないゲームはこのファイルを読み込まない**。
// 通信するコードをここだけに閉じ込めてあるので、
// 手元だけで遊ぶゲームは ranking-board.js だけで足りる。
//
// ## なぜ engine/util/ ではなく online/ に置いてあるか
//
// `online/` は**公開しない実装をまとめる場所**。→ [online/README.md](README.md)
// このフォルダごと外した配布物でもゲームが動くよう、
// 読み込みは動的 import にしてある(game/main.js の makeRemoteRankSource())。
//
// ## どのサーバを相手にするか
//
// 「ランキングサーバ仕様書」(Cloudflare Workers + D1) の API を叩く。
//
//   GET  /api/v1/rankings/{gameId}/{rankingKey}?limit=100
//   POST /api/v1/runs
//
// 応答はどちらも `{ ok: true, data: {...} }` / `{ ok: false, error: {...} }` の形。
//
// ## 表とサーバの対応づけ
//
// RankingBoard は自分の `key` で問い合わせてくるので、
// その `key` からサーバ側の宛先を引けるようにしておく。
//
//   new RemoteRankingSource({
//     dev: true,                         // 開発用サーバか本番サーバか
//     browserId: () => getBrowserId(),   // 値でも関数でもよい
//     playId: () => currentPlayId,       // 送るたびに今の値を聞く
//     games: {
//       'mygame-scores': {
//         gameId: 'mygame-normal',       // サーバ側のゲーム
//         rankingKey: 'high-score',      // どの並びを見るか
//         valueKey: 'score',             // 記録が持っている値の名前
//       },
//     },
//   });
//
// `browserId` と `playId` は**ゲームが持つもの**なので、値か、値を返す関数を渡す。
// 関数にしておくと「1 プレイごとに作り直す playId」をそのまま渡せる。
//
// ## サーバの URL はここが知っている
//
// 宛先はこの部品が両方とも持っていて、`dev` で選ぶ。**ゲームには持たせない**。
// 引っ越したときに直す場所を 1 か所にしておくため。
// どうしても別の宛先を見たいとき(手元で `wrangler dev` を動かすなど)だけ
// `baseUrl` を渡すと、そちらが優先される。
//
// ## 持っていない口
//
// `peek()` … サーバには「同期で出せる値」が無い。
//             既定データから始まり、`refresh()` が終わった時点で本物になる。
// `replace()` / `clear()` … 記録の書き換え・削除は管理者の仕事。ゲームからは触らない。
//             (RankingBoard の `editable` が false になり、手元向けの手入れは動かなくなる)

/** 通信まわりの失敗。呼ぶ側(RankingBoard)が握りつぶすので、区別できれば十分 */
export class RankingRequestError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string }} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'RankingRequestError';
    /** @type {number} HTTP のステータス(分からないときは 0) */
    this.status = info.status || 0;
    /** @type {string} サーバが返したエラーコード */
    this.code = info.code || '';
  }
}

/** ランキングサーバの入口。開発用と本番の 2 つだけ */
export const RANKING_SERVERS = {
  dev: 'https://mmsxx-ranking-server-dev.hal3-imai.workers.dev',
  prod: 'https://mmsxx-ranking-server.hal3-imai.workers.dev',
};

export class RemoteRankingSource {
  /**
   * @param {{
   *   dev?: boolean,          開発用サーバを使うか(false なら本番)
   *   baseUrl?: string,       宛先を直に指定したいときだけ(末尾の / は付けても付けなくてよい)
   *   games: Object<string, { gameId: string, rankingKey: string, valueKey: string }>,
   *   browserId?: string|(()=>string),  この端末を見分ける ID
   *   playId?: string|(()=>string),     1 回のプレイを見分ける ID
   *   timeoutMs?: number,     これだけ待って返らなければあきらめる(既定 5 秒)
   *   limit?: number,         一度に取る件数の上限(既定 100)
   * }} opts
   */
  constructor(opts) {
    const url = opts.baseUrl || (opts.dev ? RANKING_SERVERS.dev : RANKING_SERVERS.prod);
    this.baseUrl = String(url).replace(/\/+$/, '');
    this.games = opts.games || {};
    this.browserId = opts.browserId || '';
    this.playId = opts.playId || '';
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.limit = opts.limit ?? 100;
  }

  /**
   * 一覧を取る。
   * @param {string} key RankingBoard の key
   * @param {{ max?: number }} [ctx]
   * @returns {Promise<object[]>} `{ name, <valueKey>, runId }` の配列
   */
  async fetch(key, ctx = {}) {
    const g = this._game(key);
    const limit = Math.min(this.limit, ctx.max || this.limit);
    const url = this.baseUrl +
      '/api/v1/rankings/' + encodeURIComponent(g.gameId) +
      '/' + encodeURIComponent(g.rankingKey) + '?limit=' + limit;
    const data = await this._request(url, { method: 'GET' });
    const list = (data && data.entries) || [];
    // サーバの形をゲームが読む形へ直す。表示に要らないものは持ち込まない
    return list.map(e => ({
      name: e.playerName,
      [g.valueKey]: e.values ? e.values[g.valueKey] : undefined,
      runId: e.runId,
    }));
  }

  /**
   * 記録を登録して、サーバが数えた順位を受け取る。
   * @param {string} key
   * @param {object} entry `{ name, <valueKey> }`
   * @returns {Promise<{ rank?: number, runId?: string }>}
   */
  async submit(key, entry) {
    const g = this._game(key);
    const body = {
      gameId: g.gameId,
      playId: this._id(this.playId),
      playerName: entry.name,
      browserId: this._id(this.browserId),
      values: { [g.valueKey]: entry[g.valueKey] },
    };
    let data;
    try {
      data = await this._request(this.baseUrl + '/api/v1/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // 同じプレイを二重に送ったときは、すでに登録できているので失敗ではない。
      // ただし順位は分からないので、手元の見込みをそのまま使ってもらう
      if (e instanceof RankingRequestError && e.code === 'PLAY_ALREADY_SUBMITTED') return {};
      throw e;
    }
    // サーバの順位は 1 位から数える。RankingBoard は 0 から数えるので 1 引く
    const ranks = (data && data.ranks) || {};
    const rank = ranks[g.rankingKey];
    const out = { runId: data && data.runId };
    if (typeof rank === 'number') out.rank = rank - 1;
    return out;
  }

  // peek() / replace() / clear() は持たない(上の説明のとおり)

  // ---- 内部 ----

  /** その表がサーバのどこに当たるか */
  _game(key) {
    const g = this.games[key];
    if (!g) throw new RankingRequestError('ランキングの宛先が設定されていない: ' + key);
    return g;
  }

  /** 値でも関数でも受け取れるようにしておく */
  _id(v) {
    return typeof v === 'function' ? v() : v;
  }

  /**
   * JSON をやり取りして `data` を返す。
   * 失敗はすべて RankingRequestError にそろえる(呼ぶ側で場合分けしなくてよいように)。
   */
  async _request(url, init) {
    const ctrl = new AbortController();
    // いつまでも待たない。取れなくても遊びは止まらないので、あきらめは早くてよい
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res;
    try {
      res = await globalThis.fetch(url, Object.assign({ signal: ctrl.signal }, init));
    } catch (e) {
      throw new RankingRequestError('つながらなかった: ' + e);
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      throw new RankingRequestError('応答を読めなかった', { status: res.status });
    }
    if (!res.ok || !json || json.ok !== true) {
      const err = (json && json.error) || {};
      throw new RankingRequestError(err.message || ('失敗した (' + res.status + ')'),
        { status: res.status, code: err.code });
    }
    return json.data;
  }
}
