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
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.css': 'text/css',
};

/** data URL (PNG か GIF) を capture/ へ書き出して、古いものを消す */
function saveCapture(dataUrl, name) {
  const comma = dataUrl.indexOf(',');
  // PNG のほかに GIF も受ける(プレイ動画の下見用)
  const isGif = dataUrl.startsWith('data:image/gif;base64,');
  if (comma < 0 || !(isGif || dataUrl.startsWith('data:image/png;base64,'))) {
    throw new Error('PNG か GIF の data URL ではありません');
  }
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  // 名前は「日時 + 呼び出し側から渡された短い説明」。並べると時系列になる
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe = String(name || 'shot').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const file = path.join(CAPTURE_DIR, `${stamp}_${safe}.${isGif ? 'gif' : 'png'}`);
  fs.writeFileSync(file, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
  // 新しい順に並べて、あふれたぶんを消す
  const olds = fs.readdirSync(CAPTURE_DIR)
    .filter(f => f.endsWith('.png') || f.endsWith('.gif'))
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
      // 画面 1 枚ぶんなので、これより大きいものは受け取らない
      if (body.length > 4 * 1024 * 1024) { req.destroy(); }
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
