// **パッドレスの移動制御。** 画面を叩いた先へ自機が自分で歩いていく。
// 押したまま指をずらすと、行き先ごと引きずって動かせる。
//
//   const move = createPadless();
//   // 指を受けたら(**ゲームのドットで**渡すこと。画面の点は vdp.pointToScreen で戻す)
//   move.down(x, y, selfX, selfY); move.move(x, y); move.up();
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
// ## 押したままずらすと、行き先ごと動く
//
// 叩いた場所が行き先。**押さえたままずらせば、行き先もそこへ付いてくる**ので、
// 弾をよけながら寄せ先を変えられる(叩き直さなくてよい)。
// 指を離しても、そのときの場所が行き先として残る。
//
// **向きは一気に変えない**(`turnRate`)。行き先が真後ろへ回っても、
// 自機はその場で裏返らずに回り込む。
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
   * **1 秒で曲がれる上限**(度/秒)。
   * **コマ落ちしても曲がりすぎないように**、経った時間で掛ける。
   * 上げるほど指なりに曲がるが、上げすぎると真後ろへもその場で裏返る
   */
  turnRate: 300,
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

  /** 'idle'(止まっている) / 'auto'(行き先へ歩く) / 'drag'(押さえたまま引きずっている) */
  let state = 'idle';
  /** 行き先(ドット) */
  let tx = 0, ty = 0;
  /** いま進んでいる向き(度。0 が右、時計回り) */
  let heading = -90;
  /** 前のコマの行き先までの距離。**離れはじめたか**を見るためだけに持つ */
  let lastDist = Infinity;
  /** 印。**行き先そのもの**を指す(firm=false は まだ指が乗っている) */
  const marker = { on: false, x: 0, y: 0, firm: false };

  /** 行き先を置き直す。**印も必ず一緒に動かす**(食い違わせない) */
  function aimAt(x, y) {
    tx = x; ty = y;
    marker.x = x; marker.y = y;
    lastDist = Infinity;
  }

  function stop() {
    state = 'idle';
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
      // **自機のまわりを叩いたら止まる**(行き先にしない)
      if (Math.hypot(x - selfX, y - selfY) <= o.stopRadius) { stop(); return false; }
      // 止まっているところからなら、向きはその場で合わせてよい
      // (歩いている最中は turnRate で曲がる。急に向きが飛ばないように)
      if (state === 'idle') heading = Math.atan2(y - selfY, x - selfX) / D2R;
      aimAt(x, y);
      state = 'drag';
      marker.on = true; marker.firm = false;
      return true;
    },

    /**
     * 指が動いた。**行き先ごと引きずる。**
     *
     * 印だけを動かして行き先を据え置きにしたことがあったが、
     * **押さえている場所と自機の向かう先が食い違う**ので、
     * 何を動かしているのか分からなくなった。指の下が行き先
     */
    move(x, y) {
      if (state !== 'drag') return;
      aimAt(x, y);
    },

    /** 指が離れた。**行き先はそのまま**(もう指の下に置いてある) */
    up() {
      if (state !== 'drag') return;
      state = 'auto';
      marker.firm = true;
    },

    /** 指が消えた(着信など)。離したのと同じ扱いでよい */
    cancel() {
      if (state !== 'drag') return;
      state = 'auto';
      marker.firm = true;
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
      const dist = Math.hypot(tx - selfX, ty - selfY);

      // 着いた。**押さえているあいだは止めずに浮いて待つ**
      // (止めてしまうと、そのあと指をずらしても動き出せない)
      if (dist <= o.arrive) {
        if (state === 'drag') { lastDist = dist; return { x: 0, y: 0 }; }
        stop();
        return { x: 0, y: 0 };
      }
      // **行き過ぎたら、そこで止める。** 曲がりきれずに回り続けるのを断つ
      // (上の passBy を見ること)
      if (dist <= o.passBy && dist > lastDist) {
        if (state === 'drag') { lastDist = dist; return { x: 0, y: 0 }; }
        stop();
        return { x: 0, y: 0 };
      }
      lastDist = dist;

      // 行き先へ向きを寄せる。**その場では飛ばさない**(コマ落ちでも同じ)
      const want = Math.atan2(ty - selfY, tx - selfX) / D2R;
      const off = wrapDeg(want - heading);
      const cap = o.turnRate * dt;
      heading = wrapDeg(heading + (Math.abs(off) <= cap ? off : Math.sign(off) * cap));
      const h = heading * D2R;
      return { x: Math.cos(h), y: Math.sin(h) };
    },
  };
}
