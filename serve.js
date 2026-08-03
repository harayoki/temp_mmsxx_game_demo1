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
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.css': 'text/css',
};

/** data URL (PNG か GIF) を capture/ へ書き出して、古いものを消す */
function saveCapture(dataUrl, name) {
  const comma = dataUrl.indexOf(',');
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
