/**
 * Cloudflare Pages Functions での使い方
 *
 * 1. このファイルをゲームのPagesリポジトリへ、次のパスでコピーする。
 *      functions/share/[shareId].ts
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
 *      https://<ゲームのPagesドメイン>/share/shr_xxxxxxxxx
 *
 * このURLへのアクセス時だけFunctionが動く。共通Workerからカード情報JSONを読み、
 * Pagesにある通常のトップページ（/index.html相当）を取得して、既存のOG/Xメタタグを
 * 共有データ用のタグへ差し替える。本文やゲームのJavaScript・画像などは通常ページの
 * ものをそのまま使うため、カードごとにゲーム本体を複製する必要はない。
 *
 * 通常のトップページ（/）は静的ページのままで、このFunctionは呼び出されない。
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

export const onRequestGet: PagesFunction<Env, "shareId"> = async (context) => {
  const shareId = context.params.shareId;
  if (typeof shareId !== "string" || !/^shr_[A-Za-z0-9_-]+$/.test(shareId)) {
    return new Response("Share not found", { status: 404 });
  }

  // The hostname is only a placeholder: Service Bindings route this request
  // directly to the Worker, without going through the public Internet.
  const metadataResponse = await context.env.SHARE_SERVICE.fetch(
    new Request(`https://share-service.internal/api/v1/cards/${encodeURIComponent(shareId)}`, {
      headers: { accept: "application/json" },
    }),
  );
  if (!metadataResponse.ok) {
    return new Response("Share not found", {
      status: metadataResponse.status === 404 ? 404 : 502,
    });
  }

  const envelope = await metadataResponse.json<CardEnvelope>();
  const requestUrl = new URL(context.request.url);
  requestUrl.search = "";
  requestUrl.hash = "";
  const canonicalUrl = requestUrl.href;
  const imageUrl = new URL(envelope.data.imagePath, context.env.SHARE_PUBLIC_ORIGIN).href;

  const homeUrl = new URL(context.request.url);
  homeUrl.pathname = "/";
  homeUrl.search = "";
  homeUrl.hash = "";
  const gamePage = await context.env.ASSETS.fetch(new Request(homeUrl, context.request));
  if (!gamePage.ok) return gamePage;

  const tags = cardTags(envelope.data, canonicalUrl, imageUrl);
  const transformed = new HTMLRewriter()
    .on('meta[property^="og:"]', new RemoveElement())
    .on('meta[name^="twitter:"]', new RemoveElement())
    .on('link[rel="canonical"]', new RemoveElement())
    .on("head", new AppendToHead(tags))
    .transform(gamePage);

  const response = new Response(transformed.body, transformed);
  response.headers.set("cache-control", "public, max-age=300, stale-while-revalidate=86400");
  return response;
};

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
