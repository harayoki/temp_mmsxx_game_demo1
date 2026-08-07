/**
 * Functions が動いているかを確かめるためだけの口。
 *
 *   curl -s https://msxpoi1.pages.dev/ping
 *     pong          … Functions が動いている
 *     HTML / 404    … Functions が有効になっていない(静的配信のまま)
 *
 * 確認が済んだら消してよい。
 */
export const onRequestGet: PagesFunction = () =>
  new Response("pong", { headers: { "content-type": "text/plain" } });
