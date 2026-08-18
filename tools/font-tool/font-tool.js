// MMSXXフォントデータ作成ツール(フォントデータ書き出し)の最小版。
//
// ★ いったん開発中断。再開するときに仕様が変わる(外部フォントを使うことにした
//    ので、これから扱うのは絵文字・特殊文字だけ)。さわる前に
//    docs/FONT_TOOL.md を読むこと。
//
//   PC/Web のフォント → 12x12 のビットマップフォント(JSON + インデックスPNG)
// 指示書のうち、いまここで作ってあるのは
//   1.フォント読み込み / 2.文字範囲選択 / 3.ラスタライズ / 4.アトラス生成+JSON出力
// まで。簡易装飾(疑似ボールド)・パレットプレビュー・文字列プレビュー・インポートは
// まだ入っていない。
//
// グリフの座標は JSON に持たせない。アトラス内の並び順(codes の添字)から
//   x = (index % atlasCols) * glyphW,  y = floor(index / atlasCols) * glyphH
// で求まる。
//
// 幅について: アトラスの枠は全部おなじ大きさ(glyphW × glyphH)のままだが、
// 半角の字だけは枠の左半分 floor(glyphW / 2) に描く。実際に何ドット送るかは
// JSON の widths(codes と同じ並び)に入れてある。

'use strict';

// ---- 文字範囲のプリセット ----------------------------------------------
// [先頭, 末尾] のコードポイント(16進の値)で持つ。末尾も含む。
const PRESETS = [
  { id: 'ascii', label: '半角英数記号', on: true, ranges: [[0x20, 0x7E]] },
  { id: 'hankana', label: '半角カタカナ', on: false, ranges: [[0xFF61, 0xFF9F]] },
  { id: 'hira', label: '全角ひらがな', on: true, ranges: [[0x3041, 0x309F]] },
  { id: 'kata', label: '全角カタカナ', on: true, ranges: [[0x30A0, 0x30FF]] },
  { id: 'punct', label: '全角記号・約物', on: false, ranges: [[0x3000, 0x303F]] },
  { id: 'zenei', label: '全角英数記号', on: false, ranges: [[0xFF01, 0xFF5E]] },
  { id: 'kanji', label: '漢字すべて(重い)', on: false, ranges: [[0x4E00, 0x9FFF]] },
];

// 実在しないフォント名。ここに落ちた絵と同じなら「そのフォントに字が無い」とみなす
const FALLBACK_FAMILY = '__msx_font_tool_no_such_font__';

const $ = (id) => document.getElementById(id);

// 半角(横半分の幅)であつかうコードポイントの範囲
const HALF_RANGES = [[0x20, 0x7E], [0xFF61, 0xFF9F], [0xFFE8, 0xFFEE]];

// 変換した結果をここに貯める。書き出しはこれを見る
let built = null;   // { codes, bitmaps, widths, w, h, cols, verticalPad }

/** その字を半角(横半分)であつかうか */
function isHalf(code) {
  return HALF_RANGES.some(([a, b]) => code >= a && code <= b);
}

// ---- 起動時の組み立て ---------------------------------------------------
function initPresets() {
  const box = $('presets');
  for (const p of PRESETS) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.preset = p.id;
    cb.checked = p.on;
    label.append(cb, document.createTextNode(p.label));
    box.append(label);
  }
}

/** 昔ながらのコピー(見えない入力欄に入れて選んで execCommand) */
function copyOldWay(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

/** 押すと text をクリップボードに入れるボタンを作る(code はうまくいかない時に選ぶ先) */
function copyButton(text, code) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy';
  btn.textContent = 'コピー';
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'コピーした';
    } catch (e) {
      // 新しいほうのクリップボードを断られたら、古いやりかたを試す。
      // それも駄目なら文字を選んだままにして、Ctrl+C を押してもらう
      const ok = copyOldWay(text);
      btn.textContent = ok ? 'コピーした' : '選んだ(Ctrl+C)';
      if (!ok && code) getSelection().selectAllChildren(code);
    }
    setTimeout(() => { btn.textContent = 'コピー'; }, 1500);
  });
  return btn;
}

// 自分で足したフォントの置き場所は、このブラウザに覚えておく
const PATHS_KEY = 'mmsxx-font-tool-paths';

function savedPaths() {
  try {
    const v = JSON.parse(localStorage.getItem(PATHS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
  } catch (e) {
    return [];   // 中身が壊れていたら無かったことにする
  }
}

function storePaths(list) {
  try {
    localStorage.setItem(PATHS_KEY, JSON.stringify(list));
  } catch (e) {
    setFontMsg('場所を覚えられなかった: ' + (e && e.message || e), true);
  }
}

/** フォントの置き場所に「コピー」ボタンを付けて、覚えてある場所も並べる */
function initPaths() {
  for (const li of document.querySelectorAll('#paths li')) {
    const code = document.createElement('code');
    code.textContent = li.dataset.path;
    li.append(' ', code, ' ', copyButton(li.dataset.path, code));
  }
  drawSavedPaths();
}

function drawSavedPaths() {
  const ul = $('paths');
  for (const li of ul.querySelectorAll('li.mine')) li.remove();
  for (const path of savedPaths()) {
    const li = document.createElement('li');
    li.className = 'mine';
    const code = document.createElement('code');
    code.textContent = path;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'copy';
    del.textContent = '消す';
    del.addEventListener('click', () => {
      storePaths(savedPaths().filter((p) => p !== path));
      drawSavedPaths();
    });
    li.append(document.createTextNode('自分で足した '), code, ' ', copyButton(path, code), ' ', del);
    ul.append(li);
  }
}

function addPath() {
  const input = $('path-add');
  const path = input.value.trim();
  if (!path) return;
  const list = savedPaths();
  if (!list.includes(path)) storePaths([...list, path]);
  input.value = '';
  drawSavedPaths();
}

/** いま選ばれているフォント名(canvas の font に入れる family) */
function currentFamily() {
  return $('font-name').value.trim() || $('font-list').value || '';
}

function updateFontNow() {
  const f = currentFamily();
  $('font-now').textContent = 'いま使うフォント: ' + (f || '(未選択)');
}

// ---- フォント読み込み ---------------------------------------------------
async function loadLocalFonts() {
  // この API はいろいろな理由で使えない。だめだった理由をそのまま出す
  if (!('queryLocalFonts' in window)) {
    const inFrame = window.self !== window.top;
    setFontMsg('このブラウザでは PC のフォント一覧を取れない(Local Font Access API が無い)。'
      + (inFrame ? '枠(iframe)の中で開いているのが原因かもしれない。' : '')
      + ' Chrome か Edge のふつうのウィンドウでこのアドレスを開き直すか、'
      + '下の「ファイルから読む」「名前を直接指定」を使ってください。', true, true);
    return;
  }
  let fonts;
  try {
    fonts = await window.queryLocalFonts();
  } catch (e) {
    const name = e && e.name || '';
    if (name === 'SecurityError' || name === 'NotAllowedError') {
      setFontMsg('フォント一覧を取れなかった。' + await whyNoDialog(), true, true);
    } else {
      setFontMsg('フォント一覧を取れなかった: ' + (e && e.message || String(e)), true);
    }
    return;
  }

  const families = [...new Set(fonts.map((f) => f.family))].sort();
  if (!families.length) {
    setFontMsg('フォントが 1 件も返ってこなかった。' + await whyNoDialog(), true, true);
    return;
  }
  const jpOnly = $('jp-only').checked;
  let list = jpOnly ? families.filter(hasJapanese) : families;
  let note = '';
  if (jpOnly && !list.length) {
    list = families;
    note = ' (日本語入りが見つからなかったので全部出した)';
  }

  const sel = $('font-list');
  sel.innerHTML = '';
  for (const f of list) {
    const op = document.createElement('option');
    op.value = f;
    op.textContent = f;
    sel.append(op);
  }
  sel.size = Math.min(10, Math.max(2, list.length));
  setFontMsg(`フォント ${list.length} 件${jpOnly && !note ? '(日本語入りのみ)' : ''}${note}。一覧から選ぶと下の「いま使うフォント」が変わります。`);
  updateFontNow();
}

/**
 * 許可のダイアログが出ない/フォントが返ってこないときの理由を書く。
 * この API はページごとの許可がいるが、アプリの中のブラウザや埋め込みの枠だと
 * その許可を聞くダイアログを出せず、黙って空が返ってくることがある。
 */
async function whyNoDialog() {
  let state = null;
  try {
    state = (await navigator.permissions.query({ name: 'local-fonts' })).state;
  } catch (e) {
    state = null;   // この名前を知らないブラウザもある
  }
  if (state === 'denied') {
    return 'このページの「フォント」の許可がブロックになっている。'
      + 'アドレスバー左のアイコン → サイトの設定 → フォント を「許可」にしてから、もう一度押してください。';
  }
  if (state === 'granted') {
    return '許可は下りているのに空だった。ダイアログで一部のフォントだけを選んだのかもしれない。'
      + 'サイトの設定でいちど許可をリセットして、押しなおしてみてください。';
  }
  // prompt のまま = ダイアログが出せていない
  const inFrame = window.self !== window.top;
  return 'まだ許可を聞けていない(ダイアログが出ていない)。'
    + (inFrame ? 'この画面は枠(iframe)の中なので、そこでは許可を聞けません。' : '')
    + 'アプリの中のブラウザやプレビュー枠だとダイアログを出せないことがあるので、'
    + 'Chrome か Edge のふつうのウィンドウで、このアドレスを開き直してください。';
}

/** 日本語(かな・漢字)が入っていそうかを、実際に描いて見分ける */
function hasJapanese(family) {
  for (const ch of ['あ', 'ア', '亜']) {
    if (!sameAsFallback(ch, family, 16)) return true;
  }
  return false;
}

async function loadFontFile(file) {
  const family = 'upload-' + file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '');
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  $('font-name').value = family;
  updateFontNow();
  setFontMsg(`${file.name} を ${family} として読み込んだ`);
}

// ---- ラスタライズ -------------------------------------------------------
// 使い回す小さいキャンバス(1文字ぶん)
const cell = document.createElement('canvas');
const cellCtx = cell.getContext('2d', { willReadFrequently: true });

/** ベースラインを枠の下から何ドット上に置くか(下は文字の足が出るぶん) */
function descentDots(h) {
  return Math.max(1, Math.round(h * 0.15));
}

/**
 * 1文字を枠(w×h)に描いて、生の(なめらかなままの)画素を返す。
 * o = { w, h, boxW, size, dx, dy, fit }
 *   boxW: 横に使ってよい幅(半角は枠の左半分になる)。省略すると w
 *   fit : 枠からはみ出すぶんだけ、形を保ったまま小さくする
 */
function drawChar(ch, family, o) {
  const { w, h, size } = o;
  const boxW = o.boxW || w;
  const dx = o.dx || 0, dy = o.dy || 0;
  if (cell.width !== w || cell.height !== h) { cell.width = w; cell.height = h; }
  cellCtx.setTransform(1, 0, 0, 1, 0, 0);
  cellCtx.fillStyle = '#000';
  cellCtx.fillRect(0, 0, w, h);
  cellCtx.fillStyle = '#fff';
  cellCtx.font = `${size}px "${family}"`;
  cellCtx.textAlign = 'center';
  cellCtx.textBaseline = 'alphabetic';

  let scale = 1;
  let ax = boxW / 2 + dx;                  // 横は枠の真ん中
  let ay = h - descentDots(h) + dy;        // 縦はベースライン
  if (o.fit) {
    // 実際に墨の乗る範囲(文字送りではなく絵の大きさ)で合わせる
    const m = cellCtx.measureText(ch);
    const left = m.actualBoundingBoxLeft, right = m.actualBoundingBoxRight;
    const up = m.actualBoundingBoxAscent, down = m.actualBoundingBoxDescent;
    const inkW = left + right, inkH = up + down;
    if (inkW > boxW) scale = Math.min(scale, boxW / inkW);
    if (inkH > h) scale = Math.min(scale, h / inkH);
    // 絵の真ん中を枠の真ん中に置きなおす(文字送りの中央だと片側にはみ出す)
    if (inkW > 0) ax += (left - right) / 2 * scale;
    // 縦は枠に収まるところまで押し戻す
    if (inkH > 0) ay = Math.min(Math.max(ay, up * scale), h - down * scale);
  }
  cellCtx.translate(ax, ay);
  cellCtx.scale(scale, scale);
  cellCtx.fillText(ch, 0, 0);
  cellCtx.setTransform(1, 0, 0, 1, 0, 0);
  return cellCtx.getImageData(0, 0, w, h).data;
}

/** 1文字を枠に描いて、しきい値で 0/1 の配列にする */
function rasterize(ch, family, o, threshold) {
  const src = drawChar(ch, family, o);
  const boxW = o.boxW || o.w;
  const bits = new Uint8Array(o.w * o.h);
  for (let i = 0; i < bits.length; i++) {
    // 半角のときは、決めた幅から先は捨てる(となりの字に重なるため)
    if ((i % o.w) >= boxW) continue;
    // 黒背景・白文字なので、明るさがしきい値を超えたところが点
    const p = i * 4;
    const v = (src[p] + src[p + 1] + src[p + 2]) / 3;
    bits[i] = v >= threshold ? 1 : 0;
  }
  return bits;
}

/**
 * その字がフォントに無く、代替フォントで描かれたものと同じかどうか。
 * ブラウザは無い字を勝手に別のフォントで描いてしまうので、
 * 「実在しないフォント名」で描いたものと見くらべて見分ける。
 * しきい値を通す前の(なめらかなままの)画素で見る。丸めると別の字が
 * たまたま同じ形になってしまうため。
 */
function sameAsFallback(ch, family, size) {
  const o = { w: 32, h: 32, size: Math.max(24, size * 2) };
  const a = drawChar(ch, family, o).slice();
  const b = drawChar(ch, FALLBACK_FAMILY, o);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---- 文字範囲を組み立てる ----------------------------------------------
function collectCodes() {
  const set = new Set();
  for (const p of PRESETS) {
    const cb = document.querySelector(`input[data-preset="${p.id}"]`);
    if (!cb || !cb.checked) continue;
    for (const [a, b] of p.ranges) for (let c = a; c <= b; c++) set.add(c);
  }
  for (const ch of $('extra-chars').value) {
    const c = ch.codePointAt(0);
    if (c >= 0x20) set.add(c);   // 改行やタブは絵にならないので入れない
  }
  for (const tok of $('extra-ranges').value.split(/[\s,]+/)) {
    if (!tok) continue;
    const m = /^(?:U\+)?([0-9a-f]{1,6})(?:-(?:U\+)?([0-9a-f]{1,6}))?$/i.exec(tok);
    if (!m) continue;
    const a = parseInt(m[1], 16);
    const b = m[2] ? parseInt(m[2], 16) : a;
    for (let c = Math.min(a, b); c <= Math.max(a, b); c++) set.add(c);
  }
  return [...set].filter((c) => c >= 0x20).sort((x, y) => x - y);
}

// ---- 変換 ---------------------------------------------------------------
async function build() {
  const family = currentFamily();
  if (!family) { setStatus('フォントを選んでください。', true); return; }

  const w = +$('glyph-w').value, h = +$('glyph-h').value;
  const size = +$('draw-size').value;
  const dx = +$('off-x').value, dy = +$('off-y').value;
  const threshold = +$('threshold').value;
  const cols = +$('atlas-cols').value;
  const verticalPad = document.querySelector('input[name="vpad"]:checked').value;
  const fit = $('fit').checked;
  const halfOn = $('half-width').checked;
  const halfW = Math.floor(w / 2);   // 半角の幅。小数は切り捨て

  const wanted = collectCodes();
  if (!wanted.length) { setStatus('文字範囲がからっぽです。', true); return; }

  $('btn-build').disabled = true;
  $('btn-export').disabled = true;

  const codes = [], bitmaps = [], widths = [], skipped = [];
  for (let i = 0; i < wanted.length; i++) {
    const c = wanted[i];
    const ch = String.fromCodePoint(c);
    const half = halfOn && isHalf(c);
    const o = { w, h, boxW: half ? halfW : w, size, dx, dy, fit };
    // 空白は絵が無くて当たり前なので、そのまま入れる
    if (c === 0x20 || c === 0x3000) {
      codes.push(c);
      bitmaps.push(new Uint8Array(w * h));
      widths.push(o.boxW);
    } else if (sameAsFallback(ch, family, size)) {
      // フォントに無い字。指示書どおり codes には入れない
      skipped.push(c);
    } else {
      codes.push(c);
      bitmaps.push(rasterize(ch, family, o, threshold));
      widths.push(o.boxW);
    }
    if ((i & 255) === 255) {
      setStatus(`変換中… ${i + 1}/${wanted.length}`);
      await new Promise((r) => setTimeout(r));
    }
  }

  if (!codes.length) { $('btn-build').disabled = false; setStatus('1文字も作れなかった。', true); return; }

  built = { codes, bitmaps, widths, w, h, cols, verticalPad };
  drawAtlas();

  const halfCount = widths.filter((v) => v !== w).length;
  setStatus(`${codes.length} 文字`
    + (halfCount ? `(うち半角 ${halfCount} 文字は幅 ${halfW})` : '')
    + `。アトラスは ${cols} × ${Math.ceil(codes.length / cols)} 枠 `
    + `(${cols * w} × ${Math.ceil(codes.length / cols) * h} ドット)`);
  $('skipped').textContent = skipped.length
    ? `フォントに無くて飛ばした字 ${skipped.length} 文字: `
      + skipped.slice(0, 60).map((c) => String.fromCodePoint(c)).join('')
      + (skipped.length > 60 ? '…' : '')
    : '';
  $('btn-build').disabled = false;
  $('btn-export').disabled = false;
}

/**
 * 1行ぶんの高さ。文字は 8 ドット単位に丸まるので、グリフの高さを 8 の倍数まで
 * 切り上げたものが、その字が実際に食う縦の大きさになる(12 なら 16)。
 */
function lineHeight(h) {
  return Math.ceil(h / 8) * 8;
}

/** 余りドットのうち、上に来るぶん(verticalPad の寄せかたで決まる) */
function padTopDots(h, verticalPad) {
  const pad = lineHeight(h) - h;
  if (verticalPad === 'top') return pad;
  if (verticalPad === 'center') return Math.floor(pad / 2);
  return 0;
}

/** 変換した結果をアトラスの並びでキャンバスに描く */
function drawAtlas() {
  if (!built) return;
  const { codes, bitmaps, w, h, cols, verticalPad } = built;
  const rows = Math.ceil(codes.length / cols);
  const zoom = +$('zoom').value;
  const guide = $('guide').checked;
  // 線を出すときは、行間の余りドットもふくめた大きさで並べる
  const cellH = guide ? lineHeight(h) : h;
  const padTop = guide ? padTopDots(h, verticalPad) : 0;

  const cv = $('atlas');
  cv.width = cols * w;
  cv.height = rows * cellH;
  cv.style.width = (cv.width * zoom) + 'px';
  cv.style.height = (cv.height * zoom) + 'px';

  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(cv.width, cv.height);
  const d = img.data;
  d.fill(255);
  for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 0; }
  for (let i = 0; i < bitmaps.length; i++) {
    const ox = (i % cols) * w, oy = Math.floor(i / cols) * cellH + padTop;
    const bits = bitmaps[i];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!bits[y * w + x]) continue;
        const p = ((oy + y) * cv.width + (ox + x)) * 4;
        d[p] = d[p + 1] = d[p + 2] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  drawGuide(cellH, padTop);
}

/**
 * 書き出したときに 1 文字が食う大きさを線で出す。
 * 線は拡大しても太くならないように、拡大後の大きさのキャンバスに 1 ドットで引く。
 */
function drawGuide(cellH, padTop) {
  const cv = $('guide-cv');
  const note = $('guide-note');
  const on = $('guide').checked;
  const atlas = $('atlas');
  cv.style.width = atlas.style.width;
  cv.style.height = atlas.style.height;

  if (!built || !on) {
    cv.width = cv.height = 0;
    note.textContent = '';
    return;
  }

  const { codes, widths, w, h, cols, verticalPad } = built;
  const rows = Math.ceil(codes.length / cols);
  const zoom = +$('zoom').value;
  const dw = cols * w * zoom, dh = rows * cellH * zoom;
  // 大きすぎるキャンバスは作れないので、そのときは線をあきらめる
  if (dw > 32767 || dh > 32767) {
    cv.width = cv.height = 0;
    note.className = 'note warn';
    note.textContent = '文字が多すぎて線が引けない。拡大を下げるか、文字範囲を減らしてください。';
    return;
  }
  cv.width = dw;
  cv.height = dh;

  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, dw, dh);
  ctx.lineWidth = 1;
  for (let i = 0; i < codes.length; i++) {
    const ox = (i % cols) * w * zoom;
    const oy = Math.floor(i / cols) * cellH * zoom;
    const bw = (widths[i] || w) * zoom;
    // 外側: 1 文字が食う大きさ(横は送り幅、縦は行の高さ)
    ctx.strokeStyle = 'rgba(120,200,255,.45)';
    ctx.strokeRect(ox + 0.5, oy + 0.5, bw - 1, cellH * zoom - 1);
    // 内側: グリフそのもの。余りドットの寄せかたのぶんだけ下がる
    ctx.strokeStyle = 'rgba(255,190,90,.75)';
    ctx.strokeRect(ox + 0.5, oy + padTop * zoom + 0.5, bw - 1, h * zoom - 1);
  }

  const pad = lineHeight(h) - h;
  note.className = 'note';
  note.textContent = `橙 = グリフ ${w}×${h}(半角は横半分)、青 = 1文字ぶんの場所 `
    + `${w}×${lineHeight(h)}。余り ${pad} ドットは ${
      { top: '上', bottom: '下', center: '上下均等' }[verticalPad]}。`;
}

// ---- 書き出し -----------------------------------------------------------
async function exportFiles() {
  if (!built) return;
  const { codes, bitmaps, widths, w, h, cols, verticalPad } = built;
  const base = ($('out-name').value.trim() || 'msxfont').replace(/[^\w.-]/g, '');
  const pngName = base + '.png';

  const rows = Math.ceil(codes.length / cols);
  const aw = cols * w, ah = rows * h;
  // アトラス全体を 0/1 の並びにする(空き枠は 0 のまま)
  const bits = new Uint8Array(aw * ah);
  for (let i = 0; i < bitmaps.length; i++) {
    const ox = (i % cols) * w, oy = Math.floor(i / cols) * h;
    const g = bitmaps[i];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) bits[(oy + y) * aw + (ox + x)] = g[y * w + x];
    }
  }

  const png = await encodeIndexedPng(bits, aw, ah);
  download(new Blob([png], { type: 'image/png' }), pngName);

  const json = {
    format: 'mfont1',
    kind: 'font',
    glyphSize: { w, h },
    atlasCols: cols,
    atlas: pngName,
    verticalPad,
    codes,
    widths,
  };
  download(new Blob([JSON.stringify(json)], { type: 'application/json' }), base + '.json');
  setStatus(`${base}.json と ${pngName} を書き出した(${codes.length} 文字)`);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---- インデックスPNG(パレット参照・2色・1ビット)を組み立てる -----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** PNG のチャンク(長さ + 種類 + 中身 + CRC)を作る */
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib 形式にする。CompressionStream が無ければ「圧縮しない」ブロックで包む */
async function zlib(raw) {
  if (typeof CompressionStream === 'function') {
    const cs = new CompressionStream('deflate');
    const buf = await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(buf);
  }
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2, p = 0;
  for (let i = 0; i < blocks; i++) {
    const n = Math.min(65535, raw.length - p);
    out[o++] = (i === blocks - 1) ? 1 : 0;
    out[o++] = n & 0xFF; out[o++] = n >>> 8;
    out[o++] = (~n) & 0xFF; out[o++] = (~n >>> 8) & 0xFF;
    out.set(raw.subarray(p, p + n), o);
    o += n; p += n;
  }
  new DataView(out.buffer).setUint32(o, adler32(raw));
  return out;
}

/** 0/1 の並びを 2色パレットの 1ビットPNG にする */
async function encodeIndexedPng(bits, width, height) {
  const bytesPerRow = Math.ceil(width / 8);
  const raw = new Uint8Array((1 + bytesPerRow) * height);
  for (let y = 0; y < height; y++) {
    const rowTop = y * (1 + bytesPerRow) + 1;   // 先頭 1 バイトはフィルタ種別(0 = なし)
    for (let x = 0; x < width; x++) {
      if (!bits[y * width + x]) continue;
      raw[rowTop + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 1;    // 1 ピクセル 1 ビット
  ihdr[9] = 3;    // パレット参照
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // パレットは 0 番が黒(下地)、1 番が白(文字)
  const plte = new Uint8Array([0, 0, 0, 255, 255, 255]);

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', await zlib(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  return png;
}

// ---- 画面の配線 ---------------------------------------------------------
function setStatus(text, warn) {
  const el = $('status');
  el.textContent = text;
  el.className = warn ? 'note warn' : 'note';
}

/**
 * フォント欄まわりの知らせ(一覧が取れない理由など)はこちらに出す。
 * withUrl を立てると、開き直す用にこのページのアドレスとコピーボタンを添える。
 */
function setFontMsg(text, warn, withUrl) {
  const el = $('font-msg');
  el.textContent = text;
  el.className = warn ? 'note warn' : 'note';
  if (!withUrl) return;
  const code = document.createElement('code');
  code.textContent = location.href;
  el.append(' ', code, ' ', copyButton(location.href, code));
}

initPresets();
initPaths();
$('btn-local').addEventListener('click', loadLocalFonts);
$('btn-path-add').addEventListener('click', addPath);
$('path-add').addEventListener('keydown', (e) => { if (e.key === 'Enter') addPath(); });
$('font-list').addEventListener('change', () => { $('font-name').value = ''; updateFontNow(); });
$('font-name').addEventListener('input', updateFontNow);
$('font-file').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  loadFontFile(f).catch((err) => setFontMsg(`${f.name} を読み込めなかった: ${err.message}`
    + (/\.ttc$/i.test(f.name) ? ' (.ttc は何書体か束ねたファイルで、ブラウザでは開けないことが多い。'
      + '同じ書体の .ttf があればそちらを選ぶか、上の一覧か名前の直接指定を使ってください)' : ''), true));
});
$('threshold').addEventListener('input', () => { $('threshold-v').textContent = $('threshold').value; });
// グリフの高さを変えたら、描画サイズもそこに合わせる(はみ出しにくくするため)
$('glyph-h').addEventListener('change', () => { $('draw-size').value = $('glyph-h').value; });
$('glyph-w').addEventListener('input', updateHalfNote);
$('half-width').addEventListener('change', updateHalfNote);

/** 半角の幅が何ドットになるかを、その場に出す */
function updateHalfNote() {
  $('half-note').textContent = $('half-width').checked
    ? `(いまの設定だと ${Math.floor(+$('glyph-w').value / 2)} ドット。端数は切り捨て)`
    : '(全部おなじ幅にする)';
}
updateHalfNote();
$('zoom').addEventListener('change', drawAtlas);
$('guide').addEventListener('change', drawAtlas);
// 寄せかたは絵を変えないので、変換しなおさずにプレビューだけ描きなおす
for (const r of document.querySelectorAll('input[name="vpad"]')) {
  r.addEventListener('change', () => {
    if (!built) return;
    built.verticalPad = r.value;
    drawAtlas();
  });
}
$('btn-build').addEventListener('click', () => build().catch((e) => setStatus('失敗: ' + e.message, true)));
$('btn-export').addEventListener('click', () => exportFiles().catch((e) => setStatus('失敗: ' + e.message, true)));
updateFontNow();
