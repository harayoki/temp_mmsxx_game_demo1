// **お絵描きの「遅延ドロー」で動かす。**
// 指を筆にして、自機を筆先として引っぱる。指にぴたりとは付いてこない ──
// **少し遅れて、なめらかに**寄ってくる(お絵描きの「手ブレ補正」と同じ仕掛け)。
//
//   const trace = createTrace();
//   // 指を受けたら(**ゲームのドットで**渡すこと。画面の点は vdp.pointToScreen で戻す)
//   trace.down(x, y); trace.move(x, y); trace.up();
//   // 毎コマ
//   const v = trace.update(player.x, player.y);
//   mmsxx.input.setStick('touch', v.x, v.y);
//   // 引いているあいだは、自機と指のあいだに線を引く(trace.finger)
//
// ## なぜ遅らせるか
//
// **指はぶれる。** ガラスの上を滑らせる指は、狙ったところで止まらないし、
// まっすぐにも動かない。そのまま行き先にすると、自機は細かく震える。
//
// 遅延ドローは**2 段構え**でそれを均す。
//
//   1. **不感の輪**(`lazyRadius`)… 狙いの点は、指から一定の距離までは
//      引っぱられない。**輪の中の震えは丸ごと無かったことになる**
//   2. **追従**(`follow`)… 輪から出たぶんも、一気には動かず割合で寄る。
//      速く払っても、狙いの点はなめらかな弧を描いて付いてくる
//
// 指を離すと、狙いの点は**最後に指がいたところ**へ寄せきってから止まる
// (離した拍子に手前で止まらない)。
//
// ## 道は残さない
//
// 前は指の通ったところを道として覚えて、あとから自機がなぞっていた。
// **引き終わるまで自機が付いてこない**ので、避けたいときに間に合わなかった。
// いまは自機そのものが筆先なので、**引いている手の下で自機が動く**。
//
// ゲームの中身は知らない。**座標系は呼ぶ側のもの**で、ここでは
// 「ドット」としか呼ばない。

/** つまみの既定。**ゲームごとに合う値が違う**ので、全部差し替えられる */
const DEFAULTS = {
  /**
   * **狙いの点が引っぱられはじめる距離**(ドット)。
   *
   * 指がこれより近いうちは、狙いの点は動かない ──
   * **輪の中の震えは丸ごと消える**。大きくするほど落ち着くが、
   * そのぶん指と自機が離れる(狭いところを抜けにくくなる)
   */
  lazyRadius: 10,
  /**
   * **輪から出たぶんを、1 コマでどれだけ詰めるか**(0〜1)。
   *
   * 1 で即(遅れなし)、小さいほどぬるりと付いてくる。
   * **0.3 あたりが、払っても暴れず、狙ったところには届く**
   */
  follow: 0.3,
  /** 狙いの点に着いたことにする近さ(ドット) */
  arrive: 3,
};

const D2R = Math.PI / 180;

/**
 * 遅延ドローの移動制御を作る。
 * @param {object} [opts] 上の DEFAULTS を部分的に差し替える
 */
export function createTrace(opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts);

  /** 'idle'(何もしていない) / 'draw'(指を置いている) / 'auto'(離したあとの寄せ) */
  let state = 'idle';
  /** いま指がいるところ(ドット) */
  let fx = 0, fy = 0;
  /** 狙いの点。**指から遅れて付いてくる**(これが自機の行き先) */
  let ax = 0, ay = 0;

  function stop() {
    state = 'idle';
  }

  return {
    get state() { return state; },
    /** いま指がいるところ。**線を引く相手**(自機から ここまで) */
    get finger() { return state === 'idle' ? null : { x: fx, y: fy }; },
    /** 狙いの点(指から遅れて付いてくる点)。中を覗くとき用 */
    get aim() { return state === 'idle' ? null : { x: ax, y: ay }; },

    /** 指が触れた。**そこが最初の狙い**(いきなり引っぱらない) */
    down(x, y) {
      fx = x; fy = y;
      ax = x; ay = y;
      state = 'draw';
    },

    /** 指が動いた。**覚えるだけ**。均すのは update の仕事 */
    move(x, y) {
      if (state !== 'draw') return;
      fx = x; fy = y;
    },

    /**
     * 指が離れた。**最後に指がいたところまでは寄せきる。**
     * ここで止めると、遅れているぶんだけ手前で止まってしまう
     */
    up() {
      if (state !== 'draw') return;
      state = 'auto';
    },

    /** 指が消えた(着信など)。離したのと同じ扱いでよい */
    cancel() { this.up(); },

    /** やめる(有効範囲の外を叩いたときなど。**呼ぶ側が決める**) */
    stop,

    /**
     * 毎コマ呼ぶ。**進む向きを単位ベクトルで返す**(止まっていれば 0)。
     * @param {number} selfX 自機のいまの場所(ドット)
     * @param {number} selfY 同上
     */
    update(selfX, selfY) {
      if (state === 'idle') return { x: 0, y: 0 };

      // ---- 1. 狙いの点を、指のほうへ遅れて寄せる ----
      const dx = fx - ax, dy = fy - ay;
      const d = Math.hypot(dx, dy);
      if (state === 'auto') {
        // 離したあとは輪を外して、最後の場所まで寄せきる
        ax += dx * o.follow;
        ay += dy * o.follow;
      } else if (d > o.lazyRadius) {
        // **輪から出たぶんだけ**を、割合で詰める。
        // 輪の中の震えはここへ来ないので、まるごと消える
        const k = ((d - o.lazyRadius) / d) * o.follow;
        ax += dx * k;
        ay += dy * k;
      }

      // ---- 2. 自機は狙いの点を向く ----
      const sx = ax - selfX, sy = ay - selfY;
      const dist = Math.hypot(sx, sy);
      if (dist <= o.arrive) {
        // 離したあとで、指のいたところまで来たら終わり
        if (state === 'auto' && d <= o.arrive) stop();
        return { x: 0, y: 0 };
      }
      const deg = Math.atan2(sy, sx) / D2R;
      const h = deg * D2R;
      return { x: Math.cos(h), y: Math.sin(h) };
    },
  };
}
