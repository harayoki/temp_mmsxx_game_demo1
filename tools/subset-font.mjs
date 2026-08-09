// **画面の外(DOM)に出す字を、使う字だけに削って軽くする。**
//
//   npm run font
//
// 元は 1.1MB ある。中身は 7173 字ぶんのアウトラインで、
// **8x8 のドットを四角の輪郭として持っている**ぶん 1 字 160 バイトほどと重い。
// 使う字だけ残して woff2 にすると数十 KB に収まる。
//
// ## どこからどこへ
//
//   sozai/misaki_ttf_2021-05-05/misaki_gothic_2nd.ttf … 落としてきたそのまま
//   assets/fonts/misaki.woff2                          … 削ったもの(**これだけ配る**)
//
// assets/ は公開版へまるごとコピーされるので、**元の ttf をそこに置かない**こと。
// 1.1MB がそのまま遊ぶ人へ飛んでいく。
//
// ## 削ったら元は消す
//
// **作り終わったら元の ttf を消す**(--keep で残せる)。リポジトリに 1.1MB を
// 抱えておく意味が無く、消し忘れるとそのうち assets/ へ紛れ込む。
// もう一度要るときは littlelimit.net から落とし直せばよい。
//
// ## 入れる字
//
// **常用漢字ぜんぶ**(2136 字)と、かな・英数・記号。
// 文言ぴったりに削ると、書き換えるたびに作り直すことになり、
// 抜けた字が**豆腐**になって初めて気づく。常用漢字まで入れておけば二度と気にしなくてよい
// (かなだけとの差は 25KB ほどしかない)。
//
// ## ライセンス
//
// k8x12(小机式) は M+ と同じ文面で、**表記も同梱も要らない**。
// 「改変の有無を問わず、商業利用でも自由に使用・複製・再配布できる」

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import subsetFont from 'subset-font';

const require = createRequire(import.meta.url);
const { kanji: JOYO } = require('joyo-kanji');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 元。落としてきたものを sozai/ に置いてある。無ければ assets/ の中を探す */
const SRC = [
  'sozai/misaki_ttf_2021-05-05/misaki_gothic_2nd.ttf',
  'sozai/misaki_ttf_2021-05-05/misaki_gothic.ttf',
  
].map((p) => path.join(root, p)).find((p) => existsSync(p));
const OUT = path.join(root, 'assets/fonts/misaki.woff2');

if (!SRC) {
  console.error('元のフォントが見つかりません。'
    + 'littlelimit.net から落として sozai/ に置いてください');
  process.exit(1);
}

/** a〜b の文字をぜんぶ */
const range = (a, b) => {
  let s = '';
  for (let c = a; c <= b; c++) s += String.fromCodePoint(c);
  return s;
};

const CHARS = [
  range(0x20, 0x7e),        // 英数と記号
  range(0x3041, 0x309f),    // ひらがな
  range(0x30a0, 0x30ff),    // カタカナ
  range(0x3000, 0x303f),    // 全角の記号(、。「」々〆〜 など)
  range(0xff01, 0xff5e),    // 全角の英数と記号
  '￥￡￠',
  '←↑→↓×÷±≠≦≧∞',
  // シェアの窓の ◀▶ もここ。**抜けると豆腐になる**ので、使う記号は全部入れる
  '・○●△▲▽▼□■◇◆☆★♪♭♯※†‡…‥◀▶◁▷▸◂',
  JOYO.join(''),            // 常用漢字 2136 字
].join('');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

const src = await readFile(SRC);
const out = await subsetFont(src, CHARS, { targetFormat: 'woff2' });
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, out);

console.log('元    :', path.relative(root, SRC), kb(src.length));
console.log('削った:', path.relative(root, OUT), kb(out.length));
console.log('字数  :', [...new Set([...CHARS])].length, `(うち常用漢字 ${JOYO.length})`);

// **元は消す。** 残しておく理由が無く、消し忘れると assets/ へ紛れ込む
if (!process.argv.includes('--keep')) {
  await rm(SRC);
  console.log('消した:', path.relative(root, SRC), '(--keep で残せます)');
}
