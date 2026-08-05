// Cloudflare Turnstile で「送信しようとしているのが人か」を確かめ、
// その証明(トークン)を 1 枚もらってくる部品。
//
// **記録を送るときにしか使わない。** ゲームを始めるときも、一覧を取るときも通らない。
// 遊んでいる最中に通信を待たせないため、そして人手をかけずに済むのが登録の瞬間だけだから。
//
//   const getToken = createTurnstileTokenProvider({
//     siteKey: '0x...', action: 'ranking_submit',
//   });
//   const token = await getToken();   // 送る直前に 1 枚
//
// ## 見えない確認
//
// `appearance: 'interaction-only'` にしてあるので、**ふだんは何も出ない**。
// 怪しいと judged されたときだけ確認の枠が出る。だから画面の作りは変えなくてよい。
//
// `execution: 'execute'` は「置いた時点では動かず、こちらが頼んだときに動く」設定。
// 枠を先に作っておいて、送る瞬間に `execute()` する。
//
// ## トークンは 1 枚ずつ・使い捨て
//
// 同じトークンを 2 回使うとサーバに断られる。短い寿命もある。
// なので**送るたびに取り直す**。取得中にもう 1 つ頼まれても受けない
// (Turnstile 側が 1 つの枠で同時に 2 つ返せないため)。
//
// ## 秘密ではない
//
// `siteKey` は画面に出しても構わない公開情報。**秘密なのはサーバ側の secret key** で、
// そちらはゲームには一切入らない(サーバが自分で持っている)。

/** 説明つきの読み込み口。`render=explicit` で「置いただけでは動かない」ようにする */
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** action に使える形(サーバ側の決まりと合わせてある) */
const ACTION_RE = /^[a-zA-Z0-9_-]{1,32}$/;

/** Turnstile まわりの失敗。呼ぶ側が区別できるよう code を付ける */
export class TurnstileError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {*} [cause]
   */
  constructor(message, code, cause) {
    super(message);
    this.name = 'TurnstileError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * トークンを 1 枚取ってくる関数を作る。
 * 枠(ウィジェット)は初回に 1 つだけ作って、あとは使い回す。
 *
 * @param {{
 *   siteKey: string,       公開してよい鍵
 *   action: string,        何のための確認か(サーバ側と一致させる)
 *   timeoutMs?: number,    これだけ待って返らなければあきらめる(既定 20 秒)
 *   doc?: Document,        差し替え用
 *   root?: object,         差し替え用(window)
 * }} opts
 * @returns {() => Promise<string>}
 */
export function createTurnstileTokenProvider(opts) {
  const siteKey = opts && opts.siteKey;
  const action = opts && opts.action;
  if (typeof siteKey !== 'string' || !siteKey) throw new TypeError('Turnstile の siteKey が要る');
  if (typeof action !== 'string' || !ACTION_RE.test(action)) throw new TypeError('Turnstile の action が不正');
  // 確認の枠が出たときは人が操作する。5 秒では足りないので、ここだけ長めに待つ
  const timeoutMs = opts.timeoutMs ?? 20000;
  const doc = opts.doc || globalThis.document;
  const root = opts.root || globalThis;

  let apiPromise = null;     // 読み込み中/済みの api.js
  let widgetPromise = null;  // 作り中/済みの枠
  let pending = null;        // いま返事を待っているぶん

  /** api.js を読む(2 度目からは読み直さない) */
  function loadApi() {
    if (root.turnstile) return Promise.resolve(root.turnstile);
    if (apiPromise) return apiPromise;
    if (!doc || !doc.head) {
      return Promise.reject(new TurnstileError('送信確認を読み込めない', 'TURNSTILE_CLIENT_ERROR'));
    }
    apiPromise = new Promise((resolve, reject) => {
      // 別の誰かが先に置いていれば、それに乗る
      const existing = doc.querySelector && doc.querySelector('script[data-mmsxx-turnstile]');
      const script = existing || doc.createElement('script');
      const timer = setTimeout(() => {
        reject(new TurnstileError('送信確認の読み込みが遅すぎる', 'TURNSTILE_TIMEOUT'));
      }, timeoutMs);
      script.addEventListener('load', () => {
        clearTimeout(timer);
        if (root.turnstile) resolve(root.turnstile);
        else reject(new TurnstileError('送信確認を用意できない', 'TURNSTILE_CLIENT_ERROR'));
      }, { once: true });
      script.addEventListener('error', (e) => {
        clearTimeout(timer);
        reject(new TurnstileError('送信確認を読み込めない', 'TURNSTILE_CLIENT_ERROR', e));
      }, { once: true });
      if (!existing) {
        script.src = SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.dataset.mmsxxTurnstile = 'true';
        doc.head.append(script);
      }
    }).catch((e) => {
      // 次に頼まれたときはもう一度読みにいけるようにしておく
      apiPromise = null;
      throw e;
    });
    return apiPromise;
  }

  /** 待っているぶんに結果を返して、待ち行列を空にする */
  function settle(how, value) {
    if (!pending) return;
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    p[how](value);
  }

  /** 枠を 1 つ作る(初回だけ) */
  function ensureWidget() {
    if (widgetPromise) return widgetPromise;
    widgetPromise = (async () => {
      const api = await loadApi();
      if (!doc || !doc.body) throw new TurnstileError('送信確認を置けない', 'TURNSTILE_CLIENT_ERROR');
      const box = doc.createElement('div');
      box.dataset.mmsxxTurnstileWidget = 'true';
      doc.body.append(box);
      const id = api.render(box, {
        sitekey: siteKey,
        action,
        execution: 'execute',            // 頼まれたときだけ動く
        appearance: 'interaction-only',  // ふだんは何も出さない
        callback: (token) => settle('resolve', token),
        'error-callback': (code) => {
          settle('reject', new TurnstileError('送信確認に失敗した', 'TURNSTILE_CLIENT_ERROR', String(code)));
          return true;   // 枠は消さずに残す(次の送信でやり直せるように)
        },
        'expired-callback': () => settle('reject', new TurnstileError('送信確認の期限切れ', 'TURNSTILE_TIMEOUT')),
        'timeout-callback': () => settle('reject', new TurnstileError('送信確認が遅すぎる', 'TURNSTILE_TIMEOUT')),
        'unsupported-callback': () => settle('reject',
          new TurnstileError('このブラウザでは送信確認を使えない', 'TURNSTILE_UNSUPPORTED')),
      });
      return { api, id };
    })().catch((e) => {
      widgetPromise = null;
      throw e;
    });
    return widgetPromise;
  }

  return async function getTurnstileToken() {
    const { api, id } = await ensureWidget();
    // 枠は 1 つしかないので、同時には 1 件しか扱えない
    if (pending) throw new TurnstileError('送信確認を実行中', 'TURNSTILE_CLIENT_ERROR');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        settle('reject', new TurnstileError('送信確認が遅すぎる', 'TURNSTILE_TIMEOUT'));
      }, timeoutMs);
      pending = { resolve, reject, timer };
      try {
        api.reset(id);     // 前のトークンは捨てる(使い回さない)
        api.execute(id);
      } catch (e) {
        settle('reject', new TurnstileError('送信確認を始められない', 'TURNSTILE_CLIENT_ERROR', e));
      }
    });
  };
}
