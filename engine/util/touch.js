// **タッチ操作**の GUI(画面の上の十字とショット)。**DOM だけで作る**。
// canvas には何も描かない。設計は docs/SMARTPHONE.md の 3〜5 節と 8 節。
//
// **ゲームパッドはここではない。** あちらは engine/util/gamepad.js。
// 送る種別も touch / pad で分かれている(docs/TODO.md の O 章)。
//
//   import { TouchControls } from './engine/util/touch.js';
//
//   const touch = new TouchControls({
//     onPress:   (code, source) => mmsxx.input.press(code, source),
//     onRelease: (code, source) => mmsxx.input.release(code),
//   });
//   touch.attach(document.body);
//
// ## エンジンにも game にも依存しない
//
// ここは**押した / 離したを呼び出し側へ知らせるだけ**。Input も mmsxx も触らない。
// SMARTPHONE.md の 10 節では `new TouchControls(mmsxx, ...)` と書いてあるが、
// 通知にしたので mmsxx は要らなくなった。繋ぐのは呼び出し側の仕事。
//
// ## 押されたときの「何で押したか」
//
// onPress の第 2 引数に **かならず 'touch'** を載せる。受け取る側は素通しすればよい:
//
//   onPress: (code, source) => mmsxx.input.press(code, source),
//
// こうすると繋ぐ側が種別を書く判断をしないので、**付け忘れが起きない**。
// 'touch' という文字列を持っているのはこのファイルの SOURCE 1 か所だけ。
// TODO: ランキングの窓口(markInputSource)へ繋ぐのは game/main.js 側。
//   docs/TODO.md の O 章。組み込みのときに一緒にやる
//
// ## つまみ(手触りを詰めるための値)
//
// **すべて setOptions() で動かしたまま変えられる。** 遊んでいる最中でもよい。
// ゲームの設定画面から触らせることを想定している:
//
//   touch.setOptions({ deadzone: 8, shotStep: 20 });   // いつ呼んでもよい
//
// **場所と大きさはここにはない。** 渡した DIV の大きさがそのままエリアになるので、
// 広さを変えたいときは DIV の側を変える(部品は中身を作るだけ)。
// touch-tool/ で実機で触って決め、値をここの既定値に書き戻すこと。
//
// **いまの既定値は 2026-08-09 に iPhone で詰めたもの。** 連射は少し頑張って
// 10 発/秒、すごく頑張って 12 発/秒あたりに落ち着く。

/** setSkin() の名前と、それを流し込む CSS の変数 */
const SKIN_VARS = {
  fire: '--fire-img', firePressed: '--fire-img-on',
  shotArea: '--shotarea-img', knob: '--knob-img', ring: '--ring-img',
};

/** 押されたと知らせるときの種別。**ここ 1 か所だけ** */
const SOURCE = 'touch';

/** 8 方向。角度の区画(45 度ずつ)の順に、立てるキーを並べたもの */
const SECTOR_KEYS = [
  ['ArrowRight'],                 // 0:   0 度(右)
  ['ArrowRight', 'ArrowDown'],    // 1:  45
  ['ArrowDown'],                  // 2:  90(下。画面の y は下向き)
  ['ArrowLeft', 'ArrowDown'],     // 3: 135
  ['ArrowLeft'],                  // 4: 180
  ['ArrowLeft', 'ArrowUp'],       // 5: 225
  ['ArrowUp'],                    // 6: 270
  ['ArrowRight', 'ArrowUp'],      // 7: 315
];

const DEFAULTS = {
  // **判定の大きさだけをまとめて伸び縮みさせる。見た目は変わらない。**
  // 画面が大きいほど指の動きも大きくなるので、同じ px のままだと
  // 小さい画面では敏感すぎ、大きい画面では鈍くなる。
  // いまの手元の端末を 1 として、0.7 なら小さい画面向け、1.5 なら大きい画面向け。
  // TODO: 方向が見えたら、画面の解像度から自動で決めるようにする
  scale: 1,
  // これ未満しか動いていなければ無入力(px。scale が掛かる)。
  // **ここだけ広げても直らない。**
  // 実機(iPhone)で 9 → 18 → 24 と広げてみたが、24 では「動かしたいのに
  // 動かない」ほうが強く出た。「指を置いているだけで動く」より手に障る。
  //
  // **この値だけを動かして詰めようとしないこと。** 止まりにくさは
  // guiRadius(絵と当たりの大きさ)や scale(判定の伸び縮み)、
  // 十字の置き場所とも絡んでいる。触るときは組み合わせで見ること
  //
  // **2 まで狭めてある**(いちど 8 まで広げてから戻した)。
  // 広げていたのは、原点のそばで全速の向きが立つと震えを拾うためだったが、
  // stickCurve を掛けたいまは**そばでは這うようにしか出ない**ので、
  // 震えを拾っても目に見えるほど動かない。
  // **完全に止まる必要は無い**(止まらなくても、めちゃ低速なら寄せられる)ので、
  // そのぶんを細かさに回している
  deadzone: 2,
  /**
   * これより離れたら**原点を引きずる**(px)。0 で引きずらない。
   *
   * **戻す量に頭を付けるためのつまみ。** 0 のままだと、右へ 200px 出した
   * ところから左へ行くのに 200px 戻すことになる。行き過ぎたぶんが
   * そのまま戻す手間になるので、**狙いを越すたびに行きつ戻りつする**。
   * 指の流れる 'move' はこれを避けられるが、こんどは原点が無いので
   * 指がどこまでも流れていく。
   *
   * 引きずると、**指は原点から 30px より離れない**。逆を向かせるのに
   * 要るのはいつも 34px で、どれだけ大きく動かしたあとでも変わらない。
   * 向きは原点からの角度のままなので、'move' と違って
   * **指を止めても倒したままでいてくれる**(STG はこちらが要る)。
   *
   * **stickFullDist(24)より大きくすること。** 下回ると全開に届かなくなる
   * (指が原点から離れられる上限のほうが、全開になる距離より近くなる)。
   * 大きくするほど戻す量も増えるので、**全開の距離のすぐ上**に置いてある
   */
  dragMax: 30,
  /**
   * **向きの決めかた。** ゲームによって合う合わないがあるので、丸ごと替えられる。
   *
   *   'origin' … **触れたところからの向き**(既定)。スティックを倒しているのに近い。
   *              倒した向きを保てるので、まっすぐ走り続ける遊びに向く。
   *              **弱点は折り返し。** 右へ 60px 出したところから左へ行くには、
   *              原点をまたぐまでの 60px を戻さないと左が立たない
   *   'move'   … **いま指が動いている向き**をそのまま読む。
   *              折り返しはその場でつながり、**指を止めれば止まる**。
   *              避けゲーのように、細かく行き来する遊びに向く
   *
   * どちらが良いかは遊びしだいなので、替えられるようにしてある
   * (tools/touch-tool/ で実機で触って選ぶ)
   */
  stickMode: 'origin',
  /**
   * ('move' のとき)**指の速さのならしかた**(ms)。
   * 小さいほど指なりに機敏だが、震えを拾って向きがばたつく。
   * 大きいほど落ち着くが、折り返しがもたつく
   */
  stickSmoothMs: 40,
  /**
   * ('move' のとき)**これより遅ければ止まっていることにする**(px/ms)。
   * 0.03 で秒速 30px ほど。指を置いたままでも、わずかな震えでは向きが立たない。
   * **少し敏感めにしてある。** 大きく動かしているあいだ自機が指から遅れていく
   * ので、動かしはじめを拾えないぶんがそのまま置いていかれる差になる
   */
  stickMinSpeed: 0.03,
  /**
   * ('move' のとき)**これだけ速ければ、いっぱいに倒したことにする**(px/ms)。
   * 倒し量(strength)を作るためだけの値で、
   * **8 方向のキーには関わらない**(あちらは向きだけ見る)。
   * 0.10 で秒速 100px ほど — **指をほんの少し動かせば もう全速**。
   *
   * **小さく動かしたぶんを増幅するためのつまみ。** ここを高くすると、
   * ゆっくり動かしているあいだ自機がもたついて指から離れていく。
   * 低くするほど機敏になるが、下げすぎると倒し量の刻みが無くなって
   * 入 / 切 と変わらなくなる(stickMinSpeed との差が幅になる)
   */
  stickFullSpeed: 0.10,
  /**
   * ('move' のとき)**倒し量の上限**。
   *
   * **1 のまま = 自機の最高速は上がらない。** 速く払っても、自機はいつもの
   * 最高速までしか出ない(指のほうが速いので、そこは置いていかれる)。
   *
   * 1 より大きくすると最高速そのものが上がるが、**キーボードは常に 1** なので
   * 指だけ速くなる。記録の公平さに触るので、上げるなら承知のうえで
   */
  stickMaxPower: 1,
  /**
   * ('origin' のとき)**原点からこれだけ離したら、いっぱいに倒したことにする**(px)。
   * 0 なら絵の大きさから決める(半径の 1.2 倍)。
   *
   * 小さいほど「ちょっと倒せば全速」。**dragMax とは別**にしてある —
   * あちらは原点を引きずりはじめる距離で、役目が違う。
   *
   * **24 = 指を少し転がせば全速。** 0(絵の大きさ任せ)だと手元の端末で
   * 73px になり、指を 20px 動かしても強さが 0.22 にしかならなかった。
   * 自機が指のうしろを追ってくるので、**慣性が付いているように感じる**。
   *
   * いちど 14 まで詰めて「触れたらすぐ全速」にしたが、こんどは
   * **速いか止まっているかの 2 つしか無くなって、寄せられなくなった**。
   * 24 まで戻したうえで、**あいだの割りふりは下の stickCurve に任せる**
   * (手前は這うくらい、終わりで一気に立つ)。
   * **この 2 つは組で見ること。** 片方だけ動かすと釣り合いが崩れる
   */
  stickFullDist: 24,
  /**
   * ('origin' のとき)**倒し量の効きぐあいの曲がりかた**。1 で直線(既定)。
   *
   * 不感帯を 0、`stickFullDist` を 1 とした値を、この数で累乗する。
   *
   *   1 より小さい … **最初に一気に立ち上がって、あとは伸びない**。
   *                  ちょっと動かせばもう速いので**クイックに感じる**。
   *                  そのぶん全開までの距離を長く取れるので、
   *                  **上のほうに細かさが残る**(0.45 で 1/8 動かせば 3 割出る)
   *   1 より大きい … 手前がゆるく、終わりで一気に立つ。
   *                  細かく寄せたいとき向きだが、**動かしはじめがもたつく**
   *
   * **2.5 = 手前は這う、終わりで一気に立つ。** 原点から 8px で 0.04、
   * 16px で 0.32、24px で全速。**寄せたいときは手前で、逃げたいときは
   * 一気に**、が同じ 24px の中に入る。
   *
   * **「ぴたりと止まる」ことはこれでは作れない。** 止まるかどうかを
   * 決めているのは不感帯と dragMax(原点をどれだけ引きずるか)で、
   * 曲線は**倒しているあいだの速さの割りふり**しか変えない。
   * ここで作れるのは「止まる」ではなく「這うほど遅い」まで
   */
  stickCurve: 2.5,
  /**
   * ('origin' のとき)**これだけ開いたら折り返したと決める**(度。0 で切)。
   *
   * いま出している向きと、指が動いている向きの開き。
   * 越えたら**原点を指の向こう側へ置き直す**ので、指の場所がまだ前の向きを
   * 指していても、その場で逆を向く(`_flipOrigin` を見ること)。
   *
   * 145 度は「まっすぐ戻しにきたとき」だけ。120 度では早すぎた
   * (狙って曲げただけで裏返る)。**90 度まで下げると、円を描くように
   * 動かしただけで裏返る**ので、下げるなら少しずつ。
   * **遊ぶ人が選べる**(ポーズ中の TURN BACK。game/main.js の PAD_FLIP)
   */
  stickFlipAngle: 145,
  /**
   * ('origin' のとき)**折り返しと見なすのに要る 1 回ぶんの動き**(px)。
   *
   * 指を置いたままの震えでは向きが裏返らないようにするための下限。
   * **ならした速さではなく、pointermove 1 回ぶんの生の動きを見る**ので、
   * 折り返しに気づくのが 1 回で済む(理由は `_flipOrigin` を見ること)。
   * 上げるほど、ゆっくり戻したときに昔どおり原点をまたぐまで待たされる
   */
  stickFlipMove: 6,
  hysteresis: 7,       // 区画の境目の重なり(度)。ばたつき止め
  guiRadius: 72,       // PAD の大きさ(px)。**入れ物が測れないときだけ**使う。
                       // ふだんは下の areaRatio から決まる
  // **入れ物の幅の何割を絵にするか。** 狭いエリアでは小さく、広いエリアでは大きく。
  // 指の大きさは端末によらず同じなので、広いところで小さいままだと押しにくい
  areaRatio: 0.8,
  /**
   * **大きさを決めるのに使う幅**(px)。0 なら入れ物の幅をそのまま使う(既定)。
   *
   * 入れ物をゲーム画面へかぶせて広げると、そのぶん絵まで育ってしまう。
   * **広げたのは指を受けるためで、絵を大きくしたいわけではない**ので、
   * かぶせる前の幅をここへ渡せば、絵の大きさは据え置きになる
   * (置き場所は入れ物の真ん中のままなので、かぶせたぶんは横へ寄る)
   */
  areaWidth: 0,
  minRadius: 44,       // これより小さくはしない(指で押せなくなる)
  maxRadius: 120,      // これより大きくはしない(px での歯止め)
  /**
   * **指の大きさは端末によらない**ので、上限は本当は長さで考えたい。
   * ドット数で決めると、画面の広いタブレットでボタンだけ巨大になる。
   *
   * CSS の px は **1/96 インチ**と決まっているので、mm から px が出せる。
   * 実際の端末では見かけの大きさが多少ずれるが、桁は合う。
   * 22mm は親指の腹より少し大きいくらい(差し渡しで 44mm)
   */
  maxRadiusMm: 22,
  shotMode: 'D',       // 'D' 往復(既定) / 'A' 区画割り / 'B' 移動量 / 'C' 出入り。
                       // 既定は D。ほかもゲームによっては使えるので残してある
  shotStep: 14,        // D なら折り返しと認める距離、A なら区画の一辺、B なら 1 発ぶんの移動量(px)
  holdRepeatMs: 0,     // 長押しの連射間隔(ms)。**0 で無し**(連射は腕前のまま)
  /**
   * **指を置いているあいだ、キーを押しっぱなしにするか。**
   *
   * true にすると、こすり打ちが**キーボードのボタンと同じ土俵**に乗る。
   * 置いたままなら「押しっぱなし」、こすればそのぶん押し直し、になる。
   * ゲーム側が押しっぱなしに何をさせるか(ゆっくりの自動連射など)は
   * ゲームの決めごとなので、**ここでは間隔を持たない**
   * (holdRepeatMs はこちらで間隔を決めてしまうので、別のもの)。
   *
   * false(既定)は今までどおり、触れた 1 発とこすったぶんだけ。
   * **'C'(出入り)には効かない**。あちらはもともと押しっぱなしで動く
   */
  holdFire: false,
  /**
   * **触っていないあいだ、キーを押しっぱなしにするか**(holdFire の逆)。
   *
   * true にすると、**何もしていないときが「撃っている」**になる。
   *
   *   指を置いていない … 押しっぱなし(ゲーム側のゆっくりの自動連射)
   *   置いて動かさない … 撃たない(**止めるために触る**)
   *   こする          … そのぶん押し直す(今までどおり)
   *
   * 撃ちっぱなしが基本の遊びで、**撃たないことのほうが珍しい**ときに向く。
   * 指はふだん自由で、止めたいときだけ置けばよい。
   * **holdFire より優先する**(同時に立てても、こちらが勝つ)
   */
  idleFire: false,
  /**
   * **十字の絵を、触れたところへ出すか**(既定)。
   *
   * false にすると据え置きの場所(_anchor)へ出る。出る場所が毎回変わると
   * 目で探すことになる、という理由で一度は据え置きにしていたが、
   * 実機では**親指を置いた先に出てくれるほうが早い**
   */
  stickAtTouch: true,
  shotCode: 'Space',
  pauseCode: 'Escape',
};

/**
 * エリアにさりげなく出す文言。**画面に出る文字なので既定は英語**。
 * 日本語にしたいゲームは labels で丸ごと差し替える
 */
const LABELS = {
  dpadTitle: 'D-PAD',
  dpadNote: 'DRAG TO MOVE',
  dpadCallout: 'DRAG ME',   // 一度でも触れば消える誘い文句
  shotTitle: 'SHOT',
  shotNote: 'RUB TO FIRE',
  shotCallout: 'SCRUB ME',   // 一度でも触れば消える誘い文句
  pause: 'PAUSE',
};

export class TouchControls {
  /**
   * @param {{
   *   onPress?:   (code:string, source:string) => void,
   *   onRelease?: (code:string, source:string) => void,
   *   scale?: number, deadzone?: number, dragMax?: number,
   *   hysteresis?: number, guiRadius?: number,
   *   shotMode?: string, shotStep?: number,
   *   holdRepeatMs?: number, shotCode?: string, pauseCode?: string,
   *   toLocal?: (x:number, y:number) => number[],
   *   labels?: object,   エリアに出す文言(既定は英語)
   *   skin?: object,     差し替える絵(既定は何も出さない)
   * }} [opts]
   */
  constructor(opts = {}) {
    this.onPress = opts.onPress || null;
    this.onRelease = opts.onRelease || null;
    /**
     * **倒している向きと強さを知らせる先**(x, y。どちらも -1〜1)。
     * 8 方向のキーとは**別の口**で、遊びの最中の移動に使う。
     * 倒すのをやめたら (0, 0) が来る。
     *
     *   onStick: (x, y) => mmsxx.input.setStick('touch', x, y),
     */
    this.onStick = opts.onStick || null;
    /**
     * 画面の座標を、パッドを載せている入れ物の座標へ移す。
     * **画面を 90 度回して見せているときに要る**(SMARTPHONE.md 7 節)。
     * 置きかたを知っているのは呼び出し側なので、変換も呼び出し側から渡す。
     * null なら回っていない(そのまま使う)。あとから差し替えてよい
     */
    this.toLocal = opts.toLocal || null;
    /** つまみ。setOptions() で書き換える */
    this.opts = { ...DEFAULTS, ...opts };
    /** 文言。**渡されたぶんだけ差し替える**(全部書かなくてよい) */
    this.labels = { ...LABELS, ...(opts.labels || {}) };
    /** 差し替えた絵。付け直したときに戻すために覚えておく */
    this.skin = { ...(opts.skin || {}) };

    /** いま押していることになっている code */
    this.down = new Set();
    /** pointerId ごとの担当。**途中で入れ替えない**(SMARTPHONE.md 8 節) */
    this.pointers = new Map();

    /** 相対十字の様子(touch-tool が読む) */
    // vx / vy / speed は 'move' のときの、ならした指の速さ(px/ms)
    // rx / ry は**外へ知らせた向きと強さ**(_reportStick が入れる)。針もこれを見る
    this.stick = { active: false, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0, dist: 0, deg: 0, sector: -1,
      vx: 0, vy: 0, speed: 0, rx: 0, ry: 0 };
    /** ('move' のとき)最後に速さを測った時刻 */
    this._sampleAt = 0;
    /** ('move' のとき)指が止まったことに気づくための見張り */
    this._coast = 0;
    /** こすり打ちの様子(touch-tool が読む) */
    this.rub = { pressCount: 0, releaseCount: 0, move: 0, rate: 0, maxRate: 0, cell: '', turns: 0 };

    /** 借りている入れ物(十字・ショットの順) */
    this._zones = [];
    /** 実際に使っている大きさ。入れ物が狭ければ guiRadius より小さくなる */
    this._r = this.opts.guiRadius;
    /** 入れ物の大きさが変わったら測り直す。**次の描き替えまで待つ**
        (resize は途中の大きさでも飛んでくる) */
    this._onResize = () => {
      if (this._resizeWait) return;
      this._resizeWait = requestAnimationFrame(() => {
        this._resizeWait = 0;
        this._applyLayout();
      });
    };
    this._resizeWait = 0;
    this._dpad = this._shot = this._fire = this._pause = this._knob = this._stickEl = null;
    this._needle = this._cap = null;
    /** 指を受けるだけの入れ物(絵は持たない)。attach で渡されたときだけ */
    this._dpadCatch = this._shotCatch = null;
    /** 1 コマだけ押すための仕掛け */
    this._pulseDown = new Set();
    this._pulseQueue = new Map();
    this._pulseRaf = 0;
    /** 直近の発射の時刻(1 秒あたりの連射数を出すため) */
    this._shotTimes = [];
    /** 長押しの見張り */
    this._holdTimer = 0;
    this._lastShotAt = 0;
  }

  // ── 取り付け ──────────────────────────────────────────

  /**
   * **場所は載せる側が決める。** 十字とショットを置く入れ物を 2 つ渡す。
   * 中身(絵と当たり判定)はこちらが作る。
   *
   *   touch.attach({ dpad: leftDiv, shot: rightDiv });
   *
   * 横画面の左右の空きをどう取るかはゲームごとに違うので、ここでは決めない。
   * 渡された入れ物いっぱいに広がる
   *
   * `dpadCatch` / `shotCatch` は**指を受けるだけの、絵の無い入れ物**(省いてよい)。
   * 十字は「触れたところが原点」、こすりは「触れてから動かした量」なので、
   * **受ける場所を広げても操作の中身は変わらない**。
   * 絵はあくまで dpad / shot の入れ物の中に出るので、
   * **広げたぶんはゲーム画面に何も足さない**(狙いはそこ)。
   *
   * @param {{ dpad: HTMLElement, shot: HTMLElement,
   *           dpadCatch?: HTMLElement, shotCatch?: HTMLElement }} areas
   */
  attach(areas) {
    if (this._zones.length) this.detach();
    if (!areas || !areas.dpad || !areas.shot) {
      throw new Error('attach({ dpad, shot }) に入れ物を 2 つ渡してください');
    }
    injectStyle();

    this._dpad = areas.dpad;
    this._shot = areas.shot;
    // **絵を持つのはこの 2 つだけ。** 大きさの計算(_applyLayout)も
    // 場所の計算(_rectOf)も、ここを見ている
    this._zones = [this._dpad, this._shot];
    // 指を受けるだけの入れ物。**_zones には入れない**
    // (入れると絵の大きさの計算に混ざり、中身も上書きされる)
    this._dpadCatch = areas.dpadCatch || null;
    this._shotCatch = areas.shotCatch || null;
    this._dpad.classList.add('mmsxx-touch-zone', 'mmsxx-touch-dpad');
    this._shot.classList.add('mmsxx-touch-zone', 'mmsxx-touch-shot');
    this._dpad.innerHTML = DPAD_HTML;
    this._shot.innerHTML = SHOT_HTML;
    // 中の絵は absolute で置く。土台が static のままだと行き場が無いので、
    // **そのときだけ** relative にする。借りる側が fixed などで置いていれば触らない
    for (const z of this._zones) {
      if (getComputedStyle(z).position === 'static') z.style.position = 'relative';
    }

    this._fire = this._shot.querySelector('.mmsxx-touch-fire');
    this._pause = this._shot.querySelector('.mmsxx-touch-pause');
    this._knob = this._dpad.querySelector('.mmsxx-touch-knob');
    this._stickEl = this._dpad.querySelector('.mmsxx-touch-stick');
    this._needle = this._dpad.querySelector('.mmsxx-touch-needle');
    // **十字の中のほうだけ。** 目印(hint)にも同じ絵が入っているが、
    // あちらは倒していない姿で出しっぱなしにする
    this._cap = this._stickEl.querySelector('.mmsxx-touch-cap');

    this._applyLayout();
    this._applyLabels();
    this.setSkin(this.skin);
    addEventListener('resize', this._onResize);
    addEventListener('orientationchange', this._onResize);
    this._bind(this._dpad, 'dpad');
    this._bind(this._shot, 'shot');   // **エリア全体**で受ける(丸は絵だけ)
    this._bind(this._pause, 'pause');
    if (this._dpadCatch) this._bind(this._dpadCatch, 'dpad');
    if (this._shotCatch) this._bind(this._shotCatch, 'shot');
    return this;
  }

  /**
   * **十字とボタンの担当を入れ替える**(左利き向け)。
   * 渡された 2 つの入れ物を取り替えるだけなので、置き場所そのものは動かない。
   * つまみ・文言・絵はそのまま引き継ぐ。押しっぱなしは離れる
   */
  swapSides() {
    if (!this._zones.length) return this;
    return this.attach({ dpad: this._shot, shot: this._dpad });
  }

  /** 外す。押しっぱなしは全部離してから。**入れ物そのものは消さない**(借り物なので) */
  detach() {
    if (!this._zones.length) return;
    removeEventListener('resize', this._onResize);
    removeEventListener('orientationchange', this._onResize);
    this.releaseAll();
    for (const z of this._zones) {
      z.classList.remove('mmsxx-touch-zone', 'mmsxx-touch-dpad', 'mmsxx-touch-shot',
                         'holding', 'used');
      z.innerHTML = '';
      // 借り物なので、こちらが入れた指定は残さない
      for (const prop of Object.values(SKIN_VARS)) z.style.removeProperty(prop);
      for (const prop of ['--r', '--hx', '--hy']) z.style.removeProperty(prop);
    }
    for (const c of this._catches()) c.style.display = '';
    this._zones = [];
    this._dpadCatch = this._shotCatch = null;
    this._dpad = this._shot = this._fire = this._pause = this._knob = this._stickEl = null;
    this._needle = this._cap = null;
  }

  /** 指を受けるだけの入れ物。渡されたぶんだけ */
  _catches() {
    return [this._dpadCatch, this._shotCatch].filter(Boolean);
  }

  /** 出し入れ */
  get visible() {
    return this._zones.length > 0 && this._zones[0].style.display !== 'none';
  }
  set visible(v) {
    if (!v) this.releaseAll();
    for (const z of this._zones) z.style.display = v ? '' : 'none';
    // **受けるだけの入れ物も一緒に消す。** 残すと、メニューで払ったつもりの指を
    // 十字やショットが横取りしてしまう(絵は出ていないので、何が起きたのか分からない)
    if (this._shotCatch) this._shotCatch.style.display = v ? '' : 'none';
    // 十字のほうは **dpadOn も見る**(切っているなら出しっぱなしにしない)
    if (this._dpadCatch) this._dpadCatch.style.display = (v && this.dpadOn) ? '' : 'none';
    // 出したら「撃っている」状態から始める / しまったら押しっぱなしを解く
    this._applyIdleFire();
  }

  /**
   * **十字を出すか**(既定は出す)。
   *
   * 切ると絵も当たりも消え、**指はうしろへ抜ける** —
   * canvas を直に叩く遊びかた(engine/util/padless.js)へ替えるためのもの。
   * 連射のほうは残るので、撃つ場所はそのまま。
   *
   * **入れ物そのものは display で消さない。** 大きさの計算(`_applyLayout`)が
   * 帯の幅を見ているので、消すと幅が 0 になって**連射の丸まで縮む**。
   * 見えなくするのと当たりを外すのを別々にやって、箱は残しておく
   */
  get dpadOn() { return this._dpadOn !== false; }
  set dpadOn(v) {
    this._dpadOn = !!v;
    if (!v) this.releaseAll();
    if (this._dpad) {
      this._dpad.style.visibility = v ? '' : 'hidden';
      this._dpad.style.pointerEvents = v ? '' : 'none';
    }
    if (this._dpadCatch) this._dpadCatch.style.display = (v && this.visible) ? '' : 'none';
  }

  /** つまみを変える。**動かしたまま効く** */
  setOptions(patch) {
    if (patch && patch.labels) this.setLabels(patch.labels);
    Object.assign(this.opts, patch);
    this._applyLayout();
    // 撃ちかたを変えられたぶんを、いまの指の様子に合わせ直す
    this._applyIdleFire();
  }

  /**
   * 絵を差し替える。**渡すのは CSS の背景に置ける値**(url(...) や data: の URI)。
   * 渡したものだけ変わり、渡さなかったところは既定の見た目のまま。
   *
   *   touch.setSkin({ fire: `url(${shotPng})`, firePressed: `url(${shotOnPng})` });
   *
   * fire … ボタンの丸 / firePressed … 撃った瞬間 / shotArea … ボタンのエリアの背景
   * knob … 指そのものの印 / ring … 原点の下敷き(いずれも既定では何も出ない)
   */
  setSkin(patch) {
    Object.assign(this.skin, patch);   // 付け直したときに戻せるよう覚えておく
    for (const [key, prop] of Object.entries(SKIN_VARS)) {
      if (!(key in patch)) continue;
      for (const z of this._zones) {
        if (patch[key]) z.style.setProperty(prop, patch[key]);
        else z.style.removeProperty(prop);
      }
    }
  }

  /** 文言を差し替える。渡したものだけ変わる */
  setLabels(patch) {
    Object.assign(this.labels, patch);
    this._applyLabels();
  }

  _applyLabels() {
    if (!this._dpad) return;
    const put = (zone, sel, text) => {
      const el = zone.querySelector(sel);
      if (el) el.textContent = text || '';
    };
    put(this._dpad, '.mmsxx-touch-title', this.labels.dpadTitle);
    put(this._dpad, '.mmsxx-touch-note', this.labels.dpadNote);
    put(this._dpad, '.mmsxx-touch-callout', this.labels.dpadCallout);
    put(this._shot, '.mmsxx-touch-title', this.labels.shotTitle);
    put(this._shot, '.mmsxx-touch-note', this.labels.shotNote);
    put(this._shot, '.mmsxx-touch-callout', this.labels.shotCallout);
    put(this._shot, '.mmsxx-touch-pause', this.labels.pause);
  }

  /** 押しっぱなしを全部離す(画面が非アクティブになったときなど) */
  releaseAll() {
    for (const code of [...this.down]) this._release(code);
    this.pointers.clear();
    this._pulseDown.clear();
    this._pulseQueue.clear();
    this._stopHold();
    this._stopCoast();
    this.stick.active = false;
    this.stick.vx = 0; this.stick.vy = 0; this.stick.speed = 0;
    this._hideRing();
    this._paint();
  }

  /** 数えたぶんを捨てる(touch-tool の RESET) */
  reset() {
    this.releaseAll();
    this.rub.pressCount = 0;
    this.rub.releaseCount = 0;
    this.rub.move = 0;
    this.rub.turns = 0;
    this.rub.rate = 0;
    this.rub.maxRate = 0;
    this._shotTimes.length = 0;
  }

  /** いまの様子をまとめて渡す(touch-tool の計器盤が読む) */
  state() {
    this._trimShotTimes();
    return {
      down: [...this.down],
      pointers: [...this.pointers.entries()].map(([id, p]) => ({
        id, owner: p.owner, x: Math.round(p.x), y: Math.round(p.y),
      })),
      stick: { ...this.stick },
      rub: { ...this.rub },
    };
  }

  /**
   * **判定の大きさ**に、画面の大きさぶんの伸び縮みを掛ける。
   * 掛かるのは不感帯・引きずり・こすりのしきい値の 3 つだけで、
   * **見た目(guiRadius)には掛けない**。絵の大きさを変えずに、
   * 大きい画面と小さい画面で感じがどう変わるかを見るためのつまみ
   */
  _px(v) { return v * (this.opts.scale || 1); }

  // ── 座標 ──────────────────────────────────────────────
  //
  // 画面を回して見せているときは、指の場所も同じだけ回さないと、
  // 見えている場所と当たり判定がずれる。**ここから下はすべて入れ物の座標**で扱う。

  /** pointer の場所を入れ物の座標にする */
  _pt(e) {
    if (!this.toLocal) return { x: e.clientX, y: e.clientY };
    const [x, y] = this.toLocal(e.clientX, e.clientY);
    return { x, y };
  }

  /**
   * 要素の四角を入れ物の座標にする。
   * 90 度単位の回転なら、向かい合う角を 2 つ移して並べ直せば元の四角に戻る
   */
  _rectOf(el) {
    const r = el.getBoundingClientRect();
    if (!this.toLocal) return r;
    const [ax, ay] = this.toLocal(r.left, r.top);
    const [bx, by] = this.toLocal(r.right, r.bottom);
    const left = Math.min(ax, bx), right = Math.max(ax, bx);
    const top = Math.min(ay, by), bottom = Math.max(ay, by);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  // ── 見た目 ────────────────────────────────────────────

  /** 見た目に関わるつまみを CSS へ流す。**大きさや位置は借りる側が決める** */
  _applyLayout() {
    // **入れ物の幅に対する割合で決める**(areaRatio、既定 8 割)。
    // 狭いエリアでは小さく、広いエリアでは大きく。**縮むだけでなく育つ**ので、
    // 空きの広い機種では指に合った大きさになる。
    // 画面の大きさではなく**入れ物**を見るので、エリアの取りかたを変えても壊れない。
    //
    // いちばん大きい絵はボタンの丸で、その幅は (2.8r - 40) * 1.02。
    // これが入れ物の幅の areaRatio になるところを狙う。
    // **小さくなりすぎるのは止める**(minRadius)。指で押せなくなるため
    // **狭いほうのエリアに合わせる**(左右で同じ大きさにする)。
    // 測れないうちは guiRadius をそのまま使う
    const o = this.opts;
    let r = null;
    for (const z of this._zones) {
      // **かぶせて広げたぶんは数えない**(areaWidth。0 なら入れ物のまま)
      const w = o.areaWidth > 0 ? o.areaWidth : z.clientWidth;
      if (w > 0) {
        const fit = ((w * o.areaRatio) / 1.02 + 40) / 2.8;
        r = r === null ? fit : Math.min(r, fit);
      }
    }
    if (r === null) r = o.guiRadius;
    // **長さでも頭を打たせる。** ドット数だけで決めると、画面の広い端末で
    // ボタンだけ巨大になる。指の大きさは端末によらないので、そちらに合わせる
    const mmMax = o.maxRadiusMm > 0 ? o.maxRadiusMm * 96 / 25.4 : Infinity;
    r = Math.min(Math.max(r, o.minRadius), o.maxRadius, mmMax);
    /** 実際に使っている大きさ。つまみの値と違うことがある(実験台が読む) */
    this._r = Math.max(16, Math.round(r));
    // **scale は掛けない。** 見た目の大きさは変えず、判定だけを変えるつまみ
    for (const z of this._zones) z.style.setProperty('--r', this._r + 'px');
    // **触れていないときの目印も、触れたときと同じ場所へ。**
    // 別々に置くと、指を下ろした拍子に十字がそこへ飛んだように見える
    // (「タップした位置へ移動している」ように見えていたのはこれ)
    if (this._dpad) {
      const at = this._anchor(this._rectOf(this._dpad));
      this._dpad.style.setProperty('--hx', at.x + 'px');
      this._dpad.style.setProperty('--hy', at.y + 'px');
    }
  }

  /** 押しているところを明るくする。**音は鳴らさない** */
  _paint() {
    if (!this._dpad) return;
    // **十字の矢印はもう点けない。** 矢印は 8 方向しか無いので、
    // 点けると 360 度動いているものが 8 方向に吸着して見える。
    // 倒している向きは針(_showNeedle)が丸めずに見せる。
    // 残してあるのは**上下左右がどちらかを示す目印**としてだけ
    // **押しっぱなしの明かりは、撃ちっぱなしの遊びでは出さない。**
    // idleFire では触っていないあいだが押しっぱなしなので、点けると
    // 遊んでいるあいだ ずっと光ることになる(こすりが効いた合図が埋もれる)。
    // 光らせるのは 1 発ぶんが出たときの ぱっとした明滅だけ(_flashFire)
    if (this._fire) {
      this._fire.classList.toggle('on',
        !this.opts.idleFire && this.down.has(this.opts.shotCode));
    }
    if (this._pause) this._pause.classList.toggle('on', this.down.has(this.opts.pauseCode));
  }

  // ── 通知 ──────────────────────────────────────────────

  _press(code) {
    if (this.down.has(code)) return;
    this.down.add(code);
    if (this.onPress) this.onPress(code, SOURCE);
    if (code === this.opts.shotCode) this._countShot();
    this._paint();
  }

  /**
   * 1 発ごとに、こすり面をぱっと光らせる。
   * **押しているのは 1 コマだけ**なので、色を変えるだけでは目に入らない
   */
  _flashFire() {
    const el = this._fire;
    if (!el) return;
    if (!el._flashBound) {   // 光り終わったら印を外す(付けっぱなしにしない)
      el.addEventListener('animationend', () => el.classList.remove('hit'));
      el._flashBound = true;
    }
    el.classList.remove('hit');
    void el.offsetWidth;      // ここで巻き戻さないと、続けて撃ったときに光り直さない
    el.classList.add('hit');
  }

  /**
   * **こすりかたを指で見せる。** 丸の上に指の絵を重ね、斜めの往復と
   * くるくるを 3 秒ずつ見せて消える(CSS の way1 / way2)。
   *
   * **呼ばれたときだけ出す。** 遊びはじめに黙って出していたころは、
   * まだこする場面でもないうちから視界に居るだけだった。
   * 呼ぶのは**速く撃てるほど効く場面**に来たとき(ボスが無防備になった、など)。
   *
   * 続けて呼ばれたら頭から出し直す(印を外して巻き戻してから付け直す)
   * @param {number} [sec=6] 見せる長さ。CSS の 6 秒と合わせてある
   */
  rubDemo(sec = 6) {
    const el = this._shot;
    if (!el) return;
    clearTimeout(this._rubDemoTimer);
    el.classList.remove('rubdemo');
    void el.offsetWidth;   // ここで巻き戻さないと、続けて呼んだとき動きが続きから始まる
    el.classList.add('rubdemo');
    this._rubDemoTimer = setTimeout(() => {
      if (this._shot) this._shot.classList.remove('rubdemo');
    }, sec * 1000);
  }

  _release(code) {
    if (!this.down.has(code)) return;
    this.down.delete(code);
    if (this.onRelease) this.onRelease(code, SOURCE);
    if (code === this.opts.shotCode) this.rub.releaseCount++;
    this._paint();
  }

  /**
   * **1 コマだけ押す**。押した直後に離すとゲーム側の wasPressed() が拾えないので、
   * 離すのは次の描き替えまで待つ。
   *
   * **待っているあいだに来たぶんは捨てる。** 貯めると、指を止めたあとも
   * 上限(1 コマ 1 発 = 60 発/秒)で出続けてしまう。実際そうなって、
   * 一気に指を滑らせるだけで 60 発/秒に張り付いた
   */
  _pulse(code) {
    if (this._pulseDown.has(code) || this.down.has(code)) return;
    this._press(code);
    // **光るのは 1 発ぶんが出たときだけ。** 押しっぱなし(_press だけ)では光らせない。
    // 撃ちっぱなしが既定の遊び(idleFire)では、押しっぱなしで光らせると
    // 遊んでいるあいだ ずっと点いていて、こすりが効いたことが分からなくなる
    if (code === this.opts.shotCode) this._flashFire();
    this._pulseDown.add(code);
    this._runPulses();
  }

  /**
   * **押しっぱなしのまま、もう 1 回押したことにする**(holdFire のとき)。
   *
   * 押しっぱなしにしていると `_pulse` は素通りしてしまう(もう押しているので)。
   * かといって離してしまうと、押しっぱなしが切れる。
   * **同じ tick の中で離して押し直す**と、ゲームがコマの頭で読むころには
   * 「押しっぱなしのまま、押した瞬間でもある」になっている
   * (キーボードで連打したときと同じ形)
   */
  _retrigger(code) {
    if (!this.down.has(code)) { this._pulse(code); return; }
    this._release(code);
    this._press(code);
    if (code === this.opts.shotCode) this._flashFire();   // 1 発ぶん出た
  }

  _runPulses() {
    if (this._pulseRaf) return;
    this._pulseRaf = requestAnimationFrame(() => {
      this._pulseRaf = 0;
      for (const code of [...this._pulseDown]) {
        this._release(code);
        this._pulseDown.delete(code);
      }
    });
  }

  _countShot() {
    const now = performance.now();
    this.rub.pressCount++;
    this._lastShotAt = now;
    this._shotTimes.push(now);
    this._trimShotTimes();
    if (this.rub.rate > this.rub.maxRate) this.rub.maxRate = this.rub.rate;
  }

  /** 直近 1 秒に入っているものだけ残す */
  _trimShotTimes() {
    const cut = performance.now() - 1000;
    while (this._shotTimes.length && this._shotTimes[0] < cut) this._shotTimes.shift();
    this.rub.rate = this._shotTimes.length;
  }

  // ── 指の受け付け ──────────────────────────────────────

  _bind(el, owner) {
    el.addEventListener('pointerdown', (e) => {
      // PAUSE の上はショットにしない(同じエリアの中にあるため)
      if (owner !== 'pause' && e.target.closest('.mmsxx-touch-pause')) return;
      e.preventDefault();
      // 担当は触れた瞬間に決めて、離すまで変えない
      const at = this._pt(e);
      const p = { owner, x: at.x, y: at.y, el };
      this.pointers.set(e.pointerId, p);
      // 捕まえておくと、指がボタンから滑り出ても続きが届く。
      // **失敗しても先へ進む**(捕まえられなくても、その場での操作は成り立つ)
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* 捕まえられなくても続ける */ }
      if (owner === 'dpad') this._stickDown(p);
      else if (owner === 'shot') this._shotDown(p, e);
      else this._press(this.opts.pauseCode);
    });

    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      const at = this._pt(e);
      const dist = Math.hypot(at.x - p.x, at.y - p.y);
      p.x = at.x;
      p.y = at.y;
      if (p.owner === 'dpad') this._stickMove(p);
      else if (p.owner === 'shot') this._shotMove(p, dist);
    });

    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (p.owner === 'dpad') this._stickUp();
      else if (p.owner === 'shot') this._shotUp();
      else this._release(this.opts.pauseCode);
    };
    // 長押しのメニュー(iOS の「コピー」など)を断る。
    // CSS だけでは出てしまうことがあるので、催促そのものを止める
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // 着信やジェスチャで指が消えることがあるので cancel も拾う
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  // ── 相対十字 ──────────────────────────────────────────

  _stickDown(p) {
    this._dpad.classList.add('used');   // 誘い文句は一度触ったら消す
    const s = this.stick;
    s.active = true;
    s.ox = p.x; s.oy = p.y;
    s.x = p.x; s.y = p.y;
    s.dx = 0; s.dy = 0; s.dist = 0; s.deg = 0; s.sector = -1;
    s.rx = 0; s.ry = 0;
    // 'move' 用。**触れただけでは向きを立てない**(動きはまだ 0)
    s.vx = 0; s.vy = 0; s.speed = 0;
    this._sampleAt = performance.now();
    this._showRing();
    if (this.opts.stickMode === 'move') this._startCoast();
  }

  _stickMove(p) {
    if (this.opts.stickMode === 'move') { this._stickMoveDirect(p); return; }
    const s = this.stick;
    // **指がどちらへ動いているかは 'origin' でも要る。**
    // 下の折り返しの見分けが、指の場所ではなく指の動きを見るため
    const mdx = p.x - s.x, mdy = p.y - s.y;
    this._decay(performance.now(), mdx, mdy);
    s.x = p.x; s.y = p.y;
    this._flipOrigin(mdx, mdy);
    let dx = s.x - s.ox;
    let dy = s.y - s.oy;
    let dist = Math.hypot(dx, dy);

    // 大きく離れたら、その距離を保つように原点を引きずる。**0 なら引きずらない**
    const max = this._px(this.opts.dragMax);
    if (max > 0 && dist > max) {
      const k = (dist - max) / dist;
      s.ox += dx * k;
      s.oy += dy * k;
      dx = s.x - s.ox;
      dy = s.y - s.oy;
      dist = max;
    }
    s.dx = dx; s.dy = dy; s.dist = dist;
    s.deg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;

    if (dist < this._px(this.opts.deadzone)) s.sector = -1;
    else s.sector = this._sectorOf(s.deg, s.sector);

    this._applyDirs(s.sector < 0 ? [] : SECTOR_KEYS[s.sector]);
    this._reportStick();
    this._showRing();
  }

  /**
   * **急に折り返したら、原点を指の向こう側へ置き直す**('origin' のとき)。
   *
   * 原点からの角度だけで向きを決めていると、右へ 200px 出したところから
   * 左へ行くのに、**原点をまたぐまでの 200px は右へ進み続ける**。
   * 逆へ行きたいのに行き過ぎが増えるので、寄せ直すたびに行きつ戻りつになる。
   * これが「酔う」の正体。
   *
   * **見るのは指の場所ではなく指の動き。** いま出している向きと、指が
   * 動いている向きが `stickFlipAngle` より開いたら、**折り返したと決めて
   * 原点を指の向こう側へ移す**。指の場所はまだ前の向きを指していても、
   * その場で逆を向く。倒し量はそのまま持ち越すので、
   * **全速で右へ行っていたなら、そのまま全速で左へ切り返せる**。
   *
   * 震えで誤って裏返らないよう、**この 1 回でこれだけ動いたときだけ**見る
   * (`stickFlipMove`)。0 を入れれば、この仕掛けそのものが切れる。
   *
   * **ならした速さ(`vx`/`vy`)は使わない。** あちらは向きが変わるのに
   * `stickSmoothMs` ぶん掛かるので、**折り返しに気づくのが、
   * 原点をまたぎ終わるより遅くなる**。実際そうなって、切り返しが
   * 54px から 138px へ伸びた。見るのは**この 1 回ぶんの生の動き**
   *
   * @param {number} mdx この 1 回で動いたぶん
   * @param {number} mdy 同上
   */
  _flipOrigin(mdx, mdy) {
    const deg = this.opts.stickFlipAngle;
    if (!(deg > 0)) return;
    const s = this.stick;
    // **止まりぎわは見ない。** 指を置いたままの震えは折り返しではない
    const move = Math.hypot(mdx, mdy);
    if (move < this._px(this.opts.stickFlipMove)) return;
    const dist = Math.hypot(s.dx, s.dy);
    if (dist <= 0) return;
    // いま出している向きと、指が動いている向きの開き(内積で見る)
    const dot = (s.dx * mdx + s.dy * mdy) / (dist * move);
    if (dot > Math.cos(deg * Math.PI / 180)) return;   // まだ折り返しとは呼ばない
    // **倒し量はそのまま**にして、向きだけ指の動くほうへ差し替える
    s.ox = s.x - (mdx / move) * dist;
    s.oy = s.y - (mdy / move) * dist;
  }

  // ── 相対十字('move' = 指の動く向きをそのまま読む) ──────
  //
  // **原点を持たない。** 触れたところは覚えず、いま動いている向きだけを見る。
  // 折り返しは戻る距離を待たずにその場でつながり、**指を止めれば止まる**。
  //
  // 速さは**ならしてから**使う。1 回ぶんの pointermove をそのまま読むと、
  // 指の震えと OS の間引きで向きがばたつく。
  //
  // **止まったことは、動きが来ないことでは分からない。**
  // 指を置いたままだと pointermove がもう飛んでこないので、
  // 「最後に動いてから経った時間」で減らしにいく(_startCoast)。

  _stickMoveDirect(p) {
    const s = this.stick;
    const dx = p.x - s.x, dy = p.y - s.y;
    s.x = p.x; s.y = p.y;
    this._decay(performance.now(), dx, dy);
    this._applyStickSpeed();
    this._showRing();
  }

  /**
   * 速さを時間ぶん減らし、来ていれば新しい動きを混ぜる。
   * **経った時間で減らす**ので、pointermove の来かたが端末で違っても同じに効く
   * @param {number} now いまの時刻(ms)
   * @param {number} [dx] このぶん動いた(来ていなければ 0)
   * @param {number} [dy] 同上
   */
  _decay(now, dx = 0, dy = 0) {
    const s = this.stick;
    const dt = Math.min(100, Math.max(1, now - this._sampleAt));
    this._sampleAt = now;
    // ならしの強さ。**時定数で書く**ので、間隔がばらついても効きが変わらない
    const tau = Math.max(1, this.opts.stickSmoothMs);
    const keep = Math.exp(-dt / tau);
    s.vx = s.vx * keep + (dx / dt) * (1 - keep);
    s.vy = s.vy * keep + (dy / dt) * (1 - keep);
    s.speed = Math.hypot(s.vx, s.vy);
  }

  /** ならした速さから向きを決めて、キーへ流す */
  _applyStickSpeed() {
    const s = this.stick;
    // **見えているもの(dx/dy/dist)も速さで埋める。** touch-tool が読む
    s.dx = s.vx; s.dy = s.vy; s.dist = s.speed;
    if (s.speed < this.opts.stickMinSpeed) {
      s.sector = -1;
    } else {
      s.deg = (Math.atan2(s.vy, s.vx) * 180 / Math.PI + 360) % 360;
      s.sector = this._sectorOf(s.deg, s.sector);
    }
    this._applyDirs(s.sector < 0 ? [] : SECTOR_KEYS[s.sector]);
    this._reportStick();
  }

  /**
   * **倒している向きと強さを知らせる**(8 方向のキーとは別の口)。
   *
   * 丸めた向きではなく**生の向き**を出す。いくつの方向へ丸めるかは
   * 読む側が決める(engine/input.js の stick(snap))。
   *
   * 強さは速さから作る。`stickMinSpeed` を 0、`stickFullSpeed` を 1 とした
   * ところに置くので、**ゆっくり動かせば弱く、速く動かせば強く**なる。
   * 触れたところからの決めかた('origin')では、原点からの距離で作る
   */
  _reportStick() {
    const s = this.stick;
    if (!s.active) { s.rx = 0; s.ry = 0; if (this.onStick) this.onStick(0, 0); return; }
    let x = 0, y = 0;
    if (this.opts.stickMode === 'move') {
      const lo = this.opts.stickMinSpeed;
      const hi = Math.max(lo + 0.001, this.opts.stickFullSpeed);
      // **1 で頭打ちにしない。** 速く払ったぶんは、そのまま自機の速さにする
      // (止めるのは stickMaxPower。上のつまみの説明を見ること)
      const cap = Math.max(1, this.opts.stickMaxPower || 1);
      const t = Math.min(cap, Math.max(0, (s.speed - lo) / (hi - lo)));
      if (t > 0 && s.speed > 0) { x = (s.vx / s.speed) * t; y = (s.vy / s.speed) * t; }
    } else {
      // 倒し量は**原点からの距離**。不感帯を 0、stickFullDist を 1 とする。
      // stickFullDist が 0 なら絵の大きさから決める(触ってすぐ全開にならない程度)
      const dead = this._px(this.opts.deadzone);
      const full = this._px(this.opts.stickFullDist) || this._r * 1.2;
      let t = Math.min(1, Math.max(0, (s.dist - dead) / Math.max(1, full - dead)));
      // **効きぐあいを曲げる**(既定の 1 では何も変わらない)。
      // 0 と 1 は累乗しても 0 と 1 のままなので、
      // **不感帯の外れぎわと全開の位置は動かない**。変わるのはあいだの割りふりだけ
      const curve = this.opts.stickCurve;
      if (curve > 0 && curve !== 1 && t > 0) t = Math.pow(t, curve);
      if (t > 0 && s.dist > 0) { x = (s.dx / s.dist) * t; y = (s.dy / s.dist) * t; }
    }
    // **針が見せるのは、ここで出した値そのもの。**
    // 別に計算し直すと、目に見えているものと自機の動きがずれる
    s.rx = x; s.ry = y;
    if (this.onStick) this.onStick(x, y);
  }

  /**
   * **指が止まったことに気づくための見張り。**
   * 置いたままだと pointermove は来ないので、こちらから時間ぶん減らしにいく。
   * 十分遅くなったら向きを落とす(そこで自機も止まる)
   */
  _startCoast() {
    this._stopCoast();
    const tick = () => {
      if (!this.stick.active) { this._coast = 0; return; }
      this._decay(performance.now());
      this._applyStickSpeed();
      this._coast = requestAnimationFrame(tick);
    };
    this._coast = requestAnimationFrame(tick);
  }

  _stopCoast() {
    if (this._coast) cancelAnimationFrame(this._coast);
    this._coast = 0;
  }

  _stickUp() {
    this._stopCoast();
    this.stick.active = false;
    this.stick.sector = -1;
    this.stick.vx = 0; this.stick.vy = 0; this.stick.speed = 0;
    this._applyDirs([]);
    // **倒すのをやめたことを必ず知らせる。** 置きっぱなしにすると、
    // 指を離しても自機が進み続ける
    this._reportStick();
    this._hideRing();
  }

  /**
   * **十字の絵を置く場所。動かさない。**
   *
   * 触れたところが原点なのは今までどおりで、**動かないのは絵のほうだけ**。
   * 出るところが毎回変われば、結局そこを目で探すことになる。ガラスには縁が無く、
   * 指で位置を確かめられないので、絵は目印として据え置いたほうが強い。
   *
   * 横はエリアの真ん中。**左右どちらの端からも一番遠い**ので、
   * Android の「戻る」(端から内へ払う)に巻き込まれにくい。
   * 縦は下寄り(親指の来るところ)。CSS の目印 --hx / --hy の既定と同じ場所で、
   * **触れる前と触れているあいだで絵が動かない**
   */
  _anchor(r) {
    // **連射ボタンと下をそろえる。** 左右で高さが違うと、持ち替えるたびに
    // 親指の位置を作り直すことになる。
    // ボタンの丸は下から 10%、差し渡しは下の式(CSS の .mmsxx-touch-fire と同じ)。
    // その中心の高さへ、十字の中心を合わせる
    const d = (this._r * 2.8 - 40) * 1.6 * 34 / 48 * 0.9;
    // **十字はボタンより少し下**。親指の付け根に近いぶん、
    // 同じ高さだと十字のほうが遠く感じる
    const y = r.height - (r.height * 0.10 + d / 2) + this._r * 0.3;
    // **内側へ寄せるぶん**。借りているボタンが外側の端に縦一列で並ぶ機種では、
    // 真ん中に置くと十字がその上に掛かる。掛かるぶんだけ画面側へ逃がす
    // (どれだけ逃がすかは、ボタンの並びを知っている借りる側が決める)
    const x = r.width / 2 + (this.opts.anchorInset || 0);
    return {
      x: Math.min(Math.max(x, this._r * 0.5), r.width - this._r * 0.5),
      y: Math.min(Math.max(y, this._r), r.height - this._r),
    };
  }

  _hideRing() {
    if (this._stickEl) this._stickEl.style.display = 'none';
    if (this._knob) this._knob.style.display = 'none';
    if (this._needle) this._needle.style.display = 'none';
    if (this._dpad) this._dpad.classList.remove('holding');   // 目印を出す
  }

  /** 区画を決める。**境目を少し重ねて**ばたつきを止める */
  _sectorOf(deg, current) {
    const next = Math.round(deg / 45) % 8;
    if (current < 0 || next === current) return next;
    // いまの区画の真ん中からどれだけ離れたか(0〜180 度)
    const d = Math.abs(((deg - current * 45 + 540) % 360) - 180);
    return d > 22.5 + this.opts.hysteresis ? next : current;
  }

  /** 向きを入れ替える。増えたぶんを押し、減ったぶんを離す */
  _applyDirs(keys) {
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      if (keys.includes(code)) this._press(code);
      else this._release(code);
    }
  }

  /**
   * 十字の絵を出す。**触れたところへ出す**(stickAtTouch)。
   *
   * 一度は据え置きにしていた。出る場所が毎回変わると、結局そこを目で
   * 探すことになる、という理由。ただ実機で遊ぶと**親指を置いた先に
   * 出てくれるほうが早い**ので、触れたところへ戻してある。
   * 据え置きに戻したいときは `stickAtTouch: false`。
   *
   * **原点(ox/oy)へ出す。** 指の今いる場所(x/y)ではない。
   * 原点は引きずり(dragMax)や折り返し(_flipOrigin)で動くので、
   * 絵もそれに付いていく — つまみと絵の関係が指と一致する
   */
  _showRing() {
    if (!this._stickEl || !this._dpad) return;
    const r = this._rectOf(this._dpad);
    const s = this.stick;
    // **'' ではなく 'block'。** '' にすると CSS の display:none へ戻ってしまう
    this._stickEl.style.display = 'block';
    this._knob.style.display = 'block';
    this._dpad.classList.add('holding');   // 目印を引っ込める
    const at = this.opts.stickAtTouch === false ? this._anchor(r)
      : { x: s.ox - r.left, y: s.oy - r.top };
    this._stickEl.style.left = at.x + 'px';
    this._stickEl.style.top = at.y + 'px';
    this._knob.style.left = (s.x - r.left) + 'px';
    this._knob.style.top = (s.y - r.top) + 'px';
    this._showNeedle();
  }

  /**
   * **倒している向きを、丸めずそのまま見せる。**
   *
   * 矢印 4 つは 8 方向にしか点かないので、動きが 360 度なのに
   * **目には 8 方向へ吸着しているように見えていた**。読み取りは針が受け持つ。
   *
   * 見せるのは `_reportStick` が外へ出した値そのもの(`rx` / `ry`)なので、
   * 針の向きと長さは**自機の向きと速さと必ず一致する**
   */
  _showNeedle() {
    const n = this._needle;
    const s = this.stick;
    this._showCap();
    if (!n) return;
    const t = Math.hypot(s.rx, s.ry);
    if (!s.active || t <= 0) { n.style.display = 'none'; return; }
    n.style.display = 'block';
    n.style.setProperty('--deg', (Math.atan2(s.ry, s.rx) * 180 / Math.PI) + 'deg');
    // **1 を超えることがある**('move' の stickMaxPower)。長さは輪で頭打ちにして、
    // 振り切っていることは色で見せる(伸ばし続けると輪の外へ出てしまう)
    n.style.setProperty('--len', Math.min(1, t) * this._r + 'px');
    n.classList.toggle('full', t >= 1);
  }

  /**
   * **棒の頭を、倒したぶんだけ土台の中で寄せる。**
   *
   * 針と同じ値(`rx` / `ry`)を見るので、**2 つが食い違うことはない**。
   * 寄せられるのは土台の縁に頭が収まるところまで(半径の 6 割)で、
   * **全開でちょうど内側に接する**
   */
  _showCap() {
    const cap = this._cap;
    if (!cap) return;
    const s = this.stick;
    const t = Math.min(1, Math.hypot(s.rx, s.ry));
    // 土台の半径から頭の半径を引いたぶんだけ寄せられる(頭は --r の 0.4 倍)
    const reach = this._r * 0.6;
    const k = t > 0 ? reach * t / Math.hypot(s.rx, s.ry) : 0;
    cap.style.setProperty('--cx', (s.active ? s.rx * k : 0) + 'px');
    cap.style.setProperty('--cy', (s.active ? s.ry * k : 0) + 'px');
  }

  // ── こすり打ち ────────────────────────────────────────

  _shotDown(p, e) {
    this._shot.classList.add('used');   // 誘い文句は一度触ったら消す
    this.rub.move = 0;
    p.acc = 0;
    p.vx = 0; p.vy = 0; p.stroke = 0;
    p.px = p.x; p.py = p.y;
    p.cell = this._cellOf(p);
    this.rub.cell = p.cell;
    this.rub.turns = 0;
    if (this.opts.idleFire) {
      // **触っていないあいだが「撃っている」。** だから触ったら止める。
      // ここで 1 発 出してしまうと、止めようとして撃つことになる
      this._release(this.opts.shotCode);
    } else if (this.opts.shotMode === 'C' || this.opts.holdFire) {
      // **holdFire なら、そのまま押しっぱなしにする**(離すまで下ろさない)
      this._press(this.opts.shotCode);
    } else {
      // どの方式でも、触れた瞬間に 1 発は出る
      this._pulse(this.opts.shotCode);
    }
    this._startHold();
  }

  /**
   * **こすって出す 1 発。** 押しっぱなしにしているかどうかで押しかたが変わるので、
   * 数えかた(A / B / D)の側からはこれだけを呼ぶ
   */
  _rubFire() {
    // idleFire のあいだは押していない(触っているので)。ふつうに 1 発ずつでよい
    if (this.opts.holdFire && !this.opts.idleFire) this._retrigger(this.opts.shotCode);
    else this._pulse(this.opts.shotCode);
  }

  _shotMove(p, dist) {
    const o = this.opts;
    p.acc = (p.acc || 0) + dist;
    this.rub.move += dist;
    const inside = this._inFire(p);

    if (o.shotMode === 'C') {
      // 領域はひとつ。入ったら押す、出たら離す
      if (inside) this._press(o.shotCode);
      else this._release(o.shotCode);
      return;
    }
    if (!inside) { this.rub.cell = ''; return; }

    if (o.shotMode === 'A') {
      // 区画割り。別の区画へ入るたびに 1 発
      const cell = this._cellOf(p);
      if (cell !== p.cell) {
        p.cell = cell;
        this.rub.cell = cell;
        this._rubFire();
      }
      return;
    }
    if (o.shotMode === 'B') {
      // B: 動いた量で数える。
      // **長く滑らせるほど得**になってしまうので、このゲームでは使わない。
      // 別のゲームで欲しくなるかもしれないので残してある
      const step = Math.max(1, this._px(o.shotStep));
      while (p.acc >= step) {
        p.acc -= step;
        this._rubFire();
      }
      return;
    }
    // D: 往復で数える。**向きが反転したときに 1 発**。
    // 爪を往復させる回数がそのまま連射数になり、一気の一振りは何 px でも 1 発。
    // ぐるぐる回すのは向きが連続して変わるだけなので、ほとんど出ない
    this._rubTurn(p, o);
  }

  /** 向きが反転したかを見て、していたら 1 発 */
  _rubTurn(p, o) {
    const dx = p.x - (p.px ?? p.x);
    const dy = p.y - (p.py ?? p.y);
    p.px = p.x; p.py = p.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;               // 止まっているうちは何もしない
    const ux = dx / len, uy = dy / len;

    if (p.vx === 0 && p.vy === 0) {      // 一振り目。向きが決まる
      p.vx = ux; p.vy = uy; p.stroke = len;
      return;
    }
    const dot = ux * p.vx + uy * p.vy;
    if (dot >= 0) {                      // 同じ向きへ進んでいる
      p.stroke += len;
      // 向きはゆっくり付いていく(曲がりながらこすっても切れないように)
      p.vx = p.vx * 0.8 + ux * 0.2;
      p.vy = p.vy * 0.8 + uy * 0.2;
      const n = Math.hypot(p.vx, p.vy) || 1;
      p.vx /= n; p.vy /= n;
      return;
    }
    // 反転した。**戻る前に十分こすっていたときだけ**数える(震えを拾わない)
    if (p.stroke >= Math.max(1, this._px(o.shotStep))) {
      this.rub.turns++;
      this._rubFire();
    }
    p.vx = ux; p.vy = uy;
    p.stroke = len;
  }

  _shotUp() {
    this._release(this.opts.shotCode);
    this._stopHold();
    this.rub.cell = '';
    // 指が離れた = また「撃っている」状態へ戻る(idleFire のとき)
    this._applyIdleFire();
  }

  /**
   * **触っていないあいだ押しっぱなしにする**(idleFire)。
   *
   * 押し直すきっかけは 3 つ。**指が離れたとき**・**出し入れしたとき**・
   * **つまみが変わったとき**。どれか 1 つでも抜けると、
   * 撃ちっぱなしのまま止まらなくなったり、逆に永久に撃たなくなったりする。
   *
   * **出ていないあいだは押さない。** メニューでも押しっぱなしにすると、
   * SPACE が押されたままになって選ぶ操作が壊れる
   */
  _applyIdleFire() {
    if (!this.opts.idleFire) return;
    const code = this.opts.shotCode;
    const touching = [...this.pointers.values()].some((p) => p.owner === 'shot');
    if (touching || !this.visible) { this._release(code); return; }
    if (!this.down.has(code)) { this._press(code); return; }
    // **押しているつもりでも、受け取る側が忘れていることがある。**
    // 画面が非アクティブになったときや、知らせの札を閉じたときに
    // 入力はまとめて捨てられる(engine/input.js の clear)。
    // こちらの控えは「押している」ままなので、_press は素通りしてしまい、
    // **一度ボタンを触るまで撃ちっぱなしが戻らなかった**。
    // 数え直さずに、押していることだけ言い直す
    if (this.onPress) this.onPress(code, SOURCE);
  }

  /**
   * **撃ちっぱなしを言い直す**(idleFire のとき)。毎コマ呼んでよい。
   * 受け取る側が入力を捨てても、次のコマで戻る
   */
  keepFire() { this._applyIdleFire(); }

  /**
   * ショットのエリアの中に指があるか(滑り出ても担当は変えない)。
   * **受けるだけの入れ物も中のうち。** ここを外すと、広げた側でこすっても
   * 触れた 1 発しか出ない(数えるのをやめてしまう)
   */
  _inFire(p) {
    for (const el of [this._shot, this._shotCatch]) {
      if (!el) continue;
      const r = this._rectOf(el);
      if (p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom) return true;
    }
    return false;
  }

  /** 区画割り(A)の、いまの区画の名前 */
  _cellOf(p) {
    if (!this._shot) return '';
    const r = this._rectOf(this._shot);
    const step = Math.max(1, this._px(this.opts.shotStep));
    return Math.floor((p.x - r.left) / step) + ',' + Math.floor((p.y - r.top) / step);
  }

  /**
   * 長押しの見張り。**既定は動かない**(holdRepeatMs が 0)。
   * 動かしたときは、こすらずに置いたままでも間隔ごとに 1 発出る
   */
  _startHold() {
    this._stopHold();
    if (!(this.opts.holdRepeatMs > 0)) return;
    this._holdTimer = setInterval(() => {
      const gap = this.opts.holdRepeatMs;
      if (!(gap > 0)) return;
      if (performance.now() - this._lastShotAt < gap) return;
      this._release(this.opts.shotCode);   // C で押しっぱなしのときのため
      this._pulse(this.opts.shotCode);
    }, 16);
  }

  _stopHold() {
    if (this._holdTimer) clearInterval(this._holdTimer);
    this._holdTimer = 0;
  }
}

// ── DOM と CSS ──────────────────────────────────────────

/**
 * **アナログパッドの絵**(土台と、その中を寄っていく棒の頭)。
 *
 * 前は上下左右の矢印 4 つだったが、**動きが 360 度になったいま用を満たさない**
 * (点けても 8 方向にしかならず、丸めて動いているように見えていた)。
 * 触れていないときの目印にも、触れているあいだの絵にも同じものを使う —
 * **触る前と触ったあとで別の絵が出ると、同じものだと分からない**
 */
const STICK_ART = '<div class="mmsxx-touch-dial"></div><div class="mmsxx-touch-cap"></div>';

/** 十字の入れ物の中身 */
const DPAD_HTML = `
  <div class="mmsxx-touch-title"></div>
  <div class="mmsxx-touch-note"></div>
  <div class="mmsxx-touch-hint">${STICK_ART}</div>
  <div class="mmsxx-touch-callout"></div>
  <div class="mmsxx-touch-stick"><div class="mmsxx-touch-ring"></div>${STICK_ART}<div class="mmsxx-touch-needle"><i></i></div></div>
  <div class="mmsxx-touch-knob"></div>`;

/** ショットの入れ物の中身 */
const SHOT_HTML = `
  <div class="mmsxx-touch-title"></div>
  <div class="mmsxx-touch-note"></div>
  <div class="mmsxx-touch-fire"></div>
  <svg class="mmsxx-touch-gesture" viewBox="0 0 48 48" aria-hidden="true">
    <g class="mmsxx-touch-way1">
      <g class="mmsxx-touch-rub"><g class="mmsxx-touch-finger" transform="translate(19.5,15.5) scale(0.9)">
        <rect x="6.2" y="0" width="3.8" height="11.5" rx="1.9"/>
        <circle cx="11" cy="9.4" r="1.9"/>
        <circle cx="13.2" cy="10.8" r="1.8"/>
        <rect x="3.2" y="8.4" width="11.6" height="12" rx="4.4"/>
        <circle cx="3.6" cy="13.8" r="2.4"/>
      </g></g>
    </g>
    <g class="mmsxx-touch-way2">
      <g class="mmsxx-touch-spin"><g class="mmsxx-touch-finger" transform="translate(19.5,15.5) scale(0.9)">
        <rect x="6.2" y="0" width="3.8" height="11.5" rx="1.9"/>
        <circle cx="11" cy="9.4" r="1.9"/>
        <circle cx="13.2" cy="10.8" r="1.8"/>
        <rect x="3.2" y="8.4" width="11.6" height="12" rx="4.4"/>
        <circle cx="3.6" cy="13.8" r="2.4"/>
      </g></g>
    </g>
  </svg>
  <div class="mmsxx-touch-callout"></div>
  <div class="mmsxx-touch-pause"></div>`;

let styled = false;

/** CSS は 1 度だけ入れる。ドット絵風に、角は丸めない */
function injectStyle() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'mmsxx-touch-style';
  s.textContent = `
/* 借りた入れ物。**どこに置くか・どれだけの大きさかは借りる側が決める。**
   ここで足すのは、指で触るために要る指定だけ */
.mmsxx-touch-zone {
  overflow: hidden;
  touch-action: none;
  image-rendering: pixelated;
}
/* 長押しで「コピー」などのメニューが出るのを止める。
   **Safari は接頭辞つきでないと効かない。** 中の文言まで届かせるため子孫にも当てる */
.mmsxx-touch-zone, .mmsxx-touch-zone * {
  user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}

/* エリアの名前と使いかた。**さりげなく**出す。指の邪魔をしないよう素通しにする。
   書体は借りる側が --mmsxx-gui-font で決める(何も渡さなければ等幅)。
   **ドット絵の書体は決まった大きさでしか揃わない**ので、字間は広げない */
.mmsxx-touch-title, .mmsxx-touch-note {
  position: absolute; left: 0; right: 0; text-align: center;
  pointer-events: none; color: #667;
  font: 16px var(--mmsxx-gui-font, monospace); letter-spacing: 0;
  white-space: nowrap; overflow: hidden;
}
.mmsxx-touch-title { top: 4px; }
.mmsxx-touch-note { bottom: 4px; color: #556; }
/* ショット側は上に PAUSE があるので、題はその上、説明は下端でよい */
.mmsxx-touch-shot .mmsxx-touch-title { top: 6px; }

/* 触れていないときの目印。**ここを触ればいい**と分かるように、ちかちかさせる。
   点滅は steps(2) でぱっと入れ替える(なめらかに薄くしない。昔の画面の感じ) */
.mmsxx-touch-hint {
  position: absolute; width: 0; height: 0;
  /* まだ一度も触っていないときの置き場所。**下限のすこし上**に出す
     (親指はエリアの下のほうに来るため)。触ったあとは --hx/--hy が入る */
  left: var(--hx, 50%); top: var(--hy, calc(100% - var(--r) * 2));
  animation: mmsxx-touch-blink 1.4s steps(2, jump-none) infinite;
}
@keyframes mmsxx-touch-blink {
  0%   { opacity: 0.25; }
  100% { opacity: 0.7; }
}
/* 触れているあいだは引っ込める */
.mmsxx-touch-dpad.holding .mmsxx-touch-hint { display: none; }

/* 「ここを触って動かす」の誘い文句。目印のすぐ下に白で出し、
   **一度でも触ったら二度と出さない** */
.mmsxx-touch-callout {
  position: absolute; transform: translateX(-50%);
  left: var(--hx, 50%);
  top: calc(var(--hy, calc(100% - var(--r) * 2)) + var(--r) * 1.28);
  /* **太字にはしない。** ドット絵の書体に太字は無く、ブラウザが
     にじませて作るので、格子が崩れる。大きさは借りる側が決める */
  color: #ffffff; white-space: nowrap;
  font: var(--mmsxx-gui-font-size, 16px) var(--mmsxx-gui-font, monospace);
  letter-spacing: 0;
}
/* 触れているあいだと、一度でも触ったあとは出さない。
   **点滅はしない**(目印の外に置いてあるため) */
.mmsxx-touch-dpad.used .mmsxx-touch-callout,
.mmsxx-touch-dpad.holding .mmsxx-touch-callout { display: none; }
/* ボタン側は場所が動かないので、丸の真ん中に重ねる */
.mmsxx-touch-shot .mmsxx-touch-callout {
  /* 丸のすぐ下。PAD の DRAG ME と同じくらいの近さにする */
  left: 50%; top: auto; bottom: calc(10% - 1.5em);
}
.mmsxx-touch-shot.used .mmsxx-touch-callout { display: none; }

/* 十字。**触れたところが原点**で、絵ごとそこへ移る。
   四角 4 つを、原点から一定の距離(--r)に置く */
.mmsxx-touch-stick {
  position: absolute; display: none; width: 0; height: 0;
}
/* 原点の下敷き。**既定では何も出さない。**
   setSkin({ ring: 'url(...)' }) を渡したときだけ見える */
.mmsxx-touch-ring {
  position: absolute;
  left: calc(var(--r) * -1); top: calc(var(--r) * -1);
  width: calc(var(--r) * 2); height: calc(var(--r) * 2);
  background-size: 100% 100%; background-repeat: no-repeat;
  background-image: var(--ring-img, none);
}
/* 指そのものの印。**既定では何も出さない。**
   絵を差したいときだけ見える(背景を入れれば、その絵が指に付いてくる) */
.mmsxx-touch-knob {
  position: absolute; width: 20px; height: 20px; margin: -10px 0 0 -10px;
  display: none; background-size: 100% 100%; background-repeat: no-repeat;
  background-image: var(--knob-img, none);
}

/* アナログパッドの土台。**棒の頭が動きまわる窪み**に見せる。
   外側の輪は倒し量の目盛りでもある(**頭がここへ届いたら全速**)ので、
   どこまで倒せばよいかが触る前から見えている。
   色は薄い白で置く。**絵と同じ紺だと消える**(下敷きが紺の丸)ので、
   絵を差し替えても、明るくても暗くても残るようにする */
.mmsxx-touch-dial {
  position: absolute;
  left: calc(var(--r) * -1); top: calc(var(--r) * -1);
  width: calc(var(--r) * 2); height: calc(var(--r) * 2);
  border-radius: 50%;
  background: rgba(8, 14, 30, 0.45);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.22);
}
/* 棒の頭。**倒したぶんだけ土台の中を寄っていく**(--cx / --cy は JS が入れる)。
   触れていないときの目印では真ん中のまま出る(倒していないので 0)。
   大きさは土台の 4 割。**これより小さいと棒に見えず、
   大きいと寄る先が無くなって倒しているのか分からない** */
.mmsxx-touch-cap {
  position: absolute;
  left: calc(var(--r) * -0.4); top: calc(var(--r) * -0.4);
  width: calc(var(--r) * 0.8); height: calc(var(--r) * 0.8);
  border-radius: 50%;
  background: #3d5f96;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.34);
  transform: translate(var(--cx, 0px), var(--cy, 0px));
}

/* **倒している向きと強さ。丸めずそのまま出す。**
   0 度が右(atan2 と同じ)。角度は --deg、長さは --len に JS が入れる。
   入れ物は大きさを持たない点なので、回しても原点は動かない */
.mmsxx-touch-needle {
  position: absolute; left: 0; top: 0; width: 0; height: 0;
  display: none;
  transform: rotate(var(--deg, 0deg));
}
.mmsxx-touch-needle i {
  position: absolute;
  left: 0; top: calc(var(--r) * -0.14);
  width: var(--len, 0px); height: calc(var(--r) * 0.28);
  background: #cca31b;
  /* お尻を細く、先を尖らせる。短いときでも向きが読める形 */
  clip-path: polygon(0% 32%, 74% 4%, 100% 50%, 74% 96%, 0% 68%);
}
/* 振り切っているあいだ。長さはもう伸びないので、色でそれと分かるようにする */
.mmsxx-touch-needle.full i { background: #ffcc22; }
/* ショット。面の横溝で「こする場所」だと見せる */
/* ボタンのエリア。**反応するのはこのエリア全体。**
   背景は既定では何も出さない(setSkin({ shotArea }) で差せる) */
.mmsxx-touch-shot {
  background-size: 100% 100%; background-repeat: no-repeat;
  background-image: var(--shotarea-img, none);
}

/* こすりかたの絵。ボタンの上に白で重ねる。
   **丸より大きくする。** はみ出して構わないこと(受けるのはエリア全体)を見せるため。
   斜めに行ったり来たりを繰り返して、こする動きそのものを示す。

   **ふだんは出さない。** 遊びはじめに数秒だけ出していたころは、
   まだこする場面でもないうちから視界に居るだけだった。
   出すのは**それが要る場面**(ボスが無防備になった瞬間)だけ ── rubDemo() */
.mmsxx-touch-gesture {
  /* 絵の外枠。**矢印はこの 34/48 を占める**(7〜41)。
     丸(ボタンの絵)は、その矢印の 9 割の大きさにしてある */
  --box: calc((var(--r) * 2.8 - 40px) * 1.6);
  --btn: calc(var(--box) * 34 / 48 * 0.9);
  display: none;
  position: absolute; left: calc(50% + var(--shot-shift, 0px)); pointer-events: none;
  transform: translate(-50%, 0);   /* 動きを止めてもずれないよう、ここでも寄せておく */
  bottom: calc(10% - (var(--box) - var(--btn)) / 2);
  width: var(--box); height: var(--box);
  fill: none; stroke: #ffffff; stroke-width: 1.3;
  stroke-linecap: square; stroke-linejoin: miter;
}
/* **呼ばれたときだけ出す。** 出しているあいだに下の動きが 1 巡する */
.mmsxx-touch-shot.rubdemo .mmsxx-touch-gesture { display: block; }
/* 指は塗りつぶし。線と同じ白 1 色 */
.mmsxx-touch-finger { fill: #ffffff; stroke: none; }
/* こすりかたは斜めの往復だけではないので、**途中でくるくるも見せる** */
.mmsxx-touch-rub {
  animation: mmsxx-touch-scrub 0.32s ease-in-out infinite alternate;
}
@keyframes mmsxx-touch-scrub {
  0%   { transform: translate(-7px, 7px); }
  100% { transform: translate(7px, -7px); }
}
/* まわりかた。原点で回してから外へずらし、逆に回して向きを戻す */
.mmsxx-touch-spin {
  animation: mmsxx-touch-spin 0.9s linear infinite;
}
@keyframes mmsxx-touch-spin {
  from { transform: rotate(0deg) translate(7px, 0) rotate(0deg); }
  to   { transform: rotate(360deg) translate(7px, 0) rotate(-360deg); }
}
/* 3 秒ずつ入れ替えて、**2 とおり見せたら指は消える**。
   こすりかたは 2 つ(斜めの往復・くるくる)しかないので、見せ終わったら用が済む。
   **infinite にしない**のはそのため。forwards で消えたまま留める */
.mmsxx-touch-way1 { animation: mmsxx-touch-way-a 6s steps(1) 1 forwards; }
.mmsxx-touch-way2 { animation: mmsxx-touch-way-b 6s steps(1) 1 forwards; }
/* **こちらも 100% を書く。** 書かないと、終わったときに元の値(1)へ戻って
   1 つめの指が出たまま居座る(実際そうなった) */
@keyframes mmsxx-touch-way-a { 0% { opacity: 1; } 50% { opacity: 0; } 100% { opacity: 0; } }
/* **100% で 0 に戻す**のを忘れないこと。書かないと 2 つめが出たまま残る */
@keyframes mmsxx-touch-way-b { 0% { opacity: 0; } 50% { opacity: 1; } 100% { opacity: 0; } }

/* ボタンの絵。**指はエリア全体で受けるので、これは見せるだけ**。
   同系色で少し違う色の枠線を付けた素朴な丸 */
/* 輪と中身を同じ色にして、あいだに隙間を空ける。
   隙間は padding、輪は border。background-clip で中身だけを塗る */
.mmsxx-touch-fire {
  /* **大きさは PAD に合わせる**(矢印の外端までと同じ差し渡し)。
     指を受けるのはエリア全体なので、この大きさは見た目だけの話 */
  /* **十字と同じ高さまで下げる。** あちらは _anchor() で --r の 0.3 ぶん
     下げてあるので、こちらも同じだけ下げる。そろえないと、下の説明文字との
     間隔が左右で違って見える */
  /* **外側へ寄せるぶん**(--shot-shift)。器が帯のかぶせ量から決めて渡す。
     真ん中のままだと、かぶせたぶん丸がゲーム画面に掛かる */
  position: absolute; left: calc(50% + var(--shot-shift, 0px));
  bottom: calc(10% - var(--r) * 0.3);
  transform: translateX(-50%);
  /* 絵の矢印の 9 割 …… から **さらに 8 掛け**。
     叩いて動かす遊びかたでは、こするのは「あれば効く」ものになったので、
     そのぶん場所を返す。**受け場所は別に測っている**(_fitShotHit)ので、
     ここを縮めれば押すところも一緒に縮む */
  width: calc((var(--r) * 2.8 - 40px) * 1.6 * 34 / 48 * 0.9 * 0.8);
  height: calc((var(--r) * 2.8 - 40px) * 1.6 * 34 / 48 * 0.9 * 0.8);
  box-sizing: border-box; pointer-events: none; border-radius: 50%;
  border: 9px solid #224466;    /* 輪 */
  padding: 11px;                /* 隙間 */
  background-color: #224466;    /* 中身。矢印のふだんの色と同じ */
  background-clip: content-box;
  background-origin: content-box;
  background-size: 100% 100%; background-repeat: no-repeat;
  background-image: var(--fire-img, none);
}
/* **触れているだけでは色を変えない。** 撃った瞬間だけ、控えめに明るくする
   (黄色にしたり強く光らせたりすると目に障る) */
/* 撃った瞬間。**中身はそのまま、輪だけ黄色**(矢印が押されたときと同じ色)。
   色は keyframes だけで付ける。規則に書くと、animation が終わったあとも
   その色のまま残ってしまう */
.mmsxx-touch-fire.hit {
  background-image: var(--fire-img-on, var(--fire-img, none));
  animation: mmsxx-touch-flash 120ms steps(2, jump-none);
}
@keyframes mmsxx-touch-flash {
  0%   { border-color: #cca31b; }
  100% { border-color: #224466; }
}
/* PAUSE の札。
 *
 * **使いにくいところ**(2026-08-10、組み込んで分かったこと)。
 * engine/util/touchgui.js と一緒に使うときは、**こちらは伏せて器の
 * ボタンに一本化している**。単体で使うぶんには今までどおり動く。
 *
 *   1. **場所が「ショットのエリアの中」に縛られる。** 渡された入れ物の
 *      中にしか置けないので、器の側が「上の段はボタン、下の段は遊びのもの」
 *      と決めても、それに合わせて動かせない
 *   2. **文言を場面で変えられない。** ここが出せるのは PAUSE ひとつだけ。
 *      実際には遊んでいる最中は PAUSE、メニューでは RESUME / BACK /
 *      CANCEL と書き替えたかった
 *   3. **同じ場所に器のボタンが来ると二重になる。** 持ち主が違うので、
 *      大きさ・端寄せ・字の大きさを片方だけ直して取り残す事故が実際に
 *      何度も起きた(文言が ESC のまま、高さだけ 44px のまま、など)
 *   4. **狭い機種の事情を知らない。** 帯が細いときにボタンを外側の端へ
 *      寄せる、といった判断は器の側にしか材料がない
 *
 * つまり **「ボタンを 1 つ持つ」ところまでが、この部品の役目としては
 * 半端だった**。次に手を入れるなら、ここは絵と当たり判定だけにして、
 * ボタンは丸ごと借りる側へ渡してしまうほうがよい。
 *
 * 大きさは器のボタン(.mmsxx-gui-btn)にそろえてある。同じ場所に
 * 入れ替わりで出るものなので、違うと切り替わった拍子に飛び跳ねて見える */
.mmsxx-touch-pause {
  position: absolute; top: 22px;
  left: 50%; transform: translateX(-50%);
  width: max-content; min-width: 62%; max-width: calc(100% - 4px);
  padding: 7px 8px; box-sizing: border-box;
  background: #333344; border: 2px solid #8888aa; color: #ccccdd;
  font: var(--mmsxx-gui-font-size, 16px) var(--mmsxx-gui-font, monospace);
  letter-spacing: 0;
  display: flex; align-items: center; justify-content: center;
}
.mmsxx-touch-pause.on { background: #8888aa; color: #111122; }
`;
  document.head.appendChild(s);
}
