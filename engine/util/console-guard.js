// コンソールにロゴとひとことを出す、おまけの仕掛け。
//
// ブラウザのコンソールを開いた人にだけ見える隠し要素で、
// ゲームの動きには何も関わらない。
// 昔のソフトが起動時にロゴを出したのと同じ気持ちのもの。

import { MMSXXEngine } from '../engine.js';
// 止まる場所は別のファイルにしてある。
// 開発者ツールで止まったときに見えるのは、そちらの「お知らせだけの絵」になる
import { consoleStop } from './console-stop.js';

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
 * @param {boolean} [opts.trap] おまけ。コンソールを開いていると止まる(既定 false)。
 *   止まる場所には、そのファイルに書いたお知らせが見える
 * @param {Function|Function[]} [opts.stop] ゲーム側の「止まる関数」。
 *   **ゲームのぶんが先**に止まり、そのあとエンジンのぶんが止まる。
 *   それぞれ 1 回ずつで、どちらも済んだら もう止めない
 * @param {number} [opts.interval] trap の間隔(ミリ秒。既定 1000)。
 *   **0 を渡すと、止まるのは 1 回だけ**(後から開かれても 1 回は止まる)
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
    console.log('A browser game engine with the look and sound of 80s home computers.');
  } catch (e) { /* console が無い環境でも動かす */ }

  if (!opts.trap) return { stop() {} };

  // ---- おまけ ----
  // 止まる関数の中で止まる。コンソールが開いていなければ素通りする。
  // 止まっていた時間を測ると、開いているかどうかが分かる。
  // コンソールを後から開く人のほうが多いので、**開かれるまで待ち続ける**
  const interval = opts.interval ?? 1000;
  const WAIT = interval > 0 ? interval : 1000;
  // 止まる場所の順番。**ゲームのぶんが先**、エンジンのぶんが最後。
  // それぞれ 1 回止まったら次へ進み、全部済んだら もう仕掛けない
  const queue = [];
  if (Array.isArray(opts.stop)) queue.push(...opts.stop);
  else if (typeof opts.stop === 'function') queue.push(opts.stop);
  queue.push(consoleStop);
  let timer = 0;
  const tick = () => {
    const t0 = Date.now();
    queue[0]();
    // 止まっていた = コンソールが開いている。開いていなければ同じ場所で待ち続ける
    const opened = Date.now() - t0 > 100;
    if (opened) {
      queue.shift();
      if (opts.onOpen) {
        try { opts.onOpen(); } catch (e) { /* 呼び先が転んでもゲームは続ける */ }
      }
    }
    if (queue.length === 0) return;
    timer = setTimeout(tick, WAIT);
  };
  timer = setTimeout(tick, WAIT);
  return { stop() { clearTimeout(timer); } };
}
