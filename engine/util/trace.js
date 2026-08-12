// **なぞった道を、そのまま通ってもらう移動制御。**
// 指で線を引くと、自機は**まず線の始点まで行き**、そのあと線をなぞる。
//
//   const trace = createTrace();
//   // 指を受けたら(**ゲームのドットで**渡すこと。画面の点は vdp.pointToScreen で戻す)
//   trace.down(x, y); trace.move(x, y); trace.up();
//   // 毎コマ
//   const v = trace.update(player.x, player.y, dtMs);
//   mmsxx.input.setStick('touch', v.x, v.y);
//
// ## 叩いて行き先を置くのと何が違うか
//
// あちら(engine/util/padless.js)は**点**を置く。こちらは**道**を引く。
// 「ここを通ってほしい」がそのまま書けるので、弾の切れ目を縫う道を
// 前もって引いておける。引いているあいだも自機は動きはじめる。
//
// **引き直しはいつでもできる。** もう一度指を下ろした時点で前の道は捨て、
// 自機は新しい道の**始点へ向かう**。書き足しではない — 描いた線が
// そのまま残り続けると、どこを走っているのか分からなくなる。
//
// **叩いただけ(引かなかった)なら、点が 1 つの道**になる。
// 始点と終点が同じところなので、そこへ着いたら止まる。
//
// ## 道の持ちかた
//
// 指の通ったところを、`minStep` ドットおきに拾って並べる。
// 生の点を全部持つと、指の震えぶんだけ細かく曲がることになる。
//
// **着いたぶんは前から消さない。** 番号(`index`)で進む。
// 消してしまうと、線を描き直すまで**通ってきた道が画面から消えていく**ので、
// どこを走っているのかが見えなくなる(道は絵として出しっぱなしにする)。
//
// ゲームの中身は知らない。**座標系は呼ぶ側のもの**で、ここでは
// 「ドット」としか呼ばない。

/** つまみの既定。**ゲームごとに合う値が違う**ので、全部差し替えられる */
const DEFAULTS = {
  /** 道の点をどれだけおきに拾うか(ドット)。細かすぎると指の震えを拾う */
  minStep: 6,
  /** その点に着いたことにする近さ(ドット) */
  arrive: 5,
  /**
   * **行き過ぎたと見なす距離**(ドット)。
   * ここまで近づいたあと**離れはじめたら**、その点は通ったことにする。
   * 道の点は近い間隔で並んでいるので、`padless` の同じつまみより小さい
   */
  passBy: 12,
  /**
   * **道の長さの上限**(ドット。0 で頭打ちなし)。
   * ここを越えたぶんは拾わない ── **指はまだ動くが、道は伸びない**。
   *
   * 自機の速さで決めるつもりの値(呼ぶ側が入れ直す)。
   * 遅い自機で長い道を引けると、引き終わったころには
   * 画面の様子がすっかり変わっている
   */
  maxLength: 0,
  /**
   * **指を離してから道が消えるまで**(ms。0 で消えない)。
   *
   * 走り終わった道が残り続けると、**やられて出直したあとにも
   * 前の道が画面に残る**。時間で勝手に片付ける
   */
  expireMs: 0,
};

const D2R = Math.PI / 180;

/**
 * なぞった道をたどる移動制御を作る。
 * @param {object} [opts] 上の DEFAULTS を部分的に差し替える
 */
export function createTrace(opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts);

  /** 'idle'(道が無い) / 'draw'(指で引いている最中) / 'auto'(たどっている) */
  let state = 'idle';
  /** 道。**引いた順**に並ぶ。着いても消さない(下の index で進む) */
  const points = [];
  /** いま向かっている点の番号。**道の絵はこれで塗り分けられる** */
  let index = 0;
  /** 前のコマの距離。**離れはじめたか**を見るためだけに持つ */
  let lastDist = Infinity;
  /** 道なりの長さ(ドット)。**上限の見張りに使う** */
  let length = 0;
  /** 最後に指が触れた時刻(ms)。**時間で片付ける**のに使う */
  let touchedAt = 0;

  function stop() {
    state = 'idle';
    index = 0;
    lastDist = Infinity;
    length = 0;
    points.length = 0;
  }

  /** いまの時刻(ms)。試験から差し替えられるように 1 か所にまとめておく */
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  return {
    get state() { return state; },
    /** 道の点(ドット)。**書き換えないこと** */
    get points() { return points; },
    /** いま向かっている点の番号 */
    get index() { return index; },
    /** 道の始まり(無ければ null) */
    get start() { return points.length ? points[0] : null; },
    /** 道の終わり(無ければ null)。叩いただけなら始点と同じ */
    get end() { return points.length ? points[points.length - 1] : null; },
    /** 終わりまで着いたか */
    get done() { return state !== 'draw' && index >= points.length; },
    /** 道なりの長さ(ドット) */
    get length() { return length; },
    /** 上限の長さ。**遊びの最中に変えてよい**(自機の速さで決めるため) */
    get maxLength() { return o.maxLength; },
    set maxLength(v) { o.maxLength = Math.max(0, v || 0); },
    /** 指を離してから消えるまで(ms) */
    get expireMs() { return o.expireMs; },
    set expireMs(v) { o.expireMs = Math.max(0, v || 0); },

    /**
     * 指が触れた。**前の道は捨てて引き直す。**
     * 書き足しにしないのは、描いた線が残り続けると
     * どこを走っているのか分からなくなるため
     */
    down(x, y) {
      points.length = 0;
      points.push({ x, y });
      index = 0;
      lastDist = Infinity;
      length = 0;
      touchedAt = now();
      state = 'draw';
    },

    /** 指が動いた。**minStep ドット進むごとに 1 点**拾う */
    move(x, y) {
      if (state !== 'draw') return;
      const last = points[points.length - 1];
      const d = Math.hypot(x - last.x, y - last.y);
      if (d < o.minStep) return;
      // **上限まで来たら、それ以上は伸ばさない。** 指は動いてよい
      if (o.maxLength > 0 && length + d > o.maxLength) return;
      points.push({ x, y });
      length += d;
      touchedAt = now();
    },

    /** 指が離れた。**道はそのまま残る**(たどりはじめる) */
    up() {
      if (state !== 'draw') return;
      state = 'auto';
      touchedAt = now();
    },

    /** 指が消えた(着信など)。離したのと同じ扱いでよい */
    cancel() { this.up(); },

    /** 道を捨てる(有効範囲の外を叩いたときなど。**呼ぶ側が決める**) */
    stop,

    /**
     * 毎コマ呼ぶ。**進む向きを単位ベクトルで返す**(止まっていれば 0)。
     *
     * **引いている最中も動く。** 引き終わるまで待つと、
     * 長い道を引いたぶんだけ出遅れる
     * @param {number} selfX 自機のいまの場所(ドット)
     * @param {number} selfY 同上
     */
    update(selfX, selfY) {
      // **時間で片付ける。** 引いているあいだは数えない
      if (o.expireMs > 0 && state === 'auto' && now() - touchedAt > o.expireMs) {
        stop();
        return { x: 0, y: 0 };
      }
      if (state === 'idle' || index >= points.length) return { x: 0, y: 0 };
      let t = points[index];
      let dist = Math.hypot(t.x - selfX, t.y - selfY);
      // **重なっていれば 1 コマで何個も片付ける。**
      // 1 コマに 1 つずつだと、細かい点の上で足踏みして見える
      for (;;) {
        const reached = dist <= o.arrive || (dist <= o.passBy && dist > lastDist);
        if (!reached) break;
        index++;
        lastDist = Infinity;
        // **終わりまで来たら止まる。** 道はそのまま残しておく
        // (次に指を下ろすまで、走ってきた道が見えている)
        if (index >= points.length) return { x: 0, y: 0 };
        t = points[index];
        dist = Math.hypot(t.x - selfX, t.y - selfY);
      }
      lastDist = dist;
      const deg = Math.atan2(t.y - selfY, t.x - selfX) / D2R;
      const h = deg * D2R;
      return { x: Math.cos(h), y: Math.sin(h) };
    },
  };
}
