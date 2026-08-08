// 開発用: ALT+R で録ったフォルダ(game/recorder.js が作るもの)を mp4 にする。
//
//   node tools/rec2mp4.mjs <フォルダ> [--fps 60] [--scale 4] [--pad 1920x1080]
//   npm run movie -- <フォルダ>
//
// やることは 3 つ。
//   1. 色番号を、そのときのパレットで RGB に開く
//   2. **コマごとの時刻**を見て、等間隔の fps に並べ直す
//      (処理落ち・ポーズ・画面が隠れたぶんのずれは、ここで吸収する)
//   3. ffmpeg に流す(音は audio.pcm をそのまま渡す)
//
// 拡大はここでやる。**色を混ぜない拡大**(flags=neighbor)なので、
// 何倍にしてもドットの角が溶けない。
// ffmpeg は別途入れて、PATH に通しておくこと。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith('--'));
if (!dir) {
  console.error('使いかた: node tools/rec2mp4.mjs <フォルダ> [--fps 60] [--scale 4] [--pad 1920x1080]');
  process.exit(1);
}
/** --name value の形で読む(無ければ既定値) */
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return (i >= 0 && argv[i + 1]) ? argv[i + 1] : def;
};
const FPS = Math.max(1, Number(opt('fps', 60)));
const SCALE = Math.max(1, Math.round(Number(opt('scale', 4))));
const PAD = opt('pad', '');
const OUT = opt('out', path.join(dir, 'out.mp4'));

const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const W = meta.width, H = meta.height;
const times = meta.times || [];
if (!times.length) { console.error('コマがありません'); process.exit(1); }
const framePath = path.join(dir, 'frames.idx.gz');
const audioPath = path.join(dir, 'audio.pcm');
const hasAudio = meta.sampleRate > 0 && fs.existsSync(audioPath)
  && fs.statSync(audioPath).size > 0;

// ---- 色番号を読むところ ----
// gzip をほどきながら、W*H バイトずつ切り出していく。
// 頭から順に見ていくだけなので、全部をメモリに載せなくてよい
const SIZE = W * H;
async function* rawFrames() {
  const gz = fs.createReadStream(framePath).pipe(zlib.createGunzip());
  let buf = Buffer.alloc(0);
  for await (const chunk of gz) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= SIZE) {
      yield Buffer.from(buf.subarray(0, SIZE));   // 写しを渡す(あとで見返すため)
      buf = buf.subarray(SIZE);
    }
  }
}

// ---- ffmpeg ----
const filters = [`scale=iw*${SCALE}:ih*${SCALE}:flags=neighbor`];
if (PAD) {
  const [pw, ph] = PAD.split('x').map(Number);
  if (pw > 0 && ph > 0) filters.push(`pad=${pw}:${ph}:(ow-iw)/2:(oh-ih)/2`);
}
const args = [
  '-y',
  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
];
if (hasAudio) {
  args.push('-f', 's16le', '-ar', String(meta.sampleRate), '-ac', String(meta.channels || 1),
    '-i', audioPath);
}
args.push('-vf', filters.join(','), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p');
if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
args.push(OUT);

const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
ff.on('error', (e) => {
  console.error('ffmpeg を起動できません(PATH に通っていますか): ' + e.message);
  process.exit(1);
});

// ---- 並べ直して流す ----
const it = rawFrames();
const readFrame = async () => {
  const r = await it.next();
  return r.done ? null : r.value;
};

// パレットは途中で変わることがある(裏技で色合いを変えられる)
const changes = meta.paletteChanges || [];
let palAt = 0;
let pal = meta.palette;
const usePaletteFor = (frame) => {
  while (palAt < changes.length && changes[palAt].frame <= frame) {
    pal = changes[palAt].palette;
    palAt++;
  }
};

let cur = await readFrame();
if (!cur) { console.error('frames.idx.gz が空です'); process.exit(1); }
let at = 0;
let pending = await readFrame();
usePaletteFor(0);

// 最後のコマの時刻まで作る
const total = Math.max(1, Math.round(times[times.length - 1] * FPS));
for (let i = 0; i < total; i++) {
  const t = i / FPS;
  // その時刻までに描かれたいちばん新しいコマまで進める。
  // 進まないままなら直前のコマがもう一度出る(絵が止まっていた時間)
  while (pending && times[at + 1] !== undefined && times[at + 1] <= t) {
    cur = pending;
    at++;
    pending = await readFrame();
    usePaletteFor(at);
  }
  const rgb = Buffer.allocUnsafe(SIZE * 3);
  for (let p = 0, o = 0; p < SIZE; p++, o += 3) {
    const c = pal[cur[p]] || [0, 0, 0];
    rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  }
  if (!ff.stdin.write(rgb)) await once(ff.stdin, 'drain');
  if ((i % (FPS * 10)) === 0) {
    process.stderr.write(`\r${i} / ${total} コマ`);
  }
}
ff.stdin.end();
process.stderr.write(`\r${total} / ${total} コマ\n`);
await once(ff, 'close');
console.log('できました: ' + OUT);
