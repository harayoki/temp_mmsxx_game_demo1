// **遊んでいる人の言葉**を見分ける部品。
//
//   import { pickLanguage, languageTags } from './engine/util/lang.js';
//
//   const lang = pickLanguage(['ja', 'es', 'pt', 'nl']);   // 無ければ ''
//   const lang = pickLanguage(['ja'], 'en');               // 無ければ 'en'
//
// ブラウザが持っている**希望の言葉の並び**(`navigator.languages`)を上から見て、
// こちらが用意している言葉と最初に合ったものを返す。
//
// ## 合わせかた
//
// `pt-BR` のような細かい指定も、`pt` のような大まかな指定も受ける。
//   用意 ['pt']      + 希望 'pt-BR'  → 'pt'   (頭で合う)
//   用意 ['pt-BR']   + 希望 'pt-BR'  → 'pt-BR'(そのまま合う)
//   用意 ['pt-BR']   + 希望 'pt-PT'  → 合わない(細かく指定したぶん厳しくなる)
//
// **返すのは「用意した側の綴り」**。呼んだ側はそのまま札の名前などに使える。
//
// ## 無い言葉は必ず控えへ
//
// 用意していない言葉は `fallback`(既定は空文字)になる。
// 「知らない言葉が来たら英語」にしたいときは `pickLanguage(list, 'en')` と書く。

/**
 * ブラウザが希望している言葉を、上から順に並べて返す。
 * `navigator` が無いところ(画面のない環境)では空の並び。
 * @returns {string[]} 例 ['ja', 'en-US', 'en']
 */
export function languageTags() {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (!nav) return [];
  const list = (nav.languages && nav.languages.length) ? [...nav.languages] : [];
  // languages が無いブラウザのために language も見る(重なっていれば足さない)
  if (nav.language && !list.includes(nav.language)) list.push(nav.language);
  return list.filter((t) => typeof t === 'string' && t);
}

/**
 * 用意した言葉のうち、その人にいちばん近いものを選ぶ。
 * @param {string[]} supported 用意している言葉(['ja', 'pt-BR'] など)
 * @param {string} [fallback] どれにも合わないときに返すもの
 * @returns {string} supported の中の綴り、または fallback
 */
export function pickLanguage(supported = [], fallback = '') {
  const want = supported.map((s) => String(s).toLowerCase());
  for (const tag of languageTags()) {
    const t = tag.toLowerCase();
    // 細かい指定(pt-BR)が用意されていれば、そちらを先に見る
    const exact = want.indexOf(t);
    if (exact >= 0) return supported[exact];
    const head = want.indexOf(t.split('-')[0]);
    if (head >= 0) return supported[head];
  }
  return fallback;
}
