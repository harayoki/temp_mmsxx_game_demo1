import { VDP, SCREEN_W, SCREEN_H, VIRTUAL_W, VIRTUAL_H } from './video.js';
import { PSGPlayer } from './audio.js';
import { Input } from './input.js';
import { ErrorLog } from './errorlog.js';

export { SCREEN_W, SCREEN_H, VIRTUAL_W, VIRTUAL_H };
export { ErrorLog };

/** レイヤー操作のハンドル。MMSXXEngine.layer(n) で取得する。 */
class LayerHandle {
  constructor(vdp, index) {
    this._vdp = vdp;
    this._index = index;
  }
  /**
   * RGBA画像(自動MSX変換・キャッシュ付き)または変換済み画像を仮想画面に描く。
   * opts で { flipX, flipY, rotate: 180 } を渡すと反転・180度回転して描ける
   * (90/270 度は横8ドット2色の決まりが崩れるので BG では使えない)。
   * opts.colorMap は色番号の置き換え表(スプライトと同じ書き方)。
   * 1 枚の絵を色ちがいで描き分けられる。
   * 交互に描けば、実機に無い中間色を目で作れる。
   * opts.scanline は走査線。null = 入れない / 0 = 奇数行を抜く / 1 = 偶数行を抜く。
   * 抜いた絵は作り置きされるので、描く手数は元の絵と変わらない。
   * opts.bgCheck に 'off' を渡すと、この絵だけ「横 8 ドット 2 色」の検査を見逃す。
   */
  draw(x, y, image, transparent = true, opts) {
    this._vdp.drawToLayer(this._index, x, y, image, transparent, opts);
  }
  /**
   * 矩形塗りつぶし。引数省略で全面。color 0 = 透明クリア。
   * ふだんは MSX らしく 8 ドット(キャラクタ)単位に丸める。
   * exact = true にすると 1 ドット単位でそのまま塗る
   * (細くなっていくレーザーのような、1 ドットずつ変える絵に使う)。
   */
  fill(color = 0, x, y, w, h, exact = false) {
    this._vdp.fillLayer(this._index, color, x, y, w, h, exact);
  }
  /** 全面透明クリア */
  clear() { this._vdp.fillLayer(this._index, 0); }
  /**
   * 画面の端で裏画面を繰り返すかどうか。
   * 既定は繰り返す(流れつづける星空など)。false にすると、
   * 右へはみ出した絵が左から出てくる、といったことがなくなる。
   */
  setRepeat(x = true, y = x) {
    const L = this._vdp.layers[this._index];
    L.repeatX = !!x; L.repeatY = !!y;
  }
  /** 内蔵フォントでテキスト描画 (1文字8x8) */
  print(x, y, text, color = 15, bg = 0) {
    this._vdp.print(this._index, x, y, text, color, bg);
  }
  /** スクロール位置を設定(仮想画面のどこを表示画面の左上にするか) */
  scroll(x, y) {
    const L = this._vdp.layers[this._index];
    L.scrollX = x; L.scrollY = y;
  }
  /** スクロール位置を相対移動 */
  scrollBy(dx, dy) {
    const L = this._vdp.layers[this._index];
    L.scrollX += dx; L.scrollY += dy;
  }
  get scrollX() { return this._vdp.layers[this._index].scrollX; }
  get scrollY() { return this._vdp.layers[this._index].scrollY; }
  get visible() { return this._vdp.layers[this._index].visible; }
  set visible(v) { this._vdp.layers[this._index].visible = v; }
  /**
   * 走査線。null = 入れない / 0 か 1 = その位相の行を抜いて 1 ライン おきに描く。
   * 毎コマ 0 と 1 を入れ替えると、抜ける行が交互に動く。
   * 絵は消さずに描画のときだけ間引くので、下に描いたものは残る。
   */
  get scanline() { return this._vdp.layers[this._index].scanline; }
  set scanline(n) { this._vdp.layers[this._index].scanline = (n == null) ? null : (n & 1); }
  /** 表示スクロールの量子化単位。8 で MSX1 実機風の8ドット単位スクロールになる (0=滑らか) */
  get snap() { return this._vdp.layers[this._index].snap; }
  set snap(n) { this._vdp.layers[this._index].snap = n; }
  /** このレイヤーの裏画面サイズ */
  get width() { return this._vdp.layers[this._index].width; }
  get height() { return this._vdp.layers[this._index].height; }
}

/**
 * MSX1 風仮想マシンのゲームエンジン本体。
 *
 * const mmsxx = new MMSXXEngine(canvas, { scale: 3 });
 * mmsxx.backdrop = 4;
 * mmsxx.layer(0).draw(0, 0, rgbaImage);
 * const ship = mmsxx.sprite(rgbaImage);
 * mmsxx.run((m) => { ship.x++; });
 */
export class MMSXXEngine {
  /** エンジンの版(コンソールの名乗りなどに使う) */
  static get version() { return '1.0'; }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{scale?:number, virtualWidth?:number, virtualHeight?:number,
   *          layers?: {width?:number,height?:number}[],
   *          screen?: {width?:number,height?:number,borderX?:number,borderY?:number}}} [opts]
   *   virtualWidth / virtualHeight は裏画面の既定サイズ(256〜2048 の 2 の冪、既定 1024x1024)。
   *   layers を渡すとレイヤーごとに別々のサイズを持てる。配列の長さが枚数になり、上限はない。
   *   screen は表示画面の大きさ(8 ドット単位、既定 256x192)とボーダーの厚み。
   *   maxVoices は同時に鳴らせる音の数(既定 8)。エンジン側に上限はない。
   *   maxNoise は同時に鳴らせるノイズの数(既定 1)。爆発など SE が
   *   ノイズを取り合って消えるときに増やす。
   */
  constructor(canvas, opts = {}) {
    this.vdp = new VDP(
      canvas, opts.scale ?? 3,
      opts.virtualWidth ?? VIRTUAL_W, opts.virtualHeight ?? VIRTUAL_H,
      opts.layers, opts.screen,
    );
    this.audio = new PSGPlayer({
      maxVoices: opts.maxVoices ?? 8,
      maxNoise: opts.maxNoise ?? 1,
    });
    // エラーは日付ごとのログに残す(3 日ぶん)。
    // 手元の開発中はエラーで止め、公開版は致命的でなければ続ける
    this.errors = new ErrorLog({ local: MMSXXEngine.isLocal }).install();
    this.input = new Input(() => this.audio.unlock());
    /**
     * 開発版のビルドか。既定は「手元で開いているか」だが、
     * opts.dev を渡せばビルドで固定できる(公開版は false)
     */
    this._dev = opts.dev ?? MMSXXEngine.isLocal;
    /** expose() で window に付けた名前 */
    this._exposed = [];
    // 公開版では、BG の検査もしない(遊ぶ人には関係がなく、console も汚さない)
    if (!this._dev) this.vdp.bgCheck = 'off';
    this._layers = this.vdp.layers.map((_, i) => new LayerHandle(this.vdp, i));
    /** 経過フレーム数 (60fps) */
    this.frame = 0;
    this._running = false;
  }

  /** 裏画面の既定の幅(レイヤーごとの実サイズは layer(i).width) */
  get virtualWidth() { return this.vdp.vw; }
  /** 裏画面の既定の高さ(レイヤーごとの実サイズは layer(i).height) */
  get virtualHeight() { return this.vdp.vh; }
  /** レイヤーの枚数 */
  get layerCount() { return this.vdp.layers.length; }

  // ---- 表示画面 ----
  /** 描画領域の幅(8 ドット単位。既定 256) */
  get screenWidth() { return this.vdp.width; }
  /** 描画領域の高さ(8 ドット単位。既定 192) */
  get screenHeight() { return this.vdp.height; }
  /** ボーダー込みで実際に出ている幅 / 高さ */
  get outWidth() { return this.vdp.outWidth; }
  get outHeight() { return this.vdp.outHeight; }
  /** いまの画面ずらし量 */
  get adjustX() { return this.vdp.adjustX; }
  get adjustY() { return this.vdp.adjustY; }

  /** 描画領域の大きさを変える(8 ドット単位) */
  setScreenSize(width, height) { this.vdp.setScreenSize(width, height); }

  /**
   * ボーダー(描画領域の外の遊び)の厚みを決める(1 ドット単位)。
   * ここには何も描かれず、いつも背景色で塗られる。
   */
  setBorder(x, y = x) { this.vdp.setBorder(x, y); }

  /**
   * 画面全体を 1 ドット単位でずらす(実機の SET ADJUST 相当。-15..+16)。
   * 回り込みは起きず、空いたところは背景色になる。画面を揺らす演出に使う。
   */
  setAdjust(x, y) { this.vdp.setAdjust(x, y); }

  /**
   * いまの画面を画像として取り出す(原寸)。
   * 実描画そのものが原寸のオフスクリーンなので、これがいちばん安い。
   * @param {{scale?:number, type?:'dataURL'|'blob'|'canvas', mime?:string}} [opts]
   */
  capture(opts) { return this.vdp.capture(opts); }

  /** いまの画面を画像ファイルとして保存する(原寸) */
  download(filename = 'screenshot.png', opts) {
    const url = this.vdp.capture(opts);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    return filename;
  }

  /**
   * 開発版のビルドかどうか。**細かい出し分けはこれを見て決める**。
   * 既定は「手元で開いているか(isLocal)」だが、
   * `new MMSXXEngine(canvas, { dev: false })` のように**ビルドで固定できる**。
   * こうしておくと、本番のビルドを手元のサーバで開いても開発機能は出てこないし、
   * 開発版をスマホへ持っていっても開発機能が使える。
   */
  get dev() { return this._dev; }

  /**
   * コンソールから触れる関数を登録する。
   * **開発版のときだけ window に付く**。本番のビルドでは登録しないので、
   * `mmsxxDebug` などの名前そのものが存在しなくなる。
   *
   * 関数を作る手間も惜しいときは、**関数を返す関数**を渡せばよい。
   * 本番では中身が呼ばれないので、関数そのものが作られない。
   *
   * ```js
   * mmsxx.expose('gameDebug', () => ({ stage, score }));       // そのまま
   * mmsxx.expose({ gameBoss: (n) => warp(n), gameKill: kill }); // まとめて
   * mmsxx.expose('gameHeavy', () => () => 重い準備がいる関数);   // 遅らせる
   * ```
   * @param {string|Object<string,Function>} name 名前 or 名前と関数の表
   * @param {Function} [fn] name が文字列のときの中身
   * @param {{lazy?:boolean}} [opts] lazy:true なら fn() を呼んだ結果を登録する
   * @returns {boolean} 登録したか(本番では false)
   */
  expose(name, fn, opts = {}) {
    if (!this._dev || typeof window === 'undefined') return false;
    const put = (k, v) => {
      window[k] = opts.lazy ? v() : v;
      this._exposed.push(k);
    };
    if (typeof name === 'object') {
      for (const k of Object.keys(name)) put(k, name[k]);
    } else {
      put(name, fn);
    }
    return true;
  }

  /** expose した名前を全部 window から外す(消し忘れの確認用) */
  unexposeAll() {
    for (const k of this._exposed) { try { delete window[k]; } catch (e) { window[k] = undefined; } }
    const n = this._exposed.length;
    this._exposed = [];
    return n;
  }

  /** expose してある名前の一覧 */
  get exposed() { return [...this._exposed]; }

  /**
   * 手元の開発中かどうか(localhost / file: で開いているか)。
   * ビルドで決め打ちしたいときは dev を使う。
   */
  get isLocal() { return MMSXXEngine.isLocal; }
  static get isLocal() {
    if (typeof location === 'undefined') return true;   // ブラウザ以外(テスト等)
    if (location.protocol === 'file:') return true;
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
  }

  /** レイヤーハンドルを取得 (0 が奥、数字が大きいほど手前) */
  layer(i) { return this._layers[i]; }

  /** 背景色(パレット番号 1..15)。全レイヤー透明の場所に見える色 */
  get backdrop() { return this.vdp.backdrop; }
  set backdrop(c) { this.vdp.backdrop = c; }

  /**
   * RGBA画像を MSX 制約付き画像へ明示的に変換(キャッシュ付き)。
   * opts.colors を指定すると「画像全体で N 色まで」の変換
   * (単色スプライト=1, スプライト2枚重ね風=2)。省略時は横8ドット2色制約。
   */
  convert(image, opts) { return this.vdp.convert(image, opts); }

  /**
   * スプライトを生成(枚数・横並び制限なし)。opts は convert() と同じ。
   * 生成したスプライトは flipX / flipY / rotate(0,90,180,270) を持ち、
   * 1 枚の絵から向き違いを作れる(BG スプライトは 90/270 度は無視される)。
   */
  sprite(image, opts) { return this.vdp.createSprite(image, opts); }

  /** スプライトを削除 */
  removeSprite(sprite) { this.vdp.removeSprite(sprite); }

  /**
   * BG スプライトを生成。通常スプライトより奥(レイヤーより手前)に描かれ、
   * 位置は 8 ドット単位に丸められる。大きさ・枚数に制限はない。
   * opts に `{ bgCheck: 'off' }` を渡すと、この絵だけ「横 8 ドット 2 色」の
   * 検査を見逃す(わざと破って、上にスプライトを重ねて隠す使い方のため)。
   */
  bgSprite(image, opts) { return this.vdp.createBgSprite(image, opts); }

  /** BG スプライトを削除 */
  removeBgSprite(sprite) { this.vdp.removeBgSprite(sprite); }

  /**
   * BG の絵が「横 8 ドット 2 色(背景色込み)」を守れているかの検査のしかた。
   * BG スプライトを作ったとき・レイヤーへ描く絵を変換したときに、
   * **その絵につき 1 度だけ**走る(毎フレーム描いても手数は増えない)。
   *
   * - `'warn'` (既定) console に出して、そのまま動かす
   * - `'throw'` 例外を投げる(作っている最中に取りこぼしたくないとき)
   * - `'off'` 調べない
   *
   * 絵 1 枚だけ見逃したいときは、`bgSprite` / `layer.draw` の opts に
   * `{ bgCheck: 'off' }` を渡す。
   * @type {'warn'|'throw'|'off'}
   */
  get bgCheck() { return this.vdp.bgCheck; }
  set bgCheck(v) { this.vdp.bgCheck = v; }

  /** 見つかった違反の記録(まとめて見たいとき) */
  get bgWarnings() { return this.vdp.bgWarnings; }

  /**
   * レイヤー 1 枚をまるごと検査する。裏画面(既定 1024x1024)を全部見るので重い。
   * 自動では走らないので、確かめたいときだけ呼ぶ。
   * @param {number} layerIndex
   * @returns {{runs:number, worst:number, samples:string[]}}
   */
  checkLayer(layerIndex) { return this.vdp.checkLayer(layerIndex); }

  /**
   * base64 RGBA からエンジンに渡せる画像オブジェクトを作る(makedata の出力用)。
   * @returns {{data:Uint8Array,width:number,height:number}}
   */
  static imageFromBase64(b64, width, height) {
    const bin = atob(b64);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { data, width, height };
  }

  /**
   * メインループを開始する。update は 60fps 固定で呼ばれる。
   * @param {(mmsxx: MMSXXEngine) => void} update
   */
  run(update) {
    this._running = true;
    this._update = update;
    const STEP = 1000 / 60;
    let last = performance.now();
    let acc = 0;
    const tick = (now) => {
      if (!this._running) return;
      acc += Math.min(now - last, 100); // タブ復帰時の暴走防止
      last = now;
      let steps = 0;
      while (acc >= STEP && steps < 4) {
        update(this);
        this.input.endFrame();
        this.frame++;
        acc -= STEP;
        steps++;
      }
      if (steps === 4) acc = 0;
      this.vdp.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** メインループを停止する */
  stop() { this._running = false; }

  /** デバッグ用: 手動で n フレームぶん進めて描画する */
  step(n = 1) {
    for (let i = 0; i < n; i++) {
      if (this._update) this._update(this);
      this.input.endFrame();
      this.frame++;
    }
    this.vdp.render();
  }
}
