// 開発用の簡易静的サーバ:  node serve.js  →  http://localhost:8080
// (公開時はこのフォルダをそのまま静的ホスティングに置くだけでよい)
//
// 静的配信のほかに、開発中だけ使う受け口を 1 つ持っている:
//   POST /__capture   画面のキャプチャを capture/ へ保存する(新しい 10 枚だけ残す)
// SNS シェア用の絵を試すための仮のしくみなので、要らなくなったら消してよい。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
// キャプチャの保存先と、残しておく枚数
const CAPTURE_DIR = path.join(ROOT, 'capture');
const CAPTURE_KEEP = 10;

// ---- 手元用のビルド番号 ----
// 見るのは game / engine の中の .js。いちばん新しい更新時刻が前と違えば 1 つ増やす。
// 番号は dev-build-number.txt に置く(公開版の build-number.txt とは別)
const DEV_NUM_FILE = path.join(ROOT, 'dev-build-number.txt');
const DEV_WATCH = ['game', 'engine'];

/** 下まで潜って、いちばん新しい .js の更新時刻を返す */
function newestJs(dir) {
  let newest = 0;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestJs(full));
    else if (e.name.endsWith('.js')) {
      try { newest = Math.max(newest, fs.statSync(full).mtimeMs); } catch { /* 消えた */ }
    }
  }
  return newest;
}

let devCache = null;
function devBuild() {
  // 連打されても数え直さない(1 秒だけ使い回す)
  if (devCache && Date.now() - devCache.checked < 1000) return devCache.value;
  let newest = 0;
  for (const d of DEV_WATCH) newest = Math.max(newest, newestJs(path.join(ROOT, d)));

  let n = 0, was = 0;
  try {
    const [a, b] = fs.readFileSync(DEV_NUM_FILE, 'utf8').trim().split(/\s+/);
    n = Number(a) || 0;
    was = Number(b) || 0;
  } catch { /* はじめて */ }
  if (newest !== was) {
    n += 1;
    try { fs.writeFileSync(DEV_NUM_FILE, n + ' ' + newest + '\n'); } catch { /* 読み取り専用でも困らない */ }
  }
  const value = { n, at: new Date(newest).toTimeString().slice(0, 8) };
  devCache = { checked: Date.now(), value };
  return value;
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  // ホーム画面に置くときの札。**種別が違うと読んでもらえない**
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.css': 'text/css',
};

/** data URL (PNG か GIF) を capture/ へ書き出して、古いものを消す */
function saveCapture(dataUrl, name) {
  // 本体の切れ目は **`;base64,`** で探す。最初のコンマではない。
  // codecs 付き(video/mp4;codecs=avc1.42E01E,mp4a.40.2)は頭にコンマを含むので、
  // 最初のコンマで切ると頭が欠けて、どのプレイヤーでも開けないものができる
  const head = dataUrl.indexOf(';base64,');
  const comma = (head < 0) ? -1 : head + ';base64,'.length - 1;
  // PNG のほかに GIF と動画(webm / mp4)も受ける(プレイ動画の下見用)
  const kinds = [['data:image/png;base64,', 'png'], ['data:image/gif;base64,', 'gif'],
    ['data:video/webm;base64,', 'webm'], ['data:video/mp4;base64,', 'mp4']];
  const hit = kinds.find(([head]) => dataUrl.startsWith(head))
    // codecs 付き(video/webm;codecs=vp9,opus / video/mp4;codecs=avc1...)も受ける
    || (dataUrl.startsWith('data:video/webm;') ? [null, 'webm'] : null)
    || (dataUrl.startsWith('data:video/mp4;') ? [null, 'mp4'] : null);
  if (comma < 0 || !hit) {
    throw new Error('PNG / GIF / 動画 の data URL ではありません');
  }
  const ext = hit[1];
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  // 名前は「日時 + 呼び出し側から渡された短い説明」。並べると時系列になる
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe = String(name || 'shot').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const file = path.join(CAPTURE_DIR, `${stamp}_${safe}.${ext}`);
  fs.writeFileSync(file, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
  // 新しい順に並べて、あふれたぶんを消す
  const olds = fs.readdirSync(CAPTURE_DIR)
    .filter(f => /\.(png|gif|webm|mp4)$/.test(f))
    .sort()
    .reverse()
    .slice(CAPTURE_KEEP);
  for (const f of olds) fs.rmSync(path.join(CAPTURE_DIR, f), { force: true });
  return path.basename(file);
}

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);

  // ---- 開発用: 画面キャプチャの受け口 ----
  if (req.method === 'POST' && p === '/__capture') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      // 数十秒の動画も来るので、そこそこの大きさまで受ける
      if (body.length > 64 * 1024 * 1024) { req.destroy(); }
    });
    req.on('end', () => {
      try {
        const { image, name } = JSON.parse(body);
        const saved = saveCapture(image, name);
        console.log('capture:', saved);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, file: saved }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    });
    return;
  }

  // **手元用のビルド番号。** 公開版は build-deploy.ps1 が build-number.txt で
  // 数えるが、手元は固めないので番号が付かず、
  // **ブラウザが古いままなのか直っていないのか**が見分けられなかった。
  // ソース(game / engine)のいちばん新しい更新時刻を見て、
  // 前に配ったときと違えば 1 つ増やす = 直すたびに増える
  if (p === '/__devbuild') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(devBuild()));
    return;
  }

  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('404: ' + p); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      // 開発中は常に最新を読ませる(古い gamedata.js を掴まないように)
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
