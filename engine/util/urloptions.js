// **URL で変えられる設定**を、エンジン側でまとめて面倒みる部品。
//
//   import { urlOptions } from './engine/util/urloptions.js';
//   const URL = urlOptions(location.search, { dev: BUILD.dev, devOnly: ['fps'] });
//   const mmsxx = new MMSXXEngine(canvas, { ...URL.engine, virtualWidth: 256 });
//   URL.apply(mmsxx);   // 色合いや音など、**作ったあとに効かせるもの**
//
// ここが持つのは**どのゲームでも意味が同じもの**だけ(画面の大きさ、色合い、
// スプライトの枚数、コマ数、音)。「どの面から始めるか」のような、
// そのゲームだけの話はゲーム側で読むこと。
//
// ## ゲーム側でできること
//
//   devOnly: ['fps']        … 開発版でだけ効かせる(公開版は URL を無視)
//   drop: ['scale']         … その項目を無かったことにする
//   defaults: { fps: 50 }   … 既定値を差し替える
//
// **おかしな値は黙って既定に戻す。** URL をいじった人が、
// 動かない画面に当たらないようにするため。

/**
 * 表。key があるものはエンジンを作るときの設定へ、
 * after があるものは作ったあとに効かせる
 */
const TABLE = {
  // 画面
  scale: { num: [1, 8], key: 'scale', def: 3, help: '画面の拡大率' },
  fps: { num: [1, 120], key: 'fps', def: 60, help: '1 秒あたりのコマ数' },
  // スプライト
  linesprites: { num: [0, 16], key: 'spriteLimit', def: 0, help: '1 行に出せる数(0 = 無制限)' },
  maxsprites: { num: [0, 256], key: 'spriteMax', def: 0, help: '画面ぜんぶで出せる数(0 = 無制限)' },
  rotate: {
    list: ['step', 'stride', 'random', 'slow', 'off'],
    key: 'spriteRotate', def: false, help: '消える順の回しかた',
    // 'off' は「回さない」
    fix: (v) => (v === 'off' ? false : v),
  },
  // 処理落ち
  slow: { num: [0, 256], key: 'slowAt', def: 0, help: 'この数を超えたら処理落ち(0 = しない)' },
  slowfps: { num: [1, 120], key: 'slowFps', def: 30, help: '処理落ち中のコマ数' },
  // 作ったあとに効かせるもの
  palette: {
    text: true, help: '画面の色合い',
    after: (m, v) => { if (v && m.paletteNames.includes(v)) m.setPalette(v); },
  },
  mute: { flag: true, def: false, help: '音を消して始める', after: (m, v) => { if (v) m.audio.mute(true); } },
  volume: {
    num: [0, 100], def: 100, help: '音の大きさ(0〜100)',
    after: (m, v) => { m.audio.volume = v / 100; },
  },
};

/** 数として読む(範囲の外や数でないものは既定へ) */
function readNum(raw, [lo, hi], def) {
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < lo || n > hi) return def;
  return Math.round(n);
}

/**
 * URL の指定を読む。
 * @param {string|URLSearchParams} search `location.search` など
 * @param {{dev?:boolean, devOnly?:string[], drop?:string[],
 *          defaults?:Object<string,*>}} [opts]
 *   dev = 開発版か(devOnly の項目は、これが false なら読まない)
 * @returns {{engine:Object, apply:(mmsxx:*)=>void, get:(name:string)=>*,
 *           names:string[], help:string[]}}
 */
export function urlOptions(search, opts = {}) {
  const q = (search instanceof URLSearchParams) ? search : new URLSearchParams(search || '');
  const dev = !!opts.dev;
  const devOnly = new Set(opts.devOnly || []);
  const drop = new Set(opts.drop || []);
  const defaults = opts.defaults || {};

  const value = {};
  const engine = {};
  const after = [];
  for (const [name, spec] of Object.entries(TABLE)) {
    if (drop.has(name)) continue;
    // **開発版だけの項目**は、公開版では URL を見ない(既定のまま)
    const raw = (devOnly.has(name) && !dev) ? null : q.get(name);
    const def = Object.prototype.hasOwnProperty.call(defaults, name) ? defaults[name] : spec.def;
    let v;
    if (spec.num) v = readNum(raw, spec.num, def);
    else if (spec.list) v = spec.list.includes(raw) ? raw : def;
    else if (spec.flag) v = (raw === '1' || raw === 'on') ? true : !!def;
    else v = (raw == null || raw === '') ? def : raw;
    if (spec.fix) v = spec.fix(v);
    value[name] = v;
    if (spec.key) engine[spec.key] = v;
    if (spec.after) after.push([spec.after, v]);
  }

  return {
    /** エンジンを作るときに渡す設定 */
    engine,
    /** 作ったあとに効かせるもの(色合い・音) */
    apply(mmsxx) { for (const [fn, v] of after) fn(mmsxx, v); },
    /** 読んだ値をそのまま見る */
    get(name) { return value[name]; },
    /** 読める名前の一覧 */
    get names() { return Object.keys(value); },
    /** 説明の一覧(遊びかたの画面などに出したいとき) */
    get help() {
      return Object.entries(TABLE)
        .filter(([n]) => !drop.has(n))
        .map(([n, s]) => `?${n}= … ${s.help}`);
    },
  };
}
