// デバッグ用: MML の曲を WAV ファイルとして書き出す。
// ブラウザのコンソールから  mmsxxExportWav('main')  のように呼ぶ。
// (mp3 化はブラウザ内にエンコーダを持たないので、出力した WAV を
//  ffmpeg -i main.wav main.mp3 のように変換してください)
import { compileMML, WAVEFORMS, ENVELOPES } from '../engine/mml.js';

const MASTER_VOL = 0.14;
const volGain = (v) => (v <= 0 ? 0 : Math.pow(v / 15, 1.8));

/** Float32 の左右チャンネルを 16bit PCM の WAV(Blob)にする */
function toWavBlob(buffer) {
  const ch = buffer.numberOfChannels, len = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true);
  data.setUint16(22, ch, true); data.setUint32(24, buffer.sampleRate, true);
  data.setUint32(28, buffer.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  str(36, 'data'); data.setUint32(40, len * ch * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      data.setInt16(o, v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data.buffer], { type: 'audio/wav' });
}

/** オフラインで 1 曲ぶんレンダリングする */
async function renderTracks(tracks, loops = 1) {
  const compiled = tracks.map(t => compileMML(t.trim()));
  const total = Math.max(...compiled.map(t => t.total)) * loops + 1.5;
  const ctx = new OfflineAudioContext(1, Math.ceil(44100 * total), 44100);

  // ノイズ用バッファ
  const noise = ctx.createBuffer(1, 44100, 44100);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const voice = (ev, freq, amp, t0, t1) => {
    const g = ctx.createGain();
    g.connect(ctx.destination);
    const wf = WAVEFORMS[ev.wave] || WAVEFORMS[2];
    let src;
    if (wf.kind === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = noise; src.loop = true;
      src.playbackRate.value = Math.min(4, Math.max(0.1, freq / 440));
    } else {
      src = ctx.createOscillator();
      if (wf.kind === 'pulse') {
        if (wf.duty === 0.5) src.type = 'square';
        else {
          const N = 64, real = new Float32Array(N), imag = new Float32Array(N);
          for (let n = 1; n < N; n++) imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * wf.duty);
          src.setPeriodicWave(ctx.createPeriodicWave(real, imag));
        }
      } else if (wf.kind === 'triangle') src.type = 'triangle';
      else if (wf.kind === 'saw') src.type = 'sawtooth';
      else src.type = 'sine';
      src.frequency.value = freq;
    }
    const e = ENVELOPES[ev.env] || ENVELOPES[0];
    const len = Math.max(0.02, t1 - t0);
    const a = Math.min(e.a, len * 0.5);
    const d = Math.min(e.d * len, len - a);
    const sustain = amp * e.s;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + a);
    if (d > 0) g.gain.linearRampToValueAtTime(Math.max(0.0001, sustain), t0 + a + d);
    const rel = Math.min(e.r, len * 0.5);
    g.gain.setValueAtTime(Math.max(0.0001, e.s > 0 ? sustain : 0.0001), Math.max(t0 + a + d, t1 - rel));
    g.gain.linearRampToValueAtTime(0, t1);
    src.connect(g);
    src.start(t0); src.stop(t1 + 0.02);
  };

  for (let loop = 0; loop < loops; loop++) {
    for (const t of compiled) {
      const base = loop * t.total;
      for (const ev of t.events) {
        const t0 = base + ev.t, t1 = t0 + Math.max(0.01, ev.gate);
        const amp = volGain(ev.vol) * MASTER_VOL;
        voice(ev, ev.freq, amp, t0, t1);
        if (ev.detune > 0) voice(ev, ev.freq * Math.pow(2, ev.detune / 1200), amp * 0.6, t0, t1);
        if (ev.echo > 0) {
          const dl = 0.11 + ev.echo * 0.012;
          voice(ev, ev.freq, amp * (0.12 + ev.echo * 0.035), t0 + dl, t1 + dl);
        }
      }
    }
  }
  return ctx.startRendering();
}

/**
 * 曲を WAV にして自動ダウンロードする。
 * @param {string} name gamedata の BGM / SE 名
 * @param {number} [loops=1] 繰り返し回数
 */
export async function exportWav(name, loops = 1) {
  const { GAME_DATA } = await import('./gamedata.js');
  const src = GAME_DATA.bgm[name] || GAME_DATA.se[name];
  if (!src) throw new Error('そんな曲はありません: ' + name);
  if (!Array.isArray(src) && typeof src === 'object') throw new Error('音声ファイルの曲は書き出せません');
  const buffer = await renderTracks(Array.isArray(src) ? src : [src], loops);
  const url = URL.createObjectURL(toWavBlob(buffer));
  const a = document.createElement('a');
  a.href = url; a.download = name + '.wav';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name + '.wav';
}

window.mmsxxExportWav = exportWav;
