// コンソールにロゴとひとことを出す、おまけの仕掛け。
//
// ブラウザのコンソールを開いた人にだけ見える隠し要素で、
// ゲームの動きには何も関わらない。
// 昔のソフトが起動時にロゴを出したのと同じ気持ちのもの。

import { MMSXXEngine } from '../engine.js';

/**
 * エンジンの名乗り。**どのゲームでも必ず出る**。
 * ゲームごとのアートは、この上に足す形で出す(engine の分は消えない)。
 */
const ENGINE_ART = String.raw`
   __  __ __  __ ___  _  _   _
  |  \/  |  \/  / __|\ \/ / \ \/ /
  | |\/| | |\/| \__ \ >  <   >  <
  |_|  |_|_|  |_|___//_/\_\ /_/\_\
`;

/**
 * コンソールにロゴとひとことを出す。
 *
 * エンジンの名乗り(アスキーアートと版)は**必ず出る**。
 * ゲーム側は、その上に出すアートと文言だけを渡す。
 *
 * @param {object} [opts]
 * @param {string} [opts.art] ゲームのアスキーアート(エンジンの名乗りの前に出る)
 * @param {string} [opts.title] アートの下に出す 1 行(ゲーム名など)
 * @param {string[]} [opts.lines] さらに続けて出す行
 * @param {string} [opts.color] 見出しの色(CSS)
 * @param {boolean} [opts.trap] おまけ。コンソールを開いているあいだ
 *   一定の間隔で止まる(既定 false)
 * @param {number} [opts.interval] trap の間隔(ミリ秒。既定 1000)
 * @param {Function} [opts.onOpen] コンソールが開いていそうなときに呼ばれる
 * @returns {{stop: Function}} 止めるための取っ手
 */
export function installConsoleGuard(opts = {}) {
  if (typeof window === 'undefined' || typeof console === 'undefined') {
    return { stop() {} };
  }
  const color = opts.color ?? '#65dbef';
  const artStyle = `color:${color};font-family:monospace;line-height:1.1`;
  try {
    // %c は 1 つの引数で 1 か所ぶんなので、アートと本文で分けて出す
    if (opts.art) console.log('%c' + opts.art, artStyle);
    if (opts.title) console.log('%c' + opts.title, 'font-weight:bold');
    for (const line of opts.lines || []) console.log(line);
    // ここから下はエンジンの名乗り(ゲームからは消せない)
    console.log('%c' + ENGINE_ART, artStyle);
    console.log(`%cMMSXX ENGINE v${MMSXXEngine.version}`,
      'font-weight:bold;color:' + color);
    console.log('レトロ PC 風の見た目と音で遊ぶ、ブラウザ用のゲームエンジンです。');
  } catch (e) { /* console が無い環境でも動かす */ }

  if (!opts.trap) return { stop() {} };

  // ---- おまけ ----
  // debugger はコンソールが開いているときだけ止まる。
  // 止まっていた時間を測ると、開いているかどうかが分かる。
  const interval = opts.interval ?? 1000;
  let timer = 0;
  const tick = () => {
    const t0 = Date.now();
    // eslint-disable-next-line no-debugger
    debugger;
    if (Date.now() - t0 > 100 && opts.onOpen) {
      try { opts.onOpen(); } catch (e) { /* 呼び先が転んでもゲームは続ける */ }
    }
    timer = setTimeout(tick, interval);
  };
  timer = setTimeout(tick, interval);
  return { stop() { clearTimeout(timer); } };
}
