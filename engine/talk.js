// しゃべる機能(TALK)。
//
// 録音データは持たない。**フォルマント合成**でその場で波形を作る。
// 8 ビット機の音声合成 LSI がやっていたのと同じ考え方で、
//   音源(声帯のかわり) -> 共鳴器 3 つ(口の形) -> 出来上がり
// という組み立てになっている。
//
// - 音源は「一定の間隔で立てるインパルス」(有声音)か「ノイズ」(無声音)
// - 共鳴器は 2 極のフィルタ。母音ごとに決まった 3 つの山(フォルマント)を作る
// - 書き出す波形は **わざと粗い**。既定 8000Hz / 6 ビットで、実機らしい声になる
//   (sampleRate と bits は呼ぶときに変えられる)
//
// カタカナ(ひらがなも可)を渡すと、1 モーラずつ音を並べる。

/** 母音のフォルマント [F1, F2, F3] (Hz)。日本語の 5 母音 */
const VOWELS = {
  a: [800, 1200, 2800],
  i: [300, 2300, 3000],
  u: [350, 1200, 2200],
  e: [500, 1900, 2600],
  o: [500, 900, 2600],
  n: [280, 1200, 2500],   // 撥音「ン」。鼻に抜ける音として弱く長く鳴らす
};

/**
 * 子音の作り方。
 *   burst = 短い破裂(カ行・タ行・パ行)
 *   noise = こすれる音(サ行・ハ行)
 *   voiced = 有声のまま口を狭める(ナ行・マ行・ラ行・ヤ行・ワ行)
 *   なし   = 母音だけ(ア行)
 */
const CONSONANTS = {
  k: { kind: 'burst', dur: 0.018, gap: 0.030, tone: 2200 },
  g: { kind: 'burst', dur: 0.016, gap: 0.012, tone: 1400, voiced: true },
  s: { kind: 'noise', dur: 0.075, tone: 5200 },
  z: { kind: 'noise', dur: 0.045, tone: 4200, voiced: true },
  t: { kind: 'burst', dur: 0.014, gap: 0.026, tone: 3000 },
  d: { kind: 'burst', dur: 0.014, gap: 0.010, tone: 1600, voiced: true },
  n: { kind: 'voiced', dur: 0.045, nasal: true },
  h: { kind: 'noise', dur: 0.060, tone: 1800 },
  b: { kind: 'burst', dur: 0.014, gap: 0.010, tone: 900, voiced: true },
  p: { kind: 'burst', dur: 0.014, gap: 0.024, tone: 1200 },
  m: { kind: 'voiced', dur: 0.045, nasal: true },
  y: { kind: 'voiced', dur: 0.035 },
  r: { kind: 'voiced', dur: 0.028 },
  w: { kind: 'voiced', dur: 0.035 },
  f: { kind: 'noise', dur: 0.060, tone: 2600 },
  ts: { kind: 'burst', dur: 0.014, gap: 0.020, tone: 4600 },
  ch: { kind: 'noise', dur: 0.055, tone: 3400 },
  sh: { kind: 'noise', dur: 0.070, tone: 3000 },
  j: { kind: 'noise', dur: 0.045, tone: 2800, voiced: true },
};

/** カタカナ 1 文字 -> [子音, 母音]。'' は子音なし */
const KANA = {
  ア: ['', 'a'], イ: ['', 'i'], ウ: ['', 'u'], エ: ['', 'e'], オ: ['', 'o'],
  カ: ['k', 'a'], キ: ['k', 'i'], ク: ['k', 'u'], ケ: ['k', 'e'], コ: ['k', 'o'],
  ガ: ['g', 'a'], ギ: ['g', 'i'], グ: ['g', 'u'], ゲ: ['g', 'e'], ゴ: ['g', 'o'],
  サ: ['s', 'a'], シ: ['sh', 'i'], ス: ['s', 'u'], セ: ['s', 'e'], ソ: ['s', 'o'],
  ザ: ['z', 'a'], ジ: ['j', 'i'], ズ: ['z', 'u'], ゼ: ['z', 'e'], ゾ: ['z', 'o'],
  タ: ['t', 'a'], チ: ['ch', 'i'], ツ: ['ts', 'u'], テ: ['t', 'e'], ト: ['t', 'o'],
  ダ: ['d', 'a'], ヂ: ['j', 'i'], ヅ: ['z', 'u'], デ: ['d', 'e'], ド: ['d', 'o'],
  ナ: ['n', 'a'], ニ: ['n', 'i'], ヌ: ['n', 'u'], ネ: ['n', 'e'], ノ: ['n', 'o'],
  ハ: ['h', 'a'], ヒ: ['h', 'i'], フ: ['f', 'u'], ヘ: ['h', 'e'], ホ: ['h', 'o'],
  バ: ['b', 'a'], ビ: ['b', 'i'], ブ: ['b', 'u'], ベ: ['b', 'e'], ボ: ['b', 'o'],
  パ: ['p', 'a'], ピ: ['p', 'i'], プ: ['p', 'u'], ペ: ['p', 'e'], ポ: ['p', 'o'],
  マ: ['m', 'a'], ミ: ['m', 'i'], ム: ['m', 'u'], メ: ['m', 'e'], モ: ['m', 'o'],
  ヤ: ['y', 'a'], ユ: ['y', 'u'], ヨ: ['y', 'o'],
  ラ: ['r', 'a'], リ: ['r', 'i'], ル: ['r', 'u'], レ: ['r', 'e'], ロ: ['r', 'o'],
  ワ: ['w', 'a'], ヲ: ['', 'o'], ン: ['', 'n'],
  ヴ: ['b', 'u'],
};
/** 小さい仮名(拗音)。直前のモーラの母音を差し替える */
const SMALL = { ャ: 'a', ュ: 'u', ョ: 'o', ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o' };

/** ひらがなをカタカナへ寄せる */
function toKatakana(text) {
  return text.replace(/[ぁ-ゖ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/**
 * 文字列をモーラの並びへ。
 * 返すのは { c, v, hold, stop, pause } の配列。
 *   c    子音(なければ '')
 *   v    母音('n' は撥音)
 *   hold 母音を伸ばす倍率(「ー」で増える)
 *   stop 直前に詰まる(「ッ」)
 *   pause 休み(空白・読点)
 */
export function parseTalk(text) {
  const s = toKatakana(String(text));
  const out = [];
  let pendingStop = false;
  for (const ch of s) {
    if (ch === 'ー') {                       // 長音: 直前を伸ばす
      if (out.length) out[out.length - 1].hold += 1;
      continue;
    }
    if (ch === 'ッ') { pendingStop = true; continue; }
    if (SMALL[ch]) {                          // 拗音: 直前の母音を差し替える
      if (out.length) out[out.length - 1].v = SMALL[ch];
      continue;
    }
    if (ch === ' ' || ch === '　' || ch === '、' || ch === '，') {
      out.push({ pause: 0.12 }); continue;
    }
    if (ch === '。' || ch === '！' || ch === '!' || ch === '？' || ch === '?') {
      out.push({ pause: 0.24 }); continue;
    }
    const k = KANA[ch];
    if (!k) continue;                         // 読めない字は飛ばす
    out.push({ c: k[0], v: k[1], hold: 0, stop: pendingStop });
    pendingStop = false;
  }
  return out;
}

/** 2 極の共鳴器(フォルマント 1 つぶん)。Klatt のものと同じ形 */
function resonator(freq, bw, rate) {
  const r = Math.exp(-Math.PI * bw / rate);
  const th = 2 * Math.PI * freq / rate;
  const b = 2 * r * Math.cos(th);
  const c = -r * r;
  const a = 1 - b - c;
  let y1 = 0, y2 = 0;
  return (x) => {
    const y = a * x + b * y1 + c * y2;
    y2 = y1; y1 = y;
    return y;
  };
}

/**
 * しゃべる波形を作る。
 * @param {string} text カタカナ(ひらがなも可)
 * @param {{
 *   rate?: number,    書き出すサンプリング周波数(既定 8000。低いほど粗い)
 *   bits?: number,    量子化ビット数(既定 6。低いほどざらつく)
 *   pitch?: number,   声の高さ Hz(既定 120)
 *   speed?: number,   しゃべる速さ(既定 1。大きいほど速い)
 *   fall?: number,    語尾に向かって声が下がる量(半音ぶん。既定 3)
 *   growl?: number,   声の揺れ(既定 0。大きいほどだみ声)
 * }} [opts]
 * @returns {{rate:number, data:Float32Array}}
 */
export function renderTalk(text, opts = {}) {
  const rate = opts.rate ?? 8000;
  const bits = opts.bits ?? 6;
  const pitch = opts.pitch ?? 120;
  const speed = opts.speed ?? 1;
  const fall = opts.fall ?? 3;
  const growl = opts.growl ?? 0;
  const moras = parseTalk(text);

  // 全体の長さを先に見積もる
  let total = 0;
  for (const m of moras) {
    if (m.pause) { total += m.pause; continue; }
    const cons = CONSONANTS[m.c];
    total += (cons ? cons.dur + (cons.gap || 0) : 0) + 0.11 * (1 + m.hold * 0.9);
    if (m.stop) total += 0.06;
  }
  total = total / speed + 0.05;
  const n = Math.max(1, Math.ceil(total * rate));
  const data = new Float32Array(n);

  // 共鳴器は母音が変わるたびに作り直す(前の音を引きずらないように)
  let i = 0;
  let phase = 0;          // 声帯のインパルスまでの残り
  let moraIndex = 0;
  const step = 1 / rate;
  const put = (len, fn) => {
    const end = Math.min(n, i + Math.round(len * rate));
    for (; i < end; i++) data[i] += fn((i - (end - Math.round(len * rate))) * step);
  };

  for (const m of moras) {
    // 語尾に向かって声を下げる(棒読みにならないように)
    const t = moras.length > 1 ? moraIndex / (moras.length - 1) : 0;
    const f0 = pitch * Math.pow(2, -fall * t / 12);
    moraIndex++;

    if (m.pause) { i += Math.round(m.pause / speed * rate); continue; }
    if (m.stop) i += Math.round(0.06 / speed * rate);   // 促音は無音でためる

    const cons = CONSONANTS[m.c];
    // ---- 子音 ----
    if (cons) {
      const dur = cons.dur / speed;
      if (cons.kind === 'noise' || cons.kind === 'burst') {
        const band = resonator(cons.tone, cons.kind === 'burst' ? 1200 : 900, rate);
        const len = Math.round(dur * rate);
        for (let k = 0; k < len && i < n; k++, i++) {
          const env = cons.kind === 'burst' ? Math.exp(-k / (len * 0.4)) : 1;
          data[i] += band(Math.random() * 2 - 1) * env * 0.5;
        }
        if (cons.gap) i += Math.round(cons.gap / speed * rate);
      } else {
        // 有声子音。母音と同じ作りだが、口を狭めて弱く短く鳴らす
        const v = VOWELS[cons.nasal ? 'n' : m.v];
        const rs = [resonator(v[0], 90, rate), resonator(v[1], 110, rate), resonator(v[2], 180, rate)];
        const len = Math.round(cons.dur / speed * rate);
        for (let k = 0; k < len && i < n; k++, i++) {
          let src = 0;
          if (--phase <= 0) { src = 1; phase = Math.round(rate / f0); }
          data[i] += (rs[0](src) * 0.6 + rs[1](src) * 0.3 + rs[2](src) * 0.1) * 0.5;
        }
      }
    }

    // ---- 母音 ----
    const v = VOWELS[m.v] || VOWELS.a;
    const rs = [resonator(v[0], 80, rate), resonator(v[1], 100, rate), resonator(v[2], 160, rate)];
    const len = Math.round(0.11 * (1 + m.hold * 0.9) / speed * rate);
    for (let k = 0; k < len && i < n; k++, i++) {
      // 出だしと終わりをなめらかに(ぶつっと切れないように)
      const e = Math.min(1, k / (rate * 0.012), (len - k) / (rate * 0.02));
      let src = 0;
      if (--phase <= 0) {
        src = 1;
        // だみ声にしたいときは周期を少し暴れさせる
        const g = growl ? 1 + (Math.random() - 0.5) * growl * 0.3 : 1;
        phase = Math.round(rate / (f0 * g));
      }
      const nasal = m.v === 'n' ? 0.5 : 1;
      data[i] += (rs[0](src) * 0.6 + rs[1](src) * 0.3 + rs[2](src) * 0.1) * e * nasal;
    }
  }

  // ---- わざと粗くする ----
  // 音量をそろえてから、決めたビット数に落とす。これで 8 ビット機の声になる
  let peak = 0;
  for (let k = 0; k < n; k++) peak = Math.max(peak, Math.abs(data[k]));
  const gain = peak > 0 ? 0.9 / peak : 1;
  const levels = Math.pow(2, bits) / 2;
  for (let k = 0; k < n; k++) {
    data[k] = Math.round(data[k] * gain * levels) / levels;
  }
  return { rate, data };
}
