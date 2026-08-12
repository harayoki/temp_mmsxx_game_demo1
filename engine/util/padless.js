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
// ## 行き先は溜められる(道筋になる)
//
// 叩くたびに**後ろへ並ぶ**(`maxPoints` まで。既定 2)。自機は**置いた順に**
// 通っていき、着いたぶんから消えていく。先に置いたものが先に消える。
//
// 弾幕の切れ目を一手先に置いておける、というのが狙い。
// **いっぱいのときに叩いたら、いちばん古いものを捨てる。**
// 置けなくなるより、**新しく置いたほうを必ず効かせる**ほうが迷わない
// (置いたのに何も起きないのは、壊れたようにしか見えない)。
//
// 全部消したいときは、自機を叩くか、**画面の外を叩く**(呼ぶ側が stop() を呼ぶ)。
//
// **置いてある印も、つかんでずらせる**(`grabRadius` の中を押さえたとき)。
// このときは増えない — 触ったものを動かすだけ。
// 何も無いところを押さえたときだけ、新しく置かれる。
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
   * **置いてある印をつかめる近さ**(ドット)。
   * ここより近くを押さえたら、新しく置かずに**その印を動かす**。
   * 印そのもの(7 ドット)より広くしてある — 指は印より太いので、
   * 見えている絵ちょうどでしか掴めないと、まず掴めない
   */
  grabRadius: 14,
  /**
   * **溜めておける行き先の数。**
   * 増やすほど先まで引けるが、**印のぶんスプライトを食う**ので、
   * 借りる側が出せる数と揃えること。
   * **溢れたぶんは古いほうから捨てる**(下の down を見ること)
   */
  maxPoints: 2,
  /**
   * **1 秒で曲がれる上限**(度/秒)。**0 で頭打ちなし**(既定)。
   *
   * 0 のときは、いつでも行き先をまっすぐ向く。
   * **このゲームは十字でもパッドでも向きがその場で変わる**ので、
   * ここだけ乗り物のように曲がると、行き先で曲がりきれずに
   * **行き過ぎて弧を描く**(切り替わりで はっきり見えた)。
   *
   * 乗り物らしい重さが欲しいゲームでは 200〜400 あたりを入れる。
   * そのときは `passBy` も一緒に見ること —
   * **曲がれないほど、行き先のまわりを回りやすくなる**。
   * 入れるなら経った時間で掛かるので、コマ落ちしても曲がりすぎない
   */
  turnRate: 0,
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
  /**
   * **行き先の列**(ドット)。**先頭がいま向かっている先**で、
   * 着いたぶんから前から消えていく。叩いたものは後ろへ並ぶ。
   * `{ x, y, firm }` の firm は「もう指が乗っていない」
   */
  const points = [];
  /** いま進んでいる向き(度。0 が右、時計回り) */
  let heading = -90;
  /** 前のコマの行き先までの距離。**離れはじめたか**を見るためだけに持つ */
  let lastDist = Infinity;
  /** いま指でつかんでいる印の番号(-1 で何もつかんでいない) */
  let held = -1;

  function stop() {
    state = 'idle';
    lastDist = Infinity;
    held = -1;
    points.length = 0;
  }

  return {
    get state() { return state; },
    /**
     * **行き先の列**。`{ x, y, firm }` が置いた順に並ぶ。
     * **先頭がいま向かっている先**。印を出す側はこれをそのまま並べればよい。
     * 中身は書き換えないこと(触りたいときは down / move / stop から)
     */
    get points() { return points; },
    /** いま進んでいる向き(度)。印の絵を向けたいときなどに */
    get heading() { return heading; },

    /**
     * 指が触れた。**自機の場所も一緒に渡す**(止める合図かどうかを見るため)。
     * @returns {boolean} 受けたか(false なら止める合図だった)
     */
    down(x, y, selfX, selfY) {
      // **自機のまわりを叩いたら、置いたぶんを全部消して止まる**
      if (Math.hypot(x - selfX, y - selfY) <= o.stopRadius) { stop(); return false; }
      // **置いてある印の上なら、それをつかむ**(増やさない)。
      // 近いものから見る(重なっていたら、押さえたところに近いほうが取れる)
      let near = -1, best = o.grabRadius;
      for (let i = 0; i < points.length; i++) {
        const d = Math.hypot(points[i].x - x, points[i].y - y);
        if (d <= best) { best = d; near = i; }
      }
      if (near >= 0) {
        held = near;
        points[held].firm = false;
        state = 'drag';
        return true;
      }
      // 止まっているところからなら、向きはその場で合わせてよい
      // (歩いている最中は turnRate で曲がる。急に向きが飛ばないように)
      if (state === 'idle') heading = Math.atan2(y - selfY, x - selfX) / D2R;
      points.push({ x, y, firm: false });
      // **溢れたら古いほうから捨てる。** いま向かっていた先が消えるので、
      // 行き過ぎの見張りも数え直す(残っている先頭までの距離は別ものになる)
      while (points.length > o.maxPoints) { points.shift(); lastDist = Infinity; }
      // 先頭を置いたのなら、そこまでの距離を数え直す
      if (points.length === 1) lastDist = Infinity;
      held = points.length - 1;
      state = 'drag';
      return true;
    },

    /**
     * 指が動いた。**いま置いたものを引きずる**(いちばん後ろ)。
     *
     * 印だけを動かして行き先を据え置きにしたことがあったが、
     * **押さえている場所と自機の向かう先が食い違う**ので、
     * 何を動かしているのか分からなくなった。指の下が行き先。
     *
     * 途中の点は動かさない。**指の下にあるのは最後の 1 つだけ**なので、
     * ほかが付いてくると何を触ったのか分からない
     */
    move(x, y) {
      if (state !== 'drag' || held < 0 || held >= points.length) return;
      const p = points[held];
      p.x = x; p.y = y;
      // 引きずっているのが先頭なら、行き過ぎの見張りを数え直す
      if (held === 0) lastDist = Infinity;
    },

    /** 指が離れた。**行き先はそのまま**(もう指の下に置いてある) */
    up() {
      if (state !== 'drag') return;
      state = 'auto';
      if (held >= 0 && held < points.length) points[held].firm = true;
      held = -1;
    },

    /** 指が消えた(着信など)。離したのと同じ扱いでよい */
    cancel() {
      if (state !== 'drag') return;
      state = 'auto';
      if (held >= 0 && held < points.length) points[held].firm = true;
      held = -1;
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
      if (state === 'idle' || !points.length) return { x: 0, y: 0 };
      // **経った時間で掛ける。** コマが飛んでも曲がる量が変わらないように
      const dt = Math.min(100, Math.max(1, dtMs)) / 1000;

      // **先頭に着いたら、そこを捨てて次へ。** 列が空いたら止まる。
      // 重なって置かれていれば 1 コマで何個も片付くので、**回して読む**
      // (次を見に行くのに 1 コマ止まったように見えるのを避ける)
      let t = points[0];
      let dist = Math.hypot(t.x - selfX, t.y - selfY);
      for (;;) {
        // **いま指でつかんでいる先頭は捨てない。**
        // 捨てると、そのあと指をずらしても動き出せなくなる(浮いて待つ)。
        // つかんでいるのが後ろの印なら、先頭はふつうに片付けてよい
        const holding = (state === 'drag' && held === 0);
        // 行き過ぎたぶんも着いた扱い。曲がりきれずに回り続けるのを断つ
        // (上の passBy を見ること)
        const reached = dist <= o.arrive || (dist <= o.passBy && dist > lastDist);
        if (!reached) break;
        if (holding) { lastDist = dist; return { x: 0, y: 0 }; }
        points.shift();
        // **つかんでいる番号も 1 つ手前へ**(前が抜けたぶん)。
        // 0 のときはここへ来ない(上の holding で止まる)ので、正のときだけ
        if (held > 0) held--;
        lastDist = Infinity;
        if (!points.length) { stop(); return { x: 0, y: 0 }; }
        t = points[0];
        dist = Math.hypot(t.x - selfX, t.y - selfY);
      }
      lastDist = dist;

      // 行き先を向く。**頭打ちが無ければ、その場でまっすぐ向く**
      const want = Math.atan2(t.y - selfY, t.x - selfX) / D2R;
      if (o.turnRate > 0) {
        // 頭打ちがあるときだけ、少しずつ寄せる(経った時間で掛ける)
        const off = wrapDeg(want - heading);
        const cap = o.turnRate * dt;
        heading = wrapDeg(heading + (Math.abs(off) <= cap ? off : Math.sign(off) * cap));
      } else {
        heading = want;
      }
      const h = heading * D2R;
      return { x: Math.cos(h), y: Math.sin(h) };
    },
  };
}
