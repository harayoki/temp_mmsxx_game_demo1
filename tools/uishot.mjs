// **機種ごとの GUI の見えかたを、まとめて写真に撮る。**
//
//   node serve.js                     # 別の窓で動かしておく
//   npm run uishot                    # capture/ui/ に並ぶ
//   npm run uishot -- --notch left    # ノッチを左に寄せて撮る
//   npm run uishot -- --device se,max # 機種を絞る
//   npm run uishot -- --menu          # メニュー(タイトル)だけ
//   npm run uishot -- --lang ja,en    # 日本語と英語を両方
//
// 機種の一覧は engine/util/devices.js。**あちらを直せばここも増える**。
//
// ## 入れるものは無い
//
// **手元の Chrome をそのまま使う**(--headless --screenshot)。
// 画面を撮る道具を npm から入れると、中にブラウザが丸ごと付いてきて重い。
// rec2mp4.mjs が ffmpeg を呼んでいるのと同じ考えかた。
//
// ## 何を撮るか
//
// 機種ごとに 2 枚。**出るものが丸ごと入れ替わる**ので、両方見ないと分からない。
//
//   menu … タイトル。十字もショットも出ず、左右に操作の案内が出る
//   game … 遊んでいる最中。左に十字、右にこすり打ちのショット
//
// 窓は画角より少し大きく取ってある。**枠の線が見える**ようにするため。

import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DEVICES } from '../engine/util/devices.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 手元の Chrome。見つからなければ Edge(中身は同じ) */
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/** 画角のまわりに残す余白(px)。枠の線を見せるため */
const MARGIN = 32;
/**
 * 描き終わるまで待つ時間(ms)。**短いと GUI が出そろう前に撮れてしまう**
 * (案内が空、OK が既定の文字のまま、fps が「—」のまま になる)。
 * 素材とフォントを読み終えて、ゲームのループが何コマか回るまで待つ
 */
const WAIT = 10000;

const args = parseArgs(process.argv.slice(2));
const browser = BROWSERS.find((p) => p && existsSync(p));
if (!browser) {
  console.error('Chrome が見つかりません。--browser <パス> で指してください');
  process.exit(1);
}

const outDir = path.join(root, args.out || 'capture/ui');
await mkdir(outDir, { recursive: true });

const keys = args.device
  ? args.device.split(',').filter((k) => DEVICES[k])
  : Object.keys(DEVICES);
if (!keys.length) {
  console.error('知らない機種です。使えるのは:', Object.keys(DEVICES).join(' / '));
  process.exit(1);
}
// **操作の案内だけは日本語と英語を出し分ける**ので、どちらも撮れるようにする。
//   --lang ja      … 日本語だけ
//   --lang ja,en   … 両方(名前のうしろに付く)
//   指定なし        … ブラウザ任せ(いまの環境の言葉)
const langs = args.lang ? String(args.lang).split(',') : [''];
// menu = タイトル、game = 遊んでいる最中。**?stage=1 は開発版でだけ効く**
const scenes = [];
if (!args.game) scenes.push({ id: 'menu', q: '' });
if (!args.menu) scenes.push({ id: 'game', q: '&stage=1' });

console.log('ブラウザ:', browser);
console.log('置き場所:', path.relative(root, outDir));
console.log('');

for (const key of keys) {
  const d = DEVICES[key];
  for (const sc of scenes) {
    const notch = args.notch && d.notch ? `&notch=${args.notch}` : '';
    for (const lang of langs) {
      const q = lang ? `&lang=${lang}` : '';
      const url = `${args.url || 'http://localhost:8080'}/?device=${key}${notch}${q}${sc.q}`;
      const file = path.join(outDir, `${key}-${sc.id}${lang ? '-' + lang : ''}.png`);
      await shoot(url, d.w + MARGIN, d.h + MARGIN, file);
      console.log(`${key.padEnd(7)} ${sc.id.padEnd(5)} ${(lang || 'auto').padEnd(4)} `
        + `${d.w}x${d.h}  ${path.relative(root, file)}`);
    }
  }
}

console.log('');
console.log('撮れました:', path.relative(root, outDir));

/** Chrome を 1 回起こして 1 枚撮る */
async function shoot(url, w, h, file) {
  // **使っている Chrome とは別の場所**を使う。開いたままでも邪魔しない
  const profile = await mkdtemp();
  const argv = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--user-data-dir=' + profile,
    '--window-size=' + Math.round(w) + ',' + Math.round(h),
    '--virtual-time-budget=' + WAIT,
    '--screenshot=' + file,
    url,
  ];
  await new Promise((resolve, reject) => {
    const p = spawn(browser, argv, { stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', () => resolve());
  });
  await rm(profile, { recursive: true, force: true });
}

async function mkdtemp() {
  const dir = path.join(os.tmpdir(), 'mmsxx-uishot-' + Math.random().toString(36).slice(2));
  await mkdir(dir, { recursive: true });
  return dir;
}

/** --name 値 と --name の両方を受ける */
function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith('--')) continue;
    const key = list[i].slice(2);
    const next = list[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}
