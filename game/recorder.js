// 開発用: プレイを丸ごと書き出す(1 面ぶんを想定)。
//
// 動画にはせず、**画面の色番号のまま**ファイルへ流し込む。
// 1 ドット 1 バイトなので MediaRecorder のようににじまず、あとから
// 何倍に拡大しても元のドットと完全に一致する。
// 動画にするのは `tools/rec2mp4.mjs`(ffmpeg を呼ぶ)の仕事。
//
//   ALT+R  録画の開始 / 停止
//
// 書き出すのは 3 つ。単体では再生できない**途中の形**:
//   frames.idx.gz  色番号の並び(gzip)
//   audio.pcm      s16le モノラル
//   meta.json      大きさ・パレット・**コマごとの時刻**
//
// 時刻を残すのが肝。絵はゲームループ、音は AudioContext と**別の時計**で
// 動いていて、処理落ち・ポーズ・画面が隠れたときにずれる。
// コマの時刻さえ残っていれば、あとから等間隔に並べ直せる。
//
// エンジン v2 でちゃんと作るまでのつなぎ。要らなくなったらこのファイルと
// main.js の呼び出し、tools/rec2mp4.mjs をまとめて消してよい。

/** 音を横取りする節。128 サンプルずつ来るので、まとめてから渡す */
const TAP_CODE = `
class MmsxxRecTap extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.size = (opts.processorOptions && opts.processorOptions.size) || 4096;
    this.buf = new Float32Array(this.size);
    this.at = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.at++] = ch[i];
        if (this.at === this.size) { this.port.postMessage(this.buf.slice(0)); this.at = 0; }
      }
    }
    return true;
  }
}
registerProcessor('mmsxx-rec-tap', MmsxxRecTap);
`;

const AUDIO_BLOCK = 4096;

export class RawRecorder {
  /** @param {import('../engine/engine.js').MMSXXEngine} mmsxx */
  constructor(mmsxx) {
    this.mmsxx = mmsxx;
    this.vdp = mmsxx.vdp;
    this.on = false;
    this.busy = false;
    this.frames = 0;
    this.bytes = 0;
    /** コマごとの時刻(録画開始からの秒数) */
    this.times = [];
    /** パレットが変わったところ [{ frame, palette }] */
    this.palChanges = [];
    this._palKey = '';
    this._blink = 0;
    // 目印は **DOM に出す**。キャンバスに描くと録画そのものに写り込む
    // (コマ数の表示と同じ考えかた)
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed', top: '4px', left: '4px',
      font: 'bold 12px monospace', color: '#f44',
      background: 'rgba(0,0,0,0.55)', padding: '1px 6px', borderRadius: '3px',
      zIndex: '9999', pointerEvents: 'none', whiteSpace: 'pre', display: 'none',
    });
    document.body.appendChild(this.el);
  }

  /** 使える環境か(Chrome / Edge のみ) */
  static get available() {
    return typeof window !== 'undefined'
      && typeof window.showDirectoryPicker === 'function'
      && typeof CompressionStream === 'function';
  }

  get recording() { return this.on; }

  /**
   * ALT+R の受け口。**キー入力のハンドラから直に呼ぶこと**。
   * フォルダを選ぶ窓は「人が押した流れ」からしか開けないので、
   * ゲームループの中から呼ぶと黙って弾かれる
   */
  toggle() {
    if (this.busy) return;
    if (this.on) this.stop();
    else this.start();
  }

  /** 録画を始める(フォルダを選んでもらう) */
  async start() {
    if (this.on || this.busy) return false;
    if (!RawRecorder.available) {
      this.mmsxx.errors.log('録画: この環境では使えません(Chrome / Edge のみ)');
      return false;
    }
    // **待つ前に呼ぶ。** ここで await を挟むと、押した流れから外れて窓が開かない。
    // id を付けておくと、次からは前に選んだ場所が開く
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: 'mmsxx-rec', mode: 'readwrite' });
    } catch (e) {
      return false;   // 選ばずに閉じた
    }
    this.busy = true;
    // どこで転んだかを画面に出すための目印
    let step = 'permission';
    try {
      // **書き込みの許可をここで確かめる。** 窓で「表示のみ」を選ばれていると、
      // このあとの作成がまとめて弾かれる
      // まだ決まっていない(prompt)ときは頼んでみるが、**ここでは止めない**。
      // requestPermission も「人が押した流れ」の中でないと窓を出せず、
      // その流れは直前の showDirectoryPicker が使い切っている。
      // 実際に書けるかどうかは、このあとの作成で分かる
      if (dir.queryPermission) {
        let p = await dir.queryPermission({ mode: 'readwrite' });
        if (p !== 'granted' && dir.requestPermission) {
          try { p = await dir.requestPermission({ mode: 'readwrite' }); } catch (e) { /* 窓を出せない */ }
        }
        if (p !== 'granted') {
          console.warn('[MMSXX] 録画: 書き込みの許可が ' + p + ' のまま。このまま試します');
        }
      }
      step = 'mkdir';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const sub = await dir.getDirectoryHandle('rec-' + stamp, { create: true });
      this.dirName = 'rec-' + stamp;
      // 絵: 色番号をそのまま gzip へ流す
      step = 'frames';
      const fh = await sub.getFileHandle('frames.idx.gz', { create: true });
      const fw = await fh.createWritable();
      const ft = new TransformStream();
      this.frameWriter = ft.writable.getWriter();
      this.framePipe = ft.readable.pipeThrough(new CompressionStream('gzip')).pipeTo(fw);
      // 音: PCM は縮まないので、そのまま書く
      step = 'audiofile';
      const ah = await sub.getFileHandle('audio.pcm', { create: true });
      const aw = await ah.createWritable();
      const at = new TransformStream();
      this.audioWriter = at.writable.getWriter();
      this.audioPipe = at.readable.pipeTo(aw);
      this.sub = sub;
      this.frames = 0;
      this.bytes = 0;
      this.times = [];
      this.palChanges = [];
      this._palKey = '';
      this.samples = 0;
      step = 'audiotap';
      // **音が取れなくても絵は録る。** 音のつなぎで止まって、
      // 録画そのものが始まらないほうが困る
      try {
        await this._startAudio();
      } catch (e) {
        console.warn('[MMSXX] 録画: 音を取れないので絵だけ録ります', e);
        this.mmsxx.errors.log('録画: 音なしで続けます: ' + e);
        this._stopAudio();
      }
      // 時刻の起点。音の 0 サンプル目がこの時刻にあたる
      const ctx = this.mmsxx.audio.ctx;
      this.t0 = ctx ? ctx.currentTime : performance.now() / 1000;
      // 描き終わった絵を毎コマ横取りする。
      // **update ではなく render のあと**でないといけない。
      // 混んでいるときループは update を数回まとめて回し、描くのは 1 回だけなので、
      // update 側で撮ると画面に出ていないコマまで混ざる
      step = 'hook';
      this._hadOwnRender = Object.prototype.hasOwnProperty.call(this.vdp, 'render');
      this._ownRender = this._hadOwnRender ? this.vdp.render : null;
      this._origRender = this.vdp.render.bind(this.vdp);
      this.vdp.render = () => { this._origRender(); this._frame(); };
      this.on = true;
      this.el.style.display = '';
      this._paint();
      return true;
    } catch (e) {
      // 黙って始まらないのがいちばん困るので、**どこで転んだか**まで見せる。
      // console を開かなくても画面だけで分かるようにしておく
      console.error('[MMSXX] 録画を始められませんでした (' + step + ')', e);
      this.mmsxx.errors.log('録画: 始められませんでした(' + step + '): ' + e);
      this.el.style.display = '';
      const why = (e && e.name && e.name !== 'Error') ? e.name : (e && e.message) || e;
      this.el.textContent = 'REC FAILED [' + step + '] ' + why;
      setTimeout(() => { if (!this.on) this.el.style.display = 'none'; }, 10000);
      await this._closeAll();
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** 録画を止めて、3 つのファイルを閉じる */
  async stop() {
    if (!this.on || this.busy) return false;
    this.busy = true;
    this.on = false;
    // 横取りをやめる。ふだんは prototype にあるので消せば元へ戻るが、
    // 誰かが自前の render を持たせていたときのために、あったものは書き戻す
    if (this._hadOwnRender) this.vdp.render = this._ownRender;
    else delete this.vdp.render;
    this._origRender = this._ownRender = null;
    this._stopAudio();
    try {
      const meta = {
        width: this.vdp.outWidth,
        height: this.vdp.outHeight,
        frames: this.frames,
        // 音の 1 サンプル目が時刻 0。times も同じ起点で数えてある
        sampleRate: this.mmsxx.audio.ctx ? this.mmsxx.audio.ctx.sampleRate : 0,
        channels: 1,
        palette: this._palette(),
        paletteChanges: this.palChanges,
        times: this.times,
      };
      await this._closeAll();
      const mh = await this.sub.getFileHandle('meta.json', { create: true });
      const mw = await mh.createWritable();
      await mw.write(JSON.stringify(meta));
      await mw.close();
      console.log('[MMSXX] 録画: ' + this.dirName + ' に ' + this.frames + ' コマ');
    } catch (e) {
      this.mmsxx.errors.log('録画: 閉じられませんでした: ' + e);
    }
    this.el.style.display = 'none';
    this.busy = false;
    return true;
  }

  /** 開いているものを全部閉じる */
  async _closeAll() {
    try { if (this.frameWriter) await this.frameWriter.close(); } catch (e) { /* もう閉じている */ }
    try { if (this.framePipe) await this.framePipe; } catch (e) { /* 同上 */ }
    try { if (this.audioWriter) await this.audioWriter.close(); } catch (e) { /* 同上 */ }
    try { if (this.audioPipe) await this.audioPipe; } catch (e) { /* 同上 */ }
    this.frameWriter = this.framePipe = this.audioWriter = this.audioPipe = null;
  }

  /** 1 コマぶん書き出す(render の直後に呼ばれる) */
  _frame() {
    if (!this.on) return;
    const idx = this.vdp.outIdx;
    // 書き出しは非同期なので、**その場で写しを取る**(次のコマで上書きされる)
    this.frameWriter.write(idx.slice(0)).catch(() => {});
    const ctx = this.mmsxx.audio.ctx;
    const now = ctx ? ctx.currentTime : performance.now() / 1000;
    this.times.push(Math.round((now - this.t0) * 1e6) / 1e6);
    this.frames++;
    this.bytes += idx.length;
    this._checkPalette();
    this._paint();
  }

  /** パレットは裏技(TMS9918 / V9938)で途中から変わる。変わった所を控える */
  _checkPalette() {
    const p = this.vdp.pal32;
    let key = '';
    for (let i = 0; i < p.length; i++) key += p[i] + ',';
    if (key === this._palKey) return;
    this._palKey = key;
    this.palChanges.push({ frame: this.frames - 1, palette: this._palette() });
  }

  /** いまのパレットを [r,g,b] の並びで取り出す */
  _palette() {
    const p = this.vdp.pal32;
    const out = [];
    // pal32 は (a<<24)|(b<<16)|(g<<8)|r で詰めてある
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      out.push([v & 255, (v >> 8) & 255, (v >> 16) & 255]);
    }
    return out;
  }

  /** 目印の書き換え(1 秒に 2 回だけ点滅させる) */
  _paint() {
    if ((this.frames & 15) !== 0) return;
    this._blink = (this._blink + 1) & 1;
    const mb = (this.bytes / (1024 * 1024)).toFixed(0);
    this.el.style.color = this._blink ? '#f44' : '#911';
    this.el.textContent = 'REC ' + this.frames + ' / ' + mb + 'MB';
  }

  /** 音の横取りを始める。出口の手前(bus)から分けてもらう */
  async _startAudio() {
    const audio = this.mmsxx.audio;
    const ctx = audio.ctx;
    // 音がまだ解禁されていない(1 度もキーを触っていない)ときは絵だけ録る
    if (!ctx || !ctx.audioWorklet) return false;
    const dest = ctx.createMediaStreamDestination();
    if (!audio.recordTo(dest)) return false;
    // 節の登録は 1 度きり。2 回目の録画で登録し直すと名前がぶつかって落ちる
    if (!ctx._mmsxxRecTap) {
      const url = URL.createObjectURL(new Blob([TAP_CODE], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
        ctx._mmsxxRecTap = true;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const node = new AudioWorkletNode(ctx, 'mmsxx-rec-tap',
      { processorOptions: { size: AUDIO_BLOCK } });
    const src = ctx.createMediaStreamSource(dest.stream);
    src.connect(node);
    // 節を回しつづけるため、音の出ない先へつないでおく(audio.js の聞き耳と同じ)
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    sink.connect(ctx.destination);
    node.port.onmessage = (e) => this._writeAudio(e.data);
    this.audioNode = node; this.audioSrc = src; this.audioSink = sink; this.audioDest = dest;
    return true;
  }

  /** 音の横取りを外す */
  _stopAudio() {
    if (this.audioNode) { this.audioNode.port.onmessage = null; }
    for (const n of [this.audioNode, this.audioSrc, this.audioSink]) {
      if (n) { try { n.disconnect(); } catch (e) { /* もう外れている */ } }
    }
    if (this.audioDest) { try { this.mmsxx.audio.recordTo(null); } catch (e) { /* 同上 */ } }
    this.audioNode = this.audioSrc = this.audioSink = this.audioDest = null;
  }

  /** Float32 を s16le にして書く */
  _writeAudio(data) {
    if (!this.on || !this.audioWriter) return;
    const out = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const v = data[i] < -1 ? -1 : (data[i] > 1 ? 1 : data[i]);
      out[i] = v * 0x7fff;
    }
    this.samples += data.length;
    this.audioWriter.write(new Uint8Array(out.buffer)).catch(() => {});
  }
}
