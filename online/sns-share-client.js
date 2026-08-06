/**
 * SNSシェア投稿クライアント（ゲーム側にそのままコピーして使う）
 *
 * - 本番のみInvisible Turnstileを通す。DEVはトークンなしで投稿できる。
 * - トークンは使い回さず、POSTの直前に毎回 reset → execute で取り直す。
 * - Turnstileトークンは1回限り・5分で失効するため、投稿処理を直列化する。
 *
 * Site Keyは公開値なのでフロントに置いてよい。Secret Keyは絶対に置かない。
 */

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** MMSXX SNS Sharing Production（ランキング用とは別のWidget） */
export const SNS_SHARE_SITE_KEY = "0x4AAAAAAEHvsgPAFpf-uMhp";
export const SNS_SHARE_ACTION = "share_submit";

let scriptPromise = null;

function loadTurnstile() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile script loaded but window.turnstile is missing"));
    };
    script.onerror = () => reject(new Error("failed to load turnstile script"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Invisible Turnstileのトークン供給関数を作る。
 * 戻り値の関数を呼ぶたびに新しいトークンが1つ返る。
 */
export function createTurnstileTokenProvider({
  siteKey = SNS_SHARE_SITE_KEY,
  action = SNS_SHARE_ACTION,
} = {}) {
  let widget = null;
  let pending = null;

  async function ensureWidget() {
    if (widget) return widget;
    const turnstile = await loadTurnstile();
    const container = document.createElement("div");
    container.style.display = "none";
    document.body.appendChild(container);
    const id = turnstile.render(container, {
      sitekey: siteKey,
      action,
      // execute() を呼ぶまでチャレンジを走らせない
      execution: "execute",
      appearance: "execute",
      retry: "never",
      callback: (token) => pending?.resolve(token),
      "error-callback": () => {
        pending?.reject(new ShareError("TURNSTILE_CLIENT_ERROR", "認証に失敗しました。時間をおいて再試行してください。"));
        return true;
      },
      "timeout-callback": () => {
        pending?.reject(new ShareError("TURNSTILE_CLIENT_TIMEOUT", "認証がタイムアウトしました。再試行してください。"));
      },
    });
    widget = { turnstile, id };
    return widget;
  }

  return async function getToken() {
    const { turnstile, id } = await ensureWidget();
    // 直前のトークンを必ず捨ててから新規発行する
    turnstile.reset(id);
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      try {
        turnstile.execute(id, { action });
      } catch (error) {
        reject(error);
      }
    }).finally(() => {
      pending = null;
    });
  };
}

export class ShareError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ShareError";
    this.code = code;
  }
}

const ERROR_MESSAGES = {
  TURNSTILE_REQUIRED: "認証を通せませんでした。ページを再読み込みして再試行してください。",
  TURNSTILE_INVALID: "認証に失敗しました。もう一度お試しください。",
  TURNSTILE_UNAVAILABLE: "認証サービスに接続できません。時間をおいて再試行してください。",
  RATE_LIMITED: "投稿が続いています。しばらく待ってから再試行してください。",
  RATE_LIMIT_UNAVAILABLE: "共有機能が一時的に利用できません。時間をおいて再試行してください。",
  ORIGIN_NOT_ALLOWED: "この環境からは投稿できません。",
  // 画像まわり。カード画像の生成側を疑う。
  PAYLOAD_TOO_LARGE: "画像サイズが大きすぎます。",
  IMAGE_TOO_LARGE: "画像サイズが大きすぎます。",
  UNSUPPORTED_IMAGE_TYPE: "対応していない画像形式です。PNG / JPEG / WebP のみ使えます。",
  UNSUPPORTED_MEDIA_TYPE: "対応していない画像形式です。PNG / JPEG / WebP のみ使えます。",
  INVALID_IMAGE: "画像を読み取れませんでした。",
  // 以下はクライアント実装のバグ。ユーザー操作では直らない。
  INVALID_METADATA: "投稿内容が不正です。",
  INVALID_MULTIPART: "投稿データを組み立てられませんでした。",
  INVALID_CONTENT_LENGTH: "投稿データを組み立てられませんでした。",
};

/**
 * 共有クライアントを作る。
 *
 * @param {object}  options
 * @param {string}  options.endpoint      SNS Workerのオリジン
 * @param {boolean} options.turnstile     本番はtrue、DEVはfalse
 * @param {string}  [options.siteKey]
 */
export function createShareClient({ endpoint, turnstile: turnstileEnabled, siteKey }) {
  const base = endpoint.replace(/\/+$/, "");
  const getToken = turnstileEnabled
    ? createTurnstileTokenProvider(siteKey ? { siteKey } : {})
    : null;

  // トークンの一回利用が衝突しないよう投稿を直列化する
  let queue = Promise.resolve();

  function submit({ image, metadata }) {
    return (queue = queue.then(
      () => post({ image, metadata }),
      () => post({ image, metadata }),
    ));
  }

  async function post({ image, metadata }) {
    const body = new FormData();
    body.set("metadata", JSON.stringify(metadata));
    body.set("image", image, "card.png");

    if (getToken) {
      // POST直前に毎回取得する。事前に取っておいて使い回さない。
      body.set("turnstileToken", await getToken());
    }

    let response;
    try {
      response = await fetch(`${base}/api/v1/public-shares`, { method: "POST", body });
    } catch {
      throw new ShareError("NETWORK_ERROR", "通信に失敗しました。接続を確認してください。");
    }

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const code = result?.error?.code ?? "UNKNOWN_ERROR";
      throw new ShareError(code, ERROR_MESSAGES[code] ?? "共有に失敗しました。");
    }
    // { shareId, shareUrl, gameShareUrl, imageUrl, destinationUrl, postText, expiresAt }
    // SNSに流すのは gameShareUrl（ゲーム側が描画するページ）。
    // そのルートを用意していないうちは shareUrl（Workerのページ）を使う。
    return result.data;
  }

  return { submit };
}
