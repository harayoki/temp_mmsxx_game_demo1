import { compileMML, WAVEFORMS, ENVELOPES } from './mml.js';
import { renderTalk } from './talk.js';

// PSG 風のサウンドドライバ。
// - 波形は 8 種類 (ファミコン風パルス 4 種 / 三角 / ノコギリ / サイン / ノイズ)
// - 音色ごとにエンベロープ 6 種、デチューン・ビブラート・エコーを指定できる
// - BGM: 複数チャンネルの MML 配列。ループ再生可能
// - SE : 単発再生。新しい SE を鳴らすと前の SE は止まる(実機ゲーム風)
// - MML の "@n" は旧記法としてノイズ波形の指定に対応している

const MASTER_VOL = 0.14;

/** PSG 風の音量カーブ (0..15 -> ゲイン) */
function volGain(v) {
  if (v <= 0) return 0;
  return Math.pow(v / 15, 1.8);
}

/** チャンネル MML をコンパイルする(波形などは MML 内の @ コマンドで指定する) */
function compileTrack(mml) {
  const { events, total } = compileMML(mml.trim());
  // 実機の PSG はノイズ発生器の数が限られているので、
  // 「このチャンネルはノイズを使うか」をここで一度だけ調べておく
  const noise = events.some(e => (WAVEFORMS[e.wave] || {}).kind === 'noise');
  return { events, total, noise };
}

/** トラック配列のうち、ノイズを使うチャンネルの数 */
function noiseCount(tracks) {
  return tracks.reduce((n, t) => n + (t.noise ? 1 : 0), 0);
}

export class PSGPlayer {
  /**
   * @param {{maxVoices?:number, maxNoise?:number}} [opts]
   *   maxVoices = 同時に鳴らせる音の数。実機に寄せたいときに絞る。
   *   エンジン側に上限はないので、いくつでも指定できる(既定 8)。
   *   maxNoise = 同時に鳴らせるノイズの数(既定 1)。実機の PSG は 1 つしか
   *   持っていないが、爆発など SE がノイズを取り合って消えがちなので
   *   「間違った方向に進化したマシン」として本数を宣言できるようにしてある。
   *   BGM のドラムぶんは別枠で、ここで数えるのは SE のノイズだけ。
   */
  constructor(opts = {}) {
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.bgmDefs = new Map();
    this.seDefs = new Map();
    /** しゃべる言葉。録音は持たず、鳴らすときにフォルマント合成で作る */
    this.talkDefs = new Map();
    this.bgmState = null;
    /** ジングル(BGM を黙らせて重ねる短い曲) */
    this.jingleState = null;
    /** 鳴っている SE。1 つとは限らない(空きがあれば重ねて鳴る) */
    this.seVoices = [];
    this.noiseBuffer = null;
    this.maxVoices = opts.maxVoices ?? 8;
    this.maxNoise = opts.maxNoise ?? 1;
    /** いま BGM が使っている音の数 */
    this.bgmVoices = 0;
    /** SE の管理番号(playSE が返す。stopSE で狙って止めるのに使う) */
    this._seSeq = 0;
    /** 全体のポーズ(ゲームのポーズ用)。個別のポーズとは別に持つ */
    this._sePausedAll = false;
  }

  /** 終わった SE を片づける */
  _cleanupSE(now) {
    this.seVoices = this.seVoices.filter((v) => {
      if (now < v.endTime) return true;
      // くり返しの途中なら、まだ片づけない
      if (v.left !== 0 && v.timer) return true;
      // ポーズ中のものは、解除で鳴り直すので残す
      if (v.paused || this._sePausedAll) return true;
      if (v.timer) { clearTimeout(v.timer); v.timer = 0; }
      try { v.gain.disconnect(); } catch (e) { /* already gone */ }
      return false;
    });
  }

  /** いま使っている音の数 */
  _usedVoices() {
    return this.bgmVoices + this.seVoices.reduce((n, v) => n + v.voices, 0);
  }

  /** いま SE が使っているノイズの数 */
  _usedNoise() {
    return this.seVoices.reduce((n, v) => n + v.noise, 0);
  }

  /** 1 つの SE を止める */
  _stopVoice(v) {
    if (v.timer) { clearTimeout(v.timer); v.timer = 0; }
    v.left = 0;   // くり返しの予約が残っていても、もう積まない
    for (const n of v.nodes) { try { n.stop(0); } catch (e) { /* stopped */ } }
    try { v.gain.disconnect(); } catch (e) { /* already gone */ }
    this.seVoices = this.seVoices.filter(x => x !== v);
  }

  /** ユーザー操作を起点に AudioContext を有効化する(エンジンがキー入力時に呼ぶ) */
  unlock() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      // ホワイトノイズバッファを1つ用意して使い回す
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /**
   * BGM を登録する。MML でも音声ファイル(mp3 など)でも同じように扱える。
   * @param {string} name
   * @param {string|string[]|{url:string,gain?:number}} src
   *   MML 文字列 / チャンネルごとの MML 配列 / {url} を渡すと音声ファイル再生になる
   */
  defineBGM(name, src) {
    if (src && typeof src === 'object' && !Array.isArray(src) && src.url) {
      this.bgmDefs.set(name, { kind: 'audio', url: src.url, gain: src.gain ?? 1 });
      return;
    }
    const tracks = (Array.isArray(src) ? src : [src]).map(compileTrack);
    this.bgmDefs.set(name, tracks);
  }

  /** 音声ファイルを読み込んでデコードする(結果はキャッシュ) */
  async _loadAudio(def) {
    if (def.buffer) return def.buffer;
    if (!def._loading) {
      def._loading = fetch(def.url)
        .then(r => r.arrayBuffer())
        .then(b => new Promise((res, rej) => this.ctx.decodeAudioData(b, res, rej)))
        .then(buf => { def.buffer = buf; return buf; });
    }
    return def._loading;
  }

  /** 音声ファイルの BGM を鳴らす */
  _playAudioBGM(def, loop, state) {
    this._loadAudio(def).then((buffer) => {
      if (this.bgmState !== state) return;   // 途中で別の曲に変わった
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = loop;
      src.connect(state.gain);
      src.start(this.ctx.currentTime + 0.02);
      state.nodes.push(src);
    }).catch(() => { /* 読めなければ無音 */ });
  }

  /** SE を登録する(書式は BGM と同じ) */
  defineSE(name, mml) {
    const tracks = (Array.isArray(mml) ? mml : [mml]).map(compileTrack);
    this.seDefs.set(name, tracks);
  }

  /**
   * しゃべる言葉を登録する(TALK)。録音データは要らない。
   * カタカナ(ひらがなも可)を渡すと、鳴らすときにフォルマント合成で波形を作る。
   * 作った波形は名前ごとにキャッシュされるので、2 回目からは作り直さない。
   * @param {string} name
   * @param {string} text カタカナ。空白と句読点は間になる
   * @param {{rate?:number, bits?:number, pitch?:number, speed?:number,
   *          fall?:number, growl?:number, gain?:number}} [opts]
   *   rate = 書き出すサンプリング周波数(既定 8000)。低いほど粗い声になる。
   *   bits = 量子化ビット数(既定 6)。この 2 つで「8 ビット機らしさ」を決める。
   */
  defineTalk(name, text, opts = {}) {
    this.talkDefs.set(name, { text, opts, buffer: null });
  }

  /** 登録した言葉をしゃべる。SE と同じ優先度のしくみに乗る */
  playTalk(name, priority = 0, opts = {}) {
    const def = this.talkDefs.get(name);
    if (!def || !this.ctx) return;
    const now = this.ctx.currentTime;
    this._cleanupSE(now);
    if (this.seVoices.some(v => v.exclusive && v.priority > priority)) return;
    // 場所が空いていなければ、優先度の低いものを止めて作る
    while (this._usedVoices() + 1 > this.maxVoices) {
      let low = null;
      for (const v of this.seVoices) {
        if (v.priority >= priority) continue;
        if (!low || v.priority < low.priority) low = v;
      }
      if (!low) return 0;
      this._stopVoice(low);
    }
    if (!def.buffer) {
      // 粗いまま鳴らしたいので、書き出したサンプリング周波数のまま
      // AudioBuffer を作る(再生時にブラウザが伸ばしてくれる)
      const { rate, data } = renderTalk(def.text, def.opts);
      const buf = this.ctx.createBuffer(1, data.length, rate);
      buf.getChannelData(0).set(data);
      def.buffer = buf;
    }
    const gain = this.ctx.createGain();
    gain.gain.value = (def.opts.gain ?? 1) * 0.9;
    gain.connect(this.ctx.destination);
    const src = this.ctx.createBufferSource();
    src.buffer = def.buffer;
    src.connect(gain);
    const when = now + 0.02;
    src.start(when);
    this.seVoices.push({
      gain, nodes: [src], priority, voices: 1, noise: 0,
      endTime: when + def.buffer.duration, exclusive: !!opts.exclusive,
    });
  }

  /**
   * BGM を再生する(別の曲が鳴っていれば止まる)。
   * 同じ曲がすでに鳴っている場合は何もしない(頭出しし直さない)。
   * @param {string} name
   * @param {boolean} [loop=true] ループ再生するか
   * @param {boolean} [restart=false] true なら同じ曲でも最初から鳴らし直す
   */
  playBGM(name, loop = true, restart = false) {
    const tracks = this.bgmDefs.get(name);
    if (!tracks || !this.ctx) return;
    // 同じ曲がすでに鳴っているときは、頭から鳴らし直さない。
    // 最初から鳴らしたいときは restart に true を渡す。
    // フェード中の曲は鳴らし直す(音量が下がったまま復帰してしまうのを防ぐ)
    if (!restart && this.bgmState && this.bgmState.name === name && !this.bgmState.fading) return;
    this.stopBGM();
    const gain = this.ctx.createGain();
    gain.gain.value = 1;
    gain.connect(this.ctx.destination);
    const state = { gain, timer: 0, nodes: [], name, baseGain: 1 };
    this.bgmState = state;

    // 音声ファイル(mp3 など)の場合
    if (!Array.isArray(tracks)) {
      gain.gain.value = tracks.gain ?? 1;
      state.baseGain = gain.gain.value;
      this.bgmVoices = 1;
      this._playAudioBGM(tracks, loop, state);
      return;
    }
    this.bgmVoices = tracks.length;
    this._pump(tracks, loop, state, gain, () => this.bgmState === state);
  }

  /**
   * MML の音符を「少し先の分だけ」こまめに積んでいく(先読みスケジューリング)。
   * 1 ループぶんをまとめて予約すると、その瞬間に何百個もノードを作ることになり、
   * 非力な端末ではひとコマぶんの引っかかりになるため。
   * BGM とジングルの両方から使う。alive() が false を返したら積むのをやめる。
   */
  _pump(tracks, loop, state, gain, alive) {
    const loopLen = Math.max(...tracks.map(t => t.total), 0.01);
    const LOOKAHEAD = 0.5;   // 何秒先まで積んでおくか
    const TICK_MS = 120;     // 積み足す間隔
    state.base = this.ctx.currentTime + 0.05;   // いまのループの開始時刻
    state.cursor = 0;                           // 曲の中のどこまで積んだか
    state.length = loopLen;                     // 1 ループの長さ(秒)

    const pump = () => {
      if (!alive()) return;
      const now = this.ctx.currentTime;
      // 終わったノードを掃除
      state.nodes = state.nodes.filter(n => n.__endTime > now);
      // いま鳴っているところから LOOKAHEAD 秒先まで積む
      let guard = 0;
      while (state.base + state.cursor < now + LOOKAHEAD && guard++ < 8) {
        const to = Math.min(loopLen, state.cursor + LOOKAHEAD);
        for (const t of tracks) {
          this._scheduleTrack(t, state.base, gain, state.nodes, state.cursor, to);
        }
        state.cursor = to;
        if (state.cursor >= loopLen) {
          if (!loop) return;            // ループしないならここで終わり
          state.base += loopLen;        // 次のループへ
          state.cursor = 0;
        }
      }
      state.timer = setTimeout(pump, TICK_MS);
    };
    pump();
  }

  /**
   * ジングル(ファンファーレなど)を鳴らす。
   * **BGM は止めずに、鳴っているあいだだけ黙らせる**。
   * 鳴り終わると BGM が続きから聞こえてくるので、
   * イントロの長い曲でも頭から鳴り直さない。
   * @param {string} name BGM として登録してある短い曲
   * @returns {number} 鳴っている長さ(秒)。0 なら鳴らせなかった
   */
  playJingle(name) {
    const tracks = this.bgmDefs.get(name);
    if (!tracks || !this.ctx) return 0;
    this.stopJingle();
    const gain = this.ctx.createGain();
    gain.gain.value = 1;
    gain.connect(this.ctx.destination);
    const state = { gain, timer: 0, nodes: [], name };
    this.jingleState = state;
    this._muteBGM(true);

    let sec = 0;
    if (!Array.isArray(tracks)) {
      // 音声ファイルのジングル
      gain.gain.value = tracks.gain ?? 1;
      this._playAudioBGM(tracks, false, state);
      sec = tracks.duration || 3;
    } else {
      this._pump(tracks, false, state, gain, () => this.jingleState === state);
      sec = state.length;
    }
    // 鳴り終わったら BGM を戻す
    state.endTimer = setTimeout(() => {
      if (this.jingleState === state) this.stopJingle();
    }, sec * 1000 + 120);
    return sec;
  }

  /** ジングルを止めて、BGM の音を戻す */
  stopJingle() {
    const s = this.jingleState;
    if (!s) return;
    this.jingleState = null;
    clearTimeout(s.timer);
    clearTimeout(s.endTimer);
    for (const n of s.nodes) { try { n.stop(0); } catch (e) { /* stopped */ } }
    try { s.gain.disconnect(); } catch (e) { /* already gone */ }
    this._muteBGM(false);
  }

  /** ジングルが鳴っているか */
  get jingling() { return !!this.jingleState; }

  /** BGM を黙らせる / 戻す(止めないので、曲は裏で進み続ける) */
  _muteBGM(on) {
    const s = this.bgmState;
    if (!s || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      s.gain.gain.cancelScheduledValues(t);
      // ぶつっと切れないよう、ごく短く上げ下げする
      s.gain.gain.setValueAtTime(s.gain.gain.value, t);
      s.gain.gain.linearRampToValueAtTime(on ? 0.0001 : (s.baseGain ?? 1), t + 0.05);
    } catch (e) { /* 環境によっては失敗するので無視 */ }
  }

  /**
   * BGM を少しずつ小さくして止める。
   * @param {number} [sec=1.5] フェードにかける秒数
   */
  fadeOutBGM(sec = 1.5) {
    const s = this.bgmState;
    if (!s || !this.ctx) return;
    const t = this.ctx.currentTime;
    s.fading = true;   // フェード中は「鳴っている」とみなさない
    try {
      s.gain.gain.cancelScheduledValues(t);
      s.gain.gain.setValueAtTime(s.gain.gain.value, t);
      s.gain.gain.linearRampToValueAtTime(0.0001, t + sec);
    } catch (e) { /* 環境によっては失敗するので無視 */ }
    // 鳴り終わったら本当に止める(別の曲に切り替わっていたら何もしない)
    setTimeout(() => { if (this.bgmState === s) this.stopBGM(); }, sec * 1000 + 50);
  }

  /** BGM を停止する */
  stopBGM() {
    const s = this.bgmState;
    if (!s) return;
    // 黙らせたまま曲を止めると、戻す先が無くなる
    if (this.jingleState) this.stopJingle();
    this.bgmState = null;
    this.bgmVoices = 0;
    clearTimeout(s.timer);
    for (const n of s.nodes) { try { n.stop(0); } catch (e) { /* stopped */ } }
    try { s.gain.disconnect(); } catch (e) { /* already gone */ }
  }

  /**
   * SE を再生する。
   * 空いている音があればそこで鳴らすので、ショットと爆発が同時に鳴ることもある。
   * 空きが足りないときは、いま鳴っている SE のうち優先度の低いものを止めて場所を作る。
   * どれも自分より優先度が高ければ、その SE は鳴らさない(高い音を消さない)。
   * @param {string} name
   * @param {number} [priority=0] 大きいほど優先
   * @param {{exclusive?:boolean, loop?:number, resume?:'head'|'continue'}} [opts]
   *   exclusive = ほかの SE を全部止めて独り占めする(ファンファーレなど)。
   *   鳴っているあいだ、優先度の低い SE は鳴らない。
   *
   *   loop = くり返す回数(既定 1)。**現実的な回数を入れること**。
   *   -1 で無限にくり返せるが、**止め忘れると鳴りっぱなしになる**。
   *   どうしても無限が要るときは、止める場所を先に決めてから使うこと
   *   (面が変わる・ボスが消える・ポーズに入る、など)。
   *
   *   resume = ポーズを解いたときの鳴らしかた。
   *   'head'(既定) = くり返しの頭から / 'continue' = 止めたところの続きから。
   *   1 回だけの SE は、どちらにしても鳴り直さない
   * @returns {number} 管理番号。stopSE(番号) で**これだけ**止められる。
   *   鳴らせなかったときは 0
   */
  playSE(name, priority = 0, opts = {}) {
    const tracks = this.seDefs.get(name);
    if (!tracks || !this.ctx) return 0;
    const now = this.ctx.currentTime;
    this._cleanupSE(now);
    // 独り占めしている SE より低い優先度なら、そもそも鳴らさない
    if (this.seVoices.some(v => v.exclusive && v.priority > priority)) return 0;
    if (opts.exclusive) {
      for (const v of [...this.seVoices]) this._stopVoice(v);
    }
    const need = tracks.length;
    const needNoise = noiseCount(tracks);
    // 空きが足りなければ、優先度の低いものから止めて場所を作る
    while (this._usedVoices() + need > this.maxVoices) {
      let low = null;
      for (const v of this.seVoices) {
        if (v.priority >= priority) continue;
        if (!low || v.priority < low.priority) low = v;
      }
      if (!low) return 0;   // 止められるものが無い = 鳴らさない
      this._stopVoice(low);
    }
    // ノイズは本数が決まっているので、あふれるならノイズを使っている SE を止める
    // (1 つの SE だけでノイズを使い切る場合は、その SE 自体は鳴らす)
    while (needNoise > 0 && needNoise <= this.maxNoise
           && this._usedNoise() + needNoise > this.maxNoise) {
      let low = null;
      for (const v of this.seVoices) {
        if (!v.noise || v.priority >= priority) continue;
        if (!low || v.priority < low.priority) low = v;
      }
      if (!low) return;
      this._stopVoice(low);
    }
    const gain = this.ctx.createGain();
    gain.gain.value = 1;
    gain.connect(this.ctx.destination);
    const len = Math.max(...tracks.map(t => t.total), 0);
    const loop = opts.loop == null ? 1 : (opts.loop | 0);
    const id = ++this._seSeq;
    const when = now + 0.02;
    const state = {
      id, gain, nodes: [], priority, voices: need, noise: needNoise,
      endTime: when + len, exclusive: !!opts.exclusive,
      left: loop, timer: 0, nextAt: when + len,
      paused: false, tracks, len,
      // ポーズを解いたときの鳴らしかた。'head' = くり返しの頭から / 'continue' = 続きから
      resume: opts.resume === 'continue' ? 'continue' : 'head',
      startAt: when,   // いまのくり返しが始まった時刻(続きから鳴らすのに使う)
      offset: 0,       // 止めたときの、曲の中の位置(秒)
    };
    this.seVoices.push(state);
    for (const t of tracks) this._scheduleTrack(t, when, gain, state.nodes);
    if (loop === 1 || len <= 0) return id;
    // くり返し。1 回ぶんずつ積み足す(先に全部積むと音の数が一気に増えるため)。
    // **次の開始時刻は前回から数える**(setTimeout の揺れで隙間が空かないように)。
    // left が 0 になったら終わり。-1 のときは減らないので、止めるまで続く
    const again = () => {
      if (this.seVoices.indexOf(state) < 0) return;   // もう止められている
      if (state.paused || this._sePausedAll) { state.timer = 0; return; }
      if (state.left > 0) state.left--;
      if (state.left === 0) return;
      const t0 = state.nextAt;
      // 鳴り終わった音は捨ててから積む(node がたまり続けないように)
      const now2 = this.ctx.currentTime;
      state.nodes = state.nodes.filter(n => (n.__endTime || 0) > now2);
      for (const t of tracks) this._scheduleTrack(t, t0, gain, state.nodes);
      state.nextAt = t0 + len;
      state.startAt = t0;
      state.endTime = t0 + len + 0.05;
      // 次の予約は、鳴り終わる少し前に入れる(積み遅れで切れないように)
      state.timer = setTimeout(again, Math.max(20, (t0 + len - this.ctx.currentTime) * 1000 - 60));
    };
    // ポーズから戻すときにも、同じ手で積み直す
    state.loopAgain = again;
    state.timer = setTimeout(again, Math.max(20, len * 1000 - 60));
    return id;
  }

  /**
   * SE を一時停止する。
   *
   * **ポーズには 2 段ある**。
   * - `pauseSE(番号)` = その SE だけ止めておく(個別)
   * - `pauseSE()` = 鳴っているもの全部を止めておく(全体。ゲームのポーズ用)
   *
   * 全体を解除しても、**個別に止めてあるものは鳴り出さない**。
   * どちらも解けているときだけ鳴る。
   * @param {number} [id] 省略で全体
   */
  pauseSE(id) {
    if (id) {
      const v = this.seVoices.find(x => x.id === id);
      if (v) { v.paused = true; this._silence(v); }
      return;
    }
    this._sePausedAll = true;
    for (const v of this.seVoices) this._silence(v);
  }

  /**
   * SE の一時停止を解く。
   * くり返しの残りがあるものだけ鳴り直す。
   * 頭からか続きからかは、playSE の resume で決まる。
   * **1 回だけの SE は鳴り直さない**(途中から鳴らしても不自然なので)
   * @param {number} [id] 省略で全体
   */
  resumeSE(id) {
    if (id) {
      const v = this.seVoices.find(x => x.id === id);
      if (v) { v.paused = false; this._restart(v); }
      return;
    }
    this._sePausedAll = false;
    for (const v of [...this.seVoices]) this._restart(v);
  }

  /** 鳴っている音を黙らせる(予約も止める。残り回数と位置は覚えておく) */
  _silence(v) {
    if (v.timer) { clearTimeout(v.timer); v.timer = 0; }
    // 「続きから」のときのために、くり返しの頭からどこまで進んだかを覚える
    if (v.resume === 'continue' && v.len > 0) {
      const off = this.ctx.currentTime - v.startAt;
      v.offset = Math.max(0, Math.min(v.len - 0.02, off));
    }
    for (const n of v.nodes) { try { n.stop(0); } catch (e) { /* stopped */ } }
    v.nodes = [];
  }

  /** 止めてあった SE を鳴らし直す(頭から / 続きから は playSE の resume で決まる) */
  _restart(v) {
    if (v.paused || this._sePausedAll || v.timer) return;
    // 残りが無い(1 回だけの SE か、くり返し終わり)なら片づける
    if (v.left === 1 || v.left === 0 || !v.tracks) { this._stopVoice(v); return; }
    const now = this.ctx.currentTime + 0.02;
    if (v.resume === 'continue' && v.offset > 0) {
      // 止めたところから。残りぶんだけ鳴らして、そのあとはいつもどおりくり返す
      const rest = v.len - v.offset;
      for (const t of v.tracks) this._scheduleTrackFrom(t, now, v.gain, v.nodes, v.offset);
      v.startAt = now - v.offset;
      v.nextAt = now + rest;
      v.endTime = now + rest + 0.05;
      v.offset = 0;
      v.timer = setTimeout(v.loopAgain, Math.max(20, rest * 1000 - 60));
      return;
    }
    v.nextAt = now;
    v.loopAgain();
  }

  /**
   * SE を止める。
   * @param {number} [id] playSE() が返した管理番号。**これだけ**止める。
   *   省略すると鳴っている SE を**全部**止める。
   *   くり返し中のものも、ここで終わる
   */
  stopSE(id) {
    if (id) {
      const v = this.seVoices.find(x => x.id === id);
      if (v) this._stopVoice(v);
      return;
    }
    for (const v of [...this.seVoices]) this._stopVoice(v);
    this.seVoices = [];
  }

  /** 波形に応じた音源ノードを作る(ノイズだけはバッファ再生) */
  _makeOscillator(ev, freq) {
    const ctx = this.ctx;
    const wf = WAVEFORMS[ev.wave] || WAVEFORMS[2];
    if (wf.kind === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      // 音程が高いほど明るいノイズになるよう再生速度を変える
      src.playbackRate.value = Math.min(4, Math.max(0.1, freq / 440));
      return src;
    }
    const osc = ctx.createOscillator();
    if (wf.kind === 'pulse') {
      // デューティ比つき矩形波は PeriodicWave で作る(50% は素の square)
      // setPeriodicWave を呼ぶと type は自動で 'custom' になる(直接代入は不可)
      if (wf.duty === 0.5) osc.type = 'square';
      else osc.setPeriodicWave(this._pulseWave(wf.duty));
    } else if (wf.kind === 'triangle') {
      osc.type = 'triangle';
    } else if (wf.kind === 'saw') {
      osc.type = 'sawtooth';
    } else {
      osc.type = 'sine';
    }
    osc.frequency.value = freq;
    return osc;
  }

  /** デューティ比 duty のパルス波を PeriodicWave として作る(キャッシュ付き) */
  _pulseWave(duty) {
    if (!this._pulseCache) this._pulseCache = new Map();
    const hit = this._pulseCache.get(duty);
    if (hit) return hit;
    const N = 64;
    const real = new Float32Array(N), imag = new Float32Array(N);
    for (let n = 1; n < N; n++) {
      // 矩形波のフーリエ係数(デューティ比つき)
      imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    }
    const w = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this._pulseCache.set(duty, w);
    return w;
  }

  /** エンベロープを gain に書き込む */
  _applyEnvelope(gain, ev, amp, t0, t1) {
    const e = ENVELOPES[ev.env] || ENVELOPES[0];
    const len = Math.max(0.02, t1 - t0);
    const a = Math.min(e.a, len * 0.5);
    const d = Math.min(e.d * len, len - a);
    const sustain = amp * e.s;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(amp, t0 + a);
    if (d > 0) gain.gain.linearRampToValueAtTime(Math.max(0.0001, sustain), t0 + a + d);
    else gain.gain.setValueAtTime(amp, t0 + a);
    // リリース(音が切れる直前に 0 へ)
    const rel = Math.min(e.r, len * 0.5);
    gain.gain.setValueAtTime(Math.max(0.0001, e.s > 0 ? sustain : 0.0001), Math.max(t0 + a + d, t1 - rel));
    gain.gain.linearRampToValueAtTime(0, t1);
  }

  /** 1 音ぶんの音源 + エンベロープを組み立てて鳴らす */
  _playVoice(ev, freq, amp, t0, t1, dest, nodes) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(dest);
    const src = this._makeOscillator(ev, freq);
    this._applyEnvelope(g, ev, amp, t0, t1);

    // ビブラート(音程をゆらす)。ノイズには効かない
    if (ev.vibrato > 0 && src.frequency) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5 + ev.vibrato * 0.6;
      depth.gain.value = freq * 0.004 * ev.vibrato;
      lfo.connect(depth).connect(src.frequency);
      lfo.start(t0); lfo.stop(t1 + 0.02);
      lfo.__endTime = t1 + 0.02;
      nodes.push(lfo);
    }

    src.connect(g);
    src.start(t0);
    src.stop(t1 + 0.02);
    src.__endTime = t1 + 0.02;
    src.onended = () => { try { g.disconnect(); } catch (e) { /* gone */ } };
    nodes.push(src);
  }

  /**
   * 1チャンネルぶんを、**曲の途中(off 秒)から**鳴らす。
   * off をまたいでいる音は、残りの長さだけ鳴らす(ポーズからの再開に使う)。
   * @param {number} off 曲の中の再開位置(秒)
   */
  _scheduleTrackFrom(track, when, dest, nodes, off) {
    for (const ev of track.events) {
      const end = ev.t + Math.max(0.01, ev.gate);
      if (end <= off) continue;                 // もう鳴り終わっている音
      const start = Math.max(ev.t, off);        // またいでいる音は途中から
      const t0 = when + (start - off);
      const t1 = when + (end - off);
      const amp = volGain(ev.vol) * MASTER_VOL;
      this._playVoice(ev, ev.freq, amp, t0, t1, dest, nodes);
      if (ev.detune > 0) {
        const f2 = ev.freq * Math.pow(2, ev.detune / 1200);
        this._playVoice(ev, f2, amp * 0.6, t0, t1, dest, nodes);
      }
      if (ev.echo > 0) {
        const delay = 0.11 + ev.echo * 0.012;
        const eAmp = amp * (0.12 + ev.echo * 0.035);
        this._playVoice(ev, ev.freq, eAmp, t0 + delay, t1 + delay, dest, nodes);
      }
    }
  }

  /** 1チャンネルぶんのイベントを Web Audio ノードとしてスケジュールする */
  _scheduleTrack(track, when, dest, nodes, from = -Infinity, to = Infinity) {
    for (const ev of track.events) {
      // 先読み予約: 曲の中の時刻が [from, to) のイベントだけを積む
      if (ev.t < from || ev.t >= to) continue;
      const t0 = when + ev.t;
      const t1 = t0 + Math.max(0.01, ev.gate);
      const amp = volGain(ev.vol) * MASTER_VOL;

      this._playVoice(ev, ev.freq, amp, t0, t1, dest, nodes);

      // デチューン: わずかにずらした音を重ねて厚みを出す
      if (ev.detune > 0) {
        const f2 = ev.freq * Math.pow(2, ev.detune / 1200);
        this._playVoice(ev, f2, amp * 0.6, t0, t1, dest, nodes);
      }

      // エコー: 少し遅らせて小さく鳴らす
      if (ev.echo > 0) {
        const delay = 0.11 + ev.echo * 0.012;
        const eAmp = amp * (0.12 + ev.echo * 0.035);
        this._playVoice(ev, ev.freq, eAmp, t0 + delay, t1 + delay, dest, nodes);
      }
    }
  }
}
