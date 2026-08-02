// MML (Music Macro Language) コンパイラ
// 対応コマンド (MSX BASIC の PLAY 文風):
//   cdefgab  音符 (直後に +/# =半音上げ, - =半音下げ, 数字=音長, . =付点)
//   r        休符
//   o<n>     オクターブ 1..8 (o4 の a = 440Hz)
//   > <      オクターブ上げ / 下げ
//   l<n>     デフォルト音長 (4=四分音符)
//   t<n>     テンポ (四分音符/分)
//   v<n>     音量 0..15
//   q<n>     ゲート 1..8 (8=フルレングス, 既定7)
//   &        タイ (直後の音符の長さを直前の音に足す)
//   [ ... ]<n>  繰り返し (n 省略時 2 回, ネスト可)
//
// 音色・効果 (チャンネルごとに途中で切り替えられる):
//   @<n>     波形 0..6  (WAVEFORMS 参照。0=矩形12.5% .. 6=ノイズ)
//   @{名前}  波形を名前で指定 (pulse12 / pulse25 / pulse50 /
//            triangle / saw / sine / noise)。**番号より名前を勧める**。
//            番号はエンジンの都合で動くことがあるが、名前は動かない
//   @e<n>    エンベロープ 0..5 (ENVELOPES 参照)
//   @e{名前} エンベロープを名前で指定 (flat / soft / percussive /
//            piano / pad / pluck)
//   @d<n>    デチューン (セント単位。2 音を少しずらして重ねる。0 で無効)
//   @v<n>    ビブラート 0..9 (0 で無効。数字が大きいほど深い)
//   @s<n>    エコー(ディレイ) 0..9 (0 で無効。数字が大きいほど強い)
//   @o<n>    オクターブ重ね 0..2 (0 で無効)。同じ音の 1 オクターブ下を
//            重ねて厚くする。2 なら 2 オクターブ下も足す

const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * 波形テーブル。
 * ファミコン(2A03)の矩形波デューティ比 12.5/25/50% と、
 * MSX(AY-3-8910)の矩形波(50%固定)、三角波、ノコギリ波、サイン波、ノイズ。
 */
export const WAVEFORMS = [
  { id: 0, name: 'pulse12', kind: 'pulse', duty: 0.125 }, // ファミコン風 12.5%
  { id: 1, name: 'pulse25', kind: 'pulse', duty: 0.25 },  // ファミコン風 25%
  { id: 2, name: 'pulse50', kind: 'pulse', duty: 0.5 },   // ファミコン/MSX 50%
  // 75% は 25% と上下が逆なだけで同じ音に聞こえるので置かない
  { id: 3, name: 'triangle', kind: 'triangle' },          // 三角波
  { id: 4, name: 'saw', kind: 'saw' },                    // ノコギリ波
  { id: 5, name: 'sine', kind: 'sine' },                  // サイン波
  { id: 6, name: 'noise', kind: 'noise' },                // ノイズ
];

/**
 * エンベロープ (attack/decay/sustain/release を音長に対する割合で持つ)。
 * 0=そのまま鳴る / 1=じわっと / 2=打楽器風 / 3=ピアノ風 / 4=パッド / 5=プラック
 */
export const ENVELOPES = [
  { id: 0, name: 'flat',    a: 0.005, d: 0,    s: 1.0,  r: 0.01 },
  { id: 1, name: 'soft',    a: 0.08,  d: 0.1,  s: 0.8,  r: 0.15 },
  { id: 2, name: 'percussive', a: 0.002, d: 0.25, s: 0.0, r: 0.05 },
  { id: 3, name: 'piano',   a: 0.004, d: 0.4,  s: 0.35, r: 0.12 },
  { id: 4, name: 'pad',     a: 0.25,  d: 0.2,  s: 0.7,  r: 0.4 },
  { id: 5, name: 'pluck',   a: 0.002, d: 0.12, s: 0.15, r: 0.08 },
];

/**
 * **波形メモリを足す**(実機の SCC / PC エンジンにあたるもの)。
 *
 * 1 周期ぶんの数字の並びを渡すと、その形の音が鳴るようになる。
 * `@{名前}` で呼べる。同じ名前で呼び直せば上書きする。
 *
 * @param {string} name 名前。**`wt` で始める**(波形メモリだと分かるように)
 * @param {number[]|Float32Array} samples 1 周期ぶん(-1..1)。32 個が実機らしい
 * @param {5|8} [bits=8] 段階の細かさ。5 なら 32 段階(PC エンジン風)、
 *   8 なら 256 段階(SCC 風)。粗いほどジャリッとした音になる
 * @param {{overwrite?:boolean}} [opts] 同じ名前があるとエラーになる。
 *   わざと差し替えたいときだけ overwrite: true を渡す
 * @returns {number} 波形の番号(ふだんは名前で呼ぶので使わない)
 */
export function registerWave(name, samples, bits = 8, opts = {}) {
  requireFreeName(name, opts.overwrite);
  const levels = (1 << bits) - 1;
  // 段階に丸める。ここで粗くしておくと、実機らしい歪みがそのまま音になる
  const wave = Float32Array.from(samples, (v) => {
    const q = Math.round((Math.max(-1, Math.min(1, v)) + 1) / 2 * levels);
    return q / levels * 2 - 1;
  });
  const at = WAVEFORMS.findIndex((w) => w.name.toLowerCase() === name.toLowerCase());
  const entry = { id: at >= 0 ? at : WAVEFORMS.length, name, kind: 'wave', bits, samples: wave };
  if (at >= 0) WAVEFORMS[at] = entry; else WAVEFORMS.push(entry);
  return entry.id;
}

/**
 * 音色の名前として使える名前(作りつけのもの)。**文字を直に書かずにこれを使う**。
 * 波形メモリや FM を足すと、その名前も `@{名前}` で呼べるようになる
 */
export const WAVE = {
  PULSE12: 'pulse12', PULSE25: 'pulse25', PULSE50: 'pulse50',
  TRIANGLE: 'triangle', SAW: 'saw', SINE: 'sine', NOISE: 'noise',
};

/** 同じ名前がもうあれば止める(わざと差し替えるときだけ通す) */
function requireFreeName(name, overwrite) {
  const at = WAVEFORMS.findIndex((w) => w.name.toLowerCase() === String(name).toLowerCase());
  if (at >= 0 && !overwrite) {
    throw new Error(`[MMSXX] 音色 "${name}" はもう登録されています`
      + '(差し替えるなら overwrite: true を渡してください)');
  }
  return at;
}

/**
 * **2 オペレータの FM 音色を足す**(MSX-MUSIC の YM2413 にあたるもの)。
 *
 * 片方の音(変調側)でもう片方の音程を揺らすと、揺らし方しだいで
 * 金属にも笛にも聞こえる。要るのは 3 つだけ:
 *   - `ratio` 変調側の周波数比。**整数なら楽器らしい音**、
 *     半端な数(3.5 など)なら鐘や打楽器になる
 *   - `depth` 揺らしの深さ。大きいほど倍音が増えて硬くなる
 *   - `decay` 揺らしの減り方(秒)。**時間とともに倍音が減る**のが FM らしさ
 *
 * @param {string} name 名前。**`fm` で始める**
 * @param {{ratio?:number, depth?:number, attack?:number, decay?:number,
 *          sustain?:number, wave?:string}} params
 *   wave = 変調側の波形(WAVE の値。既定は WAVE.SINE)
 * @param {{overwrite?:boolean}} [opts]
 * @returns {number} 音色の番号(ふだんは名前で呼ぶので使わない)
 */
export function registerFM(name, params = {}, opts = {}) {
  const at = requireFreeName(name, opts.overwrite);
  const entry = {
    id: at >= 0 ? at : WAVEFORMS.length, name, kind: 'fm',
    ratio: params.ratio ?? 1,
    depth: params.depth ?? 3,
    attack: params.attack ?? 0.002,
    decay: params.decay ?? 0.3,
    sustain: params.sustain ?? 0.15,
    wave: params.wave || WAVE.SINE,
  };
  if (at >= 0) WAVEFORMS[at] = entry; else WAVEFORMS.push(entry);
  return entry.id;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** [ ... ]n ループをテキスト展開する(ネスト対応) */
function expandLoops(src) {
  for (let guard = 0; guard < 64; guard++) {
    const open = src.lastIndexOf('['); // 最内ループから展開する
    if (open < 0) break;
    const close = src.indexOf(']', open);
    if (close < 0) break; // 閉じ括弧なし: '[' を無視
    let numEnd = close + 1;
    while (numEnd < src.length && src[numEnd] >= '0' && src[numEnd] <= '9') numEnd++;
    const count = numEnd > close + 1 ? parseInt(src.slice(close + 1, numEnd), 10) : 2;
    const body = src.slice(open + 1, close);
    src = src.slice(0, open) + body.repeat(Math.max(0, count)) + src.slice(numEnd);
  }
  return src.replace(/[\[\]]/g, '');
}

/**
 * MML 文字列をイベント列にコンパイルする。
 * @param {string} mml
 * @returns {{events:{t:number,dur:number,gate:number,freq:number,vol:number}[], total:number}}
 *   t=開始秒, dur=音長秒, gate=実発音秒, freq=Hz, vol=0..15。total=チャンネル全体の長さ(秒)。
 */
export function compileMML(mml) {
  const src = expandLoops(mml.toLowerCase());
  let pos = 0;
  let octave = 4, defLen = 4, tempo = 120, vol = 10, gate = 7;
  // 音色・効果の現在値(音符ごとにイベントへコピーする)
  let wave = 2, env = 0, detune = 0, vibrato = 0, echo = 0, octave2 = 0;
  let time = 0;
  const events = [];
  const pushNote = (dur, freq) => {
    events.push({
      t: time, dur, gate: dur * gate / 8, freq, vol,
      wave, env, detune, vibrato, echo, octave2,
    });
  };

  const peek = () => src[pos];
  const readNumber = () => {
    let n = '';
    while (pos < src.length && src[pos] >= '0' && src[pos] <= '9') n += src[pos++];
    return n === '' ? null : parseInt(n, 10);
  };
  // `{名前}` を読んで、表の中の番号に直す。
  // 知らない名前は元のままにして知らせる(曲そのものは鳴らしつづける)
  const readName = (table, what, now) => {
    let s = '';
    while (pos < src.length && src[pos] !== '}') s += src[pos++];
    pos++;   // 閉じ括弧
    const key = s.trim().toLowerCase();
    const hit = table.findIndex((e) => e.name.toLowerCase() === key);
    if (hit >= 0) return hit;
    console.warn(`[MMSXX] MML: ${what} "${s}" は知らない名前です `
      + `(使えるのは ${table.map((e) => e.name).join(' / ')})`);
    return now;
  };
  const readDuration = () => {
    const len = readNumber() ?? defLen;
    let d = 240 / tempo / len;
    let dot = d;
    while (peek() === '.') { pos++; dot /= 2; d += dot; }
    return d;
  };
  const skipSpace = () => {
    while (pos < src.length && ' \n\t\r|'.includes(src[pos])) pos++;
  };

  while (pos < src.length) {
    const ch = src[pos++];
    if (' \n\t\r|'.includes(ch)) continue;

    if (SEMI[ch] !== undefined) {
      let semi = SEMI[ch];
      while (peek() === '+' || peek() === '#') { semi++; pos++; }
      while (peek() === '-') { semi--; pos++; }
      const dur = readDuration();
      const midi = (octave + 1) * 12 + semi;
      pushNote(dur, 440 * Math.pow(2, (midi - 69) / 12));
      time += dur;
    } else if (ch === 'r') {
      time += readDuration();
    } else if (ch === '&') {
      // タイ: 次の音符の長さを直前のイベントに加算する
      skipSpace();
      if (SEMI[src[pos]] !== undefined && events.length > 0) {
        pos++;
        while (peek() === '+' || peek() === '#' || peek() === '-') pos++;
        const dur = readDuration();
        const last = events[events.length - 1];
        last.dur += dur;
        last.gate = last.dur * gate / 8;
        time += dur;
      }
    } else if (ch === 'o') {
      octave = readNumber() ?? octave;
    } else if (ch === '>') {
      octave = Math.min(8, octave + 1);
    } else if (ch === '<') {
      octave = Math.max(1, octave - 1);
    } else if (ch === 'l') {
      defLen = readNumber() ?? defLen;
    } else if (ch === 't') {
      tempo = readNumber() ?? tempo;
    } else if (ch === 'v') {
      vol = Math.max(0, Math.min(15, readNumber() ?? vol));
    } else if (ch === 'q') {
      gate = Math.max(1, Math.min(8, readNumber() ?? gate));
    } else if (ch === '@') {
      // 音色と効果。@e/@d/@v/@s は 2 文字目で種類が決まる
      const kind = peek();
      // 名前で書けるようにする(番号はエンジンの都合で動くので、ゲーム側は名前を使う)
      //   @{saw} = 波形 / @e{piano} = エンベロープ
      if (kind === '{') { pos++; wave = readName(WAVEFORMS, '波形', wave); }
      else if (kind === 'e' && src[pos + 1] === '{') { pos += 2; env = readName(ENVELOPES, 'エンベロープ', env); }
      else if (kind === 'e') { pos++; env = clamp(readNumber() ?? env, 0, ENVELOPES.length - 1); }
      else if (kind === 'd') { pos++; detune = clamp(readNumber() ?? detune, 0, 100); }
      else if (kind === 'v') { pos++; vibrato = clamp(readNumber() ?? vibrato, 0, 9); }
      else if (kind === 's') { pos++; echo = clamp(readNumber() ?? echo, 0, 9); }
      else if (kind === 'o') { pos++; octave2 = clamp(readNumber() ?? octave2, 0, 2); }
      else if (kind === 'n') { pos++; wave = 6; } // 旧記法: @n = ノイズ
      else wave = clamp(readNumber() ?? wave, 0, WAVEFORMS.length - 1);
    }
    // 未知の文字は無視する
  }
  return { events, total: time };
}
