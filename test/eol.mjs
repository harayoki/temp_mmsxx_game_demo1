// **改行コードと文字コードの見張り。**
//   node test/eol.mjs
//
// 直したつもりのない行が差分に出てきたら、たいていこれ。
// ファイルを丸ごと書き直す道具(スクリプトや一部のエディタ)を通すと、
// **中身は同じなのに改行だけ入れ替わって**、全行が変更に見える。
// そのまま rebase すると、ファイル 1 枚が丸ごと競合になって手に負えなくなる。
//
// **正解は「repo に入っているものと同じ」。** LF か CRLF かをここで決めはしない。
// この repo は実際ばらばら(docs は CRLF、test は LF)で、それ自体は困っていない。
// 困るのは *勝手に入れ替わる* ことだけなので、見るのはそこ。
//
// - **NG** … 入っているものと変わった(改行・BOM・文字コード)。直すべきもの
// - **注意** … 元からそうなっている癖。直さなくてよいが、知っておくもの
//   (`.ps1` の BOM は Windows PowerShell が UTF-8 と気づくために要る。
//    `.bat` が CP932 なのも同じ理由)
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const git = (args, enc = 'utf8') =>
  execFileSync('git', args, { encoding: enc, maxBuffer: 1 << 28 });

let bad = 0;
const ng = (name, detail) => {
  console.log('  NG   ' + name + '  ' + detail);
  bad++;
};

// 中身を見ないもの。大きいだけの絵や音を毎回読むのは無駄なので拡張子で落とす
const SKIP = /\.(png|jpe?g|gif|webp|ico|mp3|wav|ogg|mp4|webm|ttf|otf|woff2?|zip|psd|pdf|bin)$/i;

/** 改行の内訳。CRLF と、CR を伴わない LF を数える */
function eolOf(buf) {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      if (i > 0 && buf[i - 1] === 0x0d) crlf++;
      else lf++;
    }
  }
  return { crlf, lf };
}

const styleName = (e) =>
  e.crlf && e.lf ? '混在(CRLF ' + e.crlf + ' / LF ' + e.lf + ')'
    : e.crlf ? 'CRLF' : e.lf ? 'LF' : '改行なし';

const hasBom = (b) => b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;

const dec = new TextDecoder('utf-8', { fatal: true });
const isUtf8 = (b) => { try { dec.decode(b); return true; } catch { return false; } };

/** 中身が読めるものだけ返す。submodule(ディレクトリ)や binary はここで落ちる */
function readText(path) {
  let st;
  try { st = statSync(path); } catch { return null; }   // 消えている
  if (!st.isFile()) return null;                        // submodule など
  const buf = readFileSync(path);
  return buf.includes(0) ? null : buf;                  // 拡張子で落とせなかった binary
}

const files = git(['ls-files', '-z']).split('\0').filter(Boolean).filter((f) => !SKIP.test(f));

// ---- 1. 入っているものと変わっていないか(本命) ----
//
// 全部を git から引くと遅いので、*差分の出ているファイルだけ*見る。
// 改行が入れ替わったファイルは必ず差分に出るので、これで取りこぼさない。
let changed = [];
try {
  changed = git(['diff', '--name-only', 'HEAD', '--diff-filter=M'])
    .split('\n').map((s) => s.trim()).filter(Boolean).filter((f) => !SKIP.test(f));
} catch {
  console.log('  --   HEAD が無いので、入っているものとの比較は飛ばす');
}

let flipped = 0;
for (const f of changed) {
  const now = readText(f);
  if (!now) continue;
  let was;
  try { was = git(['show', 'HEAD:' + f], 'buffer'); } catch { continue; }
  if (was.includes(0)) continue;

  const a = eolOf(was);
  const b = eolOf(now);
  // 改行の *ある* もの同士だけ比べる。空ファイルや 1 行だけのものは判定しない
  if ((a.crlf || a.lf) && (b.crlf || b.lf) && (!!a.crlf !== !!b.crlf || !!a.lf !== !!b.lf)) {
    ng(f, '改行が入れ替わった  入っているもの: ' + styleName(a) + ' → いま: ' + styleName(b));
    flipped++;
  }
  if (hasBom(was) !== hasBom(now)) {
    ng(f, hasBom(now) ? 'BOM が増えた' : 'BOM が消えた');
    flipped++;
  }
  if (isUtf8(was) !== isUtf8(now)) {
    ng(f, isUtf8(now) ? '文字コードが変わった(UTF-8 になった)' : '文字コードが変わった(UTF-8 で読めなくなった)');
    flipped++;
  }
}

console.log((flipped ? '  NG   ' : '  OK   ') + '入っているものと同じ  '
  + (changed.length ? '差分のある ' + changed.length + ' 枚を確認' : '差分のあるファイルなし')
  + (flipped ? '、' + flipped + ' 件が入れ替わり' : ''));

// ---- 2. 元からの癖(直さなくてよいが、知っておく) ----
const odd = { mixed: [], bom: [], enc: [] };
for (const f of files) {
  const buf = readText(f);
  if (!buf) continue;
  const e = eolOf(buf);
  if (e.crlf && e.lf) odd.mixed.push(f + ' ' + styleName(e));
  if (hasBom(buf)) odd.bom.push(f);
  if (!isUtf8(buf)) odd.enc.push(f);
}

const note = (title, list) => {
  if (!list.length) { console.log('  OK   ' + title + '  なし'); return; }
  console.log('  注意 ' + title + '  ' + list.length + ' 枚');
  for (const s of list) console.log('         ' + s);
};

console.log('\n元からの癖(' + files.length + ' 枚を確認)');
note('1 枚の中で改行が混ざっている', odd.mixed);
note('BOM が付いている', odd.bom);
note('UTF-8 で読めない', odd.enc);

console.log(bad ? '\n' + bad + ' 件おかしい' : '\n通りました');
process.exit(bad ? 1 : 0);
