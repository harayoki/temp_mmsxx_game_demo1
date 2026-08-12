// **パッドレスの移動制御。** 画面を叩いた先へ自機が自分で歩いていく。
// 押したまま指をずらすと、進む角度を左右へ曲げられる。
//
//   const move = createPadless();
//   // 指を受けたら(**ゲームのドットで**渡すこと。画面の点は vdp.pointToScreen で戻す)
//   move.down(x, y); move.move(x, y); move.up(x, y);
//   // 毎コマ
//   const v = move.update(player.x, player.y, dtMs);
//   mmsxx.input.setStick('touch', v.x, v.y);
//   if (move.marker.on) 印を置く(move.marker.x, move.marker.y);
//
// ## 十字と何が違うか
//
// **指の向きをそのまま移動の向きにしない。** 十字は「どちらへ倒したか」を
// 毎コマ読むので、指は動かし続けることになる。こちらは**行き先だけ**を渡して、
// あとは自機にまかせる。指は画面から離してよい。
//
// 撃つのが自動なら、**両手とも移動に使える**(左右どちらの指で叩いてもよい)。
//
// ## 押したままずらすと曲がる
//
// 行き先を決め直すには叩き直せばよいが、**弾をよけながらだと間に合わない**。
// そこで、押したまま指をずらしているあいだは、
// 進んでいる向きに対して**横へどれだけ外れているか**だけを見て角度を曲げる。
//
// **前へ進む力はこちらで保つ**(指を後ろへ引いても下がらない)。
// 指を離したら、その場所を新しい行き先にする。ただし**前方に限る** —
// 後ろを指していたら、前方の縁まで押し出す。
//
// ゲームの中身は知らない。**座標系は呼ぶ側のもの**で、ここでは
// 「ドット」としか呼ばない(向きの符号だけ、下が + であることを前提にしている)。

/** つまみの既定。**ゲームごとに合う値が違う**ので、全部差し替えられる */
const DEFAULTS = {
  /** 行き先にどれだけ近づいたら着いたことにするか(ドット) */
  arrive: 4,
  /**
   * **行き過ぎたと見なす距離**(ドット)。
   * ここまで近づいたあと**離れはじめたら**、着いたことにして止める。
   *
   * 曲がれる速さには上限があるので、**旋回半径より内側で行き先を外すと
   * もう届かず、そのまわりを回り続ける**(半径 = 速さ ÷ 旋回の速さ。
   * 2px/コマ・5°/コマなら 23 ドットほど)。距離を詰めるだけでは直らない —
   * 近いほど曲がりきれないので、外したことに気づいて止めるしかない
   */
  passBy: 28,
  /**
   * **自機のまわりを叩いたら止まる**(ドット)。
   * 止めかたが要る(撃つ場所を選びたい・その場で粘りたい)ので、
   * **いちばん押しやすいところ = 自機そのもの**を止める合図にする
   */
  stopRadius: 12,
  /**
   * **操舵の効き**(度/秒。横へ目いっぱい外れているときの曲がる速さ)。
   * 上げるほど指なりに曲がるが、**指の震えでふらつく**
   */
  steerRate: 180,
  /**
   * **1 秒で曲がれる上限**(度/秒)。行き先を叩き直したときにも効く。
   * **コマ落ちしても曲がりすぎないように**、経った時間で掛ける
   */
  turnRate: 300,
  /**
   * **ひと押しで曲げられる上限**(度)。
   * これがないと、押したまま指を回すだけで真後ろを向けてしまう
   */
  maxSteer: 110,
  /**
   * 指を離したとき、**前方と認める広さ**(度。進んでいる向きから片側へ)。
   * ここを外れた行き先は、縁まで戻される
   */
  forwardDeg: 80,
  /** 後ろを指していたときに、前へ押し出す距離(ドット) */
  minAhead: 32,
  /** 指のずれをここから見る(ドット)。**置いただけでは曲げない** */
  deadzone: 3,
};

const D2R = Math.PI / 180;

/** -180〜180 に畳む(度) */
function wrapDeg(d) {
  return ((d + 180) % 360 + 360) % 360 - 180;
}

/**
 * パッドレスの移動制御を作る。
 * @param {object} [opts] 上の DEFAULTS を部分的に差し替える
 */
export function createPadless(opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts);

  /** 'idle'(止まっている) / 'auto'(行き先へ歩く) / 'steer'(押したまま曲げている) */
  let state = 'idle';
  /** 行き先(ドット) */
  let tx = 0, ty = 0;
  /** いま進んでいる向き(度。0 が右、時計回り) */
  let heading = -90;
  /** 指のいまの場所(steer のあいだだけ意味がある) */
  let fx = 0, fy = 0;
  /** ひと押しで曲げたぶんの合計(度)。maxSteer の頭打ちに使う */
  let steered = 0;
  /** 前のコマの行き先までの距離。**離れはじめたか**を見るためだけに持つ */
  let lastDist = Infinity;
  /** 印。firm=false は「まだ指が乗っている(仮)」 */
  const marker = { on: false, x: 0, y: 0, firm: false };

  /**
   * 自機から見て、その点は前方か。前方でなければ縁まで戻した点を返す。
   *
   * @param {boolean} firm **確定するときだけ true**。
   *   最小前進距離(`minAhead`)を効かせるのはこのときだけにする。
   *   仮の印にも効かせていたことがあり、**自機が指へ近づくほど印が前へ
   *   逃げていった**(指を押さえたままなのに印が動く)。
   *   最小前進が要るのは「離した先が近すぎて、置いた瞬間に着いた扱いで
   *   止まってしまう」のを避けるためで、押さえているあいだには要らない
   */
  function clampForward(sx, sy, px, py, firm) {
    let dx = px - sx, dy = py - sy;
    let dist = Math.hypot(dx, dy);
    // 向きが取れないほど重なっているときだけ、進んでいる向きへ出す
    if (dist < 0.001) {
      dx = Math.cos(heading * D2R); dy = Math.sin(heading * D2R);
      dist = firm ? o.minAhead : 0.001;
      return { x: sx + dx * dist, y: sy + dy * dist };
    }
    const deg = Math.atan2(dy, dx) / D2R;
    const off = wrapDeg(deg - heading);
    if (Math.abs(off) <= o.forwardDeg) {
      // 前方。**そのままの場所**。近くても押し出さない(印が指から逃げる元だった)
      if (firm && dist < o.minAhead) {
        const k = o.minAhead / dist;
        return { x: sx + dx * k, y: sy + dy * k };
      }
      return { x: px, y: py };
    }
    // 前方の縁まで戻す(**距離はそのまま**。行きたかった遠さは残す)
    const d = firm ? Math.max(dist, o.minAhead) : dist;
    const edge = (heading + Math.sign(off) * o.forwardDeg) * D2R;
    return { x: sx + Math.cos(edge) * d, y: sy + Math.sin(edge) * d };
  }

  function stop() {
    state = 'idle';
    steered = 0;
    lastDist = Infinity;
    marker.on = false;
    marker.firm = false;
  }

  return {
    get state() { return state; },
    get marker() { return marker; },
    /** いま進んでいる向き(度)。印の絵を向けたいときなどに */
    get heading() { return heading; },

    /**
     * 指が触れた。**自機の場所も一緒に渡す**(止める合図かどうかを見るため)。
     * @returns {boolean} 受けたか(false なら止める合図だった)
     */
    down(x, y, selfX, selfY) {
      fx = x; fy = y;
      // **自機のまわりを叩いたら止まる**(行き先にしない)
      if (Math.hypot(x - selfX, y - selfY) <= o.stopRadius) { stop(); return false; }
      // 止まっているところからなら、向きはその場で合わせてよい
      // (歩いている最中は turnRate で曲がる。急に向きが飛ばないように)
      if (state === 'idle') heading = Math.atan2(y - selfY, x - selfX) / D2R;
      tx = x; ty = y;
      state = 'steer';
      steered = 0;
      lastDist = Infinity;
      marker.on = true; marker.firm = false;
      marker.x = x; marker.y = y;
      return true;
    },

    /** 指が動いた。**曲げるのは update の中**(経った時間で掛けるため) */
    move(x, y) {
      if (state !== 'steer') return;
      fx = x; fy = y;
    },

    /** 指が離れた。**そこを新しい行き先にする**(前方に限る) */
    up(selfX, selfY) {
      if (state !== 'steer') return;
      // **確定するときだけ最小前進を効かせる**(firm = true)
      const at = clampForward(selfX, selfY, fx, fy, true);
      tx = at.x; ty = at.y;
      state = 'auto';
      steered = 0;
      lastDist = Infinity;
      marker.on = true; marker.firm = true;
      marker.x = tx; marker.y = ty;
    },

    /** 指が消えた(着信など)。**行き先はそのまま**、曲げるのだけやめる */
    cancel() {
      if (state !== 'steer') return;
      state = 'auto';
      lastDist = Infinity;
      marker.firm = true; marker.x = tx; marker.y = ty;
    },

    /** 止める(有効範囲の外を叩いたときなど。**呼ぶ側が決める**) */
    stop,

    /**
     * 毎コマ呼ぶ。**進む向きを単位ベクトルで返す**(止まっていれば 0)。
     * @param {number} selfX 自機のいまの場所(ドット)
     * @param {number} selfY 同上
     * @param {number} [dtMs] 前のコマからの時間(ms)。既定は 60 コマ/秒ぶん
     */
    update(selfX, selfY, dtMs = 1000 / 60) {
      if (state === 'idle') return { x: 0, y: 0 };
      // **経った時間で掛ける。** コマが飛んでも曲がる量が変わらないように
      const dt = Math.min(100, Math.max(1, dtMs)) / 1000;

      if (state === 'steer') {
        const vx = fx - selfX, vy = fy - selfY;
        const len = Math.hypot(vx, vy);
        // **仮の印は指のところ**(前方の外へ出たときだけ縁へ寄せる)。
        // 最小前進は効かせない — 効かせていたころは、自機が近づくほど
        // 印が前へ逃げていった(指は押さえたままなのに印が動く)
        const at = clampForward(selfX, selfY, fx, fy, false);
        marker.x = at.x; marker.y = at.y;
        // **指のところまで来たら、そこで浮いて待つ。**
        // 押さえているあいだも前へ進み続ける作りにしていたので、
        // 指を追い越しては戻りを繰り返していた。指をずらせばまた動き出す
        if (len <= o.arrive) return { x: 0, y: 0 };
        if (len >= o.deadzone) {
          const h = heading * D2R;
          // 進んでいる向きの**真横**(右が +)
          const px = -Math.sin(h), py = Math.cos(h);
          const nx = vx / len, ny = vy / len;
          // 横へどれだけ外れているか(-1〜1)と、前後どちらにいるか
          let lat = nx * px + ny * py;
          const fwd = nx * Math.cos(h) + ny * Math.sin(h);
          // **後ろにいるときは目いっぱい曲げる。** 真後ろは横の成分が 0 に
          // なってしまい、そのままでは曲がれなくなる(そこだけ効かない穴になる)
          if (fwd < 0) lat = (lat >= 0 ? 1 : -1);
          let turn = lat * o.steerRate * dt;
          // ひと押しで曲げられるぶんの残り
          const room = o.maxSteer - Math.abs(steered);
          if (room <= 0) turn = 0;
          else if (Math.abs(turn) > room) turn = Math.sign(turn) * room;
          // 1 コマで曲がれる上限
          const cap = o.turnRate * dt;
          if (Math.abs(turn) > cap) turn = Math.sign(turn) * cap;
          heading = wrapDeg(heading + turn);
          steered += turn;
        }
      } else {
        // 行き先へ向きを寄せる。**その場では飛ばさない**(コマ落ちでも同じ)
        const want = Math.atan2(ty - selfY, tx - selfX) / D2R;
        const off = wrapDeg(want - heading);
        const cap = o.turnRate * dt;
        heading = wrapDeg(heading + (Math.abs(off) <= cap ? off : Math.sign(off) * cap));
        // 着いたら止まる
        const dist = Math.hypot(tx - selfX, ty - selfY);
        if (dist <= o.arrive) { stop(); return { x: 0, y: 0 }; }
        // **行き過ぎたら、そこで止める。** 曲がりきれずに回り続けるのを断つ
        // (上の passBy を見ること)
        if (dist <= o.passBy && dist > lastDist) { stop(); return { x: 0, y: 0 }; }
        lastDist = dist;
      }
      const h = heading * D2R;
      return { x: Math.cos(h), y: Math.sin(h) };
    },
  };
}
