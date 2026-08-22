// 配布フォルダの .js を難読化する(terser)。
//
//   node tools/obfuscate.mjs <配布フォルダ>
//
// build-deploy.ps1 に -Obfuscate を付けたときだけ呼ばれる。
// **元のソースには触らない**(配布フォルダの中だけを書き換える)。
//
// terser は「名前を潰す道具」で、変数も関数も a, b, c になり、
// コメントも消える。小さくなるのはその副産物。
// **文字列はそのまま残る**(裏技のコードや画面の文言は読める)。
// そこまで隠すには別の道具が要る。
// 制御フローの平坦化のような重いものは使わない(60fps が落ちるため)。
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { minify } from 'terser';

/**
 * **開発用の口を丸ごと切り落とす。**
 *
 * `mmsxx.expose()` は公開版では `window` に付けないので外から呼べないが、
 * **中身はバンドルに残る**。読まれれば仕組みが分かるし、
 * 手を入れれば呼べてしまう。だから配る前に消す。
 *
 * terser の `global_defs` では消せない ── 難読化は**ファイルごと**に掛けていて、
 * `DEV` は別のファイルから import した値なので、定数として畳めないため。
 * そこで**印で囲んだ区間を、terser に渡す前に落とす**。
 *
 *   // ---- 開発用の口 ここから ----
 *   mmsxx.expose('mmsxxBoss', ...);
 *   // ---- 開発用の口 ここまで ----
 *
 * 何度出てきてもよい。
 */
const DEV_BEGIN = '// ---- 開発用の口 ここから ----';
const DEV_END = '// ---- 開発用の口 ここまで ----';
let cutBlocks = 0;

/** 印で囲まれたところを消す。消した数も返す */
function stripDevHooks(src) {
  let out = '', rest = src, n = 0;
  for (;;) {
    const i = rest.indexOf(DEV_BEGIN);
    if (i < 0) break;
    const j = rest.indexOf(DEV_END, i);
    if (j < 0) throw new Error('開発用の口の「ここまで」が見つかりません');
    out += rest.slice(0, i);
    rest = rest.slice(j + DEV_END.length);
    n++;
  }
  return { code: out + rest, n };
}

/**
 * 難読化しないファイル(配布フォルダからの相対パス)。
 * コンソールのロゴは見せるためのものなので、素通しにする。
 */
const SKIP = [
  'engine/util/console-guard.js',
  // 開発者ツールで止まったときに見えるファイル。
  // お知らせがそのまま読めないと意味がない
  'engine/util/console-stop.js',
  'game/console-stop.js',
];

async function* walk(dir) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) yield* walk(p);
    else if (name.endsWith('.js')) yield p;
  }
}

const root = process.argv[2];
if (!root) {
  console.error('使いかた: node tools/obfuscate.mjs <配布フォルダ>');
  process.exit(1);
}

let before = 0, after = 0, files = 0, skipped = 0;
for await (const p of walk(root)) {
  const rel = relative(root, p).split(sep).join('/');
  let src = await readFile(p, 'utf8');
  before += src.length;
  if (SKIP.includes(rel)) {
    after += src.length;
    skipped++;
    console.log(`  素通し ${rel}`);
    continue;
  }
  // **開発用の口を先に落とす。**terser に渡したあとでは、
  // 名前もコメントも潰れて印が追えない
  const cut = stripDevHooks(src);
  if (cut.n) {
    cutBlocks += cut.n;
    console.log(`  開発用の口を ${cut.n} か所 落とした ${rel}`);
  }
  src = cut.code;
  // ES モジュールとして扱う(export はそのまま残り、中の名前だけ短くなる)
  const out = await minify(src, {
    module: true,
    compress: {
      // console は残す(名乗りとエラーの記録に使っている)
      drop_console: false,
      passes: 2,
    },
    mangle: true,
    format: { comments: false },
  });
  if (out.code == null) throw new Error(rel + ' の難読化に失敗しました');
  await writeFile(p, out.code, 'utf8');
  after += out.code.length;
  files++;
}
const pct = before ? Math.round((1 - after / before) * 100) : 0;
console.log(`  開発用の口を ${cutBlocks} か所 落とした`);
console.log(`  ${files} 個を難読化 / ${skipped} 個は素通し`);
console.log(`  ${before.toLocaleString()} -> ${after.toLocaleString()} バイト (${pct}% 減)`);
