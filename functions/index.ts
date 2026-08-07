/**
 * Cloudflare Pages Functions での使い方
 *
 * 1. このファイルをゲームのPagesリポジトリへ、次のパスでコピーする。
 *      functions/index.ts
 *
 * 2. Cloudflare DashboardのPagesプロジェクトで、以下を設定して再デプロイする。
 *    - Settings > Bindings > Service binding
 *        Variable name: SHARE_SERVICE
 *        Service:       mmsxx-sns-sharing-server
 *    - Settings > Variables and Secrets
 *        Variable name: SHARE_PUBLIC_ORIGIN
 *        Value: https://mmsxx-sns-sharing-server.harayoki.workers.dev
 *
 * 3. Xなどへ投稿するURLの例：
 *      https://<ゲームのPagesドメイン>/?share=shr_xxxxxxxxx
 *
 * カードはトップページのまま配信する。パスが `/` から変わらないので、index.html の
 * `./game/main.js` のような相対パスはそのまま解決される。`/share/xxx` のようなサブパスに
 * 置くと相対パスが `/share/game/main.js` を指してしまい、ゲームが起動しない。
 *
 * `?share=` が付いていないときは、取得したトップページをそのまま返すだけで、
 * 共通Workerは呼ばない。通常のプレイに影響しない。
 *
 * `?share=` が付いているときは、共通Workerからカード情報JSONを読み、index.html の
 * 既存のOG/Xメタタグを共有データ用のタグへ差し替える。本文やゲームのJavaScript・画像は
 * 通常ページのものをそのまま使うため、カードごとにゲーム本体を複製する必要はない。
 */
interface Env {
  /** Service Binding pointing to mmsxx-sns-sharing-server. */
  SHARE_SERVICE: Fetcher;
  /** Automatically supplied by Cloudflare Pages. */
  ASSETS: Fetcher;
  /** Public origin used by X to download the image (no trailing slash). */
  SHARE_PUBLIC_ORIGIN: string;
}

interface CardMetadata {
  shareId: string;
  title: string;
  description: string;
  imagePath: string;
  imageType: string;
  imageWidth: number;
  imageHeight: number;
}

interface CardEnvelope {
  ok: true;
  data: CardMetadata;
}

const SHARE_ID = /^shr_[A-Za-z0-9_-]+$/;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const shareId = url.searchParams.get("share");
  const gamePage = await context.env.ASSETS.fetch(context.request);

  // 共有カードでないアクセスは、そのまま通常のトップページ。
  if (!shareId || !SHARE_ID.test(shareId) || !gamePage.ok) return gamePage;

  // このFunctionはトップページを横取りするので、カードの差し込みに失敗しても
  // ゲームまで巻き添えにしてはいけない。カードが出ないだけで済ませる。
  try {
    return await withCardTags(context, url, shareId, gamePage);
  } catch (error) {
    console.error({ event: "share_card_failed", shareId, error });
    return gamePage;
  }
};

async function withCardTags(
  context: EventContext<Env, string, unknown>,
  url: URL,
  shareId: string,
  gamePage: Response,
): Promise<Response> {
  // バインディング未設定でも例外にせず、素のトップページを返す。
  if (!context.env.SHARE_SERVICE || !context.env.SHARE_PUBLIC_ORIGIN) {
    console.error({ event: "share_card_unconfigured" });
    return gamePage;
  }

  // The hostname is only a placeholder: Service Bindings route this request
  // directly to the Worker, without going through the public Internet.
  const metadataResponse = await context.env.SHARE_SERVICE.fetch(
    new Request(`https://share-service.internal/api/v1/cards/${encodeURIComponent(shareId)}`, {
      headers: { accept: "application/json" },
    }),
  );
  // 失効・削除済みのIDでもゲームは遊べるべきなので、素のトップページへ落とす。
  if (!metadataResponse.ok) return gamePage;

  const envelope = await metadataResponse.json<CardEnvelope>();
  const canonicalUrl = new URL(url.pathname, url);
  canonicalUrl.searchParams.set("share", shareId);
  const imageUrl = new URL(envelope.data.imagePath, context.env.SHARE_PUBLIC_ORIGIN).href;

  const tags = cardTags(envelope.data, canonicalUrl.href, imageUrl);
  const transformed = new HTMLRewriter()
    .on('meta[property^="og:"]', new RemoveElement())
    .on('meta[name^="twitter:"]', new RemoveElement())
    .on('meta[name="description"]', new RemoveElement())
    .on('link[rel="canonical"]', new RemoveElement())
    .on("head", new AppendToHead(tags))
    .transform(gamePage);

  const response = new Response(transformed.body, transformed);
  response.headers.set("cache-control", "public, max-age=300, stale-while-revalidate=86400");
  return response;
}

class RemoveElement implements HTMLRewriterElementContentHandlers {
  element(element: Element): void {
    element.remove();
  }
}

class AppendToHead implements HTMLRewriterElementContentHandlers {
  constructor(private readonly tags: string) {}

  element(element: Element): void {
    element.append(this.tags, { html: true });
  }
}

function cardTags(card: CardMetadata, canonicalUrl: string, imageUrl: string): string {
  const title = escapeAttribute(card.title);
  const description = escapeAttribute(card.description);
  const canonical = escapeAttribute(canonicalUrl);
  const image = escapeAttribute(imageUrl);
  const imageType = escapeAttribute(card.imageType);
  return [
    `<link rel="canonical" href="${canonical}">`,
    `<meta name="description" content="${description}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${image}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:type" content="${imageType}">`,
    `<meta property="og:image:width" content="${card.imageWidth}">`,
    `<meta property="og:image:height" content="${card.imageHeight}">`,
  ].join("\n");
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}
