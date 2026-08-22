// サンプル縦スクロールシューティング "STAR RAID"
// 操作: カーソルキー = 移動, SPACE = ショット
// P アイテムでショットが 1way -> 3way -> 5way。被弾で 1 段階ダウン、1way で被弾すると 1 ミス。
// ステージ後半は月面上空、最後にタコ型ボス。

import { MMSXXEngine, SCREEN_W, SCREEN_H, BITRATE } from '../engine/engine.js';
// ランキングは「読み出しは同期のまま、背後で取り直す」形の表を使う。
// 供給元は手元の localStorage とランキングサーバの 2 つ。RANK_MODE で選ぶ
// (docs/RANKING_PLAN.md)
import { RankingBoard, LocalRankingSource, byScore, byTime } from '../engine/util/ranking-board.js';
// サーバへ繋ぐ部品は online/ にあり、**読み込むのは繋ぐときだけ**(動的 import)。
// online/ が無くても手元の保存で遊べる → makeRemoteRankSource() を見ること
import { StoryScenes } from '../engine/util/story.js';
import { StaffRoll } from '../engine/util/staffroll.js';
import { Gallery } from '../engine/util/gallery.js';
import { SoundTest } from '../engine/util/soundtest.js';
import { FpsMeter } from '../engine/util/fps.js';
import { StateMeter } from '../engine/util/statemeter.js';
import { demoFor, scaleDemo, drumKitDemo, beatTune } from '../vendor/mmsxx-mml-studio/sound/demotunes.js';
import { SaveGroup, T, R } from '../engine/util/savedata.js';
import { pickLanguage } from '../engine/util/lang.js';
import { SpriteCombo } from '../engine/util/spritecombo.js';
import { StateMachine } from '../engine/util/statemachine.js';
import { StatsLog } from '../engine/stats.js';
import { GAME_DATA } from './gamedata.js';
import { BUILD } from './build.js';
import { installConsoleGuard } from '../engine/util/console-guard.js';
// URL で変えられる画面まわりの設定(拡大率・色合い・スプライトの枚数・音など)
import { urlOptions } from '../engine/util/urloptions.js';
// どのゲームでも使う絵(音のラッパなど)。**画面と DOM を同じ並びから作る**
import { ICONS, iconSymbol, iconDataURL } from '../engine/util/icons.js';
// 絵を画像に書き出す道具(開発用)
import { exportSymbol, exportSheet, downloadArt } from '../engine/util/artexport.js';
// 端末の見分け。**エンジンは npm の部品に依存しない**ので、
// ちゃんと見分けたいゲームが自分で入れて差し替える(ここがその例)
import { useUAParser, isMobileLike } from '../engine/util/device.js';
// ゲームパッド。**キーのコードへ変換して Input へ流す**だけなので、
// 遊びのコードはキーボードのときのまま動く(engine/util/gamepad.js)
import { createGamepad } from '../engine/util/gamepad.js';
// スマホのタッチ操作。十字とショット・ジェスチャの見分け・案内の出し分けをまとめた器。
// こちらもキーのコードへ変換して Input へ流すので、遊びのコードは変えなくてよい
import { TouchGui, viewTransform, turnDelta } from '../engine/util/touchgui.js';
// シェアの板の上でコマを選ぶ横払い。見分けそのものはこの部品にまかせる
import { createGesture } from '../engine/util/gesture.js';
// PC の窓の中に実機と同じ画角を作るための、機種ごとの数字(?device= で選ぶ)
import { DEVICES, findDevice } from '../engine/util/devices.js';
// キャンバスの上に重ねる知らせ(読ませてゲームを止める)
import { createNotice } from '../engine/util/notice.js';
// 段を選ぶボタン(何のつまみかと いまの段を 2 行で出し、左右で送る)
import { createStepper } from '../engine/util/stepper.js';
// パッドレスの移動(叩いた先へ自機が歩く。押したままずらすと角度を曲げられる)
import { createPadless } from '../engine/util/padless.js';
// なぞった道をたどる移動(指で線を引くと、始点まで行ってから道をなぞる)
import { createTrace } from '../engine/util/trace.js';
import Bowser from '../vendor/bowser/bowser.js';
// 開発者ツールで止まったときに見せる、このゲームのぶんの文章
import { gameStop } from './console-stop.js';

// ---- URL で変えられる設定 ----
// **遊ぶ人が触ってよいもの**だけをここに置く(ランキングの宛先などは別)。
//
//   ?linesprites=4  … **1 行**に出せるスプライトの数(0 = 無制限、16 まで。既定 4)
//   ?maxsprites=32  … 画面ぜんぶで出せる数(0 = 無制限、256 まで。既定 32)
//   ?rotate=stride  … 消える順の回しかた(step / stride / random / slow / off)
//   ?palette=rf     … 画面の色合い(tms9918 / toshiba / rf / v9938)
//   ?scale=4        … 画面の拡大率(1〜8。既定 8)
//   ?fps=60         … 1 秒あたりのコマ数(1〜120。既定 60。50 で実機の PAL ふう)
//   ?states=0       … 隅の「いまの局面」を消す(開発版だけ。既定は出す)
//   ?slow=24        … スプライトがこの数を超えたら処理落ちさせる(0 = しない)
//   ?slowfps=30     … 処理落ちしているときのコマ数(既定 30)
//   ?mute=1         … 音を消した状態で始める
//   ?volume=70      … 音の大きさ(0〜100。曲も効果音もまとめて動く)
//   ?mode=hard      … 始めかたを選ぶ(normal / hard / bossrush / staff / sound / chars)
//   ?turn=180       … 画面を上下逆さにして始める(ポーズ中のボタンと同じ)
//   ?stick=origin   … 十字の向きを「触れたところから」で決める(既定は指の動く向き)
//   ?areas=1        … 指を受ける場所を色分けして見せる(十字 = 青 / ショット = 赤)
//   ?snap=8         … 自機の向きを何方向へ丸めるか(0 / 4 / 8 / 16。既定 0 = 丸めない)
//   ?power=0        … 倒し量を速さに掛けない(既定は掛ける = そっと動かせば ゆっくり)
//   ?gain=1.41      … 自機の速さの倍率(0.5〜2。既定 1)。前の「斜めの速さ」に合わせる用
//   ?a2hs=1         … ホームに置くことを勧める 1 枚を、もう一度出す
//                     (ふだんは 1 回断られたら二度と出さない)
//                     ios / android / add と書くと、その見えかたで出る
//                     (手元で 3 通りを見比べるため)
//
// **開発版だけ効くもの**(公開版は URL に何を書いても無視する):
//
//   ?stage=3        … その面から始める
//   ?seed=12345     … 乱数の種を決める(同じ出かたをくり返し見られる)
//   ?invincible=1   … やられない(演出を見るため)
//
// 数や名前がおかしいときは、黙って既定のままにする
// (URL をいじって遊ぶ人が、動かない画面に当たらないように)
// 画面まわりの読み取りは**エンジン側が持っている**(engine/util/urloptions.js)。
// ここでやるのは、このゲームのぶんの決めごとだけ:
//
//   ・**fps は開発版だけ**にする(難しさを下げる道具にされないように)
//   ・既定値をこのゲームの好みに差し替える
//     1 行 4 枚(MSX1 なみ) / 画面ぜんぶで 32 枚(MSX なみ) /
//     回しかたは 'stride'('step' だと消える場所が流れて見えるため) /
//     大きさは 8 倍まで(置ける場所に収まる整数倍まで自動で下がる)
const OPT = new URLSearchParams(location.search);
// 端末の見分けを bowser にまかせる。**分からないときは undefined を返して**、
// エンジン側の目安(UA の正規表現や pointer: coarse)へ落ちるようにしておく。
// ?device=mobile / ?device=desktop を付けると、これより先に上書きが効く
useUAParser(() => {
  const type = Bowser.parse(navigator.userAgent).platform.type;
  return type ? type !== 'desktop' : undefined;
});
const URL_OPT = urlOptions(OPT, {
  dev: BUILD.dev,
  devOnly: ['fps', 'states'],
  defaults: { linesprites: 4, maxsprites: 32, scale: 8 },
});

// 裏画面は 256x1024 (横は画面ぴったり、縦に長くとってスクロールさせる)。
// レイヤーは 5 枚: 遠い星 / 中間の星 / 近い星 / 大きな背景オブジェクト(とボス) / HUD
const mmsxx = new MMSXXEngine(document.getElementById('screen'), {
  // 画面まわりは URL の指定をそのまま渡す
  // (拡大率・コマ数・処理落ち・スプライトの枚数・回しかた)。
  // 1 行 4 枚 / 画面ぜんぶ 32 枚 が既定。席の強さは rank で決めていて、
  // 自機は消えない / 弾はまっさきに譲る
  ...URL_OPT.engine,
  virtualWidth: 256, virtualHeight: 1024,
  layers: [{}, {}, {}, {}, {}, {}],
  // 内訳は 曲 6 + 撃つ音の席 2 + 当たった音の席 6 + 残り 6(レーザーなど)。
  // 席の分けかたは下の reserveSE を見ること
  maxVoices: 20,
  // ノイズは種類ごとに席を取っておく(下の reserveSE)。その合計ぶん要る
  maxNoise: 4,
  // 開発版かどうかは**ビルドで決める**(場所では決めない)。
  // これ 1 つで、シーン選択・コンソール関数・画面の保存・
  // 開発用の裏技・BG の検査が まとめて出入りする
  dev: BUILD.dev,
});
/** 開発用の機能を出すか。細かい出し分けはこれを見て決める */
const DEV = mmsxx.dev;

// **上下を逆さにして始める口**(?turn=180)。
// ふだんはポーズ中のボタンで回すが、写真を撮るときや、
// 回した状態から始まる見えかたを確かめたいときのために URL でも入れられる。
// **?rotate= は先客(消える順の回しかた)** なので、名前を分けてある。
// 数字は 0 か 180 だけ。90 度は無い(縦横の食い違いは自動で合わせている)
if (OPT.get('turn') === '180') {
  mmsxx.vdp.upsideDown = true;
  mmsxx.vdp.refitCss();
}

// ゲームの設定。進みぐあいや遊んだ記録とは別に持つ(消したい単位が違う)
const settings = new SaveGroup('starfable-settings', {
  mute: { type: T.FLAG, label: 'MUTE' },
  // 画面の大きさ(左上の ＋ / − で決めたぶん)。**1 は「置けるだけ大きく」**。
  // 覚えておかないと、開き直すたびに決め直すことになる
  zoom: { type: T.NUMBER, min: 0.4, max: 1, digits: 2, label: 'SCREEN SIZE' },
  // **決めたことがあるか**の印。数だけだと「まだ決めていない」と
  // 「いちばん小さくした」が見分けられない(読めない値のときは下限が返る)
  zoomSet: { type: T.FLAG, label: 'SCREEN SIZE SET' },
  // ドットをそろえる(整数倍へ切り下げる)か。既定は「置けるだけ大きく」
  pixelFit: { type: T.FLAG, label: 'PIXEL PERFECT' },
  // 触ったことがあるかの印。**既定が入りなので、値だけでは切ったのか未設定か分からない**
  pixelFitSet: { type: T.FLAG, label: 'PIXEL PERFECT SET' },
  // 十字の効きぐあい(0 = にぶい / 1 = ふつう / 2 = びんかん)と、決めたことがあるかの印
  padSense: { type: T.NUMBER, min: 0, max: 2, digits: 0, label: 'PAD SENSITIVITY' },
  padSenseSet: { type: T.FLAG, label: 'PAD SENSITIVITY SET' },
  // 動かしかた(0 = 十字 / 1 = 行き先 1 つ / 2 = 2 つ / 3 = なぞる)。
  // **並びを変えたら、覚えてある番号の意味も変わる**
  // (前に選んでいた人は、次に開いたとき別のものが選ばれている)
  padTargets: { type: T.NUMBER, min: 0, max: 3, digits: 0, label: 'CONTROL' },
  padTargetsSet: { type: T.FLAG, label: 'CONTROL SET' },
  // 十字の効きぐあい。**段の番号で覚える**(値そのものではない ——
  // 表を詰め直したときに、前に選んだ段がそのまま残るように)
  padfeel: { type: T.NUMBER, min: 0, max: 3, digits: 0, label: 'PAD FEEL' },
  padfeelSet: { type: T.FLAG, label: 'PAD FEEL SET' },
  // 遊びかたの案内を一度でも出したか(**出すのは初めての 1 回だけ**)
  howToSeen: { type: T.FLAG, label: 'HOW TO PLAY SEEN' },
});
// 前に音を消したままなら、消した状態で始める。
// **?mute= は次の行で効く**ので、URL で指定したぶんが優先される
if (settings.get('mute')) mmsxx.audio.mute(true);
/** 音を消す / 戻す。覚えておいて、次に開いたときも同じ状態にする */
function setMute(on) {
  const off = mmsxx.audio.mute(on);
  settings.set('mute', off);
  settings.flush();
  drawMuteBtn();
  return off;
}
/** 音が消えていることを知らせたか(知らせるのは 1 回だけ) */
let muteTold = false;

// ---- 音のアイコン ----
// **絵はエンジンが持っている**(engine/util/icons.js の ICONS.soundOn / soundOff)。
// 画面のスプライトも DOM のボタンも同じ並びから作るので、食い違わない。
// ここで決めるのは**色だけ**
const ICON_BODY = 15;                  // 本体(白)
const ICON_ON_ACCENT = 7;              // 音が出ているとき(水色。波紋のぶん)
const ICON_OFF_ACCENT = 8;             // 消しているとき(赤)
/** 効いていない切り替えボタンの差し色(灰)。**枠は白のまま、中だけ沈める** */
const ICON_MONO = 14;
/** いまの状態の並びと差し色 */
const muteIconArt = (off) => ({
  rows: off ? ICONS.soundOff : ICONS.soundOn,
  accent: off ? ICON_OFF_ACCENT : ICON_ON_ACCENT,
  key: off ? 'soundOff' : 'soundOn',
});
let muteIconSp = null;
/** 知らせの中のアイコンを、その桁へ置く。col は文字の何番目か */
function showMuteIcon(off, text, col) {
  const art = muteIconArt(off);
  if (!muteIconSp) {
    muteIconSp = mmsxx.sprite(iconSymbol(mmsxx, art.rows,
      { body: ICON_BODY, accent: art.accent, name: art.key }));
    muteIconSp.priority = 20;
  }
  muteIconSp.image = iconSymbol(mmsxx, art.rows,
    { body: ICON_BODY, accent: art.accent, name: art.key });
  muteIconSp.x = centerX(text) + col * 8;
  // 絵は 16 ドット、文字の行は 8 ドット。**4 ドット上げて**真ん中をそろえる
  muteIconSp.y = noticeY - 4;
  muteIconSp.visible = true;
}
/** 知らせが消えるときに一緒に消す */
function hideMuteIcon() { if (muteIconSp) muteIconSp.visible = false; }

/**
 * 音が消えたままなことを知らせる。戻しかたは端末で言いかたを変える。
 *   PC     … ALT+M TO UNMUTE(音が出る絵)
 *   スマホ … TAP(音が消えている絵)TO UNMUTE
 * アイコンのぶんは空白 2 つで空けておき、そこへスプライトを重ねる
 */
function tellMuted() {
  const mobile = isMobileLike();
  const text = mobile ? 'TAP    TO UNMUTE' : 'ALT+M TO UNMUTE  ';
  const col = mobile ? 4 : 15;
  showNotice(text, 180, 176, 8);
  showMuteIcon(mobile, text, col);
}

// ---- 画面の下のボタン(DOM) ----
// **キャンバスの外に置く**ので、共有の絵にも録画にも写らない。
// ALT+M はキーボードのある人向けの近道として残し、こちらを正規の入口にする
const muteBtn = typeof document !== 'undefined' ? document.getElementById('mute') : null;
/**
 * いまの状態を絵で出す(消えていれば「音なし」の絵にする)。
 * 絵は**画面のスプライトと同じ並び**から 2 倍で作る(engine/util/icons.js)
 */
function drawMuteBtn() {
  if (!muteBtn) return;
  const off = mmsxx.audio.muted;
  const art = muteIconArt(off);
  try {
    const url = iconDataURL(mmsxx, art.rows,
      { body: ICON_BODY, accent: art.accent, scale: 2, key: art.key });
    muteBtn.style.backgroundImage = `url("${url}")`;
    muteBtn.textContent = '';
  } catch (e) {
    // 絵が作れない環境では、今までどおり絵文字で出す
    muteBtn.textContent = off ? '\u{1F507}' : '\u{1F50A}';
  }
  muteBtn.setAttribute('aria-label', off ? 'SOUND OFF' : 'SOUND ON');
}
if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    // 押したあと焦点が残ると、そのあとの SPACE でまた押されてしまう
    muteBtn.blur();
    // **画面には知らせを出さない**。絵が入れ替わるので伝わるうえ、
    // 知らせは画面の下(y=176)を消してしまい、タイトルの著作権表示などを
    // 上書きしたまま戻さないため
    setMute();
  });
  drawMuteBtn();
}

// ---- シェアのボタン ----
// **ALT+P だけでは気づかれない**ので、音のボタンの下に置く。
// ここはゲームの中ではなく**外の世界(SNS)へ出す口**なので、
// ドット絵ではなく、ふつうのサイトと同じ見た目にしてある。
// 絵(X の公式マーク)と見た目は index.html 側
const shareBtnEl = typeof document !== 'undefined' ? document.getElementById('share-btn') : null;
if (shareBtnEl) {
  shareBtnEl.addEventListener('click', () => {
    shareBtnEl.blur();   // 焦点を残さない(そのあとの SPACE で押し直されるのを防ぐ)
    openShare();
  });
}

// ---- 開発版の印 ----
// **画面の中には描かない**。撮った絵や動画に写ってしまうため、
// キャンバスの外(DOM)に小さく出す。公開版では出ない
{
  const el = typeof document !== 'undefined' ? document.getElementById('dev-badge') : null;
  if (el && BUILD.dev) {
    el.style.display = 'block';
    // **手元用のビルド番号を添える。** 公開版は版のうしろに番号が付くが、
    // 手元は固めないので付かず、**ブラウザが古いままなのか直っていないのか**が
    // 見分けられなかった。開発サーバがソースの更新時刻から数える
    fetch('/__devbuild').then((r) => r.json()).then((d) => {
      el.textContent = 'DEV #' + d.n + ' ' + d.at;
    }).catch(() => { /* 開発サーバ以外で開いたときは、ただの DEV のまま */ });
  }
}

// 色合いと音は、エンジンを作ったあとに効かせる(?palette= / ?mute= / ?volume=)
// 局面の移り変わりの記録。**開発版だけ**取る
// (コマ番号は道具のほうでは分からないので、こちらから渡す)
if (DEV) StateMachine.clock = () => mmsxx.frame;
else StateMachine.logMax = 0;
URL_OPT.apply(mmsxx);
// **開発版だけ**: 乱数の種を決める。同じ出かたをくり返し見られる
if (DEV) {
  const v = OPT.get('seed');
  if (v != null && v !== '' && Number.isFinite(Number(v))) mmsxx.rng.seed(Number(v));
}
/** **開発版だけ**: やられない(演出を見るため) */
const NO_DAMAGE = DEV && OPT.get('invincible') === '1';


// **音の席を種類ごとに取っておく**。
// 優先度だけで取り合わせると、撃つ音が鳴りつづけているあいだ
// 場所が空かず、**当たった音と爆発が聞こえなくなる**。
// 撃つ音と、当たった音・爆発を別の席にしておけば、互いに消し合わない。
// 名前を書いておけば鳴らす側は今までどおりでよい(席は自動で決まる)
mmsxx.audio.reserveSE({
  shot: { voices: 2, noise: 1, names: ['shot'] },
  hit: {
    // 大きな爆発(3 声)と小さな爆発(2 声)が重なっても入る広さ
    voices: 6, noise: 2,
    names: ['hit', 'clink', 'thud', 'guardhit', 'boom', 'bigboom', 'bossboom'],
  },
});

// **ゲームの結果に効く乱数は種つき**にする(あとで操作の記録から再現できるように)。
// 見た目だけのもの(爆発の粒・画面揺れ・背景の賑やかし)は `Math.random()` のまま。
//
// 流れは 2 本。**ボスの動き**と、**それ以外**(敵の出現・アイテム・面の作り)。
// 分けてあるので、ステージのコードを直してもボスの引く数列は変わらない
// (作っている最中に「ボス戦だけ同じ条件でくり返す」ができる)。
// 種はゲームを始めるたびに作り直すので、遊ぶぶんには毎回ちがう
const rnd = () => mmsxx.rng().next();
const rndBoss = () => mmsxx.rng('boss').next();
// ---- 開発用の口 ここから ----
// コンソールから触れる入口は、開発版のときだけ付く(公開版では名前ごと無い)
mmsxx.expose('mmsxx', mmsxx);
// ---- 開発用の口 ここまで ----
// 公開版では、コンソールを開いた人にだけ見えるロゴとひとことを出す。
// ゲームの動きには関わらない、おまけの隠し要素。
// -LogoTrap 付きでビルドすると、ロゴを見てもらうために
// コンソールを開いているあいだ ゲームが止まる
if (!DEV || BUILD.logoTrap) {
  installConsoleGuard({
    // art にアスキーアートを渡すと、名乗りの前に出せる(いまは使っていない)
    title: 'STAR FABLE ' + BUILD.version,
    lines: [
      'A demo game built with the MMSXX Engine.',
      "Packed with homages to 1980s shoot-'em-ups.",
    ],
    // このあとに、エンジンの名乗り(MMSXX ENGINE)が必ず続く。
    // trap は「ロゴを見てもらうために止める」おまけ。
    // ゲームのぶん(game/console-stop.js)が先に止まり、
    // そのあとエンジンのぶんが止まる。それぞれ 1 回ずつ
    trap: BUILD.logoTrap === true,
    stop: gameStop,
  });
}
// 画面のまわりに 8 ドットのボーダーを持たせる。
// ここには何も描かれず、背景色で塗られる(実機の描画領域の外の遊び)。
// 被弾したときは、この余白のぶんだけ画面全体をずらして揺らす。
// **録画と画面の保存では 4 ドットに詰める**(下の REPLAY_BORDER)
mmsxx.setBorder(8);

// ---- アセット読み込み(RGBA -> MSX変換はエンジンが自動で行う) ----
// スプライトは MSX1 実機風に色数を落とす:
//   自機・ボス・アイテム = 2色 (単色スプライト2枚重ねという体) / 敵・弾・爆発 = 1色
// SE の優先度。数が大きいほど強い。
//   SE_JINGLE  ファンファーレなど(独り占めして、ほかを全部止める)
//   SE_HIT     ショット・爆発・ヒット(ジングルの次に強い = いつも聞こえる)
//   SE_EVENT   レーザーなど、聞こえてほしい演出
const SE_JINGLE = 9, SE_HIT = 5, SE_EVENT = 3;
// 長い効果音は 0.4 秒のかたまりに分けてあるので、鳴らす側でこの間隔でくり返す。
// (長い音のままだとポーズしても鳴り止まないため)
const SE_CHUNK = 24;

// BG スプライトの優先度は、レイヤーと同じ空間を使う。
// 数字 n は「レイヤー n の手前」という意味になる。
//   0 遠い星 / 1 中間の星 / 2 近い星 / 3 大きな背景オブジェクト / 4 HUD
const BGP_SHOOT = 2;   // 流れ星: 近い星の手前、大きな背景オブジェクトより奥
const BGP_FRONT = 3;   // 敵・ボスなど: 背景オブジェクトより手前


// スプライトに使う絵の一覧と、**その絵が使ってよい色数**。
// 実機のスプライトは 1 枚 1 色。2 と書いてあるものは「2 枚重ねという体」。
//
// **減色はしない**。素材の時点で正しい色数になっている前提で、
// 違っていたらエンジンが弾く(開発版は例外、公開版は警告)。
// ここに名前が無い絵は BG(横 8 ドット 2 色)として読む
// スプライトとして持ちつつ、BG にも置く絵。`名前 + 'BG'` で BG 用の型が作られる
const BG_TWINS = new Set(['weight16t']);
/**
 * **色を置き換えて描く絵**(エンディングの 1 枚絵。GAME_DATA.duo の相手)。
 *
 * この絵の色番号は**色そのものではなく目印**で、描くときに colorMap で
 * 実際の色へ置き換える(1 ライン おきに 2 通り使い分けて中間色を作る)。
 *
 * **だから埋め色で塗ってはいけない。** エンジンは「1 ドットでも絵のあるマスは
 * 残りを埋め色(1)で塗る」という実機の見えかたを焼き込むが、ここでは
 * **その 1 が目印の 1 として読まれ、別の色に化ける**。
 * 実際、透けているはずの周りが pilot では 7000 ドット以上 塗られて、
 * それが colorMap で 5 や 14 に置き換わっていた(エンディングの 4 枚が全部おかしかった)。
 *
 * 埋め色に 0(透明)を渡すと、塗るところが無くなって焼き込みが素通りする
 */
const BG_NO_FILL = new Set([
  'earthBig', 'endBase', 'pilot',
  'endRift', 'endRift0', 'endRift1', 'endRift2',
]);
const SPRITE_COLORS = {
  player: 2, bossEye: 1, bossEye2: 1, octoMouth: 1, ufoGuard: 1, item: 1, star: 1,
  bomb: 1, speedUp: 1, rapidUp: 1, oneUp: 1,
  flameSmall: 1, flameSmallB: 1, flameBig: 1, flameBigA: 1, flameBigB: 1,
  flameDragon: 1, flameDragonA: 1, flameDragonB: 1, barrier: 1,
  enemyA: 1, enemyB: 1, enemyC: 1, enemyF: 1, enemyG: 1, warper: 1,
  cube: 1, bouncer: 1,
  weight16t: 1,   // 16t のおもりは青 1 色のスプライト(文字は抜き)
  rammer: 1, eyeVein: 1, asteroidHi: 1,
  octoArms: 1, octoCrown: 1, crabBigClaw: 1,
  crabPod: 1,
  chargeOrb0: 1, chargeOrb1: 1, chargeOrb2: 1,
  chargeRing0: 1, chargeRing1: 1, chargeRing2: 1,
  bulletP: 1, bulletE: 1,
  aimMark: 1, aimMark1: 1,   // パッドレスの行き先の印(赤 / ピンクの 2 枚)
  coinItem: 1, autoItem: 1, dragonItem: 1, candyItem: 2,
  boom0: 1, boom1: 1, boom2: 1,
  // ラスボス。シルエットマンは黒 1 色、回転レーザーの粒も単色
  kingMan00: 1, kingMan00b: 1, kingMan01: 1, kingMan01b: 1, kingMan02: 1, kingMan04: 1, kingMan05: 1, kingMan05b: 1,
  kingMan06: 1, kingMan06b: 1, kingMan07: 1, kingMan08: 1, kingMan09: 1, kingMan10: 1,
  kingMan11: 1, kingMan12: 1,
  kingWaveL: 1, kingWaveM: 1, kingWaveS: 1,
  // 型を分けたときに、宣言もれが見つかったぶん
  powerUp: 1, eyeIris0: 1, gearGem: 1, glower0: 1, spark0: 1, todoGlint: 1,
  deathSpark: 1,   // 自機が散るときの光(白 1 色。色は使う側で替える)
  deathCore0: 2,   // 自機が散るときの芯(16x16 の 2 コマアニメ。白 + 水色)
  deathCore1: 2,
  barrierItem: 1, bulletRing: 1, enemyH: 1, enemyI: 1, enemyJ: 1,
  fireBall: 1, fireBall1: 1, fireBall2: 1, fireM0: 1, fireM1: 1, fireS0: 1, fireS1: 1,
  chick0: 1, chick1: 1,   // 気絶のときに頭を回るひよこ
  // ラスボスのレーザー線(16 方向)。長い版は 5 面ではるか前方から飛んでくる
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => ['kingLine' + i, 1])),
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => ['kingLineL' + i, 1])),
  // ボスの目の**向きちがい**(16 方向を 5 枚 + 反転でまかなう)。
  // ここに載せないと BG の絵として読まれ、スプライトの側から見つからないので、
  // いつも真ん中を見ている絵に落ちてしまう
  ...Object.fromEntries(['20', '21', '11', '12', '02'].flatMap(
    (k) => [['bossEye' + k, 1], ['bossEye2_' + k, 1]])),
  pilotPupil: 1, pilotSmile: 1, pilotWink: 1,
  markLol: 1, markWw: 1, markW: 1,   // エンディングに置く茶々(白 1 色)
  todoBlush: 2,   // 赤みと影の 2 色
  riftGlow: 2,    // 水色と白の 2 色
};
// 絵は**用途ごとに別の入れもの**へ入れる。
// 取り違えたら、渡した先(sprite() / draw())でその場で分かる
const SPRITE_SYMBOLS = {};   // スプライトに使う絵
const BG_SYMBOLS = {};       // BG(レイヤーと BG スプライト)に使う絵
for (const [name, im] of Object.entries(GAME_DATA.images)) {
  const raw = MMSXXEngine.imageFromBase64(im.b64, im.width, im.height);
  // 絵は**ここで型を決めて作る**。決まりを守っているかの検査もここだけ。
  // SPRITE_COLORS に載っている名前がスプライト用、それ以外は BG 用。
  // 名前を渡しておくと、引っかかったときに**どの絵か**が出る
  if (SPRITE_COLORS[name]) {
    SPRITE_SYMBOLS[name] = mmsxx.spriteSymbol(raw, { name, colors: SPRITE_COLORS[name] });
  } else {
    // 色を置き換えて描く絵は埋めない(上の BG_NO_FILL を見ること)
    BG_SYMBOLS[name] = BG_NO_FILL.has(name)
      ? mmsxx.bgSymbol(raw, { name, backdrop: 0 })
      : mmsxx.bgSymbol(raw, { name });
  }
  // スプライトの絵を BG にも置きたいときは、BG 用の型も作る(図鑑の大きい絵)
  if (BG_TWINS.has(name)) BG_SYMBOLS[name + 'BG'] = mmsxx.bgSymbol(raw, { name: name + '(BG)' });
}

/** 変換済み画像の色を全部差し替えたコピーを作る(単色スプライトの色違い用) */
function recolor(img, color) {
  // **BG の絵は 8x8 セルに黒の下地が焼き込まれている**ので、下地は塗り替えない。
  // 実機でいえば「キャラクタパターンの色だけ変える」。
  // 塗ってしまうと、絵ではなく升目ごと光ってしまう
  const keepBack = img.canBgSprite !== undefined;
  const pixels = new Uint8Array(img.pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    const c = img.pixels[i];
    pixels[i] = (c === 0 || (keepBack && c === 1)) ? c : color;
  }
  // 型はそのまま引き継ぐ(色の置き換えは 1 対 1 なので、決まりは保たれる)。
  // **控えにも足しておく**(素材の一覧に出す。開発版だけ効く)
  return mmsxx.trackSymbol(
    img.derive(pixels, img.name ? img.name + '(単色' + color + ')' : img.name), img);
}
SPRITE_SYMBOLS.itemW = recolor(SPRITE_SYMBOLS.item, 15);   // アイテム点滅用(黄と白を1フレーム交互)
// 色違いで使い回していた敵は、それぞれ専用の絵に差し替えた
// (enemyC / enemyF / enemyG / warper は makedata.mjs で描き起こしている)
SPRITE_SYMBOLS.bulletB = recolor(SPRITE_SYMBOLS.bulletE, 8); // 赤い弾 = 撃ち落とせるボスの弾
SPRITE_SYMBOLS.cubeItem = recolor(SPRITE_SYMBOLS.cube, 3);   // 緑のキューブ = アイテム入り
SPRITE_SYMBOLS.starW = recolor(SPRITE_SYMBOLS.star, 15);     // ★の点滅用
// **宝珠は七色に光る。** ほかのアイテムより特別なものなので、
// 白との点滅ではなく色が回る形にする(HUD の取得ぶんも同じ色で回る)
const ORB_COLORS = [8, 9, 11, 3, 7, 5, 13];   // 赤 橙 黄 緑 水 青 紫
const ORB_IMAGES = ORB_COLORS.map((c) => recolor(SPRITE_SYMBOLS.star, c));
/** いまの色。i をずらすと、並んだものが順ぐりに光る */
const orbColor = (i = 0) => ORB_COLORS[(((mmsxx.frame >> 1) + i) % ORB_COLORS.length)];
SPRITE_SYMBOLS.asteroidHiWarn = recolor(SPRITE_SYMBOLS.asteroidHi, 11);  // 被弾時のハイライト(黄)
SPRITE_SYMBOLS.bulletRingCyan = recolor(SPRITE_SYMBOLS.bulletRing, 7);   // リング弾の色替え(水色)
SPRITE_SYMBOLS.crownCyan = recolor(SPRITE_SYMBOLS.octoCrown, 7);        // 未実装君の王冠(顔と色がかぶらないよう水色)
SPRITE_SYMBOLS.tearDrop = recolor(SPRITE_SYMBOLS.bulletP, 7);           // 未実装君の涙
// ドラゴンの炎。先頭を黄色、後ろへいくほど赤くして炎らしく見せる
for (const [n, col] of [['fireBall', 11], ['fireBall1', 11], ['fireBall2', 11],
  ['fireM0', 9], ['fireM1', 9], ['fireS0', 8], ['fireS1', 8]]) {
  SPRITE_SYMBOLS[n] = recolor(SPRITE_SYMBOLS[n], col);
}
SPRITE_SYMBOLS.ufoGuardHit = recolor(SPRITE_SYMBOLS.ufoGuard, 15);   // ガードの被弾点滅(白)
// 溜めエフェクトは黄(11)と白(15)を 1 コマずつ入れ替えて光らせる
for (const n of ['chargeOrb0', 'chargeOrb1', 'chargeOrb2',
  'chargeRing0', 'chargeRing1', 'chargeRing2']) {
  SPRITE_SYMBOLS[n + '0'] = recolor(SPRITE_SYMBOLS[n], 15);   // 白
  SPRITE_SYMBOLS[n + '1'] = recolor(SPRITE_SYMBOLS[n], 11);   // 黄
  SPRITE_SYMBOLS[n + '2'] = recolor(SPRITE_SYMBOLS[n], 7);    // 水色
}
BG_SYMBOLS.ufoFistHit = recolor(BG_SYMBOLS.ufoFist, 15);     // グーの被弾点滅(白)
BG_SYMBOLS.rocketHit = recolor(BG_SYMBOLS.rocket, 15);   // 被弾時の白い点滅
SPRITE_SYMBOLS.cubeAuto = recolor(SPRITE_SYMBOLS.cube, 11);  // 黄色のキューブ = ? アイテム入り
SPRITE_SYMBOLS.cubeStar = recolor(SPRITE_SYMBOLS.cube, 13);  // 紫のキューブ = 耐久力2倍・★入り
// ラスボスの回転レーザー。角度違いの線素材をまとめておく(1 発 = 1 枚)
const KING_LINES = [];
for (let i = 0; SPRITE_SYMBOLS['kingLine' + i]; i++) KING_LINES.push(SPRITE_SYMBOLS['kingLine' + i]);
// 同じレーザーの 3 倍長い版(48x48)。5 面ではるか前方から飛んでくるもの
const KING_LINES_LONG = [];
for (let i = 0; SPRITE_SYMBOLS['kingLineL' + i]; i++) KING_LINES_LONG.push(SPRITE_SYMBOLS['kingLineL' + i]);
// 裂け目が開くまでの途中のコマ。最後に開ききった姿(kingRift0)を足す
const KING_RIFT_OPEN = [];
for (let i = 0; BG_SYMBOLS['kingRiftOpen' + i]; i++) KING_RIFT_OPEN.push(BG_SYMBOLS['kingRiftOpen' + i]);
KING_RIFT_OPEN.push(BG_SYMBOLS.kingRift0);
// ゲーム側で足す波形メモリ。**曲を組み立てる前に登録する**
// (MML はここで名前を番号に直すので、あとから足しても間に合わない)。
// メインの曲の歌メロに使う。基音のうえに 3 倍・5 倍を強めに乗せた、
// リードらしい鼻にかかった音。5bit にして実機らしくざらつかせる
mmsxx.audio.addWave('wtLead', Array.from({ length: 32 }, (_, i) => {
  const p = i / 32;
  return 0.75 * Math.sin(2 * Math.PI * p)
    + 0.45 * Math.sin(2 * Math.PI * 3 * p)
    + 0.28 * Math.sin(2 * Math.PI * 5 * p)
    + 0.14 * Math.sin(2 * Math.PI * 7 * p);
}), 5);
for (const [name, mml] of Object.entries(GAME_DATA.bgm)) mmsxx.audio.defineBGM(name, mml);
// スタッフロールだけは音声ファイル(mp3)を使う。
// MML と同じように playBGM('staff') で鳴らせる
// 記録の画面で流すリズム曲。曲そのものはエンジン側(見本を兼ねている)
mmsxx.audio.defineBGM('beat', beatTune());
mmsxx.audio.defineBGM('staff', { url: './assets/staff.mp3', gain: 0.5 });
mmsxx.audio.defineBGM('finalbattle', { url: './assets/final_battle.mp3', gain: 0.6 });
for (const [name, mml] of Object.entries(GAME_DATA.se)) mmsxx.audio.defineSE(name, mml);
// しゃべる言葉(TALK)。録音は持たず、鳴らすときにフォルマント合成で作る
for (const [name, t] of Object.entries(GAME_DATA.talk || {})) {
  mmsxx.audio.defineTalk(name, t.text, t.opts);
}

const STAGE = GAME_DATA.stage;

// ---- 背景: 4レイヤー構成 ----
// layer0: 遠景の星 / layer1: 近景の星 / layer2: 大きな背景オブジェクト(とボス) / layer3: HUD
mmsxx.backdrop = 1; // 黒
const far = mmsxx.layer(0);   // 遠い星(暗い青灰)
const mid = mmsxx.layer(1);   // 中間の星(水色)
const near = mmsxx.layer(2);  // 近い星(白)
const neb = mmsxx.layer(3);   // 大きな背景オブジェクト / ボス
// ボスが画面の端から出ていくとき、反対側に絵が出てこないようにする
neb.setRepeat(false, true);
const hud = mmsxx.layer(4);
// 当たり判定の可視化(HITAREA コマンド)だけに使うレイヤー。いちばん手前
const dbg = mmsxx.layer(5);
const VW = mmsxx.virtualWidth, VH = mmsxx.virtualHeight;
// MSX1 実機風: 背景の縦スクロールは 8 ドット単位(レイヤーごとに速度が違う多重スクロール)
far.snap = 8;
mid.snap = 8;
near.snap = 8;
neb.snap = 8;
for (let y = 0; y < VH; y += 128) {
  for (let x = 0; x < VW; x += 128) {
    far.draw(x, y, BG_SYMBOLS.starsFar);
    mid.draw(x, y, BG_SYMBOLS.starsMid);
    near.draw(x, y, BG_SYMBOLS.starsNear);
  }
}

// 宇宙ステーション・月・星雲は layer2 に置く。
// 手前の星のセルに欠けさせないため、星より前(layer2)に描くが、
// スクロール速度は最背面 layer0 と同じにして「遠くにある」ように見せる。
// ---- ゲームモード(タイトルの左右キーで選ぶ。あとから増やせる) ----
// 難易度は NORMAL(既定) と HARD の 2 つ。
// もとは NORMAL / EASY と呼んでいたが、やさしいほうを標準にした
// (中身は変えず、呼び名と並び順だけを入れ替えている)。
// **やさしいほうも NORMAL GAME と名乗る。**
// もとは GAME START と書いて「NORMAL」を伏せていたが、隣に HARD GAME が
// 並んでいるところへ GAME START が居ると、**難易度の選択肢に見えない**
// (始めるボタンと読める)。並びの中では、同じ言葉づかいで揃うほうがよい
const MODES = [
  { id: 'normal', name: 'NORMAL GAME' },
  { id: 'hard', name: 'HARD GAME' },
  { id: 'bossrush', name: 'BOSS RUSH' },
  { id: 'staff', name: 'STAFF ROLL' },
  { id: 'sound', name: 'SOUND TEST' },
  { id: 'chars', name: 'CHARACTERS' },
  { id: 'stats', name: 'STATISTICS' },
];
// 手元の開発中だけ「シーン選択」を足す(公開版では出ない)
if (DEV) MODES.push({ id: 'scene', name: 'SCENE SEL', dev: true });
// 進みぐあいの印をその場で変える画面(これも公開版では出ない)
if (DEV) MODES.push({ id: 'devset', name: 'DEV SETTING', dev: true });
let modeIndex = 0;
const gameMode = () => MODES[modeIndex].id;
/** NORMAL: 敵の手数を減らし、残機を増やし、即死をなくす(HARD はこれが無い) */
// CONTINUE は**続けている難易度**で決まる(HARD の続きなら HARD の遊び方)。
// ボスラッシュやそれ以外のモードは、いままでどおり NORMAL 扱いにしない
const isNormal = () => continueKey() === 'normal';

// 全 5 ステージ。1〜4 面が各ボス、5 面がラスボス「THE KING(ざ・きんぐ)」。
// 5 面は雑魚も宝珠も出さず、木星を見せてからそのままラスボス戦に入る。
// (BIG MOAI はボスではなく、道中に出てくる大きい敵)
const LAST_STAGE = 5;
let titleScene = false;   // タイトル画面用の決まった背景を出すか
let stageNo = 1; // 面数(背景オブジェクトの選択にも使う)

// 賑やかしの候補。全部を毎回出すとくどいので、ステージごとに 3 種類だけ選ぶ。
// 大きい絵は裏画面の幅(256)からはみ出さない位置に置く
// (はみ出すと反対側の端から回り込んで見えてしまう)。
const FAR_OBJECTS = [
  // 置き場所は **どの 2 つも重ならない** ように取ってある(裏画面 1024 の
  // 上下の回り込みも見ている)。重ねて描くと、地球にコロニーがめり込むうえ、
  // 重なった行で「横 8 ドット 2 色」も崩れてしまうため。
  // 同じものの 2 か所は 320 ドット以上離してある(地球が 2 つ並ばないように)
  { img: 'station', spots: [[176, 768], [192, 200]] },
  { img: 'moon', spots: [[208, 448], [216, 40]] },
  // 木星はここに入れない。**5 面の星座のあとに初めて出る**もので、
  // ふだんの面に出てしまうと、そのときの驚きが無くなる(showJupiter)
  { img: 'colony', spots: [[24, 288], [136, 904]] },
  { img: 'moai', spots: [[40, 1008], [0, 440]] },
  { img: 'moaiFlip', spots: [[184, 280], [176, 664]] },
  { img: 'earth', spots: [[128, 960], [144, 504]] },
  { img: 'blackhole', spots: [[24, 536], [48, 48]], scanline: 0 },
  { img: 'milkyway', spots: [[0, 816], [64, 352]] },
  { img: 'debris', spots: [[144, 824], [160, 128]] },
];

/**
 * ラスボスの面かどうか(木星だけを見せて、敵を出さずにボスへ入る面)。
 * ボスラッシュや裏技の特別な相手は含めない。
 */
function isLastStage() {
  return stageNo === LAST_STAGE && gameMode() !== 'bossrush';
}
// 最終面の流れ。
//   1. はじめの 10 秒は何も出ない(星だけの静かな宇宙)
//   2. 「そらのドラゴン」の星座が上から流れてくる。1 画面に入りきらない大きさ。
//      顔を 16 発撃つと、ドラゴンの顔のアイテムが出る(取るとフルパワー)
//   3. ドラゴンが流れ去ったあと、木星がゆっくり現れる(この面の後半だけの背景)
//   4. 木星を見せ終えたらボス登場の演出へ
// 5 面の流れ。長すぎたので全体を 80% に詰めてある
const DRAGON_AT = 480;           // 8 秒たってからドラゴンが入ってくる
const JUPITER_AT = 2000;         // ドラゴンが流れ去ってから木星
const LAST_STAGE_SHOW = 2720;    // 木星を見せ終えたらボスへ
// 木星を置く横位置(裏画面の座標)。絵は 144 ドット幅なので、
// 右端に寄せて 104。星座のあと、画面の右側から降りてくる
const JUPITER_X = 104;
const DRAGON_X = 0;              // ドラゴンは画面幅いっぱい

// ドラゴンが流れ去ってからボスが出るまでの、何もない待ち時間のあいだ、
// 画面のどこかに**撃てる場所が 1 か所**ある(見た目には何も無い)。
// 当て続けると「?」が出る。すでに連射中なら、代わりに**輝く $** が出る。
const SECRET_AT = 1680;        // ドラゴンが流れ去ったころ
const SECRET_SPOTS = 1;
const SECRET_SIZE = 20;        // 当たる四角の大きさ
const SECRET_NEED = 8;         // 出るまでに当てる数
let secretSpots = null;

/** 待ち時間のあいだの隠し場所を、完全にランダムな位置へ置く */
function makeSecretSpots() {
  secretSpots = [];
  for (let i = 0; i < SECRET_SPOTS; i++) {
    secretSpots.push({
      x: 16 + Math.floor(rnd() * (SCREEN_W - 32 - SECRET_SIZE)),
      y: 24 + Math.floor(rnd() * (SCREEN_H - 80 - SECRET_SIZE)),
      hits: 0, done: false,
    });
  }
}

// 顔の当たり判定(絵の中の位置)は書き出し側から受け取る
const DRAGON_FACE = GAME_DATA.dragonFace;
let dragonSpot = null;

/** ドラゴンの顔のいまの画面位置(レイヤーのスクロールに合わせて動く) */
function dragonSpotY() {
  // レイヤーは 8 ドット単位で表示されるので、同じ刻みに合わせる
  return dragonSpot.ly - Math.floor(neb.scrollY / 8) * 8;
}

/**
 * そらのドラゴンを、画面のすぐ上に置く。ここから下へ流れていく。
 * 背景は「絵の下のはしから画面に入ってくる」ので、
 * **しっぽから入ってきて、顔は最後に出てくる**。
 * 顔がいきなり出ると何の絵か分からないので、この順のほうがよい。
 */
function showSkyDragon() {
  const dy = Math.floor(neb.scrollY) - BG_SYMBOLS.dragonSky.height;
  neb.draw(DRAGON_X, dy, BG_SYMBOLS.dragonSky);
  dragonSpot = {
    hits: 0, done: false,
    x: DRAGON_X + DRAGON_FACE.x - DRAGON_FACE.size / 2,
    ly: dy + DRAGON_FACE.y - DRAGON_FACE.size / 2,
  };
}

/** 木星を、画面のすぐ上に置く(この面の後半だけの背景) */
function showJupiter() {
  const jy = Math.floor(neb.scrollY) - BG_SYMBOLS.jupiter.height;
  neb.draw(JUPITER_X, jy, BG_SYMBOLS.jupiter);
  jupiterShown = true;
}
let jupiterShown = false;

function drawFarObjects() {
  // ラスボスの面は木星だけ。ほかの賑やかしも敵も出さず、背景をゆっくり見せる。
  // スクロール位置も決め打ちにして、画面の上からじわじわ現れるようにする
  // 最終面は、はじめのうち何も出さない(星だけの静かな宇宙)。
  // 10 秒たってから木星が上から入ってくる(showJupiter)
  if (!titleScene && isLastStage()) {
    neb.scroll(0, 0);
    return;
  }
  // タイトルは寂しくならないよう、地球と星雲を決め打ちで出す
  if (titleScene) {
    // タイトルは宇宙ステーションとモアイだけ。地球は面が進んでから出す
    // タイトルはブラックホールを主役に、ステーションとモアイを添える
    // ブラックホールだけ走査線を入れて、遠くで光っている感じにする
    // (絵はそのまま。抜いた絵はエンジン側で作り置きされる)
    // **星雲はいちばん先に描く**。重なったセルはあとから描いた絵のものになるので、
    // 星雲を先に敷いておけば、賑やかしが星雲に食われない
    for (const [x, y] of [[64, 300], [176, 620], [16, 940], [112, 780]]) {
      neb.draw(x, y, BG_SYMBOLS.nebula);
    }
    neb.draw(72, 120, BG_SYMBOLS.blackhole, true, { scanline: 0 });
    neb.draw(64, 660, BG_SYMBOLS.blackhole, true, { scanline: 1 });
    neb.draw(24, 40, BG_SYMBOLS.station);
    neb.draw(168, 560, BG_SYMBOLS.station);
    neb.draw(160, 300, BG_SYMBOLS.moai);
    neb.draw(40, 840, BG_SYMBOLS.moaiFlip);
    return;
  }
  // ボスラッシュは背景の賑やかしを出さない(ボスだけに集中させる)
  if (gameMode() === 'bossrush') return;
  // 大きい絵ほど後の面に出す(全 5 面ぶんの目安)
  const limit = 48 + Math.min(6, stageNo) * 24;   // 1 面 72 ドット .. 6 面 192 ドット
  const pool = FAR_OBJECTS.filter(o => BG_SYMBOLS[o.img].width <= limit);
  const pick = (pool.length ? pool : FAR_OBJECTS).slice()
    .sort(() => Math.random() - 0.5).slice(0, 3);
  // **星雲はいちばん先に描く**。重なったセルはあとから描いた絵のものになるので、
  // 星雲を先に敷いておけば、賑やかしが星雲に食われない。
  // 星雲はふだん青。4 面だけ赤い星雲にして、ラスボスの面が近いことを見せる
  const neb2 = stageNo === 4 ? BG_SYMBOLS.nebulaRed : BG_SYMBOLS.nebula;
  for (const [x, y] of [[64, 300], [176, 620], [16, 940], [112, 780]]) neb.draw(x, y, neb2);
  for (const o of pick) {
    // scanline を持つ賑やかしは 1 ライン おきに抜いて描く
    const opts = o.scanline == null ? undefined : { scanline: o.scanline };
    for (const [x, y] of o.spots) neb.draw(x, y, BG_SYMBOLS[o.img], true, opts);
  }
}
drawFarObjects();

// layer2 はボス専用のプレーン(通常時は空)。ボスを BG スクロールで動かすために使う。
let bossMode = false;
let rushSpecial = null;   // 裏技で選んだ特別な相手('eyes' / 'moai')
let specialEndTimer = -1; // 倒したあと、演出を見せてから終わるまでの残り

// ---- ゲーム状態 ----
const centerX = (text) => (SCREEN_W - text.length * 8) >> 1;

// 「もう出会ったか」「もう倒したか」の記録。図鑑の ? を外すか、
// ボスラッシュのメニューに出すかの判断に使う。
// ユーザーごとの情報なので localStorage に置く(消えても遊べる範囲だけを入れる)
const progress = new SaveGroup('starfable-progress', {
  // Met は**出てきた時点**、Down は**倒した時点**。
  // Met は図鑑の姿を出すかどうか、Down はボスラッシュに出すかどうかに使う
  boss1Met: { type: T.FLAG, label: 'MET BOSS 1' },
  boss1Down: { type: T.FLAG, label: 'BOSS 1 DOWN' },
  boss2Met: { type: T.FLAG, label: 'MET BOSS 2' },
  boss2Down: { type: T.FLAG, label: 'BOSS 2 DOWN' },
  boss3Met: { type: T.FLAG, label: 'MET BOSS 3' },
  boss3Down: { type: T.FLAG, label: 'BOSS 3 DOWN' },
  boss4Met: { type: T.FLAG, label: 'MET BOSS 4' },
  boss4Down: { type: T.FLAG, label: 'BOSS 4 DOWN' },
  todoMet: { type: T.FLAG, label: 'MET Mr. MIJISSOU' },
  // 倒したかどうか。いまは何も開かないが、記録として残す
  todoDown: { type: T.FLAG, label: 'Mr. MIJISSOU DOWN' },
  // 図鑑の姿は「会った」で開く
  kingMet: { type: T.FLAG, label: 'MET THE KING' },
  // 倒したかどうか。**サウンドテストの VOICE 欄**はこちらで開く
  kingDown: { type: T.FLAG, label: 'THE KING DOWN' },
  // 最後に遊んだ難易度。次に開いたときも、そちらが選ばれた状態にする
  lastPlayed: { type: T.ENUM, values: ['normal', 'hard'], init: 'normal', label: 'LAST PLAYED' },
});

/**
 * 面番号に対応する「倒した」印。1〜4 面のボスと未実装さんだけが持つ。
 * ラスボスは倒しても印を持たない(ボスラッシュに出ないため)
 */
function rushFlag(stage) {
  if (stage >= 1 && stage <= 4) return 'boss' + stage + 'Down';
  if (stage === RUSH_TODO) return 'todoDown';
  return null;
}

/**
 * 面番号に対応する「出会った」印。図鑑の姿を出すかどうかに使う。
 * ラスボスは出てくるところが特別なので spawnKingBoss 側で立てる。
 * 未実装さんも**ここでは立てない**。出会うのは 2 回目のコンティニューだけで、
 * ボスラッシュやシーン選択で出しても「出会った」ことにはしない
 */
function metFlag(stage) {
  if (stage >= 1 && stage <= 4) return 'boss' + stage + 'Met';
  return null;
}

/** 印を立ててその場で保存する。立つ機会が少ないので、ためずに書いてしまう */
function markMet(name) {
  if (name && progress.set(name, true) === R.UPDATED) progress.flush();
}

/** 印が立っているか */
const met = (name) => progress.get(name) === true;

// ---- 遊んだ記録(STATISTICS の画面に出すもの) ----
// 進みぐあい(progress)とは保存先を分けてある。「記録だけ消す」ができるように。
// 数えるのは**本編(NORMAL / HARD)だけ**。ボスラッシュや裏技を混ぜると、
// 敵の数と面の数が噛み合わなくなる(ボスラッシュのタイムだけは別に持つ)
const record = new SaveGroup('starfable-record', {
  playsNormal: { type: T.COUNT, label: 'NORMAL' },
  playsHard: { type: T.COUNT, label: 'HARD' },
  playSeconds: { type: T.COUNT, label: 'PLAY TIME' },
  totalScore: { type: T.COUNT, label: 'TOTAL SCORE' },
  enemyKills: { type: T.COUNT, label: 'ENEMIES DOWN' },
  backfireKills: { type: T.COUNT, label: 'BACKFIRE ATTACK' },
  shots: { type: T.COUNT, label: 'SHOTS FIRED' },
  // 被弾はバリアや装備で耐えたぶんも数える(やられた数とは別)
  hits: { type: T.COUNT, label: 'TIMES DAMAGE' },
  deaths: { type: T.COUNT, label: 'SHIPS LOST' },
  // **遊びを途中で捨てた回数。** ポーズの RESET でも、打ち込みの Q でも
  // 同じ数に足す(入口が違うだけで、していることは同じ)
  resets: { type: T.COUNT, label: 'RESETS' },
  // 連射の記録。腕前を見せるところなので、アイテムで増えたぶんは数えない
  maxRapid: { type: T.NUMBER, min: 0, max: 60, digits: 1, label: 'BEST SHOTS/SEC' },
  maxStreak: { type: T.COUNT, label: 'LONGEST FIRING' },
  mostShots: { type: T.COUNT, label: 'MOST SHOTS IN A GAME' },
  boss1S: { type: T.COUNT, label: 'BOSS 1  S RANK' },
  boss2S: { type: T.COUNT, label: 'BOSS 2  S RANK' },
  boss3S: { type: T.COUNT, label: 'BOSS 3  S RANK' },
  boss4S: { type: T.COUNT, label: 'BOSS 4  S RANK' },
  kingS: { type: T.COUNT, label: 'THE KING S RANK' },
  hiNormal: { type: T.COUNT, label: 'NORMAL' },
  hiHard: { type: T.COUNT, label: 'HARD' },
  // ボスラッシュのタイムはコマ数で持つ。0 は「まだ記録なし」
  rushBest: { type: T.COUNT, label: 'BOSS RUSH' },
  shares: { type: T.COUNT, label: 'SNS SHARED' },
});

/** 記録を数える場面か(本編だけ) */
const recordOn = () => ['normal', 'hard', 'continue'].includes(gameMode());

// ゲーム中は**ただの変数で数えて**、区切りのいいところで記録へ移す。
// 弾を撃つたびに保存していては重いため
const tally = { kills: 0, backfire: 0, shots: 0, hits: 0, deaths: 0, frames: 0 };
let tallyScore = 0;    // すでに記録へ足した得点(ここから増えたぶんを足す)
let framesLeft = 0;    // 秒に足りなかったコマ数(次に持ち越す)
let playShots = 0;     // このプレイで撃った数
let burning = false;   // いま推進炎で焼いているところか(撃破の数えわけに使う)

/**
 * 数えていたぶんを記録へ移して保存する。
 * 呼ぶのは 死んだとき / 面クリア / タイトルへ戻るとき
 */
function recordFlush() {
  record.add('enemyKills', tally.kills);
  record.add('backfireKills', tally.backfire);
  record.add('shots', tally.shots);
  record.add('hits', tally.hits);
  record.add('deaths', tally.deaths);
  record.add('totalScore', Math.max(0, score - tallyScore));
  tallyScore = score;
  framesLeft += tally.frames;
  record.add('playSeconds', Math.floor(framesLeft / 60));
  framesLeft %= 60;
  tally.kills = tally.backfire = tally.shots = tally.hits = tally.deaths = tally.frames = 0;
  record.flush();
}

// ---- 連射の計り方 ----
// **5 秒のあいだに撃った数**を 5 で割って「秒間の連射数」とする。
// 窓が埋まるまでは少なめに出るが、少なく出るぶんには害がない。
// 連射アイテム(RAPID)と ? の自動連射を取ったあとは数えない(腕前ではないため)
const RAPID_WINDOW = 300;   // 5 秒
const RAPID_GAP = 24;       // 0.4 秒あけたら「撃ちやめた」ことにする
let rapidShots = [];        // 直近 5 秒のあいだに撃ったコマ
let rapidClean = true;      // まだ連射を助けるものを取っていない
let streakStart = -1;       // 撃ち続けはじめたコマ
let lastFireFrame = -999;

/** 1 コマぶんの連射の見張り(プレイ中だけ呼ぶ) */
function updateRapid() {
  const f = mmsxx.frame;
  while (rapidShots.length && rapidShots[0] <= f - RAPID_WINDOW) rapidShots.shift();
  if (rapidClean && rapidShots.length > 1) {
    record.max('maxRapid', rapidShots.length / (RAPID_WINDOW / 60));
  }
  if (f - lastFireFrame > RAPID_GAP) streakStart = -1;
  else if (streakStart >= 0) record.max('maxStreak', Math.floor((f - streakStart) / 60));
}

/** ボスラッシュのタイム(短いほうを残す)。0 は記録なし */
function recordRushTime(frames) {
  if (record.get('rushBest') === 0) record.set('rushBest', frames);
  else record.min('rushBest', frames);
  record.flush();
}

let state = 'title'; // 'title' | 'play' | 'over'
let score = 0;
// ---- ハイスコア ----
// localStorage はブラウザ設定によっては参照した時点で例外を投げるので必ず包む
const HISCORE_MAX = 100;
const HISCORE_ROWS = 7;              // 一度に表示する人数(画面に収まる数)
// **作り物の初期データは持たない**。並ぶのは実際に遊んだ人の記録だけ。
// サーバにも仕込んでいないので、**誰かが遊ぶまで表は空**で、NO RECORDS YET と出る。
// 繋がらないときも同じ見た目になる(空かどうかで繋がったかは分からない)

// ---- ランキングサーバへ送るときの見分け ID ----
// サーバはどちらも UUID の形しか受け取らない(形が違うと INVALID_SUBMISSION)。

/** UUID を作る(randomUUID が無い環境のための控えつき) */
function newUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0;
  b[6] = (b[6] & 0x0f) | 0x40;   // 版を 4 に
  b[8] = (b[8] & 0x3f) | 0x80;   // 変種を決まりどおりに
  const h = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' +
    h.slice(16, 20) + '-' + h.slice(20);
}

/**
 * この端末を見分ける ID。一度作ったら残す。
 * 消されれば別人になるが、それでよい(荒らしを見つける手がかりのひとつでしかない)
 */
function getBrowserId() {
  const KEY = 'starfable-browser-id';
  let id = '';
  try { id = localStorage.getItem(KEY) || ''; } catch (e) { /* 読めなくても続ける */ }
  if (!id) {
    id = newUuid();
    try { localStorage.setItem(KEY, id); } catch (e) { /* 書けなくても続ける */ }
  }
  return id;
}
const browserId = getBrowserId();

/**
 * 1 回のプレイを見分ける ID。ゲームを始めるたびに作り直す。
 * 送り直すときも同じ ID を使うので、同じ記録が二重に載らない
 */
let playId = newUuid();

/**
 * ランキングを分ける基準。**メジャーが同じ記録どうしが同じ土俵**になる
 * (1.00 と 1.03 は同じランキング、2.00 は別ランキング)。
 *
 * 上げるのは、**遊びの中身を変えて過去の記録と比べられなくなったとき だけ**:
 *
 *   ・難しさ・ステージ・点の数えかたを変えた → メジャーを上げる(1.xx → 2.00)
 *   ・比べられる範囲の小さな変更を残したい   → マイナーを上げる(1.00 → 1.01)
 *   ・不具合直し・描画・UI・読み込みだけ     → **そのまま**(gameVersion だけ上がる)
 *
 * ビルドの版(BUILD.version)とは連動させない。ビルドを重ねても中身が同じなら据え置く。
 * **サーバからは中身が変わったか分からない**ので、出すときの決めごととして守る
 */
const RANKING_VERSION = '1.00';

/**
 * どこで遊んでいるか。ブラウザなら 'pc' か 'mobile'。
 * Windows / Android のアプリとして包んで配るようになったら 'app' を返すようにする。
 * **必ず小文字**。サーバは値を確かめないので、ゆれるとそのまま一覧に出る
 */
function rankPlatform() {
  return isMobileLike() ? 'mobile' : 'pc';
}

/**
 * 何で操作したかを送るか。**送らないなら空文字**(記録には「不明」として残る)。
 *
 * ## 送ってよい基準
 *
 * その platform で**実際に使われる入力手段を全部捕捉できているとき だけ**送る。
 * 1 つでも捕捉もれがあれば送らない。
 *
 * 例: PC でキーボードだけ捕捉して送ると、パッドで遊んだ人の記録が `key` として残る。
 * これは「不明」ではなく**誤り**で、あとから直せない
 * (列ごと消すことはできるが、正しい記録も巻き添えになる)。
 * 未指定は「不明」として残るだけで実害がないので、**迷ったら送らない**。
 *
 * そのため、パッドが先にできたら pc だけ送る / スマホが先ならmobile だけ送る、
 * というように **platform ごとに判断する**。両方そろったら全部で送る。
 *
 * ## いまはどの platform でも送る
 *
 * 3 つとも捕捉できている。
 *
 *   key   … engine/input.js が窓の keydown を拾う
 *   touch … 十字も連射も `press(code, 'touch')` を通り、
 *           行き先を置く / なぞる遊びかたは `setStick('touch', …)` を通る
 *           (どちらも usedSources に入る)
 *   pad   … engine/util/gamepad.js が `press(code, 'pad')` を通す。
 *           スマホに繋いだパッドも同じ道を通るので、そちらも載る
 *
 * **ここを触るときは、増やした入力の口も usedSources に入るか確かめること。**
 * 入っていないものがあると、その人の記録が別の手段として残る
 */
function rankInput() {
  return mmsxx.input.usedInputs();
}

// ランキングの供給元。ふだんは手元の localStorage。
// サーバへ繋がなくても通信の様子を試せるようにしてある。
//
//   ?delay=5     … 取得・登録に 5 秒かかることにする
//   ?error=0.3   … 3 割の見込みで失敗することにする(?error=1 で必ず失敗)
//
// どちらかを付けているあいだは既定データから始まり、取れた時点で入れ替わる。
// サーバを相手にしたときと同じ道筋になる
// **開発版のときだけ効く**。公開版では URL に何を付けても無視する
// (遊ぶ人に、わざと失敗する設定を触らせないため)
const RANK_QUERY = new URLSearchParams(location.search);
const RANK_DELAY = DEV ? (Number(RANK_QUERY.get('delay')) || 0) : 0;
const RANK_ERROR = DEV ? (Number(RANK_QUERY.get('error')) || 0) : 0;

/**
 * どこへ繋ぐか。
 *   'local' … 手元の localStorage(開発版の既定。ふだんはこれ)
 *   'dev'   … 開発用のランキングサーバ(開発版で `?rank=dev` を付けたとき)
 *   'prod'  … 本番のランキングサーバ(公開版はいつもこれ)
 *
 * **本番の宛先は開発版から選べない**。URL で選べるのは手元と開発用の 2 つだけで、
 * 公開版は URL に何を書かれても 'prod' から動かない。
 * ふだんの作業でうっかりサーバへ書き込む事故を防ぐため、既定は手元にしてある。
 *
 * サーバの URL は**通信する部品が両方とも知っていて**、開発版かどうかで
 * 自分で選ぶ。ここは「どちらを使うか」を決めるだけで、URL は持たない
 */
const RANK_MODE = DEV ? (RANK_QUERY.get('rank') === 'dev' ? 'dev' : 'local') : 'prod';

/**
 * サーバのランキングに繋ぐ供給元を作る。
 * 表の `key` からサーバ側の宛先を引けるようにして渡す。
 * サーバの URL は部品側が両方とも知っているので、ここでは dev かどうかだけ伝える。
 *
 * **通信する部品は `online/` にあり、ここでしか読み込まない**(動的 import)。
 * `online/` を外した配布物では読み込みに失敗するので、手元の保存に落として遊べるようにする。
 * こうしておけば、繋ぐ実装を持たない公開用でも、この 1 か所以外は同じコードで通る。
 * @param {boolean} dev 開発用のサーバを使うか(false なら本番)
 */
async function makeRemoteRankSource(dev) {
  let RemoteRankingSource;
  try {
    ({ RemoteRankingSource } = await import('../online/ranking-remote.js'));
  } catch (e) {
    // 繋ぐ部品が入っていない配布物。遊べなくなるよりは手元の保存で続けるほうがよい
    console.warn('[STAR FABLE] online/ranking-remote.js がありません。手元の保存を使います');
    return new LocalRankingSource({ delay: RANK_DELAY, errorRate: RANK_ERROR });
  }
  return new RemoteRankingSource({
    dev,
    browserId,
    // playId は 1 プレイごとに作り直すので、送るたびに今の値を聞いてもらう
    playId: () => playId,
    platform: rankPlatform(),
    // 何で操作したかは**プレイの途中で増える**(持ち替える人がいる)ので、
    // 送るときに今の控えを聞いてもらう。
    // 送ってよいかの判断は rankInput() が持っている(いまは開発版だけ)
    input: () => rankInput(),
    // ビルドの版。頭の v は付けずに送る(1.01 / 公開版は 1.01.42)。
    // **ランキングは分かれない**。どのビルドの記録かを後で追うためだけの項目
    gameVersion: BUILD.version.replace(/^v/, ''),
    rankingVersion: RANKING_VERSION,
    games: {
      'starfable-hiscores-easy': { gameId: 'star-fable-normal', rankingKey: 'high-score', valueKey: 'score' },
      'starfable-hiscores': { gameId: 'star-fable-hard', rankingKey: 'high-score', valueKey: 'score' },
      'starfable-rushtimes': { gameId: 'star-fable-rush', rankingKey: 'fastest', valueKey: 'frames' },
    },
  });
}

// 手元の保存だけで済むときは待たない(いままでどおりその場で決まる)。
// 繋ぐときだけ、部品の読み込みを待ってから表を作る
const rankSource = RANK_MODE === 'local'
  ? new LocalRankingSource({ delay: RANK_DELAY, errorRate: RANK_ERROR })
  : await makeRemoteRankSource(RANK_MODE === 'dev');

// ハイスコア表はエンジン側の仕組みを使う(供給元は差し替えられる)
const hardTable = new RankingBoard({
  source: rankSource,
  key: 'starfable-hiscores',
  meKey: 'starfable-me',
  max: HISCORE_MAX,
  defaults: [],
  compare: byScore,
});
// NORMAL と HARD は別のランキングに載せる(同じ表に混ぜない)。
// 保存キーは EASY だったころのままにして、それまでの記録を引き継ぐ
const normalTable = new RankingBoard({
  source: rankSource,
  key: 'starfable-hiscores-easy',
  meKey: 'starfable-me-easy',
  max: HISCORE_MAX,
  defaults: [],
  compare: byScore,
});
/**
 * 保存してある古い記録の 10 の位を 0 にそろえる。
 * 10 点刻みの得点はもう出ないので、昔の端数が残っていると気持ちが悪い
 */
function roundHiScores(table) {
  // 保存してあるものを書き換える手入れなので、手元に持っているときだけ意味がある。
  // 供給元がサーバになったら、記録の書き換えは管理者の仕事になる
  if (!table.editable) return;
  let changed = false;
  for (const e of table.entries) {
    const v = Math.round(e.score / 100) * 100;
    if (v !== e.score) { e.score = v; changed = true; }
  }
  if (changed) table.save();
}
for (const t of [hardTable, normalTable]) roundHiScores(t);

/**
 * ランキングを取り直す。**待たせないので投げっぱなしで呼ぶ**。
 * タイトルへ戻ってきたときに 3 表ぶんまとめて頼み、取れたぶんは
 * 次にその画面を開いたときから新しくなる。
 * 表示中の一覧は描き直さない(ちらつかせない)。失敗しても手元の記録が残る。
 */
function refreshRankings() {
  for (const t of [hardTable, normalTable, rushTable]) t.refresh();
}

/** いま遊んでいるモードのランキング表 */
const scoreTable = () => (hardNow() ? hardTable : normalTable);
/**
 * 表に載るかどうか。
 * **0 点は載せない**。表がまだ 100 件たまっていないと何点でも載ってしまうので、
 * 1 点も取っていない記録がここで弾かれるようにしておく
 */
const isHiScore = (v) => v > 0 && scoreTable().qualifies({ score: v });
let ships = 0;   // 残機。0 になったらゲームオーバー
let shotLevel = 1;    // 1..5 = 同時に撃つ弾の本数
let stars = 0;        // 集めた★の数。規定数そろうとボス戦

/**
 * 敵の発射間隔。自機のパワーが高いほど短くなる(= 弾が増える)。
 * パワー最大のときが最も激しく、パワー 1 では 1/3 の手数になる。
 */
function enemyFireGap(base) {
  // 自機のパワーが高いほど手数が増える
  const byPower = 1 + (MAX_POWER - shotLevel) * 0.33;
  // さらに面数でも変える。1 面はかなり控えめで、4 面以降が本来の量になる
  const byStage = [3.2, 2.2, 1.5, 1][Math.min(stageNo, 4) - 1];
  // NORMAL は弾の間隔を倍にして、見た目や装備をゆっくり楽しめるようにする
  // NORMAL は間隔を倍に = 撃ってくる弾の数が半分になる
  return Math.round(base * byPower * byStage * (isNormal() ? 2 : 1));
}
let playFrame = 0;
let waveIndex = 0;
let cubeIndex = 0;
let invincible = 0;
let entering = false;  // 下から復帰してくる演出中は操作を受け付けない
let leaving = false;   // ステージクリア後、画面上へ飛び去っていく演出中
let enterDelay = 0;    // ステージ開始時、自機が入ってくるまでの待ちフレーム
let respawnDelay = 0;  // ミス後、復帰するまでの待ちフレーム
let stateTimer = 0;
let clearTimer = 0;
/**
 * **クリアしてから何コマたったか**(0 = クリアしていない)。
 * 背景を減速して止めるのに使う(下の bgStopMul)
 */
let bgStopFrames = 0;
/** 減速にかけるコマ数。**ボスラッシュの短い間(120)でも止まりきる長さ**にする */
const BG_STOP_LEN = 90;

/**
 * **背景の流れる速さの倍率。** ふだんは 1、クリアしたら 0 へ落ちる。
 *
 * 面ごとに録った動画をつなぐとき、**継ぎ目で背景が飛ぶ**のが困りもの。
 * 結果画面のあいだ宇宙が止まっていれば、そこが必ず同じ絵になるので、
 * 次のテイクの頭とつながる。急に止めると不自然なので、1.5 秒かけて落とす
 */
function bgStopMul() {
  if (clearTimer > 0) bgStopFrames++;
  else bgStopFrames = 0;
  if (bgStopFrames === 0) return 1;
  return Math.max(0, 1 - bgStopFrames / BG_STOP_LEN);
}

// 自機は**2 色**。実機なら単色 2 枚重ねなので、**色ごとに分けて置く**。
// こうすると 1 行に出せる枚数の取り合いでも 2 枚ぶんの席を食い、
// 実機と同じ混みかたになる(動かすのは 1 つとして扱える)
const player = new SpriteCombo(mmsxx, SPRITE_SYMBOLS.player, { priority: 10, visible: false });
// **自機だけは絶対に消えない**(1 行に出せる数の取り合いから外す)。
// 自分の機体が点滅で消えると、避けるどころではなくなるため
player.rank = 'always';
// 自機の補助表示。推進炎とバリアは 1 枚のスプライト枠を交互に使って見せる
// (実機のスプライト数を節約する見せ方)。
// **バリアと後ろ火は消えてよい**ので、こちらはふつうの扱いのまま
const aux = mmsxx.sprite(SPRITE_SYMBOLS.flameSmall);
aux.priority = 11;
aux.visible = false;

/**
 * **パッドレスの移動。** 叩いた先へ自機が自分で歩く。
 *
 * 十字は出さない。撃つのは自動なので、**両手とも移動に使える**。
 * 制御そのものは engine/util/padless.js が持っていて、ここでするのは
 * 「指の点をドットへ戻す」「行き先を届く範囲へ丸める」「印を置く」の 3 つ。
 *
 * **どちらで遊ぶかはポーズ中に選べる**(CONTROL。下の PAD_TARGETS)ので、
 * 道具は指で遊ぶ端末なら**いつでも作っておく**。
 * 効かせるかどうかは `padlessOn` が決める(遊びの最中に切り替わる)。
 *
 * **入れものだけ先に置く。** 中身を作るのは PAD_ON が出てから
 * (`setupPadless()`。**const は巻き上がらない**ので、ここで PAD_ON を
 * 触ると読み込みごと落ちる)
 */
let padlessMove = null;
/** いま行き先を置いて遊んでいるか。**ポーズ中の CONTROL で切り替わる** */
let padlessOn = false;
/** いま道をなぞって遊んでいるか(同じく CONTROL で切り替わる) */
let traceOn = false;
/** なぞった道をたどる制御(engine/util/trace.js)。**PAD_ON のときだけ作る** */
let traceMove = null;
/**
 * 行き先の印。**溜められるぶんだけ用意する**(部品の maxPoints と同じ数)。
 * **弾より奥**に置く(避けるものを隠さない)
 */
const PAD_AIM_MAX = 2;
const aimSps = [];

// ---- なぞった道の絵 ----
//
// **スプライトでは引けない。** MSX1 のスプライトは 1 行に 4 枚までで、
// 道なりに何十個も並べたら、その行の弾も自機も消える。
// 道は**画面の上に重ねた SVG** で引く(ゲームの絵ではなく、指の跡なので、
// ドット絵の決まりごとに合わせる必要も無い)。
//
// **画面の点をそのまま持つ。** ドットから画面へ戻す道は用意していないし、
// 指が通ったところをなぞるだけなので、回転も倍率も考えずに済む
// (画面が 90 度 回っていても、指の跡は指の跡のまま)。

/**
 * **線を自機から離しはじめる長さ**(ドット)。
 * 自機の絵は 16 ドット四方なので、その角を少し越えたあたり
 */
const TRACE_GAP = 12;
/** 線を引く SVG(要るときに作る) */
let tracePathEl = null;

/**
 * **いま自機を動かせるか。**
 *
 * 遊びの最中でも、**手を離させている場面**がいくつかある ──
 * 面クリアの集計、飛び去っていく演出、出てくる途中、ポーズ。
 * そこで線を出すと、**自機が画面の外まで飛んでいくのに線が付いていく**
 * (面クリアで画面の外まで線が伸びていたのはこれ)
 */
function canSteer() {
  return state === 'play' && !paused && !entering && !leaving && clearTimer <= 0;
}

/**
 * ゲームのドットを、線の絵に使う窓の点へ。
 * **丸めたあとのドットを渡すこと**(自機が行ける範囲に収まっている)
 */
function traceDot(x, y) {
  const at = mmsxx.vdp.screenToPoint(x, y);
  return [at.x, at.y];
}

/**
 * **自機と指のあいだの線を引き直す。毎コマ呼ぶ。**
 *
 * 引いているあいだだけ出す 1 本の線。道は残さない
 * (自機そのものが筆先なので、通ったところは自機が居たところ)
 */
function paintTracePath() {
  const at = (traceOn && traceMove) ? traceMove.finger : null;
  // **自機が点滅していても線は出す。** やられたあとの無敵のあいだ、
  // player.visible は 4 コマごとに落ちる。そこで線まで消すと、
  // 引いている最中に線が点滅した(実際そうなった)
  const show = at && player && canSteer();
  if (!show) {
    if (tracePathEl) tracePathEl.setAttribute('d', '');
    return;
  }
  if (!tracePathEl) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // **名前を付けておく。** 絵のボタンにも SVG があるので、
    // 探すときに取り違えないように
    svg.setAttribute('class', 'mmsxx-trace');
    // **器(z-index: 10)より下、canvas より上。**
    // 指は素通しにする(下の canvas が受ける)
    svg.setAttribute('style', 'position:fixed;inset:0;width:100%;height:100%;'
      + 'pointer-events:none;z-index:9');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#3ee06e');
    path.setAttribute('stroke-width', '3');
    path.setAttribute('stroke-linecap', 'round');
    // **半分だけ透かす。** 線はゲームの絵ではなく指の跡なので、
    // 下の弾と自機が透けて見えるほうがよい
    path.setAttribute('opacity', '0.5');
    svg.appendChild(path);
    document.body.appendChild(svg);
    tracePathEl = path;
  }
  // **線は自機から少し離して引きはじめる。**
  // 真ん中から引くと、線が自機の絵に重なって、どちらも見づらい
  const px = player.x + 8, py = player.y + 8;
  const vx = at.x - px, vy = at.y - py;
  const d = Math.hypot(vx, vy);
  if (d <= TRACE_GAP) { tracePathEl.setAttribute('d', ''); return; }
  const k = TRACE_GAP / d;
  const a = traceDot(px + vx * k, py + vy * k);
  const b = traceDot(at.x, at.y);
  tracePathEl.setAttribute('d', 'M' + a[0] + ',' + a[1] + 'L' + b[0] + ',' + b[1]);
}

/** 線を消す */
function clearTracePath() {
  if (tracePathEl) tracePathEl.setAttribute('d', '');
}

/**
 * **残っている線を片付ける。毎コマ呼ぶ。**
 * 引いていないのに線が残っていることがないように
 */
function sweepTracePath() {
  if (!traceMove || !traceOn || traceMove.state === 'idle' || !canSteer()) {
    // **動かせない場面では、引いているぶんも捨てる。**
    // 残すと、動かせるようになった瞬間に前の指の場所へ走り出す
    if (traceMove && !canSteer()) traceMove.stop();
    clearTracePath();
  }
}

/** 指で遊ぶ端末なら、道具をそろえておく(効かせるかは padlessOn が決める) */
function setupPadless() {
  if (padlessMove) return;
  padlessMove = createPadless();
  for (let i = 0; i < PAD_AIM_MAX; i++) {
    const sp = mmsxx.sprite(SPRITE_SYMBOLS.aimMark);
    sp.priority = 3;
    sp.visible = false;
    aimSps.push(sp);
  }
}
/**
 * **自機の真ん中が行ける範囲。** 行き先をここへ丸めておかないと、
 * 端を叩いたときに自機が壁で止まったまま「まだ着いていない」ことになり、
 * **押し続けたまま止まらなくなる**(下の移動の頭打ちと同じ範囲にする)
 */
function aimClamp(x, y) {
  return {
    x: Math.max(8, Math.min(SCREEN_W - 8, x)),
    y: Math.max(28, Math.min(SCREEN_H - 10, y)),
  };
}

let bullets = [];
let enemies = [];
let enemyBullets = [];
let booms = [];
let items = [];
let boss = null;

// ショット管理: 1 回の発射(volley)ごとに ID を振り、画面上に出せる数を制限する。
// 連射アップを取ると同時に出せる数が増える(2 -> 4)。
let maxVolleys = 1;
const MAX_VOLLEY_LIMIT = 4;
const MAX_SHIPS = 5;
// 弾の威力は 3 段階。硬い敵にまとめてダメージが入るようになる
// 威力は 2 段階。1 段階目で 2 倍、2 段階目で 3 倍のダメージ(貫通はしない)
const DAMAGE_TABLE = [2, 3];
// ボスと、その部位に与えるダメージ。
// 強さアップの影響を受けない(ボスのバランスを取りやすくするため)
const BOSS_DMG = 2;
let damageLevel = 1;
// バリアは耐久制。被弾のたびに 1 減り、アイテムで最大まで貯められる
const MAX_BARRIER = 2;
let barrierHP = 0;
// スコアアイテム($): 続けて取ると 100 点から倍々に増え、12800 の次はまた 100 に戻る。
// 別のアイテムを取ると連鎖は切れる。
// 100 点から倍々に増え、102400 が打ち止め(取るとファンファーレ)
const COIN_BASE = 100, COIN_TOP = 102400;
let coinValue = COIN_BASE;
// おまかせアイテム(?): 取るとしばらくオート連射になる
let autoFire = 0;
const AUTO_FIRE_TIME = 1;    // 0 より大きければ有効(ミスするまで続く)
const INTRO_QUIET = 240;        // ステージ開始から 4 秒はキューブを出さない
const INTRO_QUIET_ENEMY = 480;  // 敵は 8 秒たってから出てくる
const GAMEOVER_WAIT = 1520; // ゲームオーバー曲(月光)が終わるころにタイトルへ戻る
const ASTEROID_INTERVAL = 900; // 小惑星が流れてくる間隔(2 面以降)

// ---- 小惑星 ----
// 大きい絵なのでスプライトではなく BG(専用レイヤー)に描く。
// 8 ドット単位でしか置けないので、動きもその粒度になる(実機の BG らしい動き)。
const AST_SIZE = 48;
const AST_HP = 170;   // とても硬いが壊せる(256 の 2/3 ほど)
// 小惑星は BG スプライトなので、画面には 8 ドット単位に丸めた位置で出る。
// 当たり判定を持っている値(丸める前)のまま使うと、見えている絵と最大 7 ドット
// ずれてしまう。判定も描画と同じ丸めかた(snap8)にそろえる
const astCX = a => snap8(a.sp.x) + AST_SIZE / 2;
const astCY = a => snap8(a.sp.y) + AST_SIZE / 2;
let asteroids = [];
// 弾が当たったときの点滅用。当たるたびに白と黄で交互に光らせて存在を目立たせる
let astFlashImgs = null;
const astFlash = i => (astFlashImgs || (astFlashImgs =
  [recolor(BG_SYMBOLS.asteroid, 15), recolor(BG_SYMBOLS.asteroid, 11)]))[i];
/** 難易度が上がると同時に出せる数が増える(最大 3 つ) */
function maxAsteroids() {
  if (isNormal()) return 1;   // NORMAL は 1 つだけ
  return Math.min(3, 1 + Math.floor((stageNo - 1) / 2));
}
function spawnAsteroid() {
  const sp = mmsxx.bgSprite(BG_SYMBOLS.asteroid);
  sp.priority = BGP_FRONT;
  sp.x = 16 + Math.floor(rnd() * (SCREEN_W - 80));
  sp.y = -AST_SIZE;
  // 白いハイライトはスプライト 1 枚。3 フレームに 1 回だけ出して
  // 「スプライトを減らしている」ちらつきを見せる
  const hi = mmsxx.sprite(SPRITE_SYMBOLS.asteroidHi);
  hi.priority = 6;
  hi.blink = 3;
  asteroids.push({ sp, hi, age: 0, flash: 0, flashColor: 0, hp: AST_HP });
}
/** 小惑星に弾が当たった: 鈍い「ごわっ!」を鳴らして白/黄で強く光らせる */
function pingAsteroid(a) {
  // **当たった音は撃つ音と同じ強さ**にする。優先度を落としていると、
  // 撃ちつづけているあいだ場所が空かず、当たった手ごたえが消える
  mmsxx.audio.playSE('thud', SE_HIT);
  a.flashColor ^= 1;   // 当たるたびに白と黄を入れ替える
  a.flash = 8;
}
function clearAsteroids() {
  for (const a of asteroids) {
    mmsxx.removeBgSprite(a.sp);
    if (a.hi) mmsxx.removeSprite(a.hi);
  }
  asteroids = [];
}
function updateAsteroids() {
  for (const a of [...asteroids]) {
    a.age++;
    // **挙動確認の的は流れない**
    if (!a.frozen) {
      a.sp.y += 0.55;
      a.sp.x += Math.sin(a.age * 0.012) * 0.4;
    }
    // 本体はいつも同じ絵。光るのは重ねたハイライトのスプライトだけにする
    a.sp.image = BG_SYMBOLS.asteroid;
    if (a.hi) {
      if (a.flash > 0) {
        // 被弾中はハイライトを白/黄で強く光らせる
        a.flash--;
        a.hi.image = a.flashColor ? SPRITE_SYMBOLS.asteroidHiWarn : SPRITE_SYMBOLS.asteroidHi;
        a.hi.blink = 1;
      } else {
        a.hi.image = SPRITE_SYMBOLS.asteroidHi;
        a.hi.blink = 3;   // ふだんは 3 コマに 1 回のちらつき
      }
    }
    // ハイライトは本体(8 ドット単位)にぴたりと合わせる
    if (a.hi) { a.hi.x = snap8(a.sp.x); a.hi.y = snap8(a.sp.y); }
    if (a.sp.y > SCREEN_H + AST_SIZE) {
      // 壊せずに流れていった小惑星は、どれだけ削れていたかを記録しておく
      stats.log('asteroidGone', { damage: AST_HP - a.hp, stage: stageNo });
      mmsxx.removeBgSprite(a.sp);
      if (a.hi) mmsxx.removeSprite(a.hi);
      asteroids.splice(asteroids.indexOf(a), 1);
    }
  }
}
// ---- 目玉(各ステージに 1 回だけ 2 体で現れる) ----
// 本体は 32x32 の BG スプライト、瞳は通常スプライトで重ねる。
// 斜めショットがちょうど両方に当たるくらい離して出す。
// 0.5 秒以内に 2 体とも倒すと 10 万点のボーナス。
const EYE_SIZE = 32;
const EYE_GAP = 80;             // 2 体の間隔(斜めショットがちょうど届くくらい)
// 瞳(絞り)はダメージが進むほど閉じていく
const IRIS_IMGS = () => [SPRITE_SYMBOLS.eyeIris0, BG_SYMBOLS.eyeIris1, BG_SYMBOLS.eyeIris2, BG_SYMBOLS.eyeIris3];
const EYE_HP = 32;              // 攻撃力によらず 32 発で壊れる
const EYE_HOVER = 600;          // 画面に留まる時間(10 秒)
const EYE_BONUS = 100000;
const EYE_BONUS_WINDOW = 30;    // 同時撃破とみなす猶予(0.5 秒)
const EYE_APPEAR = 2100;        // 面の後半(35 秒あたり)で出てくる
let eyeballs = [];
let eyeSpawned = false;         // ステージごとに 1 回だけ
let eyeToldDouble = false;      // 「同時に壊せ」を出したか(1 プレイに 1 回)
let eyeKillFrame = -999;        // 片方を倒したフレーム

function spawnEyeballs() {
  mmsxx.audio.playSE('eyeAppear', SE_JINGLE);   // 登場の合図(いちばん強く鳴らす)
  // 初回だけ、狙いどころを教える(1 プレイに 1 回)
  if (!eyeToldDouble) {
    eyeToldDouble = true;
    showNotice('DESTROY EYES AT ONCE!');
  }
  // 上から出てくるか下から出てくるかはランダム
  // (ふつうのステージでは後半になってから下も出るようにする)
  const fromBelow = (stageNo >= 5 || stageNo === RUSH_EYES) && rnd() < 0.5;
  // 左右は画面の中央。2 体そろって出る
  const cx = (SCREEN_W - EYE_GAP - EYE_SIZE) / 2;
  for (let i = 0; i < 2; i++) {
    const sp = mmsxx.bgSprite(BG_SYMBOLS.eyeball);
    sp.priority = BGP_FRONT;
    sp.x = cx + i * EYE_GAP;
    sp.y = fromBelow ? SCREEN_H + EYE_SIZE : -EYE_SIZE;
    const pupil = mmsxx.sprite(SPRITE_SYMBOLS.eyeIris0);
    pupil.priority = 10;
    // 血管は赤の単色スプライト。**瞳より奥**に置く。
    // 血管は白目の側に走るものなので、黒目の上に乗るのはおかしい。
    // 数字を分けておくと前後が入れ替わらず、席の取り合いでも
    // 手前(瞳)が先に座るので、必ず残ってほしいほうが残る
    const vein = mmsxx.sprite(SPRITE_SYMBOLS.eyeVein);
    vein.priority = 9;
    // **瞳(黒)は明滅させない**。消えている瞬間に写真を撮ると、
    // 眼球に黒目が無い絵になってしまう。
    // 明滅するのは血管だけで、**左右で 1 コマずらす**。
    // こうすると、どのコマで撮っても どちらかの血管は写る
    pupil.blink = 0;
    vein.blink = 2; vein.blinkPhase = i;
    eyeballs.push({
      sp, pupil, vein, hp: EYE_HP, age: 0, fromBelow,
      // 上から来たら画面の上寄り、下から来たら下寄りで止まる
      targetY: fromBelow ? SCREEN_H - EYE_SIZE - 16 : 24,
      state: 'enter', hover: EYE_HOVER,
    });
  }
}

function removeEyeball(e) {
  mmsxx.removeBgSprite(e.sp);
  mmsxx.removeSprite(e.pupil);
  mmsxx.removeSprite(e.vein);
  eyeballs.splice(eyeballs.indexOf(e), 1);
}

function clearEyeballs() {
  for (const e of [...eyeballs]) removeEyeball(e);
  eyeballs = [];
}

function killEyeball(e) {
  spawnBoom(e.sp.x + 8, e.sp.y + 8);
  mmsxx.audio.playSE('boom', SE_HIT);
  score += 3000;
  spawnPopup(e.sp.x, e.sp.y, 3000);
  removeEyeball(e);
  bigKills++;
  // 0.5 秒以内に 2 体とも倒したらボーナス
  if (playFrame - eyeKillFrame <= EYE_BONUS_WINDOW && eyeballs.length === 0) {
    score += EYE_BONUS;
    spawnPopup(SCREEN_W / 2 - 32, 96, EYE_BONUS);
    showNotice('DOUBLE! ' + EYE_BONUS);
    playJingle('bonus');
  }
  eyeKillFrame = playFrame;
  drawHUD();
}

function updateEyeballs() {
  for (const e of [...eyeballs]) {
    e.age++;
    const dir = e.fromBelow ? -1 : 1;
    if (e.state === 'enter') {
      e.sp.y += 1.0 * dir;
      if (dir > 0 ? e.sp.y >= e.targetY : e.sp.y <= e.targetY) e.state = 'hover';
    } else if (e.state === 'hover') {
      // 停滞中はぴたりと止まる(ゆらゆらさせない)
      if (--e.hover <= 0) e.state = 'leave';
    } else {
      e.sp.y += 1.2 * dir;   // そのまま同じ向きに通り抜けて去っていく
      if (e.sp.y < -EYE_SIZE - 8 || e.sp.y > SCREEN_H + EYE_SIZE + 8) { removeEyeball(e); continue; }
    }
    // 瞳は自機の方を向く。動いているあいだは本体(BG スプライト)と同じ
    // 8 ドット刻みにしてずれを防ぎ、止まっているあいだは滑らかに動かす
    const moving = e.state !== 'hover';
    const bx = snap8(e.sp.x), by = snap8(e.sp.y);
    const cx = bx + EYE_SIZE / 2, cy = by + EYE_SIZE / 2;
    const a = Math.atan2(player.y + 8 - cy, player.x + 8 - cx);
    if (moving) {
      e.pupil.x = cx - 8 + Math.round(Math.cos(a) * 0.9) * 8;
      e.pupil.y = cy - 8 + Math.round(Math.sin(a) * 0.9) * 8;
    } else {
      e.pupil.x = cx - 8 + Math.cos(a) * 6;
      e.pupil.y = cy - 8 + Math.sin(a) * 6;
    }
    // ダメージが進むほど瞳が閉じていく
    const stage = Math.min(3, Math.floor((1 - e.hp / EYE_HP) * 4));
    e.pupil.image = IRIS_IMGS()[stage];
    // 血管は眼球の中心に合わせて置く。1 コマおきに出るので、
    // 重なっているあいだも 1 行に並ぶ枚数は増えすぎない
    e.vein.x = cx - 16;
    e.vein.y = cy - 16;
    e.pupil.visible = true;
    e.vein.visible = true;   // 実際の交互表示は blink がやる
  }
}


// ---- 流れ星 ----
// 背景をにぎやかす飾り。当たり判定は無い。
// 尾の伸び方が違う 4 コマを回して、尾が伸び縮みして見えるようにする。
let shootStars = [];
let shootTimer = 240;

function spawnShootStar() {
  const sp = mmsxx.bgSprite(BG_SYMBOLS.shootStar0);
  sp.frames = [BG_SYMBOLS.shootStar0, BG_SYMBOLS.shootStar1, BG_SYMBOLS.shootStar2, BG_SYMBOLS.shootStar3];
  sp.frameRate = 4;
  // 大きな背景オブジェクト(木星など)より奥。BG スプライトとレイヤーは
  // 同じ優先度空間なので、この 1 行で「星より手前・木星より奥」に置ける
  sp.priority = BGP_SHOOT;
  sp.x = SCREEN_W + 8;
  sp.y = -32 + Math.random() * 60;
  shootStars.push({ sp, vx: -6, vy: 5 });
}

function clearShootStars() {
  for (const s of shootStars) mmsxx.removeBgSprite(s.sp);
  shootStars = [];
}

function updateShootStars() {
  // ラスボス戦は静かな空間なので、賑やかしの流れ星は出さない
  if (boss && boss.kind === 'king') { clearShootStars(); return; }
  if (--shootTimer <= 0) {
    shootTimer = 300 + Math.floor(Math.random() * 600);
    spawnShootStar();
  }
  for (const s of [...shootStars]) {
    s.sp.x += s.vx; s.sp.y += s.vy;
    if (s.sp.x < -40 || s.sp.y > SCREEN_H + 40) {
      mmsxx.removeBgSprite(s.sp);
      shootStars.splice(shootStars.indexOf(s), 1);
    }
  }
}

// ---- 中ボス「モアイ」----
// 正面向きの巨大な石像(64x80)。十字に 4 分割された状態で画面の上下から現れ、
// まず左右がくっついて上下 2 つになり、次に上下がくっついて 1 体になる。
// 合体前は「切り口(内側)」しか効かない。合体前にパーツを壊せると大ダメージ。
// 出ているあいだは敵もアイテムも出ず、曲も緊迫したものに変わる。
// 大きすぎたので、台座の下を削って 64x64 にした
const MOAI_W = 64, MOAI_H = 64;
const MOAI_QW = 32, MOAI_QH = 32;
const MOAI_PART_HP = 60;      // 合体前の 1 パーツ
const MOAI_HP = 320;          // 合体後(とても固い)
// すき間がこれより狭くなると、中にいる自機は押しつぶされる(自機は 16 ドット)
const MOAI_CRUSH_GAP = 20;
const MOAI_LOST_DAMAGE = 90;  // 合体前に 1 パーツ壊すごとに減る体力
const MOAI_HOLD = 210;        // 出てきたあと、四隅で構えている時間(3.5 秒)
const MOAI_TELL_DELAY = 30;   // 合体の動きだしから「まだ撃つな」を出すまで(0.5 秒)
const MOAI_MERGE1 = 70;       // 左右がくっつくまで(1 段階目はさっと)
const MOAI_MERGE2 = 300;      // 上下がくっつくまで
// 左右がくっついたあと、上下合体に入るまでの待ち(2〜5 秒のランダム)。
// いつも同じ間隔だとタイミングを覚えられてしまうので、毎回ずらす
const MOAI_WAIT_MIN = 120, MOAI_WAIT_MAX = 300;
const MOAI_WAIT_FLASH = 10;   // 入る直前に一瞬白くなる長さ
const MOAI_STAY = 1800;       // 合体後に居座る時間(30 秒)
const MOAI_APPEAR = 1500;     // 面のなかごろに出てくる
// ここまでにモアイも目玉も出ていなければ、どちらかを必ず出す
const MUST_APPEAR = 3000;
let moai = null;
let moaiSpawned = false;
let moaiToldInside = false;   // 「内側から壊せ」を出したか(1 プレイに 1 回)
// ---- こすり打ちの案内 ----
//
// **手が空いた瞬間に教える。** 撃ちかたの説明を遊びはじめに並べても、
// そのときは覚える理由が無い。**こすれば効く場面**に出くわしたところで
// 出せば、その場で試せて身に付く。
//
// 出すのは「狙いどきが来た」ところだけ:
//   モアイ … 内側を撃てるようになった瞬間
//   タコ / カニ … 装甲がはがれて無防備になった瞬間
//   貝 … 輪にすき間が空いて、中の生き物を直に叩けるようになった瞬間
//
// **出さない相手**: ドラゴン(そういう瞬間が無い)、ラスボスの 1 / 2、未実装さん。
// **指で遊ぶときだけ**(キーボードには連打の口が最初からある)
// **数えるのは場面ごと。** 1 プレイに 1 回だけにすると、
// 1 面でモアイに出会った人はボスの狙いどきで二度と出ない。
// 場面は道中に散らばっていて、前に見たのは忘れているころなので、
// **相手ごとに 1 回ずつ**出す
const rubHintDone = new Set();
let rubHintIn = 0;            // 出すまでの残りコマ(0 は出さない)

/**
 * こすり打ちの案内を予約する。
 *
 * **ほんの少しだけ置く。** 呼ばれる場面ではたいてい別の知らせ
 * (「内側から壊せ」など)が出たところで、showNotice は前のを消してしまう。
 * 1 コマ置けば順番は入れ替わる。
 *
 * **置きすぎないこと。** 2 秒 待たせていたころは、出るころには相手が
 * 動き出していて「安心して連射できるタイミング」を過ぎていた。
 * 出したいのは**無防備になったその瞬間**
 * @param {string} who どの場面か('moai' / 'octopus' / 'crab' / 'nautilus')
 */
/** こすりの指を見せている最中か。**倒したところで止める**のに使う */
let rubDemoOn = false;

function cueRubHint(who, delay = 36) {
  if (!PAD_ON || rubHintDone.has(who)) return;
  rubHintDone.add(who);
  rubHintIn = delay;
}
// ---- 開発用の口 ここから ----
// **開発版だけ**: 狙いどきまで遊び進まなくても、案内の出かたを見られるように
// (出す場面はどれもボス戦の途中なので、そこまで行くのが手間)
if (DEV) {
  mmsxx.expose('mmsxxRubHint', () => {
    rubHintDone.clear();
    cueRubHint('dev', 30);
    return PAD_ON ? '0.5 秒後に出ます' : '指で遊ぶ端末ではないので出ません';
  });
}
// ---- 開発用の口 ここまで ----
let moaiToldWait = false;     // 「色が変わるまで待て」を出したか(1 プレイに 1 回)
// 石の表(外側)を撃つと怒る。4 発で赤とピンクになり、壊せなくなる
// 色が付く前に**切り口(内側)**へ撃ち込んだ数。これだけ当てると怒る。
// 流れ弾で 2〜3 発当たることはあるので、そのぶんは許す
const MOAI_RAGE_HITS = 8;
// 怒ると壊せなくなる。居座られても手が出せないので、30 秒で帰らせる
const MOAI_ANGRY_LEAVE = 1800;
// 怒ったときの色の入れ替え。緑と青の絵をそのまま赤とピンクに読み替える
const MOAI_RAGE_MAP = { 2: 8, 3: 9, 12: 6, 4: 6, 5: 13, 7: 9 };
// まだ倒せないあいだの色。緑と青をぜんぶ白と灰色に読み替えて「ただの石」にする
const MOAI_STONE_MAP = { 2: 15, 3: 14, 12: 14, 4: 15, 5: 14, 7: 14 };

function moaiActive() { return !!moai; }

/**
 * まだ手を出してはいけない(白と灰色の石の)あいだかどうか。
 * 四隅に散らばっているあいだと、左右がくっついたあとの待ちのあいだ。
 * このあいだは弾も当たらない = 撃っても怒らせない。
 * 上下が寄りはじめて色が付いたら、内側のすき間を狙える合図
 */
function moaiSafe(m) {
  return m.fsm.in('hold', 'merge1', 'wait');
}

function spawnMoai() {
  clearMoai();   // すでに出ていたら片づけてから(絵が残らないように)
  // モアイが出たら、いま飛んでいる敵は**全部まとめて片づける**。
  // 硬いキューブも残さない(場をモアイに明け渡す)
  bombAllEnemies();
  const cx = (SCREEN_W - MOAI_W) / 2;
  const mk = (img, x, y, quad) => {
    const sp = mmsxx.bgSprite(img);
    sp.x = x; sp.y = y; sp.priority = BGP_FRONT + 1;
    return { sp, hp: MOAI_PART_HP, quad, flash: 0 };
  };
  moai = {
    hp: MOAI_HP, max: MOAI_HP, lost: 0,
    // 合体しきったあとに居座る場所
    x: cx, y: 40, vx: 0.5, age: 0, insideHp: 0,
    tellIn: 0,         // 「まだ撃つな」を出すまでの残り(0 は出さない)
    // 左右がくっついたあとの待ち時間。**先に決めておく**ことで、
    // 「まだ撃つな」を合体の動きだしから待ち終わりまで出しっぱなしにできる
    waitLen: MOAI_WAIT_MIN + Math.floor(rnd() * (MOAI_WAIT_MAX - MOAI_WAIT_MIN + 1)),
    parts: [
      // 上半分は画面の上から、下半分は下から入ってくる
      mk(BG_SYMBOLS.moaiTL, cx - 48, -MOAI_QH - 8, 0),
      mk(BG_SYMBOLS.moaiTR, cx + MOAI_QW + 48, -MOAI_QH - 8, 1),
      mk(BG_SYMBOLS.moaiBL, cx - 48, SCREEN_H + 8, 2),
      mk(BG_SYMBOLS.moaiBR, cx + MOAI_QW + 48, SCREEN_H + 8, 3),
    ],
  };
  moai.fsm = new StateMachine(MOAI_STATES, { start: 'hold', ctx: moai, name: 'モアイ' });
  // 怒ると赤とピンクに変わる(色だけで伝える)
  moai.rage = 0;
  moai.angry = false;
  moai.angryTimer = 0;   // 怒ってからの時間(壊せないので、しばらくしたら帰る)
  mmsxx.audio.playSE('eyeAppear', SE_JINGLE);
  showNotice('MOAI APPROACHING!');
}

function clearMoai() {
  if (!moai) return;
  for (const p of moai.parts) mmsxx.removeBgSprite(p.sp);
  if (moai.tint) mmsxx.removeBgSprite(moai.tint);
  moai = null;
}

/**
 * 色が付く前に、切り口(内側)を撃たれた。
 * 何発か続けて撃ち込まれると怒って、赤とピンクになり壊せなくなる。
 * 外側を撫でても怒らない(流れ弾で理不尽に怒らせないため)
 */
function angerMoai(m) {
  if (m.angry || !m.fsm.in('hold', 'merge1', 'wait', 'merge2')) return;   // 合体してからでは怒らない
  if (++m.rage < MOAI_RAGE_HITS) return;
  m.angry = true;
  m.angryTimer = MOAI_ANGRY_LEAVE;
  // 赤くなったらもう手出しできないので、じらす意味が無い。
  // 構えている時間と待ち時間をやめて、そのまま合体の動きに入る。
  // (合体そのものの動き = m.timer は残す。飛ばすと絵が飛んでしまう)
  if (m.fsm.is('hold')) m.fsm.go('merge1', m);
  else if (m.fsm.is('wait')) m.fsm.go('merge2', m);
  // 赤くなること自体が合図なので、文字は出さない
  mmsxx.audio.playSE('nobreak', SE_HIT);
  flashTimer = 2;
}

/** パーツの置き場所(合体の進み具合で変わる) */
// 1 段階目の合体は画面の上下端の近くで行う
// パーツの切り出し名(4 分割は quad 番号、上下 2 枚は TOP / BOT)
const MOAI_PART_KEY = { 0: 'TL', 1: 'TR', 2: 'BL', 3: 'BR', TOP: 'TOP', BOT: 'BOT' };
// 緑(0) -> 青へ 4 段階 -> 青(5) -> 緑へ 4 段階、の 10 コマ
const MOAI_PLAIN = {
  TL: 'moaiTL', TR: 'moaiTR', BL: 'moaiBL', BR: 'moaiBR',
  TOP: 'moaiTop', BOT: 'moaiBottom',
};
const MOAI_BLUE = {
  TL: 'moaiTLb', TR: 'moaiTRb', BL: 'moaiBLb', BR: 'moaiBRb',
  TOP: 'moaiTopB', BOT: 'moaiBottomB',
};
/** 色が変わっていく途中の絵を返す(step 0..9) */
function moaiWaveImage(step, key) {
  if (step === 0) return BG_SYMBOLS[MOAI_PLAIN[key]];
  if (step === 5) return BG_SYMBOLS[MOAI_BLUE[key]];
  const dir = step < 5 ? 'B' : 'G';
  const n = step < 5 ? step : step - 5;
  return BG_SYMBOLS['moaiW' + dir + n + key];
}

// 上下の端ぎりぎりだと、下から撃ってくる敵の居場所が無くなるので
// 1 キャラ(8 ドット)ぶん内側に置く
const MOAI_TOP_Y = 16;
const MOAI_BOT_Y = SCREEN_H - MOAI_QH - 16;
// 上下がくっつく場所。**上下がまったく同じだけ動く**ように、
// 待っている位置のちょうど真ん中に取る
// (居座る場所(m.y)で合わせていたころは、下半分だけ 3 倍も動いていた)
const MOAI_MEET_Y = Math.round((MOAI_TOP_Y + MOAI_BOT_Y - MOAI_QH) / 2 / 8) * 8;

function moaiPartTarget(m, p) {
  if (m.fsm.is('hold')) {
    // 出てきたあと、しばらく四隅で止まっている(構える時間)
    const left = (p.quad === 0 || p.quad === 2);
    const top = p.quad < 2;
    return [left ? 8 : SCREEN_W - MOAI_QW - 8, top ? MOAI_TOP_Y : MOAI_BOT_Y];
  }
  if (moaiShape(m) === 'q4') {
    // 上の 2 つは画面の上のほうで、下の 2 つは下のほうで、それぞれ横にくっつく
    const t = m.fsm.is('merge1') ? 1 - m.fsm.timer / MOAI_MERGE1 : 0;
    const gap = Math.round(40 * (1 - t) / 8) * 8;
    const left = (p.quad === 0 || p.quad === 2);
    const top = p.quad < 2;
    return [m.x + (left ? -gap : MOAI_QW + gap),
      top ? MOAI_TOP_Y : MOAI_BOT_Y];
  }
  if (moaiShape(m) === 'q2') {
    // 上半分と下半分が画面の真ん中へ寄ってくる。
    // 閉じきるまでのあいだ、そのすき間から内部を撃てる
    const t = m.fsm.is('merge2') ? 1 - m.fsm.timer / MOAI_MERGE2 : 0;
    const top = p.quad === 0;
    const from = top ? MOAI_TOP_Y : MOAI_BOT_Y;
    const to = MOAI_MEET_Y + (top ? 0 : MOAI_QH);
    return [m.x, Math.round((from + (to - from) * t) / 8) * 8];
  }
  return [m.x, m.y];
}

function mergeMoaiParts() {
  const m = moai;
  if (moaiShape(m) === 'q4') {
    // 左右をくっつけて、上半分・下半分の 2 つにする(継ぎ目なしの 1 枚絵)
    const top = m.parts.find(p => p.quad === 0) || m.parts.find(p => p.quad === 1);
    const bot = m.parts.find(p => p.quad === 2) || m.parts.find(p => p.quad === 3);
    for (const p of m.parts) mmsxx.removeBgSprite(p.sp);
    const mk = (img, quad) => {
      const sp = mmsxx.bgSprite(img);
      sp.x = m.x; sp.y = quad === 0 ? MOAI_TOP_Y : MOAI_BOT_Y;
      sp.priority = BGP_FRONT + 1;
      return { sp, hp: MOAI_PART_HP * 2, quad, flash: 0 };
    };
    // 上下は一心同体。内側から削ると 2 つまとめて壊れる
    m.insideHp = 256;   // 内側から削るぶんの耐久力
    m.parts = [];
    if (top) m.parts.push(mk(BG_SYMBOLS.moaiTop, 0));
    if (bot) m.parts.push(mk(BG_SYMBOLS.moaiBottom, 1));
    // すぐ上下合体に入らず、2〜5 秒のあいだ そのまま待つ。
    // 待ち終わりに一瞬白く光ってから合体に入るので、合図は出るが
    // タイミングは毎回ちがう
    // 待ちの長さは出てきたときに決めてある(「まだ撃つな」を
    //  出しっぱなしにする長さを、先に知っておきたいため)。
    // すでに怒っているときは待たない。そのまま上下合体の動きへ
    // 「まだ撃つな」は左右合体の動きだしのところで出してある。
    // 「内側から撃て」は、**狙えるようになってから**出す(下の待ちが明けたところ)
  } else {
    // 上下をくっつけて 1 体になる
    for (const p of m.parts) mmsxx.removeBgSprite(p.sp);
    const sp = mmsxx.bgSprite(BG_SYMBOLS.moaiFront);
    // くっついた場所からそのまま始めて、居座る高さへはゆっくり上がっていく
    m.y = MOAI_MEET_Y;
    sp.x = m.x; sp.y = m.y; sp.priority = BGP_FRONT + 1;
    m.parts = [{ sp, hp: 0, quad: 0, flash: 0 }];
    // 色の変化は 8 ブロック同時。各ブロックが上から 2 行ずつ塗り替わる。
    // 途中の姿は 1 枚絵として用意してあるので、絵を差し替えるだけでよい
    // (重ね絵にすると BG スプライトのセルが黒く埋まってしまうため)
    m.tintStep = 0;
    // 合体前に壊されたパーツのぶんだけ、はじめから傷んでいる
    m.max = Math.max(60, MOAI_HP - m.lost * MOAI_LOST_DAMAGE);
    m.hp = m.max;
    m.fire = 60;
  }
  mmsxx.audio.playSE('thud', SE_HIT);
  mmsxx.audio.playSE('bigboom', SE_HIT);   // 合体の重い音
  flashTimer = 2;
}

/** 内側から削り切って、上下まとめて撃破したとき */
/**
 * 自機が上下のすき間に入っているか。
 * 内側から壊したときのボーナスと、押しつぶしの両方で使う
 */
function playerInMoaiGap(m) {
  if (!m || moaiShape(m) !== 'q2' || m.parts.length !== 2) return false;
  const top = m.parts.find(p => p.quad === 0);
  const bot = m.parts.find(p => p.quad === 1);
  if (!top || !bot) return false;
  const x0 = Math.min(top.sp.x, bot.sp.x);
  const x1 = Math.max(top.sp.x, bot.sp.x) + MOAI_W;
  const gy0 = top.sp.y + MOAI_QH;   // すき間の上のふち
  const gy1 = bot.sp.y;             // すき間の下のふち
  const px = player.x + 8, py = player.y + 8;
  return px > x0 && px < x1 && py > gy0 - 8 && py < gy1 + 8;
}

/** すき間の広さ(閉じ切ると 0 以下) */
function moaiGapSize(m) {
  const top = m.parts.find(p => p.quad === 0);
  const bot = m.parts.find(p => p.quad === 1);
  return (top && bot) ? bot.sp.y - (top.sp.y + MOAI_QH) : 999;
}

function killMoaiInside() {
  const m = moai;
  if (!m) return;
  // **すき間の中にいたときだけ** 10 万点。
  // 外から撃って壊した場合は、ふつうに倒したのと同じ 2 万点
  const inside = playerInMoaiGap(m);
  for (const p of m.parts) {
    for (let i = 0; i < 5; i++) {
      spawnBoom(p.sp.x + Math.random() * MOAI_W, p.sp.y + Math.random() * MOAI_QH);
    }
  }
  mmsxx.audio.playSE('bossboom', SE_HIT);
  flashTimer = 3;
  const gain = inside ? EYE_BONUS : 20000;
  score += gain;
  spawnPopup(SCREEN_W / 2 - 32, 96, gain);
  showNotice(inside ? ('INSIDE JOB! ' + gain) : ('MOAI DOWN  ' + gain));
  if (inside) playJingle('bonus');
  bigKills++;
  clearMoai();
  drawHUD();
}

function killMoaiPart(p) {
  spawnBoom(p.sp.x + 8, p.sp.y + 8);
  spawnBoom(p.sp.x + 16, p.sp.y + 24);
  mmsxx.audio.playSE('bigboom', SE_HIT);
  score += 4000;
  spawnPopup(p.sp.x, p.sp.y, 4000);
  mmsxx.removeBgSprite(p.sp);
  moai.parts.splice(moai.parts.indexOf(p), 1);
  moai.lost++;
  bigKills++;
}

/**
 * 合体前は基本ダメージを与えられない。
 * 例外は「上下 2 つになったあと、閉じかけのすき間の内側から撃つ」ときだけ。
 */
function moaiInnerHit(m, p, x, y) {
  if (m.fsm.in('one', 'leave')) return true;
  const sx = p.sp.x, sy = p.sp.y;
  if (moaiShape(m) === 'q2') {
    // 上下 2 つのとき: 上半分は下のふち、下半分は上のふち(すき間の内側)
    return p.quad === 0 ? y > sy + MOAI_QH - 14 : y < sy + 14;
  }
  // 4 つのとき: 中心(十字の切り口)に面した角だけ
  const right = (p.quad === 0 || p.quad === 2) ? x > sx + MOAI_QW - 12 : x < sx + 12;
  const inner = (p.quad < 2) ? y > sy + MOAI_QH - 14 : y < sy + 14;
  return right || inner;
}

/**
 * **モアイの局面。**
 *
 *   hold -> merge1 -> wait -> merge2 -> one -> leave
 *
 * もとは `hold` / `wait` / `timer` の**どれが残っているか**で局面を表していて、
 * そこに「何個に分かれているか」(`state` の q4 / q2 / one)が混ざっていた。
 * 形は局面から決まるので、moaiShape() で導く
 */
const MOAI_STATES = {
  // 出てきたあと、四隅で構えている(プレイヤーの準備時間)
  hold: {
    for: MOAI_HOLD,
    next: 'merge1',
    // 左右合体の動きだしから **0.5 秒おいて**「まだ撃つな」を出す。
    // 大きな動きと文字が同時に出ると、目が散って両方とも入ってこない
    exit: (m) => { if (!moaiToldWait && !m.angry) m.tellIn = MOAI_TELL_DELAY; },
  },
  // 左右がくっつくまで(1 段階目はさっと)
  merge1: {
    viaGo: true,   // 怒らせると構えを飛ばしてここへ来る
    for: MOAI_MERGE1,
    next: 'wait',
    exit: () => mergeMoaiParts(),
  },
  // 左右がくっついたあとの待ち。終わりぎわに一瞬白くする。
  // すでに怒っているときは待たない(そのまま上下合体の動きへ)
  wait: {
    for: (m) => (m.angry ? 0 : m.waitLen),
    next: 'merge2',
    update: (m, f) => {
      if (f.timer === MOAI_WAIT_FLASH) {
        for (const p of m.parts) p.flash = MOAI_WAIT_FLASH;
        mmsxx.audio.playSE('clink', SE_HIT);
      }
    },
    // 待ちが明けた = 色が付いて、内側を狙えるようになった合図。
    // ここで初めて狙いどころを教える(1 回だけ)。
    // 怒らせたあとは内側からも壊せないので、こちらも言わない
    exit: (m) => {
      if (moaiToldInside || m.angry) return;
      moaiToldInside = true;
      showNotice('BREAK IT FROM INSIDE!');
      // **狙いどきが来たところで、こすり打ちも教える**。
      // すき間は閉じるので、ここは速く撃てるほど効く場面でもある
      cueRubHint('moai');
    },
  },
  // 上下がくっつくまで
  merge2: {
    viaGo: true,   // 怒らせると待ちを飛ばしてここへ来る
    for: MOAI_MERGE2,
    next: 'one',
    exit: () => mergeMoaiParts(),
  },
  // 合体して 1 体。画面のやや上をゆっくり左右に漂いながら、リング弾を撒く
  one: {
    for: MOAI_STAY,
    next: 'leave',
    update: (m) => {
      m.x += m.vx;
      if (m.x < 8) { m.x = 8; m.vx = Math.abs(m.vx); }
      if (m.x > SCREEN_W - MOAI_W - 8) { m.x = SCREEN_W - MOAI_W - 8; m.vx = -Math.abs(m.vx); }
      // くっついた場所(画面の中ほど)から、居座る高さへゆっくり上がっていく。
      // 直に代入すると、合体しきった瞬間に上へ飛んでしまう
      m.y += (24 + Math.sin(m.age * 0.02) * 8 - m.y) * 0.05;
      if (state !== 'play' || --m.fire > 0) return;
      m.fire = Math.max(50, 90 - shotLevel * 4);
      // 口から放射状にリング弾(撃ち落とせる)
      const cx = m.x + MOAI_W / 2 - 8, cy = m.y + MOAI_H - 24;
      const base = Math.atan2(player.y + 8 - cy, player.x + 8 - cx);
      // 怒っている(壊せない)あいだは、せめて攻めを厳しくする。
      // リング弾の速さを 1.5 倍にして、避けるのに気を使わせる
      const spd = m.angry ? 1.2 : 0.8;
      // 弾の数も 2 倍(3 発 -> 6 発)。扇の広さは変えたくないので、
      // 間隔を詰めて同じ範囲に倍の数を撒く
      const n = m.angry ? 6 : 3;
      const gap = m.angry ? 0.25 : 0.42;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * gap;
        fireEnemyBullet(cx, cy, Math.cos(a) * spd, Math.sin(a) * spd, true);
      }
      mmsxx.audio.playSE('shot', SE_HIT);
    },
    // 時間切れ。**まず赤くなってから**、あきらめて流れ去っていく。
    // 赤くなるのは「もう壊せない」の合図なので、逃げる前にも見せる。
    // (怒って帰るときは angryTimer のほうから go() で来るので、ここは通らない)
    exit: (m, f) => {
      if (f.timer > 0) return;
      m.angry = true;
      mmsxx.audio.playSE('nobreak', SE_HIT);
      showNotice('IT IS LEAVING!');
    },
  },
  // 逃げるのは下(画面の流れと同じ向き)。上へ帰ると出てきた側へ戻る形になり、
  // 追ってきたようにも見えるので、そのまま流れ去らせる。
  // **姿は必ず出す**(ホログラムの明滅で消えたままだと、
  //  見えないものに当たったように見えてしまう)
  leave: {
    viaGo: true,   // 怒って 30 秒たったときにも来る
    update: (m) => { for (const p of m.parts) { p.sp.y += 2; p.sp.visible = true; } },
  },
};

/** いま何個に分かれているか。**局面から決まる** */
const moaiShape = (m) => (m.fsm.in('hold', 'merge1') ? 'q4'
  : m.fsm.in('wait', 'merge2') ? 'q2' : 'one');

function updateMoai() {
  const m = moai;
  if (!m) return;
  m.age++;
  // 「まだ撃つな」を、合体の動きだしから少し遅らせて出す。
  // 待ちが明けるまで出しっぱなしにするので、遅らせたぶんは長さから引く
  if (m.tellIn > 0 && --m.tellIn === 0 && !moaiToldWait && !m.angry) {
    moaiToldWait = true;
    showNotice('DO NOT SHOOT THE MOAI YET!',
      MOAI_MERGE1 - MOAI_TELL_DELAY + m.waitLen + 30);
  }
  // 怒って赤くなったあとは壊せない。30 秒たったら上へ帰っていく
  if (m.angry && m.angryTimer > 0 && --m.angryTimer <= 0) m.fsm.go('leave', m);
  // 合体しきる前にパーツが全部なくなったら、そこで終わり
  if (m.fsm.in('merge1', 'merge2') && m.fsm.timer <= 1 && m.parts.length === 0) {
    clearMoai(); return;
  }
  // 動きと移り先は MOAI_STATES に書いてある
  m.fsm.step(m);
  if (!moai) return;   // 合体の途中で片づいた
  if (m.fsm.is('leave')) {
    // 流れ去っていくあいだは**ここで終わり**。下の置き場所の計算へ進むと、
    // 毎コマ元の位置へ引き戻されて、画面に居座ってしまう
    if (m.parts.every(p => p.sp.y > SCREEN_H + 8)) clearMoai();
    return;
  }
  if (moaiShape(m) === 'one' && m.parts[0]) {
    // 全体を 1 コマおきに消して、ホログラムのようにちらつかせる
    const holo = (mmsxx.frame & 1) === 0;
    const p0 = m.parts[0];
    p0.sp.visible = holo && !(p0.flash > 0 && (p0.flash & 1));
    // 緑 -> (4 段階) -> 青 -> (4 段階) -> 緑 の 10 コマでくり返す
    const STEP_LEN = 5;
    m.tintStep = (m.tintStep + 1) % (10 * STEP_LEN);
    const step = Math.floor(m.tintStep / STEP_LEN);   // 0..9
    const WAVE = [
      BG_SYMBOLS.moaiFront, BG_SYMBOLS.moaiWaveB1, BG_SYMBOLS.moaiWaveB2, BG_SYMBOLS.moaiWaveB3, BG_SYMBOLS.moaiWaveB4,
      BG_SYMBOLS.moaiFrontBlue, BG_SYMBOLS.moaiWaveG1, BG_SYMBOLS.moaiWaveG2, BG_SYMBOLS.moaiWaveG3, BG_SYMBOLS.moaiWaveG4,
    ];
    p0.sp.image = WAVE[step];
    // 一度怒らせたら、合体したあともずっと赤とピンクのまま
    p0.sp.colorMap = m.angry ? MOAI_RAGE_MAP : null;
  }
  // 合体前も、青への色変わりと 1 コマおきの明滅はする。
  // (1 枚絵に重ねる細かい縞は合体後だけ。ここは絵ごと差し替える)
  const holoNow = (mmsxx.frame & 1) === 0;
  for (const p of m.parts) {
    const [tx, ty] = moaiPartTarget(m, p);
    const rate = moaiShape(m) === 'q4' ? 0.3 : 0.12;
    p.sp.x += (tx - p.sp.x) * rate;
    p.sp.y += (ty - p.sp.y) * (moaiShape(m) === 'q4' ? 0.2 : 0.08);
    if (p.flash > 0) p.flash--;
    // 光っているあいだは**必ず見せる**。
    // 「光る = 1 コマおきに消す」にしていたが、ホログラムの明滅と
    // ちょうど食い違って、上下合体に入るところで丸ごと消えて見えていた
    p.sp.visible = p.flash > 0 || holoNow;
    // 合体前も、緑 -> 青 -> 緑 と「線で」色が変わっていく。
    // 途中の姿は 1 枚絵として用意してあるので、絵を差し替えるだけでよい。
    // 合体後(one)は 1 枚絵なので、ここでは触らない(別のところで差し替える)
    if (moaiShape(m) !== 'one') {
      const key = MOAI_PART_KEY[moaiShape(m) === 'q4' ? p.quad : (p.quad ? 'BOT' : 'TOP')];
      if (m.angry) {
        // 怒ったら色変わりを止めて、赤とピンクで固定する
        p.sp.image = moaiWaveImage(0, key);
        p.sp.colorMap = MOAI_RAGE_MAP;
      } else {
        const STEP_LEN = 5;
        const step = Math.floor(m.age / STEP_LEN) % 10;   // 0..9
        p.sp.image = moaiWaveImage(step, key);
        // **四隅で構えているあいだ(弾が当たらない無敵のあいだ)だけ、白と灰色の石**。
        // 左右合体の動きだしと同時に青緑になる
        // (合体の移動中も石のままにしていたが、色が無い時間が長すぎた)
        // 合体に入る直前は、白と灰色にして「一瞬光った」ように見せる
        p.sp.colorMap = (p.flash > 0 || m.fsm.is('hold'))
          ? MOAI_STONE_MAP : null;
      }
    }
  }
}

// ---- ロケット弾 ----
// 24x96 の BG スプライト。前からまっすぐ飛んでくるので邪魔になる。
// とても硬いが 128 発当てれば壊せる。
const ROCKET_W = 24, ROCKET_H = 96;
// 見せるコマ。灰と白を毎コマ入れ替えつつ、**4 コマに 1 回だけ黄色**を混ぜて
// 弾頭が光ったように見せる。重ねるスプライトは使わない
const ROCKET_FRAMES = () => [BG_SYMBOLS.rocket, BG_SYMBOLS.rocketAlt, BG_SYMBOLS.rocketGlow, BG_SYMBOLS.rocketGlowAlt];
const ROCKET_HP = 128;
const ROCKET_INTERVAL = 900;
let rockets = [];
let rocketTimer = ROCKET_INTERVAL;

const MAX_ROCKETS = 3;

function spawnRocket() {
  if (rockets.length >= MAX_ROCKETS) return;   // 同時に 3 本まで
  const sp = mmsxx.bgSprite(BG_SYMBOLS.rocket);
  sp.priority = BGP_FRONT;
  // 当たり判定のある BG は、背景と見間違えないよう毎コマ色を入れ替える
  sp.frameRate = 1;
  sp.x = Math.max(0, Math.min(SCREEN_W - ROCKET_W,
    snap8(player.x - 4 + (rnd() - 0.5) * 64)));
  sp.y = -ROCKET_H;
  // 弾頭の光は、**BG スプライトのコマ送り**で見せる(重ねるスプライトは使わない)。
  // 4 コマに 1 回だけ黄色いコマが混ざって、光ったように見える
  sp.frames = ROCKET_FRAMES();
  // 尾を引く炎。長さの違う 3 コマと透明の 1 コマを回して揺らめかせる。
  // こちらも BG スプライト(通常スプライトを 1 体ぶん減らす)。
  // セルが黒で埋まるが、宇宙は黒なので見た目には出ない
  const flame = mmsxx.bgSprite(BG_SYMBOLS.rocketFlame1);
  flame.priority = BGP_FRONT - 1;   // ミサイル本体より奥
  flame.frames = [BG_SYMBOLS.rocketFlame1, BG_SYMBOLS.rocketFlame2, BG_SYMBOLS.rocketFlame3, BG_SYMBOLS.rocketFlame0];
  flame.frameRate = 3;
  flame.blink = 2;   // 2 コマに 1 回だけ出して、実機のスプライトらしくちらつかせる
  rockets.push({ sp, flame, hp: ROCKET_HP, flash: 0 });
}

function clearRockets() {
  for (const r of rockets) {
    mmsxx.removeBgSprite(r.sp);
    if (r.flame) mmsxx.removeBgSprite(r.flame);
  }
  rockets = [];
}

function updateRockets() {
  for (const r of [...rockets]) {
    if (!r.frozen) r.sp.y += 1.1;   // **挙動確認の的は流れない**
    if (r.flash > 0) {
      r.flash--;
      // 被弾中だけ白く光らせる(ふだんは frames の色替えにまかせる)
      r.sp.frames = null;
      r.sp.image = (r.flash & 1) ? BG_SYMBOLS.rocket : BG_SYMBOLS.rocketHit;
    } else if (!r.sp.frames) {
      r.sp.frames = ROCKET_FRAMES();
    }
    // 炎はミサイルのお尻(上側)に付ける
    if (r.flame) {
      r.flame.x = snap8(r.sp.x);
      r.flame.y = snap8(r.sp.y) - 44;
      r.flame.visible = true;
    }
    if (r.sp.y > SCREEN_H + 8) {
      mmsxx.removeBgSprite(r.sp);
      if (r.flame) mmsxx.removeBgSprite(r.flame);
      rockets.splice(rockets.indexOf(r), 1);
    }
  }
}

function breakRocket(r) {
  for (let i = 0; i < 6; i++) {
    spawnBoom(r.sp.x + Math.random() * ROCKET_W, r.sp.y + Math.random() * ROCKET_H);
  }
  mmsxx.audio.playSE('bigboom', SE_HIT);
  bigKills++;
  score += 8000;
  spawnPopup(r.sp.x, r.sp.y + 32, 8000);
  mmsxx.removeBgSprite(r.sp);
  // 炎を消し忘れて、ジェット噴射だけが画面に残っていた
  if (r.flame) mmsxx.removeBgSprite(r.flame);
  rockets.splice(rockets.indexOf(r), 1);
  drawHUD();
}

// 移動速度は 3 段階。初期値は控えめで、スピードアップで速くなる
const SPEED_TABLE = [1.5, 2.0, 2.6];

// ---- 自機の動かしかた(遊びの最中だけ) ----
//
// **向きと強さは 1 つの口から読む**(engine/input.js の stick)。
// キーボードもタッチもパッドも同じ形で返ってくるので、ここは 1 通りで済む。
// メニューは今までどおり矢印キーで動く(あちらは別の話)。
//
// **軸ごとに足すのをやめた。** 前は x と y に別々に足していたので、
// 斜めだけ √2 倍 速かった。向きが 8 つしか無いうちは気づきにくいが、
// 丸めを細かくすると「向きによって速さが違う」が効いてくる。
//
// **まずは素のまま**(どの向きも同じ速さ、丸めなし、倒し量も見ない)で見る。
// 前の斜めの速さに合わせたければ、全体へ √2 を掛ければよい
// (?gain=1.41)。どちらが良いかは実機で触って決める

/**
 * **何方向へ丸めるか。** 0 で丸めない(なめらかに 360 度)。
 * `?snap=0` `?snap=4` `?snap=8` `?snap=16` で見比べられる。
 *
 * **既定は 0 = 丸めない。** 指もアナログスティックも 360 度どこへでも向けられる
 * ので、そこを 8 方向へ落とすと せっかくの向きを捨てることになる。
 * キーボードは押せる向きが 8 つしか無いので、丸めなくても 8 方向のまま。
 * (いちど 8 を既定にして実機で見比べたが、0 のままでよいと決めた)
 */
const MOVE_SNAP = (() => {
  const raw = OPT.get('snap');
  const v = Number(raw);
  // **付いていないとき**と**知らない値**を分けて見る
  // (0 は Number(null) と同じになるので、素通しでは「切った」と区別できない)
  return (raw != null && [0, 4, 8, 16].includes(v)) ? v : 0;
})();
/**
 * **倒し量を速さに掛けるか。** 既定で掛ける。
 *
 * そっと動かせば自機もそっと動くので、**指の動きに寄る**。
 * ゆっくり寄せたいときに全速で飛んでいくのが、いちばんの「ずれ」だった。
 * **キーボードは倒し量を持たない(常に 1)ので、不利にはならない**。
 * `?power=0` で掛けないほうへ戻せる
 */
const MOVE_ANALOG = OPT.get('power') !== '0';
/**
 * **全体の速さの倍率。** 既定は 1(どの向きも SPEED_TABLE のまま)。
 *
 * 軸ごとに足していたころは斜めだけ √2 倍 速かったので、
 * その速さに合わせたいときは `?gain=1.41` にする。
 * 0.5〜2 のあいだだけ受ける(打ち間違いで動けなくならないように)
 */
const MOVE_GAIN = (() => {
  const v = Number(OPT.get('gain'));
  return (v >= 0.5 && v <= 2) ? v : 1;
})();
let speedLevel = 1;
/**
 * **押しっぱなしのときの連射間隔**(コマ)。
 *
 * 20 コマ(毎秒 3 発)だったのを 13 まで詰めたが、速すぎたので **16** へ戻した
 * (毎秒 3.75 発。20 のころと 13 のころの あいだ)。
 * 指で遊ぶときは、こすらないかぎりこの速さが出るぶんの全部なので、
 * ここが遅いと**こすり続けないと戦えない**遊びになってしまう。
 * **キーボードで押しっぱなしにしている人にも同じだけ効く**(PC も一緒に変わる)
 */
const AUTO_FIRE_INTERVAL = 16;
let volleySeq = 0;
let volleys = new Map(); // volley ID -> 残っている弾数
let lastShotFrame = -999;

let bubbleRect = null;
// 涙に当たったときの見た目を出す間隔(痛くはない)
let tearSplash = 0;
function clearBubble() {
  if (!bubbleRect) return;
  dbg.fill(0, bubbleRect.x, bubbleRect.y, bubbleRect.w, bubbleRect.h);
  bubbleRect = null;
}

function clearEntities() {
  // くり返し再生の SE が残っていると、場面が変わっても鳴り続ける。
  // 場を片づけるここで必ず止める(止め忘れの最後の受け皿)
  stopLaserSE();
  // 知らせと一緒に出しているラッパの絵。**知らせが消える前に場面が変わる**と
  // (ポーズ中に Q でタイトルへ戻ったときなど)残ってしまうので、ここでも消す
  hideMuteIcon();
  clearBubble();
  for (const b of bullets) mmsxx.removeSprite(b.sp);
  for (const e of enemies) mmsxx.removeSprite(e.sp);
  for (const b of enemyBullets) mmsxx.removeSprite(b.sp);
  for (const b of booms) {
    if (b.sp) mmsxx.removeSprite(b.sp);
    if (b.core) b.core.remove();   // 芯も一緒に片づける(色ごとの枚をまとめて)
  }
  for (const it of items) mmsxx.removeSprite(it.sp);
  clearClawMissiles();
  clearEyeballs();
  clearMoai();
  clearShootStars();
  clearWeakSparks();
  clearDeathBurst();
  // 青い裂け目は**集計のあいだ残す**ようにしたので、
  // 場を片づけるここで消さないと、次のゲームまで持ち越してしまう
  clearKingEscape();
  if (boss) {
    if (boss.eyeL) mmsxx.removeSprite(boss.eyeL);
    if (boss.eyeR) mmsxx.removeSprite(boss.eyeR);
    if (boss.eyeL2) mmsxx.removeSprite(boss.eyeL2);
    if (boss.eyeR2) mmsxx.removeSprite(boss.eyeR2);
      if (boss.mouth) mmsxx.removeSprite(boss.mouth);
    for (const g of boss.guards || []) mmsxx.removeSprite(g.sp);
  for (const g of boss.guards || []) mmsxx.removeSprite(g.sp);
  if (boss.mouth) mmsxx.removeSprite(boss.mouth);
  for (const g of boss.guards || []) mmsxx.removeSprite(g.sp);
    if (boss.charge) mmsxx.removeSprite(boss.charge);
    if (boss.chargeRing) mmsxx.removeSprite(boss.chargeRing);
    if (boss.arms) mmsxx.removeSprite(boss.arms);
    if (boss.brow) mmsxx.removeSprite(boss.brow);
    if (boss.crown) mmsxx.removeSprite(boss.crown);
  for (const t of boss.tears || []) mmsxx.removeSprite(t.sp);
  for (const sp of boss.blush || []) mmsxx.removeSprite(sp);
  if (boss.glint) mmsxx.removeSprite(boss.glint);
    for (const t of boss.tears || []) mmsxx.removeSprite(t.sp);
  for (const sp of boss.blush || []) mmsxx.removeSprite(sp);
  if (boss.glint) mmsxx.removeSprite(boss.glint);
    for (const sp of boss.blush || []) mmsxx.removeSprite(sp);
  if (boss.glint) mmsxx.removeSprite(boss.glint);
    if (boss.glint) mmsxx.removeSprite(boss.glint);
    for (const sp of boss.clawSps || []) mmsxx.removeSprite(sp);
    for (const sp of boss.pods || []) mmsxx.removeSprite(sp);
    clearNautilus(boss);
    clearDragonSegs(boss);
    clearKing(boss);
  }
  clearBossParts();
  bossVisible = true;
  for (const sp of titleSparks) sp.visible = false;
  bullets = []; enemies = []; enemyBullets = []; booms = []; items = [];
  clearAsteroids();
  clearRockets();
  clearWeights();
  boss = null;
  if (bossMode) endBossMode();
  neb.visible = true;
  volleys = new Map();
  lastShotFrame = -999;
}

/** 弾が当たったときの処理。弾は必ず消える */
function bulletHits(b) {
  removeBullet(b);
  return true;
}

/** 自弾を 1 発ぶん取り除き、その volley の残弾数を減らす */
function removeBullet(b) {
  mmsxx.removeSprite(b.sp);
  bullets.splice(bullets.indexOf(b), 1);
  const n = volleys.get(b.volley);
  if (n <= 1) volleys.delete(b.volley);
  else volleys.set(b.volley, n - 1);
}

// パワー段階ごとのショット。front は真上から、back は真下からの角度(度)。
// 数値だけなら角度、[角度, 横のずれ] を書くと平行に並べて撃つ(V字にならない)。
const NARROW = 15, WIDE_4 = [-33.75, -11.25, 11.25, 33.75], WIDE_5 = [-45, -22.5, 0, 22.5, 45];
const SHOT_TABLE = [
  { front: [0], back: [] },                                        // P1 前 1
  { front: [[0, -5], [0, 5]], back: [] },                          // P2 前 2(平行)
  { front: [[0, -5], [0, 5]], back: [0] },                         // P3 前 2 + 後ろ 1
  { front: [-NARROW, 0, NARROW], back: [0] },                      // P4 前 3(狭) + 後ろ 1
  { front: [-NARROW, 0, NARROW], back: [-NARROW, NARROW] },        // P5 前 3(狭) + 後ろ 2(狭)
  { front: WIDE_4, back: [-NARROW, NARROW] },                      // P6 前 4(広) + 後ろ 2(狭)
  { front: WIDE_5, back: [-NARROW, NARROW] },                      // P7 前 5(広) + 後ろ 2(狭)
  { front: WIDE_5, back: [-45, 0, 45] },                           // P8 前 5(広) + 後ろ 3(広)
];
const MAX_POWER = SHOT_TABLE.length;

/** ショットを撃つ。画面上の volley が上限に達していれば何もしない。 */
function fireShot() {
  if (volleys.size >= maxVolleys) return;
  const SPD = 10, RAD = Math.PI / 180;
  const t = SHOT_TABLE[shotLevel - 1];
  // 要素は 角度 か [角度, 横のずれ]
  const dir = (e, up) => {
    const [a, dx] = Array.isArray(e) ? e : [e, 0];
    return { vx: Math.sin(a * RAD) * SPD, vy: (up ? -1 : 1) * Math.cos(a * RAD) * SPD, dx };
  };
  const dirs = [
    ...t.front.map(e => dir(e, true)),
    ...t.back.map(e => dir(e, false)),
  ];
  const id = ++volleySeq;
  let phase = 0;
  for (const d of dirs) {
    // すべて 16x16 スプライトなので、中心を合わせれば自機の中心から出る
    const sp = mmsxx.sprite(SPRITE_SYMBOLS.bulletP);
    sp.x = player.x + (d.dx || 0);
    sp.y = player.y;
    sp.priority = 5;
    // 込み合ったときは**まっさきに譲る**。弾は数が多く、
    // 1 コマ消えても弾道は目で追えるため
    sp.rank = 'last';
    // 弾ごとに点滅の位相をずらして、まとめて消えないようにする
    bullets.push({ sp, vx: d.vx, vy: d.vy, volley: id, phase: phase++ });
  }
  volleys.set(id, dirs.length);
  lastShotFrame = playFrame;
  if (recordOn()) {
    tally.shots++;
    playShots++;
    const f = mmsxx.frame;
    rapidShots.push(f);
    // 間があいていたら、そこから撃ち続けはじめたことにする
    if (f - lastFireFrame > RAPID_GAP) streakStart = f;
    lastFireFrame = f;
  }
  mmsxx.audio.playSE('shot', SE_HIT);
}

/** 5way でアイテムを取ったときのボム: 画面上の敵と敵弾を全滅させる(アイテムは出ない) */
/** 敵の種類ごとの得点 */
// 得点はすべて 100 の倍数(最低 100 点)。10 の位は動かさない
const ENEMY_SCORE = { A: 100, B: 200, C: 1000, D: 1100, E: 800, F: 200, G: 400, H: 600, I: 300, J: 500,
  K: 500, L: 900, M: 400, N: 3000 };

let killsSinceCoin = 0;   // スコアアイテムを落とすまでの撃破数
let bigKills = 0;         // その面で倒した大きい敵の数
let coinChainBest = 0;    // その面で伸ばした $ の最高額

/** 敵を倒す(得点・アイテム・爆発をまとめて処理する) */
function killEnemy(e) {
  if (recordOn()) {
    tally.kills++;
    if (burning) tally.backfire++;   // 推進炎で焼いたぶん
  }
  spawnBoom(e.sp.x, e.sp.y);
  mmsxx.audio.playSE('boom', SE_HIT);
  // キューブは取りこぼさず壊し続けると得点が倍々に上がる
  const gain = ENEMY_SCORE[e.type];
  score += gain;
  if (e.hasStar) dropItem(e.sp.x + 2, e.sp.y, 'star');       // 紫のキューブが宝珠を落とす
  else if (e.hasAuto) dropItem(e.sp.x + 2, e.sp.y, 'auto');  // 黄色いキューブから ? が出る
  else if (e.hasItem || e.type === 'C') dropItem(e.sp.x + 2, e.sp.y, randomItemKind());
  else if (e.type !== 'D' && ++killsSinceCoin >= 5) {
    // ふつうの敵は 5 匹に 1 回スコアアイテムを落とす
    killsSinceCoin = 0;
    dropItem(e.sp.x + 2, e.sp.y, 'coin');
  }
  // 光る敵は $ をばらまく(硬いぶんの見返り)
  if (e.type === 'N') {
    for (let i = 0; i < GLOWER_COINS; i++) {
      const a = (Math.PI * 2 * i) / GLOWER_COINS;
      dropItem(e.sp.x + 2 + Math.cos(a) * 14, e.sp.y + Math.sin(a) * 10, 'coin');
    }
  }
  if (e.type === 'D' || ENEMY_SCORE[e.type] >= 800) spawnPopup(e.sp.x, e.sp.y, gain);
  drawHUD();
  mmsxx.removeSprite(e.sp);
  const i = enemies.indexOf(e);
  if (i >= 0) enemies.splice(i, 1);
}

/** 敵にダメージを与える。knockback=true ならキューブは後ろへずれる */
function hitEnemy(e, dmg, knockback) {
  e.hp -= dmg;
  if (e.hp <= 0) { killEnemy(e); return; }
  // 耐久力のある敵(キューブ・硬いUFO)は弾かれたようなキンキン音
  const tough = e.type === 'D' || e.type === 'C';
  mmsxx.audio.playSE(tough ? 'clink' : 'hit');
  if (knockback && e.type === 'D') e.sp.y -= 8;   // のけぞりは控えめに
}

/** 推進炎に触れた敵にダメージ(弾 1 発ぶん / 最大スピードなら 2 発ぶん) */
const FLAME_OFFSET = 17; // 機体からの距離
// ドラゴンのアイテムを取ったか。緑の大きな炎になり、当たり判定も広がる。
// **やられても消えない**(スピードの段階とは別のもの)
let dragonFlame = false;
// 推進炎のコマ送り用の時計。mmsxx.frame と違い、画面を止めているあいだは進まない
let flameFrame = 0;
// ドラゴンの炎は七色に光る。色ちがいの絵を先に作っておいて差し替えるだけにする
// (スプライトは 1 色なので、色を変えるには絵を作り直すしかない)
const DRAGON_FLAME_COLORS = [8, 9, 10, 2, 7, 4, 13];   // 赤 橙 黄 緑 空 青 紫
let dragonFlameImgs = null;
function dragonFlameImg() {
  // 形は**中身だけ**の 1 種類。外わくだけの絵は使わない(欠けて見えるため)。
  // 色は 2 コマごとに七色を回す
  if (!dragonFlameImgs) {
    dragonFlameImgs = DRAGON_FLAME_COLORS.map(c => recolor(SPRITE_SYMBOLS.flameDragonB, c));
  }
  const c = Math.floor(flameFrame / 2) % dragonFlameImgs.length;
  return dragonFlameImgs[c];
}
function burnEnemiesBehind() {
  const dmg = DAMAGE_TABLE[damageLevel - 1] * (speedLevel >= 3 ? 2 : 1);
  const fx = player.x + 8, fy = player.y + FLAME_OFFSET + (dragonFlame ? 8 : 3);
  // 噴射の当たり判定は炎の見た目より小さめにする。
  // 緑の炎は絵が一回り大きいぶん、判定も広い
  const r = dragonFlame ? 11 : 7;
  burning = true;   // ここで倒れたぶんは「炎で焼いた」ことにする
  for (const e of [...enemies]) {
    if (Math.abs((e.sp.x + 8) - fx) < r && Math.abs((e.sp.y + 8) - fy) < r) hitEnemy(e, dmg, false);
  }
  burning = false;
  burnBossBehind(fx, fy, r);
}

/**
 * 推進炎をボスに当てる。**弾よりずっと効く(6 倍)**。
 * ただし炎は自機の真下なので、当てるにはボスを追い越して背を向けることになる。
 * ドラゴンのアイテムを取っていれば炎が大きく、当てられる範囲も広い。
 */
function burnBossBehind(fx, fy, r) {
  if (!boss || boss.dying > 0) return;
  // **弾とは別の間隔で数える**。弾を当てた直後でも炎は効くし、
  // 炎を当てた直後でも弾は効く(2 つの攻めが打ち消し合わないように)
  if (boss.burnGap > 0) { boss.burnGap--; return; }
  // **ドラゴンには炎が通らない**。自分が炎を吐く相手なので、
  // 上から覆いかぶさって焼くだけでは倒せない(口をねらうか小惑星にぶつける)
  if (boss.kind === 'dragon') return;
  if (boss.kind === 'king' && !bossIs(boss, 'man', 'pose')) return;
  if (kingIs(boss, 'meditate')) return;   // 瞑想中は炎も通らない
  // **必ず先に「炎が当たっているか」を見る**。
  // (ここを飛ばして先に削っていたため、出てくるだけで体力が減っていた)
  const c = bossCenter(boss);
  if (!c) return;
  const hw = (boss.kind === 'king' ? KING_MAN_W : BOSS_W) / 2;
  const hh = (boss.kind === 'king' ? KING_MAN_H : BOSS_H) / 2;
  // **自機がボスより上にいるときだけ**効く。
  // 炎は自機の後ろ(下)へ出るので、上から覆いかぶさる形でしか当てられない
  if (player.y + 8 >= c[1]) return;
  if (Math.abs(fx - c[0]) > hw + r) return;
  // ラスボスは頭でも胴でも通る(頭にぶつからないぶん、焼きに行きやすい)
  if (boss.kind === 'king') {
    if (fy < boss.y - r || fy > boss.y + KING_MAN_H + r) return;
  } else if (Math.abs(fy - c[1]) > hh + r) return;
  boss.burnGap = BOSS_FLAME_GAP;
  // 七色の炎なら 2 倍。差は bossFlameDamage() が持っている
  const dmg = bossFlameDamage();
  // 出てくる(つま先立ち)あいだは体力がまだ入っていないので、
  // 焼いたぶんを覚えておいて、構え終わった時に体力から引く
  if (boss.kind === 'king' && bossIs(boss, 'pose')) {
    // 予約できるのは **1 撃ぶんだけ**。
    // 出てくるあいだ焼き続けても、そこで打ち止めにする
    // (構える前に大半を削れてしまうと、第 2 段階が始まらなくなるため)
    if ((boss.preBurnHits || 0) >= KING_PRE_BURN_MAX) return;
    boss.preBurnHits = (boss.preBurnHits || 0) + 1;
    boss.preBurn = (boss.preBurn || 0) + dmg;
    boss.flash = 4;
    mmsxx.audio.playSE('weak');
    spawnWeakSpark(fx - 8, fy - 8);
    return;
  }
  boss.hp -= dmg;
  tallyHit(boss, 'flame', dmg);
  boss.flash = 4;
  mmsxx.audio.playSE('weak');
  spawnWeakSpark(fx - 8, fy - 8);
  if (boss.hp <= 0) {
    if (boss.kind === 'king') killKingWithRoar();
    else {
      boss.dying = 90;
      clearChicks(boss);   // 気絶のひよこを残さない
      kingCancelStun(boss);
      mmsxx.audio.stopBGM();
      mmsxx.audio.playSE('bossboom', SE_HIT);
    }
  }
}

// 再生中の BGM 名。局面(通常 / 最大パワー / ボス)に応じて切り替える
let currentBGM = null;
let jingleTimer = 0;   // 開始ジングルが鳴り終わるまでのフレーム数
/**
 * BGM を切り替える。同じ曲なら鳴らし直さない(エンジン側の既定の動き)。
 * ジングルなど、毎回頭から鳴らしたいものは restart に true を渡す。
 */
/**
 * ジングル(ファンファーレなど)を鳴らす。
 * **いまの BGM は止めずに、鳴っているあいだだけ黙る**ので、
 * 鳴り終わると曲の続きが聞こえてくる(イントロから鳴り直さない)。
 * currentBGM は変えない = 局面の曲はそのまま
 */
function playJingle(name) {
  mmsxx.audio.playJingle(name);
}

function playBGM(name, loop = true, restart = false) {
  currentBGM = name;
  // ジングル(ループしない曲 = ファンファーレなど)はいちばん強い。
  // 鳴っている SE は止めて、ジングルだけを聞かせる
  if (!loop) mmsxx.audio.stopSE();
  mmsxx.audio.playBGM(name, loop, restart);
}

/** 局面に合った BGM に切り替える(最大パワー時は専用曲。ボス戦は除く) */
function updateBGM() {
  if (state !== 'play' || clearTimer > 0) return;
  // ボス登場の演出中は、あちらで BGM を操作している(フェードアウトの最中)。
  // ここで鳴らし直すとフェードが取り消され、同じ曲が頭から鳴り直してしまう
  if (bossIntro > 0) return;
  if (jingleTimer > 0) { jingleTimer--; return; } // 開始ジングルの再生中
  if (boss && boss.dying > 0) return; // 撃破演出中は鳴らし直さない
  // ラスボスは専用の曲。ふつうのボス曲で上書きしないよう、ここで打ち切る
  if (boss && boss.kind === 'king') {
    // 裂け目が壊れてからシルエットが構え終わるまでは、わざと無音にしている
    if (bossIs(boss, 'break', 'pose')) return;
    const k = bossIs(boss, 'man') ? 'finalbattle' : 'lastboss';
    if (k !== currentBGM) playBGM(k, true);
    return;
  }
  // ボスラッシュはずっとボス戦の曲のまま
  // モアイが出ているあいだは緊迫した専用曲に切り替える
  // 5 面は道中もボスの曲。ここだけはフルパワーでも曲を変えない
  // (最後の面はずっと張りつめたままにしておきたい)
  const want = (boss && boss.kind === 'todo') ? 'todo'
    : moaiActive() ? 'moai'
    : (boss || gameMode() === 'bossrush' || isLastStage()) ? 'boss'
    : (shotLevel >= MAX_POWER ? 'power' : 'main');
  if (want !== currentBGM) playBGM(want, true);
}

function bombAllEnemies() {
  for (const e of [...enemies]) {
    spawnBoom(e.sp.x, e.sp.y);
    score += ENEMY_SCORE[e.type];
    // **宝珠(★)だけは落とす**。集めないと先へ進めないものなので、
    // 巻き込まれて消えると理不尽な待ち時間になる。
    // ほかのアイテムは出さない(ボムやモアイで稼げてしまうため)
    if (e.hasStar) dropItem(e.sp.x + 2, e.sp.y, 'star');
    mmsxx.removeSprite(e.sp);
    enemies.splice(enemies.indexOf(e), 1);
  }
  for (const b of enemyBullets) mmsxx.removeSprite(b.sp);
  enemyBullets = [];
  flashTimer = 4; // 軽く画面をフラッシュさせる
  mmsxx.audio.playSE('bossboom', SE_HIT);
  drawHUD();
}

// ---- 画面の揺れ ----
// 被弾したときに画面全体を 1 ドット単位でずらす(実機の SET ADJUST 相当)。
// ボーダーを 8 ドット取ってあるので、ずらしても中身が欠けない
let shakeTimer = 0;
function startShake(n) { shakeTimer = Math.max(shakeTimer, n); }
function updateShake() {
  if (shakeTimer <= 0) return;
  shakeTimer--;
  if (shakeTimer <= 0) { mmsxx.setAdjust(0, 0); return; }
  // だんだん小さくなる。1 コマごとに向きを変えて「ぶるっ」とさせる
  const a = Math.ceil(shakeTimer / 5);
  mmsxx.setAdjust((mmsxx.frame & 1) ? a : -a, ((mmsxx.frame & 2) ? a : -a) >> 1);
}

// ボム発動時の画面フラッシュ(背景を一瞬白く飛ばす)
let flashTimer = 0;
// フラッシュの前の背景。ラスボスの「暗い赤 + 星なし」を壊さないよう覚えておく
let flashSaved = null;
/**
 * 画面のフラッシュを、途中で打ち切って元に戻す。
 * 光っているあいだにポーズ -> Q でタイトルへ戻ると、
 * 背景が白いまま固まってしまうため、場面が変わるときに必ず呼ぶ
 */
function cancelFlash() {
  if (flashSaved) {
    mmsxx.backdrop = flashSaved.backdrop;
    far.visible = mid.visible = near.visible = flashSaved.stars;
    flashSaved = null;
  }
  flashTimer = 0;
}

function updateFlash() {
  if (flashTimer <= 0) return;
  if (!flashSaved) flashSaved = { backdrop: mmsxx.backdrop, stars: far.visible };
  flashTimer--;
  mmsxx.backdrop = 15;
  far.visible = mid.visible = near.visible = false;
  if (flashTimer === 0) {
    mmsxx.backdrop = flashSaved.backdrop;
    far.visible = mid.visible = near.visible = flashSaved.stars;
    flashSaved = null;
  }
}

const IMG_BY_TYPE = {
  A: SPRITE_SYMBOLS.enemyA, B: SPRITE_SYMBOLS.enemyB, C: SPRITE_SYMBOLS.enemyC, F: SPRITE_SYMBOLS.enemyF, G: SPRITE_SYMBOLS.enemyG,
  // 追加した 3 種。K = 壁づたい / L = 全方位 / M = 放物線
  K: SPRITE_SYMBOLS.enemyH, L: SPRITE_SYMBOLS.enemyI, M: SPRITE_SYMBOLS.enemyJ,
};
// 出現位置: 降下型は上から / F は下から / 円盤(UFO)は画面上部を横切る
const SPAWN_Y = { A: -18, B: 16, C: 16, F: SCREEN_H + 18, G: -18,
  K: -18, L: -18, M: -18 };
// 色違い(シアン)の UFO は硬くて高得点。G は遅い代わりに硬め
// K(壁づたい機)は端に居座って 3WAY を撃ち続けるので、
// すぐ壊せると脅威にならない。硬くして「無視して避ける」判断も要るようにする
const HP_BY_TYPE = { A: 1, B: 2, C: 6, F: 1, G: 3, K: 10, L: 6, M: 2 };

/**
 * 画面下から出てくる敵が自機のすぐ足元に湧くと避けようがないので、
 * 自機が画面下 1/3 にいるときは自機の近くの X を避けた位置にずらす。
 */
function avoidPlayerX(x) {
  if (player.y < SCREEN_H * 2 / 3) return x;
  const SAFE = 40;
  if (Math.abs(x - player.x) >= SAFE) return x;
  const left = player.x - SAFE, right = player.x + SAFE;
  // 画面内に収まる方へ逃がす
  if (left >= 0 && (right > SCREEN_W - 16 || rnd() < 0.5)) return left;
  if (right <= SCREEN_W - 16) return right;
  return Math.max(0, Math.min(SCREEN_W - 16, left));
}

/** 敵を 1 体出す */
/**
 * その敵を出してよいか。
 * F = 画面の下から来る敵。後ろに弾を撃てない(ショット 3 段階未満)うちや、
 *     1 面、NORMAL では出さない。
 * B/C = 左右から挟み込んでくる UFO。NORMAL では出さない。
 */
function enemyAllowed(type) {
  if (type === 'F') {
    if (isNormal() || stageNo <= 1) return false;
    if (shotLevel < 3) return false;   // 後ろに撃てないうちは出さない
  }
  if (isNormal() && (type === 'B' || type === 'C')) return false;
  return true;
}

function spawnEnemy(type, x, phase) {
  if (!enemyAllowed(type)) return null;
  const sp = mmsxx.sprite(IMG_BY_TYPE[type]);
  // 下から上がってくる敵は、左右の端からだけ来る(真下から急に出てこない)
  if (type === 'F') x = (x < SCREEN_W / 2) ? 8 + (x % 24) : SCREEN_W - 40 + (x % 24);
  sp.x = x; sp.y = SPAWN_Y[type]; sp.priority = 8;
  // UFO は自機が弱いうちは硬すぎないよう、パワーに応じて耐久を上げる
  let hp = HP_BY_TYPE[type];
  if (type === 'B' || type === 'C') {
    hp = Math.max(1, Math.round(hp * (0.35 + shotLevel * 0.11)));
  }
  if (isNormal()) hp = Math.max(1, Math.round(hp / 2)); // NORMAL は耐久力半分
  const e = {
    sp, type, x0: x, phase, age: 0, hp,
    fireTimer: (type === 'A' ? enemyFireGap(45) : enemyFireGap(38)) / 2,
    dir: Math.PI / 2, // G の進行方向(最初は真下向き)
  };
  enemies.push(e);
  return e;
}

// UFO 編隊はボス戦のときだけ現れる。1 機だけ色違い(硬い・アイテム持ち)
const BOSS_UFO_INTERVAL = 330;
let bossUfoTimer = 0;
let bossStartFrame = -1; // ボスが出たフレーム(いまは使っていない)
// 撃破タイムに数えるフレーム数。
// **弾が当たる状態のあいだだけ**増やす。登場の演出、赤いエリアが広がるところ、
// 名乗りで止まっているあいだ、倒れる演出は数えない
let bossFrames = 0;

/** いま、ボスに弾が当たる状態か(撃破タイムを数えてよいか) */
function bossTimeCounts() {
  if (!boss || boss.dying > 0) return false;
  if (bossIntro > 0 || talkHold > 0) return false;
  if (state !== 'play') return false;
  // ラスボスは段階によって、当たる時間と当たらない時間がある
  if (boss.kind === 'king') return bossIs(boss, 'rift', 'man');
  return true;
}
function spawnUfoWave(noFire = false) {
  const fromLeft = rnd() < 0.5;
  // 水色(アイテム持ち)は必ず 1 機は入れる。多くても 3 機まで。
  const cyanCount = 1 + Math.floor(rnd() * 3);
  const cyanSlots = new Set();
  while (cyanSlots.size < cyanCount) cyanSlots.add(Math.floor(rnd() * 5));
  for (let i = 0; i < 5; i++) {
    const cyan = cyanSlots.has(i);
    const e = spawnEnemy(cyan ? 'C' : 'B',
      fromLeft ? -20 - i * 24 : 260 + i * 24, fromLeft ? 1 : -1);
    // NORMAL など、その種類を出さない設定のときは null が返る
    if (e) e.noFire = noFire; // ミス直後の群れは弾を撃たない
  }
}

// 硬いキューブ: 4〜5 個が少しずつずれた隊列で流れてくる。自機は追わない。
// そのうち 1 個だけがパワーアップアイテムを持っている。
// 出現タイミングは他の敵と周期をずらしてステージデータに持たせてある。
function spawnCubes() {
  const n = 5 + Math.floor(rnd() * 2);       // 5 or 6
  // 1 個は P アイテム入り(緑)、もう 1 個は★入り(紫・耐久力 2 倍)
  const withItem = Math.floor(rnd() * n);
  let withStar = Math.floor(rnd() * n);
  if (withStar === withItem) withStar = (withStar + 1) % n;
  // ごくまれに黄色いキューブが混じる。壊すと ? アイテムが出る
  // NORMAL は ? アイテム入りの黄色いキューブがよく混じる(連射中は出さない)
  const autoRate = isNormal() ? 0.45 : 0.08;
  const withAuto = (autoFire <= 0 && rnd() < autoRate)
    ? (withStar + 2) % n : -1;
  // 画面幅をほぼ使い切るように左右へ大きくばらけさせる
  const slot = (SCREEN_W - 16) / n;
  const order = [...Array(n).keys()].sort(() => rnd() - 0.5);
  for (let i = 0; i < n; i++) {
    const isStar = i === withStar, isItem = i === withItem, isAuto = i === withAuto;
    const sp = mmsxx.sprite(isAuto ? SPRITE_SYMBOLS.cubeAuto
      : isStar ? SPRITE_SYMBOLS.cubeStar : isItem ? SPRITE_SYMBOLS.cubeItem : SPRITE_SYMBOLS.cube);
    sp.x = Math.round(order[i] * slot + rnd() * (slot - 16));
    sp.y = -18 - i * 7;                              // ほぼ横一列で来るよう縦のずれは小さく
    sp.priority = 8;
    enemies.push({
      sp, type: 'D', age: 0, hp: (isStar ? 36 : 18) / (isNormal() ? 2 : 1), vx: 0, vy: 0.53,
      hasItem: isItem && !isAuto, hasStar: isStar && !isAuto, hasAuto: isAuto,
    });
  }
}

// 跳ね回る敵: 最大パワーのときだけ出現する
const BOUNCER_INTERVAL = 420;
// 同時に出ている数の下限(NORMAL / HARD)
const BOUNCER_LEAST = 3, BOUNCER_LEAST_HARD = 8;
// **通常モードでは 6 秒ではねるのをやめる**。
// ずっと画面に居られると逃げ場が減るので、そのまま外へ出ていってもらう
const BOUNCER_BOUNCE_TIME = 360;
/** この敵はもう反射せず、画面の外へ向かっているか */
const bouncerLeaving = (e) => isNormal() && e.age >= BOUNCER_BOUNCE_TIME;
let bouncerTimer = 0;
function spawnBouncer() {
  const sp = mmsxx.sprite(SPRITE_SYMBOLS.bouncer);
  sp.x = rnd() < 0.5 ? 8 : SCREEN_W - 24;
  // まとめて出すと同じ動きで固まってしまうので、
  // 出る高さと速さを 1 匹ずつばらけさせる(跳ね返る位相がずれる)
  sp.y = 20 + rnd() * 84;
  sp.priority = 8;
  const dir = sp.x < SCREEN_W / 2 ? 1 : -1;
  const vx = (1.7 + rnd() * 1.2) * dir;
  const vy = (1.3 + rnd() * 1.0) * (rnd() < 0.5 ? 1 : -1);
  enemies.push({ sp, type: 'E', age: 0, hp: 3, vx, vy });
}

// ワープ機: 桂馬のように「左前 / 右前」へ跳んでは 0.5 秒止まる、を繰り返す。
// 自機を追ってはこないので、動きを読んで避ける。
const WARP_INTERVAL = 420;
const WARP_WAIT = 30;        // 跳んだあとに止まっている時間(0.5 秒)
const WARP_DX = 32, WARP_DY = 24;   // 桂馬の跳び幅
// 跳び先までの移動の速さ。ワープをやめて、線を引くように走らせる
const WARP_SPEED = 9;
let warperTimer = WARP_INTERVAL;
function spawnWarper() {
  const n = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const sp = mmsxx.sprite(SPRITE_SYMBOLS.warper);
    sp.x = 24 + Math.floor(rnd() * (SCREEN_W - 64));
    sp.y = -20 - i * 28;
    sp.priority = 8;
    enemies.push({ sp, type: 'J', age: 0, hp: 2, wait: WARP_WAIT, dir: rnd() < 0.5 ? -1 : 1 });
  }
}

// 高速直進機: 画面上から自機のいる辺りへ、ほぼまっすぐ突っ込んでくる。
// 弾は撃たないが速いので、位置取りで避ける必要がある。
const DASHER_INTERVAL = 260;
let dasherTimer = DASHER_INTERVAL;
function spawnDasher() {
  const n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const sp = mmsxx.sprite(SPRITE_SYMBOLS.enemyA);
    sp.x = Math.max(0, Math.min(SCREEN_W - 16, player.x + (rnd() - 0.5) * 80));
    sp.y = -20 - i * 22;
    sp.priority = 8;
    // ほんの少しだけ横に流れる
    enemies.push({ sp, type: 'I', age: 0, hp: 1, vx: (rnd() - 0.5) * 0.6, vy: 4.2 });
  }
}

// 挟み撃ち機: 最大パワーのときだけ、自機の左右から同時に突っ込んでくる。
// 画面外で自機の高さに合わせてから、まっすぐ体当たりしてくる。
const RAMMER_INTERVAL = 300;
const RAMMER_FAST = 4.2;   // 出だしの速さ
const RAMMER_SLOW = 1.2;   // 落ち着いたあとの等速
let rammerTimer = 0;
function spawnRammerPair() {
  // 通常モードでは挟み撃ちを出さない。
  // (enemyAllowed を通らない経路なので、ここで止める必要がある)
  if (isNormal()) return;
  for (const dir of [1, -1]) {
    const sp = mmsxx.sprite(SPRITE_SYMBOLS.rammer);
    sp.flipX = dir < 0;   // 1 枚の絵を左右反転して両向きに使う
    sp.x = dir > 0 ? -20 : SCREEN_W + 4;
    // 画面の端に張り付いていても当たらないよう、少し上下にずらして出す
    const off = (40 + rnd() * 30) * (rnd() < 0.5 ? 1 : -1);
    sp.y = Math.max(16, Math.min(SCREEN_H - 32, player.y + off));
    sp.priority = 8;
    // 通常モードで出す場合にそなえて、速さを落とせるようにしておく
    const fast = RAMMER_FAST * (isNormal() ? 0.6 : 1);
    enemies.push({ sp, type: 'H', age: 0, hp: 2, vx: fast * dir, vy: 0 });
  }
}

// ---- 壁づたい機(WALLER / 型 K) ----
// 画面の左右の端を、上から下へ降りるだけ。動きは読みやすいが、
// 定期的に自機へ 3WAY を撃ってくるので、端に長居できなくなる。
const WALLER_INTERVAL = 400;
const WALLER_FIRE = 96;
let wallerTimer = WALLER_INTERVAL;
function spawnWaller() {
  // 左右どちらか。ときどき両方の端から 1 機ずつ
  const both = rnd() < 0.35;
  const sides = both ? [-1, 1] : [rnd() < 0.5 ? -1 : 1];
  for (const side of sides) {
    const e = spawnEnemy('K', side < 0 ? 4 : SCREEN_W - 20, 0);
    if (!e) continue;
    e.side = side;
    // 絵は下向きに描いてあるので、90 度回して横を向かせる。
    // 口(とがったほう)が画面の中心 = 自機のいるほうを向くようにする
    e.sp.rotate = side < 0 ? 270 : 90;
    e.fireTimer = WALLER_FIRE / 2 + Math.floor(rnd() * 30);
  }
}

// ---- 全方位機(SPREADER / 型 L) ----
// ゆっくり降りてきて画面の縦真ん中で止まり、360 度へ時間差で 2 周ぶん撃つ。
// 撃っているあいだは動かないので、そのあいだに倒すか、外へ逃げるか。
const SPREADER_INTERVAL = 620;
const SPREADER_WAIT = 50;      // 止まってから撃ちはじめるまで
const SPREADER_SHOTS = 12;     // 1 周ぶんの弾数
const SPREADER_GAP = 5;        // 1 発ずつずらす間隔(時間差)
const SPREADER_ROUNDS = 2;     // 2 周
let spreaderTimer = SPREADER_INTERVAL;
function spawnSpreader() {
  const e = spawnEnemy('L', 40 + Math.floor(rnd() * (SCREEN_W - 96)), 0);
  if (!e) return;
  e.stopY = SCREEN_H / 2 - 8;
  e.wait = SPREADER_WAIT;
  e.fired = 0;                 // 撃った弾の数(2 周ぶん数える)
  e.fireTimer = 0;
}

// ---- 放物線機(DIVER / 型 M) ----
// 画面の上から放物線を描いて入ってきて、また上へ抜けていく。
// そのあいだ 0.5 秒に 1 回ずつ撃ち続ける。
const DIVER_INTERVAL = 340;
const DIVER_FIRE = 30;         // 0.5 秒
let diverTimer = DIVER_INTERVAL;
function spawnDiver() {
  const n = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const fromLeft = rnd() < 0.5;
    const e = spawnEnemy('M', fromLeft ? -16 : SCREEN_W, 0);
    if (!e) continue;
    e.vx = (fromLeft ? 1 : -1) * (1.5 + rnd() * 0.5);
    // 上から下へ入ってきて、だんだん減速し、また上へ戻っていく
    e.vy = 2.5 + rnd() * 0.6;
    e.sp.y = -18 - i * 20;
    e.sp.flipX = !fromLeft;
    e.fireTimer = DIVER_FIRE / 2;
  }
}

// ---- 光る敵(GLOWER / 型 N) ----
// ふわふわ浮いているだけで、こちらへは来ない。硬いが、撃つほど殻が開いて
// 中の光がむき出しになる。倒すと $ をばらまくので、狙う価値がある。
const GLOWER_INTERVAL = 900;
const GLOWER_HP = 30;          // 硬い。3 段階に開く
const GLOWER_LIFE = 600;       // 一定時間浮いたら去っていく
const GLOWER_COINS = 6;        // ばらまく $ の数
let glowerTimer = GLOWER_INTERVAL;
function spawnGlower() {
  const sp = mmsxx.sprite(SPRITE_SYMBOLS.glower0);
  sp.x = 32 + Math.floor(rnd() * (SCREEN_W - 80));
  sp.y = -20;
  sp.priority = 9;
  // 光っているように、2 コマで明るさを変える
  sp.blink = 0;
  enemies.push({
    sp, type: 'N', age: 0, hp: GLOWER_HP, max: GLOWER_HP,
    life: GLOWER_LIFE, x0: sp.x, y0: 40 + rnd() * 60,
    phase: rnd() * Math.PI * 2,
  });
}

// ---- 16t のおもり ----
// 32x32 のスプライト。壊せない。ゆっくり落ちてきて、敵も敵弾もまとめて潰す。
// 自機が当たったら一撃。ミサイルや岩が出ているときは現れない。
// (BG スプライトだと 8 ドット刻みでガタつくので、ふつうのスプライトにした)
const WEIGHT_W = 48, WEIGHT_H = 32;
const WEIGHT_INTERVAL = 1100;
const WEIGHT_VOLLEY = 3;    // 1 回に落ちてくる数
let weightTimer = WEIGHT_INTERVAL;
let weightQueue = 0;        // あと何発落とすか(前の 1 発が画面から消えたら次)
let weights = [];
function spawnWeight() {
  const sp = mmsxx.sprite(SPRITE_SYMBOLS.weight16t);
  sp.x = 16 + Math.floor(rnd() * (SCREEN_W - 64));
  sp.y = -WEIGHT_H;
  sp.priority = 11;   // 敵より手前。自機の弾は素通りする
  weights.push({ sp, vy: 1.6 });   // 一気に落ちてくる(よけるより逃げる)
  mmsxx.audio.playSE('weight', SE_JINGLE);   // 即死なので、何より先に鳴らす
}
// 3 発ぶんの落下を始める。同時には落とさず、
// 1 発が画面外へ消えてから次を出す(よけ切ったと思ったところへ また来る)
function startWeightVolley() {
  weightQueue = WEIGHT_VOLLEY;
  spawnWeight();
  weightQueue--;
}
function clearWeights() {
  for (const w of weights) mmsxx.removeSprite(w.sp);
  weights = [];
  weightQueue = 0;
}
function updateWeights() {
  for (const w of [...weights]) {
    w.sp.y += w.vy;
    // 触れたら即死。青とピンクを **2 コマずつ**入れ替えて危険を知らせる
    // (1 コマ交代だと混ざってピンク 1 色に見えてしまう)
    w.sp.colorMap = (mmsxx.frame & 2) ? { 4: 9 } : null;
    // 通り道にいる敵と敵弾は、まとめて潰していく
    const x0 = w.sp.x, x1 = w.sp.x + WEIGHT_W;
    const y0 = w.sp.y, y1 = w.sp.y + WEIGHT_H;
    for (const e of [...enemies]) {
      if (e.sp.x + 12 < x0 || e.sp.x + 4 > x1) continue;
      if (e.sp.y + 12 < y0 || e.sp.y + 4 > y1) continue;
      killEnemy(e);
    }
    for (const b of [...enemyBullets]) {
      if (b.sp.x + 8 < x0 || b.sp.x + 8 > x1) continue;
      if (b.sp.y + 8 < y0 || b.sp.y + 8 > y1) continue;
      mmsxx.removeSprite(b.sp);
      enemyBullets.splice(enemyBullets.indexOf(b), 1);
    }
    if (w.sp.y > SCREEN_H + 8) {
      mmsxx.removeSprite(w.sp);
      weights.splice(weights.indexOf(w), 1);
      // 消えたら次の 1 発。落ちる場所は毎回選び直すので、同じところには来ない
      if (weightQueue > 0) { spawnWeight(); weightQueue--; }
    }
  }
}

// 撃破時に出る得点表示。HUD レイヤー(layer3)に数字を描いて一定時間で消す
let popups = [];
/** 好きな文字を短いあいだ表示する(HIT など) */
function spawnPopupText(x, y, text, color = 15) {
  const px = Math.max(0, Math.min(SCREEN_W - text.length * 8, Math.round(x)));
  const py = Math.max(16, Math.min(SCREEN_H - 8, Math.round(y)));
  hud.print(px, py, text, color);
  popups.push({ x: px, y: py, w: text.length * 8, life: 24 });
}

function spawnPopup(x, y, value) {
  const text = String(value);
  const px = Math.max(0, Math.min(SCREEN_W - text.length * 8, Math.round(x)));
  const py = Math.max(18, Math.min(SCREEN_H - 10, Math.round(y)));
  // 字の下じきは**黒で塗りつぶす**。透明のままだと、点数が 2 つ重なったとき
  // 古いほうの数字が透けて、両方いっぺんに見えていた
  hud.print(px, py, text, 11, 1);
  popups.push({ x: px, y: py, w: text.length * 8, life: 45 });
}

function updatePopups() {
  for (const p of [...popups]) {
    if (--p.life > 0) continue;
    hud.fill(0, p.x, p.y, p.w, 8);
    popups.splice(popups.indexOf(p), 1);
  }
}

function clearPopups() {
  for (const p of popups) hud.fill(0, p.x, p.y, p.w, 8);
  popups = [];
}

// 爆発の色。絵は白 1 色で、コマが進むごとに黄 -> 橙 -> 赤 と替えていく
const BOOM_MAP1 = { 15: 11 };   // 黄
const BOOM_MAP2 = { 15: 9 };    // 明るい赤

// 芯の見せかた。2 枚の絵を**交互に**出す。ふだんの芯は白 <-> 水色の色替え、
// 自機の芯は 45 度ちがいの 2 コマアニメ。
// 出しているコマ数は、ふだんは短く、自機が散るときだけ長い
const CORE_FLIP = 4;                 // 何コマごとに絵を替えるか
const CORE_LIFE = 8, CORE_LIFE_LONG = 30;
let coreBigImg = null;               // 自機ぶんの芯(初めて使うときに作る)

/**
 * 自機が散るときの芯。8x8 の光だと散る粒と見分けが付かず、爆発の絵(boom0)も
 * 半径 4.5 ドットで小さいので、**16x16 いっぱいの専用の星形**を使う。
 * 2 コマは 45 度ちがい(太いところと細いところが逆)なので、
 * 交互に出すと光が回って見える。色は絵のほうに白 + 水色で入っている
 */
function bigCoreImages() {
  if (!coreBigImg) coreBigImg = [SPRITE_SYMBOLS.deathCore0, SPRITE_SYMBOLS.deathCore1];
  return coreBigImg;
}

/** 爆発のコマ送り。ふだんの更新と、名乗り待ちの演出の両方から呼ぶ */
function updateBooms() {
  for (const b of [...booms]) {
    b.age++;
    // 芯は 2 枚を行き来させて、消えるまでちらちらさせる
    if (b.core) {
      if (b.age % CORE_FLIP === 0) {
        b.core.image = b.coreImgs[(b.age / CORE_FLIP) % 2];
      }
      if (b.age >= b.coreLife) { b.core.remove(); b.core = null; }
    }
    // 絵は白 1 色なので、**コマごとに色を替えて**熱が冷める様子を出す
    if (b.age === 5) { b.sp.image = SPRITE_SYMBOLS.boom1; b.sp.colorMap = BOOM_MAP1; }
    else if (b.age === 10) { b.sp.image = SPRITE_SYMBOLS.boom2; b.sp.colorMap = BOOM_MAP2; }
    else if (b.age === 15 && b.sp) { mmsxx.removeSprite(b.sp); b.sp = null; }
    // 芯のほうが長生きすることがあるので、**両方消えてから**片づける
    if (b.age >= 15 && !b.core) booms.splice(booms.indexOf(b), 1);
  }
}

/** @param {boolean} bigCore true なら真ん中の芯を長く見せる(自機が散るとき) */
function spawnBoom(x, y, bigCore = false) {
  const sp = mmsxx.sprite(SPRITE_SYMBOLS.boom0);
  sp.x = x; sp.y = y; sp.priority = 20;
  // 真ん中に**白と水色**の芯を置く。ふだんは散りかたと同じ 8x8 の光を
  // 白 <-> 水色で、自機が散るときだけ 16x16 の 2 コマアニメで見せる
  const imgs = bigCore ? bigCoreImages() : deathSparks();
  // 芯も**2 色**。自機と同じように色ごとに分けて置く
  const core = new SpriteCombo(mmsxx, imgs[0]);
  if (bigCore) { core.x = x; core.y = y; }
  else { core.x = x + 4; core.y = y + 4; }   // 爆発(16x16)の真ん中へ 8x8 を置く
  // 自機のぶんは**いちばん手前**へ出し、席の取り合いでも負けないようにする
  // (横に 4 枚並ぶと消えてしまい、真ん中の光が見えないことがあった)
  core.priority = bigCore ? 30 : 22;
  if (bigCore) core.rank = 'always';
  booms.push({
    sp, core, age: 0, coreImgs: imgs,
    coreLife: bigCore ? CORE_LIFE_LONG : CORE_LIFE,
  });
}

// スコアの桁数(見栄えのため上位に 0 を 3 つ足した 10 桁表示)
const SCORE_DIGITS = 9;   // 表示は 9 桁(HUD を 1 桁ぶん詰めた)
// 星(宝珠)の並びの左端。スコアとの間を 1 文字ぶん空ける。
// **HUD の 2 か所から使う**ので、関数の中ではなくここで決めておく
const STAR_X = SCORE_DIGITS * 8 + 8;

function drawHUD() {
  hud.fill(0, 0, 0, VW, 16);
  if (gameMode() === 'bossrush') {
    // ボスラッシュは得点ではなく経過時間を出す
    const t = 'TIME ' + formatTime(rushFrames);
    hud.print(0, 0, t, 15);
  } else {
    hud.print(0, 0, String(score).padStart(SCORE_DIGITS, '0'), 15);
  }
  // 集めた宝珠(取ったぶんだけ点灯する)。
  // ボスラッシュは宝珠を集めないので出さない
  drawOrbMarks();
  // 装備の表示は右端に詰めて並べる(1 項目 2 文字ぶん、間の余白なし)。
  // **左は絵、右は数**。英字 1 文字だと何のことか分からないので、
  // 取ったアイテムと同じ形の印にしてある(色はそのまま)
  const gear = [
    ['power', 'gearWide', shotLevel, 11],                  // WIDE SHOT
    ['damage', 'gearPower', damageLevel, 9],               // POWER SHOT
    ['speed', 'gearSpeed', speedLevel, 3],                 // SPEED
    ['rapid', 'gearRapid', maxVolleys, 13],                // RAPID FIRE
    ['barrier', 'gearBarrier', barrierHP, 7],              // BARRIER
    ['life', 'gearLife', Math.max(0, ships - 1), 15],      // 残りストック
  ];
  // 練習モード(ボスと直接対決)のときは分かるように出す
  if (bossPractice) hud.print(STAR_X, 8, 'PRACTICE', 13);
  let gx = VW - gear.length * 16;
  for (const [kind, icon, n, color] of gear) {
    // 取った直後の項目は 1 秒だけ点滅させて、どれが上がったか分かるようにする
    const blink = kind === gearBlinkKind && gearBlinkTimer > 0 && (gearBlinkTimer >> 2) % 2 === 0;
    const c = blink ? 15 : color;
    // 絵は白 1 色で彫ってあるので、ここで項目の色に置き換える
    hud.draw(gx, 0, BG_SYMBOLS[icon], true, { colorMap: { 15: c } });
    hud.print(gx + 8, 0, String(n), c);
    gx += 16;
  }
}

/**
 * 集めた宝珠の印。**取ったぶんは七色に光る**(1 つずつ色をずらして回す)。
 * ボスラッシュは宝珠を集めないので出さない
 */
function drawOrbMarks() {
  if (gameMode() === 'bossrush') return;
  const n = starsNeeded();
  hud.fill(0, STAR_X, 0, n * 8, 8);
  for (let i = 0; i < n; i++) {
    hud.print(STAR_X + i * 8, 0, '*', i < stars ? orbColor(i) : 14);
  }
}

// 取得した装備の HUD を 1 秒間点滅させる
let gearBlinkKind = null;
let gearBlinkTimer = 0;
function blinkGear(kind) { gearBlinkKind = kind; gearBlinkTimer = 120; }  // 2 秒
function updateGearBlink() {
  if (gearBlinkTimer > 0) {
    gearBlinkTimer--;
    if (gearBlinkTimer % 4 === 0 || gearBlinkTimer === 0) drawHUD();
  }
}

// アイテムを取ったときに画面下(ボスのライフゲージと同じ行)へ効果を出す
let noticeTimer = 0;
let noticeY = 176;   // いま知らせを出している高さ
let noticeLines = [];// いま出している文(点滅させるときに描き直す)
let noticeBlink = 0; // 点滅の色(0 なら点滅しない)
/**
 * ポーズ中の裏技の知らせ。**必ず 1 行消してから**出す。
 * 続けて打つと前の文字が残って重なって見えていた
 */
function cheatNotice(text) {
  hud.fill(0, 0, 120, VW, 8);
  hud.print(centerX(text), 120, text, 11);
}

/**
 * 画面下の 1 行に知らせを出す。
 * frames を渡すと、その長さだけ出しっぱなしにできる
 * (会話のように「次のせりふが来るまで消したくない」ときに使う)
 */
/**
 * 長い文を、画面の幅に収まるところで折り返す(最大 2 行)。
 * 単語の切れ目で折るので、単語が真っ二つにならない
 */
function wrapNotice(text, cols = 28) {
  if (text.length <= cols) return [text];
  const out = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (cur && (cur + ' ' + word).length > cols) { out.push(cur); cur = word; }
    else cur = cur ? cur + ' ' + word : word;
  }
  if (cur) out.push(cur);
  return out.slice(0, 2);
}

/**
 * 画面下の知らせ。
 * @param {number} [blink] 色を指定すると、その色とピンクで 2 コマずつ点滅する
 */
function showNotice(text, frames = 90, y = 176, blink = 0) {
  hud.fill(0, 0, noticeY, VW, 16);   // 前の行を消してから
  noticeY = y;
  hud.fill(0, 0, noticeY, VW, 16);
  // 画面いっぱいまで届く文は 2 行に折り返す
  noticeLines = wrapNotice(text);
  noticeBlink = blink;
  noticeLines.forEach((t, i) => hud.print(centerX(t), noticeY + i * 8, t, blink || 11));
  noticeTimer = frames;
}
function updateNotice() {
  // 点滅させる知らせは毎コマ描き直す。**消えるコマは挟まず**、
  // 指定の色とピンクを 2 コマずつ入れ替える(消えると読めなくなるため)
  if (noticeTimer > 0 && noticeBlink) {
    hud.fill(0, 0, noticeY, VW, 16);
    const col = Math.floor(mmsxx.frame / 2) % 2 ? 13 : noticeBlink;
    noticeLines.forEach((t, i) => hud.print(centerX(t), noticeY + i * 8, t, col));
  }
  if (noticeTimer > 0 && --noticeTimer === 0) {
    hud.fill(0, 0, noticeY, VW, 16);
    hideMuteIcon();   // 文と一緒に置いた絵も消す
  }
}

// 残り 1 機になったら「ピピピピ」と警告を出す(そのあいだだけ画面下に表示)
const LAST_WARN = 'LAST SHIP!';
const LAST_WARN_DELAY = 180;   // 音の 1 秒あとから文字を出す
let lastWarnTimer = 0;
function startLastShipWarning() {
  lastWarnTimer = 240;
  mmsxx.audio.playSE('warning');
}
function updateLastShipWarning() {
  if (lastWarnTimer <= 0) return;
  lastWarnTimer--;
  // 1 秒ごとに鳴らし直す(音は復帰と同時)
  if (lastWarnTimer % 60 === 0 && lastWarnTimer > 0) mmsxx.audio.playSE('warning');
  // 文字は 1 秒おくれて出しはじめる
  if (lastWarnTimer > LAST_WARN_DELAY) return;
  if (lastWarnTimer % 20 === 0) {
    if ((lastWarnTimer / 20) % 2 === 0) hud.print(centerX(LAST_WARN), 176, LAST_WARN, 8);
    else hud.fill(0, 0, 176, VW, 8);
  }
  if (lastWarnTimer === 0) hud.fill(0, 0, 176, VW, 8);
}

// ボスのライフゲージ。スコア行のすぐ下に "BOSS" の文字と一緒に出す。
// BG は 8 ドット単位でしか置けないので、枠のセルを黒で埋めてから
// その中をドット単位のゲージに見立てて描く(見た目はなめらかに減る)。
// ゲージは細く長く。右端の少し手前まで伸ばす
const BAR_X = 48, BAR_Y = 8, BAR_W = 192;
// 左から n ドットだけ赤く塗った 8x8 タイル(残りは黒)。
// これを並べることで、8 ドット単位の BG でもドット単位で減るゲージに見せる。
const BAR_TILES = [];
// 灰色の枠のなかに、残っている体力を赤、削ったぶんを黒で見せる。
// 枠があるので「最大 HP のうちどこまで減らせたか」がひと目で分かる。
const BAR_TOP = 1, BAR_BOT = 6;   // 枠の上下(タイル内の行)
for (let n = 0; n <= 8; n++) {
  const pixels = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let c = 1;                                   // 枠の外は黒
      if (y === BAR_TOP || y === BAR_BOT) c = 14;  // 枠(灰)
      else if (y > BAR_TOP && y < BAR_BOT) c = x < n ? 8 : 1;   // 中身
      pixels[y * 8 + x] = c;
    }
  }
  // 色番号で組み立てた絵なので、BG の型にしてから使う(決まりはここで調べる)
  BAR_TILES.push(mmsxx.bgSymbol({ width: 8, height: 8, pixels }, { name: 'bossBar' + n }));
}

/** ボスを倒したあとの面の評価。ボーナスをまとめて出す */
function showStageResult(r, frames, bossBonus) {
  // 大きい敵(目玉・小惑星・ロケット)を倒したぶんのボーナス
  const bigBonus = bigKills * 2000;
  const coinBonus = coinChainBest * 10;
  const total = bossBonus + bigBonus + coinBonus;
  score += bigBonus + coinBonus;   // TOTAL SCORE に含めるため先に足す
  hud.fill(0, 0, 48, VW, 128);
  // 本編の面(1..5)だけ番号を出す。
  // 裏技やコンティニューの特別な相手(100 番台)は名前で出す
  const t = stageNo <= LAST_STAGE
    ? 'STAGE ' + stageNo + ' CLEAR!'
    : (bossName(stageNo) || 'STAGE') + ' CLEAR!';
  hud.print(centerX(t), 48, t, 11);
  // 何のランクなのかが分かるように「撃破タイム」と並べて出す
  const time = 'BOSS TIME ' + formatTime(frames);
  hud.print(centerX(time), 68, time, 15);
  const rows = [
    ['BOSS RANK ' + r.rank, bossBonus, r.rank === 'C' ? 14 : 11],
    ['BIG ENEMY', bigBonus, 14],
    ['ITEM CHAIN', coinBonus, 14],
    ['BONUS TOTAL', total, 11],
    ['TOTAL SCORE', score, 15],
  ];
  rows.forEach(([label, v, color], i) => {
    const y = 90 + i * 14;
    hud.print(32, y, label, color);
    hud.print(160, y, String(v).padStart(SCORE_DIGITS - 3, '0'), 15);
  });
  bigKills = 0;
  coinChainBest = 0;
  drawHUD();
}

function drawBossBar() {
  hud.fill(0, 0, BAR_Y, VW, 8);
  if (!boss || boss.dying > 0) return;
  hud.print(8, BAR_Y, 'BOSS', 8);
  // **登場の演出のあいだは満タンに見せる**。中の数はまだ入っていないので、
  // そのまま出すと減って見える。実際に減るのは演出が終わってから
  const posing = bossIntro > 0 || (boss.kind === 'king' && bossIs(boss, 'pose'));
  const w = posing ? BAR_W : Math.max(0, Math.round(BAR_W * boss.hp / boss.max));
  for (let i = 0; i * 8 < BAR_W; i++) {
    const n = Math.max(0, Math.min(8, w - i * 8));
    hud.draw(BAR_X + i * 8, BAR_Y, BAR_TILES[n]);
  }
  // 枠の左右のふた(1 ドット単位で塗る)
  hud.fill(14, BAR_X - 1, BAR_Y + BAR_TOP, 1, BAR_BOT - BAR_TOP + 1, true);
  hud.fill(14, BAR_X + BAR_W, BAR_Y + BAR_TOP, 1, BAR_BOT - BAR_TOP + 1, true);
}

// ---- タイトルロゴのまわりを回る光 ----
// ロゴの外周(長方形)を 2 つの光がぐるぐる回る。
// 絵はエンジンのパラパラアニメ(frames)にまかせる。
const SPARK_COUNT = 2;
let titleSparks = [];
function ensureTitleSparks() {
  if (titleSparks.length) return;
  for (let i = 0; i < SPARK_COUNT; i++) {
    const sp = mmsxx.sprite(SPRITE_SYMBOLS.spark0);
    sp.priority = 30;
    sp.frames = [SPRITE_SYMBOLS.spark0, BG_SYMBOLS.spark1, BG_SYMBOLS.spark2, BG_SYMBOLS.spark1];
    sp.frameRate = 5;
    sp.framePhase = i * 7;
    titleSparks.push(sp);
  }
}
// ロゴの「STAR」と「FABLE」それぞれの外接矩形を求めておく。
// 光はこの矩形を少し小さくした線の上を回る(文字のかたまりに沿って動く)。
//
// ロゴは **2 段にずらして重ねてある**ので、左右では切り分けられない。
// 上下の帯(重なっていないところ)で横幅を測り、縦は段の高さに合わせる。
// ロゴの斜体の倒しかた(makedata の SLANT と同じ値)。
// 光の通り道もこのぶんだけ倒して、字の傾きに沿わせる
const LOGO_SLANT = 0.3;
let logoBoxes = null;
function buildLogoBoxes() {
  const img = BG_SYMBOLS.logo;
  // 重なっていない帯。上は STAR だけ、下は FABLE だけが写っている
  const bands = [[0, 26], [40, img.height - 1]];
  logoBoxes = bands.map(([ya, yb], i) => {
    let x0 = img.width, x1 = 0, y0 = img.height, y1 = 0;
    for (let y = ya; y <= yb; y++) {
      for (let x = 0; x < img.width; x++) {
        if (img.pixels[y * img.width + x] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    // 帯の外にも字が続いているので、縦に少し広げる(段の高さぶん)。
    // そのうえで、光の通り道を字の見た目に合わせて寄せる
    //   上の段(STAR): 上ふちを 4 ドット下げる
    //   下の段(FABLE): 上ふちを 6 ドット、下ふちを 4 ドット上げる
    const dTop = i === 0 ? 4 : -6;
    const dBottom = i === 0 ? 0 : -4;
    // 右はしは字の右端に合わせて内側へ詰める(上の段 4 ドット / 下の段 2 ドット)
    const dRight = i === 0 ? -4 : -2;
    return {
      x0: x0 - 2,
      y0: Math.max(0, y0 - 6) + dTop,
      x1: x1 + 2 + dRight,
      y1: Math.min(img.height - 1, y1 + 6) + dBottom,
    };
  });
}

function updateTitleSparks() {
  ensureTitleSparks();
  // ロゴが出ているページ(0 枚目)だけ光らせる
  const on = (titlePage === 0);
  if (!logoBoxes) buildLogoBoxes();
  const ox = (SCREEN_W - BG_SYMBOLS.logo.width) >> 1, oy = 8;
  titleSparks.forEach((sp, i) => {
    sp.visible = on;
    if (!on) return;
    // 光は 1 つずつ、STAR と FABLE の矩形を回る
    const box = logoBoxes[i % logoBoxes.length];
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    const peri = (w + h) * 2;
    let d = (mmsxx.frame * 1.3) % peri;
    let x, y;
    if (d < w) { x = box.x0 + d; y = box.y0; }
    else if ((d -= w) < h) { x = box.x1; y = box.y0 + d; }
    else if ((d -= h) < w) { x = box.x1 - d; y = box.y1; }
    else { d -= w; x = box.x0; y = box.y1 - d; }
    // ロゴは斜体なので、通り道も同じだけ倒す(上へ行くほど右へ寄る)
    x += (box.y1 - y) * LOGO_SLANT;
    sp.x = ox + Math.round(x) - 4; sp.y = oy + Math.round(y) - 4;
  });
}

// ---- ロゴを流れるテカリ ----
// モアイの色変わりと同じ考えかた。**行(ライン)ごと**に色を明るいほうへ
// ずらした帯を作り、それを上から下へ流す。ときどきしか出さない。
//
// 置き換えは 1 ドットずつ、しかも「同じ坂を上がる」向きにしか動かないので、
// 1 本の横 8 ドットに出てくる色の数は増えない = 横8ドット2色の決まりは保たれる。
// ロゴの本体はこの 4 色でできている(濃い青 -> 青 -> 水色 -> 白)。
// 縁取りの黒(1)と影は動かさないので、字の形はそのまま残る
const LOGO_SHINE_LADDER = [4, 5, 7, 15];
/** 明るいほうへ n 段ずらす表(色番号 -> 色番号)。ロゴに無い色はそのまま */
function logoShineTable(n) {
  const t = new Uint8Array(16);
  for (let c = 0; c < 16; c++) t[c] = c;
  LOGO_SHINE_LADDER.forEach((c, i) => {
    t[c] = LOGO_SHINE_LADDER[Math.min(LOGO_SHINE_LADDER.length - 1, i + n)];
  });
  return t;
}
// 帯のかたち。真ん中がいちばん明るく、上下の行はひかえめ
const LOGO_SHINE_BAND = [1, 2, 3, 3, 2, 1].map(logoShineTable);
const LOGO_SHINE_CYCLE = 300;   // 5 秒に 1 回だけ流す
const LOGO_SHINE_DELAY = 90;    // そのうち、はじめの 1.5 秒は何もしない
const LOGO_SHINE_SPEED = 2;     // 1 コマに 2 ドット下がる

let logoShineBuf = null;   // テカリを塗ったロゴの中身(使い回す)
let logoShineSym = null;   // 上の中身を指す BG の絵
let logoShineOn = false;   // いまテカリ入りを描いてあるか(戻すときに要る)

function updateLogoShine() {
  const img = BG_SYMBOLS.logo;
  const ox = (SCREEN_W - img.width) >> 1, oy = 8;
  // ロゴが出ているページ(0 枚目)だけ
  const phase = titlePage === 0
    ? (Math.max(0, titleTimer) % LOGO_SHINE_CYCLE) - LOGO_SHINE_DELAY : -1;
  // 帯の上ふち。画面の外から入ってきて、ロゴの下へ抜けていく
  const top = phase * LOGO_SHINE_SPEED - LOGO_SHINE_BAND.length;
  if (phase < 0 || top >= img.height) {
    // 流れ終わったら、もとのロゴに戻す(明るいまま止まらないように)
    if (logoShineOn && titlePage === 0) hud.draw(ox, oy, img);
    logoShineOn = false;
    return;
  }
  if (!logoShineBuf) {
    logoShineBuf = Uint8Array.from(img.pixels);
    logoShineSym = img.derive(logoShineBuf, 'logo(テカリ)');
  }
  logoShineBuf.set(img.pixels);
  for (let i = 0; i < LOGO_SHINE_BAND.length; i++) {
    const y = top + i;
    if (y < 0 || y >= img.height) continue;
    const table = LOGO_SHINE_BAND[i];
    const base = y * img.width;
    for (let x = 0; x < img.width; x++) logoShineBuf[base + x] = table[logoShineBuf[base + x]];
  }
  hud.draw(ox, oy, logoShineSym);
  logoShineOn = true;
}

/**
 * タイトルへ戻る。
 * @param {number} [page] 出したいタイトル画面(既定はロゴ)
 * @param {number} [focusRank] 一覧のこの順位(0 起点)を上下の真ん中に置く
 */
function enterTitle(page = 0, focusRank = -1, fromOver = false) {
  cancelFlash();   // 光ったまま止まらないように
  recordFlush();   // 数えていたぶんをここで書き出す
  // 丸ごと録画は 1 面ぶんを録る道具なので、タイトルへ戻ったら閉じる(止め忘れの保険)
  if (recorder && recorder.recording) recorder.stop();
  // 遊んだ面があれば CONTINUE を並びに入れる。
  // ゲームオーバーから戻ったときは、それが選ばれた状態にする
  refreshModes(fromOver);
  state = 'title';
  setPaused(false);
  bossPractice = false;   // 練習モードはタイトルへ戻ったら解除
  titleScene = true;      // タイトルは決まった背景にする
  // 遊んでいないあいだは溜めない(持ちっぱなしにしない)
  mmsxx.keepFrames(0);
  mmsxx.keepSound(0);
  clearEntities();
  player.visible = false;
  aux.visible = false;   // 炎とバリアも一緒に消す
  mmsxx.audio.stopBGM();
  currentBGM = null;
  hud.clear();
  popups = [];
  titlePage = page;
  titleTimer = 0;
  // 記録を登録した直後は、自分の順位をゆっくり見てもらいたい。
  // 数え始めを戻して、そのぶんページが切り替わるのを遅らせる
  if (focusRank >= 0) titleTimer = -TITLE_RANK_HOLD;
  // タイトルへ戻ってきたので、裏でランキングを取り直しておく。
  // 待たないので、取得中でもそのままゲームを始められる
  refreshRankings();
  // 各モードで消した背景を戻す
  neb.clear();
  drawFarObjects();
  drawTitlePage();
  // 名前を登録した直後は、自分の順位が真ん中に来る位置から見せる
  if (focusRank >= 0) {
    if (page === 4) { rushTop = hiCenterTop(rushTable, focusRank); drawRushList(); }
    else { hiTop = hiCenterTop(listTable(), focusRank); drawHiScoreList(); }
  }
}

// 登録した直後、そのランキングのページを長く出しておくコマ数(15 秒ぶん)
const TITLE_RANK_HOLD = 900;
// タイトル画面は「ロゴ」と「アイテム説明」を交互に見せる
let titlePage = 0;
let titleTimer = 0;
// HARD で遊んでいるときだけ、面の名前のすぐ下に添える。
// CONTINUE は HARD の続きにもなるので、**どちらで遊んでいるかを画面で示す**
const HARD_LABEL = 'HARD MODE';
const HARD_LABEL_Y = 80;
const HARD_LABEL_COLOR = 9;   // 明るい赤。面の名前(黄)と読み分ける
// 遊びかたの説明。1 面の頭で「STAGE 1」の下に出す(タイトルには出さない)
const PLAY_HELP = String.fromCharCode(0x18, 0x19, 0x1a, 0x1b) + ':MOVE  SP:SHOT  ESC:PAUSE';
// **ポーズの文字とぶつからない高さ**に置く。ポーズは 88〜152 を使い、
// 画面下の知らせ(ミュートなど)は 176 から 2 行ぶん。その間の 160 に出す
const PLAY_HELP_Y = 160;
const PLAY_HELP_COLOR = 7;   // 水色。上の「STAGE 1」(黄)と読み分ける
// ロゴ以外のページから戻る案内。**開始と同じ SPACE** で戻す。
// 開始の案内と取り違えないよう、赤にして点滅させる
const BACK_KEY = 'SPACE TO TITLE';
const BACK_KEY_Y = 176;
const BACK_COLOR = 8;   // 赤(送信の失敗などと同じ色)
const TITLE_PAGES = 5;
// ゲームモード(上下キーで選ぶ)。あとから増やせるように配列で持つ
// 左右はページ送り(カルーセル)に使うので、モード選びは上下にしてある
const ARROW_U = String.fromCharCode(0x18), ARROW_D = String.fromCharCode(0x19);
// ページ送りの目印。**どのページでも同じ場所**に出す(画面の左右の端)
const ARROW_L = String.fromCharCode(0x1a), ARROW_R = String.fromCharCode(0x1b);
const PAGE_ARROW_Y = 96;

// アイコンはゲーム中と同じ絵をそのまま並べる
const ITEM_HELP = [
  ['star', 'ORB - COLLECT FOR BOSS'],
  ['power', 'WIDE SHOT'],
  ['bomb', 'BOMB'],
  ['speed', 'SPEED UP'],
  ['rapid', 'RAPID FIRE'],
  ['damage', 'POWER SHOT'],
  ['barrier', 'BARRIER'],
  ['life', '1UP'],
  ['auto', '???'],   // 効果は伏せておく
];

// アイテム一覧のアイコンはスプライトで出す
// (BG だと 8x8 セルの黒塗りでアイコンの上端が欠けてしまうため)
let helpIcons = null;
function helpIconSprites() {
  if (!helpIcons) {
    // 絵をずらしたコピーではなく元の絵を使う(ずらすと上端が欠けるため)。
    // 位置を 4 ドット上げて文字と高さをそろえる。
    helpIcons = ITEM_HELP.map(([kind]) => {
      const sp = mmsxx.sprite(ITEM_IMG[kind]);
      sp.priority = 20;
      sp.visible = false;
      return sp;
    });
  }
  return helpIcons;
}

// ハイスコア一覧: 8 人ずつ表示し、まず 1 位から見せてから
// 自分の記録のところまで自動でスクロールする
const HI_LIST_Y = 36;
let hiTop = 0;          // 一覧の先頭に出す順位(0 起点)

// 3 枚目が NORMAL、4 枚目が HARD のランキング(5 枚目はボスラッシュのタイム)
const listTable = () => (titlePage === 3 ? hardTable : normalTable);

/** その順位が一覧の上下の真ん中に来る「先頭の行」を返す */
function hiCenterTop(tbl, rank) {
  const maxTop = Math.max(0, tbl.entries.length - HISCORE_ROWS);
  return Math.max(0, Math.min(maxTop, rank - (HISCORE_ROWS >> 1)));
}

function drawHiScoreList() {
  const tbl = listTable();
  // 裏で一覧を取り直していると件数が変わることがある。
  // 見ている位置がはみ出さないよう、描く前に丸めておく
  hiTop = Math.max(0, Math.min(hiTop, Math.max(0, tbl.entries.length - HISCORE_ROWS)));
  const title = titlePage === 3 ? '- HISCORE(HARD) -' : '- HISCORE -';
  hud.fill(0, 0, 0, VW, 176);
  hud.print(centerX(title), 8, title, 15);
  const mine = tbl.myIndex();
  for (let r = 0; r < HISCORE_ROWS; r++) {
    const i = hiTop + r;
    const e = tbl.entries[i];
    if (!e) continue;
    const y = HI_LIST_Y + r * 16;
    const isMine = i === mine;
    hud.print(16, y, String(i + 1).padStart(3) + '.', isMine ? 11 : 14);
    hud.print(56, y, (e.name + '     ').slice(0, 5), isMine ? 11 : 7);
    hud.print(104, y, String(e.score).padStart(SCORE_DIGITS, '0'), isMine ? 11 : 15);
  }
  if (tbl.entries.length === 0) drawNoRecords();
  drawHiArrows(tbl.entries.length);
  drawPageArrows();   // 一覧を描き直すと消えるので、ここでも出し直す
}

/**
 * まだ 1 件も記録が無いときの知らせ。
 * 作り物の初期データを持たないので、**遊ばれるまでは表が空**になる。
 * サーバから取れていないときも同じ(見出しだけだと壊れて見えるため)。
 * 取りに行っている最中かどうかは出さない ―― また見に来ればよい
 */
function drawNoRecords() {
  const s = 'NO RECORDS YET';
  hud.print(centerX(s), HI_LIST_Y + (HISCORE_ROWS >> 1) * 16, s, 14);
}

// 一覧の上下に出す ▲▼(点滅させない。消し込みで文字が欠けるため)
function drawHiArrows(total) {
  const up = String.fromCharCode(0x18), down = String.fromCharCode(0x19);
  const yUp = HI_LIST_Y - 12, yDown = HI_LIST_Y + HISCORE_ROWS * 16 - 4;
  const x = centerX(up);
  hud.fill(0, x, yUp, 8, 8);
  hud.fill(0, x, yDown, 8, 8);
  if (hiTop > 0) hud.print(x, yUp, up, 11);
  if (hiTop + HISCORE_ROWS < total) hud.print(x, yDown, down, 11);
}

/**
 * 上下キーを触ったときに呼ぶ。**画面の自動送りを数え直す**。
 * 止めてしまうと、選んでいる途中で手を離した人がそのまま置き去りになるので、
 * 触るたびに先延ばしにするだけにしてある
 */
function touchTitle() { titleTimer = 0; }

/**
 * タイトルのハイスコア画面を 1 フレーム進める。
 * ふだんの画面送りでは TOP から動かさない(自動スクロールはしない)。
 * 見たい人は上下キーで自分でたどれる。
 * 名前を登録した直後だけ、自分の順位が真ん中に来る位置から始まる。
 */
function updateHiScoreList() {
  const maxTop = Math.max(0, listTable().entries.length - HISCORE_ROWS);
  if (mmsxx.input.repeat('ArrowUp')) {
    touchTitle();
    hiTop = Math.max(0, hiTop - 1);
    drawHiScoreList();
    return;
  }
  if (mmsxx.input.repeat('ArrowDown')) {
    touchTitle();
    hiTop = Math.min(maxTop, hiTop + 1);
    drawHiScoreList();
  }
}

function drawTitlePage() {
  hud.clear();
  if (titlePage >= 2) { hiTop = 0; rushTop = 0; }
  for (const sp of helpIconSprites()) sp.visible = false;
  if (titlePage === 0) {
    // ロゴも BG として描く(スプライトで補助しない = 横8ドット2色の制約に従う)
    // ロゴは 2 行ぶん上へ詰める(下に余白を残す)
    const logoX = (SCREEN_W - BG_SYMBOLS.logo.width) >> 1, logoY = 8;
    hud.draw(logoX, logoY, BG_SYMBOLS.logo);
    // ゲームの版はロゴの右下に小さく添える(文字は 8 ドット単位に置かれる)
    const gver = BUILD.version;
    // 右端ぴったりだと詰まって見えるので、1 文字ぶん内側へ寄せる
    hud.print(logoX + BG_SYMBOLS.logo.width - (gver.length + 1) * 8, logoY + BG_SYMBOLS.logo.height,
      gver, 14);
    // エンジンの版はその下に(ロゴから 2 行ぶん下)
    const ver = 'MMS/XX ENGINE V' + MMSXXEngine.version;
    hud.print(centerX(ver), logoY + BG_SYMBOLS.logo.height + 16, ver, 14);
    // 操作の説明はここには出さない。**遊びかたの話なので 1 面の頭で出す**
    // (PLAY_HELP / startStage を参照)
    // 著作権表示はいちばん下に
    const copy = '© 2026 HARAYOKI';
    hud.print(centerX(copy), 176, copy, 6);
    // 開発版の印は**画面の外(DOM)に出す**。動画や写真に写り込まない
  } else if (titlePage === 1) {
    hud.print(centerX('- ITEMS -'), 8, '- ITEMS -', 15);
    const icons = helpIconSprites();
    ITEM_HELP.forEach(([, desc], i) => {
      const y = 24 + i * 16;
      const sp = icons[i];
      sp.x = 32; sp.y = y - 4; sp.visible = true;
      hud.print(56, y, desc, 14);
    });
  } else if (titlePage === 2 || titlePage === 3) {
    drawHiScoreList();
  } else {
    drawRushList();
  }
  // モードを選べるのはロゴのページだけ。ほかは戻りかたを出すだけにする
  if (titlePage === 0) drawModeLine();
  else drawBackLine();
  drawPageArrows();
}

// モードの選び場所。**ロゴのページにだけ出す**。上下 5 行ぶん使う。
//
//     ▲          … 押せる向きの目印(真ん中)
//   前のモード    … グレーで 1:1 明滅
//   いまのモード  … 白
//   次のモード    … グレーで 1:1 明滅
//     ▼
//
// 前後の名前を出しておくと、モードが何個あるのかが画面から分かる
const MODE_Y = 128;             // いま選んでいるモードの行(1 行ぶん上げてある)
const MODE_SUB_COLOR = 14;      // 前後の名前(グレー)
const MODE_CUR_COLOR = 15;      // いま選んでいるもの(白)
const MODE_TOP = MODE_Y - 16;   // ▲ の行。ここから 5 行ぶんを使う
const MODE_ROWS = 5;
// その下に置く「押しかた」。▼ のすぐ下
const MODE_PUSH = 'SPACE TO SELECT';
const MODE_PUSH_Y = MODE_Y + 24;
// ボスラッシュで指定できる「特別な相手」を指す面番号
const RUSH_EYES = 101;   // 目玉 2 体
const RUSH_MOAI = 102;   // 合体モアイ
const RUSH_TODO = 103;   // 仮ボス「未実装君」(6 面がラスボスになったので本編から外れた)
// **挙動確認の面。**動かない的を決まった場所に並べるだけで、ボスは出ない。
// 本編からもボスラッシュからも来ない(mmsxxBoss(110) でだけ入る)
const RUSH_HITTEST = 110;

// ボスラッシュで戦う相手。0 = 4 体タイムアタック / それ以外はその相手だけ。
// 相手の選択はボスラッシュのメニュー(rushMenuList)で行う
let rushOne = 0;   // 0 = 4 体タイムアタック / それ以外はその相手だけ

/**
 * 上下で 1 つ進んだ先の並び。
 *
 * **本編(NORMAL GAME / HARD GAME)を選んでいるあいだは、
 * 回り込みで開発用の項目へ入らない。** 撮影中にうっかり見せないため。
 * 消したわけではなく、下へたどっていけば今までどおり出てくる
 */
function stepMode(d) {
  const n = MODES.length;
  let i = (modeIndex + d + n) % n;
  if (modeIndex <= 1) while (MODES[i].dev) i = (i + n - 1) % n;
  return i;
}

function drawModeLine() {
  hud.fill(0, 0, MODE_TOP, VW, MODE_ROWS * 8);
  hud.print(centerX(ARROW_U), MODE_TOP, ARROW_U, 11);
  hud.print(centerX(ARROW_D), MODE_TOP + 32, ARROW_D, 11);
  const name = MODES[modeIndex].name;
  hud.print(centerX(name), MODE_Y, name, MODE_CUR_COLOR);
  drawModeNeighbors(true);
  hud.fill(0, 0, MODE_PUSH_Y, VW, 8);
  hud.print(centerX(MODE_PUSH), MODE_PUSH_Y, MODE_PUSH, 11);
}
/**
 * いま選んでいるものの前後のモード名。
 * @param {boolean} on 出すか消すか(1:1 で明滅させる)
 */
function drawModeNeighbors(on) {
  hud.fill(0, 0, MODE_Y - 8, VW, 8);
  hud.fill(0, 0, MODE_Y + 8, VW, 8);
  if (!on) return;
  // 出す名前は**行き先そのもの**。開発用を飛ばした先が出る
  const prev = MODES[stepMode(-1)].name;
  const next = MODES[stepMode(1)].name;
  hud.print(centerX(prev), MODE_Y - 8, prev, MODE_SUB_COLOR);
  hud.print(centerX(next), MODE_Y + 8, next, MODE_SUB_COLOR);
}
/**
 * 左右にページを送れることの目印。**5 ページとも同じ高さ**の左右の端に出す。
 * (端は絵にも一覧にも使っていないので、どのページでも重ならない)
 */
function drawPageArrows() {
  hud.print(0, PAGE_ARROW_Y, ARROW_L, 11);
  hud.print(VW - 8, PAGE_ARROW_Y, ARROW_R, 11);
}

/** ロゴ以外のページの案内。SPACE でロゴへ戻せることだけを出す */
function drawBackLine() {
  hud.fill(0, 0, BACK_KEY_Y, VW, 8);
  hud.print(centerX(BACK_KEY), BACK_KEY_Y, BACK_KEY, BACK_COLOR);
}
/** その点滅。モードの前後の名前と同じ間合いで明滅させる */
function updateBackLine() {
  const x = centerX(BACK_KEY);
  if (mmsxx.frame % 32 === 0) hud.print(x, BACK_KEY_Y, BACK_KEY, BACK_COLOR);
  else if (mmsxx.frame % 32 === 16) hud.fill(0, x, BACK_KEY_Y, BACK_KEY.length * 8, 8);
}
/**
 * 前後のモード名を明滅させる(選んでいるものと矢印は出したまま)。
 * **1 コマごとに入れ替える**(1:1)。実機のちらつきに近い速さで、
 * 「いま選んでいるもの」との差がはっきり出る
 */
function updateModeLine() {
  drawModeNeighbors(mmsxx.frame % 2 === 0);
}

/**
 * **面の頭の控え。** 撮り直しのために、その面を始めたときの持ちものを覚えておく。
 *
 * 通しで録っていて失敗したとき、**その面のはじめからやり直せる**ようにするもの。
 * コンティニューは面番号しか覚えていないので、点も装備も初期化されてしまい、
 * 「続きを撮る」には使えなかった。
 *
 * **持つのは数だけ**(点・残機・装備・乱数の進み具合)。敵や弾は覚えない ──
 * 面の頭は `startStage()` が作り直すので、そちらに任せれば足りる。
 * 数十バイトで済むぶん、**画面を溜めるのとは桁が 3 つちがう**
 */
let stageMark = null;

/** いまの持ちものを控える(面の頭で自動的に呼ばれる) */
function markStage() {
  stageMark = {
    build: BUILD.version,      // 版が違えば戻しても同じにはならない
    stageNo, score, ships, shotLevel, speedLevel, maxVolleys, damageLevel,
    barrierHP, coinValue, autoFire, dragonFlame, rushFrames,
    modeIndex,
    rng: mmsxx.rng.saveAll(),
  };
  return stageMark;
}

/**
 * 控えたところへ戻して、その面をはじめからやり直す。
 *
 * **音は切れ目で止める。** 戻した拍子に前の曲や爆発の尾が残っていると、
 * つないだときにそこだけ音が飛ぶ
 */
function rewindStage() {
  if (!stageMark) return '控えがありません';
  if (stageMark.build !== BUILD.version) return '版が違います(' + stageMark.build + ')';
  const m = stageMark;
  stageNo = m.stageNo; score = m.score; ships = m.ships;
  shotLevel = m.shotLevel; speedLevel = m.speedLevel; maxVolleys = m.maxVolleys;
  damageLevel = m.damageLevel; barrierHP = m.barrierHP; coinValue = m.coinValue;
  autoFire = m.autoFire; dragonFlame = m.dragonFlame; rushFrames = m.rushFrames;
  modeIndex = m.modeIndex;
  mmsxx.rng.restoreAll(m.rng);
  // **切れ目で黙らせる。** 曲・ジングル・SE・声を全部止めてから作り直す
  mmsxx.audio.stopBGM();
  mmsxx.audio.stopJingle();
  mmsxx.audio.stopSE();
  mmsxx.audio.stopTalk();
  currentBGM = null;
  state = 'play';
  startStage();
  return 'STAGE ' + stageNo + ' をやり直します(SCORE ' + score + ')';
}

function startStage() {
  if (currentBGM === 'elise') { mmsxx.audio.stopBGM(); currentBGM = null; }
  // **面の頭の持ちものを控える**(上の markStage)。撮り直しの起点になる
  markStage();
  // ここまでタイトル用の背景だったので、面の背景に切り替える。
  // (以前はボスが出るまで解除されず、1 面がずっとタイトルの背景のままだった)
  titleScene = false;
  setPaused(false);
  clearEntities();
  for (const sp of helpIconSprites()) sp.visible = false;
  playFrame = 0;
  waveIndex = 0;
  cubeIndex = 0;
  stars = 0;
  bossIntro = 0;
  bossCleared = false;
  bigKills = 0;
  coinChainBest = 0;
  dragonSpot = null;    // そらのドラゴンの顔(ラスボスの面でだけ作られる)
  secretSpots = null;   // 待ち時間の隠し場所
  jupiterShown = false;
  eyeSpawned = false;   // 目玉はステージごとに 1 回
  moaiSpawned = false;  // モアイもステージごとに 1 回
  clearMoai();
  eyeKillFrame = -999;
  clearTimer = 0;
  invincible = 220;
  entering = false;
  leaving = false;
  respawnDelay = 0;
  neb.clear();
  drawFarObjects(); // 新しい面として背景を描き直す
  player.x = (SCREEN_W - 16) / 2;
  player.y = SCREEN_H + 24;   // ジングル後半で下から入ってくる
  player.visible = false;
  aux.visible = false;   // 炎とバリアも一緒に消す
  enterDelay = 115;  // ジングルの途中(約 1.9 秒)で自機が入ってくる
  hud.clear();
  popups = [];
  // ボスラッシュは雑魚を出さず、はじめからボス戦に入る
  if (gameMode() === 'bossrush' || bossPractice) stars = starsNeeded();
  drawHUD();
  if (gameMode() === 'bossrush') {
    // ボスラッシュはジングルを鳴らさず、すぐボス戦の曲で始める
    jingleTimer = 0;
    enterDelay = 30;
    playBGM('boss', true);
  } else {
    // 開始ジングルを鳴らし、鳴り終わってから本編 BGM に切り替える
    // 開始ジングルはモードで替える。NORMAL はいままでの曲、
    // HARD は決めを長く伸ばした候補 1(同じ曲の作り替え)
    playBGM(hardNow() ? 'start1' : 'start', false, true);
    // 開始ジングル(約 4.34 秒)のあと、少し間を置いてから本編 BGM に入る
    jingleTimer = 330;
    // ジングルのあいだ、いま何面かを大きく出す。
    // 裏技でしか出てこない面(本編の面数より大きい)は数字を出さない
    stageNoticeTimer = 240;
    // 最後の面は数字ではなく FINAL STAGE と出す
    const label = stageNo === LAST_STAGE ? 'FINAL STAGE'
      : stageNo < LAST_STAGE ? 'STAGE ' + stageNo : '';
    if (label) hud.print(centerX(label), 72, label, 11);
    // HARD で遊んでいるあいだは、面の名前の下にそう出す。
    // CONTINUE は HARD の続きにもなるので、見ただけで分かるようにしておく
    stageHardShown = !!label && hardNow();
    if (stageHardShown) hud.print(centerX(HARD_LABEL), HARD_LABEL_Y, HARD_LABEL, HARD_LABEL_COLOR);
    // 操作の説明は**1 面の頭でだけ**、面の名前と一緒に出す。
    // タイトルに置いていたが、遊びかたの話なのでここへ移した。
    // **指で遊ぶ端末では出さない。** 中身が矢印キーと SP と ESC の話で、
    // どれも指では押せない。遊びかたは ? の案内が受け持つ
    stageHelpShown = stageNo === 1 && !PAD_ON;
    if (stageHelpShown) hud.print(centerX(PLAY_HELP), PLAY_HELP_Y, PLAY_HELP, PLAY_HELP_COLOR);
  }
  // 2 回目のコンティニュー。面が始まってすぐ、未実装さんが顔を出す
  if (todoGuest) {
    todoGuest = false;
    markMet('todoMet');    // ここが唯一の出会い。図鑑に載り、ボスラッシュにも出る
    beginBossMode();        // ボス戦の下ごしらえ(背景など)だけ borrow する
    spawnTodoBoss();
    boss.guest = true;      // 倒しても面はクリアにならない(客人あつかい)
    showNotice('WHO IS THIS?');
  }
}

// 面の始めに出す「STAGE n」の残り時間
let stageNoticeTimer = 0;
// 一緒に操作の説明 / HARD の断りを出したか(消すときに要る)
let stageHelpShown = false;
let stageHardShown = false;
function updateStageNotice() {
  if (stageNoticeTimer <= 0) return;
  if (--stageNoticeTimer > 0) return;
  hud.fill(0, 0, 72, VW, 8);
  if (stageHardShown) { hud.fill(0, 0, HARD_LABEL_Y, VW, 8); stageHardShown = false; }
  if (stageHelpShown) { hud.fill(0, 0, PLAY_HELP_Y, VW, 8); stageHelpShown = false; }
}

/**
 * そのモードの「はじまりの装備」に戻す。
 * ゲーム開始のときと、NORMAL でやられたときに使う。
 * NORMAL とボスラッシュは各装備を 1 段階ぶん持った状態から始める
 * (ボスラッシュはいきなりボス戦なので、丸腰だと厳しいため)。
 * HARD だけは丸腰から。
 */
function applyStartGear() {
  const geared = isNormal() || gameMode() === 'bossrush';
  shotLevel = geared ? 3 : 1;
  speedLevel = geared ? 2 : 1;
  maxVolleys = geared ? 2 : 1;
  damageLevel = geared ? 2 : 1;
  barrierHP = geared ? 1 : 0;
  autoFire = 0;
}

/**
 * コンティニュー用に覚えておく面。
 * 遊び終わった(死んだ)ときの面を残し、クリアしたら 1 へ戻す。
 * タイトルの CONTINUE を選ぶと、そこから始められる。
 * **難度ごとに別々に覚える**(NORMAL の続きで HARD が始まったりしないように)。
 */
const continueStages = { normal: 1, hard: 1 };
// 最後に遊んだ難易度('normal' か 'hard')。**保存に残す**ので、開き直しても覚えている。
// タイトルの既定の選択と、CONTINUE がどちらの続きなのかの両方に使う
function lastPlayed() { return progress.get('lastPlayed') || 'normal'; }
function setLastPlayed(id) {
  if (progress.set('lastPlayed', id) === R.UPDATED) progress.flush();
}
/**
 * いまのモードを、コンティニューの覚え先の名前に読み替える。
 * CONTINUE は**最後に遊んだ難易度の続き**。HARD で終わったなら HARD が続く
 */
function continueKey() {
  return gameMode() === 'continue' ? lastPlayed() : gameMode();
}
/** いまの遊びが HARD かどうか。CONTINUE のときは続けている難易度で決まる */
function hardNow() { return continueKey() === 'hard'; }
/** いまのモードのコンティニュー先 */
function continueStageNow() {
  return continueStages[continueKey()] || 1;
}

/**
 * 遊んだ面があるときだけ、タイトルの並びに CONTINUE を入れる。
 * 上下キーで選ぶ形だとハイスコアの一覧が動いてしまうので、
 * ふつうのモードの 1 つとして並べる。
 * ゲームオーバーからタイトルへ戻ったときは、ここが選ばれた状態にする。
 */
function refreshModes(select = false) {
  // CONTINUE を出し入れすると並びがずれるので、**いま選んでいる id を覚えておく**。
  // (番号のままだと、抜けてきたモードとは別のところが選ばれてしまう)
  const keep = MODES[modeIndex] && MODES[modeIndex].id;
  // CONTINUE は**最後に遊んだ難易度**の続き。その難易度が 2 面以上まで
  // 進んでいるときだけ並びに入れる。どちらの続きなのかは名前に出す
  // (HARD の続きなのに NORMAL の 1 面から始まってしまうのを防ぐ)
  const at = MODES.findIndex(m => m.id === 'continue');
  const want = continueStages[lastPlayed()] > 1;
  const label = 'CONTINUE(' + (lastPlayed() === 'hard' ? 'HARD' : 'NORM') + ')';
  if (want && at < 0) MODES.splice(1, 0, { id: 'continue', name: label });
  else if (want && at >= 0) MODES[at].name = label;   // 難易度が変わったら書き換える
  else if (!want && at >= 0) MODES.splice(at, 1);
  // 選ばれた状態にするもの:
  //   ゲームオーバーのあと … CONTINUE
  //   モードから抜けたあと … そのモード(サウンドテストなど)
  //   それ以外            … 最後に遊んだ難易度
  //
  // 難易度どうし(NORMAL / HARD)は入れ替えてよいものとして扱う。
  // 選んでいたのが難易度なら、**最後に遊んだほう**で上書きする。
  // (起動した直後もここを通る。並びの先頭は NORMAL だが、
  //  前回 HARD で遊んでいれば HARD が選ばれた状態になる)
  const isLevel = (id) => id === 'normal' || id === 'hard';
  const wantId = select ? 'continue'
    : (keep && !isLevel(keep)) ? keep
    : lastPlayed();
  const found = MODES.findIndex(m => m.id === wantId);
  modeIndex = found >= 0 ? found : 0;
  modeIndex = Math.max(0, Math.min(modeIndex, MODES.length - 1));
}

// コンティニューした回数(1 ゲーム中)。2 回目に未実装さんが顔を出す
let continueCount = 0;
// 未実装さんを「客人」として出す予約。ふつうのボスとは扱いが違う
let todoGuest = false;
// 置いていった飴の残り。3 つ全部拾うとボーナス
let candyLeft = 0;
// 何個続けて拾ったか。取るたびに得点が倍になる
let candyCombo = 0;
const CANDY_MAX = 102400;   // 倍々の上限
// 飴の 2 色(ピンク 9 と水色 7)を入れ替える表
const CANDY_SWAP = { 9: 7, 7: 9 };

function enterPlay(fromContinue = false) {
  cancelFlash();
  // **初めて遊びはじめるときだけ、遊びかたを出す**(スマホだけ)。
  // 続きから始めたときは出さない — もう一度遊んでいる人には要らない
  if (!fromContinue) maybeShowHowTo();
  // タイトルへ戻ったときに、この難易度を選んだ状態にする。
  // **難易度のあるモードのときだけ**書き換える(ボスラッシュなどでは触らない)。
  // CONTINUE は続けている難易度そのものなので、書いても値は変わらない
  const level = continueKey();
  if (level === 'normal' || level === 'hard') setLastPlayed(level);
  // **新しく始めたら、続きの記録は捨てる。**
  // 残しておくと、前に遊んだ難易度の CONTINUE が並びに居座る。
  // CONTINUE は NORMAL GAME の隣に入るうえ、ゲームオーバーの直後は
  // そこが選ばれた状態なので、**始めたつもりのない難易度の途中**から
  // 始まってしまう(NORMAL で遊んでいたつもりが HARD の 3 面、など)。
  // 新しく始めるというのは、そこまでの続きを捨てるということ
  if (!fromContinue && (level === 'normal' || level === 'hard')) {
    continueStages.normal = 1;
    continueStages.hard = 1;
  }
  state = 'play';
  score = 0;
  // 記録の数え直し。得点は 0 に戻したので、足したことにする位置も戻す
  tallyScore = 0;
  playShots = 0;
  rapidShots = [];
  rapidClean = true;
  streakStart = -1;
  lastFireFrame = -999;
  if (!fromContinue && recordOn()) {
    record.add(hardNow() ? 'playsHard' : 'playsNormal', 1);
  }
  ships = isNormal() ? 5 : 3;
  // CONTINUE を選んだときは、最後に遊んでいた面から始める
  stageNo = fromContinue ? continueStageNow() : 1;
  // **2 回目のコンティニュー**のときだけ、未実装さんが先に顔を出す。
  // 一度会ったら、それ以降のコンティニューでは出てこない。
  // 数えるのは「続きから始めた回数」なので、**新しく始めたときだけ 0 に戻す**
  // (ここを毎回 0 に戻していたため、いつまでも 1 回目のままだった)
  todoGuest = false;
  if (!fromContinue) continueCount = 0;
  else if (++continueCount === 2 && !met('todoMet')) todoGuest = true;
  // NORMAL とボスラッシュは、各装備を 1 段階ぶん持った状態で始める
  // (ボスラッシュはいきなりボス戦なので、丸腰だと厳しいため)。
  // ボスラッシュのショットだけは 3 段階目(前 2 発 + 後ろ 1 発)から。
  // NORMAL はボスラッシュと同じ初期装備で始める(丸腰の時間を作らない)
  applyStartGear();
  coinValue = COIN_BASE;
  // 前のゲームで取っておいたシェアの絵と動画は持ち越さない
  shareShotSaved = null;
  shareBackSaved = -1;
  shareMovie = null;
  allCleared = false;
  clearReplayDone = false;
  // ドラゴンの炎はやられても消えないが、新しいゲームでは持ち越さない
  dragonFlame = false;
  // モアイの案内は 1 プレイに 1 回ずつ。新しいゲームでは出し直す
  moaiToldWait = false;
  moaiToldInside = false;
  // こすり打ちの案内は場面ごとに 1 回(下の cueRubHint)。新しいゲームでは出し直す
  rubHintDone.clear();
  rubHintIn = 0;
  bossPractice = false;
  usedKonami = false;  // 隠しコマンドは 1 ゲームに 1 回ずつ
  usedStageWarp = false;
  usedBossWarp = false;
  usedHyper = false;
  autoUsed = new Set();
  typed = '';
  konamiPos = 0;
  // このプレイを見分ける ID を作り直す(記録を送るときに使う)
  playId = newUuid();
  // 何で操作したかも数え直す。**このプレイで使ったもの**だけを記録に残す
  mmsxx.input.forgetUsedInputs();
  // 乱数の種も作り直す。**記録に残すのはこの数だけ**で、
  // 流れ('main' と 'boss')の種はここから作られる
  mmsxx.rng.seed();
  // 直前の画面と音を溜めはじめる(シェアの 1 枚と、あとで作るリプレイに使う)
  freezeCapture(false);   // 前のゲームで止めたままにしない
  mmsxx.keepFrames(SHARE_KEEP_SEC);
  mmsxx.keepSound(SHARE_KEEP_SEC);
  // 始めたときのランキングを覚えておく(ランクインしたか判定する基準)
  rankSnapshot = snapshotRanking();
  stats.startSession({ mode: gameMode() });
  statStageScore = 0;
  rushStartFrame = -1;
  rushFrames = 0;
  if (gameMode() === 'bossrush') startBossRush();
  else startStage();
  // 音を消したまま始めた人に、**1 回だけ**知らせる(消えていることに
  // 気づかないまま遊び続けてしまわないように)。
  // 面の始まりで HUD を消すので、**そのあと**に出す
  if (mmsxx.audio.muted && !muteTold) {
    muteTold = true;
    // 1 行に収まる長さにしてある(折り返すと読みにくい)。赤の点滅で目を引く
    tellMuted();
  }
}

// ---- 開発用: SNS シェア用の絵を試すためのキャプチャ ----
// ゲームを始めたときのランキングを覚えておき、その基準でランクインしていたら
// 「GAME OVER と出る直前」の画面を capture/ へ保存する(新しい 10 枚だけ残る)。
// 手元(DEV)でだけ動く仮のしくみ。要らなくなったらこの節と serve.js の
// /__capture をまとめて消してよい。
let rankSnapshot = null;

/** ゲーム開始時のランキングを覚える(あとで「載るか」を判定するため) */
function snapshotRanking() {
  const t = scoreTable();
  return { scores: t.entries.map(e => e.score || 0), max: t.max };
}

/** 開始時のランキングを基準にして、この得点が載るか */
function willRankIn(v) {
  if (!rankSnapshot || v <= 0) return false;   // 0 点は載らない(isHiScore と同じ扱い)
  const { scores, max } = rankSnapshot;
  if (scores.length < max) return true;
  return v > scores[max - 1];
}

/** いまの画面を開発サーバへ送って capture/ に残す */
function captureShare(name) {
  if (!DEV) return;
  try {
    const image = mmsxx.capture();   // 原寸(いちばん安い)
    fetch('/__capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, name }),
    }).catch(() => {});   // 保存に失敗してもゲームは続ける
  } catch (e) {
    mmsxx.errors.log('capture 失敗: ' + e);
  }
}

/**
 * いまの画面をクリップボードへコピーする(ALT+S)。
 * 自動保存(capture/ フォルダ)は DEV のときの別の仕組みで、こちらは
 * **公開版でも使える**。画面には短く知らせを出す。
 */
function captureClipboard() {
  // 知らせの文字は出さない(撮った絵に写ってしまうため)。
  // 代わりにシャッター音を、いちばん強い優先度で鳴らす
  mmsxx.audio.playSE('shutter', SE_JINGLE);
  try {
    // **板が開いていれば、そこで選んでいるコマ**(下の shareSourceCanvas)。
    // 見えている絵と貼られる絵を食い違わせない
    const canvas = shareSourceCanvas() || mmsxx.capture({ type: 'canvas' });
    // 原寸だと小さいので、3 倍のドットのまま大きくして貼りやすくする
    const out = document.createElement('canvas');
    out.width = canvas.width * 3; out.height = canvas.height * 3;
    const cx = out.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.drawImage(canvas, 0, 0, out.width, out.height);
    out.toBlob((blob) => {
      if (!blob || !navigator.clipboard || !window.ClipboardItem) {
        mmsxx.errors.log('clipboard が使えない環境です');
        return;
      }
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .catch((e) => mmsxx.errors.log('clipboard 書き込み失敗: ' + e));
    }, 'image/png');
  } catch (e) {
    mmsxx.errors.log('clipboard 失敗: ' + e);
  }
}

/** NORMAL は参考記録(ランキングには載せない) */
// NORMAL も別表に載るので、どのモードでも記録は残る
const scoreCountsForRanking = () => true;

// ---- やられたあとのリプレイ ----
// ゲームオーバーの文字を出す前に、**直前の 3 秒**をそのまま流す。
// 溜めてあるコマを出すだけなので、ゲームの状態はいっさい動かない。
// SPACE か ESC で飛ばせる。
//
// 見せる順番は 3 つ。
//   1. **自機の爆発を最後まで見せる**(ゲームの絵をそのまま動かす)
//   2. **黒い画面に REPLAY** を 1 秒(16 ドットフォント・赤・真ん中)
//   3. **再生**。ここには何も乗せない(遊んでいた絵だけを見せる)
//
// 出しかたは**いちばん手前のレイヤーへ写す**形。スプライトはまとめて隠し、
// HUD の文字も消すので、遊んでいたときの絵だけが出る。
// DOM を重ねない方針なので、録画にもそのまま入ってよい。
// **録りはじめるのは 3 から**。爆発も黒い画面も動画には入らず、
// 遊んでいた絵だけの動画になる
const REPLAY_LAYER = 5;        // dbg。ふだんは当たり判定の表示にしか使わない
const REPLAY_TEXT = 'REPLAY';
// 録画の入れもの。'mp4' はどこでも再生でき、'webm' は作れる環境が広い
const REPLAY_MOVIE = 'mp4';
// 録画の大きさ。**2 倍で録っておく**と、見る側が広げてもドットの角が溶けない
const REPLAY_SCALE = 2;
// 録画の重さ。人に渡すものなので high(800kbps)にしてある
const REPLAY_BITRATE = BITRATE.high;
// **渡すものの枠**。画面のボーダーは 8 ドットだが、動画と画像は 4 ドットに詰める
// (画面の遊びをそのまま持ち出すと、絵として間延びするため)。
// 動画はさらに**黒で余白を足して 16:9** にそろえる。SNS で letterbox の付きかたが
// 場所ごとに変わるのを避けるためで、**画面には出ない**(遊ぶ人には見えない)
const SHARE_BORDER = 4;
const SHARE_ASPECT = '16:9';
// 後ろに置く間(秒)。最後のコマ(やられた瞬間)で止めて、何が起きたかを残す。
// **前の間は置かない**。黒い画面の REPLAY がその役をしているので、
// そのうえ止めると「動画の頭で自機が固まっている」ように見えてしまう
const REPLAY_LEAD = 0;
const REPLAY_HOLD = 1.2;
// 「REPLAY」の見せかた。**16 ドット(8 ドットフォントの 2 倍)・赤・真ん中**
const REPLAY_FONT = 2;         // 文字の倍率
const REPLAY_COLOR = 8;        // 赤
const REPLAY_BOOM = 60;        // 爆発を見せる長さ(1 秒)
const REPLAY_TITLE = 60;       // 黒い画面に REPLAY を出す長さ(1 秒)
const REPLAY_BLINK = 3;        // 「REPLAY」の点滅(3 コマ出て 3 コマ消える)
let replayPhase = '';          // 'boom' / 'title' / 'play'
let replayWait = 0;            // いまの場面があと何コマ続くか
let replayThen = null;         // 流し終わったあとにやること
let replayFile = 0;            // 録画したものを保存するときの通し番号

/** 直前の数秒を流す。溜まっていなければ何もせず false */
function startReplay(then) {
  // 溜まっていなければ何もしない(始めてすぐやられたとき)。
  // 流しはじめるのは 3 つめの場面なので、ここで先に見ておく
  if (!mmsxx.frameCount) return false;
  replayThen = then;
  state = 'replay';
  // まずは**爆発を見せる場面**から。ここはゲームの絵をそのまま動かす
  replayPhase = 'boom';
  replayWait = REPLAY_BOOM;
  return true;
}

/** 流し終わった(または飛ばした)。片づけて次へ進む */
function endReplay() {
  mmsxx.stopFrames();
  // stopFrames() は溜めを再開させるので、止めておきたいときは止め直す。
  // 止めないと、このあとのゲームオーバー画面で直前の数秒が消えてしまう
  applyCapture();
  mmsxx.hideSprites(false);
  mmsxx.layer(REPLAY_LAYER).clear();
  hud.clear();
  if (mmsxx.recording) keepReplayMovie();
  const then = replayThen;
  replayThen = null;
  if (then) then();
}

/**
 * 録り終えた動画を**シェアで渡せるように取っておく**。
 * 開発中は capture/ にも書き出す(手元で中身を見るため)。
 *
 * 持っているのは Blob 1 つだけ。次のリプレイで置き換わる。
 * 落とすときの URL は**押されたときに作って、すぐ捨てる**
 */
function keepReplayMovie() {
  mmsxx.stopRecord().then((blob) => {
    // 中身の無いものは持たない(空のファイルが落ちてしまうため)
    if (!blob || !blob.size) return;
    shareMovie = blob;
    shareMovieKind = mmsxx.recordKind || 'mp4';
    if (shareOpen) updateShareMovieBtn();   // 出ている最中なら、その場で使えるようにする
    if (!DEV) return;
    const r = new FileReader();
    r.onload = () => {
      fetch('/__capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: r.result, name: 'replay' + (++replayFile) }),
      }).catch(() => {});
    };
    r.readAsDataURL(blob);
  });
}

/** 黒い画面に「REPLAY」を出す。ここから録りはじめる */
function startReplayTitle() {
  replayPhase = 'title';
  replayWait = REPLAY_TITLE;
  // やられたときのフラッシュを**必ず消す**。光を戻すのは updatePlay の中なので、
  // ここへ来ると戻す人がいなくなり、背景が白いまま固まる
  cancelFlash();
  hud.clear();               // ゲーム中の文字は消す
  mmsxx.hideSprites(true);   // スプライトも 1 枚も出さない
  // 画面ぜんぶを黒で覆う(文字は updateReplay が毎コマ書き直して点滅させる)
  mmsxx.layer(REPLAY_LAYER).fill(1, 0, 0, SCREEN_W, SCREEN_H);
  // ここで溜めを止める。**自機の爆発まで**溜まった状態で固定される
  stopDeathCapture();
}

/** 溜めたコマを流しはじめる。流せなければそのまま終わる */
function startReplayPlay() {
  replayPhase = 'play';
  mmsxx.layer(REPLAY_LAYER).clear();
  // 生の曲は止める。**溜めた音のほうに入っている**ので、鳴らすと二重になる
  mmsxx.audio.stopBGM();
  currentBGM = null;
  // **ここから録る**。黒い画面は入れず、遊んでいた絵だけの動画にする。
  // 録れたものはシェアのダイアログから落とせる(開発中は capture/ にも残す)。
  // **mp4 で録る**(どこでも再生できる)。作れない環境では webm に落ちる
  mmsxx.startRecord({
    type: REPLAY_MOVIE, scale: REPLAY_SCALE, bitrate: REPLAY_BITRATE,
    border: SHARE_BORDER, aspect: SHARE_ASPECT,
  });
  // **音の尺に絵を合わせる。** 溜めてある音は SHARE_KEEP_SEC 秒ぶんだが、
  // コマはそれより短いことがある(やられ直後にもう一度やられて、
  // 絵だけ溜め直したときなど)。足りないぶんは**最後のコマで止めたまま**
  // 待って、音が鳴りきってから終わる。止まった絵はやられたところなので、
  // 見せて困らない。**動画の音が尻切れにならない**のが大事
  const shown = Math.min(mmsxx.frameCount, SHARE_KEEP_SEC * 60);
  const shortBy = Math.max(0, SHARE_KEEP_SEC * 60 - shown) / 60;
  const ok = mmsxx.playFrames({
    layer: REPLAY_LAYER, seconds: SHARE_KEEP_SEC,
    leadIn: REPLAY_LEAD, holdEnd: REPLAY_HOLD + shortBy, onEnd: endReplay,
  });
  if (!ok) { endReplay(); return; }
  // **溜めてある音も一緒に流す**。撃つ音も爆発の音もそのまま入る
  mmsxx.audio.playSound();
}

/**
 * 流しているあいだ。飛ばせるのは **ESC だけ**。
 * SPACE は撃つキーなので、やられた勢いで押しっぱなしになりやすく、
 * 見えないうちに飛ばされてしまう。**飛ばすと動画も途中で終わる**ので、
 * うっかり押せるキーからは外してある
 */
function updateReplay() {
  if (mmsxx.input.wasPressed('Escape')) { endReplay(); return; }
  if (replayPhase === 'boom') {
    // 爆発を最後まで見せる。溜めは止めてあるので、この絵は記録に混ざらない
    updatePlay();
    if (--replayWait <= 0) startReplayTitle();
    return;
  }
  if (replayPhase === 'title') {
    // 3 コマ出て 3 コマ消える点滅。**出しはじめから数える**ので、
    // 必ず出ている側から始まる
    const past = REPLAY_TITLE - replayWait;
    const L = mmsxx.layer(REPLAY_LAYER);
    const cw = 8 * REPLAY_FONT;
    const w = REPLAY_TEXT.length * cw;
    const x = Math.round((SCREEN_W - w) / 2 / 8) * 8;
    const y = Math.round((SCREEN_H - cw) / 2 / 8) * 8;
    L.fill(1, x, y, w, cw);
    if (Math.floor(past / REPLAY_BLINK) % 2 === 0) {
      L.print(x, y, REPLAY_TEXT, REPLAY_COLOR, 1, REPLAY_FONT);
    }
    if (--replayWait <= 0) startReplayPlay();
  }
  // 流しているあいだは何もしない(文字は乗せない)
}

function enterGameOver() {
  // ラスボスに負けたかどうかを覚えておく。**高笑いはリプレイのあと**
  // (showGameOver)で聞かせる。先に鳴らすと、笑い声のあとに
  // やられる場面をもう一度見ることになって順番がおかしい。
  // **裂け目のあいだは鳴らさない**。まだ姿を見せていないのに笑い声だけ
  // 聞こえるのはおかしいので、シルエットが出てから(pose / man)にする。
  // **練習モードでも同じにする**。シーン選択から入ると練習あつかいになるので、
  // 外すと開発中に確かめられなくなる(シーン選択そのものが開発版だけの機能)
  const kingShown = bossIs(boss, 'pose', 'man');
  kingWon = !!(boss && boss.kind === 'king' && kingShown && boss.dying <= 0);
  // 次にコンティニューできるよう、遊び終わった面を覚えておく。
  // シーンセレクトで飛んだ先で死んだときも、その面から続けられてよい
  // (ボスラッシュはモードそのものに覚え先が無いので、ここには入らない)。
  // **全部クリアして終わったときは覚えない**。クリアした人に
  // 「5 面から続ける」を出しても意味がない(1 面へ戻したままにする)
  if (!allCleared && continueStages[continueKey()] !== undefined) {
    continueStages[continueKey()] = stageNo;
  }
  statsStageEnd();
  // 開発中だけ: ランクインしていたら、GAME OVER の文字が出る前の画面を残す
  if (DEV && gameMode() !== 'bossrush' && willRankIn(score)) {
    captureShare('rankin' + score);
  }
  statsFinish();
  // 先に直前の 3 秒を流してから、ゲームオーバーの画面へ。
  // 流せなければ(溜まっていなければ)そのまま進む。
  // **ラスボスを倒した流れでは、倒したところで見せてある**ので出さない
  if (!clearReplayDone && startReplay(showGameOver)) return;
  showGameOver();
}

/** ゲームオーバーの画面を出す(リプレイのあとに呼ばれる) */
function showGameOver() {
  state = 'over';
  stateTimer = 0;
  player.visible = false;
  aux.visible = false;   // 炎とバリアも一緒に消す
  if (kingWon) {
    // ラスボスの勝ち。画面を止めて高笑いを聞かせ、そのあいだ相手は
    // 出てきたときと同じつま先立ちで浮いている。
    // ゲームオーバーの曲は、笑い終わってから鳴らす
    kingWon = false;
    mmsxx.audio.stopBGM();
    currentBGM = null;
    mmsxx.audio.stopSE();
    kingWins(boss);
    talkName = 'kingLaugh';
    talkBlast = false;
    talkHold = 60 + TALK_HOLD_FRAMES;   // 1 秒おいてから笑い出す
  } else {
    playBGM('gameover', false);
  }
  hud.print(centerX('GAME OVER'), 88, 'GAME OVER', 9);
  // ボスラッシュは得点を出していないので、得点まわりの表示はしない
  if (gameMode() === 'bossrush') return;
  if (isHiScore(score)) {
    hud.print(centerX('NEW RECORD!'), 104, 'NEW RECORD!', 11);
    const m = 'SPACE TO ENTER NAME';
    hud.print(centerX(m), 120, m, 14);
  }
}

// ---- 名前入力(ハイスコア更新時) ----
// キーボードで打ち込んでも、カーソルキーで 1 文字ずつ選んでも入力できる。
// (タッチ環境ではキーボードが使えないので、左右で桁・上下で文字を選ぶ昔ながらの方式)
const NAME_MAX = 5;
const NAME_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-,.?!';
let entryName = '';
let entryPos = 0;            // いま選んでいる桁(0..NAME_MAX-1)

let entryTarget = 'score';   // 'score' = 得点の表 / 'rush' = ボスラッシュのタイム表

/** i 桁目を置き換える(足りないぶんは空白で埋める) */
function setNameChar(i, ch) {
  const a = entryName.padEnd(NAME_MAX, ' ').split('');
  a[i] = ch;
  entryName = a.join('').slice(0, NAME_MAX);
}

/** いま選んでいる桁の文字を n 個ぶん送る(上下キー) */
function cycleNameChar(n) {
  const cur = entryName.padEnd(NAME_MAX, ' ')[entryPos];
  const at = NAME_CHARS.indexOf(cur);
  const next = ((at < 0 ? 0 : at) + n + NAME_CHARS.length) % NAME_CHARS.length;
  setNameChar(entryPos, NAME_CHARS[next]);
}

function enterNameEntry(target = 'score') {
  entryTarget = target;
  state = 'entry';
  // 前回入れた名前を初期値にする(そのまま ENTER で登録できる)
  const meTbl = scoreTable();
  entryName = (meTbl.me && meTbl.me.name) ? meTbl.me.name : '';
  entryPos = 0;
  clearEntities();
  player.visible = false;
  aux.visible = false;   // 炎とバリアも一緒に消す
  // ゲームオーバー曲を止めてから、名前入力の「エリーゼのために」を流す
  mmsxx.audio.stopBGM();
  playBGM('elise', true);
  hud.clear();
  popups = [];
  drawNameEntry();
}

/** 1 -> '1ST' / 2 -> '2ND' / 3 -> '3RD' / それ以外 -> 'nTH' */
function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return n + 'TH';
  return n + (['TH', 'ST', 'ND', 'RD'][n % 10] || 'TH');
}

/** いまの記録が入る順位の見出し(NORMAL / HARD / ボスラッシュのどれでも出す) */
function entryRankLine() {
  const rush = entryTarget === 'rush';
  const table = rush ? rushTable : scoreTable();
  const rank = table.rankOf(rush ? { frames: rushFrames } : { score });
  if (rank < 0) return '';
  // どのランキングに載るのかも一緒に見せる。
  // ふつうのゲームは名前を付けずに順位だけ出す(NORMAL とは名乗らない)
  const where = rush ? 'BOSS RUSH  ' : (hardNow() ? 'HARD  ' : '');
  return where + ordinal(rank + 1) + ' PLACE';
}

function drawNameEntry() {
  hud.fill(0, 0, 40, VW, 80);
  hud.print(centerX('NEW RECORD!'), 40, 'NEW RECORD!', 11);
  const s = entryTarget === 'rush'
    ? 'TIME ' + formatTime(rushFrames)
    : 'SCORE ' + String(score).padStart(SCORE_DIGITS, '0');
  hud.print(centerX(s), 56, s, 15);
  // 何位に入るのかを出す(名前を入れる気になるように)
  const rankLine = entryRankLine();
  if (rankLine) hud.print(centerX(rankLine), 68, rankLine, 11);
  hud.print(centerX('ENTER YOUR NAME'), 80, 'ENTER YOUR NAME', 14);
  drawNameRow();
  const help1 = 'TYPE OR PICK WITH ARROWS';
  hud.print(centerX(help1), 120, help1, 10);
  const help2 = 'ENTER:OK  BS:DEL  ESC:SKIP';
  hud.print(centerX(help2), 132, help2, 10);
}

// 名前の 5 桁の右にくっつける「決定」。**桁と同じように左右で選べる 6 文字目**。
// キーボードには ENTER があるが、パッドには無い。
// 画面に出しておけば、どちらも「選んで押す」で同じ操作になる。
// 字はフォントにある改行(RETURN)マーク 1 文字(engine/font.js の 0x1C)
const OK_POS = NAME_MAX;
const OK_CHAR = String.fromCharCode(0x1c);

/** 入力欄の 5 桁と決定マーク、いま選んでいるところの下じるし(点滅する) */
function drawNameRow() {
  // 空白の桁はアンダーラインにして、5 桁あることが分かるようにする
  const padded = entryName.padEnd(NAME_MAX, ' ');
  const shown = padded.replace(/ /g, '_');
  const x = centerX(shown + OK_CHAR);
  hud.fill(0, 0, 100, VW, 16);
  hud.print(x, 100, shown, 7);
  // 選んでいるあいだは色を変える(桁と地続きなので、色が変わると分かりやすい)
  hud.print(x + NAME_MAX * 8, 100, OK_CHAR, entryPos === OK_POS ? 11 : 5);
  // 選んでいるところだけ、下に▲を点滅させる(上下キーで変えられる目印)
  if ((mmsxx.frame >> 4) & 1) return;
  hud.print(x + entryPos * 8, 108, String.fromCharCode(0x18), 11);
}

/** 名前入力の 1 フレームぶん。確定したらハイスコアに登録してタイトルへ */
function updateNameEntry() {
  let changed = false;
  // 下じるしの点滅ぶんだけは毎フレーム描き直す
  if (mmsxx.frame % 16 === 0) drawNameRow();
  /**
   * 打ち込みで 1 文字入れる。いま選んでいる桁に置いて、次の桁へ進む。
   * **5 桁め まで入れると ENTER の枠へ移る**(そのまま押せば確定できる)。
   * ENTER の枠にいるあいだの打ち込みは、いままでどおり最後の桁を書き換える
   */
  const typeChar = (ch) => {
    const pos = Math.min(entryPos, NAME_MAX - 1);
    setNameChar(pos, ch);
    entryPos = Math.min(pos + 1, OK_POS);
    changed = true;
  };
  // カーソルキー: 左右で桁と ENTER を選び、上下でその桁の文字を送る
  const POSITIONS = NAME_MAX + 1;   // 5 桁 + ENTER の枠
  if (mmsxx.input.wasPressed('ArrowLeft')) { entryPos = (entryPos + POSITIONS - 1) % POSITIONS; changed = true; }
  if (mmsxx.input.wasPressed('ArrowRight')) { entryPos = (entryPos + 1) % POSITIONS; changed = true; }
  // 上下は文字を送るためのもの。ENTER の枠には送る文字が無い
  if (entryPos !== OK_POS) {
    if (mmsxx.input.wasPressed('ArrowUp')) { cycleNameChar(1); changed = true; }
    if (mmsxx.input.wasPressed('ArrowDown')) { cycleNameChar(-1); changed = true; }
  }
  // ENTER の枠を選んでいるときは、**ショット(SPACE)でも確定できる**。
  // パッドには ENTER が無いので、ここが「押す」の入口になる
  if (entryPos === OK_POS && mmsxx.input.wasPressed('Space')) {
    startSubmit();
    return;
  }
  for (let i = 0; i < 26; i++) {
    if (mmsxx.input.wasPressed('Key' + String.fromCharCode(65 + i))) typeChar(String.fromCharCode(65 + i));
  }
  // SHIFT を押しているか。**'!' は SHIFT + 1** で入れられるようにする
  // (エンジンはキーの位置しか見ないので、記号は自分で組み立てる)
  const shift = mmsxx.input.isDown('ShiftLeft') || mmsxx.input.isDown('ShiftRight');
  for (let i = 0; i < 10; i++) {
    if (!mmsxx.input.wasPressed('Digit' + i)) continue;
    typeChar(shift && i === 1 ? '!' : String(i));
  }
  // 記号も入れられる(スペースは名前の一部。決定には使わない)
  const SYMBOLS = [
    ['Space', ' '], ['Minus', '-'], ['Comma', ','], ['Period', '.'],
  ];
  for (const [code, ch] of SYMBOLS) {
    if (mmsxx.input.wasPressed(code)) typeChar(ch);
  }
  // '?' は SHIFT の有無にかかわらず「/」のキーで入る。
  // '!' は SHIFT + 1 のほか、キーの並びが違う配列でも困らないよう
  // 「\」「=」からも入れられるようにしてある
  if (mmsxx.input.wasPressed('Slash')) typeChar('?');
  if (mmsxx.input.wasPressed('Backslash') || mmsxx.input.wasPressed('Equal')) typeChar('!');
  if (mmsxx.input.wasPressed('Backspace')) {
    // ENTER の枠にいるときは、最後の桁へ戻ってから消す
    if (entryPos === OK_POS) entryPos = NAME_MAX - 1;
    // いまの桁に文字が入っていればそこを消す。空ならひとつ前へ戻って消す。
    // (打ち終わりはカーソルが最後の桁に乗ったままなので、
    //  いきなり前へ戻すと最後の 1 文字が消せなかった)
    const cur = entryName.padEnd(NAME_MAX, ' ')[entryPos];
    if (cur === ' ' && entryPos > 0) entryPos--;
    setNameChar(entryPos, ' ');
    changed = true;
  }
  // 抜けるのは ESC だけ(スペースは名前に入れる文字なので使わない)
  if (mmsxx.input.wasPressed('Escape')) {
    mmsxx.audio.stopBGM(); currentBGM = null;
    enterTitle(0, -1, true);   // ここもゲームオーバー明けなので CONTINUE を選ぶ
    return;
  }
  if (mmsxx.input.wasPressed('Enter')) {
    startSubmit();
    return;
  }
  if (changed) { mmsxx.audio.playSE('item'); drawNameEntry(); }
}

// ---- 記録の登録(通信するのはここだけ) ----
// サーバへ載せるようになると、ここで**初めてプレイヤーを待たせる**。
// 待っているあいだは 'submitting' という別の状態にして、
//   ・キー入力を止める(ENTER 連打で二重に送らない)
//   ・「送っています」を出して、止まっていないことを見せる
// ようにする。**失敗しても必ず一覧へ進む**(遊びを止めない)。
let submitDone = false;      // 返事が返ってきたか
let submitRank = -1;         // サーバが数えた順位(0 起点 / 載らなければ -1)
let submitFailed = false;    // 通信に失敗したか(board.lastError を見る)
let submitPage = 2;          // 進む先の一覧のページ
// 結果の知らせ(送れた / 手元だけ)を出して、**キーが押されるのを待っている**あいだ。
// 成功でも失敗でも同じ道を通る(読み終わってから先へ進んでもらう)
let submitWaitKey = false;
// **最低でもこれだけは見せる**。中身が手元の保存だと一瞬で返ってしまい、
// 「送っています」が見えないまま画面が変わって、何が起きたのか分からない。
// サーバに繋いだときと同じ手ざわりにするための、わざとの待ち
const SUBMIT_MIN = 60;       // 1 秒
let submitMin = 0;           // 残りのコマ数
let submitAsk = false;       // 「もう一度送るか」を聞いているあいだ
let submitBoard = null;      // 送り先の表(送り直すために覚えておく)
let submitEntry = null;      // 送る記録(同上)

/** ENTER が押されたとき。ここから待ち状態に入る */
function startSubmit() {
  const name = entryName.replace(/\s+$/, '') || 'NONAME';
  const rush = entryTarget === 'rush';
  submitBoard = rush ? rushTable : scoreTable();
  submitEntry = rush ? { name, frames: rushFrames } : { name, score };
  // 進む先は、ボスラッシュはタイムの表、それ以外は NORMAL / HARD それぞれの表
  submitPage = rush ? 4 : (hardNow() ? 3 : 2);
  submitRank = -1;
  submitWaitKey = false;
  state = 'submitting';
  sendSubmit();
}

/** 記録を送る(送り直しもここを通る) */
function sendSubmit() {
  submitDone = false;
  submitFailed = false;
  submitAsk = false;
  submitMin = SUBMIT_MIN;
  drawSubmitting();
  // **投げっぱなしにはしない**。返事が返ったら submitDone を立てて、
  // 進むのは毎フレームの update 側に任せる(状態の持ち方を 1 か所にまとめる)
  const board = submitBoard;
  board.submit(submitEntry).then((rank) => {
    submitRank = rank;
    // submit() は例外を投げない。失敗したかどうかは lastError で分かる
    submitFailed = !!board.lastError;
    submitDone = true;
  });
}

/** 「送っています」の画面。点の数だけ毎フレーム変える */
function drawSubmitting() {
  // 名前入力の案内(下 2 行)まで消す。押せないキーの説明を残さない
  hud.fill(0, 0, 40, VW, 112);
  const s1 = 'SENDING RECORD';
  hud.print(centerX(s1), 68, s1, 11);
  // 点が増えていくのを見せて、止まっていないことを伝える
  const dots = '.'.repeat(1 + (Math.floor(mmsxx.frame / 20) % 3));
  hud.fill(0, 0, 84, VW, 8);
  hud.print(centerX('...'), 84, dots, 14);
  const s2 = 'PLEASE WAIT';
  hud.print(centerX(s2), 100, s2, 10);
}

/**
 * 送れなかったときの問いかけ。**失敗するたびに聞く**。
 * もう一度送るか、あきらめて手元だけに残すかを選ばせる
 */
function drawSubmitAsk() {
  hud.fill(0, 0, 40, VW, 112);
  const s1 = 'COULD NOT SAVE';
  hud.print(centerX(s1), 64, s1, 8);
  const s2 = 'SEND AGAIN?';
  hud.print(centerX(s2), 84, s2, 15);
  const s3 = 'SP:RETRY   ESC:NO';
  hud.print(centerX(s3), 104, s3, 10);
}

/** 送っているあいだ。返事を待つあいだはキーを受け付けない */
function updateSubmitting() {
  // 「もう一度送るか」を聞いているあいだ
  if (submitAsk) {
    if (mmsxx.input.wasPressed('Space')) {
      mmsxx.audio.playSE('item');
      sendSubmit();          // 送り直す。失敗すればまたここへ戻ってくる
      return;
    }
    if (mmsxx.input.wasPressed('Escape')) {
      // あきらめる。**手元だけに残る**ことを知らせて、読み終わるまで待つ
      submitAsk = false;
      submitWaitKey = true;
      hud.fill(0, 0, 40, VW, 112);
      const s1 = 'LOCAL ONLY';
      hud.print(centerX(s1), 64, s1, 8);
      const s2 = 'NOT SAVED ON THE SERVER';
      hud.print(centerX(s2), 84, s2, 10);
      mmsxx.audio.playSE('powerdown', SE_EVENT);
    }
    return;
  }
  // 知らせ(送れた / 手元だけ)を読み終わるまで待つ。押されるまで先へ進まない
  if (submitWaitKey) {
    if (!mmsxx.input.wasPressed('Space') && !mmsxx.input.wasPressed('Escape')) return;
    submitWaitKey = false;
    mmsxx.audio.stopBGM();
    currentBGM = null;
    // 名前を入れ終わったあとも CONTINUE を選んだ状態で戻す
    const toTitle = () => enterTitle(submitPage, submitRank, true);
    // **ここでシェアの板を出す。** 名前も順位も決まっているので、
    // スコアの札(high-score)で投稿できる。見せるのは遊んでいた画面
    if (submitRank >= 0 && entryTarget === 'score') {
      openShare(toTitle, { ...savedShareSpec(), hi: true });
    } else {
      toTitle();
    }
    return;
  }
  // 返事が来ていても、最低の時間が過ぎるまでは「送っています」を見せる
  if (submitMin > 0) submitMin--;
  if (!submitDone || submitMin > 0) {
    if (mmsxx.frame % 20 === 0) drawSubmitting();
    return;
  }
  // 失敗したら、そのたびに「もう一度送るか」を聞く。
  // **止めない**。断られても手元の見込み順位で一覧へ進む
  if (submitFailed) {
    submitAsk = true;
    drawSubmitAsk();
    mmsxx.audio.playSE('powerdown', SE_EVENT);
    return;
  }
  // 送れたときも知らせを出す。**押されるまで動かない**。
  // 黙って画面が変わると、送れたのかどうか分からないため
  submitWaitKey = true;
  hud.fill(0, 0, 40, VW, 112);
  const s1 = 'RECORD SAVED';
  hud.print(centerX(s1), 64, s1, 11);
  const s2 = submitRank >= 0 ? ordinal(submitRank + 1) + ' PLACE' : 'NOT IN THE TOP';
  hud.print(centerX(s2), 84, s2, 15);
  mmsxx.audio.playSE('item', SE_EVENT);
}

// ---- シェア(遊んだ画面を人に見せる) ----
// **canvas の中には描かない**。DOM の板を上に重ねる。
// ドットを汚さずに済み、文字も画像もそのまま扱えるため
// (docs/SMARTPHONE.md の 5 節と同じ考えかた)。
//
// SNS へつなぐところはまだ無い。いまは**画像をクリップボードへ**渡すところまで。
let shareEl = null;         // ダイアログの入れもの(初めて出すときに作る)
let shareOpen = false;      // 出ているか
let sharePaused = false;    // こちらでポーズしたか(閉じるときに戻す)
let shareAfter = null;      // 閉じたあとにやること(ランクインのときの続き)
let shareShotBox = null;    // 画面の絵を入れるところ
let shareTextEl = null;     // シェア文言(日本語と英語)を入れるところ
let shareStatusEl = null;   // 送信の結果を出すところ
let shareShot = null;       // いま見せている画面(2 倍)。送信でも同じ絵を使う
let shareBusy = false;      // 送信中(二重に押されるのを止める)
// ランクインで自動的に出すときに見せる絵。**遊んでいる最中**に取っておく。
// ゲームオーバーの画面ではなく、遊んでいた画面を残したいため
//   やられて終わるとき … **約 1 秒前**の、まだ自機が無事な画面
//   全面クリアのとき   … クリアのボーナス集計の画面
let shareShotSaved = null;  // 溜めと関係ない 1 枚(集計画面など)
let shareBackSaved = -1;    // 溜めてあるコマの位置(何コマ前)。-1 なら使わない
// 板に出しているコマ。溜めてあるコマを見せているあいだは**左右で選び直せる**。
// 明滅するスプライトは写らないコマがあるので、1 コマずつ前後させて選べるようにする。
// 選べるのは**溜まっているコマ全部**(3 秒ぶん)
// 溜めたコマの列に**もう 1 枚だけ足す**ための番号。
// 集計画面のように「溜めには入っていないが、選ばせたい絵」に使う。
// 列の並びは [SHARE_EXTRA(集計) 0(倒した瞬間) 1 2 … 古い] の順
const SHARE_EXTRA = -1;     // 列の端に足した 1 枚
const SHARE_ONE = -2;       // 列そのものが無い(1 枚だけ見せる)
let shareBack = SHARE_ONE;  // いま見せているコマ
let shareFixed = null;      // 列が無いときに見せる 1 枚(原寸)
let shareExtra = null;      // 列の端に足す 1 枚(原寸)。無ければ null
let shareRepeat = 0;        // 押しっぱなしにしたときの送り
// **押しはじめに選んでいた矢印**。端まで来て反対側へ移ったら、
// そこで自動の連打を切る(押したままだと、そのまま逆へ戻ってしまうため)
let shareHold = -1;
let shareHintEl = null;     // 何コマめかの案内を出すところ
let shareLeftBtn = null;    // 古いほうへ送る矢印
let shareRightBtn = null;   // 新しいほうへ送る矢印
let shareSendBtn = null;    // X へ出すボタン(出したときはここを選んでおく)
/** 絵の上を横へ払ったぶんの溜め(px)。**しきい値を超えたぶんだけコマを送る** */
let shareSwipeAcc = 0;
/** 1 コマ送るのに要る指の移動(px)。細かいほうがよい(コマは何十枚もある) */
const SHARE_SWIPE_STEP = 18;
let shareOsBtn = null;      // OS へ渡すボタン(X の隣。渡せる環境でだけ出す)
/** OS へ画像を渡せる環境か。**起動時に 1 枚作って聞いてみた答え**(下の setupOsShare) */
let osShareOK = false;
// 板の中で押せるもの。**左右で選び、SPACE で実行、ESC でとじる**。
// マウスなら、そのまま押しても同じ(押したものが選ばれた状態になる)
let shareItems = [];        // 並び順。{ el, run, repeat }
let shareFocus = 0;         // 下のボタンのうち、いま選んでいるもの
let shareZone = 'buttons';  // 'frame' = 矢印(時間を選ぶ) / 'buttons' = 下のボタン
let shareArrow = 0;         // 矢印のどちらを選んでいるか(0 = ◀ / 1 = ▶)
let shareHiScore = false;   // ランクインで出したか(文言が変わる)
// **やられる前の数秒を録った動画**(mp4。作れない環境では webm)。
// リプレイを流したときに録ってあり、ダイアログから落とせる。
// いずれは SNS へ上げるところまでやるが、いまは手元に落とすところまで
let shareMovie = null;      // Blob。まだ録れていなければ null
let shareMovieKind = 'mp4'; // 落とすときの拡張子
let shareMovieBtn = null;   // 「動画を保存」のボタン(録れていないときは隠す)
let shareSaveBtn = null;    // 「絵を保存」のボタン(スマホでは出さない)
// **直前の画面はエンジンが溜めている**。色番号のまま持つので、
// 60fps で 3 秒でも 9MB ほどで収まる(1 コマ 51.6KB)。
// 溜めはじめはゲームを始めるとき。何秒ぶん持つかはゲームが決める。
//   ・シェアの 1 枚 … 「何秒前をくれ」と頼んで、いちばん近いコマをもらう
//   ・やられる前の絵 … 自機がまだ無事な **1 秒前**を使う
//   ・あとで作るリプレイ … 溜まっているコマを頭から流せばよい
// 何秒ぶん持つか。**自機の爆発を見せているあいだも溜めつづける**ので、
// 「爆発のぶん + 見せたい何秒前」が入る長さが要る
// (爆発 REPLAY_BOOM コマ + 1 秒 = 160 コマ。4 秒 = 240 コマなら余裕がある)
const SHARE_KEEP_SEC = 4;
const SHARE_SHOT_AGO = 1;      // やられたとき、何秒前の絵を使うか

/** シェア用に画面を取る。**原寸**でよい。取れなければ null */
function captureShareShot() {
  try {
    // 動画と同じ枠にそろえる(比率は合わせない。静止画は letterbox が要らない)
    return mmsxx.capture({ type: 'canvas', border: SHARE_BORDER });
  } catch (e) {
    mmsxx.errors.log('share: capture failed: ' + e);
    return null;
  }
}

/**
 * やられて終わるときの絵を決める。
 * **溜めてあるコマをそのまま残して**、その中の 1 秒前を最初に見せる
 * (ダイアログの左右でコマを選び直せるようにするため)。
 * 溜まっていない(始めてすぐやられた)ときだけ、その場で 1 枚取る
 */
function keepDeathShareShot() {
  shareShotSaved = null;
  shareBackSaved = -1;
  // **ここでは溜めを止めない。** 自機の爆発まで溜めきってから止める
  // (シェアしたい瞬間は「やられたところ」かもしれないので、その絵も残す)。
  // 止めるのはリプレイが黒い画面へ移るとき(stopDeathCapture)。
  // 1 コマも溜まっていないときだけ、その場で 1 枚取る
  if (!mmsxx.frameCount) shareShotSaved = captureShareShot();
}

/**
 * 溜めるのをここで止めて、**シェアに出す 1 枚**を決める。
 * 爆発まで溜めたあとなので、いま(back = 0)は**やられきったところ**。
 * 最初に見せるのはその手前の、まだ自機が無事な絵にする
 */
function stopDeathCapture() {
  freezeCapture(true);
  if (!mmsxx.frameCount) return;
  // 爆発を見せていたぶんだけ、さらにさかのぼる
  const back = REPLAY_BOOM + SHARE_SHOT_AGO * 60;
  shareShotSaved = null;
  shareBackSaved = Math.min(back, mmsxx.frameCount - 1);
}

/** ランクインで見せる絵の指定。何も無ければ null(その場の画面を取る) */
function savedShareSpec() {
  if (shareShotSaved) return { shot: shareShotSaved };
  if (shareBackSaved >= 0) return { back: shareBackSaved };
  return null;
}

/** 板に載せる形にする。ドットをぼかさずに 2 倍へ広げる */
function enlargeShareShot(src) {
  const out = document.createElement('canvas');
  out.width = src.width * 2;
  out.height = src.height * 2;
  const cx = out.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/** モードの名前。CONTINUE は NORMAL の続きなので NORMAL と名乗る */
function shareModeName() {
  const id = gameMode();
  if (id === 'hard') return 'HARD';
  if (id === 'bossrush') return 'BOSS RUSH';
  return 'NORMAL';
}

// 投稿する文言の決まった部分。**画面に出す文字はすべて英語**。
// タグはそのまま貼ってもらうものなので、日本語のタグも混ぜてよい
// 板に見せる文言。**投稿されるのはサーバが作った文**なので、ここは下書き。
// 中身がずれないよう、docs/sns-templates.json の postTextTemplate を写している。
// **その人の言葉で見せる**(投稿もその言葉の札で送られる)
const SHARE_TEXTS = {
  en: {
    playing: () => 'Playing STAR FABLE, a pixel-art shooter built with Fable 5 + Opus 5!\n#MSX #vibecoding',
    high: (v) => `New high score in STAR FABLE: ${v.score} points (${v.mode}, rank ${v.rank})!\n`
      + 'A pixel-art shooter built with Fable 5 + Opus 5\n#MSX #Claude',
  },
  ja: {
    playing: () => 'Fable 5 + Opus 5 で制作したドット絵シューター STAR FABLE をプレイ中！\n#MSX #vibecoding',
    high: (v) => `STAR FABLE でハイスコア更新！${v.score} 点（${v.mode}・${v.rank} 位）\n`
      + 'Fable 5 + Opus 5 で制作したドット絵シューター\n#MSX #Claude',
  },
  es: {
    playing: () => '¡Jugando a STAR FABLE, un matamarcianos en pixel art hecho con Fable 5 + Opus 5!\n#MSX #vibecoding',
    high: (v) => `¡Nuevo récord en STAR FABLE: ${v.score} puntos (${v.mode}, puesto ${v.rank})!\n`
      + 'Un matamarcianos en pixel art hecho con Fable 5 + Opus 5\n#MSX #Claude',
  },
  pt: {
    playing: () => "Jogando STAR FABLE, um shoot'em up em pixel art feito com Fable 5 + Opus 5!\n#MSX #vibecoding",
    high: (v) => `Novo recorde em STAR FABLE: ${v.score} pontos (${v.mode}, ${v.rank}º lugar)!\n`
      + "Um shoot'em up em pixel art feito com Fable 5 + Opus 5\n#MSX #Claude",
  },
};

/**
 * 板に見せる文言。**送るときと同じ決めかた**(札と値)から作るので、
 * 見えているものと投稿されるものがずれない
 */
function shareTextLines() {
  const meta = snsShareMetadata();
  const t = SHARE_TEXTS[testLang(SNS_LANGS_OPT) || 'en'] || SHARE_TEXTS.en;
  const text = meta.templateKey.startsWith('high-score') ? t.high(meta.values) : t.playing();
  return text.split('\n');
}

/** ダイアログの板を作る(1 回だけ) */
function makeShareEl() {
  if (shareEl) return shareEl;
  // 選んでいる印の点滅。**2 コマ点いて 2 コマ消える**(60 分の 4 秒で 1 周)。
  // 毎コマ塗り直すのは重いので、切り替えはブラウザにまかせる
  const css = document.createElement('style');
  css.textContent = '@keyframes share-focus {'
    + '0%,49.9% { border-color:#ffe000; background:#3a3520 }'
    + '50%,100% { border-color:#cccccc; background:#202020 } }';
  document.head.appendChild(css);
  const el = document.createElement('div');
  el.id = 'share';
  Object.assign(el.style, {
    position: 'fixed', inset: '0', display: 'none',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.72)', zIndex: '9998',
  });
  const box = document.createElement('div');
  Object.assign(box.style, {
    // **字は画面の中と同じ大きさに寄せる**が、大きな窓では伸びすぎるので頭を打つ。
    // 12 の倍数でないとドットが揃わないので、上限も 24
    font: 'clamp(16px, var(--mmsxx-gui-font-size, 16px), 32px) var(--mmsxx-gui-font, monospace)',
    color: '#e8e8e8', textAlign: 'center',
    background: '#101010', border: '2px solid #cccccc',
    // **横持ちのスマホでは高さが足りない。** 詰めたうえで、
    // それでも溢れるぶんは中で送れるようにする(ボタンが画面の外へ出ない)
    padding: '10px 14px', lineHeight: '1.35',
    maxWidth: '96vw', maxHeight: '96vh', boxSizing: 'border-box',
    overflowY: 'auto',
    // 右上の「とじる」を置くための土台
    position: 'relative',
  });
  // 押せるものを 1 つ作る。作った順が**左右で選ぶときの並び**になる
  const mkItem = (fn, repeat = false) => {
    const b = document.createElement('button');
    Object.assign(b.style, {
      font: 'clamp(16px, var(--mmsxx-gui-font-size, 16px), 32px) var(--mmsxx-gui-font, monospace)', color: '#e8e8e8', background: '#202020',
      border: '2px solid #cccccc', padding: '8px 16px', cursor: 'pointer',
      flex: '0 0 auto',
    });
    const item = { el: b, run: fn, repeat };
    // マウスで押したものは、選んだ状態にもする(キーと行き来しても迷わない)
    b.addEventListener('click', () => {
      b.blur();   // 焦点を残さない(そのあとの SPACE で二重に押されるのを防ぐ)
      focusShareItem(shareItems.indexOf(item));
      fn();
    });
    shareItems.push(item);
    return b;
  };

  // 画面の絵。中身は出すたびに入れ替えるので、ここでは空の入れものだけ作る。
  // **左右に矢印を添える**(キーだけだと動かせることに気づけないため)。
  // スマホのときは、この並びをそのままスワイプで動かせるようにする
  const stage = document.createElement('div');
  Object.assign(stage.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: '8px', marginBottom: '6px',
  });
  const shot = document.createElement('div');
  Object.assign(shot.style, { lineHeight: '0', touchAction: 'none' });
  shareShotBox = shot;
  // **絵の上を横へ払うとコマを選べる。** 案内は出さない
  // (矢印が両脇に出ているので、動かせることは見れば分かる)。
  // 見分けを付けるのは**絵の上だけ**。板ぜんぶに付けると、
  // 下のボタンを押した指まで捕まえてしまい、押しても効かなくなる
  // (gesture.js は pointerdown で setPointerCapture する)
  createGesture({
    el: shot,
    onGesture: (e) => {
      if (e.fingers > 1) return;
      if (e.type === 'down') { shareSwipeAcc = 0; return; }
      if (e.type !== 'swipe') return;
      // 画面を回して見せているぶんを戻す(器がやっているのと同じ)
      const d = turnDelta(mmsxx.vdp.viewAngle, e.dx, e.dy);
      const total = turnDelta(mmsxx.vdp.viewAngle, e.totalX, e.totalY);
      // 縦に払ったぶんは相手にしない(板を上下に振っただけで送らない)
      if (Math.abs(total.dy) > Math.abs(total.dx)) return;
      // **指に付いてくる送り。** 何十コマもあるので、1 回 1 コマでは足りない。
      // 払った量ぶん送る(左へ払うと新しいほうへ。器の左右の決めごとと同じ)
      shareSwipeAcc += d.dx;
      while (shareSwipeAcc <= -SHARE_SWIPE_STEP) {
        shareSwipeAcc += SHARE_SWIPE_STEP;
        setShareZone('frame');
        stepShareShot(-1);
      }
      while (shareSwipeAcc >= SHARE_SWIPE_STEP) {
        shareSwipeAcc -= SHARE_SWIPE_STEP;
        setShareZone('frame');
        stepShareShot(1);
      }
    },
  });

  /** 矢印。押しっぱなしのときは、少し待ってから送り続ける(キーと同じ間合い) */
  const mkArrow = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      font: 'clamp(24px, var(--mmsxx-gui-font-size, 24px), 40px) var(--mmsxx-gui-font, monospace)', color: '#e8e8e8', background: '#202020',
      border: '2px solid #cccccc', padding: '12px 8px', cursor: 'pointer',
      lineHeight: '1', flex: '0 0 auto',
    });
    // マウスで押したときは、**押した矢印**を選んだ状態にする
    b.addEventListener('click', () => {
      b.blur();
      setShareZone('frame');
      focusShareArrow(b === shareRightBtn ? 1 : 0);
      fn();
    });
    let wait = 0, run = 0;
    const stop = () => { clearTimeout(wait); clearInterval(run); wait = run = 0; };
    b.addEventListener('pointerdown', () => {
      stop();
      wait = setTimeout(() => { run = setInterval(fn, 50); }, 350);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
    return b;
  };
  shareLeftBtn = mkArrow('◀', () => stepShareShot(1));    // 古いほうへ
  shareRightBtn = mkArrow('▶', () => stepShareShot(-1));  // 新しいほうへ
  stage.append(shareLeftBtn, shot, shareRightBtn);
  box.appendChild(stage);

  // どのコマを見せているかの案内。溜めたコマを出しているときだけ中身が入る
  const hint = document.createElement('div');
  Object.assign(hint.style, { font: 'clamp(16px, var(--mmsxx-gui-font-size, 16px), 32px) var(--mmsxx-gui-font, monospace)', color: '#9a9a9a', marginBottom: '10px' });
  box.appendChild(hint);
  shareHintEl = hint;

  // シェア文言。**日本語と英語を両方並べる**(どちらの言葉の人にもそのまま使ってもらう)
  const text = document.createElement('div');
  Object.assign(text.style, { textAlign: 'left', whiteSpace: 'pre-wrap' });
  box.appendChild(text);
  shareTextEl = text;

  // 送信の結果(コピーできたか)。何もしていないうちは空
  const status = document.createElement('div');
  Object.assign(status.style, { marginTop: '10px', minHeight: '1.7em', color: '#9fdc9f' });
  box.appendChild(status);
  shareStatusEl = status;

  // DOM なのでボタンが置ける。**キーでも押せる**ようにしてある
  //   SPACE = 送信 / ESC = とじる
  const row = document.createElement('div');
  Object.assign(row.style, { marginTop: '16px', display: 'flex', gap: '12px', justifyContent: 'center' });
  const mkBtn = (label, fn) => {
    const b = mkItem(fn);
    b.textContent = label;
    row.appendChild(b);
    return b;
  };
  // X(旧 Twitter)へ出す口。絵と値を投稿サーバへ送り、下書きを開く。
  // **X の公式マークをそのまま使う。** 送り先の名前は、その先の見た目と
  // そろっていないと迷わせる(ドット絵に描き起こすと別の何かに見える)。
  // **文字は添えない。** マークだけで送り先は分かるし、隣に OS へ渡す口が
  // 並ぶので、絵が 2 つ並んだほうが「行き先を選ぶところ」だと読める
  shareSendBtn = mkBtn('', () => postShareToX());
  shareSendBtn.insertAdjacentHTML('beforeend',
    '<svg viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-label="X" role="img"'
    + ' style="vertical-align:-0.16em">'
    + '<path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17'
    + 'l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161'
    + ' 17.52h1.833L7.084 4.126H5.117z"/></svg>');
  // **OS へ渡す口(共有シート)。X の隣に並べる。**
  // スマホでは表にボタンを出さず、カメラを押してここへ来てもらう。
  // 撮ってから行き先を選ぶ、という順のほうが迷わないし、
  // 遊んでいる最中の画面にボタンが 1 つ減る。
  // **出せる環境でだけ出す**(下の setupOsShare が確かめて印を立てる)
  shareOsBtn = mkBtn('', () => osShareImage());
  shareOsBtn.style.display = 'none';
  shareOsBtn.setAttribute('aria-label', 'SHARE IMAGE');
  // **絵は子の箱に敷く。** ボタンそのものへ敷くと、選んだ印を塗るときに
  // background の一括指定で消えてしまう(paintShareItem)
  // **一括指定の background は使わない。** あれは background-image に none を
  // 立ててしまうので、「もう絵が入っているか」を見るときに入っていることになる
  shareOsBtn.appendChild(Object.assign(document.createElement('span'), {
    style: 'display:inline-block;width:1.15em;height:1.15em;vertical-align:-0.16em;'
      + 'background-repeat:no-repeat;background-position:center;'
      + 'background-size:contain;image-rendering:pixelated',
  }));
  // いま板に載っている 1 枚を手元へ落とす。**ALT+S(クリップボード)の代わり**に、
  // キーボードの無い端末でも絵を持ち出せるようにするためのもの。
  // **スマホでは出さない。** 隣の共有シートから「写真に保存」が選べるので、
  // 同じことをするボタンが 2 つ並ぶことになる
  shareSaveBtn = mkBtn('SAVE IMAGE', () => saveShareImage());
  if (PAD_ON) shareSaveBtn.style.display = 'none';
  // 動画は録れているときだけ出す(始めてすぐやられると溜まっていない)。
  // **スマホでは共有シートへ渡す。** 文言は「保存」のままでよい
  // (シートの中に「ビデオを保存」がある)。**渡すのは動画のファイル**で、
  // 隣の共有ボタンが渡す絵とは別物なので、行き先を取り違えないこと
  shareMovieBtn = mkBtn('SAVE VIDEO',
    () => (PAD_ON ? osShareMovie() : saveShareMovie()));
  box.appendChild(row);
  // **とじるは右上の赤い ×。**
  // 下の列に置くと、送り先の X のすぐ隣に「閉じる」が並んで紛らわしい
  // (どちらも 1 文字の記号に見える)。窓を閉じる印が右上なのは世の中の決まりでもあり、
  // どけたぶん下の列が空いて、行き先のボタンを並べる幅ができる。
  // **並び(左右で選ぶ順)では最後のまま。** 作る順を変えていないので、
  // キーだけで使う人の道順は今までどおり
  const closeBtn = mkItem(() => closeShare());
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'CLOSE');
  Object.assign(closeBtn.style, {
    position: 'absolute', right: '4px', top: '4px',
    padding: '2px 10px', lineHeight: '1',
    // **赤いのは字だけ。** 枠と地は他のボタンと同じにしておかないと、
    // 選んでいる印(枠と地を塗る)がここだけ出なくなる
    color: '#ff6a6a',
  });
  box.appendChild(closeBtn);
  el.appendChild(box);
  document.body.appendChild(el);
  shareEl = el;
  return el;
}

/** いま選んでいるものを見た目でも出す(枠と地の色を変える) */
function focusShareItem(i) {
  if (i >= 0 && i < shareItems.length) shareFocus = i;
  const here = shareZone === 'buttons';
  shareItems.forEach((it, n) => {
    paintShareItem(it.el, here && n === shareFocus);
  });
}

/** 選ばれているものは枠と地の色を変える */
function paintShareItem(el, on) {
  // 選んでいるものは**2 コマ点いて 2 コマ消える**(ゲームの中の点滅と同じ速さ)。
  // 60 分の 4 秒ごとの切り替えなので、毎コマ塗らずに CSS の繰り返しにまかせる
  el.style.animation = on ? 'share-focus 0.0667s step-end infinite' : '';
  el.style.borderColor = '#cccccc';
  el.style.background = '#202020';
}

/**
 * どこを選んでいるかを決める。
 * @param {string} z 'frame' なら矢印(左右で時間を選ぶ) / 'buttons' なら下のボタン
 */
function setShareZone(z) {
  // コマを選べないとき(集計画面など)は、いつでも下のボタン
  shareZone = (z === 'frame' && shareBack !== SHARE_ONE) ? 'frame' : 'buttons';
  if (shareZone === 'frame') focusShareArrow(shareArrow);
  else {
    paintShareItem(shareLeftBtn, false);
    paintShareItem(shareRightBtn, false);
  }
  focusShareItem(shareFocus);
}

/**
 * 矢印のどちらを選ぶか。**押せない矢印は選ばない**。
 * 反対側も押せなければ、下のボタンへ移る(選べないものに留まらない)
 * @param {number} i 0 = ◀(古いほうへ) / 1 = ▶(新しいほうへ)
 */
function focusShareArrow(i) {
  const btns = [shareLeftBtn, shareRightBtn];
  const live = btns.map((b) => b && !b.disabled && b.style.display !== 'none');
  if (!live[0] && !live[1]) { setShareZone('buttons'); return; }
  if (!live[i]) i = 1 - i;
  shareArrow = i;
  paintShareItem(shareLeftBtn, shareZone === 'frame' && i === 0);
  paintShareItem(shareRightBtn, shareZone === 'frame' && i === 1);
}

/** いま押せるものか(隠れているもの・端まで来た矢印は飛ばす) */
function shareItemLive(it) {
  return it.el.style.display !== 'none' && !it.el.disabled;
}

/**
 * 選ぶものを左右に動かす。押せないものは飛ばす。
 * @param {number} d +1 で右へ、-1 で左へ
 */
function moveShareFocus(d) {
  const n = shareItems.length;
  for (let i = 1; i <= n; i++) {
    const at = (shareFocus + d * i + n * n) % n;
    if (shareItemLive(shareItems[at])) { focusShareItem(at); return; }
  }
}

/** いま選んでいるものを実行する */
/** 選んでいる矢印を押す(◀ = 古いほうへ / ▶ = 新しいほうへ) */
function runShareArrow() {
  const btn = shareArrow === 0 ? shareLeftBtn : shareRightBtn;
  if (!btn || btn.disabled) return;
  stepShareShot(shareArrow === 0 ? 1 : -1);
}

function runShareFocus() {
  const it = shareItems[shareFocus];
  if (it && shareItemLive(it)) it.run();
}

/**
 * いま選んでいるコマを板に載せる。**送信もこの絵になる**。
 * 溜めてあるコマなら何秒前かを添える(左右で選べることも書いておく)
 */
function drawShareShot() {
  const one = shareBack === SHARE_EXTRA ? shareExtra : shareFixed;
  const src = shareBack >= 0 ? mmsxx.frameBackCanvas(shareBack, 2)
    : (one ? enlargeShareShot(one) : null);
  shareShot = src;
  if (shareShot) {
    // 板からはみ出さないようにする。ドットはぼかさない。
    // **縦も抑える**。横だけ見ていると、横持ちのスマホで絵が画面の高さを
    // 追い越して、下のボタンが画面の外へ押し出される。
    // 絵は小さくても構わない(どのコマかが分かればよい)
    Object.assign(shareShot.style, {
      display: 'block', maxWidth: '60vw', maxHeight: '38vh',
      width: 'auto', height: 'auto',
      imageRendering: 'pixelated', border: '1px solid #444444',
    });
    shareShotBox.replaceChildren(shareShot);
  } else {
    shareShotBox.replaceChildren();
  }
  // 案内と矢印。**画面に出す文字は英語**にそろえる(コメントだけ日本語)
  const pick = shareBack >= 0 || shareBack === SHARE_EXTRA;
  shareLeftBtn.style.display = shareRightBtn.style.display = pick ? '' : 'none';
  if (!pick) { shareHintEl.textContent = ''; return; }
  const { lo, hi } = shareWindow();
  setArrowEnabled(shareLeftBtn, shareBack < hi);
  setArrowEnabled(shareRightBtn, shareBack > lo);
  // 端まで来て押せなくなった矢印に留まらない
  if (shareZone === 'frame') focusShareArrow(shareArrow);
  const n = hi - shareBack + 1, of = hi - lo + 1;   // 古いほうから数えた番号
  const keys = '  (UP-DOWN: SWITCH / LEFT-RIGHT: SELECT / SPACE: RUN)';
  // 足した 1 枚には「何秒前」が無いので、名前で出す
  shareHintEl.textContent = shareBack === SHARE_EXTRA
    ? `FRAME ${n}/${of} - RESULT` + keys
    : `FRAME ${n}/${of} - ${(shareBack / 60).toFixed(2)}s BEFORE` + keys;
}

/** 端まで来た矢印は押せなくする(押せるかどうかを見た目でも出す) */
function setArrowEnabled(btn, on) {
  btn.disabled = !on;
  btn.style.opacity = on ? '1' : '0.3';
  btn.style.cursor = on ? 'pointer' : 'default';
}

/** 選べるコマの範囲。**溜まっているぶん全部**から選べる */
function shareWindow() {
  // lo = 新しい端 / hi = 古い端。足した 1 枚は**いちばん新しい側**に置く
  // (戦いのあとに出る絵なので、時の流れと同じ並びになる)
  return { lo: shareExtra ? SHARE_EXTRA : 0, hi: Math.max(0, mmsxx.frameCount - 1) };
}

/**
 * 見せるコマを前後させる。
 * @param {number} d +1 で古いほうへ、-1 で新しいほうへ
 */
function stepShareShot(d) {
  if (shareBack === SHARE_ONE) return;   // 列が無いときは選びようがない
  const { lo, hi } = shareWindow();
  const next = Math.max(lo, Math.min(hi, shareBack + d));
  if (next === shareBack) return;
  shareBack = next;
  drawShareShot();
}

/**
 * **画面を回して見せているときは、この板も一緒に回す。**
 * 板は画面の座標のまま置かれるので、回さないとゲームだけ横向き・
 * 板だけ縦向き、という食い違いになる(実機で横倒しに見えた)。
 * 器(engine/util/touchgui.js)がやっているのと同じ移しかたで、
 * **同じ関数を借りる**。ここに式を写すと、片方だけ直して食い違う
 */
function fitShareEl() { fitOverlayEl(shareEl); }

/**
 * 画面いっぱいに重ねる板を、**ゲームと同じ向きへ回す**。
 * シェアの板とホームに勧める板の 2 つが使う(どちらも同じ理由で回す)
 */
function fitOverlayEl(el) {
  if (!el) return;
  const angle = mmsxx.vdp.viewAngle;
  if (!angle) {
    Object.assign(el.style, { inset: '0', width: '', height: '', transform: '' });
    return;
  }
  const vw = window.innerWidth, vh = window.innerHeight;
  const v = viewTransform(angle, vw, vh);
  Object.assign(el.style, {
    width: v.w + 'px', height: v.h + 'px', inset: 'auto', left: '0', top: '0',
    transformOrigin: '0 0', transform: v.css,
  });
}

/**
 * シェアのダイアログを出す。
 * @param {() => void} [after] 閉じたあとにやること(ランクインのときの続き)
 * @param {{back?:number, shot?:HTMLCanvasElement}} [spec] 見せる絵。
 *   back = 溜めてあるコマ(何コマ前) / shot = 溜めと関係ない 1 枚。
 *   省いたときは、遊んでいる最中なら溜めてあるいちばん新しいコマ、
 *   そうでなければその場の画面を 1 枚取る
 */
function openShare(after, spec) {
  if (shareOpen) return;
  shareOpen = true;
  shareAfter = after || null;
  shareHiScore = !!(spec && spec.hi);
  // 裏ではポーズしておく。すでにポーズ中なら触らない
  // (ポーズすると溜めも止まるので、出しているあいだコマは動かない)
  sharePaused = (state === 'play' && !paused);
  if (sharePaused) togglePause();
  const el = makeShareEl();
  el.style.display = 'flex';
  // **板ができるのは初めて開いたとき**なので、出し入れはここで決める
  // (起動時の setupOsShare はまだ板が無く、印を立てるだけ)
  updateShareOsBtn();
  fitShareEl();
  shareFixed = null;
  shareExtra = null;
  shareBack = SHARE_ONE;
  if (spec && spec.shot) {
    // 取ってある 1 枚(集計画面)。**溜めが残っていれば列の端に足して**、
    // 戦いの場面も選べるようにする(最初に見せるのは取ってある 1 枚)
    if (mmsxx.frameCount) { shareExtra = spec.shot; shareBack = SHARE_EXTRA; }
    else shareFixed = spec.shot;
  } else if (spec && spec.back >= 0) shareBack = Math.min(spec.back, mmsxx.frameCount - 1);
  else if (state === 'play' && mmsxx.frameCount) shareBack = 0;   // ALT+P: いまの画面
  else shareFixed = captureShareShot();
  drawShareShot();
  shareTextEl.textContent = shareTextLines().join('\n');
  shareStatusEl.textContent = '';
  shareBusy = false;
  shareRepeat = 0;
  shareHold = -1;
  updateShareMovieBtn();
  // 出したときは下のボタンの SHARE を選んでおく(そのまま SPACE で送れる)
  // 下へ降りたときに選ばれるものだけ決めておく
  shareFocus = Math.max(0, shareItems.findIndex(it => it.el === shareSendBtn));
  // **始まりは上(コマを選ぶ矢印)**。まず絵を決めてから送ってほしいので。
  // コマを選べないとき(集計画面の 1 枚だけなど)は、中で下のボタンに落ちる。
  // 最初に選ぶのは ◀(古いほうへ戻る側)。新しい端から始まるため
  shareArrow = 0;
  setShareZone('frame');
  mmsxx.audio.playSE('shutter', SE_JINGLE);
}

/** 動画のボタンを出す / 隠す(録れているときだけ押せる) */
function updateShareMovieBtn() {
  if (shareMovieBtn) shareMovieBtn.style.display = shareMovie ? '' : 'none';
}

/**
 * 録ってある動画を手元へ落とす。
 * **URL は押されたときに作って、すぐ捨てる**(持ち続けると中身が消えない)。
 * SNS へ上げるところは通信の作業で足す。ここは渡し口だけ
 */
/**
 * いま板に載っている 1 枚を手元へ落とす。
 * **URL は押されたときに作って、すぐ捨てる**(持ち続けると中身が消えない)。
 * 出すのは板に見えているものそのままなので、コマを選び直せば選んだコマが落ちる
 */
function saveShareImage() {
  if (!shareShot) { shareStatusEl.textContent = 'NO IMAGE'; return; }
  shareShot.toBlob((blob) => {
    if (!blob) { shareStatusEl.textContent = 'COULD NOT SAVE'; return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `starfable-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    shareStatusEl.textContent = 'IMAGE SAVED';
  }, 'image/png');
}

// ---- X へ投稿する ----
// 画像と**値だけ**を投稿サーバへ送り、**文言はサーバが作る**(こちらで組み立てない)。
// 送る口は online/ にあるので、そこを外した配布物では黙って「繋がっていない」と出す。
//   何を送るか … 記録を登録し終えたあとは high-score、それ以外は playing
//   画像      … いま板に載っている 1 枚(528x400 の PNG。十数 KB で、上限 1MB に収まる)
const SNS_ENDPOINT = 'https://mmsxx-sns-sharing-server.harayoki.workers.dev';
const SNS_GAME_ID = 'star-fable';
// サーバが返す失敗の合図を、板に出す短い英語にする
const SNS_MESSAGES = {
  TURNSTILE_REQUIRED: 'CHECK FAILED - RELOAD THE PAGE',
  TURNSTILE_INVALID: 'CHECK FAILED - TRY AGAIN',
  TURNSTILE_UNAVAILABLE: 'CHECK SERVICE IS DOWN - TRY LATER',
  TURNSTILE_CLIENT_ERROR: 'CHECK FAILED - TRY AGAIN',
  TURNSTILE_CLIENT_TIMEOUT: 'CHECK TIMED OUT - TRY AGAIN',
  RATE_LIMITED: 'TOO MANY POSTS - PLEASE WAIT A WHILE',
  RATE_LIMIT_UNAVAILABLE: 'SHARING IS BUSY - TRY LATER',
  ORIGIN_NOT_ALLOWED: 'CANNOT POST FROM HERE',
  PAYLOAD_TOO_LARGE: 'IMAGE TOO LARGE',
  IMAGE_TOO_LARGE: 'IMAGE TOO LARGE',
  UNSUPPORTED_IMAGE_TYPE: 'IMAGE TYPE NOT SUPPORTED',
  UNSUPPORTED_MEDIA_TYPE: 'IMAGE TYPE NOT SUPPORTED',
  INVALID_IMAGE: 'IMAGE COULD NOT BE READ',
  INVALID_METADATA: 'BAD DATA - PLEASE REPORT THIS',
  INVALID_MULTIPART: 'BAD DATA - PLEASE REPORT THIS',
  INVALID_CONTENT_LENGTH: 'BAD DATA - PLEASE REPORT THIS',
  NETWORK_ERROR: 'NETWORK ERROR - CHECK YOUR CONNECTION',
};
let snsClient = null;        // 投稿の口(1 回だけ作る)
let snsClientTried = false;  // 作ろうとしたか(無い配布物で何度も試さない)

/** 投稿の口を用意する。online/ を外した配布物では null が返る */
async function getSnsClient() {
  if (snsClient || snsClientTried) return snsClient;
  snsClientTried = true;
  try {
    const { createShareClient } = await import('../online/sns-share-client.js');
    // 手元(DEV)は Turnstile を通さない。本番だけ必須
    snsClient = createShareClient({ endpoint: SNS_ENDPOINT, turnstile: !DEV });
  } catch (e) {
    mmsxx.errors.log('sns: client not available: ' + e);
  }
  return snsClient;
}

/**
 * 送る中身を決める。
 * **記録を登録し終えたあと**は high-score、遊んでいる最中などは playing。
 * 値はサーバの決まり(名前 5 文字 / 得点 9 桁 / 順位 1..100 / モード 9 文字)に丸める。
 * playing は値を 1 つも入れてはいけない(定義外の名前は 400 になる)
 */
// 投稿の文言をその人の言葉で出すために、**札の名前に言葉を付ける**。
// ここに並んでいる言葉だけがサーバに札を持っている(無い言葉は英語のまま。
// オランダは英語がよく通じるので、あえて英語のままにしている)。
//   例) 日本語で遊んでいる人 … 'high-score-ja'
const SNS_LANGS = ['ja', 'es', 'pt'];
/**
 * **`?lang=` で選べる言葉。** SNS_LANGS に 'en' を足したもの。
 *
 * SNS_LANGS は「**サーバに札がある言葉**」の一覧なので en は入っていない
 * (英語は札の名前に何も付けない、が英語)。それをそのまま `?lang=` の
 * 受け付け一覧に使っていたので、**`?lang=en` が知らない値として捨てられ**、
 * ブラウザの希望(日本語)へ落ちていた。**確かめる側は en も選べないと困る**
 */
const SNS_LANGS_OPT = [...SNS_LANGS, 'en'];

/**
 * **確かめるための言語の上書き**。`?lang=ja` のように書くと、
 * ブラウザの希望より先にそれを使う。**用意していない言葉は無視**して、
 * いつもどおりの選びかたへ落ちる(打ち間違いで別の言葉になったりしない)。
 *
 * 出し分けているところは全部これを通す。片方だけ上書きが効くと、
 * 「案内は日本語なのにシェア文は英語」のようなちぐはぐな絵ができてしまう。
 * **実運用ではブラウザ任せのまま**(URL に書かなければ何も変わらない)
 * @param {string[]} supported 用意している言葉
 * @param {string} [fallback] どれにも当たらないときに返すもの
 */
function testLang(supported, fallback = '') {
  const v = OPT.get('lang');
  if (v && supported.includes(v)) return v;
  return pickLanguage(supported, fallback);
}

/**
 * 札の名前。その人の言葉があれば後ろに付ける(見分けはエンジンの部品にまかせる)。
 * **?lang= もここへ効かせる。** 板に出る文言と投稿されるカードは
 * 同じところから作っているので、片方だけ上書きが効くとちぐはぐになる
 * (`?lang=en` は札に何も付かない = 英語のカード)
 */
function snsTemplateKey(base) {
  const lang = testLang(SNS_LANGS_OPT);
  return (lang && SNS_LANGS.includes(lang)) ? base + '-' + lang : base;
}

function snsShareMetadata() {
  const rec = (state !== 'play' && entryTarget === 'score' && submitRank >= 0 && submitEntry)
    ? submitEntry : null;
  if (!rec) {
    return { gameId: SNS_GAME_ID, templateKey: snsTemplateKey('playing'), destinationPath: '/', values: {} };
  }
  return {
    gameId: SNS_GAME_ID,
    templateKey: snsTemplateKey('high-score'),
    destinationPath: '/',
    values: {
      playerName: String(rec.name || 'NONAME').slice(0, NAME_MAX),
      score: Math.max(0, Math.min(999999999, Math.round(rec.score || 0))),
      rank: Math.max(1, Math.min(HISCORE_MAX, submitRank + 1)),
      mode: shareModeName().slice(0, 9),
    },
  };
}

// カードの大きさ。SNS が想定しているのは **1200x630**。
// 画面は 4:3 なのでそのままでは上下が切られる。**整数倍で拡げて真ん中に置き**、
// 余りは黒で埋める(ドットの角が溶けないよう、拡大はいつも整数倍)
const CARD_W = 1200, CARD_H = 630;

/** 投稿用の 1 枚を作る。板に見せている絵を 1200x630 の帯の真ん中へ置く */
function makeShareCardCanvas() {
  const src = shareBack >= 0 ? mmsxx.frameBackCanvas(shareBack)
    : shareBack === SHARE_EXTRA ? shareExtra : shareFixed;
  if (!src) return null;
  const scale = Math.max(1, Math.min(
    Math.floor(CARD_W / src.width), Math.floor(CARD_H / src.height)));
  const w = src.width * scale, h = src.height * scale;
  const out = document.createElement('canvas');
  out.width = CARD_W;
  out.height = CARD_H;
  const cx = out.getContext('2d');
  cx.fillStyle = '#000000';
  cx.fillRect(0, 0, CARD_W, CARD_H);
  cx.imageSmoothingEnabled = false;
  cx.drawImage(src, Math.floor((CARD_W - w) / 2), Math.floor((CARD_H - h) / 2), w, h);
  return out;
}

/** 投稿しているあいだは板のボタンを押せなくする(二重に送らないため) */
function setShareBusy(on) {
  shareBusy = on;
  // **押せないことを目でも分かるようにする。** 送っているあいだに何度も押されると、
  // 同じ絵が何枚も上がってしまう(頻度制限にも当たる)
  for (const it of shareItems) {
    it.el.disabled = on;
    it.el.style.opacity = on ? '0.4' : '1';
    it.el.style.cursor = on ? 'progress' : 'pointer';
  }
  shareLeftBtn.disabled = shareRightBtn.disabled = on;
  if (on) {
    shareLeftBtn.style.opacity = shareRightBtn.style.opacity = '0.4';
    shareLeftBtn.style.cursor = shareRightBtn.style.cursor = 'progress';
  } else {
    // 端まで来た矢印と、録れていない動画のボタンは元どおり押せないままにする
    drawShareShot();
    updateShareMovieBtn();
  }
}

/**
 * いまの絵と値を投稿サーバへ送り、返ってきた URL で X の下書きを開く。
 * **文言と行き先はサーバが決めたもの**をそのまま使う
 */
function postShareToX() {
  if (shareBusy) return;
  // 送るのは板に見せている絵そのものではなく、**カードの形に整えた 1 枚**
  const card = makeShareCardCanvas();
  if (!card) { shareStatusEl.textContent = 'NO IMAGE'; return; }
  // **窓は押されたその場で開ける。** 投稿の返事を待ってから開くと、
  // 「人が押した流れ」から外れてブラウザに止められる(ポップアップよけ)。
  // 中身は空のまま開けておき、URL が決まってから入れる。
  // noopener を渡すと窓の取っ手が返らないので、ここでは付けずに opener を切る
  const win = window.open('about:blank', '_blank');
  if (win) win.opener = null;
  setShareBusy(true);
  shareStatusEl.textContent = 'POSTING...';
  const tell = (msg) => { if (shareOpen) shareStatusEl.textContent = msg; };
  card.toBlob(async (blob) => {
    try {
      if (!blob) { tell('NO IMAGE'); return; }
      const client = await getSnsClient();
      if (!client) { tell('X: NOT CONNECTED'); return; }
      const metadata = snsShareMetadata();
      // **その言葉の札がサーバに無いときは、英語の札で送り直す。**
      // 札が増えるのを待たずにゲームを出せるようにするための逃げ道
      let data;
      try {
        data = await client.submit({ image: blob, metadata });
      } catch (first) {
        const base = metadata.templateKey.replace(/-[a-z]{2}$/, '');
        if (first && first.code === 'INVALID_METADATA' && base !== metadata.templateKey) {
          mmsxx.errors.log('sns: no template for ' + metadata.templateKey + ', using ' + base);
          metadata.templateKey = base;
          data = await client.submit({ image: blob, metadata });
        } else {
          throw first;
        }
      }
      // ここまで来たら投稿は**もうできている**(窓が開けたかどうかとは別)。
      // 統計の SNS SHARED に 1 つ足して、その場で保存しておく
      record.add('shares', 1);
      record.flush();
      // SNS に流すのは**ゲーム側のページ**(functions/share/[shareId].ts)。
      // そのルートがまだ無い配布物では、Worker のページに落ちる
      const page = data.gameShareUrl || data.shareUrl;
      const url = 'https://x.com/intent/post?text=' + encodeURIComponent(data.postText)
        + '&url=' + encodeURIComponent(page);
      if (win && !win.closed) {
        win.location.replace(url);
        tell('OPENED X');
      } else {
        // 窓が開けなかったときは、板から自分で開いてもらう
        showShareLink(url);
      }
    } catch (e) {
      if (win && !win.closed) win.close();   // 空の窓を残さない
      const code = e && e.code;
      tell(SNS_MESSAGES[code] || 'COULD NOT POST');
      mmsxx.errors.log('sns: post failed: ' + code + ' / ' + (e && e.message));
    } finally {
      setShareBusy(false);
    }
  }, 'image/png');
}

/**
 * 窓を開けなかったときの逃げ道。**板の中にリンクを出す**。
 * ポップアップを止める設定でも、これを押せば X へ行ける
 */
function showShareLink(url) {
  shareStatusEl.textContent = '';
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'POPUP BLOCKED - OPEN X HERE';
  Object.assign(a.style, { color: '#ffe000', textDecoration: 'underline' });
  shareStatusEl.appendChild(a);
}

function saveShareMovie() {
  if (!shareMovie) return;
  const url = URL.createObjectURL(shareMovie);
  const a = document.createElement('a');
  a.href = url;
  a.download = `starfable-${Date.now()}.${shareMovieKind}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  shareStatusEl.textContent = 'VIDEO SAVED';
}

/**
 * **録ってある動画を OS の共有シートへ渡す**(スマホ)。
 *
 * 渡すのは**動画のファイル**。すぐ隣にある共有ボタンは**絵**を渡すので、
 * 同じシートが開いても中身は別。取り違えると、動画のつもりで
 * 静止画が送られる(見た目では気づけない)。
 * 渡せない環境では、今までどおり手元へ落とす
 */
async function osShareMovie() {
  if (!shareMovie) return;
  const name = `starfable-${Date.now()}.${shareMovieKind}`;
  const type = shareMovie.type || (shareMovieKind === 'mp4' ? 'video/mp4' : 'video/webm');
  const file = new File([shareMovie], name, { type });
  try {
    if (!navigator.share || !navigator.canShare || !navigator.canShare({ files: [file] })) {
      saveShareMovie();   // 渡せない端末では落とすほうへ
      return;
    }
    await navigator.share({ files: [file], title: 'STAR FABLE' });
  } catch (e) { /* 取り消されただけのことが多い。何も知らせない */ }
}

/** ダイアログを閉じて、元の状態へ戻す */
function closeShare() {
  if (!shareOpen) return;
  shareOpen = false;
  shareBusy = false;
  if (shareEl) shareEl.style.display = 'none';
  // **ポーズはそのままにする。** ESC で閉じた勢いでゲームが動き出すと、
  // 見ていた人が置いていかれる。動かすのはもう一度 ESC を押したとき
  sharePaused = false;
  // 選ぶために止めていた溜めを戻す(ポーズ中はポーズ側が止めたままにする)
  applyCapture();
  shareBack = SHARE_ONE;
  shareFixed = null;
  shareExtra = null;
  shareHiScore = false;
  const after = shareAfter;
  shareAfter = null;
  if (after) after();
}

/** 被弾: バリアが最優先で身代わり、次にパワーダウン、1way なら爆発して 1 機失う */
function damagePlayer(cause = 'unknown') {
  startShake(10);
  if (recordOn()) tally.hits++;   // 耐えたぶんも被弾として数える
  if (barrierHP > 0) {
    barrierHP--;
    invincible = 110;
    mmsxx.audio.playSE('powerdown');
    // **無くなったときだけ知らせる**。2 枚めが 1 枚に減っただけで
    // 「LOST」と出ると、まだ残っているのに失ったように見える
    if (barrierHP <= 0) showNotice('BARRIER LOST');
    drawHUD();
    return;
  }
  // NORMAL は装備が下がらない(バリアだけが盾になる)
  if (!isNormal() && shotLevel > 1) {
    shotLevel--;
    invincible = 100;
    mmsxx.audio.playSE('powerdown');
    drawHUD();
    return;
  }
  destroyPlayer(cause);
}

/**
 * 一撃で瀕死にする攻撃(ボスへの体当たり・小惑星・ミサイル)。
 * 装備を 1 段階(ワイドショット 1・バリア無し)まで削り、
 * すでに瀕死ならその場で 1 機失う。
 */
/**
 * クリティカルの**見た目だけ**を出す(体力も装備も減らさない)。
 * 未実装君の涙のように「痛そうだが痛くない」ものに使う
 */
function criticalLook() {
  startShake(18);
  mmsxx.audio.playSE('bigboom', SE_HIT);
  for (let i = 0; i < 6; i++) {
    spawnBoom(player.x - 12 + Math.random() * 32, player.y - 12 + Math.random() * 32);
  }
  flashTimer = 3;
  // 本物と見分けが付くよう、にせのほうは最後を「?」にする
  showNotice('CRITICAL?');
}

function criticalHit(cause) {
  if (invincible > 0 || respawnDelay > 0 || state !== 'play') return;
  startShake(18);
  // NORMAL は装備を削らない。バリアがあればそれで受け、無ければ 1 機失う
  if (isNormal()) {
    if (barrierHP <= 0) { destroyPlayer(cause); return; }
    barrierHP = 0;
    invincible = 120;
    mmsxx.audio.playSE('powerdown');
    showNotice('BARRIER LOST');
    drawHUD();
    return;
  }
  if (shotLevel <= 1 && barrierHP <= 0) { destroyPlayer(cause); return; }
  shotLevel = 1;
  barrierHP = 0;
  invincible = 120;
  // 大事な音なので優先度を上げ、細かい爆発を自機のまわりに散らす
  mmsxx.audio.playSE('bigboom', SE_HIT);
  for (let i = 0; i < 6; i++) {
    spawnBoom(player.x - 12 + Math.random() * 32, player.y - 12 + Math.random() * 32);
  }
  flashTimer = 3;
  showNotice('CRITICAL!');
  drawHUD();
}

/**
 * 即死。バリアやパワーに関係なく 1 機失う(キューブへの衝突・レーザー直撃)
 * @param {boolean} noMercy true ならバリアでも肩代わりできない(16t など)
 */
function destroyPlayer(cause = 'unknown', noMercy = false) {
  if (respawnDelay > 0 || state !== 'play') return;
  if (NO_DAMAGE) return;   // ?invincible=1(開発版だけ)
  startShake(26);
  // NORMAL はバリアがあればそれで肩代わり。装備そのものは下げない
  if (isNormal() && barrierHP > 0 && !noMercy) { damagePlayer(cause); return; }
  // これが最後の 1 機なら、ここでゲームオーバーが決まる。
  // シェアに載せる絵は、**やられる前**に溜めてあったコマから選ぶ
  if (ships <= 1) keepDeathShareShot();
  // 次の 1 機ぶんは溜め直す(前の機の、爆発や復活中の絵を混ぜない)。
  // **絵と音はそろえて捨てる**。片方だけ残すと、リプレイで尺が食い違う。
  // **最後の 1 機のときは残す**。やられたあとのリプレイに使うため
  else { mmsxx.keepFrames(SHARE_KEEP_SEC); mmsxx.keepSound(SHARE_KEEP_SEC); }
  // **白い光の渦**で散る。爆発を重ねると止め絵で汚くなるので、
  // 4 枚のスプライトを順ぐりに見せる形にしてある(spawnDeathBurst)
  spawnBoom(player.x, player.y, true);    // 最初のひと膨らみだけ残す(芯は長め)
  spawnDeathBurst(player.x, player.y);
  flashTimer = 5;
  // やられた瞬間に残っていた弾は消す(復活演出中に当たり続けないように)
  for (const b of [...bullets]) removeBullet(b);
  // 自機がやられた音は何よりも聞こえてほしいので優先度を上げる
  mmsxx.audio.playSE('bigboom', SE_HIT);
  statsDeath(cause);
  // やられたら「はじまりの装備」に戻す。
  // HARD は丸腰へ、NORMAL とボスラッシュはそのモードの初期装備へ戻る
  // (これまで NORMAL だけ何も戻らず、上げた装備を持ったままだった)。
  applyStartGear();
  coinValue = COIN_BASE;
  ships--;
  if (ships <= 0) {
    // **自機は消す。** リプレイの前に爆発を見せるので、
    // 消さないと壊れたはずの機体がそのまま残って見える
    player.visible = false;
    aux.visible = false;   // 炎とバリアも一緒に消す
    enterGameOver();
  } else {
    // 爆発を見せてから復帰させる
    player.visible = false;
    aux.visible = false;   // 炎とバリアも一緒に消す
    invincible = 400;
    respawnDelay = 75;
    spawnUfoWave(true); // ミス直後は弾を撃たない UFO の群れが通り過ぎる
    if (ships === 1) startLastShipWarning(); // これが最後の 1 機
    drawHUD();
  }
}

/** ミス後の復帰: 画面下の外から SE と一緒にせり上がってくる */
function respawnPlayer() {
  player.x = (SCREEN_W - 16) / 2;
  player.y = SCREEN_H + 24;
  player.visible = true;
  entering = true;
  invincible = 160;
  mmsxx.audio.playSE('appear');
}

const ITEM_IMG = {
  power: SPRITE_SYMBOLS.item, star: SPRITE_SYMBOLS.star, bomb: SPRITE_SYMBOLS.bomb,
  speed: SPRITE_SYMBOLS.speedUp, rapid: SPRITE_SYMBOLS.rapidUp, life: SPRITE_SYMBOLS.oneUp,
  damage: SPRITE_SYMBOLS.powerUp, barrier: SPRITE_SYMBOLS.barrierItem,
  coin: SPRITE_SYMBOLS.coinItem, auto: SPRITE_SYMBOLS.autoItem,
  // 「?」から出る輝く $。絵は $ と同じで、色だけ回して光らせる
  coinmax: SPRITE_SYMBOLS.coinItem,
  // そらのドラゴンの顔からだけ出る。取るとフルパワー(オート連射ではない)
  dragon: SPRITE_SYMBOLS.dragonItem,
  // 未実装さんを見逃すと置いていく飴。取っても何も起きない
  candy: SPRITE_SYMBOLS.candyItem,
};

// 点滅用の白バージョン
const ITEM_IMG_W = {};
for (const [k, img] of Object.entries(ITEM_IMG)) ITEM_IMG_W[k] = recolor(img, 15);
// 輝く $ の色。白 → 黄 → 水色と回して、ふつうの $ と見分けられるようにする
const COINMAX_IMAGES = [15, 11, 7].map((c) => recolor(SPRITE_SYMBOLS.coinItem, c));

/** 絵を n ドットだけ上へずらしたコピーを作る */
function shiftUp(img, n) {
  const pixels = new Uint8Array(img.pixels.length);
  for (let y = 0; y < img.height - n; y++) {
    for (let x = 0; x < img.width; x++) {
      pixels[y * img.width + x] = img.pixels[(y + n) * img.width + x];
    }
  }
  return { width: img.width, height: img.height, pixels };
}

// タイトルのアイテム一覧用。16x16 の枠に対して絵が中央(2 ドット下)にあるので、
// 8x8 の文字と高さがそろうよう 4 ドット上げたものを使う。
const ITEM_ICON = {};
for (const [k, img] of Object.entries(ITEM_IMG)) ITEM_ICON[k] = shiftUp(img, 4);

/**
 * アイテムの種類を抽選する。すでに上限に達していて効果のないものは出さない。
 * (パワー最大の P はボムとして働くので候補に残す)
 */
// スコアの 100 の位でアイテムの種類が決まる(0 のときだけランダム)。
// 昔のゲームにあった「スコアの桁で中身が変わる」仕掛け(100 の位で決まる)。
// WAY 数(power)が主役なので、数字の割り当ても power を多めにする
const ITEM_BY_DIGIT = [
  null,       // 0 = ランダム(1UP はここでだけ出る)
  'power',    // 1
  'power',    // 2
  'speed',    // 3
  'power',    // 4
  'rapid',    // 5
  'power',    // 6
  'damage',   // 7
  'power',    // 8
  'damage',   // 9  (バリアと 1UP はランダム枠から出る)
];

// 選び直しの候補。1UP は 100 の位が 0(ランダム枠)のときだけ候補に加わる
const ITEM_KINDS = ['power', 'speed', 'rapid', 'damage', 'barrier'];

function randomItemKind() {
  // 100 の位で決める。同じ数字に張り付いたときの逃げとして小さな乱数を足す
  const digit = (Math.floor(score / 100) + Math.floor(rnd() * 3)) % 10;
  const kind = ITEM_BY_DIGIT[digit];

  // すでに上限で、取っても意味がないもの
  const maxed = {
    power: shotLevel >= MAX_POWER,
    speed: speedLevel >= SPEED_TABLE.length,
    rapid: maxVolleys >= MAX_VOLLEY_LIMIT,
    damage: damageLevel >= DAMAGE_TABLE.length,
    barrier: barrierHP >= MAX_BARRIER,
    life: ships >= MAX_SHIPS,
  };
  if (kind && !maxed[kind]) return kind;

  // 数字がランダム枠(0)か、意味がないものだったときは、
  // まだ効果のあるものから選び直す(全部そろっていたらボム)。
  // 1UP はランダム枠のときだけ candidates に加わる。
  // $ は数字では出ず、このランダム枠と通常の敵からだけ出る(? は黄色いキューブ専用)
  const extras = digit === 0 ? ['life', 'coin', 'coin'] : [];
  const candidates = ITEM_KINDS.concat(extras);
  const useful = candidates.filter(k => !maxed[k]);
  if (!useful.length) return rnd() < 0.5 ? 'coin' : 'bomb';
  // WAY 数が主役なので、まだ上げられるうちは出やすくしておく
  // ワイドが 3 段階以上になったら出やすさを下げて、$ やボムに回す
  const bonus = maxed.power ? [] : (shotLevel >= 3 ? ['power'] : ['power', 'power']);
  const pool = useful.concat(bonus);
  return pool[Math.floor(rnd() * pool.length)];
}

/** @param {'power'|'star'|'bomb'|'speed'|'rapid'|'life'|'damage'|'barrier'} kind */
/**
 * アイテムを落とす。
 * toss を渡すと、その速さで **放り上げて**、重力で落ちてくる。
 * (置くだけだと、下へ流れてすぐ画面から消えてしまうため)
 */
function dropItem(x, y, kind = 'power', toss) {
  const sp = mmsxx.sprite(ITEM_IMG[kind]);
  sp.x = x; sp.y = y; sp.priority = 7;
  items.push({
    sp, age: 0, kind,
    vx: toss ? toss.vx : 0, vy: toss ? toss.vy : 0,
    // drift を渡すと、そのあいだ重力を受けずにまっすぐ流れる
    drift: toss ? (toss.drift || 0) : 0,
  });
}

// ボスは BG (layer2) に描き、レイヤーのスクロールで動かす。
// 仮想画面上の固定位置に頭を置き、scroll = (頭の仮想座標 - 画面表示位置) とする。
// 目だけはスプライトを重ねて見栄えを良くする。
// 第1形態は「宇宙船に乗ったタコ」。80% ダメージで船が爆発し、タコだけになる。
const BOSS_W = 64, HEAD_W = 48, HEAD_H = 32, SHIP_H = 24;
const BOSS_H = HEAD_H + SHIP_H;
const HEAD_DX = (BOSS_W - HEAD_W) / 2;  // 船の中央に頭を載せる
// 壺に乗っているあいだは、顔をこのぶんだけ壺へ埋める
const HEAD_SINK = 8;
// UFO のまわりを回るガード(壊せる)
// ボス全体を丸く囲む大きさで回す
const GUARD_COUNT = 8, GUARD_HP = 40, GUARD_R = 60, GUARD_SPEED = 0.05;
const GUARD_R_TIGHT = 28;   // レーザー発射中は顔のまわりに縮こまる
const GUARD_FLAT = 0.4;     // 軌道は縦に縮んだ楕円
// レーザーは船の中央から出る。当たり判定は 16 ドット、見た目は 12 ドット。
const LASER_W = 16;                       // 当たり判定の幅
const LASER_DRAW_W = 12;                  // 見た目の幅
const LASER_X = (BOSS_W - LASER_W) / 2;   // 船の左端からの位置(中央)
const LASER_DRAW_X = (BOSS_W - LASER_DRAW_W) / 2;
// エンジンが BG スプライトを置くときと同じ式にそろえる。
// (片方が切り捨てだけだと 8 ドットずれて、重ねた目や王冠が外れる)
const snap8 = v => Math.floor(Math.round(v) / 8) * 8;

/**
 * ボス戦を終えて layer3 を背景プレーンに戻す。
 * 背景オブジェクトはここでは描かない(次のステージが始まるときにまとめて描く)。
 */
function endBossMode() {
  bossMode = false;
  // ラスボスで暗い赤に染めた空間を、ふつうの宇宙(黒 + 星)へ戻す
  restoreSpace();
  clearKingBeams();
  clearFarBeams();
  clearKingEscape();
  neb.clear();
  neb.visible = true;
  neb.scroll(0, neb.scrollY);
}

// ---- ボス登場の演出 ----
// ★がそろってすぐ戦闘に入らず、
//   敵を出さずにスクロールだけ続ける -> BGM フェードアウト -> ボス名の紹介 -> ボス BGM
// という流れを挟む。
// 4〜6 面はまだ作っていないので、仮のボス「未実装君」を置いてある
const BOSS_NAMES = [
  'KING OCTOPOT', 'KING FOSSIL', 'KING OARFISH', 'KING NAUTILUS',
  'THE KING', 'KING BIO STRONG', 'KING ODIOUS TRIDENT',
];
// 背景オブジェクトがスクロールで画面外へ流れ去るまで待つ長さ
const INTRO_QUIET_LEN = 400;  // 敵を出さずに進む時間
const INTRO_NAME_LEN = 180;   // 名前を出している時間
let bossIntro = 0;            // 演出の残りフレーム(0 = 演出していない)

/** その面でボス戦に必要な★の数(面が進むごとに増え、最大 6) */
function starsNeeded() {
  const max = isNormal() ? 5 : 8;   // NORMAL は 5 個そろえばボス戦
  return Math.min(max, STAGE.starsForBoss + stageNo - 1);
}

function startBossIntro() {
  // 予告のあいだは道中のレーザーを止める。
  // レーザーの音はショットより強くしてあるので、鳴りつづけると
  // 警告の音と重なって、そこだけ音が大きくなってしまう
  clearFarBeams();
  // ボスラッシュはすでにボス戦の曲が鳴っているので、短い予告だけ出す
  if (gameMode() === 'bossrush') {
    // +1 しているのは、次のフレームの updateBossIntro で 1 減ったあとに
    // ちょうど「名前を出す瞬間」に当たるようにするため
    bossIntro = INTRO_NAME_LEN + 1;
    return;
  }
  bossIntro = INTRO_QUIET_LEN + INTRO_NAME_LEN;
  // 背景はここで消さず、スクロールで流れ去るのを待つ。
  // BGM はその間ずっとフェードアウトしていく。
  // currentBGM は鳴らしたままにしておく(null にすると updateBGM が
  // 「曲が変わった」と見なして鳴らし直してしまうため)
  mmsxx.audio.fadeOutBGM(INTRO_QUIET_LEN / 60);
}

function updateBossIntro() {
  bossIntro--;
  // 名前の表示に切り替わる瞬間
  if (bossIntro === INTRO_NAME_LEN) {
    // 名前を出すあいだは BGM を完全に止めて静かにする
    // (ボスラッシュは曲を止めない)。
    // 背景オブジェクトはここまでのスクロールで画面外へ流れているので、
    // このタイミングで裏画面を消して星だけにする
    if (gameMode() !== 'bossrush') { mmsxx.audio.stopBGM(); currentBGM = null; }
    neb.clear();
    const name = bossName();
    hud.print(centerX('WARNING!!'), 72, 'WARNING!!', 8);
    hud.print(centerX(name), 96, name, 11);
  }
  // 「WARNING!!」を点滅させる
  if (bossIntro < INTRO_NAME_LEN && bossIntro % 24 === 0) {
    const on = (bossIntro / 24) % 2 === 0;
    if (on) hud.print(centerX('WARNING!!'), 72, 'WARNING!!', 8);
    else hud.fill(0, centerX('WARNING!!'), 72, 9 * 8, 8);
  }
  if (bossIntro <= 0) {
    const name = bossName();
    hud.fill(0, 0, 72, VW, 8);
    hud.fill(0, 0, 96, VW, 8);
    void name;
    spawnBoss();
  }
}

// 面ごとのボスの種類。2 面はカニロボ、それ以外はタコ。
/** その面のボス名(裏技で選ぶ特別な相手も含む) */
function bossName() {
  if (stageNo === RUSH_EYES) return 'TWIN EYES';
  if (stageNo === RUSH_MOAI) return 'BIG MOAI';
  if (stageNo === RUSH_TODO) return 'Mr. MIJISSOU';
  return BOSS_NAMES[(stageNo - 1) % BOSS_NAMES.length];
}

function bossKind() {
  if (stageNo === RUSH_EYES) return 'eyes';
  if (stageNo === RUSH_MOAI) return 'moai';
  if (stageNo === RUSH_TODO) return 'todo';   // 仮ボス(本編には出てこない)
  const i = (stageNo - 1) % BOSS_NAMES.length;
  if (i === 1) return 'crab';
  if (i === 2) return 'dragon';
  if (i === 3) return 'nautilus';
  if (i === 4) return 'king';              // 5 面はラスボス「ざ・きんぐ」
  return 'octopus';
}

// ---- カニロボ(2 面ボス) ----
// 画面の左右どちらかにくっついてハサミミサイルを撃ち、
// しばらくすると攻撃をやめて画面上部を左右に跳ねて移動する。
// 装甲(甲羅)がはがれるとひっくり返り、泡を吹くだけになる。
const CRAB_W = 64, CRAB_H = 96;   // 横向き(壁に張り付いた姿)の大きさ
// ダメージが通ったときに甲羅を白く飛ばすための色の入れ替え
const CRAB_HURT_MAP = { 2: 15, 3: 15, 4: 15, 5: 15, 6: 15, 7: 15, 8: 15,
  9: 15, 10: 15, 11: 15, 12: 15, 13: 15, 14: 15 };
const CRAB_CLAWS = 2;             // ハサミは 2 本。撃ち尽くすと反対側へ跳ぶ
// 脚が本当の弱点。ジャンプ中だけ壁から離れて狙える
const CRAB_LEGS = 4;              // 脚の本数
const CRAB_LEG_HP = 24;           // 脚 1 本の耐久力
const CRAB_LEG_Y = [16, 34, 52, 70];  // 本体の上端からの脚の位置(甲羅の広い所)
const CRAB_CLAW_HP = 60;          // ハサミはとても硬い(壊すのは大仕事)
const CRAB_CLAW_GROW = 180;       // ハサミが生えそろうまで(3 段階で伸びる)
// 壁に張り付いたまま何もできずにいる時間の上限。
// これを過ぎたら画面の上下どちらかへ消えて、反対の壁から出直す
const CRAB_WALL_LIMIT = 420;
// 装甲に付いている装置の位置(壁が左のときの本体左上からの位置)
// 目(黒い穴。本体の x32-44 / y36-64)にかからない場所に置く
const CRAB_POD_POS = [[13, 10], [13, 44], [13, 76]];
// ハサミは 64x48 と大きい。本体(64x96)の前に上下 2 本並べる
const CRAB_CLAW_W = 64, CRAB_CLAW_H = 48;
const CRAB_CLAW_Y = [0, 48];      // 本体の上端からのハサミの位置
// 上下の動ける範囲。下は画面からはみ出すところまで(下に隠れても安全ではない)
const CRAB_TOP = 24, CRAB_BOTTOM = SCREEN_H - 40;
// 斜めにした第2形態の絵は、もとの絵より左右に 24 ドットずつ広い
const CRAB_TILT_PAD = 24;
let clawMissiles = [];

/**
 * ボスがその局面のどれかか。**局面を持たないボスなら常に false**。
 * ボスの種類を見ずに局面だけ読むところで使う
 */
const bossIs = (b, ...names) => !!(b && b.fsm && b.fsm.in(...names));

/** 生えかけのハサミを伸ばし、生えそろっている本数を数え直す */
function growCrabClaws(b) {
  for (let i = 0; i < CRAB_CLAWS; i++) {
    if (b.grow[i] < CRAB_CLAW_GROW) b.grow[i]++;
  }
  b.claws = b.grow.filter((g, i) => g >= CRAB_CLAW_GROW && b.clawAlive[i]).length;
}

/** 壁に張り付く x。左右どちらの壁にいるかで決まる */
const crabWallX = (b) => (b.side < 0 ? 0 : SCREEN_W - CRAB_W);

/**
 * **カニロボの局面。**動きと移り先はここだけに書く。
 * 当たり判定や攻撃の側は `b.fsm.is(...)` を見るだけにして、
 * `mode` の組み合わせを読み解かなくて済むようにする。
 *
 *   enter -> attach <-> jump
 *              |
 *              v
 *   wait  <-  exit  -> (2 秒待って) enter
 *
 * ハサミを撃ち尽くしたときの attach -> jump / exit は、飛んでいるハサミが
 * 消えるのを待つなど**攻撃の都合**で決まるので、攻撃の側から `go()` で移す。
 */
const CRAB_STATES = {
  // 登場は必ず画面の上から、ゆっくり降りてくる(狙いを付けやすいように)。
  // 降りてくる途中でもハサミは伸ばし続ける
  enter: {
    update: (b) => { b.x = crabWallX(b); b.y += 1.0; growCrabClaws(b); },
    when: (b) => b.y >= CRAB_TOP,
    next: 'attach',
    exit: (b) => { b.y = CRAB_TOP; b.vy = Math.abs(b.vy); b.wallTimer = 0; },
  },
  // 壁を足場にして上下に動きつづける(自機の位置では止まらない)。
  // ハサミはまっすぐ横に飛ぶので、たまたま高さが合った瞬間だけ撃ってくる
  attach: {
    update: (b) => {
      growCrabClaws(b);
      b.x = crabWallX(b);
      b.y += b.vy;
      if (b.y <= CRAB_TOP) { b.y = CRAB_TOP; b.vy = Math.abs(b.vy); }
      if (b.y >= CRAB_BOTTOM) { b.y = CRAB_BOTTOM; b.vy = -Math.abs(b.vy); }
    },
  },
  // 反対の壁へ跳んで移動する(このあいだは攻撃しない)。
  // まず画面の上まで一気に上がってから山なりに渡るので、
  // 伸びた脚をじっくり狙える
  jump: {
    viaGo: true,   // ハサミを撃ち尽くしたときに攻撃の側から
    update: (b) => {
      b.jumpT = Math.min(1, b.jumpT + 0.006);   // ゆっくり渡る
      const t = b.jumpT;
      b.x = b.jumpFrom + (b.jumpTo - b.jumpFrom) * t;
      const rise = Math.min(1, t * 4);
      const top = CRAB_TOP - 16;   // 画面のいちばん上あたりを大きく回る
      b.y = b.jumpY + (top - b.jumpY) * rise - Math.sin(t * Math.PI) * 12;
    },
    when: (b) => b.jumpT >= 1,
    next: 'attach',
    // ここで描き直すと、脚が 1 つ前のコマの位置のまま描かれて
    // 体から離れて見えていた。呼び出し元でまとめて描くので、ここでは描かない
    exit: (b) => {
      b.fireTimer = 90;
      b.y = Math.max(CRAB_TOP, Math.min(CRAB_BOTTOM, b.y));
    },
  },
  // 退場は必ず上へ、すばやく抜けていく
  exit: {
    viaGo: true,   // 壁で粘りすぎたときに攻撃の側から
    update: (b) => { b.x = crabWallX(b); b.y -= 5.0; },
    when: (b) => b.y < -CRAB_H - 8,
    next: 'wait',
  },
  // 画面の外で待っている(次にどちらの壁から来るかを読ませる間)。
  // 反対の壁へ回り込んでから 2 秒おいて、また上に現れる
  wait: {
    enter: (b) => { b.side = -b.side; },
    update: (b) => { b.x = crabWallX(b); b.y = -CRAB_H - 8; },
    for: 120,
    next: 'enter',
  },
  // 脚を失うと壁につかまれない。画面の真ん中あたりでふわふわ漂うだけになる
  float: {
    viaGo: true,   // 甲羅が割れたとき。**どの局面からでも起きる**
    update: (b) => {
      const tx = (SCREEN_W - CRAB_W) / 2 + Math.sin(b.age * 0.012) * 56;
      b.x += (tx - b.x) * 0.02;
      b.y += b.vy * 0.4;
      if (b.y <= CRAB_TOP) { b.y = CRAB_TOP; b.vy = Math.abs(b.vy); }
      if (b.y >= CRAB_BOTTOM) { b.y = CRAB_BOTTOM; b.vy = -Math.abs(b.vy); }
    },
  },
};

function spawnCrabBoss() {
  const hp = 40 + stageNo * 16;
  // 目はタコと同じ水色 1 色。自機のいる方へ少し寄る
  const eyeL = mmsxx.sprite(SPRITE_SYMBOLS.bossEye2);
  const eyeR = mmsxx.sprite(SPRITE_SYMBOLS.bossEye2);
  eyeL.priority = eyeR.priority = 13;
  boss = {
    kind: 'crab',
    x: 0, y: -40, hp, max: hp, age: 0, flash: 0, dying: 0,
    eyeL, eyeR, charge: null,
    phase2: false,          // 甲羅がはがれてひっくり返った状態
    side: rndBoss() < 0.5 ? -1 : 1,  // -1 = 左の壁, 1 = 右の壁
    claws: CRAB_CLAWS, clawStock: CRAB_CLAWS, vy: 0.8,
    // ハサミ 1 本ずつの生き死に。**本数だけで管理していたため**、
    // 下のハサミを壊しても「最後の 1 本」が消え、壊したはずの位置から
    // 撃ってくることがあった
    clawAlive: Array(CRAB_CLAWS).fill(true),
    grow: [CRAB_CLAW_GROW, CRAB_CLAW_GROW],   // ハサミの生え具合
    clawHp: [CRAB_CLAW_HP, CRAB_CLAW_HP],     // 本体に付いたハサミの耐久力
    jumpFrom: 0, jumpTo: 0, jumpT: 0,
    fireTimer: 40,   // 1 発目は早めに撃つ
  };
  boss.partBody = bossPart(BG_SYMBOLS.crabR);
  // 脚。ジャンプ中に壁から離れて伸び、そこだけが狙える弱点になる
  // 脚は BG スプライト。甲羅(priority 1)より奥に置くので、
  // めり込んだ付け根は胴に隠れて見える
  boss.legs = CRAB_LEG_Y.map((ly, i) => ({
    sp: bossPart(BG_SYMBOLS.crabLeg, 0), hp: CRAB_LEG_HP, y: ly, flipY: i >= CRAB_LEGS / 2,
  }));
  boss.partClaws = [bossPart(BG_SYMBOLS.crabClawBig), bossPart(BG_SYMBOLS.crabClawBig)];
  // 王冠(タコと同じもの)。甲羅のてっぺんに斜めにかぶせる
  boss.crown = mmsxx.sprite(SPRITE_SYMBOLS.octoCrown);
  boss.crown.priority = 12;
  boss.crown.flipX = true;    // カニは反転してかぶる
  // 装甲に取り付いている装置。スプライトなので 8 ドットに縛られず置ける
  boss.pods = CRAB_POD_POS.map((_, i) => {
    const sp = mmsxx.sprite(SPRITE_SYMBOLS.crabPod);
    sp.priority = 9;
    sp.flipX = (i === 1);   // 真ん中のパネルだけ向きを変える
    return sp;
  });
  boss.x = boss.side < 0 ? 0 : SCREEN_W - CRAB_W;
  boss.y = -CRAB_H;        // 画面の上から降りてくる
  boss.fsm = new StateMachine(CRAB_STATES, { start: 'enter', ctx: boss, name: 'カニ' });
  boss.wallTimer = 0;
  drawBossBody();
  playBGM('boss', true);
}

/** ハサミミサイル: ボスの持っているハサミがそのまま飛んでくる。
 *  壊せるが、壊すと弾が散る。反対の壁へ跳ぶとハサミは生え変わる */
function fireClawMissile(x, y, flipX = false, from = -1) {
  // 本体に付いていたのと同じ絵を、多色のまま飛ばす(BG スプライト)
  const sp = mmsxx.bgSprite(BG_SYMBOLS.crabClawBig);
  sp.x = x; sp.y = y; sp.priority = BGP_FRONT + 4; sp.flipX = flipX;
  // 壁と反対側へ、まっすぐ横に飛んでいく
  const out = flipX ? -1 : 1;
  // お尻(飛んでいく向きと反対側)に噴射をつける
  const jet = mmsxx.sprite(SPRITE_SYMBOLS.flameBig);
  jet.priority = 8;
  jet.rotate = out > 0 ? 90 : 270;   // 下向きの炎を横向きにする
  clawMissiles.push({ sp, vx: out * 2.4, vy: 0, hp: CRAB_CLAW_HP, jet, out, from });
  mmsxx.audio.playSE('shot', SE_HIT);
}

/** ハサミを 1 本もぐ。位置(i)で覚え、本数はそこから数え直す */
function killCrabClaw(b, i) {
  if (!b || !b.clawAlive) return;
  if (i < 0 || !b.clawAlive[i]) {
    // どの位置か分からないときは、生きているものを 1 本落とす
    i = b.clawAlive.findIndex(Boolean);
    if (i < 0) return;
  }
  b.clawAlive[i] = false;
  b.grow[i] = 0;
  b.clawStock = b.clawAlive.filter(Boolean).length;
  b.claws = b.grow.filter((g, n) => g >= CRAB_CLAW_GROW && b.clawAlive[n]).length;
}

function removeClawMissile(m, scatter) {
  mmsxx.removeBgSprite(m.sp);
  if (m.jet) mmsxx.removeSprite(m.jet);
  clawMissiles.splice(clawMissiles.indexOf(m), 1);
  if (!scatter) return;
  // 壊すと大爆発。破片(弾)が飛び散るので、壊したあとも油断できない
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8 + Math.random() * 0.3;
    fireEnemyBullet(m.sp.x + CRAB_CLAW_W / 2 - 8, m.sp.y + CRAB_CLAW_H / 2 - 8,
      Math.cos(a) * 1.4, Math.sin(a) * 1.4, false);
  }
  for (let i = 0; i < 6; i++) {
    spawnBoom(m.sp.x + Math.random() * CRAB_CLAW_W, m.sp.y + Math.random() * CRAB_CLAW_H);
  }
  flashTimer = 3;
  mmsxx.audio.playSE('bigboom', SE_HIT);
}

function clearClawMissiles() {
  for (const m of clawMissiles) {
    mmsxx.removeBgSprite(m.sp);
    if (m.jet) mmsxx.removeSprite(m.jet);
  }
  clawMissiles = [];
}

function updateClawMissiles() {
  for (const m of [...clawMissiles]) {
    m.sp.x += m.vx; m.sp.y += m.vy;
    if (m.jet) {
      // 噴射はハサミのお尻。1 コマおきに大きさを変えてゆらめかせる
      m.jet.image = (mmsxx.frame & 3) < 2 ? SPRITE_SYMBOLS.flameBig : SPRITE_SYMBOLS.flameSmall;
      m.jet.x = m.out > 0 ? m.sp.x - 12 : m.sp.x + CRAB_CLAW_W - 4;
      m.jet.y = m.sp.y + CRAB_CLAW_H / 2 - 8;
    }
    if (m.sp.y > SCREEN_H + 48 || m.sp.x < -64 || m.sp.x > SCREEN_W + 64) {
      removeClawMissile(m, false);
    }
  }
}

function updateCrabBoss(b) {
  // 動きと移り先は CRAB_STATES に書いてある。ここは 1 コマ進めるだけ
  b.fsm.step(b);

  // 自機と高さが合っているか。壁にいるときだけでなく、
  // 降りてくる途中(登場中)でも見る = 高さが合えば撃ってくる
  {
    const i = Math.max(0, b.grow.findIndex((g, n) => g >= CRAB_CLAW_GROW && b.clawAlive[n]));
    const aimY = player.y + 8 - CRAB_CLAW_Y[i] - CRAB_CLAW_H / 2;
    b.aimed = Math.abs(aimY - b.y) < 14;
  }

  // BG スプライトは 8 ドット単位に丸められるので、
  // 当たり判定などに使う画面座標もそろえておく
  b.sx = snap8(b.x); b.sy = snap8(b.y);
  drawBossBody();
  if (b.crown) {
    b.crown.visible = bossVisible;
    // 壁を移ったら王冠も向きを合わせて反転させる。
    // 王冠の絵は 32 ドット枠の左寄せ(中身は x0..20)。
    // 反転すると中身が枠の中で 11 ドット右へ動くので、そのぶんを引く。
    //   左: 中身が甲羅の +18..+38(まん中 28)
    //   右: その左右反転なので +26..+46。置き場所は 26 - 11 = 15
    b.crown.flipX = b.side > 0;
    b.crown.x = b.sx + (b.side < 0 ? 18 : 15);
    b.crown.y = b.sy - 4;
  }
  // 甲羅に開いた 2 つの穴に、タコと同じ目を入れる
  if (b.eyeL) {
    // 絵は左右で反転するので、目の穴の位置も左右対称になる。
    // 反転したときの位置 = 幅 - もとの位置 - 目の大きさ(16)
    const right = b.side >= 0;
    const ex = right ? b.sx + CRAB_W - 46 : b.sx + 30;
    const ey = b.sy - 2;
    b.eyeL.visible = b.eyeR.visible = bossVisible;
    b.eyeL.x = ex; b.eyeL.y = ey + 36;
    b.eyeR.x = ex; b.eyeR.y = ey + 52;
    lookEye(b.eyeL, b.eyeL.x + 8, b.eyeL.y + 8);
    lookEye(b.eyeR, b.eyeR.x + 8, b.eyeR.y + 8);
  }
  // 装甲に取り付いている装置(3 つ)。スプライトなので 8 ドットに縛られず置ける。
  // パネルとタンクは脚寄り(壁側)、レーダー皿だけ前寄りに置く
  (b.pods || []).forEach((sp, i) => {
    const [dx, dy] = CRAB_POD_POS[i];
    sp.visible = bossVisible && !b.phase2;
    sp.flipX = (i === 1) !== (b.side > 0);
    sp.x = b.side < 0 ? b.sx + dx : b.sx + CRAB_W - 16 - dx;
    sp.y = b.sy + dy;
  });

  if (state !== 'play') return;

  if (b.phase2) {
    // ひっくり返ったあとは泡(1 面のリング弾の色違い)を吹き続けるだけ
    if (b.age % 18 === 0) {
      const dir = b.side < 0 ? 1 : -1;   // 壁と反対側へ吹き出す
      const a = (rndBoss() - 0.5) * 1.4;
      fireEnemyBullet(b.sx + (dir > 0 ? CRAB_W - 8 : -8), b.sy + CRAB_H / 2,
        Math.cos(a) * 0.7 * dir, Math.sin(a) * 0.7, true);
    }
    return;
  }
  // ハサミを撃ち落とされて武器が無くなったら、泡を吹くだけになる
  if (b.clawStock <= 0) {
    if (b.age % 20 === 0) {
      const dir = b.side < 0 ? 1 : -1;
      const a = (rndBoss() - 0.5) * 1.4;
      fireEnemyBullet(b.sx + (dir > 0 ? CRAB_W - 8 : -8), b.sy + CRAB_H / 2,
        Math.cos(a) * 0.7 * dir, Math.sin(a) * 0.7, true);
    }
  }
  // 壁にいるあいだ、ハサミが残っていれば撃つ。2 本撃ち尽くしたら跳んで移動する
  // 壁に付いているときだけでなく、降りてくる途中でも撃つ
  if (b.fsm.in('attach', 'enter') &&
      b.claws > 0 && --b.fireTimer <= 0 && b.aimed) {
    b.fireTimer = Math.max(70, 150 - shotLevel * 12);
    // 前面に付いているハサミを、そのまま自機めがけて飛ばす。
    // 本数から場所を逆算すると、壊したハサミの位置から飛んでしまう
    const i = b.grow.findIndex((g, n) => g >= CRAB_CLAW_GROW && b.clawAlive[n]);
    if (i < 0) return;
    const front = b.side < 0;
    fireClawMissile(front ? b.sx + CRAB_W - 32 : b.sx - (CRAB_CLAW_W - 32),
      b.sy + CRAB_CLAW_Y[i], !front, i);
    b.grow[i] = 0;      // 撃ったぶんはまた生えはじめる
    b.claws--;
    b.fired = (b.fired || 0) + 1;
    // 生えそろっているハサミが無くなったら、次は跳んで壁を移る。
    // ただし最初の 1 回だけは、1 発撃ったらすぐ跳ぶ(早めに脚を狙わせる)
    if (b.claws <= 0 || b.fired === 1) b.needJump = true;
  }
  // ハサミを撃ち尽くし、飛ばしたハサミが画面から消えてから反対の壁へ跳ぶ
  // (武器が無くなったあとも、脚を狙わせるために跳び続ける)
  if (b.clawStock <= 0 && b.fsm.is('attach')) { b.fireTimer--; b.needJump = true; }
  // どちらに移るかの決まり:
  //   ハサミを撃ち尽くした -> 反対の壁へジャンプ(脚が伸びて狙える)
  //   撃つ用が無いまま 7 秒粘った -> 画面の上へ抜けて出直す
  // ジャンプのほうを先に見るので、撃ち尽くしていれば必ず跳ぶ。
  //
  // **飛んでいるハサミが消えるのを待つ**ので、ここだけは局面の宣言では決められない。
  // 攻撃の都合で移るぶんは go() で移す(CRAB_STATES の viaGo)
  ++b.wallTimer;
  if (b.fsm.is('attach') && !b.needJump && b.wallTimer > CRAB_WALL_LIMIT &&
      clawMissiles.length === 0) {
    b.fsm.go('exit', b);
  }
  if (b.fsm.is('attach') && b.needJump && clawMissiles.length === 0 &&
      (b.clawStock > 0 || b.fireTimer <= 0)) {
    b.needJump = false;
    // はじめて跳ぶときだけ、狙いどころを教える
    if (!b.toldLegs) {
      b.toldLegs = true;
      showNotice('BREAK THE LEGS!');
    }
    b.jumpT = 0;
    b.jumpFrom = b.x;
    b.jumpY = b.y;
    b.jumpTo = b.side < 0 ? SCREEN_W - CRAB_W : 0;
    b.side = -b.side;
    b.fsm.go('jump', b);
  }
}


// ---- 4 面ボス「KING NAUTILUS」----
// 回る装甲ギアの輪の中に、オウムガイ型の生き物がこもっている。
// 装甲は 1 か所だけ作りが違い(ボルトが抜けて配線がむき出し)、そこだけ壊せる。
// 壊すと輪にすき間が空き、そこから中へ入り込めば、無防備な生き物を直接叩ける。
const NAUT_BLOCKS = 18;        // 装甲ブロックの数(すき間を小さく)
const NAUT_R = 52;             // 輪の半径(ふだん)
const NAUT_R_WIDE = 80;        // ときどき大きく広がるときの半径
const NAUT_CORE = 48;          // 生き物の大きさ
const NAUT_WEAK_HITS = 12;     // 弱点の装甲は「装備によらず 12 発」で壊れる
const NAUT_CORE_HP = 70;       // 中の生き物(弱い)
const NAUT_SPIN = 0.011;

/**
 * **KING NAUTILUS の局面。**
 *
 *   arrive -> guard -> core
 *
 * もとは `arrived` と `phase2` の**旗 2 つの組み合わせ**で 3 とおりを表していた。
 * (「y < 40 なら降りてくる」で見ていたころは、下の段へ動いたとたんに
 *  また登場中とみなされて、上下を行ったり来たりしていた)
 */
/** 横の揺れと輪の回転。**装甲があるあいだは降下中も動く** */
function nautSway(b) {
  b.x = (SCREEN_W - NAUT_CORE) / 2 + Math.sin(b.age * 0.008) * 40;
  b.spin += NAUT_SPIN;
  b.orbSpin += NAUT_SPIN * 3;
}

const NAUT_STATES = {
  // 登場: ゆっくり降りてきて、画面の上のほうに居座る。
  // **降りている途中も横に揺れて輪は回る**(装甲がある限り)
  arrive: {
    update: (b) => { b.y += 0.6; nautSway(b); },
    when: (b) => b.y >= 40,
    next: 'guard',
    exit: (b) => { b.y = 40; },
  },
  // 装甲の輪をまとっているあいだ。輪が回り、電撃を撒く
  guard: {
    update: (b) => {
      // BG スプライトは 8 ドット刻みでしか置けないので、なめらかに上下させると
      // 境目を行き来するたびにガタついて暴れて見える。
      // **行き先そのものを 8 ドット刻み**にして、1 段ごとに間を置く
      const HOLD = 100;                                   // 1 段に留まるコマ数
      const n = Math.floor(b.age / HOLD) % 4;             // 0,1,2,3
      b.y = 32 + (n === 3 ? 1 : n) * 8;                   // 32 -> 40 -> 48 -> 40
      nautSway(b);
    },
  },
  // 装甲が外れたあと。**オウムガイは動かない**(狙いやすくする)。
  // 輪の回転も電撃も止まる
  core: { viaGo: true },
};

function spawnNautilusBoss() {
  const blocks = [];
  const weakAt = Math.floor(rndBoss() * NAUT_BLOCKS);
  for (let i = 0; i < NAUT_BLOCKS; i++) {
    const sp = mmsxx.bgSprite(i === weakAt ? BG_SYMBOLS.gearWeak0 : BG_SYMBOLS.gearBlock);
    sp.priority = BGP_FRONT + 2;
    // 壊れない装甲はスプライトを使わず BG だけでしのぐ
    blocks.push({
      sp, angle: (Math.PI * 2 * i) / NAUT_BLOCKS, weak: i === weakAt, alive: true,
    });
  }
  // 装甲とは別に、同じ半径をぐるぐる回るだけの光(飾り)。
  // 当たり判定は無い。装甲は 8 ドット刻みでガタつくので、
  // なめらかに回るこの光で「ここはスプライト」だと見せる。
  // 数は装甲の半分、速さは 3 倍。
  const orbs = [];
  for (let i = 0; i < NAUT_BLOCKS / 2; i++) {
    const sp = mmsxx.sprite(SPRITE_SYMBOLS.gearGem);
    sp.priority = 14;
    // 2 コマで形が変わる稲妻。1 つおきに位相をずらす
    sp.frames = [SPRITE_SYMBOLS.gearGem, BG_SYMBOLS.gearSpark1];
    sp.frameRate = 2;
    sp.framePhase = i;
    // 2 コマおきの明滅(出たり消えたり)で、電気が走っている感じにする
    sp.blink = 2;
    sp.blinkPhase = i & 1;
    orbs.push({ sp, angle: (Math.PI * 2 * i) / (NAUT_BLOCKS / 2) });
  }
  const core = mmsxx.bgSprite(BG_SYMBOLS.nautilus);
  core.priority = BGP_FRONT + 1;
  // ほかのボスと同じ水色の目を、殻に開けた穴へ重ねる
  const eyeL = mmsxx.sprite(SPRITE_SYMBOLS.bossEye2);
  eyeL.priority = 13;
  // 王冠(ほかのボスと同じもの)。渦巻きのてっぺんに斜めにかぶせる
  const crown = mmsxx.sprite(SPRITE_SYMBOLS.octoCrown);
  crown.priority = 15;
  boss = {
    kind: 'nautilus',
    x: (SCREEN_W - NAUT_CORE) / 2, y: -NAUT_CORE,
    hp: NAUT_CORE_HP, max: NAUT_CORE_HP,
    weakHp: NAUT_WEAK_HITS,   // 壊せる装甲の残り(本体の体力とは別)
    age: 0, flash: 0, dying: 0, phase2: false,
    eyeL, eyeR: null, crown, charge: null,
    blocks, orbs, core, spin: 0, orbSpin: 0, fire: 90,
    ringR: NAUT_R, ringTimer: 300,
  };
  boss.fsm = new StateMachine(NAUT_STATES, { start: 'arrive', ctx: boss, name: '貝' });
  drawBossBody();
  playBGM('boss', true);
}

function clearNautilus(b) {
  if (!b || b.kind !== 'nautilus') return;
  for (const g of b.blocks || []) mmsxx.removeBgSprite(g.sp);
  for (const o of b.orbs || []) mmsxx.removeSprite(o.sp);
  if (b.core) mmsxx.removeBgSprite(b.core);
  b.blocks = [];
  b.core = null;
}

/** 自機が輪の内側に入り込んでいるか(そこでだけ生き物を叩ける) */
function nautilusInside(b) {
  const cx = b.x + NAUT_CORE / 2, cy = b.y + NAUT_CORE / 2;
  const dx = player.x + 8 - cx, dy = player.y + 8 - cy;
  return Math.sqrt(dx * dx + dy * dy) < b.ringR - 10;
}

function updateNautilusBoss(b) {
  // 動きと移り先は NAUT_STATES に書いてある
  b.fsm.step(b);
  // ときどき輪が大きく広がって、また元に戻る
  if (--b.ringTimer <= 0) {
    const wide = b.ringTarget === NAUT_R_WIDE;
    b.ringTarget = wide ? NAUT_R : NAUT_R_WIDE;
    b.ringTimer = wide ? 300 + Math.floor(rndBoss() * 180) : 180;
  }
  b.ringR += ((b.ringTarget || NAUT_R) - b.ringR) * 0.03;
  b.sx = snap8(b.x); b.sy = snap8(b.y);
  drawBossBody();

  if (state !== 'play') return;
  const cx = b.x + NAUT_CORE / 2, cy = b.y + NAUT_CORE / 2;
  if (--b.fire <= 0) {
    if (b.phase2) {
      // 生き物の攻撃はゆっくりした弾。ただし数は多めに撒く
      b.fire = 45;
      const base = Math.atan2(player.y + 8 - cy, player.x + 8 - cx);
      for (let i = -1; i <= 1; i++) {
        const a = base + i * 0.35;
        fireEnemyBullet(cx - 8, cy - 8, Math.cos(a) * 0.7, Math.sin(a) * 0.7, true);
      }
    } else {
      // 装甲ブロックが弾をばらまく
      b.fire = Math.max(40, 80 - shotLevel * 5);
      const alive = b.blocks.filter(x => x.alive);
      for (let i = 0; i < 3 && alive.length; i++) {
        const g = alive[Math.floor(rndBoss() * alive.length)];
        const gx = g.sp.x + 8, gy = g.sp.y + 8;
        const a = Math.atan2(gy - cy, gx - cx);   // 輪の外へ向かって撃つ
        fireEnemyBullet(gx - 8, gy - 8, Math.cos(a) * 1.2, Math.sin(a) * 1.2, false);
      }
      mmsxx.audio.playSE('shot', SE_HIT);
    }
  }
}

// ---- 宇宙ドラゴン(3 面ボス) ----
// うずまきを描きながら自機へ近づいてくる。顔(中央のセンサー)が弱点で、
// 撃っているとたまに怒り、画面外へ消えてから顔だけ見せて一瞬ためたあと、
// 自機めがけて直線で突っ込んでくる。漂う小惑星へうまく誘導するとぶつけられる。
const DRAGON_W = 48, DRAGON_H = 48;
// 突進中に開いた口へ撃ち込んだときのダメージ。もとは 8 だったが効きすぎたので 8 割
const DRAGON_JAWS_DMG = 6.4;
// ふだん(旋回中)の顔。**それなりに通る**。
// 3 にすると倒すまでの手数が 3 分の 1 になってしまう(公開版は実質これくらい)
const DRAGON_FACE_DMG = 2;
// 顔だけ出して構えているあいだ。**n 発に 1 しか通らない** —
// ここは連射しどきなので、そのままだと倒しきれてしまう
const DRAGON_PEEK_EVERY = 3;
const DRAGON_SEGS = 12;             // 胴体の節の数(すき間ができないよう多め)
const DRAGON_SEG = 24;
const DRAGON_TRAIL = 5;             // 節どうしの間隔(フレーム)
// 顔を見せてためる時間。3・2・1 の声が鳴り終わってから突っ込むよう、
// 声を伸ばしたぶん(1 回 0.8 秒)長くしてある
const RAGE_TELEGRAPH = 200;
const RAGE_HIDE = 60;               // 画面の外へ完全に消えている時間(1 秒)
const RAGE_SPEED = 4.5;
// 出てきてから炎を吐きはじめるまでの間(2 秒)。入ってくる姿を見せる時間
const DRAGON_CALM = 120;

/**
 * 旋回に戻るときの「次に怒るまで」。毎回ちがう。
 * **1 回目だけは決め打ちの 300 コマ**で、乱数を引かない —
 * 出だしを毎回同じにするため(公開版がそうなっている)
 */
function dragonCalmSpan(b) {
  if (!b.spunOnce) { b.spunOnce = true; return 300; }
  return 260 + Math.floor(rndBoss() * 180);
}

/**
 * **宇宙ドラゴンの局面。**
 *
 *   spiral -> leave -> hide -> telegraph -> charge -> rest -> descend -> spiral
 *
 * もとは `mode` が 4 つで、そのうち `rage` の中身を `hide` と `telegraph` の
 * 2 つの数え上げで分けていた。**その組み合わせが当たり判定の側にも写っていて**、
 * 「突っ込んできているあいだ」は 3 か所で `rage && hide<=0 && telegraph<=0` と
 * 書かれていた。開いてしまえば `is('charge')` だけで済む。
 */
const DRAGON_STATES = {
  // うずまきを描きながら、じわじわ動きまわる
  spiral: {
    viaGo: true,   // 小惑星をぶつけられたときに、途中からでも戻される
    for: dragonCalmSpan,
    next: 'leave',
    update: (b) => {
      const cx = SCREEN_W / 2 - DRAGON_W / 2, cy = 44;   // 旋回の中心は画面の奥
      b.spiralA += 0.045;
      b.spiralR = 72 + Math.sin(b.age * 0.01) * 32;
      // 横は画面いっぱいに近いところまで振る(左右の動きを大きく見せる)。
      // 縦はそのままなので、平たい輪を描いて泳ぐ形になる
      const tx = cx + Math.cos(b.spiralA) * b.spiralR * 1.5;
      const ty = cy + Math.sin(b.spiralA * 1.3) * (b.spiralR * 0.38);
      b.x += (tx - b.x) * 0.06;
      b.y += (ty - b.y) * 0.06;
    },
    // その場で消えないよう、まず画面の外まで泳いで抜けていく。
    // 近いほうの上下へ、しっぽまで見えなくなるまで泳いで出る
    exit: (b) => {
      b.leaveDir = (b.y + DRAGON_H / 2 < SCREEN_H / 2) ? -1 : 1;
      mmsxx.audio.playSE('warning');
    },
  },
  // 画面の外へ泳いで抜ける(胴体が全部出きるまで待つ)
  leave: {
    update: (b) => {
      b.y += 3.2 * b.leaveDir;
      b.x += (SCREEN_W / 2 - DRAGON_W / 2 - b.x) * 0.02;
    },
    when: (b) => (b.leaveDir < 0
      ? b.y < -DRAGON_H - DRAGON_SEGS * 8
      : b.y > SCREEN_H + DRAGON_SEGS * 8),
    next: 'hide',
    // 顔を出すのは画面の上か下。左右からは来ない
    exit: (b) => {
      b.side = rndBoss() < 0.5 ? 0 : 1;   // 0 = 上, 1 = 下
      b.x = Math.max(0, Math.min(SCREEN_W - DRAGON_W,
        player.x - 16 + (rndBoss() - 0.5) * 96));
      b.y = b.side === 0 ? -DRAGON_H - 8 : SCREEN_H + 8;
    },
  },
  // 画面の外へ完全に消えている(1 秒)
  hide: {
    for: RAGE_HIDE,
    next: 'telegraph',
    // 顔の先だけを画面に見せる(どこから来るかが分かる)
    exit: (b) => {
      b.y = b.side === 0 ? -DRAGON_H + 22 : SCREEN_H - 22;
      // はじめて構えたときだけ、狙いどころを教える
      if (!b.toldRage) {
        b.toldRage = true;
        showNotice('COUNTER THE CHARGE!');
      }
    },
  },
  // 顔だけ出してためる。**ここは当たり判定なし**(予告の姿なので、
  // いきなりぶつかることがないようにする)
  telegraph: {
    for: RAGE_TELEGRAPH,
    next: 'charge',
    // 「3・2・1」の声。1 回 0.8 秒(48 コマ)なので 50 コマ間隔で置き、
    // 最後の「1」が鳴り終わってから突っ込む
    cues: { 150: 'count3', 100: 'count2', 50: 'count1' },
    // 構えているあいだ、溜めの音を鳴らし続ける(短いかたまりのくり返し)
    update: (b, fsm) => {
      if (fsm.timer % SE_CHUNK === 0) mmsxx.audio.playSE('charging', SE_EVENT + 1);
    },
    exit: (b) => {
      const a = Math.atan2(player.y + 8 - (b.y + DRAGON_H / 2),
                           player.x + 8 - (b.x + DRAGON_W / 2));
      b.rvx = Math.cos(a) * RAGE_SPEED;
      b.rvy = Math.sin(a) * RAGE_SPEED;
      mmsxx.audio.playSE('dragonRoar', SE_EVENT);   // 「ゴギャ――――」と叫んで飛ぶ
    },
  },
  // 怒りの突進。**口を大きく開けているので、頭ぜんぶが弱点**
  charge: {
    update: (b) => { b.x += b.rvx; b.y += b.rvy; },
    when: (b) => (b.x < -DRAGON_W - 40 || b.x > SCREEN_W + 40 ||
                  b.y < -DRAGON_H - 40 || b.y > SCREEN_H + 40),
    next: 'rest',
    exit: (b) => { b.x = SCREEN_W / 2 - DRAGON_W / 2; b.y = -DRAGON_H - 40; },
  },
  // 画面の外で息をひそめる(1.5 秒)
  rest: { for: 90, next: 'descend' },
  // 画面の上からゆっくり降りてきて旋回に戻る
  descend: {
    update: (b) => { b.y += 0.7; },
    when: (b) => b.y >= 24,
    next: 'spiral',
  },
};

function spawnDragonBoss() {
  const hp = 40 + stageNo * 16;
  // 眼窩の奥にタコと同じ水色の目を入れる
  const eyeL = mmsxx.sprite(SPRITE_SYMBOLS.bossEye2);
  const eyeR = mmsxx.sprite(SPRITE_SYMBOLS.bossEye2);
  eyeL.priority = eyeR.priority = 13;
  // 胴体の節は BG スプライトで、頭が通った跡をなぞらせる
  const segs = [];
  for (let i = 0; i < DRAGON_SEGS; i++) {
    // 最後の 1 節だけ、しっぽの形にする
    const sp = mmsxx.bgSprite(i === DRAGON_SEGS - 1 ? BG_SYMBOLS.dragonTail : BG_SYMBOLS.dragonBody);
    sp.priority = BGP_FRONT;
    sp.x = -99; sp.y = -99;
    segs.push(sp);
  }
  boss = {
    kind: 'dragon',
    x: (SCREEN_W - DRAGON_W) / 2, y: -DRAGON_H, hp, max: hp, age: 0, flash: 0, dying: 0,
    eyeL, eyeR, charge: null, phase2: false,
    spiralA: 0, spiralR: 60,
    rvx: 0, rvy: 0,
    trail: [],             // 頭の通った跡
    segs,
  };
  // 頭は胴体の節より手前に置く(顔が埋もれないように)
  // 「3・2・1」の声は宣言(cues)から届く。何コマ目で鳴らすかは局面の側が持つ
  boss.fsm = new StateMachine(DRAGON_STATES, {
    start: 'spiral', ctx: boss, name: '竜',
    on: (cue) => mmsxx.audio.playSE(cue, SE_EVENT + 2),
  });
  boss.partHead = bossPart(BG_SYMBOLS.dragonHead, 1);
  // 王冠(タコ・カニと同じもの)。頭蓋のてっぺんにかぶせる
  boss.crown = mmsxx.sprite(SPRITE_SYMBOLS.octoCrown);
  boss.crown.priority = 12;
  drawBossBody();
  playBGM('boss', true);
}

function clearDragonSegs(b) {
  for (const sp of (b && b.segs) || []) mmsxx.removeBgSprite(sp);
  if (b) b.segs = [];
}

function updateDragonBoss(b) {
  // 動きと移り先は DRAGON_STATES に書いてある。ここは 1 コマ進めるだけ
  b.fsm.step(b);

  // 頭が通った跡を覚えて、胴体の節をそこへ置く
  b.trail.unshift({ x: b.x, y: b.y });
  if (b.trail.length > DRAGON_SEGS * DRAGON_TRAIL + 2) b.trail.pop();
  for (let i = 0; i < b.segs.length; i++) {
    const t = b.trail[(i + 1) * DRAGON_TRAIL];
    if (!t) continue;
    b.segs[i].x = t.x + (DRAGON_W - DRAGON_SEG) / 2;
    b.segs[i].y = t.y + (DRAGON_H - DRAGON_SEG) / 2;
    // 頭は BG レイヤーに描いていて、節(BG スプライト)より必ず奥になる。
    // 頭に重なる節は描かないことで、顔が埋もれないようにする。
    const dx = (b.segs[i].x + DRAGON_SEG / 2) - (b.x + DRAGON_W / 2);
    const dy = (b.segs[i].y + DRAGON_SEG / 2) - (b.y + DRAGON_H / 2);
    const nearHead = (dx * dx + dy * dy) < 26 * 26;
    b.segs[i].visible = bossVisible && !nearHead;
    // 頭から遠い節ほど後ろに描く
    b.segs[i].priority = -i;
  }

  // BG スプライトは 8 ドット単位に丸められるので、
  // 当たり判定などに使う画面座標もそろえておく
  b.sx = snap8(b.x); b.sy = snap8(b.y);

  // 冠と目は、**位置を出し直したあとに**置く。
  // 前は動かす前の座標で置いていたので、頭が速く動くと 1 コマぶん遅れて
  // 目と冠が頭から大きくずれていた
  if (b.crown) {
    b.crown.visible = bossVisible;
    b.crown.x = b.sx + 10; b.crown.y = b.sy - 4;   // 頭蓋のてっぺんに乗せる
  }
  // 眼窩の目。置き場所は動かさず、黒目だけが自機のほうへ寄る
  if (b.eyeL) {
    b.eyeL.visible = b.eyeR.visible = bossVisible;
    // 眼窩の真ん中に合わせる(絵の穴は左 10〜22 / 右 26〜38、目の丸は 4〜11)。
    // **lookEye が最後に 1 ドット左上へずらす**ので、そのぶん足してある
    b.eyeL.x = b.sx + 9; b.eyeL.y = b.sy + 14;
    b.eyeR.x = b.sx + 25; b.eyeR.y = b.sy + 14;
    lookEye(b.eyeL, b.eyeL.x + 8, b.eyeL.y + 8);
    lookEye(b.eyeR, b.eyeR.x + 8, b.eyeR.y + 8);
  }
  drawBossBody();

  if (state !== 'play') return;
  // うずまき中は口を開けて炎を連発する(撃ち落とせない)
  if (b.fsm.is('spiral') && b.age > DRAGON_CALM) {
    // 入ってきたばかりのあいだ(DRAGON_CALM)は吐かない。
    // 泳いで入ってくる姿を落ち着いて見せるため
    const cycle = Math.max(60, 110 - shotLevel * 6);
    const t = (b.age - DRAGON_CALM) % cycle;
    // 炎を吐く 24 フレームのあいだは口を開けたままにする
    b.mouthOpen = (t < 30);
    if (t < 24 && t % 8 === 0) {
      const mx = b.sx + DRAGON_W / 2 - 8, my = b.sy + DRAGON_H - 12;
      const a = Math.atan2(player.y + 8 - my, player.x + 8 - mx)
        + (t / 8 - 1) * 0.16;   // 3 発を少しずつ振って撒く
      const vx = Math.cos(a) * 1.5, vy = Math.sin(a) * 1.5;
      // 炎は「小 -> 中 -> 大」の 3 つを一列に並べて噴射に見せる。
      // 絵は回さない(丸い炎なので向きは要らない)
      // 先頭(大きい黄色) -> 中(赤) -> 後ろ(小さい赤) の 3 連で噴射に見せる
      const JET = [
        [SPRITE_SYMBOLS.fireS0, SPRITE_SYMBOLS.fireS1, 12, 4],
        [SPRITE_SYMBOLS.fireM0, SPRITE_SYMBOLS.fireM1, 6, 2],
        [SPRITE_SYMBOLS.fireBall, SPRITE_SYMBOLS.fireBall1, 0, 0],
      ];
      for (const [img0, img1, back, off] of JET) {
        fireEnemyBullet(mx - Math.cos(a) * back + off, my - Math.sin(a) * back + off,
          vx, vy, false, img0);
        const fb = enemyBullets[enemyBullets.length - 1];
        fb.sp.frames = [img0, img1];
        fb.sp.frameRate = 3;
        fb.sp.framePhase = enemyBullets.length;
      }
      mmsxx.audio.playSE('shot', SE_HIT);
    }
  }
  // 小惑星にぶつかると大ダメージ(うまく誘導すると一気に削れる)
  for (const a of asteroids) {
    if (Math.abs(astCX(a) - (b.sx + DRAGON_W / 2)) < 32 &&
        Math.abs(astCY(a) - (b.sy + DRAGON_H / 2)) < 32) {
      b.hp -= 12;
      b.flash = 8;
      spawnBoom(b.sx + 16, b.sy + 16);
      mmsxx.audio.playSE('bigboom', SE_HIT);
      // 突進の途中でも旋回へ戻す。次に怒るまでの間は取り直し
      b.fsm.go('spiral', b);
      b.fsm.timer = 300;
      break;
    }
  }
}

// ---- 仮のボス「未実装君」(4〜6 面) ----
// 何もしてこない顔。連射だけで壊せる。中身ができたら差し替える。
const TODO_W = 48, TODO_H = 48;
// 未実装さんの体力(どこから出会っても同じ)
const TODO_HP = 1000;

function spawnTodoBoss() {
  // 体力は**面数によらず一定**。
  // 出てくるのは「ボスラッシュ(内部の面 103)」「シーン選択」
  // 「2 回目のコンティニュー(そのときの面)」の 3 とおりで、
  // 面数で決めると 103 面あつかいのときだけ極端に硬くなり、
  // コンティニューのときは紙のように弱くなってしまっていた
  const hp = TODO_HP;
  const eyeL = mmsxx.sprite(SPRITE_SYMBOLS.bossEye);
  const eyeR = mmsxx.sprite(SPRITE_SYMBOLS.bossEye);
  eyeL.visible = eyeR.visible = false;
  boss = {
    kind: 'todo',
    x: (SCREEN_W - TODO_W) / 2, y: -TODO_H, hp, max: hp, age: 0, flash: 0, dying: 0,
    eyeL, eyeR, charge: null, phase2: false,
  };
  boss.fsm = new StateMachine(TODO_STATES, { start: 'arrive', ctx: boss, name: '未実装' });
  boss.partFace = bossPart(BG_SYMBOLS.todoFace);
  boss.crown = mmsxx.sprite(SPRITE_SYMBOLS.crownCyan);   // 顔と色がかぶるので水色
  boss.crown.priority = 15;
  // 撃たれると泣く。涙は左右 1 粒ずつ
  boss.tears = [0, 1].map(() => {
    const sp = mmsxx.sprite(SPRITE_SYMBOLS.tearDrop);
    sp.priority = 16;
    sp.visible = false;
    return { sp, age: -1, x: 0, y: 0, vx: 0, vy: 0 };
  });
  boss.cry = 0;
  // ほおの赤み(赤 + 黒の斜線)と、目の中の反射
  boss.blush = [0, 1].map(() => {
    const sp = mmsxx.sprite(SPRITE_SYMBOLS.todoBlush);
    sp.priority = 14;
    return sp;
  });
  boss.glint = mmsxx.sprite(SPRITE_SYMBOLS.todoGlint);
  boss.glint.priority = 17;
  drawBossBody();
  playBGM('todo', true);   // 仮ボス専用の、力が抜ける曲
}

// ---- 未実装さんの命ごい ----
// 体力が 4 分の 1 を切ると、ふきだしで話しかけてくる。
// そのまま倒すと「ヒドイ」と言って涙の海で爆発。
// しばらく撃たずにいると、裏技のヒントを教えて飴を置いて帰る。
// せりふはカタカナ(内蔵フォントに入れてある)。英訳は下の行に出す
const BEG_AT = 0.5;              // 体力がこれを切ったら話しかけてくる
const BEG_LINES = [
  // ふきだしの中は「・・・」だけ。中身は下の行に英語で出す
  { at: 0,   en: 'DO NOT HURT ME!' },
  { at: 150, en: 'SPARE ME AND I TELL YOU A SECRET' },
  // ここで一度だまる(撃たれるかどうかの間)
  { at: 480, secret: true },              // 教えてくれる中身(下の表から選ぶ)
  { at: 660, en: 'WAS THAT USEFUL?' },    // どれを教えたあとも、これを言う
  { at: 780, en: 'THANKS FOR SPARING ME!' },
];

/**
 * 教えてくれる「いいこと」。
 * **コンティニューで出会ったときは 0 番だけ**(裏技のヒント)。
 * ボスラッシュから入ったときは、この中からその場で 1 つ選ぶ
 */
const BEG_SECRETS = [
  'STAFF ROLL NAMES ARE CHEAT WORDS',
  'THE STAR DRAGON FACE HIDES A SECRET',
  'EAT WHAT YOU HATE WITH WHAT YOU LOVE',
  'GROWN UPS CRY MORE EASILY',
  'SANTA IS NOT REAL',
  'STIR NATTO FIRST THEN ADD SOY SAUCE',
  'YOUR MOM AND DAD WERE STRANGERS ONCE',
  'BLOOD TYPE DOES NOT SHAPE WHO YOU ARE',
];
const BEG_END = 900;             // ここまで話す
// 話し終わったときに体力がこれ以下だと、見逃してもらえない(削りすぎ)
const BEG_SPARE = 0.2;
// 置いていく飴の数。取るたびに倍になる(100 -> 200 -> … -> 51200)。
// 10 個そろえると合わせて 102300 点
const CANDY_COUNT = 10;
// 会話の文章を出す高さ(画面の真ん中)
const BEG_TEXT_Y = 96;
// 飴を置いてから、ボス戦を終わりにするまでの間(11 秒)。
// 四方へ散った飴を拾って回るには、6 秒では足りなかった
const BEG_GIFT_WAIT = 660;
const BEG_HURT = 'THAT IS CRUEL...';   // 倒されたときのひとこと
const BEG_SAD = 'SO SAD...';           // 撃たれ続けて心が折れたとき
// 話しているあいだに何発撃ち込まれたら自爆するか
const BEG_GIVEUP_HITS = 16;

/**
 * ふきだし(決め打ちの絵)を、相手の下に置く。
 * 文字はアセット側で焼いてあるので、ここは絵を 1 枚描くだけ。
 * 8 ドット単位に丸めて置く(BG と同じ刻み)
 */
function drawBubble(cx, y, img) {
  const w = img.width, h = img.height;
  let x = Math.round((cx - w / 2) / 8) * 8;
  x = Math.max(0, Math.min(VW - w, x));
  const top = Math.max(8, Math.round(y / 8) * 8);
  // 相手より手前に出したいので、いちばん上のレイヤーに描く
  dbg.draw(x, top, img, true);
  return { x, y: top, w, h };
}

/** 未実装さんの命ごいを進める。true を返したら、この先の処理は要らない */
/** 未実装さんが話しているあいだかどうか(このあいだは自機を動かせない) */
function todoTalking() {
  return !!(boss && boss.kind === 'todo' && boss.begT !== undefined
    && !boss.begQuit && !boss.begGone && boss.dying <= 0);
}

function updateTodoBeg(b) {
  if (b.begT === undefined) {
    if (b.hp / b.max >= BEG_AT) return false;
    b.begT = 0;
    b.begLine = -1;
    // **コンティニューで出会ったとき(客人)だけ**、裏技のヒント(0 番)で固定。
    // ボスラッシュでもシーン選択でも、教えてくれる中身は毎回変わる
    b.begSecret = b.guest ? 0 : Math.floor(rndBoss() * BEG_SECRETS.length);
    // **飛んでいる自弾を消す**。連射したままだと、話し始めた瞬間に
    // 残っていた弾が当たって、そのまま会話が終わってしまうため
    for (const t of [...bullets]) removeBullet(t);
  }
  // 撃たれてもしゃべり続ける。**倒すか、見逃すか**は遊ぶ人が決める
  if (b.begQuit) { clearBubble(); return false; }
  if (b.begSad) return false;   // 心が折れたあとは進めない
  b.begT++;
  // いまどのせりふか(時間で決める)
  let idx = -1;
  for (let i = 0; i < BEG_LINES.length; i++) if (b.begT >= BEG_LINES[i].at) idx = i;
  // せりふは 3 秒ずつ出す。あいだは黙る
  const line = idx >= 0 ? BEG_LINES[idx] : null;
  if (line && idx !== b.begLine) {
    b.begLine = idx;
    // **次のせりふが来るまで消さない**(読む前に消えてしまうため)。
    // 最後のせりふは、帰り支度が終わるまで出しておく
    const next = BEG_LINES[idx + 1];
    const until = (next ? next.at : BEG_END + 60) - b.begT;
    const text = line.secret ? BEG_SECRETS[b.begSecret || 0] : line.en;
    showNotice(text, Math.max(90, until), BEG_TEXT_Y);
    mmsxx.audio.playSE('clink', SE_HIT);
  }
  // **ふきだしは話しているあいだ出しっぱなし**。
  // 消えるのは、話し終えて帰るときと、撃たれてやめたときだけ
  if (line && !bubbleRect && !b.begGone) {
    // 顔の右横に出す(顔を隠さない位置)。尻尾が顔のほうを指す
    bubbleRect = drawBubble(b.x + TODO_W + 24, b.y + 10, BG_SYMBOLS.talkBubble);
  }
  // 話し終わり。**体力を削りすぎていなければ**、いいことを教えて飴を置いていく。
  // 削ってしまっていたら、そのまま戦いに戻る(見逃したことにはならない)
  if (b.begT >= BEG_END && !b.begGone) {
    if (b.hp / b.max <= BEG_SPARE) {
      b.begQuit = true;
      clearBubble();
      showNotice('...');
      return false;
    }
    b.begGone = true;
    clearBubble();
    // 飴を 8 つ、あちこちへばらまく。山なりに飛んで落ちてくる
    candyLeft = CANDY_COUNT;
    candyCombo = 0;
    // **四方へゆっくり散らす**。円を等分した向きへ、そっと押し出す
    for (let i = 0; i < CANDY_COUNT; i++) {
      const a = (Math.PI * 2 * i) / CANDY_COUNT + Math.random() * 0.2;
      const spd = 0.55 + Math.random() * 0.25;
      dropItem(b.x + TODO_W / 2 - 8, b.y + TODO_H / 2, 'candy',
        { vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, drift: 240 });
    }
    showNotice('IT RAN AWAY');
    mmsxx.audio.playSE('appear', SE_EVENT);
  }
  if (b.begGone) {
    clearBubble();
    // ゆっくり上へ帰っていく。**飴を拾う時間をたっぷり取ってから**
    // ボス戦を終わりにする(すぐ終わるとアイテムが消えてしまう)
    b.y -= 1.1;
    if (b.begT >= BEG_END + BEG_GIFT_WAIT) { escapeTodoBoss(); return true; }
  }
  return false;
}

/** 客人の未実装さんを片づけて、ふつうの面へ戻す */
function clearTodoGuest() {
  clearBubble();
  endBossMode();
  clearBossParts();
  if (boss) {
    if (boss.crown) mmsxx.removeSprite(boss.crown);
    for (const t of boss.tears || []) mmsxx.removeSprite(t.sp);
    for (const sp of boss.blush || []) mmsxx.removeSprite(sp);
    if (boss.glint) mmsxx.removeSprite(boss.glint);
    if (boss.eyeL) mmsxx.removeSprite(boss.eyeL);
    if (boss.eyeR) mmsxx.removeSprite(boss.eyeR);
  }
  boss = null;
  drawBossBar();
  startStage();   // 元の面をはじめから流し直す(ここからがコンティニューの本番)
}

/** 見逃した未実装さんが画面から消えた。倒したことにはしない */
function escapeTodoBoss() {
  // 客人なら面はクリアにせず、そのまま元の面へ戻る
  if (boss && boss.guest) { clearTodoGuest(); return; }
  clearBubble();
  endBossMode();
  clearBossParts();
  if (boss) {
    if (boss.crown) mmsxx.removeSprite(boss.crown);
    for (const t of boss.tears || []) mmsxx.removeSprite(t.sp);
    for (const sp of boss.blush || []) mmsxx.removeSprite(sp);
    if (boss.glint) mmsxx.removeSprite(boss.glint);
    if (boss.eyeL) mmsxx.removeSprite(boss.eyeL);
    if (boss.eyeR) mmsxx.removeSprite(boss.eyeR);
  }
  boss = null;
  clearTimer = 240;
  leaving = true;
  playBGM('fate', false, true);
}

/** 命ごいの最中に倒した。「ヒドイ」と言って、涙の海で爆発する */
function killTodoWhileBegging(b) {
  clearBubble();
  bubbleRect = drawBubble(b.x + TODO_W + 24, b.y + 10, BG_SYMBOLS.talkBubble);
  showNotice(BEG_HURT, 240, BEG_TEXT_Y);
  b.cry = 240;          // 涙を出しつづける
  b.tearBurst = 90;     // 大量の涙をまき散らす
}

/**
 * 話しているのに撃たれ続けた。**心が折れて自爆する**。
 * 倒されたのではなく自分から終わらせるので、せりふも変える
 */
function todoGiveUp(b) {
  b.begSad = true;
  clearBubble();
  bubbleRect = drawBubble(b.x + TODO_W + 24, b.y + 10, BG_SYMBOLS.talkBubble);
  showNotice(BEG_SAD, 300, BEG_TEXT_Y);
  b.cry = 300;
  b.tearBurst = 120;
  b.hp = 0;             // ここで自分から終わる
  b.dying = 90;
  clearChicks(b);   // 気絶のひよこを残さない
  mmsxx.audio.stopBGM();
  currentBGM = null;
  mmsxx.audio.playSE('bossboom', SE_HIT);
}

/**
 * **未実装さんの局面。**
 *
 *   arrive -> drift -> gone
 *
 * 攻撃はしてこないので、これだけ。命ごいの流れ(`begT`)は別の話で、
 * 局面ではなく**演出の順番**なのでここには入れない
 */
const TODO_STATES = {
  // まず定位置まで降りる
  arrive: {
    update: (b) => { b.y += 0.6; },
    when: (b) => b.y >= 40,
    next: 'drift',
    exit: (b) => { b.y = 40; },
  },
  // ふわふわ漂うだけ(動きも控えめ)。
  // **話しているあいだは横に動かない**(ふきだしがふらつくと読みにくい)。
  // 縦にぶるぶるすると落ち着かないので、横にだけゆっくり動く
  drift: {
    update: (b) => {
      b.y = 40;
      if (todoTalking()) return;
      b.x = (SCREEN_W - TODO_W) / 2 + Math.sin(b.age * 0.012) * 24;
    },
  },
  // 命ごいが通って帰っていったあと。位置は演出の側が動かす
  gone: { viaGo: true },
};

function updateTodoBoss(b) {
  // 体力が減ると命ごいを始める。帰ってしまったらここで終わり
  if (updateTodoBeg(b)) return;
  // 動きと移り先は TODO_STATES に書いてある
  if (b.begGone) { if (!b.fsm.is('gone')) b.fsm.go('gone', b); }
  else b.fsm.step(b);
  if (b.cry > 0) b.cry--;
  if (b.tearBurst > 0) b.tearBurst--;
  // 涙は目の下から放物線を描いて画面の下まで落ちる。当たるとクリティカル
  for (const [i, t] of (b.tears || []).entries()) {
    const sp = t.sp || t;   // 昔の形(スプライト直)にも一応対応
    if (t.age === undefined) t.age = -1;
    if (t.age < 0) {
      // 泣いているあいだ、左右でタイミングをずらして粒を出す
      // 「ヒドイ」のあとは、涙の量をぐんと増やす
      const gap = b.tearBurst > 0 ? 6 : 30;
      if (b.cry > 0 && (b.age + i * 15) % gap === 0) {
        t.age = 0;
        // 目は絵の x15-19 と x29-33、下ふちが y27 あたり。
        // 涙の絵は 16x16 で、しずくが真ん中にあるので 8 ずつ引いて合わせる
        t.x = b.x + (i ? 23 : 9);
        t.y = b.y + 20;
        t.vx = (i ? 1 : -1) * (0.6 + Math.random() * 0.5);
        t.vy = -1.2;
      }
      sp.visible = false;
      continue;
    }
    t.age++;
    t.vy += 0.09;          // 重力
    t.x += t.vx; t.y += t.vy;
    sp.visible = bossVisible;
    sp.x = Math.round(t.x); sp.y = Math.round(t.y);
    if (t.y > SCREEN_H + 8 || t.x < -8 || t.x > SCREEN_W + 8) {
      t.age = -1;
      sp.visible = false;
    }
  }
  // BG スプライトは 8 ドット単位に丸められるので、
  // 当たり判定などに使う画面座標もそろえておく
  b.sx = snap8(b.x); b.sy = snap8(b.y);
  drawBossBody();
  b.eyeL.visible = b.eyeR.visible = false;
}

// ---- 最終面ボス「THE KING(ざ・きんぐ)」----
// 第 1 段階: 宇宙の真ん中に赤い裂け目ができ、そこから 360 度へ
//   時間をずらしながら回転レーザーを撃ってくる。256 発当てると裂け目が壊れ、
//   宇宙が暗い赤に染まって、中から真っ黒なシルエットマンが出てくる。
// 第 2 段階以降(パンチ / キック / 波動拳 / 瞬間移動 / 超エネルギーボール)は
//   docs/BOSSES.md 参照。まだ作っていないので、いまは漂うだけの姿で出しておく。
// 裂け目は 32x48。もっと大きく作っていたが、画面を占領しすぎたので半分にした
const RIFT_W = 32, RIFT_H = 48;
const RIFT_X = (SCREEN_W - RIFT_W) / 2;              // 112(8 ドット単位)
const RIFT_Y = 64;                                   // 中心が画面のほぼ真ん中に来る位置
const RIFT_CX = RIFT_X + RIFT_W / 2;                 // 裂け目の中心 = レーザーの出どころ
const RIFT_CY = RIFT_Y + RIFT_H / 2;
const RIFT_HITS = 128;             // 裂け目の耐久(1.5 倍)。強さに関係なく 1 発 2 ダメージ
const RIFT_DAMAGE = 2;
// 回転レーザー。腕ごとに撃つタイミングをずらして、らせん状に広げる
const KING_ARMS = 3;               // 同時に回っている腕の数(120 度ずつ)
const KING_ROT = 0.019;            // 1 フレームの回転量(1 周およそ 5.5 秒)
const KING_FIRE_GAP = 20;          // 1 発を撃つ間隔(フレーム)。多すぎて避けられなかったので半分に
// だらだら撃ち続けると単調なので、撃つ時間と休む時間を交互にしてめりはりを出す
const KING_BURST = 150;            // 撃ち続ける長さ
const KING_REST = 90;              // 休んで、次の連射をためる長さ
const KING_BEAM_SPEED = 2.6;
const KING_BEAM_R0 = 14;           // 裂け目のどのくらい外から出てくるか
// 裂け目が開くまでの演出。細い線から、じわじわ縦へ伸びて広がる
const KING_OPEN_LEN = 150;
const KING_BREAK_LEN = 150;        // 裂け目が壊れてからシルエットが出るまで
const KING_POSE_LEN = 110;         // 決めポーズで構えている時間
const KING_MAN_W = 48, KING_MAN_H = 48;
// 頭以外を撃たれたときの崩し。ガードの姿でいる長さと、そのたびに落ちる速さ。
// 速さがほとんど無くなると、しばらく動けなくなる
const KING_GUARD_LEN = 30;    // 0.5 秒
// 1 発ごとに落ちる割合。すぐ動けなくなりすぎたので 1.5 倍かかるようにした
const KING_SLOW_STEP = 0.047;
const KING_STUN_LEN = 180;    // 3 秒その場で固まる
// 動けなくなる回数は**たくわえ**で持つ。使い切ると、代わりに座って瞑想する。
// 瞑想(回復)のたびに 1 つ戻り、たくわえは最大 2 まで。
// 「回復させるとまたピヨらせられる」という駆け引きになる
const KING_STUN_MAX = 2;
// 瞑想(座禅)。無敵になり、最大体力の半分を取り戻す。1 戦で 4 回まで
const KING_MEDITATE_LEN = 200;
const KING_MEDITATE_MAX = 4;
const KING_MEDITATE_HP = 0.25;   // 体力がこれを切ったら瞑想に入る
// これより下へは降りてこない(画面の上半分にいつづける)
const KING_MAX_Y = SCREEN_H / 2 - KING_MAN_H / 2;
// 瞑想中の体の色。黒 1 色の絵を青へ塗り替える(4 = 青)
// 瞑想(座禅)の色。**七色を回して**、力を取り戻していることを見せる。
// ドラゴンの炎と同じ並び(赤 橙 黄 緑 空 青 紫)
const KING_ZEN_COLORS = [8, 9, 10, 2, 7, 4, 13];
const kingZenMap = () => ({ 1: KING_ZEN_COLORS[Math.floor(mmsxx.frame / 6) % KING_ZEN_COLORS.length] });
const KING_MAN_HP = 480;           // 第 2 段階の体力(弱すぎたので 4 倍にした)
// 頭とみなす高さの割合(上から 38%)。弾が 2 倍になる場所であり、
// **自機がぶつからない**場所でもある
const KING_HEAD_RATIO = 0.38;
let kingBeams = [];

/**
 * 回転レーザーを 1 発撃つ。
 * 1 発 = 1 枚のスプライトで、飛んでいく角度に合う線の絵をそのまま使う。
 * 線の絵は 180 度で見た目が同じなので、その範囲で近いコマを選ぶ。
 */
function fireKingBeam(angle) {
  const n = KING_LINES.length;
  const step = Math.PI / n;
  const i = ((Math.round(angle / step) % n) + n) % n;
  const sp = mmsxx.sprite(KING_LINES[i]);
  sp.priority = 6;
  sp.blink = 2;   // 1 コマおきの明滅(実機のスプライトらしいちらつき)
  kingBeams.push({ a: angle, r: KING_BEAM_R0, sp });
}

// ---- 5 面: はるか前方から飛んでくる長いレーザー ----
// 裂け目が撃つのと同じレーザーの 3 倍長い版。
// 遠くから来るので、角度はほぼまっすぐ(真下向きから少しだけ振れる)。
// ボスが出るまでのあいだ、星座を見せ終えたころから飛んでくる
// ボスを倒したか。倒したあとは道中のレーザーを打ち切る
let bossCleared = false;
const FAR_BEAM_AT = 880;           // 星座を見せ終えたころから
const FAR_BEAM_SPEED = 4.2;
const FAR_BEAM_GAP = 46;           // 次の 1 本までの間
let farBeams = [];
let farBeamTimer = 0;
function fireFarBeam() {
  // 真下(+90 度)から ±14 度まで。ほぼまっすぐ落ちてくる
  const a = Math.PI / 2 + (rndBoss() - 0.5) * 0.5;
  const n = KING_LINES_LONG.length;
  const step = Math.PI / n;
  const i = ((Math.round(a / step) % n) + n) % n;
  const sp = mmsxx.sprite(KING_LINES_LONG[i]);
  sp.priority = 6;
  sp.blink = 2;   // 裂け目のレーザーと同じちらつき
  // 画面の上の外から、横位置はばらばらに
  const x = rndBoss() * SCREEN_W;
  farBeams.push({ a, x, y: -48, sp });
  // ここではショット(SE_HIT)より強くして、必ず鳴らす。
  // 撃ちながらでも「前から来ている」ことを音で分からせたい
  mmsxx.audio.playSE('laser', SE_HIT + 1);
}
function clearFarBeams() {
  for (const b of farBeams) mmsxx.removeSprite(b.sp);
  farBeams = [];
  farBeamTimer = 0;
}
function updateFarBeams() {
  for (const b of [...farBeams]) {
    b.x += Math.cos(b.a) * FAR_BEAM_SPEED;
    b.y += Math.sin(b.a) * FAR_BEAM_SPEED;
    b.sp.x = Math.round(b.x) - 24; b.sp.y = Math.round(b.y) - 24;
    if (b.y > SCREEN_H + 48 || b.x < -64 || b.x > SCREEN_W + 64) {
      mmsxx.removeSprite(b.sp);
      farBeams.splice(farBeams.indexOf(b), 1);
    }
  }
}

function clearKingBeams() {
  for (const b of kingBeams) mmsxx.removeSprite(b.sp);
  kingBeams = [];
}

function updateKingBeams() {
  for (const b of [...kingBeams]) {
    b.r += KING_BEAM_SPEED;
    const x = RIFT_CX + Math.cos(b.a) * b.r - 8;
    const y = RIFT_CY + Math.sin(b.a) * b.r - 8;
    b.sp.x = Math.round(x); b.sp.y = Math.round(y);
    if (x < -16 || x > SCREEN_W || y < -16 || y > SCREEN_H) {
      mmsxx.removeSprite(b.sp);
      kingBeams.splice(kingBeams.indexOf(b), 1);
    }
  }
}

// 暗い赤に染まった空間。真っ黒なシルエットを浮かせるため、
// 背景色を暗い赤にして星のレイヤーを全部消す(スクロールも見えなくなる)
// 赤い空間。画面ぜんぶが一度に変わるのではなく、
// 4x4 ドットのマスごとに色が決まって、そこだけがゆらぐ。
// (横 8 ドットには 4x4 が 2 つしか並ばないので、2 色までの決まりは自然に守られる)
// 中心から外へ広がる波(向こうから迫ってくる感じ)と、
// 横に流れる波(左右にうねる感じ)を重ねて色を選ぶ。
const RED_SHADES = [6, 8, 9];   // 暗い赤 / 赤 / 明るい赤
const RED_CELL = 4;
const RED_COLS = SCREEN_W / RED_CELL, RED_ROWS = SCREEN_H / RED_CELL;
let redSpace = false;
// 前のコマの色。変わったマスだけ塗り直して、無駄な塗りつぶしを減らす
let redCells = null;

function enterRedSpace() {
  redSpace = true;
  mmsxx.backdrop = RED_SHADES[0];
  far.visible = mid.visible = near.visible = false;
  // 赤いマスは neb(大きな背景オブジェクトのレイヤー)に描く。
  // 裂け目もシルエットもこれより手前なので、背景として敷ける。
  //
  // ここで画面を消してしまうと、割れ目が広がった柄から波打つ柄へ
  // ぱっと切り替わって見えてしまう。消さずに残しておいて、
  // 割れ目が広がったのと**同じ順番**(中心から外へ)で波の柄に置き換えていく。
  neb.scroll(0, 0);
  redBlend = 0;
  redCells = new Uint8Array(RED_COLS * RED_ROWS).fill(255);
  redPhaseR = 0;
  redPhaseX = 0;
  redFade = 0;
  // 消える順番をばらばらに決めておく(中心から遠いほど少し早く消える)
  RED_ORDER = new Float32Array(RED_COLS * RED_ROWS);
  const ccx = RED_COLS / 2, ccy = RED_ROWS / 2;
  const maxD = Math.hypot(ccx, ccy);   // far はレイヤー名なので別名にする
  for (let cy = 0; cy < RED_ROWS; cy++) {
    for (let cx = 0; cx < RED_COLS; cx++) {
      const d = Math.hypot(cx - ccx, cy - ccy) / maxD;
      RED_ORDER[cy * RED_COLS + cx] = Math.max(0, Math.min(1,
        (1 - d) * 0.7 + Math.random() * 0.45));
    }
  }
}

/**
 * 赤い空間のマスをゆらす(毎フレーム呼ぶ)。
 *
 * そのままだと模様の繰り返しが見えてしまうので、
 *  - 波の速さ・細かさ・強さを**長い周期でゆっくり**変える
 *  - 左右の流れは速くなったり遅くなったり、ときどき逆向きにもなる
 *  - マスごとの小さなゆらぎ(乱数)を、ゆっくり流しながら混ぜる
 * を重ねてある。位相は足し込みで進めるので、速さが変わっても飛ばない。
 */
let redPhaseR = 0;   // 迫ってくる波の位相
let redPhaseX = 0;   // 左右のうねりの位相
// 星空へ戻していく進み具合(0 = 赤いまま / 1 = すっかり星空)
let redFade = 0;
// マスごとの「消える順番」。ばらばらに消えて、自然に星空が透けてくる
let RED_ORDER = null;
// マスごとの小さなゆらぎ。ゆっくりずらしながら読むので、模様が固定されない
const RED_NOISE = (() => {
  const n = new Float32Array(1024);
  let seed = 12345;
  for (let i = 0; i < n.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    n[i] = (seed / 0x7fffffff - 0.5) * 0.9;
  }
  return n;
})();

// 割れ目の柄から波の柄へ、どこまで置き換えたか(0..1)。
// crackCells と同じ順番を使うので、広がったのと同じ向きに切り替わる
let redBlend = 1;
const RED_BLEND_STEP = 0.012;   // 1 コマぶんの進み(約 1.4 秒で全部)

function updateRedSpace() {
  if (!redSpace) return;
  if (redBlend < 1) redBlend = Math.min(1, redBlend + RED_BLEND_STEP);
  if (redFade > 0) redFade = Math.min(1.2, redFade + 0.006);   // 星空へゆっくり戻していく
  const f = mmsxx.frame;
  // 長い周期(20〜60 秒)でゆっくり動くパラメータ
  const slow = (period, a, b) => a + (b - a) * (0.5 + 0.5 * Math.sin(f * period));
  const spdR = slow(0.0031, 0.06, 0.34);     // 迫ってくる速さ
  const spdX = slow(0.0019, -0.30, 0.34);    // 左右の流れ(向きも変わる)
  const freqR = slow(0.0013, 0.28, 0.72);    // 波の細かさ
  const freqX = slow(0.0017, 0.10, 0.48);
  const mix = slow(0.0009, 0.45, 1.30);      // 左右のうねりの強さ
  const bias = slow(0.0007, -0.35, 0.35);    // 明るい赤の出やすさ
  redPhaseR += spdR;
  redPhaseX += spdX;
  // ゆらぎの読み出し位置もゆっくり流す
  const nOff = Math.floor(f * 0.35);
  const ccx = RED_COLS / 2, ccy = RED_ROWS / 2;
  for (let cy = 0; cy < RED_ROWS; cy++) {
    const dy = cy - ccy;
    for (let cx = 0; cx < RED_COLS; cx++) {
      const dx = cx - ccx;
      const d = Math.sqrt(dx * dx + dy * dy);
      const i = cy * RED_COLS + cx;
      const v = Math.sin(d * freqR - redPhaseR)
        + Math.sin(cx * freqX + redPhaseX) * mix
        + RED_NOISE[(i + nOff) & 1023]
        + bias;
      // 入ってきたばかりのあいだは、順番の来ていないマスは
      // 割れ目が広がったときの柄をそのまま残しておく
      if (redBlend < 1 && crackCells && crackCells[i] > redBlend) continue;
      // 戻しているあいだは、順番の来たマスから消していく(星空が透けてくる)
      const gone = redFade > 0 && RED_ORDER[i] <= redFade;
      const n = gone ? -1 : (v > 0.85 ? 2 : v > -0.35 ? 1 : 0);
      if (redCells[i] === n + 1) continue;   // 変わったマスだけ塗り直す
      redCells[i] = n + 1;
      // 4 ドット単位なので、丸めずにそのまま塗る(第 6 引数 true)
      neb.fill(n < 0 ? 0 : RED_SHADES[n],
        cx * RED_CELL, cy * RED_CELL, RED_CELL, RED_CELL, true);
    }
  }
}

/**
 * 赤い空間を、少しずつ星空へ戻し始める。
 * 背景色と星はすぐ元に戻し、赤いマスをばらばらに消していくことで
 * 「じわじわ星空が透けてくる」ように見せる。
 */
function beginRestoreSpace() {
  if (!redSpace || redFade > 0) return;
  mmsxx.backdrop = 1;
  far.visible = mid.visible = near.visible = true;
  redFade = 0.001;
}

/** ふつうの宇宙(黒 + 星)に戻す。ボス戦の終わりに必ず呼ぶ */
function restoreSpace() {
  // 赤い空間のマスで塗りつぶされて消えているので、閉じたところで描き直す
  // (ボスの前に出したぶんは、この裏で消えてしまっている)
  if (redSpace && isLastStage()) showJupiter();
  redSpace = false;
  redFade = 0;
  redCells = null;
  RED_ORDER = null;
  mmsxx.backdrop = 1;
  far.visible = mid.visible = near.visible = true;
}

/**
 * **ラスボスの段階。**
 *
 *   open -> rift -> break -> pose -> man   ( どこからでも won )
 *
 * `rift` から出るのは**撃ち抜かれたとき**だけなので、そこは hitKingRift から
 * `go('break')` で移す。`man`(第 2 段階)の中の技は別の機械(KING_ACTS)。
 */
const KING_STAGES = {
  // まだ攻撃してこない。ひびが縦に伸びて、じわじわ口を開けていくのを見せる。
  // 広がるたびに「バキョ」と鳴らす
  open: {
    for: KING_OPEN_LEN,
    next: 'rift',
    update: (b, f) => { if (f.timer % 36 === 0) mmsxx.audio.playSE('rifttear', SE_EVENT + 1); },
  },
  // 開ききった裂け目。360 度へ回転レーザーを撃つ
  rift: {
    update: (b) => {
      // 少し戦わせてから、狙いどころを 1 回だけ教える
      if (!b.toldRift && b.age > 240) {
        b.toldRift = true;
        showNotice('SHOOT FROM INSIDE!');
      }
      // 腕ごとに時間をずらして撃つ。ずっと撃ち続けると単調なので、
      // 連射と休みを交互にする
      b.spin += KING_ROT;
      const cycle = b.age % (KING_BURST + KING_REST);
      b.resting = cycle >= KING_BURST;
      if (state === 'play' && !b.resting) {
        for (let i = 0; i < KING_ARMS; i++) {
          const off = Math.round((KING_FIRE_GAP * i) / KING_ARMS);
          if ((b.age + off) % KING_FIRE_GAP === 0) {
            fireKingBeam(b.spin + (Math.PI * 2 * i) / KING_ARMS);
          }
        }
        // 音は鳴らしっぱなしにせず、間引いて「連射している感じ」だけ出す
        if (b.age % 30 === 0) mmsxx.audio.playSE('shot', SE_EVENT);
      }
      // 休みの終わりぎわに、次が来ることを音で知らせる
      if (b.resting && cycle === KING_BURST + KING_REST - 30) {
        mmsxx.audio.playSE('charging', SE_EVENT);
      }
    },
  },
  // 中から無理やり押し広げられて、まわりにひびが走り、やがて砕ける
  break: {
    viaGo: true,   // 裂け目を撃ち抜いたとき(hitKingRift)
    for: KING_BREAK_LEN,
    next: 'pose',
    update: (b, f) => {
      if (b.rift) b.rift.image = BG_SYMBOLS.kingRift2;
      if (f.timer % 30 === 0) mmsxx.audio.playSE('rifttear', SE_EVENT + 1);
      if (f.timer % 5 === 0) {
        spawnBoom(Math.random() * (SCREEN_W - 16), Math.random() * (SCREEN_H - 16));
        mmsxx.audio.playSE('boom', SE_HIT);
      }
      // 途中で宇宙が暗い赤に染まる(ここから星は出てこない)。
      // このとき、もう 2:2 のちらつきで姿が見えはじめている
      if (f.timer === Math.floor(KING_BREAK_LEN / 2)) {
        enterRedSpace();
        // 出てくるときは腕組み。まだ構えもしない = 相手にしていない、を見せる
        makeKingMan(b);
      }
    },
    // ばーんと出てくる
    exit: () => mmsxx.audio.playSE('bossboom', SE_HIT),
  },
  // 決めポーズ。出てくるあいだにちらつきを落としていく。
  // 2:2(まだ実体が定まらない) -> 1:1 -> ちらつき無し(そこにいる)
  pose: {
    for: KING_POSE_LEN,
    next: 'man',
    update: (b, f) => {
      if (!b.man) return;
      const t = 1 - f.timer / KING_POSE_LEN;
      if (t < 0.35) { b.man.blink = 4; b.man.blinkOn = 2; }
      else if (t < 0.7) { b.man.blink = 2; b.man.blinkOn = 1; }
      else { b.man.blink = 1; b.man.blinkOn = 1; }
    },
    // 構え終わったら曲を FINAL BATTLE に切り替える
    exit: (b) => {
      b.max = KING_MAN_HP;
      // 出てくるあいだに炎で焼かれていたぶんは、ここで差し引く
      b.hp = Math.max(1, KING_MAN_HP - (b.preBurn || 0));
      // 頭に当てると 2 倍。炎(バックファイヤー)がいちばん効くことを教える
      showNotice('BURN ITS HEAD!');
      // 待機(コマ 00)。2 コマでゆっくり呼吸させる
      if (b.man) {
        b.man.frames = [SPRITE_SYMBOLS.kingMan00, SPRITE_SYMBOLS.kingMan00b];
        b.man.frameRate = 24;
      }
      drawBossBar();
      playBGM('finalbattle', true, true);
    },
  },
  // 第 2 段階。格闘家として構え、3 つの技を使い分ける(中身は updateKingFight)
  man: {},
  // 自機がやられたあと。**動きも攻撃も止める**
  won: { viaGo: true },
};

function spawnKingBoss() {
  markMet('kingMet');   // 図鑑の ? が外れる(VOICE 欄が出るのは倒してから)
  // シーン選択で「第 2 段階から」を選んでいたら、出たところで切り替える
  const toPhase2 = pendingKingPhase2;
  pendingKingPhase2 = false;
  boss = {
    kind: 'king',
    // 裂け目は動かない。共通処理(爆発の位置など)のために x/y も持っておく
    x: RIFT_X, y: RIFT_Y, sx: RIFT_X, sy: RIFT_Y,
    hp: RIFT_HITS, max: RIFT_HITS, age: 0, flash: 0, dying: 0, phase2: false,
    spin: 0, hits: 0, man: null,
  };
  boss.fsm = new StateMachine(KING_STAGES, { start: 'open', ctx: boss, name: '王' });
  boss.rift = bossPart(KING_RIFT_OPEN[0], 1);
  // 壊れるときにまわりへ走るひび(裂け目より奥)
  // ひびは絵ではなくマス目で広げる(絵だと黒い余白が四角く見えてしまう)
  crackCells = null;
  crackSpread = 0;
  clearKingBeams();
  clearFarBeams();
  clearKingEscape();
  drawBossBody();
  playBGM('lastboss', true);
  // シーン選択で「第 2 段階から」を選んでいたら、ここで一気に飛ばす
  if (toPhase2) kingToPhase2();
}

/**
 * シルエットマンのスプライトを作る(腕組みの登場ポーズ)。
 * 'break' の途中と、シーン選択で第 2 段階へ飛ばしたときの両方から呼ぶ
 */
function makeKingMan(b) {
  if (!b || b.man) return b && b.man;
  b.man = mmsxx.sprite(SPRITE_SYMBOLS.kingMan01);
  b.man.frames = [SPRITE_SYMBOLS.kingMan01, SPRITE_SYMBOLS.kingMan01b];
  b.man.frameRate = 30;
  b.man.priority = 10;
  b.man.blink = 4; b.man.blinkOn = 2; b.man.blinkPhase = 0;   // 2:2
  b.x = RIFT_CX - KING_MAN_W / 2;
  b.y = RIFT_CY - KING_MAN_H / 2;
  return b.man;
}

// 気絶したときに頭のまわりを回るひよこ。3 羽が同じ輪の上を追いかけ合う
const CHICKS = 3;
const CHICK_RX = 18, CHICK_RY = 6;   // 輪の半径(横長にして奥行きを出す)

/** ひよこを出しっぱなしにしないよう片づける(鳴き声も止める) */
function clearChicks(b) {
  if (!b) return;
  if (b.piyoId) { mmsxx.audio.stopSE(b.piyoId); b.piyoId = 0; }
  if (!b.chicks) return;
  for (const sp of b.chicks) mmsxx.removeSprite(sp);
  b.chicks = null;
}

/**
 * 気絶のあいだ、頭の上でひよこを回す。
 * 姿は立ったままなので、**これが気絶の目印**になる
 */
function updateChicks(b) {
  if (!kingIs(b, 'stun')) { clearChicks(b); return; }
  if (!b.chicks) {
    b.chicks = [];
    for (let i = 0; i < CHICKS; i++) {
      const sp = mmsxx.sprite(SPRITE_SYMBOLS.chick0);
      sp.frames = [SPRITE_SYMBOLS.chick0, SPRITE_SYMBOLS.chick1];
      sp.frameRate = 6;          // 羽ばたき
      sp.priority = 12;          // 本体より手前
      sp.blink = 2;              // 1:1 の点滅
      sp.blinkPhase = i & 1;     // 隣どうしで裏返す(全部が同時に消えない)
      b.chicks.push(sp);
    }
    // 鳴き声は**気絶が解けるまでくり返す**。解けたところで止める
    // (くり返しの回数は多めに取っておいて、止めるのは clearChicks の役)
    b.piyoId = mmsxx.audio.playSE('piyo', SE_HIT, { loop: 99, resume: 'continue' });
  }
  const cx = b.x + KING_MAN_W / 2 - 4;
  const cy = b.y - 6;
  for (let i = 0; i < b.chicks.length; i++) {
    const a = (mmsxx.frame * 0.11) + (i * Math.PI * 2 / CHICKS);   // まわる速さ
    const sp = b.chicks[i];
    sp.visible = bossVisible;
    sp.x = cx + Math.cos(a) * CHICK_RX;
    sp.y = cy + Math.sin(a) * CHICK_RY;
    // 奥を回っているあいだは、本体の後ろへ回す
    sp.priority = Math.sin(a) < 0 ? 9 : 12;
  }
}

/** ラスボスのスプライトを片づける(裂け目は bossParts なので別途消える) */
function clearKing(b) {
  if (!b || b.kind !== 'king') return;
  if (b.man) { mmsxx.removeSprite(b.man); b.man = null; }
  clearChicks(b);
  clearKingBeams();
  clearFarBeams();
  clearKingEscape();
}

/**
 * ラスボスの勝ち。自機がやられたので、動きも攻撃もやめさせる。
 * 姿は**出てきたときと同じつま先立ち**に戻す(構えたままだと、
 * まだ戦う気でいるように見えてしまう)
 */
function kingWins(b) {
  if (!b || b.kind !== 'king' || b.fsm.is('won')) return;
  clearChicks(b);           // ピヨっていたら片づける
  b.fsm.go('won', b);
  if (b.actFsm) b.actFsm.go('idle', b);
  b.wonY = RIFT_CY - KING_MAN_H / 2;
  b.y = b.wonY;
  b.x = RIFT_CX - KING_MAN_W / 2;
  if (b.man) {
    b.man.frames = [SPRITE_SYMBOLS.kingMan01, SPRITE_SYMBOLS.kingMan01b];
    b.man.frameRate = 30;
    b.man.image = SPRITE_SYMBOLS.kingMan01;
    b.man.blink = 0;        // ちらつきは消す(そこにいる)
  }
}

function updateKingBoss(b) {
  // 自機がやられたあと。**動きも攻撃も止める**。
  // 出てきたときと同じつま先立ちのまま、ゆっくり上下に浮かべておく
  if (b.fsm.is('won')) {
    b.y = b.wonY + Math.sin(mmsxx.frame / 24) * 3;
    drawBossBody();
    return;
  }
  drawBossBody();
  // 段階と移り先は KING_STAGES に書いてある。
  // **第 2 段階に入ったコマは、まだ戦わない**(もとの作りに合わせる)
  const fighting = b.fsm.is('man');
  b.fsm.step(b);
  if (!fighting) return;
  // ---- 第 2 段階。格闘家として構え、3 つの技を使い分ける ----
  updateKingFight(b);
  updateChicks(b);   // 気絶のあいだだけ、頭の上でひよこが回る
  // 撃たれているあいだは、後ろへのけぞるポーズに切り替える。
  // 当たったことが姿ではっきり分かるようにするため
  if (b.hurtVoice > 0) b.hurtVoice--;
  if (b.man) {
    if (!kingIs(b, 'meditate') && b.man.colorMap) b.man.colorMap = null;   // 七色を戻す
    if (b.hurtPose > 0) {
      b.hurtPose--;
      if (b.man.frames) b.man.frames = null;
      b.man.image = (b.hurtPose & 4) ? SPRITE_SYMBOLS.kingMan05 : SPRITE_SYMBOLS.kingMan05b;
    } else if (kingIs(b, 'meditate')) {
      // 座って瞑想。撃たれても姿は変わらない(無敵)。
      // 体力が戻っていくあいだは、黒ではなく**青 1 色**にして、
      // ふだんの黒いシルエットと見分けられるようにする
      if (b.man.frames) b.man.frames = null;
      b.man.image = SPRITE_SYMBOLS.kingMan11;
      // 6 コマごとに色が変わる(黒いシルエットとはっきり見分けられる)
      b.man.colorMap = kingZenMap();
    } else if (kingIs(b, 'stun')) {
      // 気絶。**立ち姿から腕だけを垂らした姿**(頭と足は同じ)。
      // 気絶そのものは頭の上のひよこで見せる
      if (b.man.frames) b.man.frames = null;
      b.man.colorMap = null;
      b.man.image = SPRITE_SYMBOLS.kingMan12;
    } else if (b.guard > 0) {
      // 腕で受けている(または息が上がって固まっている)あいだはガードの姿
      if (b.man.frames) b.man.frames = null;
      b.man.image = SPRITE_SYMBOLS.kingMan02;
    } else {
      // いまの技に合わせた姿。構えだけ 2 コマで呼吸させる
      if (!kingIs(b, 'kick', 'kickCircle', 'kickWind', 'orbit')) b.man.flipX = false;
    if (!kingIs(b, 'moon') && b.man.rotate) b.man.rotate = 0;   // 宙返りの回転を戻す
      const pose = kingFightPose(b);
      if (pose.length > 1) {
        b.man.frames = pose;
        b.man.frameRate = 24;
      } else {
        b.man.frames = null;
        b.man.image = pose[0];
      }
    }
  }
}

// ラスボス第 2 段階の技。
//   パンチ  … 構えから踏み込んで、エネルギー弾を撃つ(いちばんよく使う)
//   キック  … 画面の横から、自機の高さへまっすぐ突っ込む
//   ムーンサルト … 体力が減ってから。画面の下から弧を描いて上がってくる
const KING_ACT_GAP = 96;        // 技と技のあいだ
const KING_PUNCH_WIND = 26;     // ためる時間
const KING_PUNCH_HOLD = 22;     // 打ったあと戻すまで
const KING_WAVE_POSE = 14;      // 波動を撃つとき、突き出した姿を見せるコマ数
const KING_KICK_SPEED = 6.2;    // 波動(2.85)よりはっきり速い
const KING_MAX_SPEED = 6.4;     // 1 コマで動ける上限(旋回が速くなりすぎないように)
const KING_KICK_WIND = 42;      // 助走(反対側へ回り込む)の時間
const KING_KICK_CIRCLE = 110;   // 蹴る前に近い輪をうろうろする時間
const KING_WAVE_R = 92;         // 波動を撃つときの距離(遠め)
const KING_KICK_R = 56;         // 蹴る前にうろうろする距離(近め)
const KING_KICK_BACK = 132;     // 助走で下がる距離。遠くから一気に来る
const KING_WAVE_SHOTS = 3;      // 1 回の技で 3 回撃つ
const KING_WAVE_GAP = 34;       // 撃つ間隔
const KING_MOON_HP = 0.45;      // 体力がこれを下回るとムーンサルトを混ぜる
const KING_BALL_SPEED = 2.85;   // 1.5 倍に上げた

/**
 * パンチの「黒い波動」。大・中・小を少しずらして重ねて飛ばす。
 * 3 枚が同じ向きへ並んで進むので、どちらへ来ているかが見える。
 */
function fireKingWave(b) {
  const cx = b.x + KING_MAN_W / 2, cy = b.y + KING_MAN_H / 2;
  // 画面の外にいるあいだは撃たない。
  // 撃ってしまうと、姿の見えないところから横向きに弾が入ってきて、
  // 「どこから来たのか分からない」当たりかたになるため
  if (cx < 0 || cx > SCREEN_W || cy < 0 || cy > SCREEN_H) return;
  const dx = player.x + 8 - cx, dy = player.y + 8 - cy;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  // 進む向きへ絵を回す。スプライトは 90 度単位なので、近い向きに丸める
  const deg = (Math.atan2(uy, ux) * 180) / Math.PI;
  const rot = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  // 先頭がいちばん大きく、後ろへ行くほど小さい = 押し寄せてくるように見える
  const set = [[SPRITE_SYMBOLS.kingWaveL, 0], [SPRITE_SYMBOLS.kingWaveM, 10], [SPRITE_SYMBOLS.kingWaveS, 18]];
  for (const [i, [img, back]] of set.entries()) {
    const sp = mmsxx.sprite(img);
    sp.priority = 7;
    sp.rotate = rot;
    // 3 枚を**順ぐりに 1 枚ずつ**出す(大きいほうから小さいほうへ)。
    // 同時に見えるのは 1 枚だけなので、実機の多重表示のように尾を引いて見える
    sp.blink = 3;
    // 出る順は「フレーム + 位相」が 3 で割り切れたとき。
    // 大 -> 中 -> 小 の順に出したいので、位相は 0, 2, 1 とたどる
    sp.blinkPhase = (set.length - i) % set.length;
    // 枠は 16x16 なので、中心を合わせるには半分の 8 を引く
    sp.x = cx - 8 - ux * back;
    sp.y = cy - 8 - uy * back;
    enemyBullets.push({ sp, vx: ux * KING_BALL_SPEED, vy: uy * KING_BALL_SPEED });
  }
  mmsxx.audio.playSE('nobreak', SE_EVENT);
}

/**
 * キックを選ぶ割合。**体力が減るほど蹴ってくる**。
 * 前半は遠くから波動弾を撃つばかりで、後半は詰めてくる、という流れにする。
 *   満タン: 0.25(ほとんど波動) -> 瀕死: 0.80(ほとんどキック)
 */
function kickRate(b) {
  const t = Math.max(0, Math.min(1, b.hp / b.max));
  return 0.80 - 0.55 * t;
}

/**
 * 座って瞑想に入る。そのあいだは**無敵**で、最大体力の半分を取り戻す。
 * 2 度動けなくなったあと、または体力が 4 分の 1 を切ったときに入る
 */
function startKingMeditate(b) {
  b.shotSince = false;   // また弾で削られるまでは座らない
  b.meditateCount = (b.meditateCount || 0) + 1;
  // 息を整えるので、ピヨりのたくわえが 1 つ戻る(上限 2)
  b.stunStock = Math.min(KING_STUN_MAX, (b.stunStock || 0) + 1);
  b.slowMul = 1;
  b.guard = 0;
  b.actFsm.go('meditate', b);
  showNotice('IT IS MEDITATING!');
  mmsxx.audio.playSE('heal', SE_EVENT + 2);
}

/** ラスボスがその技(局面)のどれかか。第 2 段階に入る前なら常に false */
const kingIs = (b, ...names) => !!(b && b.actFsm && b.actFsm.in(...names));

/**
 * ピヨりを外から解く。**技は出させずに構えへ戻す** —
 * 自然に明けたときだけ、起き上がりざまの 1 発が返ってくる
 */
function kingCancelStun(b) {
  if (kingIs(b, 'stun')) b.actFsm.go('idle', b);
}

/** 自機の置き場所(シルエットマンの左上に合わせた座標) */
const kingPX = () => player.x + 8 - KING_MAN_W / 2;
const kingPY = () => player.y + 8 - KING_MAN_H / 2;

/** 自機のまわりを回るときの置き場所 */
function kingOrbit(b) {
  b.x = kingPX() + Math.cos(b.orbA) * b.orbR;
  b.y = kingPY() + Math.sin(b.orbA) * b.orbR;
}

/** 蹴り込む向きを決める。**下からは蹴らない**ので、横〜上へ寄せる */
function kingKickAngle(a) {
  if (Math.sin(a) > -0.15) return Math.cos(a) >= 0 ? -0.35 : Math.PI + 0.35;
  return a;
}

/** 待機から次に出す技を選ぶ。選ぶだけで、置き場所は移った先の enter が決める */
function pickKingAct(b) {
  const r = rndBoss();
  const kiai = (n) => mmsxx.audio.playTalk(n, SE_EVENT);
  // ムーンサルトだけは下から。体力が減ってきたときだけ出す
  if (b.hp / b.max < KING_MOON_HP && r < 0.28) { kiai('kiaiC'); return 'moon'; }
  // (B は撃たれたときの声に使うので、攻撃では鳴らさない)
  kiai('kiaiA');
  if (r < kickRate(b)) {
    // 蹴りの前ぶり。波動より近い輪をうろうろする
    b.orbR = KING_KICK_R;
    b.orbA = Math.atan2(b.y - kingPY(), b.x - kingPX());
    b.orbV = (rndBoss() < 0.5 ? 1 : -1) * 0.030;
    return 'kickCircle';
  }
  // 波動。少し離れた輪を回りながら 3 回撃つ
  b.orbR = KING_WAVE_R;
  b.orbA = Math.atan2(b.y - kingPY(), b.x - kingPX());
  b.orbV = (rndBoss() < 0.5 ? 1 : -1) * 0.022;
  b.waveLeft = KING_WAVE_SHOTS;
  return 'orbit';
}

/**
 * 気絶から息を吹き返したところ。**すぐに 1 発返してくる**。
 * 自機が上にいるならサマーソルト(下から上へ)、それ以外は起き上がりざまのキック
 */
function kingStunRecover(b) {
  b.slowMul = 1;
  if (player.y + 8 < b.y + KING_MAN_H / 2) {
    mmsxx.audio.playTalk('kiaiC', SE_EVENT);
    return 'moon';
  }
  mmsxx.audio.playTalk('kiaiA', SE_EVENT);
  b.orbA = Math.atan2(b.y - kingPY(), b.x - kingPX());
  b.orbR = KING_KICK_R;
  b.kickA = kingKickAngle(b.orbA);
  return 'kickWind';
}

/**
 * **ラスボス第 2 段階の技。**
 *
 *   idle -> orbit / kickCircle -> kickWind -> kick / moon -> idle
 *   ( どこからでも meditate(座禅) と stun(ピヨり) )
 *
 * もとは `act` の 6 つに加えて `meditate` と `stun` を**数え上げで**持っていて、
 * 「いま技を出せるのか」が `stun > 0` と `meditate > 0` の組み合わせに散っていた。
 * 8 つ並べてしまえば `is('stun')` だけで済む。
 */
const KING_ACTS = {
  // 構え。裂け目のあたりをゆらゆらしながら、次の技を選ぶまでの間
  idle: {
    for: KING_ACT_GAP,
    goes: ['moon', 'kickCircle', 'orbit'],
    to: (b, f) => (f.timer > 0 ? null : pickKingAct(b)),
    update: (b) => {
      b.x += ((RIFT_CX - KING_MAN_W / 2 + Math.sin(b.age * 0.013) * 56) - b.x) * 0.06;
      b.y += ((RIFT_CY - KING_MAN_H / 2 + Math.sin(b.age * 0.021) * 24) - b.y) * 0.06;
    },
  },
  // 波動。一定の距離を保ったまま弧を描いて動き、その間に 3 回撃つ
  orbit: {
    for: KING_WAVE_SHOTS * KING_WAVE_GAP,
    next: 'idle',
    update: (b, f) => {
      if (b.waveShot > 0) b.waveShot--;   // 突き出した姿を見せている残り
      b.orbA += b.orbV;
      b.orbR += (KING_WAVE_R - b.orbR) * 0.08;
      kingOrbit(b);
      // **撃つのはこの場では予約だけ。**
      // ここで撃つと、このあとの「画面の中へ収める」補正より前の位置から
      // 弾が出てしまい、姿の無いところから飛んできたように見えていた
      if (f.timer % KING_WAVE_GAP === 0 && b.waveLeft > 0) {
        b.waveLeft--;
        b.wantWave = true;
        b.waveShot = KING_WAVE_POSE;   // 撃つ瞬間だけ突きの姿にする
      }
    },
  },
  // 蹴りの前ぶり。波動より近い輪を、ゆらぎながらうろうろする。
  // ここは下側へ回ってもよい
  kickCircle: {
    for: KING_KICK_CIRCLE,
    next: 'kickWind',
    update: (b) => {
      b.orbA += b.orbV + Math.sin(b.age * 0.05) * 0.006;
      b.orbR += ((KING_KICK_R + Math.sin(b.age * 0.03) * 12) - b.orbR) * 0.08;
      kingOrbit(b);
    },
    // 助走に入る位置は「横」か「真上」に寄せる(いまいる側の反対へ回り込む)
    exit: (b) => { b.kickA = kingKickAngle(b.orbA + Math.PI); },
  },
  // 助走。自機の反対側へ回り込みながら、少し離れて勢いをつける
  kickWind: {
    viaGo: true,   // 気絶から息を吹き返したときにも、ここから返してくる
    for: KING_KICK_WIND,
    next: 'kick',
    update: (b) => {
      b.orbA += (((b.kickA - b.orbA + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.18;
      b.orbR += (KING_KICK_BACK - b.orbR) * 0.10;
      kingOrbit(b);
    },
    exit: (b) => {
      const d = Math.hypot(kingPX() - b.x, kingPY() - b.y) || 1;
      b.dvx = ((kingPX() - b.x) / d) * KING_KICK_SPEED;
      b.dvy = ((kingPY() - b.y) / d) * KING_KICK_SPEED;
      b.side = b.dvx >= 0 ? 1 : -1;
    },
  },
  // 決めた向きへまっすぐ突き抜ける
  kick: {
    for: 120,
    next: 'idle',
    update: (b) => { b.x += b.dvx; b.y += b.dvy; },
    when: (b) => (b.y > SCREEN_H + 16 || b.y < -KING_MAN_H - 16 ||
                  b.x < -KING_MAN_W - 16 || b.x > SCREEN_W + 16),
    exit: (b) => { b.y = RIFT_CY - KING_MAN_H / 2; },
  },
  // サマーソルト。画面の下から一気に上がってくる
  moon: {
    viaGo: true,   // 気絶から息を吹き返したときにも、ここから返してくる
    for: 150,
    next: 'idle',
    enter: (b) => { b.x = kingPX(); b.y = SCREEN_H + 8; b.moonT = 0; },
    update: (b) => {
      b.moonT += 0.016;
      const t = Math.min(1, b.moonT);
      b.y = SCREEN_H + 8 - t * (SCREEN_H + 40);
      b.x += (kingPX() - b.x) * 0.03 + Math.sin(t * Math.PI * 2) * 1.6;
    },
    when: (b) => b.moonT >= 1,
  },
  // 座禅。**無敵で体力を戻す。**技は出さない
  meditate: {
    viaGo: true,   // 体力が減ったとき(startKingMeditate)
    for: KING_MEDITATE_LEN,
    next: 'idle',
    // 戻す量はここで決める。**局面の中で完結させる** —
    // 呼ぶ側に置いていたら、飛ばして入ったときに体力が NaN になった
    enter: (b) => { b.healPer = (b.max * 0.5) / KING_MEDITATE_LEN; },
    update: (b, f) => {
      // 体力は少しずつ戻す(見ていて分かるように)
      b.hp = Math.min(b.max, b.hp + b.healPer);
      if (f.timer % 30 === 0) drawBossBar();
    },
    exit: (b) => { b.slowMul = 1; drawBossBar(); },
  },
  // ピヨり。息が上がって固まっているあいだは技を出さない
  stun: {
    viaGo: true,   // 崩されたとき
    for: KING_STUN_LEN,
    // 明けたら足は元どおりになって、**すぐに 1 発返してくる**
    goes: ['moon', 'kickWind'],
    to: (b, f) => (f.timer > 0 ? null : kingStunRecover(b)),
  },
};

function updateKingFight(b) {
  if (!b.actFsm) {
    b.actFsm = new StateMachine(KING_ACTS, { start: 'idle', ctx: b, name: '技' });
    b.slowMul = 1; b.guard = 0;
    b.stunStock = KING_STUN_MAX;   // ピヨらせられる残り回数
    b.meditateCount = 0;
  }
  if (b.guard > 0) b.guard--;
  // 体力が 4 分の 1 を切ったら座って立て直す(1 戦で 4 回まで)。
  // **弾で削られたときだけ**。炎だけで削っているあいだは座らない
  // (座られると無敵になるので、焼き続ける攻めが成り立たなくなる)
  if (!b.actFsm.is('meditate') && b.hp / b.max < KING_MEDITATE_HP &&
      b.meditateCount < KING_MEDITATE_MAX && b.shotSince) {
    startKingMeditate(b);
    return;
  }

  const wasX = b.x, wasY = b.y;
  b.actFsm.step(b);
  // 座っているあいだと固まっているあいだは、位置に手を入れない
  if (b.actFsm.in('meditate', 'stun')) return;

  // 自機のまわりを回る動きは、自機が速く動くと置き場所が飛んでしまう。
  // 1 コマで動ける量に上限をかけて、目で追える速さに抑える
  {
    // 撃たれて鈍っているぶんだけ、1 コマで動ける量を減らす
    const mul = b.slowMul == null ? 1 : b.slowMul;
    const dx = b.x - wasX, dy = b.y - wasY;
    const d = Math.hypot(dx, dy);
    const cap = KING_MAX_SPEED * mul;
    if (d > cap) {
      const k = d > 0 ? cap / d : 0;
      b.x = wasX + dx * k;
      b.y = wasY + dy * k;
    }
  }
  b.x = Math.max(-KING_MAN_W, Math.min(SCREEN_W, b.x));
  // 技を出しているあいだ(波動・キックの助走)は、画面の中に収める。
  // 画面の外から撃たれると避けようがないため
  if (b.actFsm.in('orbit', 'kickCircle', 'kickWind')) {
    b.x = Math.max(0, Math.min(SCREEN_W - KING_MAN_W, b.x));
    b.y = Math.max(0, b.y);
  }
  // 横や上へは画面の外まで出てよいが、**下側へは降りてこない**。
  // 自機のほうが下にいる形を保って、正面から撃つ人が弱点(頭)に
  // 気づきにくいようにするため。サマーソルトだけは下から上がってくる
  if (!b.actFsm.is('moon')) b.y = Math.min(b.y, KING_MAX_Y);
  // 置き場所が決まってから撃つ。これで弾はいつも見えている体から出る
  if (b.wantWave) { b.wantWave = false; fireKingWave(b); }
}

/** いまの技に合わせて姿を切り替える */
function kingFightPose(b) {
  // キックは進む向きへ体を向ける(絵は右向きなので、左へ行くときは反転)
  if (kingIs(b, 'kick')) {
    if (b.man) b.man.flipX = b.dvx < 0;
    return [SPRITE_SYMBOLS.kingMan07];
  }
  // うろうろ〜助走のあいだは構えたまま。自機のいるほうへ体を向ける
  if (kingIs(b, 'kickCircle', 'kickWind')) {
    if (b.man) b.man.flipX = (player.x + 8) < b.x + KING_MAN_W / 2;
    return [SPRITE_SYMBOLS.kingMan06];
  }
  if (kingIs(b, 'moon')) {
    // サマーソルト。ただ逆さで昇るだけだと跳んでいるようにしか見えないので、
    // 上がりながら 90 度ずつ回して**宙返り**にする。
    // スプライトの回転は 0/90/180/270 の 4 とおり。1 回転を 2 度ぶん回す
    if (b.man) b.man.rotate = [0, 90, 180, 270][Math.floor((b.moonT || 0) * 8) & 3];
    return [SPRITE_SYMBOLS.kingMan10];   // 横を向いて足を抱え込んだ姿
  }
  // 波動。回っているあいだは構え、**撃つ瞬間だけ突き出す**。
  // ここを待機の姿のままにしていたので、棒立ちで撃っているように見えていた
  if (kingIs(b, 'orbit')) {
    if (b.man) b.man.flipX = (player.x + 8) < b.x + KING_MAN_W / 2;
    return b.waveShot > 0 ? [SPRITE_SYMBOLS.kingMan06b] : [SPRITE_SYMBOLS.kingMan06];
  }
  return [SPRITE_SYMBOLS.kingMan00, SPRITE_SYMBOLS.kingMan00b];
}

// ---- 割れ目が広がる演出 ----
// ひびの絵を貼ると、絵の黒い余白が四角く見えて汚かったので、
// 4 ドットのマスを 1 つずつ塗る形にした。
// 割れ目の形(細長い楕円)からの距離の順に、ゆらぎを混ぜながら塗っていくので、
// 中心から ぞわぞわ と外へ広がっていくように見える。
const CRACK_CELL = 4;
const CRACK_COLS = SCREEN_W / CRACK_CELL, CRACK_ROWS = SCREEN_H / CRACK_CELL;
let crackCells = null;   // マスごとの「塗られる順番」(0..1)

function buildCrackCells() {
  crackCells = new Float32Array(CRACK_COLS * CRACK_ROWS);
  let max = 0;
  for (let cy = 0; cy < CRACK_ROWS; cy++) {
    for (let cx = 0; cx < CRACK_COLS; cx++) {
      const x = cx * CRACK_CELL + 2, y = cy * CRACK_CELL + 2;
      // 「割れ目そのものを何倍にすれば、このマスに届くか」を順番にする。
      // 割れ目の縦横の比(32x48)でそろえてあるので、
      // 広がりの輪郭はいつも元の割れ目と同じ形になる = 拡大していくように見える
      const dx = (x - RIFT_CX) / (RIFT_W / 2), dy = (y - RIFT_CY) / (RIFT_H / 2);
      // ゆらぎは形が分かる程度に控えめ(ぞわぞわ感だけ足す)
      const wob = Math.sin(x * 0.21 + y * 0.13) * 0.16
        + Math.sin(y * 0.31 - x * 0.07) * 0.11;
      const d = Math.hypot(dx, dy) + wob + Math.random() * 0.08;
      crackCells[cy * CRACK_COLS + cx] = d;
      if (d > max) max = d;
    }
  }
  for (let i = 0; i < crackCells.length; i++) crackCells[i] /= max || 1;
}

/** @param {number} t 0..1 どこまで広がったか */
function updateCrackSpread(t) {
  if (!crackCells) buildCrackCells();
  // 1 コマで塗るのは「今回ぶんの帯」だけ。前に塗ったところは残る
  const from = Math.max(0, crackSpread), to = Math.min(1, t);
  if (to <= from) return;
  for (let cy = 0; cy < CRACK_ROWS; cy++) {
    for (let cx = 0; cx < CRACK_COLS; cx++) {
      const v = crackCells[cy * CRACK_COLS + cx];
      if (v < from || v >= to) continue;
      // 割れ目に近いところほど明るい赤。外へ行くほど暗くする
      const c = v < 0.35 ? 9 : v < 0.6 ? 8 : 6;
      neb.fill(c, cx * CRACK_CELL, cy * CRACK_CELL, CRACK_CELL, CRACK_CELL, true);
    }
  }
  crackSpread = to;
}
let crackSpread = 0;

/**
 * 裂け目に 1 発当たった。弾の強さは関係なく 1 発 2 ダメージ。
 * ただし**裂け目に重なって撃つと 2 倍**入る。
 * 裂け目の真ん中は弾が来ない安全地帯になっていて、そこへ踏み込んで
 * 至近距離から撃つ、という戦い方を選べるようにするため。
 */
function playerOnRift() {
  const px = player.x + 8, py = player.y + 8;
  return Math.abs(px - RIFT_CX) < RIFT_W / 2 + 4 &&
    Math.abs(py - RIFT_CY) < RIFT_H / 2 + 4;
}

function hitKingRift(b, x, y) {
  b.hp -= RIFT_DAMAGE * (playerOnRift() ? 2 : 1);
  b.flash = 4;
  mmsxx.audio.playSE('weak');
  // 光を毎回出すと画面が埋まるので、4 発に 1 回だけ
  if (++b.hits % 4 === 0) spawnWeakSpark(x, y);
  if (b.hp > 0) return;
  b.hp = 0;
  b.fsm.go('break', b);
  b.flash = 0;
  crackCells = null;      // 広がりを作り直す
  crackSpread = 0;
  clearKingBeams();
  clearFarBeams();
  clearKingEscape();
  mmsxx.audio.stopBGM();
  currentBGM = null;
  mmsxx.audio.playSE('bossboom', SE_HIT);
  drawBossBar();
}

/** ボス戦の下ごしらえ(どのボスにも共通の部分) */
function beginBossMode() {
  bossMode = true;
  bossStartFrame = playFrame;
  bossFrames = 0;
  titleScene = false;   // タイトル用の背景は消す
  neb.clear();          // 背景オブジェクトを片づけてからボスを描く
  neb.scroll(0, 0);     // ボス戦のあいだ neb はレーザーの帯だけに使う
  clearBossParts();
  bossVisible = true;
}

/**
 * **挙動確認の面。**当たり判定を確かめるための的を、決まった場所に並べる。
 *
 * ふつうの面は敵の湧きが時間まかせなので、**狙ったものに当てられない**。
 * (きんぐの崩しを調べたとき「13 発とも頭に当たる」で行き詰まった。
 *  ドラゴンの尻尾にも当てられなかった)
 * ここは全部止まっているので、x を指定すれば必ずそこへ当たる。
 *
 * 的の場所は `mmsxxHitTargets()` で取れる。試験はそれを見て狙う。
 */
const HITTEST_LAYOUT = [
  // 型・x・y。**y は自機(160 あたり)より上**にして、まっすぐ撃てば当たるように
  { kind: 'enemy', type: 'A', x: 24, y: 60 },
  { kind: 'enemy', type: 'C', x: 64, y: 60 },   // 硬い(6 発)
  { kind: 'enemy', type: 'K', x: 104, y: 60 },  // とても硬い(10 発)
  { kind: 'asteroid', x: 152, y: 52 },          // 壊せるが硬い
  { kind: 'rocket', x: 200, y: 56 },
  { kind: 'bullet', x: 32, y: 108, breakable: true },   // 撃ち落とせる
  { kind: 'bullet', x: 72, y: 108, breakable: false },  // 撃ち落とせない(すり抜ける)
];

/** 並べた的。null なら確認の面ではない */
let hitTargets = null;

function spawnHitTest() {
  hitTargets = [];
  // **自機を定位置(画面の下)へ置き、前の場面の名残を消す。**
  // mmsxxBoss() で入ると自機は前にいた場所のまま(たいてい画面の上)で、
  // 上へ飛ぶ弾が的に永久に届かない。今日の測定を全部ゆがめていたのがこれ。
  // 面クリアの上昇(leaving)が残っていると、置いてもまた上がっていく
  player.x = 8; player.y = SCREEN_H - 32;
  player.visible = true;
  leaving = false; entering = false; enterDelay = 0; respawnDelay = 0;
  // 前の面がボス戦だと bossMode が残り、ボスがいないので「倒した」とみなされる
  bossMode = false;
  for (const t of HITTEST_LAYOUT) {
    let sp = null, obj = null, list = null;
    if (t.kind === 'enemy') {
      const e = spawnEnemy(t.type, t.x, 0);
      if (!e) continue;
      e.sp.x = t.x; e.sp.y = t.y;
      e.fireTimer = 1e9;         // 撃ってこない(確かめたいのは当たりだけ)
      e.frozen = true;
      sp = e.sp; obj = e; list = enemies;
    } else if (t.kind === 'asteroid') {
      spawnAsteroid();
      const a = asteroids[asteroids.length - 1];
      if (!a) continue;
      a.sp.x = t.x; a.sp.y = t.y;
      a.vx = 0; a.vy = 0; a.frozen = true;
      sp = a.sp; obj = a; list = asteroids;
    } else if (t.kind === 'rocket') {
      spawnRocket();
      const r = rockets[rockets.length - 1];
      if (!r) continue;
      r.sp.x = t.x; r.sp.y = t.y; r.frozen = true;
      sp = r.sp; obj = r; list = rockets;
    } else if (t.kind === 'bullet') {
      fireEnemyBullet(t.x, t.y, 0, 0, t.breakable);
      const eb = enemyBullets[enemyBullets.length - 1];
      if (!eb) continue;
      eb.frozen = true;
      sp = eb.sp; obj = eb; list = enemyBullets;
    }
    if (sp) hitTargets.push({ sp, x: t.x, y: t.y, 中身: t, obj, list });
  }
}

function spawnBoss() {
  // **挙動確認の面はボスを出さない。**的を並べて終わり
  if (stageNo === RUSH_HITTEST) {
    // **ボス戦にはしない。**ボスがいないまま bossMode にすると
    // 「倒した」とみなされて面クリアの流れに入ってしまう。
    // 敵の湧きは canEnemy の門(!hitTargets)で止める
    hud.clear(); drawHUD();
    spawnHitTest();
    return;
  }
  hitTargets = null;
  beginBossMode();
  // 出てきた時点で図鑑の姿が出るようになる。
  // どこから出しても(本編・ボスラッシュ・シーン選択)同じ扱い
  markMet(metFlag(stageNo));
  const kind = bossKind();
  if (kind === 'eyes') {
    // 裏技: いつもどおり 2 体そろった目玉と 1 戦だけ
    rushSpecial = 'eyes';
    specialEndTimer = -1;
    // 目玉戦は特別に 7way(前 5 + 後ろ 2)の装備で始める
    shotLevel = 7;
    maxVolleys = Math.max(maxVolleys, 2);
    damageLevel = Math.max(damageLevel, 2);
    drawHUD();
    spawnEyeballs();
    for (const e of eyeballs) e.hover = 1e9;   // 帰らずに居座る
    playBGM('boss', true);
    return;
  }
  if (kind === 'moai') {
    // 5 面ボス / 裏技のモアイ戦。倒したら次へ進む
    rushSpecial = 'moai';
    specialEndTimer = -1;
    spawnMoai();
    playBGM('moai', true);
    return;
  }
  if (kind === 'crab') { spawnCrabBoss(); return; }
  if (kind === 'dragon') { spawnDragonBoss(); return; }
  if (kind === 'nautilus') { spawnNautilusBoss(); return; }
  if (kind === 'todo') { spawnTodoBoss(); return; }
  if (kind === 'king') { spawnKingBoss(); return; }
  const hp = 40 + stageNo * 16;
  // 目は水色 1 色。点滅させず、自機のいる方へ少しだけ寄る
  const eyeL = mmsxx.sprite(SPRITE_SYMBOLS.bossEye2);
  const eyeR = mmsxx.sprite(SPRITE_SYMBOLS.bossEye2);
  eyeL.priority = eyeR.priority = 9;
  const eyeL2 = null, eyeR2 = null;
  const mouth = null;   // 口のスプライトは使わない
  // UFO のまわりを回るガード。全部壊すと壺が割れてタコだけになる
  const guards = [];
  for (let i = 0; i < GUARD_COUNT; i++) {
    const sp = mmsxx.sprite(SPRITE_SYMBOLS.ufoGuard);
    sp.priority = 8;
    // 手のひらは高速で明滅させる(実機のスプライト多重表示らしく)
    sp.blink = 2;
    sp.blinkPhase = i & 1;
    guards.push({ sp, hp: GUARD_HP, flash: 0, angle: (Math.PI * 2 * i) / GUARD_COUNT });
  }
  const charge = mmsxx.sprite(SPRITE_SYMBOLS.chargeOrb0);
  charge.priority = 12;
  charge.visible = false;
  // 外側の輪。溜めが進むほど小さい輪に替えて、光が集まってくるように見せる
  const chargeRing = mmsxx.sprite(SPRITE_SYMBOLS.chargeRing0);
  chargeRing.priority = 11;
  chargeRing.visible = false;
  // 「UFO に乗ったタコ」だと分かるよう、足と頭のふくらみを単色スプライトで重ねる。
  // 2 コマに 1 回だけ表示して、実機のスプライト多重表示のちらつきを出す
  const arms = mmsxx.sprite(SPRITE_SYMBOLS.octoArms);
  arms.priority = 7; arms.blink = 2; arms.blinkPhase = 0;
  const brow = mmsxx.sprite(SPRITE_SYMBOLS.octoCrown);
  brow.priority = 12;   // 王冠は点滅させない(色が違うので重ねても見分けが付く)
  boss = {
    kind: 'octopus',    // これが無いと「壺に乗っている間は無敵」の判定が働かない
    x: (SCREEN_W - BOSS_W) / 2, y: -60, hp, max: hp, age: 0, flash: 0, dying: 0,
    eyeL, eyeR, eyeL2, eyeR2, mouth, guards, charge, chargeRing, arms, brow,
    phase2: false,      // 船が壊れてタコだけになった状態
    laserGap: 90,       // 1 回目のレーザーは早め(弱点が 10 秒以内に開く)
    muzzleHp: 12,       // 発射口の耐久。壊すとその場で撃破(手のひらを削る道もある)
    laserLen: 0,
  };
  boss.fsm = new StateMachine(OCTO_STATES, { start: 'arrive', ctx: boss, name: 'タコ' });
  boss.gun = new StateMachine(OCTO_GUN, { start: 'wait', ctx: boss, name: '光線' });
  boss.partHead = bossPart(BG_SYMBOLS.bossHead);
  boss.partShip = bossPart(BG_SYMBOLS.bossShip);
  drawBossBody();
  playBGM('boss', true);
}

// ボスはレイヤーではなく BG スプライトで組み立てる。
// パーツごとに 1 枚持ち、毎フレーム位置と表示を合わせる。
// (レイヤーに描いていたころと違い、パーツを個別に消したり動かしたりできる)
let bossParts = [];
let bossVisible = true;   // 被弾フラッシュ用。パーツとスプライトをまとめて点滅させる

function bossPart(image, priority = 1) {
  const sp = mmsxx.bgSprite(image);
  // ボスのパーツは背景オブジェクトより手前。priority は部品どうしの前後関係
  sp.priority = BGP_FRONT + priority;
  bossParts.push(sp);
  return sp;
}

function clearBossParts() {
  for (const sp of bossParts) mmsxx.removeBgSprite(sp);
  bossParts = [];
}

/**
 * 目を自機のほうへ向ける。**目玉そのものは動かさず、黒目だけを 2 ドット寄せる**。
 *
 * 目玉ごと動かしていたころは、置き場所が 1 ドット単位でずれて泳いで見えた。
 * 向きは 16 方向。絵は「右下 4 分の 1」の 5 枚だけ持ち、
 * 残りは**左右・上下の反転**で作る(だから目の絵は対称に描いてある)。
 * @param {*} sp 目のスプライト
 * @param {number} cx @param {number} cy 目の中心(画面座標)
 * @param {boolean} [lens=true] レンズ(シアン)の絵か。false で枠の絵
 */
function lookEye(sp, cx, cy, lens = true) {
  const a = Math.atan2(player.y + 8 - cy, player.x + 8 - cx);
  const k = Math.round(a / (Math.PI / 8));          // 16 方向に丸める
  const dx = Math.round(Math.cos(k * Math.PI / 8) * 2);
  const dy = Math.round(Math.sin(k * Math.PI / 8) * 2);
  const key = Math.abs(dx) + '' + Math.abs(dy);     // '20' '21' '11' '12' '02'
  const mid = lens ? SPRITE_SYMBOLS.bossEye2 : SPRITE_SYMBOLS.bossEye;
  sp.image = SPRITE_SYMBOLS[(lens ? 'bossEye2_' : 'bossEye') + key] || mid;
  sp.flipX = dx < 0;
  sp.flipY = dy < 0;
  // レンズは 8 ドット、眼窩(BG 側)は 11 ドットで中心が半端になる。
  // そのままだと**どのボスでも右下に 1 ドットずれて**見えるので、ここでそろえる
  sp.x -= 1; sp.y -= 1;
}

/** ボスのパーツを今の状態に合わせて置き直す(毎フレーム呼ぶ) */
function drawBossBody() {
  const b = boss;
  if (!b) return;
  const vis = bossVisible;
  if (b.kind === 'todo') {
    b.partFace.x = b.x; b.partFace.y = b.y; b.partFace.visible = vis;
    if (b.crown) {
      const kx = snap8(b.x), ky = snap8(b.y);
      b.crown.visible = vis;
      // 王冠は頭の右上にちょこんと乗せる
      b.crown.x = kx + TODO_W - 28;
      b.crown.y = ky - 4;
    }
    // ほおの赤みは顔の横のほうへ。目の中には白い反射を入れる
    for (const [i, sp] of (b.blush || []).entries()) {
      sp.visible = vis;
      sp.x = snap8(b.x) + (i ? 34 : 2);
      sp.y = snap8(b.y) + 26;
    }
    if (b.glint) {
      b.glint.visible = vis;
      b.glint.x = snap8(b.x) + 15;
      b.glint.y = snap8(b.y) + 20;
    }
    // 涙は下で位置を決めるので、ここでは何もしない
    return;
  }
  if (b.kind === 'king') {
    // 裂け目は動かない。削れるほど大きく口を開け、1 コマおきに色を入れ替えて脈打たせる
    if (b.rift) {
      b.rift.visible = vis && b.fsm.in('open', 'rift');
      b.rift.x = RIFT_X; b.rift.y = RIFT_Y;
      if (b.fsm.is('open')) {
        // 開くまでの途中。細い線から開ききった姿まで順に切り替える
        const t = 1 - b.fsm.timer / KING_OPEN_LEN;
        const n = Math.min(KING_RIFT_OPEN.length - 1,
          Math.floor(t * KING_RIFT_OPEN.length));
        b.rift.image = KING_RIFT_OPEN[n];
      } else {
        // 撃っても広がらない。開ききった姿のまま
        b.rift.image = BG_SYMBOLS.kingRift1;
      }
      // 1 コマおきに色を入れ替えて脈打たせる。
      // 連射を休んでいるあいだは強く光らせて、次が来ることを知らせる
      const beat = b.resting ? 2 : 4;
      b.rift.colorMap = (mmsxx.frame & beat) ? { 6: 8, 8: 9, 9: 15 } : null;
    }
    // 壊れるときは、4 ドットのマスが割れ目の形から外へ ぞわぞわ 広がる
    if (b.fsm.is('break')) updateCrackSpread(1 - b.fsm.timer / KING_BREAK_LEN);
    if (b.man) {
      b.man.visible = vis;
      b.man.x = Math.round(b.x); b.man.y = Math.round(b.y);
    }
    return;
  }
  if (b.kind === 'nautilus') {
    b.core.image = b.phase2 ? BG_SYMBOLS.nautilusHurt : BG_SYMBOLS.nautilus;
    b.core.x = b.x; b.core.y = b.y; b.core.visible = vis;
    const cx = b.x + NAUT_CORE / 2, cy = b.y + NAUT_CORE / 2;
    for (const g of b.blocks) {
      const a = g.angle + b.spin;
      g.sp.visible = vis && g.alive;
      g.sp.x = cx + Math.cos(a) * b.ringR - 8;
      g.sp.y = cy + Math.sin(a) * b.ringR - 8;
      // 弱点の装甲は火花を散らして、ここだけ作りが違うと分かるようにする
      if (g.weak) g.sp.image = (mmsxx.frame & 2) ? BG_SYMBOLS.gearWeak1 : BG_SYMBOLS.gearWeak0;
    }
    // 輪の内側を走る電撃。装甲の半分の半径を、3 倍の速さでなめらかに回る。
    // 弱点の装甲が壊れたら電撃は消える(輪が開いたことが分かるように)
    for (const o of b.orbs || []) {
      const a = o.angle + b.orbSpin;
      o.sp.visible = vis && !b.phase2;
      // 半径は装甲の半分 + 4 ドット
      const r = b.ringR / 2 + 4;
      o.sp.x = cx + Math.cos(a) * r - 8;
      o.sp.y = cy + Math.sin(a) * r - 8;
    }
    if (b.crown) {
      const kx = snap8(b.x), ky = snap8(b.y);
      b.crown.visible = vis;
      b.crown.x = kx + 10; b.crown.y = ky - 8;
    }
    if (b.eyeL) {
      // 殻は BG スプライトなので 8 ドット刻みで動く。
      // 目もその刻みに吸着させる。向きは黒目だけで見せる
      const ex = snap8(b.x), ey = snap8(b.y);
      b.eyeL.visible = vis;
      b.eyeL.x = ex + 11;
      b.eyeL.y = ey + 22;
      lookEye(b.eyeL, b.eyeL.x + 8, b.eyeL.y + 8);
    }
    return;
  }
  if (b.kind === 'dragon') {
    // 突進のあいだと、炎を吐いているあいだは口を大きく開ける
    b.partHead.image = (b.fsm.in('hide', 'telegraph', 'charge') || b.mouthOpen)
      ? BG_SYMBOLS.dragonHeadOpen : BG_SYMBOLS.dragonHead;
    b.partHead.x = b.x; b.partHead.y = b.y; b.partHead.visible = vis;
    return;
  }
  if (b.kind === 'crab') {
    // 絵は右向きの 1 枚だけ持ち、右の壁にいるときは左右反転して使う。
    // ひっくり返った第2形態は壁のほうを向く
    const flip = b.phase2 ? b.side >= 0 : b.side > 0;
    b.partBody.flipX = flip;
    // ひっくり返ったあとは縦 96 ドットの壁になって邪魔なので、斜めに傾いた絵に替える。
    // 絵は左右に CRAB_TILT_PAD ずつ広いだけで、当たり判定はもとの 64x96 のまま
    b.partBody.image = b.phase2 ? BG_SYMBOLS.crabTilt : BG_SYMBOLS.crabR;
    b.partBody.x = b.x - (b.phase2 ? CRAB_TILT_PAD : 0);
    b.partBody.y = b.y; b.partBody.visible = vis;
    // ダメージが通ったときだけ、甲羅を白く光らせる(4 発に 1 回なので分かりにくかった)
    if (b.hurt > 0) b.hurt--;
    b.partBody.colorMap = (b.hurt > 0 && (b.hurt & 1)) ? CRAB_HURT_MAP : null;
    // 大きなハサミは別のパーツ。飛ばしたぶんは消す
    // ハサミの根元は胴体にめり込ませる(すき間を作らず、出っぱりも短く見せる)
    const clawX = flip ? b.x - (CRAB_CLAW_W - 32) : b.x + CRAB_W - 32;
    b.partClaws.forEach((sp, i) => {
      // 撃ったあとは、次のハサミの先端が にょきっと出て 3 段階で伸びていく。
      // 撃ち落とされたぶん(在庫切れ)は何も出さない
      const g = b.grow[i];
      sp.visible = vis && !b.phase2 && b.clawAlive[i];
      sp.image = g >= CRAB_CLAW_GROW ? BG_SYMBOLS.crabClawBig
        : g >= CRAB_CLAW_GROW * 0.55 ? BG_SYMBOLS.crabClawMid : BG_SYMBOLS.crabClawStub;
      sp.flipX = flip;
      sp.x = clawX; sp.y = b.y + CRAB_CLAW_Y[i];
    });
    // 脚。ジャンプ中は壁から離れてぐっと伸びる(そこだけ狙える)
    // ジャンプ中は関節を伸ばして踏ん張る(この姿のときだけ脚を撃てる)
    const jumping = b.fsm.is('jump');
    const out = jumping ? 14 : 0;   // 跳んでいるあいだは大きく踏ん張る
    // 壁にいるあいだは 3 コマで曲げ具合を変えて、脚をわしゃわしゃ動かす
    const LEG_ANIM = [BG_SYMBOLS.crabLeg, BG_SYMBOLS.crabLegMid, BG_SYMBOLS.crabLegExt, BG_SYMBOLS.crabLegMid];
    b.legs.forEach((lg, i) => {
      lg.sp.visible = vis && !b.phase2 && lg.hp > 0;
      lg.sp.image = jumping ? BG_SYMBOLS.crabLegExt
        : LEG_ANIM[(Math.floor(mmsxx.frame / 6) + i) & 3];
      lg.sp.flipX = flip; lg.sp.flipY = lg.flipY;
      // 付け根が甲羅の中に入るまで、しっかりめり込ませる。
      // 脚は BG スプライトなので 8 ドット単位に丸められる。
      // 甲羅の位置(b.sx。こちらも丸めてある)からの **8 の倍数** で置き、
      // 左右で丸めかたが変わらないようにする。
      // 以前は丸める前の b.x に -6 / +46 を足していたため、左右で
      // 丸めの向きが変わり、片側だけ 8 ドット外へずれて見えていた
      //   右: b.sx + 40  (脚の外ふちが甲羅の右ふちから 0 ドット)
      //   左: b.sx + 0   (その左右反転。64 - 40 - 24 = 0)
      lg.sp.x = (flip ? b.sx + CRAB_W - 24 + out : b.sx - out);
      lg.sp.y = b.sy + lg.y;
    });
    return;
  }
  // タコ: 第2形態は船から出たタコ(短い脚つき)
  b.partHead.image = b.phase2 ? BG_SYMBOLS.bossHead2 : BG_SYMBOLS.bossHead;
  b.partHead.x = b.x + HEAD_DX;
  b.partHead.y = b.y + (b.phase2 ? 0 : HEAD_SINK);
  b.partHead.visible = vis;
  b.partShip.x = b.x; b.partShip.y = b.y + HEAD_H;
  b.partShip.visible = vis && !b.phase2;
  // 発射口(ふだんは水色)は、ダメージが通るあいだだけピンクになる。
  // 絵は増やさず、エンジンの色入れ替えでまかなう
  b.partShip.colorMap = (laserPhase(b) === 'fade') ? { 7: 13 } : null;
}

const LASER_MAX = 200;      // レーザーの最大の長さ
const LASER_SPEED = 4;      // 1 フレームに伸びるドット数(ゆっくり伸ばす)
const LASER_FULL_LEN = 150;  // 最大の太さ(白)で撃っている長さ(フレーム)
const LASER_FADE_STEP = 12;  // 1 ドット細くなるのにかける時間(フレーム)
// 細くなる時間 = 12 ドット x 12 フレーム = 144 フレーム
const LASER_FADE_LEN = LASER_DRAW_W * LASER_FADE_STEP;
const LASER_FIRE_LEN = LASER_FULL_LEN + LASER_FADE_LEN;

/** レーザーの帯を長さ len ドットぶん BG に描く(len=0 で消える) */
/**
 * レーザーを描く。
 * @param {number} len 長さ(0 で消える)
 * @param {number} [w] 太さ(省略で最大)
 * @param {number} [color] 15=白(効いている) / 11=黄(消えかけ・当たらない)
 */
function drawLaser(len, w = LASER_DRAW_W, color = 15) {
  // ボス戦のあいだ neb は帯の描画だけに使う(スクロールは 0 に固定)。
  // 前のコマぶんを消してから描き直す
  neb.fill(0, 0, 0, VW, SCREEN_H);
  if (!boss || len <= 0 || w <= 0) return;
  const top = boss.sy + BOSS_H;
  // 太さは 1 ドット単位。中心はいつも砲口の真ん中に置く。
  // 8 ドット単位に丸められると「左半分だけ細る」ように見えるので、
  // ここは exact 指定(1 ドット単位)で塗る
  const iw = Math.max(1, Math.min(LASER_W, Math.round(w)));
  const x = Math.round(boss.sx + BOSS_W / 2 - iw / 2);
  neb.fill(color, x, top, iw, len, true);
}

// レーザーのいまの段階。'grow' 太くなる / 'full' 最大 / 'fade' 細くなる(当たらない)
function laserPhase(b) {
  if (!b || b.kind !== 'octopus' || !b.gun || !b.gun.is('fire')) return null;
  // 溜めてから撃つので、出だしから最大の太さ。最後は 1 ドットずつ細くなる。
  return b.gun.timer > LASER_FADE_LEN ? 'full' : 'fade';
}

/** 船が壊れて第2形態(タコだけ)へ移行する */
function breakShip() {
  boss.phase2 = true;
  boss.laserLen = 0;
  drawLaser(0);        // 撃ちかけのレーザーが残らないように消す
  // 撃っている途中で船が壊れることがある。くり返しの音を残さない
  if (boss.laserSE || boss.laserFadeSE) {
    stopLaserSE();
    boss.laserSE = false;
    boss.laserFadeSE = false;
  }
  if (boss.charge) boss.charge.visible = false;
  if (boss.chargeRing) boss.chargeRing.visible = false;
  for (const g of boss.guards || []) g.sp.visible = false;
  if (boss.kind === 'dragon') {
    // ドラゴンは装甲がはがれると全身が弱点になり、怒りの突進が増える
    // (旋回している最中なら、次に怒るまでを縮める)
    if (boss.fsm.is('spiral')) boss.fsm.timer = Math.min(boss.fsm.timer, 90);
    mmsxx.audio.playSE('bossboom', SE_HIT);
    flashTimer = 3;
    return;
  }
  if (boss.kind === 'crab') {
    // 脚を失って壁につかまれない。ここから先は漂って泡を吹くだけになる
    clearClawMissiles();
    boss.fsm.go('float', boss);
    // 無防備になったぶん、ここからは素直にダメージが通る
    boss.max = 60 + stageNo * 10;
    boss.hp = boss.max;
  }
  if (boss.kind === 'octopus') {
    // 撃つのをやめて、体当たりだけになる
    boss.fsm.go('bare', boss);
    boss.gun.go('wait', boss);
    // 壺から出たタコは体力を持ち直す(残りカスだと連打だけで終わってしまう)
    boss.max = 120 + stageNo * 24;
    boss.hp = boss.max;
  }
  // **無防備になった瞬間に、こすり打ちを教える**(上の cueRubHint)。
  // ここから先は素直にダメージが通るので、速く撃てるほど効く。
  // ここへ来るのは カニ = 脚が全部折れた / タコ = 壺が割れた のとき。
  // 貝(黄色いガードが外れたところ)は別の場所から呼んでいる。
  // **ドラゴンには出さない** — あちらは装甲がはがれても怒って突進が増えるだけで、
  // 落ち着いて削れる「狙いどき」にはならない
  if (boss.kind === 'crab' || boss.kind === 'octopus') cueRubHint(boss.kind);
  for (let i = 0; i < 5; i++) {
    spawnBoom(boss.sx + 8 + Math.random() * 44, boss.sy + HEAD_H + Math.random() * 16);
  }
  mmsxx.audio.playSE('bossboom', SE_HIT);
  flashTimer = 3;
  drawBossBody();
}

// 弱点に当たったときの光。単色スプライトを 2 コマに 1 回出す
let weakSparks = [];
function spawnWeakSpark(x, y) {
  const sp = mmsxx.sprite(SPRITE_SYMBOLS.boom0);
  sp.x = x; sp.y = y; sp.priority = 21;
  sp.blink = 2;
  weakSparks.push({ sp, age: 0 });
}
function updateWeakSparks() {
  for (const w of [...weakSparks]) {
    w.age++;
    if (w.age === 3) w.sp.image = SPRITE_SYMBOLS.boom1;
    else if (w.age >= 6) {
      mmsxx.removeSprite(w.sp);
      weakSparks.splice(weakSparks.indexOf(w), 1);
    }
  }
}
function clearWeakSparks() {
  for (const w of weakSparks) mmsxx.removeSprite(w.sp);
  weakSparks = [];
}

// ---- 自機の散りかた ----
// 止め絵で見ても汚くならないよう、爆発ではなく**光の輪**が広がる形にする
// (ファンタジーゾーンでオパオパが散るところの感じ)。
//
// **輪を 2 周ぶん重ねる。** 外の輪は 16 枚、内の輪は 8 枚。
// 内の輪は**半目盛りずらして、逆へ回す**ので、二重の渦に見える。
// ただし 1 枚は **4 コマに 1 回**しか出さず、出る順番を 4 つの組に分けてある。
// どの瞬間に見えているのは 6 枚ほどで、残りは消えている。
// 実機のスプライトのちらつきを、そのまま演出に使っている。
const DEATH_GROUP = 2;         // 何コマに 1 回出すか(2 = 1 コマ出て 1 コマ消える)
const DEATH_LIFE = 81;         // 散りきるまでのコマ数(1.35 秒)
// 1 コマあたりに回る角度(度)。**360 を割り切れる数より少し小さく**する。
// 割り切れると同じ絵が周期で戻ってきて、止まって見えてしまう
const DEATH_SPIN = (1.9 * Math.PI) / 180;   // 2 度より少し小さい
// **1 粒ごとに回る速さをばらす**倍率の幅。きっちり同じ速さで回すと、
// ポーズで止めたときに模様に見えてしまう
const DEATH_SPIN_VAR = 0.45;   // 0.55 ～ 1.45 倍
// 同じ理由で、**広がりきる距離も 1 粒ごとにばらす**
const DEATH_FAR_VAR = 0.22;    // 輪の距離の 0.78 ～ 1.22 倍
const DEATH_REACH = 38;        // 外の輪が広がりきる距離(広がりすぎたので 8 割に)
// 輪の作り。n = 枚数 / far = 広がる距離の割合 / turn = 回る向きと速さ /
// off = 置きはじめの角度をずらす量(目盛りの何ぶんか)
const DEATH_RINGS = [
  // 外の輪。水色から始めて 1 個ごとに色を送る
  { n: 16, far: 1, turn: 1, off: 0, color: 1 },
  // 内の輪。半目盛りずらして逆回り。色は白から始めるので外と並びが食い違う。
  // 速さは 2.4 度ぶん(2.5 度より少し小さい)
  { n: 8, far: 0.55, turn: -2.4 / 1.9, off: 0.5, color: 0 },
];
// 光の色。**1 個ごとに順ぐりに替える**。輪ごとに始まりの色をずらすので、
// 内と外で色の並びも食い違う
const DEATH_COLORS = [15, 7, 11];   // 白 / 水色 / 黄
// 輪だけだと整いすぎるので、**でたらめな場所にも光を散らす**。
// 同じ絵を使い、居場所を数コマごとに飛ばして ちらちらさせる
const DEATH_RAND = 8;          // でたらめに散らす数
const DEATH_HOP = 3;           // 何コマごとに居場所を変えるか
let deathBits = [];
let deathSparkImg = null;      // 色ごとの絵(初めて使うときに作る)

/** 散る光の絵(色ごと)。初めて呼ばれたときに作って、あとは使い回す */
function deathSparks() {
  if (!deathSparkImg) {
    deathSparkImg = DEATH_COLORS.map((c) => recolor(SPRITE_SYMBOLS.deathSpark, c));
  }
  return deathSparkImg;
}

/** 自機が散る。中心から光の輪が広がる */
function spawnDeathBurst(x, y) {
  clearDeathBurst();
  deathSparks();
  let k = 0;
  for (const ring of DEATH_RINGS) {
    for (let i = 0; i < ring.n; i++) {
      // 色は**1 個ごとに送る**。輪ごとに始まりをずらしてある
      const sp = mmsxx.sprite(deathSparkImg[(ring.color + i) % DEATH_COLORS.length]);
      // **いちばん奥**に置く(敵や弾の裏へ回す)
      sp.priority = 0;
      // **4 コマに 1 回**だけ出す。4 つの組に分けて、順ぐりに見せる
      sp.blink = DEATH_GROUP;
      sp.blinkPhase = k % DEATH_GROUP;
      sp.x = x; sp.y = y;
      deathBits.push({
        sp, age: 0, x, y,
        // 距離と回る速さは**1 粒ずつ散らす**(見た目だけなので Math.random)
        far: ring.far * (1 + (Math.random() * 2 - 1) * DEATH_FAR_VAR),
        turn: ring.turn * (1 + (Math.random() * 2 - 1) * DEATH_SPIN_VAR),
        a0: (Math.PI * 2 * (i + ring.off)) / ring.n,
      });
      k++;
    }
  }
  // でたらめに散る光。輪の内も外もまたいで、ちらちらと居場所を変える
  for (let i = 0; i < DEATH_RAND; i++) {
    const sp = mmsxx.sprite(deathSparkImg[i % DEATH_COLORS.length]);
    sp.priority = 0;
    sp.blink = DEATH_GROUP;
    sp.blinkPhase = k % DEATH_GROUP;
    sp.x = x; sp.y = y;
    deathBits.push({
      sp, age: 0, x, y, hop: true, a0: 0, turn: 0,
      far: 1 + (Math.random() * 2 - 1) * DEATH_FAR_VAR,
    });
    k++;
  }
}

function updateDeathBurst() {
  for (const b of [...deathBits]) {
    b.age++;
    if (b.age >= DEATH_LIFE) {
      mmsxx.removeSprite(b.sp);
      deathBits.splice(deathBits.indexOf(b), 1);
      continue;
    }
    const t = b.age / DEATH_LIFE;
    // 外へ出るのは**はじめに一気に**、終わりはゆっくり(1 - (1-t)^3)。
    // 等速に見えないよう、2 乗より強く減速させる
    const u = 1 - t;
    const r = DEATH_REACH * b.far * (1 - u * u * u);
    if (b.hop) {
      // でたらめなぶん。数コマごとに、輪のあたりへ飛び先を取り直す
      if ((b.age % DEATH_HOP) === 1) {
        b.ra = Math.random() * Math.PI * 2;
        b.rr = r * (0.35 + Math.random() * 0.9);
      }
      b.sp.x = b.x + Math.cos(b.ra || 0) * (b.rr || 0);
      b.sp.y = b.y + Math.sin(b.ra || 0) * (b.rr || 0) * 0.85;
      if (t > 0.8) b.sp.blink = DEATH_GROUP * 3;
      continue;
    }
    const a = b.a0 + b.age * DEATH_SPIN * b.turn;
    b.sp.x = b.x + Math.cos(a) * r;
    b.sp.y = b.y + Math.sin(a) * r * 0.85;   // 少し平たい輪にする
    // 終わりぎわは点滅を粗くして、消えぎわを作る
    if (t > 0.8) b.sp.blink = DEATH_GROUP * 2;
  }
}

function clearDeathBurst() {
  for (const b of deathBits) mmsxx.removeSprite(b.sp);
  deathBits = [];
}

// ---- ボス撃破の評価 ----
// 早く倒すほど高いランク。C はボーナス無し。
// ボーナスは面数によらず固定額。ランクだけで決まる
const BOSS_RANKS = [
  { rank: 'S', sec: 15, bonus: 200000 },
  { rank: 'A', sec: 30, bonus: 100000 },
  { rank: 'B', sec: 45, bonus: 50000 },
  { rank: 'C', sec: Infinity, bonus: 0 },
];
function bossRank(frames) {
  const sec = frames / 60;
  return BOSS_RANKS.find(r => sec <= r.sec);
}

/** 裏技の特別な相手を倒したとき(ボス扱いで面を進める) */
function bossDefeatedSpecial() {
  endBossMode();
  score += 20000;
  if (gameMode() === 'bossrush') { advanceBossRush(); return; }
  // 通常プレイでは使わない(裏技はボスラッシュ専用)
  stageNo++;
  startStage();
}

// 全面クリアで終わったか。**クリアしたら続きは残さない**(コンティニューを出さない)。
// ラスボスを倒したところでリプレイを見せたかどうかも、ここで一緒に覚えておく
let allCleared = false;
let clearReplayDone = false;

// ラスボスを倒したあと、画面も HUD も全部止めて名乗りを聞かせる。
// この値が 0 より大きいあいだ、メインループは何も進めない
let talkHold = 0;
/** ラスボスに負けたか(高笑いはリプレイのあとで鳴らす) */
let kingWon = false;
// いま止めているあいだにしゃべる中身と、爆発の演出を出すかどうか
let talkName = 'kozorite';
let talkBlast = false;

function bossDefeated() {
  clearBubble();   // 命ごいのふきだしを残さない
  // 客人(コンティニューのときの未実装さん)は、倒しても面はクリアにしない。
  // 片づけて、そのまま元の面を続ける
  if (boss && boss.guest) {
    for (let i = 0; i < 6; i++) {
      spawnBoom(boss.x + Math.random() * TODO_W, boss.y + Math.random() * TODO_H);
    }
    score += 5000;
    spawnPopup(boss.x, boss.y + 24, 5000);
    mmsxx.audio.playSE('bossboom', SE_HIT);
    clearTodoGuest();
    return;
  }
  // **ここから面のクリア**。道中のレーザーはもう飛ばさず、
  // 飛んでいる途中のものも消す(倒したあと宇宙へ戻ったところへ来ないように)
  bossCleared = true;
  clearFarBeams();
  const wasKing = boss.kind === 'king';
  // 倒れた場所(中心)。片づけたあとの演出で使う
  const kingFellX = boss.x + KING_MAN_W / 2;
  const kingFellY = boss.y + KING_MAN_H / 2;
  for (let i = 0; i < 6; i++) {
    spawnBoom(boss.x + Math.random() * 40, boss.y + Math.random() * 24);
  }
  if (boss.eyeL) mmsxx.removeSprite(boss.eyeL);
  if (boss.eyeR) mmsxx.removeSprite(boss.eyeR);
  if (boss.eyeL2) mmsxx.removeSprite(boss.eyeL2);
  if (boss.eyeR2) mmsxx.removeSprite(boss.eyeR2);
  if (boss.mouth) mmsxx.removeSprite(boss.mouth);
  for (const g of boss.guards || []) mmsxx.removeSprite(g.sp);
  if (boss.charge) mmsxx.removeSprite(boss.charge);
  if (boss.chargeRing) mmsxx.removeSprite(boss.chargeRing);
  if (boss.arms) mmsxx.removeSprite(boss.arms);
  if (boss.brow) mmsxx.removeSprite(boss.brow);
  if (boss.crown) mmsxx.removeSprite(boss.crown);
  for (const t of boss.tears || []) mmsxx.removeSprite(t.sp);
  for (const sp of boss.blush || []) mmsxx.removeSprite(sp);
  if (boss.glint) mmsxx.removeSprite(boss.glint);
  for (const sp of boss.clawSps || []) mmsxx.removeSprite(sp);
  for (const sp of boss.pods || []) mmsxx.removeSprite(sp);
  clearNautilus(boss);
  clearDragonSegs(boss);
  clearKing(boss);
  clearBossParts();
  bossVisible = true;
  clearClawMissiles();
  boss = null;
  endBossMode();
  // 撃破ボーナスは「かかった時間」でランク分け(S/A/B/C。C は無し)。
  // 数えるのは死亡が確定した瞬間まで。そのあとの爆発演出は含めない
  // 弾が当たる状態だったフレーム数だけを数える(演出待ちは含めない)
  const frames = bossFrames;
  const r = bossRank(frames);
  if (recordOn() && r.rank === 'S') {
    if (stageNo >= 1 && stageNo <= 4) record.add('boss' + stageNo + 'S', 1);
    else if (stageNo === LAST_STAGE) record.add('kingS', 1);
  }
  const gain = r.bonus;
  score += gain;
  statsBoss(frames);
  drawHUD();
  drawBossBar();
  mmsxx.audio.playSE('bossboom', SE_HIT);
  // 倒したあとの流れ。**ラスボスのときだけ、先にリプレイを挟む**ので、
  // ここから先をひとまとめにして、あとから呼べるようにしてある
  const finish = () => {
    // リプレイを挟んだときは 'replay' のまま戻ってくる。
    // クリアの進行(clearTimer)は遊んでいる状態でしか進まないので戻しておく
    state = 'play';
    if (gameMode() === 'bossrush') {
      // ボスラッシュは得点を数えないので、評価は出さずに次のボスへ
      clearTimer = 120;
    } else {
      playBGM('fate', false, true);   // クリア曲は「運命」のメジャー編曲
      showStageResult(r, frames, gain);
      clearTimer = 960;
    }   // 評価はゆっくり見せる(キーでスキップ可)
    clearFarBeams();   // 道中のレーザーはここで打ち切る(クリア後に飛んでこない)
    // ラスボスは倒れただけ。評価を見せているあいだに、青い裂け目へ逃げ込む
    // 裂け目は**倒した場所**に開く。そこへ本人が吸い込まれていく
    if (wasKing && gameMode() !== 'bossrush') startKingEscape(kingFellX, kingFellY);
    markMet(rushFlag(stageNo));   // ボスラッシュのメニューに出るようになる
    leaving = true; // 自機は画面の上へ飛び去っていく
    // 名乗りは倒れる前に流してある(hp が 0 になった瞬間)
  };
  // **ラスボスだけは、倒したその場でリプレイを見せる。**
  // 順番は 戦い → リプレイ → 集計 → エンディング。ほかの面や、
  // やられて終わるときとは流れが違う。
  // ここで溜めを止めるので、このあとの裂け目もエンディングも混ざらない
  if (wasKing && gameMode() !== 'bossrush') {
    freezeCapture(true);
    clearReplayDone = true;
    if (startReplay(finish)) return;   // 溜まっていなければそのまま集計へ
  }
  finish();
}

// ---- ラスボスが逃げていく演出 ----
// 倒れて宇宙が星空へ戻ったあと、クリアの評価を見せているあいだに、
// 青い裂け目が開いて、その中へ消えていく。
// 画面は暗く、評価の文字も出ているので気づきにくいが、それでよい
// (次があることを、見ていた人にだけ残しておく)
const KING_ESCAPE_LEN = 300;
let kingEscape = null;
/**
 * @param {number} cx 倒れた場所の**中心**の x
 * @param {number} cy 同じく y
 * 裂け目(32 幅)と本人(48 幅)は BG スプライトで 8 ドットに丸められる。
 * 別々に丸めると左右にずれるので、本人の位置を先に丸めてから、
 * 裂け目はそこから 8 ドット内側に置く((48-32)/2 = 8)
 */
function startKingEscape(cx, cy) {
  clearKingEscape();
  const manX = snap8(cx - KING_MAN_W / 2);
  const x = manX + (KING_MAN_W - 32) / 2;
  const y = cy;
  // 評価の文字(レイヤー 4)より奥に出す。BG スプライトはレイヤーと同じ
  // 優先度の並びに入るので、priority 4 = 「レイヤー 4 の手前」ではなく
  // 「レイヤー 4 を描く直前」= 文字の下になる
  const rift = mmsxx.bgSprite(BG_SYMBOLS.kingRiftBlueThin);
  rift.priority = 4;
  rift.x = x; rift.y = Math.round(y) - 24;
  // 本人は**ふつうのスプライト**。BG スプライトだと 8 ドット刻みで
  // カクカク昇ってしまうので、1 ドット単位で滑らかに動かす
  const man = mmsxx.sprite(SPRITE_SYMBOLS.kingMan01);
  man.priority = 8;
  man.x = Math.round(cx - KING_MAN_W / 2); man.y = Math.round(y) + 40;
  kingEscape = { t: 0, rift, man, x: cx - KING_MAN_W / 2, y };
}
function clearKingEscape() {
  if (!kingEscape) return;
  mmsxx.removeBgSprite(kingEscape.rift);
  if (kingEscape.man) mmsxx.removeSprite(kingEscape.man);
  kingEscape = null;
}
function updateKingEscape() {
  const e = kingEscape;
  if (!e) return;
  e.t++;
  const t = e.t / KING_ESCAPE_LEN;
  // 裂け目: **蛍光灯のように不規則に点滅させて、消さずに残す**。
  // 消えている 2 コマ : 出ている 1 コマ を基本にして、
  // その「出ている 1 コマ」もときどき飛ばす(規則的だと機械に見える)。
  // 見た目だけの話なので、乱数は**ゲームの流れとは別の Math.random**を使う
  e.rift.blink = 0;
  e.rift.visible = t > 0.05 && (mmsxx.frame % 3) === 0 && Math.random() > 0.25;
  // 本人: 下から昇ってきて、裂け目の中へ入っていく。
  // **1:1 で点滅させる**(1 コマ出て 1 コマ消える)。実体が定まらないまま
  // 吸い込まれていく見せかた。裂け目の点滅とは速さを変えてある。
  // 出てくる高さ。**点滅させたぶん存在感が落ちる**ので、
  // 近くから出すのをやめて 1.5 倍の距離を昇らせる
  if (e.man) {
    e.man.blink = 2; e.man.blinkOn = 1;
    e.man.visible = t > 0.3 && t < 0.8;
    const k = Math.min(1, Math.max(0, (t - 0.3) / 0.45));
    e.man.y = e.y + 24 - k * 48;   // 小数のまま。描くときだけ丸められる
  }
  // **裂け目は片づけない**。集計を見ているあいだ、ずっと点滅させておく。
  // 片づけるのは場面が変わるとき(clearEntities)。
  // 入りきった本人だけ、ここで消す
  if (e.t >= KING_ESCAPE_LEN && e.man) {
    mmsxx.removeSprite(e.man);
    e.man = null;
  }
}

// 名乗りの長さ(約 7 秒)ぶん止める。少し余韻を足してある
const TALK_HOLD_FRAMES = 450;
// 画面と曲が止まってから、名乗りが始まるまでの間(2 秒)
const KING_ROAR_WAIT = 120;

/** @param {boolean} [breakable] true なら自機のショットで撃ち落とせる(ボスの弾) */
function fireEnemyBullet(x, y, vx, vy, breakable = false, image = null) {
  // ボスの弾(撃ち落とせる)は 16x16 のリング、通常の敵弾は小さな丸。
  // image を渡すと、その絵の弾になる(ドラゴンの炎など)
  const sp = mmsxx.sprite(image || (breakable ? SPRITE_SYMBOLS.bulletRing : SPRITE_SYMBOLS.bulletE));
  sp.x = x; sp.y = y; sp.priority = 6;
  // **敵の弾は自機の弾より 1 段強い**。避けるための材料なので、
  // 込み合ったときに真っ先に消えてしまうと理不尽になる
  // (自機の弾は 'last'、こちらは既定の 'weak')
  sp.rank = 'weak';
  // リング弾は消えるのではなく、ピンクと薄い赤を 1 コマずつ入れ替えて見せる
  if (breakable && !image) sp.__ringPhase = enemyBullets.length & 1;
  enemyBullets.push({ sp, vx, vy, breakable: breakable && !image });
}

/** レーザー: 一定間隔で停止 -> 溜め演出 -> 太いビームを撃つ */
// いま鳴らしているレーザー音の管理番号(0 = 鳴っていない)。
// くり返し再生は**止め忘れると鳴りっぱなし**になるので、番号を持っておいて
// 撃ち終わり・船が壊れたとき・ボスが消えるときの 3 か所から必ず止める
let laserSEId = 0;

/** レーザーの音を止める(ほかの SE は消さない) */
function stopLaserSE() {
  if (laserSEId) { mmsxx.audio.stopSE(laserSEId); laserSEId = 0; }
}

// 溜めも発射もゆっくりにして、避ける余裕を作る
const OCTO_CHARGE = 220;              // 溜めは長め
const OCTO_FIRE = LASER_FIRE_LEN;
const OCTO_GAP = 420;                 // 撃ち終わってから次の溜めまで

/**
 * **タコ(壺のUFO)の局面。**動きとレーザーで**機械を 2 つ**持つ。
 *
 *   動き    arrive -> swing            ( 壺が割れたら bare )
 *   レーザー wait -> charge -> fire -> wait
 *
 * **並行に走る。**1 つにまとめたら、降りきるまで溜めが始まらなくなり、
 * リリース時と動きが変わってしまった(比較の道具が見つけた)。
 * もとは `charging` と `firing` の**数え上げが残っているか**で表していて、
 * 動きの側も当たり判定の側も `charging > 0 || firing > 0` と書いていた。
 */
/**
 * 左右の往復。**溜めや発射で止まっているあいだは進み方も止めておかないと**、
 * 動き出したときに位置が飛んでしまう(急にワープして見えた原因)。
 * 壺から出たあとは、ゆっくり狭く漂う
 */
function octoSwing(b) {
  b.y = 16;
  // **溜め〜発射中は止まる。**進み方も止めておかないと、
  // 動き出したときに位置が飛んでしまう(急にワープして見えた原因)
  if (b.gun && b.gun.in('charge', 'fire')) return;
  b.swing = (b.swing || 0) + (b.phase2 ? 0.008 : 0.015);
  const target = (SCREEN_W - BOSS_W) / 2 + Math.sin(b.swing) * (b.phase2 ? 18 : 56);
  b.x += (target - b.x) * 0.08;   // 目標へなめらかに寄せる(急に飛ばない)
}

const OCTO_STATES = {
  // HUD のすぐ下に陣取る(画面を広く使えるよう高めの位置)。
  // **降りているあいだもレーザーは溜まる**(別の機械なので)
  arrive: {
    update: (b) => { b.y += 0.5; },
    when: (b) => b.y >= 16,
    next: 'swing',
    exit: (b) => { b.y = 16; },
  },
  // 左右の往復。一度定位置に着いたら上下には動かさない
  // (8 ドット単位スクロールだと、細かい上下動がガタつきに見えるため)
  swing: { update: (b) => octoSwing(b) },
  // **壺から出たあと。**弾を撃たず、体当たりだけで襲ってくる。
  // 局面にしておくと「どれだけ通るか」の表がこの名前で引ける
  bare: {
    viaGo: true,   // 船が壊れたとき(breakShip)
    update: (b) => octoSwing(b),
  },
};

/**
 * **タコのレーザー。**動きとは別に走る。
 * 壺が割れたら止める(呼ぶ側が step しない)
 */
const OCTO_GUN = {
  // 次の溜めまでの間
  wait: { for: (b) => b.laserGap, next: 'charge' },
  // 溜め。砲口の前で光の玉がふくらみ、外の輪が縮んでいく。
  // **溜め〜発射中は本体が止まる**(octoSwing がこの局面を見ている)
  charge: {
    for: OCTO_CHARGE,
    next: 'fire',
    update: (b, f) => {
      // 溜めの音も 0.4 秒のかたまりをくり返す
      if (f.timer % SE_CHUNK === 0) mmsxx.audio.playSE('charging', SE_EVENT + 1);
      const t = 1 - f.timer / OCTO_CHARGE;
      // 白 -> 黄 -> 水色 を 2 コマごとに回して、はっきり分かる明滅にする。
      // 玉と輪は位相をずらして、ぶつかり合うように光らせる
      const c = Math.floor(mmsxx.frame / 2) % 3;
      const cr = (Math.floor(mmsxx.frame / 2) + 2) % 3;
      const orb = t < 0.4 ? SPRITE_SYMBOLS['chargeOrb0' + c]
        : t < 0.75 ? SPRITE_SYMBOLS['chargeOrb1' + c] : SPRITE_SYMBOLS['chargeOrb2' + c];
      const ring = t < 0.4 ? SPRITE_SYMBOLS['chargeRing0' + cr]
        : t < 0.75 ? SPRITE_SYMBOLS['chargeRing1' + cr] : SPRITE_SYMBOLS['chargeRing2' + cr];
      const cx = b.sx + BOSS_W / 2, cy = b.sy + BOSS_H - 4;
      b.charge.image = orb;
      b.charge.visible = true;
      b.charge.x = cx - orb.width / 2;
      b.charge.y = cy - orb.height / 2;
      if (b.chargeRing) {
        b.chargeRing.image = ring;
        b.chargeRing.visible = true;
        b.chargeRing.x = cx - ring.width / 2;
        b.chargeRing.y = cy - ring.height / 2;
        b.chargeRing.blink = 0;   // 消さずに、色だけ 1 コマごとに変える
      }
    },
    exit: (b) => {
      b.chargeSE = false;
      b.toldWeak = false;
      if (b.chargeRing) b.chargeRing.visible = false;
      b.laserLen = 0;
      drawLaser(0);
    },
  },
  // 発射。先端がじわじわ伸び、太さと色も段階で変わる
  fire: {
    for: OCTO_FIRE,
    next: 'wait',
    update: (b, f) => {
      // 発射音は矩形波の和音を 1 回鳴らすだけ(切り分けていない長い SE)。
      // **太いあいだは半音高い音、細くなったら元の高さ**にして、
      // 「弱まった = いまが弱点」を音でも分かるようにする
      const phase = laserPhase(b);
      if (phase === 'full') {
        // レーザーは見せ場なので、ほかの SE より優先して鳴らす。
        // 1 回では撃っている時間に足りないので 3 回くり返す
        if (!b.laserSE) {
          b.laserSE = true;
          // ポーズから戻したら、止めたところの続きから鳴らす
          laserSEId = mmsxx.audio.playSE('laserHi', SE_HIT + 2, { loop: 3, resume: 'continue' });
        }
      } else if (phase === 'fade') {
        if (!b.laserFadeSE) {
          b.laserFadeSE = true;
          stopLaserSE();   // 太いときの音を切ってから、元の高さへ落とす
          laserSEId = mmsxx.audio.playSE('laser', SE_HIT + 2, { loop: 3, resume: 'continue' });
        }
      }
      b.charge.visible = false;
      if (b.chargeRing) b.chargeRing.visible = false;
      const grown = Math.min(LASER_MAX, (OCTO_FIRE - f.timer) * LASER_SPEED);
      let w = LASER_DRAW_W;
      // 効いている帯は白と水色、消えかけは黄と白を 2 コマごとに入れ替えて
      // はっきり明滅させる
      let color = (mmsxx.frame & 2) ? 15 : 7;
      if (phase === 'fade') {
        // 残り時間を 1 ドットぶんずつに割って、確実に 1 ドットずつ細くする
        w = Math.max(1, Math.ceil(f.timer / LASER_FADE_STEP));
        color = (mmsxx.frame & 2) ? 11 : 15;   // 黄と白。ここは当たらない
      }
      b.laserLen = grown;
      drawLaser(grown, w, color);
      // 消えかけに入ったら「いまが弱点」だと知らせる
      if (phase === 'fade' && !b.toldWeak) {
        b.toldWeak = true;
        showNotice('SHOOT THE MUZZLE!');
      }
    },
    // **撃ち終わりで音は必ず止める**
    exit: (b) => {
      stopLaserSE();
      b.laserSE = false;
      b.laserFadeSE = false;
      b.laserLen = 0;
      b.toldWeak = false;
      drawLaser(0);
      b.laserGap = OCTO_GAP;
    },
  },
};

/**
 * **自弾がどれだけ通るかの表。** ボスの種類 × 局面で引く。
 *
 * もとは `armored` / `tough` / `jaws` という真偽値を並べて、入れ子の三項演算子で
 * 決めていた。**どこに何が効くのかが読み取れず**、
 * 「ドラゴンの目の枠が誰にも使われていない」たぐいを見落としていた。
 *
 * 書けるもの(数だけなら、そのまま通る量):
 *
 * | | |
 * |---|---|
 * | `every: n` | **n 発に 1 ダメージ**(硬い装甲) |
 * | `weak` / `hard` | 弱点に当たったか、それ以外か で分ける |
 * | `quiet: true` | 通っても点滅させない(ほんの少ししか通らないので) |
 * | `onWeak: 'muzzle'` | 弱点に当たったら体力ではなく**部位**を削る |
 *
 * `'*'` はその種類の既定。局面の名前があればそちらが勝つ。
 * ノーチラスとラスボスはこの表を通らない(別の当たり判定を持っている)。
 */
const BOSS_HITS = {
  // **通るのは顔だけ。**胴はうねって弾を止める盾(下の当たり判定)。
  // 局面で厚みが変わる ── 突っ込んでくるときが最大の好機
  dragon: {
    charge: DRAGON_JAWS_DMG,                    // 高リスクだが大きく削れる
    // 顔だけ出して構えているあいだは**連射しどき**なのだが、
    // そのまま倒しきれてしまうので硬くしてある。戻りも同じ扱い
    hide: { every: DRAGON_PEEK_EVERY }, telegraph: { every: DRAGON_PEEK_EVERY },
    rest: { every: DRAGON_PEEK_EVERY }, descend: { every: DRAGON_PEEK_EVERY },
    '*': DRAGON_FACE_DMG,                       // 旋回中。それなりに通る
  },
  // 甲羅もハサミも硬い。**脚を折るのが本筋**(脚は別の判定)
  crab: {
    '*': { every: 4 },
    float: 3,                     // 甲羅が割れたら素直に通る
  },
  // 壺に乗っているあいだ、本体はどこを撃ってもほとんど通らない。
  // 効くのは「レーザーを撃っているあいだの発射口」だけで、そこは部位として壊せる
  octopus: {
    '*': { every: 8, quiet: true, onWeak: 'muzzle' },
    bare: 3,                      // 壺が割れたら素直に通る
  },
  // 仮のボスはどこでも当たる
  todo: { '*': 3 },
};

/**
 * **ボスが何をされたかを数える。**局面ごとに数えるので、
 * 「この局面で何発当たったか」が**そのまま試験の言葉になる**。
 *
 *   mmsxxTally()
 *   // { 'man/idle': { head: 14, body: 0, dmg: 112 }, 'man/stun': { ... } }
 *
 * 「きんぐがピヨらない」を追ったとき、当たった先を数えるために手でコードを
 * 埋め込んだ。**最初からこれがあれば数分で済んだ**(答えは「14 発とも頭に
 * 当たっていて、崩しは胴にしか溜まらない」だった)。
 *
 * @param {object} b ボス
 * @param {string} where どこに当たったか(weak / hard / head / body / shield / muzzle / flame / part)
 * @param {number} [dmg] 実際に通った量
 */
let lastTally = null;   // 倒したあとも見られるように、最後のぶんを覚えておく

function tallyHit(b, where, dmg = 0) {
  // **本番では数えない。**遊ぶ人には要らないし、当たるたびに積むのは無駄
  if (!DEV || !b) return;
  // **いちばん細かい局面で引く。**ラスボスは段階と技の 2 段あるので両方
  const st = ((b.fsm && b.fsm.state) || '-') + (b.actFsm ? '/' + b.actFsm.state : '');
  const t = b.tally || (b.tally = { 種類: b.kind });
  lastTally = t;
  const row = t[st] || (t[st] = {});
  row[where] = (row[where] || 0) + 1;
  if (dmg) row.dmg = Math.round(((row.dmg || 0) + dmg) * 10) / 10;
}

/** いまの局面で、自弾がどう通るか。表に無いボスは null */
function bossHitRule(b) {
  const t = b && BOSS_HITS[b.kind];
  if (!t) return null;
  const st = b.fsm && b.fsm.state;
  const r = (st !== undefined && t[st] !== undefined) ? t[st] : t['*'];
  return typeof r === 'number' ? { dmg: r } : (r || null);
}

/**
 * ボスの弱点かどうか。タコはレーザーの発射口、カニロボはハサミの付け根が弱点。
 * 装甲がはがれた第2形態は呼ばれない(全体が弱点になる)。
 */
function isBossWeakPoint(b, x, y, bullet) {
  if (b.kind === 'todo') return true;   // 仮のボスはどこでも当たる
  if (b.kind === 'dragon') {
    // **顔ならどこでも同じ。**目に特別な枠は置かない。
    // 弾が当たるのは頭だけで、うしろに続く節は別に見ている(そちらは盾)
    return true;
  }
  // カニは本体に弱点が無い。狙うのはジャンプ中の脚(別に判定している)
  if (b.kind === 'crab') return false;
  // タコ: 弱点は「レーザーが細くなっていく演出のあいだの発射口」だけ。
  // それ以外は壺ごと完全に無敵で、手のひら(ガード)を壊すしか手が無い。
  // 黄色く細くなっている時間はレーザーに当たり判定が無いので、
  // ここが実際に潜り込めるタイミングになる。
  // 発射口の左右にはガードがあるので、斜めの弾は弾かれる。
  if (laserPhase(b) !== 'fade') return false;
  if (bullet && Math.abs(bullet.vx) > 2.5) return false;   // 斜めの弾は弾く
  const lx = b.sx + LASER_X;
  return x > lx && x < lx + LASER_W && y > b.sy + HEAD_H;
}

function updateBoss() {
  const b = boss;
  b.age++;

  if (b.dying > 0) {
    // 死亡が確定した瞬間を覚えておく(撃破タイムはここまで。爆発演出は含めない)
    if (b.deadAt === undefined) b.deadAt = playFrame;
    b.dying--;
    // ラスボスは点滅させず、しゃがみこむ姿を見せながら空間を星空へ戻す
    if (b.kind === 'king') {
      bossVisible = true;
      beginRestoreSpace();
      if (b.man) {
        b.man.frames = null;
        b.man.image = SPRITE_SYMBOLS.kingMan09;      // 崩れ落ちる姿
        // ひざを折ったぶん、少しだけ沈ませる
        b.y += (RIFT_CY - KING_MAN_H / 2 + 10 - b.y) * 0.06;
      }
      if (b.dying % 9 === 0) {
        spawnBoom(b.x + Math.random() * KING_MAN_W, b.y + Math.random() * KING_MAN_H);
        mmsxx.audio.playSE('boom', SE_HIT);
      }
      b.sx = b.x; b.sy = b.y;
      drawBossBody();
      updateRedSpace();
      if (b.dying <= 0) bossDefeated();
      return;
    }
    bossVisible = (b.dying >> 2) % 2 === 0;
    if (b.dying % 7 === 0) {
      spawnBoom(b.x + Math.random() * 40, b.y + Math.random() * 24);
      mmsxx.audio.playSE('boom', SE_HIT);
    }
    if (b.eyeL) b.eyeL.visible = false;
    if (b.eyeR) b.eyeR.visible = false;
    if (b.kind === 'nautilus') {
      for (const g of b.blocks || []) g.sp.visible = false;
      for (const o of b.orbs || []) o.sp.visible = false;
    }
    if (b.eyeL2) b.eyeL2.visible = b.eyeR2.visible = false;
    if (b.mouth) b.mouth.visible = false;
    for (const g of b.guards || []) g.sp.visible = false;
    if (b.charge) b.charge.visible = false;
    if (b.chargeRing) b.chargeRing.visible = false;
    if (b.arms) b.arms.visible = false;
    if (b.brow) b.brow.visible = false;
    if (b.crown) b.crown.visible = false;
    for (const sp of b.clawSps || []) sp.visible = false;
    b.sx = snap8(b.x); b.sy = snap8(b.y);
    drawBossBody();
    if (b.dying <= 0) bossDefeated();
    return;
  }

  // 被弾フラッシュ (ボスのパーツと重ねスプライトをまとめて点滅させる)
  bossVisible = b.flash > 0 ? (b.flash >> 1) % 2 === 0 : true;
  if (b.flash > 0) b.flash--;

  if (b.kind === 'crab') { updateCrabBoss(b); return; }
  if (b.kind === 'nautilus') { updateNautilusBoss(b); return; }
  if (b.kind === 'dragon') { updateDragonBoss(b); return; }
  if (b.kind === 'todo') { updateTodoBoss(b); return; }
  if (b.kind === 'king') { updateKingBoss(b); return; }

  // HUD のすぐ下に陣取る(画面を広く使えるよう高めの位置)。
  // 一度定位置に着いたら上下には動かさない(8 ドット単位スクロールだと
  // 細かい上下動がガタつきに見えるため)。
  // 動きと移り先は OCTO_STATES に書いてある
  b.fsm.step(b);
  // **レーザーは別の機械。**壺が割れたら撃たない
  if (!b.phase2) b.gun.step(b);

  // BG スクロールでボスを動かす。レイヤーは 8 ドット単位なので、
  // 実際に表示される位置(sx, sy)を求めて目のスプライトと当たり判定に使う。
  // BG スプライトは 8 ドット単位に丸められるので、
  // 当たり判定などに使う画面座標もそろえておく
  b.sx = snap8(b.x); b.sy = snap8(b.y);
  drawBossBody();
  b.eyeL.visible = b.eyeR.visible = bossVisible;
  const sink = b.phase2 ? 0 : HEAD_SINK;
  // 置き場所は動かさず、黒目だけを自機のほうへ寄せる
  b.eyeL.x = b.sx + HEAD_DX + 9; b.eyeL.y = b.sy + 9 + sink;
  b.eyeR.x = b.sx + HEAD_DX + 25; b.eyeR.y = b.sy + 9 + sink;
  lookEye(b.eyeL, b.eyeL.x + 8, b.eyeL.y + 8);
  lookEye(b.eyeR, b.eyeR.x + 8, b.eyeR.y + 8);
  // レンズ側の絵は枠とぴったり重ねる
  if (b.eyeL2) {
    b.eyeL2.visible = b.eyeR2.visible = bossVisible;
    b.eyeL2.x = b.eyeL.x; b.eyeL2.y = b.eyeL.y;
    b.eyeR2.x = b.eyeR.x; b.eyeR2.y = b.eyeR.y;
  }
  // まわりを回るガード
  if (b.guards) {
    // ふだんは頭と船をまとめた真ん中を軸に、全体を囲むように回る。
    // レーザーを撃っているあいだは顔のまわりに縮こまって、
    // 発射口を狙う攻撃のじゃまにならないようにする。
    // 縮こまっているあいだ(レーザー発射中)はグーを握って無敵になる
    const tight = b.gun.is('fire');
    b.guardTight = tight;
    const targetR = tight ? GUARD_R_TIGHT : GUARD_R;
    const targetY = b.sy + (tight ? HEAD_H / 2 : BOSS_H / 2) - 8;
    b.guardR = b.guardR === undefined ? targetR : b.guardR + (targetR - b.guardR) * 0.12;
    b.guardY = b.guardY === undefined ? targetY : b.guardY + (targetY - b.guardY) * 0.2;
    const gx = b.sx + BOSS_W / 2 - 8, gy = b.guardY;
    for (const g of b.guards) {
      // 一定の速さではなく、左右の端で速く・手前と奥でゆっくり回して
      // めりはりを出す
      g.angle += GUARD_SPEED * (1 + Math.abs(Math.sin(g.angle)) * 0.8);
      g.sp.visible = bossVisible && !b.phase2 && g.hp > 0;
      g.sp.x = gx + Math.cos(g.angle) * b.guardR;
      g.sp.y = gy + Math.sin(g.angle) * (b.guardR * GUARD_FLAT);
      // 掌は外を向くように、左半分にいるときだけ左右反転する
      g.sp.flipX = Math.cos(g.angle) < 0;
      // 当たったあとしばらく白く点滅させる
      const open = tight ? BG_SYMBOLS.ufoFist : SPRITE_SYMBOLS.ufoGuard;
      if (g.flash > 0) {
        g.flash--;
        g.sp.image = (g.flash & 1)
          ? (tight ? BG_SYMBOLS.ufoFistHit : SPRITE_SYMBOLS.ufoGuardHit) : open;
      } else {
        g.sp.image = open;
      }
    }
  }
  // 王冠。頭のてっぺんに斜めにかぶせる
  if (b.brow) {
    b.brow.visible = bossVisible;
    b.brow.x = b.sx + HEAD_DX + 22; b.brow.y = b.sy - 10 + (b.phase2 ? 0 : HEAD_SINK);
  }
  // 足は壺の中に収まっているので出さない。
  // 壺が壊れたあと(第2形態)は BG の絵(bossHead2)に足が描かれている
  if (b.arms) b.arms.visible = false;

  if (state !== 'play') return;

  // --- レーザー(第1形態のみ): 停止 -> 溜め -> 発射 ---

  // 溜めているあいだ・撃っているあいだは、ほかの攻撃はしてこない
  if (b.gun.in('charge', 'fire')) return;
  // 壺から出たあと(第2形態)は弾を撃たず、体当たりだけで襲ってくる
  if (b.phase2) return;
  // 第1形態のリング弾は、回っているガードが吐き出す。
  // 本体の攻撃はレーザーだけ(ガードを全部壊せば弾は飛んでこなくなる)。
  const gap = Math.max(24, 44 - shotLevel * 2);   // リングは少なめ
  const alive = (b.guards || []).filter(g => g.hp > 0);
  if (alive.length && b.age % gap === 0) {
    const g = alive[Math.floor(rndBoss() * alive.length)];
    const gx2 = g.sp.x + 8, gy2 = g.sp.y + 8;
    const ga = Math.atan2(player.y + 8 - gy2, player.x + 8 - gx2);
    fireEnemyBullet(gx2 - 8, gy2 - 8, Math.cos(ga) * 0.5, Math.sin(ga) * 0.5, true);
  }
}

/**
 * **自弾が当たる相手の表。**「誰と誰が当たるか」をここで一覧にする。
 *
 * もとは 1 組ごとに二重ループを手書きしていて、**関係が 17 か所に散っていた**。
 * 形は全部同じ(箱が重なったら弾が消えて、何かが起きる)なので、
 * **変わるところ ── 箱と、当たったときにすること ── だけ**を書く。
 *
 * | | |
 * |---|---|
 * | `list` | 相手の一覧を返す |
 * | `box`  | 相手の中心と、半分の大きさ `[cx, cy, hw, hh]` |
 * | `hit`  | 当たったときにすること。**弾はここへ来る前に消えている** |
 * | `skip` | 見ないものを外す(撃ち落とせない弾など) |
 *
 * **まだ手書きのまま**: モアイ / ノーチラスの装甲 / ハサミ / カニの脚 /
 * UFO のガード / 隠し場所 / ラスボス / ドラゴンの胴 / ボス本体。
 * どれも部位ごとに効きが違うので、[BOSS_HITS](#) と合わせて追い追い。
 *
 * **まだ当たらないもの**(ここに 1 行足せば当たるようになる):
 * 敵弾どうし / 敵どうし / 敵と敵弾。
 */
const SHOT_HITS = [
  // ふつうの敵。**小惑星は絵が大きいので判定も広い**
  { list: () => enemies, box: (e) => [e.sp.x + 8, e.sp.y + 8, 10, 10],
    hit: (e) => hitEnemy(e, DAMAGE_TABLE[damageLevel - 1], true) },
  // 小惑星。とても硬いぶん、壊すと派手に爆発する
  { list: () => asteroids, box: (a) => [astCX(a), astCY(a), AST_SIZE / 2 - 4, AST_SIZE / 2 - 4],
    hit: (a) => hitAsteroid(a) },
  // ボスの弾。**撃ち落とせるものだけ**
  { list: () => enemyBullets, box: (eb) => [eb.sp.x + 8, eb.sp.y + 8, 7, 7],
    skip: (eb) => !eb.breakable, hit: (eb) => shootDownBullet(eb) },
  // ロケット弾
  { list: () => rockets,
    box: (r) => [r.sp.x + ROCKET_W / 2, r.sp.y + ROCKET_H / 2, ROCKET_W / 2, ROCKET_H / 2],
    hit: (r) => hitRocket(r) },
];

/**
 * 表の 1 行を回す。**当たったら弾は消えて、その弾はそこで終わり**
 * (1 発が 2 つの相手に当たることはない)
 */
function shotsInto(pair) {
  const list = pair.list();
  if (!list || !list.length) return;
  for (const b of [...bullets]) {
    for (const o of [...list]) {
      if (pair.skip && pair.skip(o)) continue;
      const [cx, cy, hw, hh] = pair.box(o);
      if (Math.abs((b.sp.x + 8) - cx) < hw && Math.abs((b.sp.y + 8) - cy) < hh) {
        bulletHits(b);
        pair.hit(o, b);
        break;
      }
    }
  }
}

/** 小惑星に当たったとき。硬いので削り、壊れたら派手に散る */
function hitAsteroid(a) {
  if ((a.hp -= DAMAGE_TABLE[damageLevel - 1]) > 0) { pingAsteroid(a); return; }
  for (let i = 0; i < 4; i++) {
    spawnBoom(a.sp.x + Math.random() * AST_SIZE, a.sp.y + Math.random() * AST_SIZE);
  }
  mmsxx.audio.playSE('bigboom', SE_HIT);
  bigKills++;
  score += 5000;
  spawnPopup(a.sp.x, a.sp.y, 5000);
  mmsxx.removeBgSprite(a.sp);
  if (a.hi) mmsxx.removeSprite(a.hi);
  asteroids.splice(asteroids.indexOf(a), 1);
}

/** 撃ち落とせる敵弾を落としたとき。タコの弾は高得点 */
function shootDownBullet(eb) {
  mmsxx.removeSprite(eb.sp);
  enemyBullets.splice(enemyBullets.indexOf(eb), 1);
  score += 300;
  drawHUD();
}

/** ロケット弾に当たったとき */
function hitRocket(r) {
  r.hp -= DAMAGE_TABLE[damageLevel - 1];
  if (r.hp <= 0) breakRocket(r);
  else { r.flash = 4; mmsxx.audio.playSE('thud', SE_HIT); }
}

function updatePlay() {
  playFrame++;
  if (recordOn()) { tally.frames++; updateRapid(); }
  // 撃破タイムは「弾が当たる状態」のあいだだけ数える
  if (bossTimeCounts()) bossFrames++;
  // ボスラッシュの経過時間(表示は 1/10 秒ごとに更新する)
  if (gameMode() === 'bossrush' && state === 'play' && rushStartFrame >= 0) {
    rushFrames++;
    if (rushFrames % 6 === 0) drawHUD();
  }

  // --- 自機 ---
  if (enterDelay > 0 && --enterDelay === 0) {
    player.visible = true;
    entering = true; // ジングル後半で下から登場
  }
  if (leaving) {
    // ステージクリア: 加速しながら画面の上へ抜けていく
    player.y -= 3.2;
    player.visible = player.y > -20;
  } else if (respawnDelay > 0) {
    // 爆発の余韻。少し間を置いてから下から復帰する
    if (--respawnDelay === 0) respawnPlayer();
  } else if (enterDelay > 0) {
    // 登場待ち。画面外に置いたまま操作も受け付けない
  } else if (state === 'play' && entering) {
    // 登場・復帰演出中: 定位置までせり上がる。
    // 操作もショットも効かず、体当たりでも敵を倒せない(残っている弾も消す)
    for (const b of [...bullets]) removeBullet(b);
    player.y -= 1.6;
    if (player.y <= SCREEN_H - 32) { player.y = SCREEN_H - 32; entering = false; }
    player.visible = true;
    if (invincible > 0) invincible--;
  } else if (state === 'play') {
    const spd = SPEED_TABLE[speedLevel - 1];
    // **パッドレスは毎コマ置き直す**(行き先へ向かう向きを 1 つの口へ流す)。
    // ここから先は十字やパッドと同じ道を通るので、下の移動は何も変わらない
    if (padlessOn && padlessMove) {
      const v = padlessMove.update(player.x + 8, player.y + 8);
      mmsxx.input.setStick('touch', v.x, v.y);
    } else if (traceOn && traceMove) {
      // 遅延ドローも同じ口へ流す(狙いの点は指から遅れて付いてくる)
      const v = traceMove.update(player.x + 8, player.y + 8);
      mmsxx.input.setStick('touch', v.x, v.y);
    }
    // 向きと強さは 1 つの口から(上の「自機の動かしかた」を見ること)
    const st = mmsxx.input.stick(MOVE_SNAP);
    if (st.strength > 0) {
      const power = MOVE_ANALOG ? st.strength : 1;
      const v = spd * MOVE_GAIN * power;
      player.x += Math.cos(st.rad) * v;
      player.y += Math.sin(st.rad) * v;
    }
    player.x = Math.max(0, Math.min(SCREEN_W - 16, player.x));
    player.y = Math.max(20, Math.min(SCREEN_H - 18, player.y));
    if (invincible > 0) {
      invincible--;
      player.visible = (invincible >> 2) % 2 === 0;
    } else {
      player.visible = true;
    }
    // ショット: 連打すれば即座に(上限まで)撃てる。押しっぱなしはゆっくりした自動連射。
    if (mmsxx.input.wasPressed('Space')) {
      fireShot();
    } else if (mmsxx.input.isDown('Space')) {
      // 押しっぱなしの自動連射。? アイテム / MEIJIN 中は間隔がぐっと短くなる
      const gap = autoFire > 0 ? 6 : AUTO_FIRE_INTERVAL;
      if (playFrame - lastShotFrame >= gap) fireShot();
    }
  }

  // **行き先の印。** 出すのは遊びの最中だけ(やられている最中や登場中は消す)。
  // 絵は 16x16 で真ん中に十字が入っているので、行き先から 8 引いて置く
  if (aimSps.length && padlessMove) {
    const playing = (padlessOn || traceOn) && state === 'play' && !paused && !entering;
    // **遊びの最中から外れたら行き先を捨てる。**
    // やられて戻ってきたときに前の行き先が生きていると、
    // 復帰した自機が置いた覚えのないところへ いきなり飛んでいく
    if (!playing && padlessMove.state !== 'idle') padlessMove.stop();
    if (!playing && traceMove && traceMove.state !== 'idle') {
      traceMove.stop();
      clearTracePath();
    }
    // **毎コマ引き直す。** 線の始まりは自機なので、自機が動けば線も動く
    if (traceOn && traceMove) paintTracePath();
    // **なぞる番は印を置かない。**
    // 道は線が丸ごと見せている ── 始まりは自機からつながっているし、
    // 終わりは線の切れたところ。そこに印を足しても、
    // 線に重ねるものが増えるだけだった
    const pts = traceOn ? [] : padlessMove.points;
    // **2 コマごとに赤とピンクを入れ替える。** 止まった赤い十字は
    // 背景の中に埋もれるので、色が動いていること自体を目印にする
    const img = (mmsxx.frame & 2) ? SPRITE_SYMBOLS.aimMark1 : SPRITE_SYMBOLS.aimMark;
    for (let i = 0; i < aimSps.length; i++) {
      const p = (playing && player.visible) ? pts[i] : null;
      aimSps[i].visible = !!p;
      if (p) {
        aimSps[i].image = img;
        aimSps[i].x = Math.round(p.x) - 8; aimSps[i].y = Math.round(p.y) - 8;
      }
    }
  }

  updateBGM();

  // --- 敵出現 / ボス出現 (プレイ中のみ。ゲームオーバー後は増援なし) ---
  // ★が 5 つ集まるまでステージはループして敵を出し続ける
  const stageTime = playFrame % STAGE.length;
  if (stageTime === 0) { waveIndex = 0; cubeIndex = 0; }
  // ステージ開始直後は落ち着いて始められるよう、しばらく敵を出さない
  // ボス戦中も出現予定は読み飛ばす(そうしないとボス撃破後にまとめて湧いてしまう)
  // ラスボスの面は敵を何も出さない(木星の背景だけを見せてボス戦に入る)
  const canSpawn = state === 'play' && !boss && clearTimer <= 0 && bossIntro === 0 &&
    !isLastStage();
  // ステージ開始直後は落ち着いて始められるよう、しばらく何も出さない。
  // キューブは 3 秒、敵は 6 秒たってから出てくる。
  // モアイが出ているあいだは、ほかの敵もアイテムも出さない
  const canCube = canSpawn && playFrame >= INTRO_QUIET && !moaiActive();
  // **挙動確認の面では何も湧かせない。**動くものが混ざると確認台にならない
  const canEnemy = canSpawn && playFrame >= INTRO_QUIET_ENEMY && !moaiActive() && !hitTargets;
  while (waveIndex < STAGE.list.length && STAGE.list[waveIndex].frame <= stageTime) {
    const w = STAGE.list[waveIndex++];
    if (canEnemy) spawnEnemy(w.type, w.x, w.phase);
  }
  while (cubeIndex < STAGE.cubes.length && STAGE.cubes[cubeIndex] <= stageTime) {
    cubeIndex++;
    if (canCube) spawnCubes();
  }
  // 2 面以降は大きな小惑星が流れてくる(壊せない。ぶつかると即死)。
  // 面が進むと同時に出せる数が増える
  // 目玉はステージに 1 回だけ、面の後半になってから 2 体そろって現れる
  // 目玉はステージに 1 回だけ。ボス戦中とボスラッシュでは出さない
  // (裏技の目玉戦で、あとから勝手に増えていくのを防ぐ)
  // 小惑星が出ているあいだは目玉を出さない(画面が混みすぎないよう排他にする)
  if (canEnemy && !eyeSpawned && !bossMode && gameMode() !== 'bossrush' &&
      asteroids.length === 0 && playFrame > EYE_APPEAR) {
    eyeSpawned = true;
    spawnEyeballs();
  }
  updateEyeballs();
  updateShootStars();
  // 裏技の特別な相手は、倒しきったら少し間を置いてから次へ進む。
  // (2 体同時撃破のボーナス演出を最後まで見せたいので 5 秒待つ)
  if (rushSpecial && bossMode && specialEndTimer < 0) {
    const done = rushSpecial === 'eyes' ? eyeballs.length === 0 : !moai;
    if (done) specialEndTimer = 300;
  }
  if (specialEndTimer > 0 && --specialEndTimer === 0) {
    specialEndTimer = -1;
    rushSpecial = null;
    bossDefeatedSpecial();
  }
  // モアイはステージに 1 回。出ているあいだは敵もアイテムも出さない
  if (canEnemy && !moaiSpawned && !boss && !bossMode && stageNo >= 2 &&
      gameMode() !== 'bossrush' && playFrame > MOAI_APPEAR) {
    moaiSpawned = true;
    spawnMoai();
  }
  // モアイも目玉も出ないまま終わりそうなら、どちらかを必ず出す
  if (canEnemy && !eyeSpawned && !moaiSpawned && !boss && !bossMode &&
      gameMode() !== 'bossrush' && playFrame > MUST_APPEAR) {
    if (rnd() < 0.5 && asteroids.length === 0) { eyeSpawned = true; spawnEyeballs(); }
    else { moaiSpawned = true; spawnMoai(); }
  }
  updateMoai();

  // 出現タイミングを 3 つに分け、同時に出せる数(面が進むほど増える)まで湧かせる
  // 目玉が出ているあいだは小惑星を出さない(排他)
  // ロケットが飛んでいるあいだは岩を出さない(画面が混みすぎるため)
  if (canEnemy && stageNo >= 2 && eyeballs.length === 0 && rockets.length === 0 &&
      asteroids.length < maxAsteroids()) {
    const t = playFrame % ASTEROID_INTERVAL;
    if (t === 300 || t === 500 || t === 700) spawnAsteroid();
  }
  updateAsteroids();
  // ロケット弾は 3 面以降、ときどき飛んでくる
  if (canEnemy && stageNo >= 3 && --rocketTimer <= 0) {
    rocketTimer = ROCKET_INTERVAL + Math.floor(rnd() * 300);
    spawnRocket();
  }
  updateRockets();
  updateWeights();
  if (canEnemy) {
    // 跳ね回る敵は宝珠を取るたびに増えていく(面が進むほど上限も上がる)
    if (stars > 0) {
      // 数が少ないと跳ね回る面白さが出ないので、**下限**を決めておく。
      // NORMAL でも 3 匹、HARD は 8 匹までは必ずそろえる
      const least = isNormal() ? BOUNCER_LEAST : BOUNCER_LEAST_HARD;
      const want = Math.max(least, Math.min(16, stars * (1 + Math.floor(stageNo / 2))));
      // 出ていく途中のものは数に入れない(そのぶん次がすぐ出る)
      const now = enemies.reduce((n, e) => n + (e.type === 'E' && !bouncerLeaving(e) ? 1 : 0), 0);
      if (now >= want) bouncerTimer = BOUNCER_INTERVAL;
      else if (--bouncerTimer <= 0) {
        // 足りないぶんは一度にまとめて出す(1 匹ずつだと間が空きすぎる)
        const n = Math.min(3, want - now);
        for (let i = 0; i < n; i++) spawnBouncer();
        bouncerTimer = BOUNCER_INTERVAL;
      }
    } else {
      bouncerTimer = 0; // 次に宝珠を取ったらすぐ出す
    }
    // ワープ機は 2 面以降、ときどき現れる
    if (stageNo >= 2 && --warperTimer <= 0) {
      warperTimer = WARP_INTERVAL + Math.floor(rnd() * 240);
      spawnWarper();
    }
    // 高速直進機は 2 面以降、ときどきまとめて降ってくる
    if (stageNo >= 2 && --dasherTimer <= 0) {
      dasherTimer = DASHER_INTERVAL + Math.floor(rnd() * 180);
      spawnDasher();
    }
    // 壁づたい機は 2 面以降。端に長居させないための相手
    if (stageNo >= 2 && --wallerTimer <= 0) {
      wallerTimer = WALLER_INTERVAL + Math.floor(rnd() * 200);
      spawnWaller();
    }
    // 全方位機は 3 面以降。1 度に 1 機だけ出す
    if (stageNo >= 3 && !enemies.some(e => e.type === 'L') && --spreaderTimer <= 0) {
      spreaderTimer = SPREADER_INTERVAL + Math.floor(rnd() * 240);
      spawnSpreader();
    }
    // 放物線機は 3 面以降、ときどき横から投げ込まれる
    if (stageNo >= 3 && --diverTimer <= 0) {
      diverTimer = DIVER_INTERVAL + Math.floor(rnd() * 200);
      spawnDiver();
    }
    // 光る敵(宝箱)は没にした。処理と絵は残してあるので、
    // 出したくなったらこの if を戻すだけでよい。
    // if (stageNo >= 2 && !enemies.some(e => e.type === 'N') && --glowerTimer <= 0) {
    //   glowerTimer = GLOWER_INTERVAL + Math.floor(Math.random() * 400);
    //   spawnGlower();
    // }
    // 16t のおもりは 3 面以降。ミサイルや岩が出ているあいだは出てこない
    if (stageNo >= 3 && weights.length === 0 && weightQueue === 0 &&
        rockets.length === 0 && asteroids.length === 0 && --weightTimer <= 0) {
      weightTimer = WEIGHT_INTERVAL + Math.floor(rnd() * 500);
      startWeightVolley();
    }
    // 挟み撃ち機はバリアを持っているときだけ、左右ペアで突っ込んでくる
    if (barrierHP > 0 && !boss) {
      const now = enemies.reduce((n, e) => n + (e.type === 'H' ? 1 : 0), 0);
      if (now > 0) rammerTimer = RAMMER_INTERVAL;
      else if (--rammerTimer <= 0) { spawnRammerPair(); rammerTimer = RAMMER_INTERVAL; }
    } else {
      rammerTimer = 0;
    }
  }
  // ★が規定数そろったらボス戦へ
  // ★がそろったらボス登場の演出に入る(敵を止めて BGM を落とし、名前を出してから出現)
  // 最終面: 静かな時間のあと、木星を上から出す
  if (isLastStage() && !boss && !bossMode) {
    if (!dragonSpot && playFrame >= DRAGON_AT) showSkyDragon();
    // 星座が流れ去ったら、**必ず**木星が画面の右から降りてくる。
    // この面だけの背景なので、ボスの前に見せておく
    if (!jupiterShown && playFrame >= JUPITER_AT) showJupiter();
    // ドラゴンが流れ去ってからボスまでの待ち時間に、隠し場所を 2 か所置く。
    // すでに連射中なら「?」は出ないので、そもそも置かない
    // ? の隠し場所は、**ドラゴンの顔が下へ抜けきってから**置く。
    // 星座のすぐそばに置くと、ドラゴンより先に ? が出てしまうことがある
    const dragonGone = !dragonSpot || dragonSpotY() > SCREEN_H;
    // 連射中でも置く(出るものが「?」から輝く $ に変わるだけ)
    if (!secretSpots && playFrame >= SECRET_AT && dragonGone) makeSecretSpots();
    // 星座を見せ終えたころから、長いレーザーが前方から飛んでくる。
    // クリアの演出に入ったら、もう新しくは飛ばさない
    // **ボスを倒したあとは飛ばさない**。倒してから集計に入るまでの間に
    // 撃たれると、宇宙へ戻ったところへ飛んでくる
    if (playFrame >= FAR_BEAM_AT && clearTimer <= 0 && !leaving && !bossCleared &&
        bossIntro <= 0 && --farBeamTimer <= 0) {
      farBeamTimer = FAR_BEAM_GAP + Math.floor(rndBoss() * 40);
      fireFarBeam();
    }
  }
  // ラスボスの面は宝珠を集めず、木星が流れていくのを見せてから登場の演出へ。
  // **場に居座る相手(モアイ・目玉)がいるあいだは入らない**。
  // ボスと重なると画面が分からなくなるので、いなくなるまで待つ
  if (state === 'play' && !boss && !bossMode && clearTimer <= 0 && bossIntro === 0 &&
      !moaiActive() && eyeballs.length === 0 &&
      (stars >= starsNeeded() || (isLastStage() && playFrame >= LAST_STAGE_SHOW))) {
    startBossIntro();
  }
  if (bossIntro > 0) updateBossIntro();
  // ボス戦中の増援 UFO は出さない(敵の種類が増えたので、
  //  UFO 編隊はミスした直後の立て直し用だけにする)
  if (boss) updateBoss();
  updateRedSpace();   // 赤い空間の色をゆらす
  // 回転レーザーはボスの状態にかかわらず飛び続ける(撃ったあとは独立して進む)
  if (kingBeams.length) updateKingBeams();
  if (farBeams.length) updateFarBeams();
  if (kingEscape) updateKingEscape();

  // --- ステージクリア進行 ---
  if (clearTimer > 0) {
    // 何かキーを押したら評価表示を飛ばせる
    if (clearTimer < 900 && (mmsxx.input.wasPressed('Space') ||
        mmsxx.input.wasPressed('Escape'))) {
      clearTimer = 1;
    }
    clearTimer--;
    // ボーナス集計が出そろったところで、シェアに載せる絵を取っておく。
    // 全面クリアで終わったときはこれが最後の 1 枚になる
    // (途中の面のぶんは、次のクリアかミスの絵で置き換わる)
    if (clearTimer === 900) { shareShotSaved = captureShareShot(); shareBackSaved = -1; }
    if (clearTimer <= 0) {
      if (state === 'play') { // ゲームオーバー後は進行しない
        statsStageEnd();
        // 練習モードは同じボスをもう一度出す。
        // **ラスボスだけは練習でもエンディングへ向かう**(そのあとの流れを確かめたい)。
        // モアイなどの特別な相手(面番号が 100 台)は、今までどおりくり返す
        if (bossPractice && stageNo !== LAST_STAGE) startStage();
        else if (gameMode() === 'bossrush') advanceBossRush();
        else if (stageNo >= LAST_STAGE) {
          // 全 5 面クリア。エンディングを見せてから、得点を持って登録へ。
          // クリアしたので、その難度のコンティニューは 1 面へ戻す
          // CONTINUE で遊んでいたときも、覚え先は NORMAL のほうを戻す
          // (ここを gameMode() で引くと 'continue' には覚え先が無く、
          //  クリアしてもタイトルに CONTINUE が残ってしまう)
          if (continueStages[continueKey()] !== undefined) continueStages[continueKey()] = 1;
          allCleared = true;   // ゲームオーバー側で続きを覚え直さないように
          // **ここで絵と音の溜めを止める。**
          // このあとのエンディングまで溜め続けると、そちらがリプレイに流れ、
          // シェアで選べるコマも物語の画面(ほとんど背景色 = 真っ黒)になる。
          // 止めた時点までが最後の絵になり、集計画面までが残る
          freezeCapture(true);
          enterEnding(enterGameOver);
        } else { stageNo++; startStage(); }
      }
      return;
    }
  }

  // --- 敵の行動 ---
  for (const e of [...enemies]) {
    e.age++;
    // **挙動確認の的は動かない。**当てたいところへ必ず当てられるように
    if (e.frozen) continue;
    const sp = e.sp;
    if (e.type === 'D') {
      // キューブ: まっすぐ落ちてくるだけ(自機を追わない・撃ってこない)
      sp.y += e.vy;
    } else if (e.type === 'E') {
      // 跳ね回る敵: 画面の端で反射する。
      // 通常モードで 6 秒たったら反射をやめ、当たった端をそのまま抜けていく
      sp.x += e.vx; sp.y += e.vy;
      if (!bouncerLeaving(e)) {
        if (sp.x <= 0) { sp.x = 0; e.vx = Math.abs(e.vx); }
        if (sp.x >= SCREEN_W - 16) { sp.x = SCREEN_W - 16; e.vx = -Math.abs(e.vx); }
        // 上は**画面のいちばん上**まで跳ねる(HUD にかぶってよい)。
        // 手前で折り返していると、上のほうに逃げ場が残って動きが狭く見える
        if (sp.y <= 0) { sp.y = 0; e.vy = Math.abs(e.vy); }
        if (sp.y >= SCREEN_H - 16) { sp.y = SCREEN_H - 16; e.vy = -Math.abs(e.vy); }
      }
    } else if (e.type === 'J') {
      // 止まって待つ -> 桂馬の位置へ **超高速でまっすぐ移動**、をくり返す。
      // 消えて現れるのではなく、線を引くように動くので目で追える
      if (e.tx !== undefined) {
        // 移動中。決めた先へ、1 コマで大きく進む
        const dx = e.tx - sp.x, dy = e.ty - sp.y;
        const d = Math.hypot(dx, dy);
        if (d <= WARP_SPEED) {
          sp.x = e.tx; sp.y = e.ty;
          e.tx = e.ty = undefined;
          e.wait = WARP_WAIT;
        } else {
          sp.x += (dx / d) * WARP_SPEED;
          sp.y += (dy / d) * WARP_SPEED;
        }
      } else if (--e.wait <= 0) {
        // 自機のいる側へ跳ぶ(桂馬なので斜め前へ)
        e.dir = (player.x + 8 > sp.x + 8) ? 1 : -1;
        let tx = sp.x + WARP_DX * e.dir;
        // 画面の端では跳ぶ向きを折り返す
        if (tx < 0) { tx = 0; e.dir = 1; }
        if (tx > SCREEN_W - 16) { tx = SCREEN_W - 16; e.dir = -1; }
        e.tx = tx; e.ty = sp.y + WARP_DY;
        mmsxx.audio.playSE('hit', SE_HIT);
      }
    } else if (e.type === 'I') {
      // 高速でほぼ直進してくる敵。撃ってこないぶん速い
      sp.y += 4.2;
      sp.x += e.vx;
    } else if (e.type === 'H') {
      // 挟み撃ち機: 画面に入るまでは自機の高さに合わせ、入ったらまっすぐ突っ込む。
      // 速度は最初が速く、だんだん落ちて、最後は等速で流れていく。
      const inside = sp.x > 0 && sp.x < SCREEN_W - 16;
      if (!inside) sp.y += Math.max(-2, Math.min(2, player.y - sp.y));
      else sp.y += Math.max(-0.6, Math.min(0.6, player.y - sp.y));
      const t = Math.min(1, e.age / 90);
      const spd = RAMMER_FAST + (RAMMER_SLOW - RAMMER_FAST) * t;
      sp.x += Math.sign(e.vx) * spd;
    } else if (e.type === 'F') {
      // 下からゆらゆら上がってきて、画面上へ抜けていく(避けやすいようゆっくり)
      sp.y -= 0.7;
      sp.x = e.x0 + Math.sin(e.phase + e.age * 0.045) * 24;
    } else if (e.type === 'G') {
      // 旋回しながらゆっくり近づいてくる。一定時間で追尾をやめ、
      // そのまま慣性で画面外へ抜けていく(自機の上で止まらない)。
      const SPD = 0.9, TURN = 0.035, CHASE = 330;
      if (e.age < CHASE) {
        const want = Math.atan2(player.y - sp.y, player.x - sp.x);
        let diff = want - e.dir;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        e.dir += Math.max(-TURN, Math.min(TURN, diff));
      }
      sp.x += Math.cos(e.dir) * SPD;
      sp.y += Math.sin(e.dir) * SPD;
    } else if (e.type === 'K') {
      // 壁づたい: 端をまっすぐ降りるだけ。高さを合わせて 3WAY を撃つ。
      // 硬くしたぶん、居座る時間が長くなるようゆっくり降ろす
      sp.y += 0.42;
      sp.x = e.side < 0 ? 4 : SCREEN_W - 20;
      if (state === 'play' && !e.noFire && --e.fireTimer <= 0) {
        e.fireTimer = enemyFireGap(WALLER_FIRE);
        const dx = player.x - sp.x, dy = player.y - sp.y;
        const a0 = Math.atan2(dy, dx);
        for (const d of [-0.32, 0, 0.32]) {
          fireEnemyBullet(sp.x, sp.y + 4, Math.cos(a0 + d) * 1.35, Math.sin(a0 + d) * 1.35);
        }
      }
    } else if (e.type === 'L') {
      // 全方位: 画面の縦真ん中まで降りて止まり、時間差で 2 周ぶん撃つ
      if (sp.y < e.stopY) {
        sp.y += 0.6;
      } else if (e.wait > 0) {
        e.wait--;
      } else if (e.fired < SPREADER_SHOTS * SPREADER_ROUNDS) {
        if (state === 'play' && !e.noFire && --e.fireTimer <= 0) {
          e.fireTimer = SPREADER_GAP;
          // 1 発ずつ時間をずらして、渦を巻くように出す。
          // 2 周目は半分ずらして、1 周目のすき間を埋める
          const round = Math.floor(e.fired / SPREADER_SHOTS);
          const i = e.fired % SPREADER_SHOTS;
          const a0 = (Math.PI * 2 * i) / SPREADER_SHOTS
            + (round * Math.PI) / SPREADER_SHOTS;
          fireEnemyBullet(sp.x, sp.y, Math.cos(a0) * 1.1, Math.sin(a0) * 1.1);
          e.fired++;
        }
      } else {
        sp.y += 1.1;   // 撃ち終わったら降りて去る
      }
    } else if (e.type === 'M') {
      // 放物線: 投げ上げられたように入ってきて、重力で戻り、上へ抜ける
      sp.x += e.vx;
      sp.y += e.vy;
      e.vy -= 0.045;      // 下向きの勢いが弱まり、やがて上へ抜ける
      if (state === 'play' && !e.noFire && --e.fireTimer <= 0) {
        e.fireTimer = enemyFireGap(DIVER_FIRE);
        const dx = player.x - sp.x, dy = player.y - sp.y;
        const d = Math.hypot(dx, dy) || 1;
        fireEnemyBullet(sp.x, sp.y + 4, dx / d * 1.5, dy / d * 1.5);
      }
    } else if (e.type === 'N') {
      // 光る敵: ふわふわ浮いているだけ。撃たれるほど殻が開いていく
      sp.y += (e.y0 - sp.y) * 0.02;
      sp.x = e.x0 + Math.sin(e.phase + e.age * 0.024) * 20;
      const t = 1 - e.hp / e.max;
      sp.image = t > 0.66 ? BG_SYMBOLS.glower2 : t > 0.33 ? BG_SYMBOLS.glower1 : SPRITE_SYMBOLS.glower0;
      // 開くほど強く光る(明滅を速くする)
      sp.blink = t > 0.66 ? 2 : 0;
      if (--e.life <= 0) sp.y -= 2.4;   // 時間が来たら上へ去る
    } else if (e.type === 'A') {
      sp.y += 1.2;
      sp.x = e.x0 + Math.sin(e.phase + e.age * 0.05) * 30;
      if (state === 'play' && !e.noFire && --e.fireTimer <= 0) {
        e.fireTimer = enemyFireGap(45);
        if (sp.y < player.y - 40) {
          // 自機を狙う弾
          const dx = player.x - sp.x, dy = player.y - sp.y;
          const d = Math.hypot(dx, dy) || 1;
          fireEnemyBullet(sp.x, sp.y + 8, dx / d * 1.44, dy / d * 1.44);
        }
      }
    } else {
      // UFO 編隊: 全員が同じ揺れ方をすると一塊に見えるので、
      // 縦位置を「今いる X」から決めて、先頭の通った軌道を後続がなぞる形にする
      sp.x += 1.4 * e.phase;
      sp.y = 16 + Math.sin(sp.x * 0.05) * 16 + e.age * 0.22;
      if (state === 'play' && !e.noFire && --e.fireTimer <= 0) {
        e.fireTimer = enemyFireGap(38);
        fireEnemyBullet(sp.x, sp.y + 8, 0, 1.76);
      }
    }
    // 画面外に去った敵を片付ける。跳ね回る敵 E は画面内に留まるので対象外だが、
    // 反射をやめて出ていくものは、外に出たところで片付ける。
    // 追ってくる敵 G はいつまでも居座らないよう寿命を持たせる。
    // 画面外の判定は緩めにする(隊列は画面の外に積まれた状態から入ってくるため)
    const gone = sp.y > SCREEN_H + 20 || sp.y < -90 || sp.x < -200 || sp.x > SCREEN_W + 200;
    const stays = e.type === 'E' && !bouncerLeaving(e);
    if (!stays && (gone || (e.type === 'G' && e.age > 1200))) {
      mmsxx.removeSprite(sp);
      enemies.splice(enemies.indexOf(e), 1);
    }
  }

  // --- 弾の移動 ---
  for (const b of [...bullets]) {
    b.sp.x += b.vx; b.sp.y += b.vy;
    // 2 コマに 1 回だけ表示する(位相を弾ごとにずらしてバラつかせる)
    b.sp.visible = ((mmsxx.frame + b.phase) & 1) === 0;
    if (b.sp.y < -12 || b.sp.y > SCREEN_H + 12 || b.sp.x < -8 || b.sp.x > SCREEN_W + 8) {
      removeBullet(b);
    }
  }
  for (const b of [...enemyBullets]) {
    // リング弾は 3 コマごとに色を入れ替える(ピンク <-> 水色)
    if (b.breakable) {
      b.sp.image = ((Math.floor(mmsxx.frame / 3) + (b.sp.__ringPhase || 0)) & 1)
        ? SPRITE_SYMBOLS.bulletRingCyan : SPRITE_SYMBOLS.bulletRing;
    }
    // **挙動確認の的は動かない**(追いかけもしない)
    if (b.frozen) continue;
    // リング弾(撃ち落とせる弾)は、ゆっくり自機の方へ向きを変える
    // 自機より下まで来たら追うのをやめる(引き返してこない)
    if (b.breakable && state === 'play' && b.sp.y < player.y) {
      const dx = (player.x + 8) - (b.sp.x + 8);
      const dy = (player.y + 8) - (b.sp.y + 8);
      const d = Math.hypot(dx, dy) || 1;
      const HOME = 0.009;  // 追いかける強さ(小さいほどゆるい)
      b.vx += (dx / d) * HOME;
      b.vy += (dy / d) * HOME;
      // 速くなりすぎないように上限をかける
      const sp = Math.hypot(b.vx, b.vy), MAX = 0.8;   // 追尾しても速くなりすぎない
      if (sp > MAX) { b.vx = b.vx / sp * MAX; b.vy = b.vy / sp * MAX; }
    }
    b.sp.x += b.vx; b.sp.y += b.vy;
    const off = b.sp.y > SCREEN_H + 8 || b.sp.y < -8 || b.sp.x < -8 || b.sp.x > SCREEN_W + 8;
    // キューブは敵の弾も受け止める(盾として使える)
    const blocked = !off && enemies.some(e =>
      e.type === 'D' && Math.abs(b.sp.x - e.sp.x) < 10 && Math.abs(b.sp.y - e.sp.y) < 10);
    if (off || blocked) {
      if (blocked) mmsxx.audio.playSE('clink', SE_HIT);
      mmsxx.removeSprite(b.sp); enemyBullets.splice(enemyBullets.indexOf(b), 1);
    }
  }

  // --- アイテム ---
  for (const it of [...items]) {
    it.age++;
    if (it.drift > 0) {
      // 四方へゆっくり散っていくアイテム(重力を受けない)。
      // 散り終わったら、そこからはふつうに落ちてくる
      it.drift--;
      it.sp.x += it.vx;
      it.sp.y += it.vy;
      it.vx *= 0.995; it.vy *= 0.995;
      if (it.drift === 0) { it.vx = 0; it.vy = 0; }
    } else if (it.vy || it.vx) {
      // 放り上げたアイテム。山なりに飛んで、落ちてくる。
      // 落ちる速さがふつうのアイテムに追いついたら、そこからは同じ動き
      it.vy = Math.min(0.8, it.vy + 0.08);
      it.sp.x += it.vx;
      it.sp.y += it.vy;
      it.vx *= 0.99;
      if (it.vy >= 0.8) { it.vy = 0; it.vx = 0; }
    } else {
      it.sp.y += 0.8;
      it.sp.x += Math.sin(it.age * 0.08) * 0.8;
    }
    // 点滅させる。P アイテムはパワー最大だとボム扱いなので見た目もボムにする
    const look = (it.kind === 'power' && shotLevel >= MAX_POWER) ? 'bomb' : it.kind;
    if (it.kind === 'candy') {
      // 飴だけは白との点滅ではなく、**2 色を 2 コマずつ入れ替える**。
      // ピンクと水色が交互に入れ替わって、包み紙がきらきらして見える
      it.sp.image = ITEM_IMG[look];
      it.sp.colorMap = (mmsxx.frame & 2) ? CANDY_SWAP : null;
    } else if (it.kind === 'coinmax') {
      // 輝く $。白と点滅させず、**色を回して**光っているように見せる
      it.sp.image = COINMAX_IMAGES[(mmsxx.frame >> 1) % COINMAX_IMAGES.length];
    } else if (it.kind === 'star') {
      // 宝珠は白と点滅させず、**七色に回す**
      it.sp.image = ORB_IMAGES[(mmsxx.frame >> 1) % ORB_IMAGES.length];
    } else {
      it.sp.image = (mmsxx.frame & 1) ? ITEM_IMG[look] : ITEM_IMG_W[look];
    }
    const take = state === 'play' &&
      Math.abs(it.sp.x - player.x) < 12 &&
      Math.abs(it.sp.y - player.y) < 12;
    if (take) {
      mmsxx.audio.playSE('item');
      statsItem(it.kind);
      blinkGear(it.kind); // 対応する HUD の項目をしばらく点滅させる
      // $ の連鎖は「$ を取りそこねる」かミスするまで続く
      if (it.kind !== 'coin' && it.kind !== 'coinmax') score += 500;
      switch (it.kind) {
        case 'coin': {
          score += coinValue;
          // いくら入ったかを毎回出す(100 点でも表示)
          spawnPopup(it.sp.x - 8, it.sp.y, coinValue);
          coinChainBest = Math.max(coinChainBest, coinValue);
          if (coinValue >= COIN_TOP) {
            // 打ち止めの 102400 点を取ったら 1UP と同じファンファーレ
            showNotice('CHAIN MAX!');
            playJingle('fanfare');
            coinValue = COIN_BASE;          // 次からまた 100 点
          } else {
            coinValue = Math.min(COIN_TOP, coinValue * 2);
          }
          break;
        }
        case 'coinmax':
          // 連鎖の打ち止めと同じ点。連鎖そのものは動かさない
          score += COIN_TOP;
          spawnPopup(it.sp.x - 8, it.sp.y, COIN_TOP);
          coinChainBest = Math.max(coinChainBest, COIN_TOP);
          showNotice('CHAIN MAX!');
          playJingle('fanfare');
          break;
        case 'auto':
          autoFire = AUTO_FIRE_TIME;
          showNotice('AUTO FIRE');
          // 「?」から出る特別なアイテムなので、専用の短い音を鳴らす
          mmsxx.audio.playSE('autofire', SE_JINGLE);
          break;
        case 'candy': {
          // 見逃したお礼の飴。**取るたびに倍々**(100 -> 200 -> 400 …)。
          // 続けて拾うほど大きくなるので、全部拾う値打ちがある
          candyCombo++;
          // 100 から倍々(100, 200, 400 … 51200)
          const gain = Math.min(CANDY_MAX, 100 * Math.pow(2, candyCombo - 1));
          score += gain;
          spawnPopup(it.sp.x, it.sp.y, gain);
          if (--candyLeft > 0) {
            mmsxx.audio.playSE('item');
          } else {
            // 最後の 1 つ。ファンファーレと、画面の真ん中に知らせを出して締める
            showNotice('ALL CANDIES!  THANK YOU!', 180, BEG_TEXT_Y);
            playJingle('fanfare');
          }
          break;
        }
        case 'dragon':
          // そらのドラゴンが力を分けてくれる。
          // 推進炎が緑になって一回り大きくなり、当たり判定も広がる。
          // これはスピードの段階と関係なく、やられても消えない。
          // **配るのは炎とバリアだけ**。ショットや速さまで最強にすると、
          // ここから先が別のゲームになってしまう
          dragonFlame = true;
          barrierHP = MAX_BARRIER;
          drawHUD();
          mmsxx.audio.playSE('item');
          showNotice('DRAGON FLAME!');   // ほかのアイテムと同じ下の行に出す
          // 1UP と同じくらい大きな当たりなので、同じジングルで祝う
          playJingle('fanfare');
          break;
        case 'star':
          stars++; score += 500;
          showNotice('ORB ' + stars + '/' + starsNeeded());
          break;
        case 'bomb':
          bombAllEnemies();
          showNotice('BOMB!');
          break;
        case 'speed':
          speedLevel = Math.min(SPEED_TABLE.length, speedLevel + 1);
          showNotice('SPEED UP ' + speedLevel);
          break;
        case 'rapid':
          maxVolleys = Math.min(MAX_VOLLEY_LIMIT, maxVolleys + 1);
          rapidClean = false;   // ここから先の連射は腕前ではないので数えない
          showNotice('RAPID FIRE ' + maxVolleys);
          break;
        case 'life':
          ships = Math.min(MAX_SHIPS, ships + 1);
          showNotice('1UP!');
          // BGM をいったん黙らせてファンファーレを鳴らす(終わったら元の曲に戻る)
          playJingle('fanfare');
          break;
        case 'damage':
          damageLevel = Math.min(DAMAGE_TABLE.length, damageLevel + 1);
          showNotice('POWER SHOT ' + damageLevel);
          break;
        case 'barrier':
          // 通常モードは 1 回取ると満タンになる(減っていても回復する)
          barrierHP = isNormal() ? MAX_BARRIER : Math.min(MAX_BARRIER, barrierHP + 1);
          showNotice('BARRIER ' + barrierHP);
          break;
        default: // power: 最大なら画面上の敵を一掃するボムになる
          if (shotLevel >= MAX_POWER) { bombAllEnemies(); showNotice('BOMB!'); }
          else { shotLevel++; showNotice('WIDE SHOT ' + shotLevel); }
      }
      drawHUD();
    }
    // $ を取りそこねて画面外へ落ちると、そこで連鎖が切れる
    if (!take && it.kind === 'coin' && it.sp.y > SCREEN_H + 12) {
      coinValue = COIN_BASE;   // 表示は出さない
    }
    if (take || it.sp.y > SCREEN_H + 12) {
      mmsxx.removeSprite(it.sp);
      items.splice(items.indexOf(it), 1);
    }
  }

  // --- 当たり判定: 自弾 vs ふつうの相手 ---
  // **形がそろっているものは表で持つ。**下に続く「ボスの部位」は
  // それぞれ事情が違うので、いまは手書きのまま(一覧は SHOT_HITS の上に書いた)
  for (const pair of SHOT_HITS) shotsInto(pair);

  // --- 当たり判定: 自弾 vs 目玉 ---
  for (const b of [...bullets]) {
    for (const e of [...eyeballs]) {
      if (Math.abs((b.sp.x + 8) - (e.sp.x + EYE_SIZE / 2)) < EYE_SIZE / 2 &&
          Math.abs((b.sp.y + 8) - (e.sp.y + EYE_SIZE / 2)) < EYE_SIZE / 2) {
        bulletHits(b);
        e.hp -= 1;   // 攻撃力によらず 1 発 1 ダメージ
        if (e.hp <= 0) killEyeball(e);
        else mmsxx.audio.playSE('hit', SE_HIT);
        break;
      }
    }
  }

  // --- ハサミミサイル(カニロボ) ---
  updateClawMissiles();
  for (const b of [...bullets]) {
    for (const m of [...clawMissiles]) {
      // ハサミは 64x48。見た目どおりの大きさで当たる
      if (Math.abs((b.sp.x + 8) - (m.sp.x + CRAB_CLAW_W / 2)) < CRAB_CLAW_W / 2 &&
          Math.abs((b.sp.y + 8) - (m.sp.y + CRAB_CLAW_H / 2)) < CRAB_CLAW_H / 2) {
        bulletHits(b);
        m.hp -= DAMAGE_TABLE[damageLevel - 1];
        if (m.hp <= 0) {
          // 壊したハサミは二度と生えてこない(武器を 1 つ奪える)
          if (boss && boss.kind === 'crab') killCrabClaw(boss, m.from);
          removeClawMissile(m, true);  // 壊すと弾が散る
        }
        else mmsxx.audio.playSE('clink', SE_HIT);
        break;
      }
    }
  }

  // --- 当たり判定: 自弾 vs モアイ ---
  // 合体前は切り口(内側)だけが効く。合体後はどこでも効くが、とても固い。
  // **白と灰色の石のあいだ(色が付く前)は、内側でも外側でもダメージは入らない。
  //   ただし撃ち込み続けると怒る**(手を出さずに待つのが正解)
  // 弾がすり抜ける場面:
  //   ・四隅で構えているあいだ(まだ動き出していない)
  //     出てきたところを撃っただけで怒らせてしまわないため
  //   ・逃げていくあいだ(もう手出しできないので、当たっても意味がない)
  if (moai && !moai.fsm.in('leave', 'hold')) {
    for (const b of [...bullets]) {
      for (const p of [...moai.parts]) {
        const w = moaiShape(moai) === 'q4' ? MOAI_QW : MOAI_W;
        const h = moaiShape(moai) === 'one' ? MOAI_H : MOAI_QH;
        const bx = b.sp.x + 8, by = b.sp.y + 8;
        if (bx < p.sp.x || bx > p.sp.x + w || by < p.sp.y || by > p.sp.y + h) continue;
        bulletHits(b);
        const inner = moaiInnerHit(moai, p, bx, by);
        // 怒らせたあとは、どこを撃っても通らない。
        // **点滅もさせない**(効いているように見えて、撃ち続けてしまうため)
        if (moai.angry) { mmsxx.audio.playSE('nobreak'); break; }
        // まだ石のあいだ(色が付く前)。ダメージは入らない。
        // **左右がくっついたあと**に切り口(内側)を狙い撃つと怒る。
        // よーいドンの前に手を出した罰。四隅のあいだ(まだ形になっていない)と
        // 外側は、何発当てても弾かれるだけ
        if (moaiSafe(moai)) {
          // 切り口を撃ってしまったときは、**専用の調子はずれな音**で知らせる。
          // 「いま撃つと怒らせる」ことを音で気づかせたい
          if (inner && moaiShape(moai) === 'q2') {
            mmsxx.audio.playSE('scold', SE_HIT);
            angerMoai(moai);
          } else {
            mmsxx.audio.playSE('armor');
          }
          break;
        }
        // 色が付いてからは、外側はただ弾かれるだけ(もう怒らない)
        if (!inner) {
          mmsxx.audio.playSE('armor');
          break;
        }
        const dmg = DAMAGE_TABLE[damageLevel - 1];
        if (moaiShape(moai) === 'one') {
          moai.hp -= dmg;
          tallyHit(moai, 'body', dmg);
          p.flash = 4;
          mmsxx.audio.playSE('weak');
          spawnWeakSpark(b.sp.x, b.sp.y);
          if (moai.hp <= 0) {
            for (let i = 0; i < 8; i++) {
              spawnBoom(moai.x + Math.random() * MOAI_W, moai.y + Math.random() * MOAI_H);
            }
            mmsxx.audio.playSE('bossboom', SE_HIT);
            flashTimer = 3;
            score += 20000;
            spawnPopup(moai.x, moai.y + 24, 20000);
            bigKills++;
            clearMoai();
          }
        } else {
          // 上下 2 つのときは、どちらを撃っても同じ体力を削る(一心同体)
          moai.insideHp -= dmg;
          tallyHit(moai, 'inside', dmg);
          p.flash = 4;
          mmsxx.audio.playSE('guardhit', SE_HIT);
          spawnWeakSpark(b.sp.x, b.sp.y);
          if (moai.insideHp <= 0) { killMoaiInside(); break; }
        }
        break;
      }
      if (!moai) break;
    }
  }

  // --- 当たり判定: 自弾 vs ノーチラスの装甲と生き物 ---
  if (boss && boss.kind === 'nautilus' && boss.dying <= 0) {
    const inside = nautilusInside(boss);
    for (const b of [...bullets]) {
      const bx = b.sp.x + 8, by = b.sp.y + 8;
      let done = false;
      for (const g of boss.blocks) {
        if (!g.alive) continue;
        // ふつうの装甲は見た目より小さめ(すき間を弾が通り抜けられる)。
        // 黄色い装甲だけは狙いやすいよう大きめにとる
        const r = g.weak ? 11 : 6;
        if (Math.abs(bx - (g.sp.x + 8)) > r || Math.abs(by - (g.sp.y + 8)) > r) continue;
        bulletHits(b);
        done = true;
        if (!g.weak || boss.phase2) { tallyHit(boss, 'armor'); mmsxx.audio.playSE('armor'); break; }
        // 弱点の装甲だけがへこむ。攻撃力によらず 1 発 1 ダメージ。
        // 本体の体力(ゲージ)は減らない
        boss.weakHp -= 1;
        tallyHit(boss, 'panel', 1);
        // ほかの当たり音と区別できるよう、パネル用の音にする
        mmsxx.audio.playSE('panel', SE_HIT);
        spawnWeakSpark(b.sp.x, b.sp.y);
        spawnBoom(b.sp.x - 4, b.sp.y - 4);   // 当たるたびに小さく爆ぜる
        // 最初に当てたときだけ、狙いどころを教える
        if (!boss.toldWeak) {
          boss.toldWeak = true;
          showNotice('BREAK YELLOW GUARD!');
        }
        if (boss.weakHp <= 0) {
          // 装甲が外れて、輪にすき間が空く = 中へ入り込めるようになる
          g.alive = false;
          g.sp.visible = false;
          boss.phase2 = true;
          boss.fsm.go('core', boss);       // 輪も電撃も止まり、その場から動かない
          boss.ringTarget = NAUT_R_WIDE;   // 輪が広がって入りやすくなる
          // 中の生き物を直に叩けるようになった = 狙いどき(上の cueRubHint)
          cueRubHint('nautilus');
          for (let i = 0; i < 5; i++) spawnBoom(g.sp.x, g.sp.y);
          mmsxx.audio.playSE('bossboom', SE_HIT);
          flashTimer = 3;
        }
        break;
      }
      if (done) continue;
      // 貝に効くのは「真下から入った弾」だけ。
      // 斜めにかすめた弾でうっかり装甲の削りが戻らないようにする
      const ccx = boss.x + NAUT_CORE / 2, ccy = boss.y + NAUT_CORE / 2;
      if (Math.abs(bx - ccx) > 20) continue;
      if (Math.abs(by - ccy) > 20) continue;
      if (by < ccy) continue;                    // 下側から来た弾だけ
      if (Math.abs(b.vx) > 2.5) continue;        // 斜めの弾は通らない
      bulletHits(b);
      if (!boss.phase2) {
        // ガードのすき間を抜けた弾は、中の貝にごく小さなダメージ(2 発で 1)。
        // ただし生き物が身をよじるので、弱点の装甲は直ってしまう(削りは 0 に戻る)
        boss.gapHits = (boss.gapHits || 0) + 1;
        if (boss.gapHits % 2 === 0) boss.hp -= 1;
        boss.flash = 4;
        mmsxx.audio.playSE('weak');
        // 本体に当てると装甲の削りは 0 に戻る(音だけで知らせる)
        if (boss.weakHp < NAUT_WEAK_HITS) {
          boss.weakHp = NAUT_WEAK_HITS;
          mmsxx.audio.playSE('powerdown');
        }
        if (boss.hp <= 0) {
          boss.dying = 90;
          clearChicks(boss);   // 気絶のひよこを残さない
          kingCancelStun(boss);
          mmsxx.audio.stopBGM();
          mmsxx.audio.playSE('bossboom', SE_HIT);
        }
        continue;
      }
      // 中に入って撃つぶんは、すき間ごしの小ダメージの 2 倍。
      // 装備によらず一定なので、あっという間に終わらない
      const nautDmg = inside ? 2 : 1;
      boss.hp -= nautDmg;
      // **中へ入って撃ったか、すき間ごしか**が分かれる
      tallyHit(boss, inside ? 'core' : 'gap', nautDmg);

      boss.flash = 6;
      mmsxx.audio.playSE('weak');
      spawnWeakSpark(b.sp.x, b.sp.y);
      if (boss.hp <= 0) {
        boss.dying = 90;
        clearChicks(boss);   // 気絶のひよこを残さない
        kingCancelStun(boss);
        mmsxx.audio.stopBGM();
        mmsxx.audio.playSE('bossboom', SE_HIT);
      }
    }
  }

  // --- 当たり判定: 自弾 vs 本体に付いたハサミ ---
  // ハサミはとても硬いが、撃ち続ければ部位破壊できる(武器を 1 つ奪える)
  if (boss && boss.kind === 'crab' && boss.partClaws && !boss.phase2 &&
      boss.dying <= 0) {
    for (const b of [...bullets]) {
      for (let i = 0; i < boss.partClaws.length; i++) {
        const sp = boss.partClaws[i];
        if (!sp.visible || !boss.clawAlive[i]) continue;
        // 生えかけのハサミは、伸びたぶんだけしか当たらない。
        // (撃ったあとや壊したあと、見えないところに当たっていた)
        const grow = boss.grow[i] / CRAB_CLAW_GROW;
        if (grow < 0.5) continue;
        const w = Math.round(CRAB_CLAW_W * Math.min(1, grow));
        const bx = b.sp.x + 8, by = b.sp.y + 8;
        // 根元は胴体側。伸びた先までが当たる範囲
        const x0 = sp.flipX ? sp.x + CRAB_CLAW_W - w : sp.x;
        if (bx < x0 + 8 || bx > x0 + w - 8) continue;
        if (by < sp.y + 8 || by > sp.y + CRAB_CLAW_H - 8) continue;
        bulletHits(b);
        boss.clawHp[i] -= BOSS_DMG;
        tallyHit(boss, 'claw', BOSS_DMG);
        mmsxx.audio.playSE('guardhit', 1);
        spawnWeakSpark(b.sp.x, b.sp.y);
        if (boss.clawHp[i] <= 0) {
          // ハサミが根元からもげる。二度と生えてこない
          boss.clawHp[i] = CRAB_CLAW_HP;
          killCrabClaw(boss, i);
          for (let k = 0; k < 6; k++) {
            spawnBoom(sp.x + Math.random() * CRAB_CLAW_W, sp.y + Math.random() * CRAB_CLAW_H);
          }
          mmsxx.audio.playSE('bigboom', SE_HIT);
          flashTimer = 3;
          score += 3000;
          spawnPopup(sp.x, sp.y, 3000);
        }
        break;
      }
    }
  }

  // --- 当たり判定: 自弾 vs カニの脚 ---
  // 脚は壁から離れているジャンプ中だけ狙える。ここが本当の弱点で、
  // 硬いハサミや装甲を削るより、脚を 1 本ずつ折るほうがずっと速い。
  if (boss && boss.kind === 'crab' && boss.legs && !boss.phase2 &&
      boss.dying <= 0 && boss.fsm.is('jump')) {
    for (const b of [...bullets]) {
      for (const lg of boss.legs) {
        if (lg.hp <= 0) continue;
        // 脚は BG スプライト。見えている位置(8 ドットに丸めたもの)で判定する
        if (Math.abs((b.sp.x + 8) - (snap8(lg.sp.x) + 12)) < 13 &&
            Math.abs((b.sp.y + 8) - (snap8(lg.sp.y) + 8)) < 8) {
          bulletHits(b);
          lg.hp -= BOSS_DMG;
          tallyHit(boss, 'leg', BOSS_DMG);
          // 脚に当たったことがはっきり分かる光と音
          spawnWeakSpark(lg.sp.x, lg.sp.y);
          mmsxx.audio.playSE(lg.hp <= 0 ? 'bigboom' : 'guardhit', 1);
          if (lg.hp <= 0) {
            lg.sp.visible = false;
            spawnBoom(lg.sp.x, lg.sp.y);
            score += 800;
            // 脚が全部折れると壁につかまれず、中央でふわふわ漂うだけになる
            if (boss.legs.every(x => x.hp <= 0)) breakShip();
          }
          break;
        }
      }
    }
  }

  // --- 当たり判定: 自弾 vs UFO のガード ---
  // グーを握って顔のまわりに集まっているあいだは盾になる。
  // ダメージは入らないが、弾はここで止まる(発射口へ通さない)。
  if (boss && boss.guards && !boss.phase2 && boss.dying <= 0 && boss.guardTight) {
    for (const b of [...bullets]) {
      for (const g of boss.guards) {
        if (g.hp <= 0) continue;
        if (Math.abs((b.sp.x + 8) - (g.sp.x + 8)) < 10 &&
            Math.abs((b.sp.y + 8) - (g.sp.y + 8)) < 10) {
          bulletHits(b);
          mmsxx.audio.playSE('clink', SE_HIT);
          break;
        }
      }
    }
  }
  if (boss && boss.guards && !boss.phase2 && boss.dying <= 0 && !boss.guardTight) {
    for (const b of [...bullets]) {
      for (const g of boss.guards) {
        if (g.hp <= 0) continue;
        if (Math.abs((b.sp.x + 8) - (g.sp.x + 8)) < 10 &&
            Math.abs((b.sp.y + 8) - (g.sp.y + 8)) < 10) {
          bulletHits(b);
          g.hp -= BOSS_DMG;
          tallyHit(boss, 'guard', BOSS_DMG);
          if (g.hp <= 0) {
            g.sp.visible = false;
            spawnBoom(g.sp.x, g.sp.y);
            mmsxx.audio.playSE('boom', SE_HIT);
            score += 500;
            // 全部のガードが無くなったら壺が割れる
            if (boss.guards.every(x => x.hp <= 0)) breakShip();
          } else {
            // 当たったことが分かるように点滅させる(文字は出さず音で伝える)
            g.flash = 8;
            mmsxx.audio.playSE('guardhit');
          }
          break;
        }
      }
    }
  }

  // --- 当たり判定: 自弾 vs 木星の隠し場所 ---
  // 自機はぶつからない。16 発当てると全パワーアップが手に入る
  // --- 当たり判定: 自弾 vs 待ち時間の隠し場所(2 か所) ---
  // 見た目には何も無いところ。当て続けると「?」が出る。
  // 連射中は出ないので、そのときは当たっても何も起きない
  if (secretSpots && !boss && !bossMode && state === 'play') {
    for (const sp of secretSpots) {
      if (sp.done) continue;
      for (const b of [...bullets]) {
        const bx = b.sp.x + 8, by = b.sp.y + 8;
        if (bx < sp.x || bx > sp.x + SECRET_SIZE) continue;
        if (by < sp.y || by > sp.y + SECRET_SIZE) continue;
        bulletHits(b);
        sp.hits++;
        spawnWeakSpark(b.sp.x, b.sp.y);
        mmsxx.audio.playSE('clink', SE_HIT);
        if (sp.hits >= SECRET_NEED) {
          sp.done = true;
          spawnBoom(sp.x + 2, sp.y + 2);
          // すでに連射しているなら、代わりに**輝く $**(連鎖の打ち止めと同じ点)
          dropItem(sp.x + 2, sp.y + 4, autoFire > 0 ? 'coinmax' : 'auto');
          mmsxx.audio.playSE('appear', SE_EVENT);
        }
        break;
      }
    }
  }

  // --- 当たり判定: 自弾 vs そらのドラゴンの顔 ---
  // 16 発当てると、ドラゴンの顔のアイテムが出る。取るとフルパワー。
  // 自機はぶつからない(当たるのは弾だけ)
  if (dragonSpot && !dragonSpot.done && !boss && !bossMode && state === 'play') {
    const sx = dragonSpot.x, sy = dragonSpotY(), n = DRAGON_FACE.size;
    if (sy > -n && sy < SCREEN_H) {
      for (const b of [...bullets]) {
        const bx = b.sp.x + 8, by = b.sp.y + 8;
        if (bx < sx || bx > sx + n || by < sy || by > sy + n) continue;
        bulletHits(b);
        dragonSpot.hits++;
        // 手応えが分かるように、当たった場所で光らせて音を出す
        spawnWeakSpark(b.sp.x, b.sp.y);
        mmsxx.audio.playSE('clink', SE_HIT);
        if (dragonSpot.hits >= DRAGON_FACE.need) {
          dragonSpot.done = true;
          spawnBoom(sx, sy);
          dropItem(sx + 4, sy + 8, 'dragon');
          mmsxx.audio.playSE('appear', SE_EVENT);
        }
        break;
      }
    }
  }

  // --- 当たり判定: 自弾 vs ラスボス ---
  // 裂け目は「256 発当てる」ので、弾の強さに関係なく 1 発 1 ダメージで数える。
  // シルエットマンはふつうに削れる。
  if (boss && boss.kind === 'king' && boss.dying <= 0) {
    const rift = bossIs(boss, 'rift');   // 開ききるまでは当たらない
    const man = bossIs(boss, 'man');
    if (rift || man) {
      const cx = rift ? RIFT_CX : boss.x + KING_MAN_W / 2;
      const cy = rift ? RIFT_CY : boss.y + KING_MAN_H / 2;
      // 裂け目は細長いので、絵よりせまい判定にする(まわりの空間には当たらない)
      const hw = rift ? 14 : KING_MAN_W / 2 - 12;
      const hh = rift ? RIFT_H / 2 - 2 : KING_MAN_H / 2 - 4;
      for (const b of [...bullets]) {
        if (Math.abs((b.sp.x + 8) - cx) >= hw || Math.abs((b.sp.y + 8) - cy) >= hh) continue;
        bulletHits(b);
        if (rift) { hitKingRift(boss, b.sp.x, b.sp.y); continue; }
        // 瞑想中は無敵。弾ははじかれるだけで、点滅もさせない
        // (七色に光っているので、点滅すると何が起きているか分からなくなる)
        if (kingIs(boss, 'meditate')) { mmsxx.audio.playSE('armor'); continue; }
        // 頭に当たると 2 倍。上から攻めるのが効く相手にする
        const head = (b.sp.y + 8) < boss.y + KING_MAN_H * KING_HEAD_RATIO;
        // 頭は 2 倍。さらに近いほど効く(上からの倍率は頭の判定と重なるので入れない)
        const kingDmg = Math.max(1, Math.round(BOSS_DMG * (head ? 2 : 1) * bossDamageMul(boss, false)));
        boss.hp -= kingDmg;
        // **崩しは胴にしか溜まらない。**頭と胴を分けて数えておくと、
        // 「頭ばかり当てていてピヨらない」が数字で見える
        tallyHit(boss, head ? 'head' : 'body', kingDmg);
        // **弾で削ったという印**。座って立て直すのは、これがあるときだけ
        boss.shotSince = true;
        boss.flash = 6;
        // のけぞるポーズと「うっ」。声は連発しないよう、少し間を置く
        if (boss.hurtPose <= 0 && (boss.hurtVoice || 0) <= 0) {
          mmsxx.audio.playTalk('kiaiB', SE_HIT);   // 撃たれたときの声
          boss.hurtVoice = 40;
        }
        if (head) {
          boss.hurtPose = 12;   // 頭に当たるとのけぞる
        } else {
          // 頭以外は腕で受ける。0.5 秒ガードの姿になり、そのぶん足が止まる。
          // 撃たれるほど遅くなり、ほとんど動けなくなると 3 秒その場に固まる。
          // (**後ろへ回り込む隙**を作るための、崩しの仕組み)
          boss.guard = KING_GUARD_LEN;
          if (!kingIs(boss, 'stun', 'meditate')) {
            boss.slowMul = Math.max(0, (boss.slowMul == null ? 1 : boss.slowMul) - KING_SLOW_STEP);
            if (boss.slowMul <= 0.1) {
              if ((boss.stunStock || 0) > 0) {
                boss.stunStock--;
                boss.actFsm.go('stun', boss);
                showNotice('IT IS EXHAUSTED!');
              } else if (boss.hp / boss.max < KING_MEDITATE_HP) {
                // たくわえを使い切ったら、弱っていれば座って立て直してくる
                // (そこで 1 つ戻るので、また 1 回ピヨらせられる)。
                // まだ元気なら息を整えるだけで、動きは元に戻る
                startKingMeditate(boss);
              } else {
                boss.slowMul = 1;
              }
            }
          }
        }
        // 撃たれると技をやめる。踏み込みも助走も、途中で崩れて構えへ戻る。
        // **ピヨりと座禅は別。**もとは技(act)とピヨり(stun)が別の持ちもので、
        // 技を待機へ戻してもピヨりは残った。1 つの機械にまとめたとき、
        // ここでピヨりごと解いてしまっていた(崩したそばから立ち直っていた)
        if (boss.actFsm && !kingIs(boss, 'idle', 'stun', 'meditate')) {
          boss.actFsm.go('idle', boss);
        }
        mmsxx.audio.playSE('weak');
        if (boss.hp <= 0) killKingWithRoar();
      }
    }
  }

  // --- 当たり判定: 自弾 vs ドラゴンの胴 ---
  // **体は無敵で、弾を止める。**うねった胴がそのまま盾になるので、
  // 顔を狙うには体のすき間を抜かないといけない。
  // (顔に重なっている節は描いていないので、そこは盾にしない。
  //  盾にすると顔の前に見えない壁ができてしまう)
  if (boss && boss.kind === 'dragon' && boss.dying <= 0 && boss.segs) {
    const R = DRAGON_SEG / 2 - 3;
    for (const b of [...bullets]) {
      for (const sp of boss.segs) {
        if (!sp.visible) continue;
        if (Math.abs((b.sp.x + 8) - (sp.x + DRAGON_SEG / 2)) < R &&
            Math.abs((b.sp.y + 8) - (sp.y + DRAGON_SEG / 2)) < R) {
          bulletHits(b);
          tallyHit(boss, 'shield');
          mmsxx.audio.playSE('armor', SE_HIT);
          break;
        }
      }
    }
  }

  // --- 当たり判定: 自弾 vs ボス ---
  if (boss && boss.dying <= 0 && boss.y > -10 &&
      boss.kind !== 'nautilus' && boss.kind !== 'king') {
    // 第1形態は船ごと、第2形態はタコの頭だけが当たり判定
    const crab = boss.kind === 'crab', dragon = boss.kind === 'dragon';
    const todo = boss.kind === 'todo';
    const bw = todo ? TODO_W / 2 : dragon ? DRAGON_W / 2 : crab ? CRAB_W / 2 : (boss.phase2 ? HEAD_W / 2 : BOSS_W / 2);
    const bh = todo ? TODO_H / 2 : dragon ? DRAGON_H / 2 : crab ? CRAB_H / 2 : (boss.phase2 ? HEAD_H / 2 : BOSS_H / 2);
    const bcx = boss.x + (todo ? TODO_W : dragon ? DRAGON_W : crab ? CRAB_W : BOSS_W) / 2, bcy = boss.y + bh;
    for (const b of [...bullets]) {
      if (Math.abs((b.sp.x + 8) - bcx) < bw && Math.abs((b.sp.y + 8) - bcy) < bh) {
        bulletHits(b);
        // 弱点に当たると大ダメージ。それ以外の装甲は硬い。
        // 装甲がはがれた第2形態は全体が弱点になる
        const weak = boss.phase2 || isBossWeakPoint(boss, b.sp.x + 8, b.sp.y + 8, b);
        // **どれだけ通るかは BOSS_HITS の表で決まる**(種類 × 局面)
        const rule = bossHitRule(boss) || {};
        // タコの発射口は「壊せる部位」。開いているあいだに撃ち込めば
        // 体力を削らずにそのまま撃破できる(手のひらを全部壊す道もある)
        if (rule.onWeak === 'muzzle' && weak) {
          tallyHit(boss, 'muzzle', 1);
          boss.muzzleHp -= 1;
          boss.flash = 6;
          mmsxx.audio.playSE('weak');
          spawnWeakSpark(b.sp.x, b.sp.y);
          if (boss.muzzleHp <= 0) {
            boss.hp = 0;
            boss.dying = 90;
            clearChicks(boss);   // 気絶のひよこを残さない
            kingCancelStun(boss);
            mmsxx.audio.stopBGM();
            mmsxx.audio.playSE('bossboom', SE_HIT);
          }
          continue;
        }
        // 硬い装甲は「n 発に 1 ダメージ」。
        // weak / hard があれば当たった場所で分け、数だけならそのまま
        const dmg = rule.every ? ((boss.age % rule.every === 0) ? 1 : 0)
          : rule.weak !== undefined ? (weak ? rule.weak : rule.hard)
          : (rule.dmg !== undefined ? rule.dmg : (weak ? 3 : 1));
        // 近いほど・上から攻めるほど効く(最大 4 倍)。
        // 装甲などで 0 ダメージのものは 0 のまま
        const applied = dmg > 0 ? Math.max(1, Math.round(dmg * bossDamageMul(boss))) : 0;
        boss.hp -= applied;
        tallyHit(boss, weak ? 'weak' : 'hard', applied);
        // 装甲を 8 割削っても壊れる。
        // タコの場合は「回るガードを全部壊す」でも壺が割れるので、
        // 発射口を狙う攻略と、ガードを削る攻略のどちらからでも無防備にできる
        if (!boss.phase2 && boss.hp <= boss.max * 0.2) breakShip();
        // 無敵の場所は点滅させない(ほんの少し通るだけなので)
        if (dmg > 0 && !rule.quiet) boss.flash = 6;
        // カニは 4 発に 1 ダメージなので、通ったときだけ白く光らせて知らせる
        if (dmg > 0 && boss.kind === 'crab') boss.hurt = 10;
        if (boss.kind === 'todo') {
          boss.cry = 60;   // 未実装君は泣く
          // 話しているあいだに撃ち込まれた数を数える。
          // **16 発で心が折れて自爆**する(倒すより先に終わってしまう)
          if (boss.begT !== undefined && !boss.begGone && !boss.begSad) {
            boss.begHits = (boss.begHits || 0) + 1;
            if (boss.begHits >= BEG_GIVEUP_HITS) todoGiveUp(boss);
          }
        }
        // ショットの音と同じ強さで鳴らす。
        // 優先度を付けないと、撃った音に押し出されて聞こえないことがある
        mmsxx.audio.playSE(weak ? 'weak' : 'armor', SE_HIT);
        // 弱点に当たったことが目で分かるよう、その場に光を出す
        if (weak) spawnWeakSpark(b.sp.x, b.sp.y);
        if (boss.hp <= 0) {
          boss.dying = 90;
          clearChicks(boss);   // 気絶のひよこを残さない
          kingCancelStun(boss);
          mmsxx.audio.stopBGM();
          mmsxx.audio.playSE('bossboom', SE_HIT);
        }
      }
    }
  }

  // --- ノーチラスの電撃は無敵時間でも即死 ---
  // (無敵のあいだに輪の中へ突っ込んで居座られると、ねらいが崩れるため)
  if (state === 'play' && boss && boss.kind === 'nautilus' && !boss.phase2 &&
      boss.dying <= 0 && respawnDelay <= 0) {
    const px0 = player.x + 8, py0 = player.y + 8;
    for (const o of boss.orbs || []) {
      if (!o.sp.visible) continue;
      if (Math.abs((o.sp.x + 8) - px0) < 7 && Math.abs((o.sp.y + 8) - py0) < 7) {
        destroyPlayer('SPARK');
        break;
      }
    }
  }

  // --- 当たり判定: 敵・敵弾・ボス vs 自機 ---
  // 無敵のあいだ(復活直後を含む)は、体当たりでも相手を倒せない
  if (state === 'play' && invincible <= 0 && !entering && respawnDelay <= 0) {
    const px = player.x + 8, py = player.y + 8;
    // 自機の当たり判定は見た目より一回り小さい(90%)
    const R = 0.9;
    // 体当たりはどの敵にも通る(相打ち)。自機は通常の被弾扱い
    // (小惑星だけは大きすぎるので即死)
    let hit = false;
    let hitCause = 'ENEMY';
    for (const e of [...enemies]) {
      if (Math.abs((e.sp.x + 8) - px) >= 9 * R ||
          Math.abs((e.sp.y + 7) - py) >= 9 * R) continue;
      hitCause = 'CRASH ' + e.type;
      killEnemy(e);
      hit = true;
    }
    // 小惑星は壊せない大きな障害物。ぶつかると即死
    for (const a of asteroids) {
      if (Math.abs(astCX(a) - px) < 20 * R &&
          Math.abs(astCY(a) - py) < 20 * R) {
        criticalHit('ASTEROID');   // 一撃で瀕死
        return;
      }
    }
    if (!hit) {
      for (const b of enemyBullets) {
        // 弾の絵はどちらも 16x16。小さい丸は 16x16 の真ん中に置いてあるので、
        // 中心はリング弾と同じ +8。ここを +2 にしていたため、
        // 当たり判定が絵より 6 ドット左上にずれていた
        const half = 8;
        const rad = b.breakable ? 8 : 6;
        if (Math.abs((b.sp.x + half) - px) < rad * R &&
            Math.abs((b.sp.y + half) - py) < rad * R) {
          hit = true; hitCause = b.breakable ? 'BOSS SHOT' : 'ENEMY SHOT'; break;
        }
      }
    }
    if (!hit) {
      // 16t のおもりに触れたら即死(よけるしかない)
      for (const w of weights) {
        if (px > w.sp.x && px < w.sp.x + WEIGHT_W &&
            py > w.sp.y && py < w.sp.y + WEIGHT_H) {
          // バリアでも肩代わりできない。16t は本当によけるしかない
          destroyPlayer('16 TONS', true);
          return;
        }
      }
    }
    if (!hit) {
      // ロケット弾に触れたら大ダメージ
      for (const r of rockets) {
        if (px > r.sp.x && px < r.sp.x + ROCKET_W &&
            py > r.sp.y && py < r.sp.y + ROCKET_H) {
          criticalHit('ROCKET');   // 一撃で瀕死
          return;
        }
      }
    }
    if (!hit) {
      // 目玉への体当たりも被弾扱い
      for (const e of eyeballs) {
        if (Math.abs((e.sp.x + EYE_SIZE / 2) - px) < (EYE_SIZE / 2 - 4) * R &&
            Math.abs((e.sp.y + EYE_SIZE / 2) - py) < (EYE_SIZE / 2 - 4) * R) {
          hit = true; hitCause = 'TWIN EYES'; break;
        }
      }
    }
    if (!hit) {
      // ハサミミサイルへの体当たりも被弾扱い
      for (const m of clawMissiles) {
        // あごの部分だけが当たる(真ん中の開いたところは当たらない)
        if (Math.abs((m.sp.x + CRAB_CLAW_W / 2) - px) < (CRAB_CLAW_W / 2 - 6) * R &&
            Math.abs((m.sp.y + CRAB_CLAW_H / 2) - py) < (CRAB_CLAW_H / 2 - 6) * R) {
          criticalHit('CLAW');   // 巨大なハサミに触れたら一撃でひん死
          return;
        }
      }
    }
    // 未実装君の涙。**当たっても痛くない**(泣いているだけなので)。
    // ただし、当たった感じは出したいので、光と音だけ出す
    if (boss && boss.kind === 'todo' && boss.dying <= 0) {
      for (const t of boss.tears || []) {
        if (t.age < 0 || !t.sp.visible) continue;
        if (Math.abs((t.sp.x + 8) - px) < 8 * R &&
            Math.abs((t.sp.y + 8) - py) < 8 * R) {
          if (tearSplash <= 0) {
            tearSplash = 40;
            criticalLook('TEAR');   // 見た目だけクリティカルと同じ
          }
          break;
        }
      }
    }
    // モアイの石にぶつかったら、大きな岩なのでクリティカル
    // 四隅から出てくるところに自機がいると、避ける間もなく死んでしまう。
    // 構えている(まだ動き出していない)あいだは当たらないことにする
    // 逃げているあいだは当たらない。画面の外へ流れていく途中で、
    // 姿が見えないのに当たってしまうことがあったため
    if (!hit && moai && !moai.fsm.in('leave', 'hold')) {
      // 上下のすき間へ**もぐり込んで内側を撃つ**のが正しい狙いかた。
      // ただし寄ってくるので、**閉じ切る前に抜けないと押しつぶされて即死**。
      // すき間が自機より狭くなったら、その中にいる者は潰れる
      if (moai.fsm.is('merge2') &&
          playerInMoaiGap(moai) && moaiGapSize(moai) < MOAI_CRUSH_GAP) {
        destroyPlayer('MOAI CRUSH');
        return;
      }
      for (const p of moai.parts) {
        const w = moaiShape(moai) === 'q4' ? MOAI_QW : MOAI_W;
        const h = moaiShape(moai) === 'one' ? MOAI_H : MOAI_QH;
        if (px > p.sp.x && px < p.sp.x + w && py > p.sp.y && py < p.sp.y + h) {
          criticalHit('MOAI');
          return;
        }
      }
    }
    // 本体に付いたままのハサミも、触れたら飛んでくるものと同じく危ない
    if (boss && boss.kind === 'crab' && boss.partClaws && !boss.phase2 &&
        boss.dying <= 0) {
      for (let i = 0; i < boss.partClaws.length; i++) {
        const sp = boss.partClaws[i];
        if (!sp.visible || !boss.clawAlive[i]) continue;
        // 生えかけのぶんは、伸びた先までしか当たらない。
        // (自弾側と同じ扱い。見えていないところで被弾していた)
        const grow = boss.grow[i] / CRAB_CLAW_GROW;
        if (grow < 0.5) continue;
        const w = Math.round(CRAB_CLAW_W * Math.min(1, grow));
        const x0 = sp.flipX ? sp.x + CRAB_CLAW_W - w : sp.x;
        if (Math.abs((x0 + w / 2) - px) < (w / 2 - 6) * R &&
            Math.abs((sp.y + CRAB_CLAW_H / 2) - py) < (CRAB_CLAW_H / 2 - 6) * R) {
          criticalHit('CLAW');
          return;
        }
      }
    }
    // ノーチラス: 回っている装甲に当たると被弾
    if (!hit && boss && boss.kind === 'nautilus' && boss.dying <= 0) {
      for (const g of boss.blocks) {
        if (!g.alive) continue;
        if (Math.abs((g.sp.x + 8) - px) < 10 && Math.abs((g.sp.y + 8) - py) < 10) {
          hit = true; hitCause = 'GEAR'; break;
        }
      }
    }
    // ドラゴンが画面の外から顔だけ出してためているあいだは当たり判定なし
    // (予告の姿なので、いきなりぶつかることがないようにする)
    const dragonPeek = boss && boss.kind === 'dragon' && boss.fsm.is('telegraph');
    // 5 面の長いレーザー。絵が長いので、線に沿って 5 か所を見て当たりを取る
    if (!hit) {
      for (const bm of farBeams) {
        for (let t = -15; t <= 15; t += 7.5) {
          const bx = bm.x + Math.cos(bm.a) * t, by = bm.y + Math.sin(bm.a) * t;
          if (Math.abs(bx - px) < 6 * R && Math.abs(by - py) < 6 * R) { hit = true; break; }
        }
        if (hit) { hitCause = 'FAR BEAM'; break; }
      }
    }
    // ラスボス: 回転レーザーに触れると被弾。シルエットマンへの体当たりはクリティカル
    if (!hit && boss && boss.kind === 'king' && boss.dying <= 0) {
      for (const bm of kingBeams) {
        if (Math.abs((bm.sp.x + 8) - px) < 7 * R && Math.abs((bm.sp.y + 8) - py) < 7 * R) {
          hit = true; hitCause = 'KING BEAM'; break;
        }
      }
      // **頭にはぶつからない**(胴から下だけ)。炎を当てるには頭へ覆いかぶさる
      // ことになるので、頭に当たり判定があると焼きに行けない。
      // こちらの弾と炎は、頭にも胴にも当たる
      const bodyTop = boss.y + KING_MAN_H * KING_HEAD_RATIO;
      if (!hit && bossIs(boss, 'man') && py > bodyTop &&
          Math.abs((boss.x + KING_MAN_W / 2) - px) < (KING_MAN_W / 2 - 14) * R &&
          Math.abs((boss.y + KING_MAN_H / 2) - py) < (KING_MAN_H / 2 - 6) * R) {
        criticalHit('THE KING');
        return;
      }
    }
    // 未実装さんは体当たりしても痛くない(攻撃してこない相手なので、
    // ぶつかっただけで残機を失うのは理不尽。話を聞く前に終わってしまう)
    if (!hit && boss && boss.dying <= 0 &&
        boss.kind !== 'nautilus' && boss.kind !== 'king' &&
        boss.kind !== 'todo' && !dragonPeek) {
      const crab = boss.kind === 'crab', dragon = boss.kind === 'dragon';
      const todo = boss.kind === 'todo';
      const bw = todo ? TODO_W / 2 : dragon ? DRAGON_W / 2 : crab ? CRAB_W / 2 : (boss.phase2 ? HEAD_W / 2 : BOSS_W / 2);
      const bh = todo ? TODO_H / 2 : dragon ? DRAGON_H / 2 : crab ? CRAB_H / 2 : (boss.phase2 ? HEAD_H / 2 : BOSS_H / 2);
      if (Math.abs((boss.x + (todo ? TODO_W : dragon ? DRAGON_W : crab ? CRAB_W : BOSS_W) / 2) - px) < (bw - 6) * R &&
          Math.abs((boss.y + bh) - py) < (bh - 4) * R) {
        criticalHit('BOSS BODY');   // ボスへの体当たりも一撃で瀕死
        return;
      }
      // レーザーの帯に触れたら即死(バリアでも防げない)
      if (laserPhase(boss) === 'full') {
        const lx = boss.sx + LASER_X;
        const top = boss.sy + BOSS_H;
        if (px > lx - 2 && px < lx + LASER_W + 2 &&
            py > top && py < top + (boss.laserLen || 0)) {
          // **バリアでも肩代わりできない**(第 2 引数)。
          // 渡していなかったので、NORMAL でバリアを持っていると
          // ただの被弾になり、よけなくても抜けられていた
          destroyPlayer('BOSS LASER', true);
          return;
        }
      }
    }
    if (hit) damagePlayer(hitCause);
  }

  // --- 爆発アニメ ---
  updateBooms();

  // 推進炎はスピードアップの段階で大きくなる(段階 1 では出ない)。
  // バリアがあるときは同じスプライト枠で交互に見せる。
  const alive = player.visible && state === 'play';
  // 推進炎は 2 コマで、外わくと中身を交互に出す(1 色のまま脈打たせる)。
  // ドラゴンの力をもらっていれば、スピードの段階によらず大きな緑の炎になる
  // 名乗り(TALK)で画面を止めているあいだは、炎のコマ送りも止める。
  // ここだけ動いていると「止まっていない」ように見えるため
  if (talkHold <= 0) flameFrame++;
  // 炎は 4 コマに 1 回しか出さない(下の aux.visible)。
  // 形の切り替えを 2 コマごとにすると、出るコマがいつも同じ形になり、
  // **ふちどりだけ**しか見えなかった。4 コマごとにして噛み合わせる
  const fl = Math.floor(flameFrame / 4) & 1;
  const flameImg = dragonFlame ? dragonFlameImg()
    : speedLevel >= 3 ? (fl ? SPRITE_SYMBOLS.flameBigB : SPRITE_SYMBOLS.flameBigA)
    : (fl ? SPRITE_SYMBOLS.flameSmallB : SPRITE_SYMBOLS.flameSmall);
  // 緑の炎は段階 1 でも出る(死んでも残る強化なので、いつでも使えるようにする)
  const wantFlame = alive && (speedLevel >= 2 || dragonFlame);
  const wantBarrier = alive && barrierHP > 0;
  let flameShown = false;
  if (wantFlame && wantBarrier) {
    const showBarrier = (mmsxx.frame & 2) === 0; // 2 コマごとに交互
    aux.visible = true;
    if (showBarrier) {
      aux.image = SPRITE_SYMBOLS.barrier; aux.x = player.x; aux.y = player.y;
    } else {
      aux.image = flameImg; aux.x = player.x; aux.y = player.y + FLAME_OFFSET;
      flameShown = true;
    }
  } else if (wantBarrier) {
    aux.visible = true; aux.image = SPRITE_SYMBOLS.barrier; aux.x = player.x; aux.y = player.y;
  } else if (wantFlame) {
    // ドラゴンの炎は明滅させず、出しっぱなしで色だけ変える。
    // ふつうの炎は実機らしく 4 コマに 1 回だけ出す
    aux.visible = dragonFlame || (mmsxx.frame & 3) === 0;
    aux.image = flameImg; aux.x = player.x; aux.y = player.y + FLAME_OFFSET;
    flameShown = aux.visible;
  } else {
    aux.visible = false;
  }
  if (flameShown && state === 'play') burnEnemiesBehind();

  if (tearSplash > 0) tearSplash--;
  updateWeakSparks();
  updateDeathBurst();
  updatePopups();
  updateFlash();
  updateNotice();
  // 予約しておいたこすり打ちの案内(上の cueRubHint)。
  // **前の知らせと入れ替わるだけの間**を置くので、ここで数える。
  // **点滅させて長めに出す** — 出るのはボスと撃ち合っている最中なので、
  // 画面の下に 3 秒 静かに出しただけでは見落とされた(実機でそうなった)。
  //
  // **撃たれている最中は待つ。** 教えたいのは「安心して連射できるところ」なので、
  // レーザーが伸びているあいだに出しても、読む余裕が無い
  if (rubHintIn > 0 && boss && laserPhase(boss)) {
    // そのまま据え置き(数えない)
  } else if (rubHintIn > 0 && --rubHintIn === 0) {
    showNotice('RUB THE CIRCLE TO FIRE FAST!', 300, 176, 11);
    // **文字だけでは伝わらない。** 動かしかた(斜めの往復・くるくる)は
    // 指の絵が一番早いので、丸の上で同じ長さだけ動かして見せる
    // **6 秒。** 3 秒ずつ 2 とおり見せる作りなので、縮めると
    // 2 つめ(くるくる)が途中で切れる
    rubDemoOn = true;
    if (touchGui) touchGui.rubDemo(6);
  }
  // **教えた相手を倒したら、こすりの案内はやめる。**
  // 倒れていくボスの前で指が動いていても、もう見ている場合ではない
  if (boss && boss.dying > 0 && (rubHintIn > 0 || rubDemoOn)) {
    rubHintIn = 0;
    rubDemoOn = false;
    if (touchGui) touchGui.rubDemo(0);
  }
  updateGearBlink();
  // 宝珠の七色は HUD に描いているので、少しずつ描き直す
  if ((mmsxx.frame & 1) === 0) drawOrbMarks();
  updateLastShipWarning();
  drawBossBar();
}

// ---- ボスへのダメージは「どこから当てたか」で変わる ----
// 近づくほど効き、上から攻めるとさらに効く。危ないところほど見返りが大きい。
//   距離: 遠い 1 倍 〜 密着 2 倍
//   上から: ボスの中心より上にいれば さらに 2 倍(合わせて最大 4 倍)
//   推進炎(バックファイヤー)は別ばら。**装備では変わらない固定の量**で、
//   撃たずに焼くのがいちばん効く
const BOSS_NEAR_FULL = 40;    // これより近ければ 2 倍
const BOSS_NEAR_NONE = 140;   // これより遠いと 1 倍
// 炎でボスに入る量。**弾と違って強化の影響を受けない**。
// 1 秒あたりの量で決めて、当たる回数で割ったものを 1 回ぶんにする
// (当たる間隔を変えても、削れる速さは変わらない)
const BOSS_FLAME_DPS = 100;          // ふつうの推進炎
const BOSS_FLAME_DPS_DRAGON = 200;   // 七色の炎(そらのドラゴンのアイテム)
const BOSS_FLAME_GAP = 4;            // 当たる間隔(4 コマに 1 回)
const BOSS_FLAME_HZ = 60 / BOSS_FLAME_GAP;   // 1 秒に当たる回数(15 回)
/** 炎 1 回ぶんの量 */
function bossFlameDamage() {
  return (dragonFlame ? BOSS_FLAME_DPS_DRAGON : BOSS_FLAME_DPS) / BOSS_FLAME_HZ;
}
// ラスボスが出てくるあいだに炎で溜められる数。体力が入る前なので、
// 当てたぶんは覚えておいて、構え終わったところでまとめて引く
const KING_PRE_BURN_MAX = 1;
/** ボス(いま出ているもの)の中心。段階や種類で絵の大きさが違う */
function bossCenter(b) {
  if (!b) return null;
  if (b.kind === 'king') {
    if (b.fsm.is('rift')) return [RIFT_CX, RIFT_CY];
    return [b.x + KING_MAN_W / 2, b.y + KING_MAN_H / 2];
  }
  const w = b.kind === 'todo' ? TODO_W : b.kind === 'dragon' ? DRAGON_W
    : b.kind === 'crab' ? CRAB_W : BOSS_W;
  const h = b.kind === 'todo' ? TODO_H : b.kind === 'dragon' ? DRAGON_H
    : b.kind === 'crab' ? CRAB_H : (b.phase2 ? HEAD_H : BOSS_H);
  return [b.x + w / 2, b.y + h / 2];
}
/** 自機の位置から決まる、ボスへのダメージ倍率(1〜4 倍) */
function bossDamageMul(b, above = true) {
  const c = bossCenter(b);
  if (!c) return 1;
  const px = player.x + 8, py = player.y + 8;
  const d = Math.hypot(px - c[0], py - c[1]);
  const t = Math.min(1, Math.max(0, (d - BOSS_NEAR_FULL) / (BOSS_NEAR_NONE - BOSS_NEAR_FULL)));
  const near = 2 - t;
  // 上から攻める倍率。頭に当てた判定を別に持っているラスボスでは使わない
  return near * (above && py < c[1] ? 2 : 1);
}

// ---- 当たり判定の可視化(裏技 HITAREA で切り替え) ----
// いちばん手前のレイヤーに枠だけを描く。種類ごとに色を変えて見分ける。
//   白 = 自機 / 黄 = 自弾 / 赤 = 敵 / 桃 = 敵弾 / 緑 = ボスと部位 /
//   明るい赤 = 触れたら即死・瀕死のもの
let showHitArea = false;
const HA_PLAYER = 15, HA_SHOT = 11, HA_ENEMY = 8, HA_EBULLET = 13;
const HA_BOSS = 3, HA_DEADLY = 9;

/** 枠だけを描く(中は塗らない) */
function haBox(x, y, w, h, color) {
  const x0 = Math.round(x), y0 = Math.round(y);
  const iw = Math.max(1, Math.round(w)), ih = Math.max(1, Math.round(h));
  dbg.fill(color, x0, y0, iw, 1, true);
  dbg.fill(color, x0, y0 + ih - 1, iw, 1, true);
  dbg.fill(color, x0, y0, 1, ih, true);
  dbg.fill(color, x0 + iw - 1, y0, 1, ih, true);
}

/** 中心と半径で枠を描く */
function haAt(cx, cy, rx, ry, color) { haBox(cx - rx, cy - ry, rx * 2, ry * 2, color); }

function updateHitArea() {
  if (!showHitArea) return;
  dbg.fill(0, 0, 0, SCREEN_W, SCREEN_H, true);
  const R = 0.9;
  // 自機(見た目より一回り小さい)
  if (player.visible) haAt(player.x + 8, player.y + 8, 9 * R, 9 * R, HA_PLAYER);
  for (const b of bullets) haAt(b.sp.x + 8, b.sp.y + 8, 4, 4, HA_SHOT);
  for (const e of enemies) haAt(e.sp.x + 8, e.sp.y + 7, 9 * R, 9 * R, HA_ENEMY);
  for (const b of enemyBullets) {
    const half = 8, rad = b.breakable ? 8 : 6;
    haAt(b.sp.x + half, b.sp.y + half, rad * R, rad * R, HA_EBULLET);
  }
  // 触れたら即死・瀕死のもの
  for (const a of asteroids) haAt(astCX(a), astCY(a), 20 * R, 20 * R, HA_DEADLY);
  for (const r of rockets) haBox(r.sp.x, r.sp.y, ROCKET_W, ROCKET_H, HA_DEADLY);
  for (const m of clawMissiles) {
    haAt(m.sp.x + CRAB_CLAW_W / 2, m.sp.y + CRAB_CLAW_H / 2,
      (CRAB_CLAW_W / 2 - 6) * R, (CRAB_CLAW_H / 2 - 6) * R, HA_DEADLY);
  }
  for (const e of eyeballs) {
    haAt(e.sp.x + EYE_SIZE / 2, e.sp.y + EYE_SIZE / 2,
      (EYE_SIZE / 2 - 4) * R, (EYE_SIZE / 2 - 4) * R, HA_ENEMY);
  }
  for (const bm of farBeams) {
    for (let t = -15; t <= 15; t += 7.5) {
      haAt(bm.x + Math.cos(bm.a) * t, bm.y + Math.sin(bm.a) * t, 6 * R, 6 * R, HA_DEADLY);
    }
  }
  if (moai) {
    const w = moaiShape(moai) === 'q4' ? MOAI_QW : MOAI_W;
    const h = moaiShape(moai) === 'one' ? MOAI_H : MOAI_QH;
    for (const p of moai.parts) haBox(p.sp.x, p.sp.y, w, h, HA_BOSS);
  }
  if (boss && boss.dying <= 0) {
    if (boss.kind === 'king') {
      if (bossIs(boss, 'rift')) haAt(RIFT_CX, RIFT_CY, 14, RIFT_H / 2 - 2, HA_BOSS);
      if (bossIs(boss, 'man')) {
        haAt(boss.x + KING_MAN_W / 2, boss.y + KING_MAN_H / 2,
          KING_MAN_W / 2 - 12, KING_MAN_H / 2 - 4, HA_BOSS);
      }
      for (const bm of kingBeams) haAt(bm.sp.x + 8, bm.sp.y + 8, 7 * R, 7 * R, HA_DEADLY);
    } else if (boss.kind === 'nautilus') {
      for (const g of boss.blocks || []) if (g.alive) haAt(g.sp.x + 8, g.sp.y + 8, 10, 10, HA_BOSS);
      for (const o of boss.orbs || []) if (o.sp.visible) haAt(o.sp.x + 8, o.sp.y + 8, 7, 7, HA_DEADLY);
    } else {
      const crab = boss.kind === 'crab', dragon = boss.kind === 'dragon';
      const todo = boss.kind === 'todo';
      const bw = todo ? TODO_W / 2 : dragon ? DRAGON_W / 2 : crab ? CRAB_W / 2
        : (boss.phase2 ? HEAD_W / 2 : BOSS_W / 2);
      const bh = todo ? TODO_H / 2 : dragon ? DRAGON_H / 2 : crab ? CRAB_H / 2
        : (boss.phase2 ? HEAD_H / 2 : BOSS_H / 2);
      const cx = boss.x + (todo ? TODO_W : dragon ? DRAGON_W : crab ? CRAB_W : BOSS_W) / 2;
      haAt(cx, boss.y + bh, bw, bh, HA_BOSS);
      // 脚の絵は 24x16。判定(中心 +12/+8、半分 14/12)に合わせて枠を描く
      for (const lg of boss.legs || []) if (lg.hp > 0 && lg.sp.visible) {
        haAt(snap8(lg.sp.x) + 12, snap8(lg.sp.y) + 8, 13, 8, HA_BOSS);
      }
      // 本体に付いたハサミ。生えかけのぶんは伸びた先までしか無い
      if (crab && !boss.phase2) (boss.partClaws || []).forEach((sp, i) => {
        if (!sp.visible || !boss.clawAlive[i]) return;
        const grow = boss.grow[i] / CRAB_CLAW_GROW;
        if (grow < 0.5) return;
        const w = Math.round(CRAB_CLAW_W * Math.min(1, grow));
        haBox(sp.flipX ? sp.x + CRAB_CLAW_W - w : sp.x, sp.y, w, CRAB_CLAW_H, HA_DEADLY);
      });
      for (const g of boss.guards || []) if (g.hp > 0) haAt(g.sp.x + 8, g.sp.y + 8, 8, 8, HA_BOSS);
    }
  }
}

// ---- ポーズ (P キー / ESC) ----
// **直に書き換えない。** かならず setPaused() を通す。
// ポーズ中は画面と音を溜めるのも止める必要があり、直書きするとそこが抜ける
// (「ポーズ -> Q -> 遊び直し」で 1 コマも溜まらない、という不具合が出た)
let paused = false;

/**
 * ポーズを入り切りする。**溜めるのを止める/戻すのも一緒に面倒を見る**。
 * ポーズ中も画面は描き続けているので、止めないと輪っかが
 * 「止まった画面」で埋まり、やられる直前の数秒が消える
 * @param {boolean} v
 */
function setPaused(v) {
  paused = !!v;
  applyCapture();
}

/**
 * **ポーズ中だけ、パッドの下段 2 つを打ち込みの B / A にする。**
 *
 * 裏技はキーボードで打つものだが、**コナミコマンドの締めは B → A** なので、
 * パッドしか無い人はそこで詰まる。ポーズ中は撃つ必要も無いので、
 * その 2 つだけ文字として貸す。
 *
 * **並びは逆にする。** いまのパッドは下が A・右が B だが、
 * **ファミコンは B が左**だった。左から B → A と押せるほうが、
 * 覚えているコマンドの指の運びと合う。
 *   ボタン 0(下) … B
 *   ボタン 1(右) … A
 *
 * X / Y は貸さない。**あの 2 つに当たる文字は元のパッドに無い**ので、
 * 何を打っているのか分からなくなる。
 *
 * 表を書き替えるだけでよい(engine/util/gamepad.js は毎回この表を引くし、
 * 押しっぱなしのまま変わっても、前の名前で離してから新しい名前で押し直す)。
 *
 * **呼ぶのは遊びのループから**(setPaused からではない)。あちらは
 * 立ち上げの途中でも呼ばれるので、**まだ作られていない PAD_MAP を触って落ちる**
 * (const は巻き上がらない)。ループが回るころには何もかも揃っている
 */
let padTyping = null;
function applyPadTyping() {
  if (padTyping === paused) return;
  padTyping = paused;
  PAD_MAP[0] = paused ? 'KeyB' : 'Space';
  PAD_MAP[1] = paused ? 'KeyA' : 'Space';
}

// **溜めを止めたままにする印**。
// ラスボスを倒したあと(リプレイ → 集計 → エンディング)や、やられたあとは、
// 途中でポーズが解かれても溜め直さない。
// これが無いと、物語の画面が setPaused(false) を呼ぶたびに溜めが再開して、
// シェアで選べるコマが「そのあとの画面」に入れ替わってしまう
let captureFrozen = false;
/** ポーズと印の両方を見て、溜めるかどうかを決め直す */
function applyCapture() { mmsxx.holdCapture(paused || captureFrozen); }
/** 溜めを止める / 止めるのをやめる */
function freezeCapture(on) { captureFrozen = !!on; applyCapture(); }
// ---- ポーズ中の隠しコマンド ----
// ↑↑↓↓←→←→BA と "HYPER" は全パワーアップ(どちらも 1 ゲームに 1 回だけ)。
// 名前を打ち込むとステージワープ、"AHO"/"BAKA" で自爆する。
const KONAMI_CODE = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA',
];
// 面へのワープ
// 面ワープ(全 5 面)。スタッフロールでは名前の前に #1〜#5 が付いていて、
// それが面数のヒントになっている
const STAGE_CODES = {
  MOMOKO: 1, CHIE: 2, AKEMI: 3, SYUKO: 4, CHIAKI: 5,
};
// ボスとの直接対決(練習用)。倒すと同じボスがまた出てくる。
// こちらも #1〜#5 が付いている
const BOSS_CODES = {
  NORIKO: 1, SATOE: 2, YASUKO: 3, KINUYO: 4, HISAE: 5,
};
// 残りの 2 つは特別枠
const MIJISSOU_CODE = 'MIYUKI';   // 仮ボス「未実装君」と対決
const ENDING_CODE = 'YOHKO';      // エンディングを見る

let konamiPos = 0;
let typed = '';            // ポーズ中に打ち込まれた英字
let usedKonami = false;    // 1 ゲームに 1 回だけ
// 面移動とボスへの移動も、それぞれ 1 ゲームに 1 回だけ
let usedStageWarp = false;
let usedBossWarp = false;
let usedHyper = false;
// オート連射のコマンドは MEIJIN / TAKAHASHI / TOSHIYUKI の 3 つ。
// **1 つにつき 1 ゲームに 1 回**(3 つ全部使えば 3 回)。
// 同じ名前を何度打っても 2 回目からは効かない
const AUTO_CODES = ['MEIJIN', 'TAKAHASHI', 'TOSHIYUKI'];
let autoUsed = new Set();

/** 全パワーアップ(2 つの隠しコマンド共通の効果) */
function grantFullPower(label) {
  shotLevel = MAX_POWER;
  damageLevel = DAMAGE_TABLE.length;
  speedLevel = SPEED_TABLE.length;
  maxVolleys = MAX_VOLLEY_LIMIT;
  barrierHP = Math.max(barrierHP, 1);
  drawHUD();
  // 裏技のときは画面の真ん中に大きく出す。
  // アイテムで取ったときは label を渡さず、ほかのアイテムと同じ下の行に出す
  if (label) cheatNotice(label);
  mmsxx.audio.playSE('item');
}

// ---- プレイ統計 ----
// バランス調整の材料にするため、エンジンの StatsLog に記録していく。
// window.mmsxxStats() で集計、window.mmsxxStatsCompact() で生ログを畳める。
const stats = new StatsLog({ key: 'starfable-stats', maxEvents: 4000 });

/** 集計のしかた(compact したあともここで足した結果は残る) */
const STAT_AGGREGATORS = {
  deathCauses: (l) => l.countBy('death', 'cause'),
  itemsTaken: (l) => l.countBy('item', 'kind'),
  bossKills: (l) => l.count('boss'),
  stagesCleared: (l) => l.count('stage'),
};

function statsItem(kind) { stats.log('item', { kind }); }
function statsDeath(cause) {
  stats.log('death', { cause, stage: stageNo, frames: playFrame, shotLevel });
  if (recordOn()) tally.deaths++;
  recordFlush();
}
function statsBoss(frames) { stats.log('boss', { stage: stageNo, frames }); }
function statsStageEnd() {
  stats.log('stage', {
    stage: stageNo,
    score: score - statStageScore,
    frames: playFrame,
  });
  statStageScore = score;
  recordFlush();
}
let statStageScore = 0;

function statsFinish() {
  stats.endSession({ score, maxStage: stageNo });
  if (recordOn()) {
    record.max(hardNow() ? 'hiHard' : 'hiNormal', score);
    record.max('mostShots', playShots);
  }
  recordFlush();
  // 生ログがたまってきたら、集計だけ残して畳む
  if (stats.needsCompact()) stats.compact(STAT_AGGREGATORS);
}

/**
 * デバッグ用: ハイスコアを既定の 100 件に戻す。
 * 戻すのは**この端末に残っているぶんだけ**。
 * 供給元がサーバになっても、サーバ側の記録には触らない
 */
// ---- 開発用の口 ここから ----
mmsxx.expose('mmsxxResetHiScores', () => {
  hardTable.reset();
  normalTable.reset();
  rushTable.reset();
  return hardTable.entries.length + ' 件に戻しました';
});

/** デバッグ用: いまの画面状態を見る(自動テストから使う) */
/** デバッグ用: 好きな面のボスをその場に出す(自機は無敵にする) */
mmsxx.expose('mmsxxBoss', (n) => {
  stageNo = n;
  clearEntities();
  hud.clear();
  state = 'play';
  player.visible = true;
  invincible = 99999;
  spawnBoss();
  return gameMode() + ' stage' + n;
});

/**
 * ラスボスを第 2 段階(シルエットマン)へ飛ばす。
 * 裂け目を壊したところから始まり、赤い空間になってシルエットが出てくる。
 * シーン選択とデバッグの両方から使う。
 */
/**
 * ラスボスにとどめを刺したときの流れ。
 * まず 曲も背景の揺らぎも画面もすべて止めて名乗りを聞かせ、
 * 声が終わってから 爆発 -> 倒れる -> 赤い空間が消える と進む。
 */
function killKingWithRoar() {
  // 名乗りのあいだは必ず姿が見えているようにする。
  // 撃破演出の明滅と重なると、声だけで画面に何も無い時間ができてしまう。
  // 姿は のけぞったダメージのポーズで止める
  bossVisible = true;
  if (boss.man) {
    boss.man.frames = null;
    boss.man.image = SPRITE_SYMBOLS.kingMan05;
  }
  drawBossBody();
  mmsxx.audio.stopBGM();
  currentBGM = null;
  mmsxx.audio.stopSE();
  // 止まってから 2 秒おいて、それから名乗る(間を作る)
  talkName = 'kozorite';
  talkBlast = true;
  talkHold = KING_ROAR_WAIT + TALK_HOLD_FRAMES;
  markMet('kingDown');           // 倒した記録(いまは何も開かない)
  boss.hp = 0;
  boss.dying = 200;              // しゃがみこみ + 星空へ戻す演出のぶん長め
  boss.deathRoar = true;         // 声のあとに爆発音を鳴らす
}

// シーン選択から「第 2 段階から」を選んだときの予約。
// ボスはその場では出ず、次の更新で登場するので、出たときに切り替える
let pendingKingPhase2 = false;

function kingToPhase2() {
  if (!boss || boss.kind !== 'king') return null;
  boss.hp = 1;
  hitKingRift(boss, RIFT_CX, RIFT_CY);   // 'break' へ入る
  boss.fsm.timer = 1;                    // 次の更新で 'pose' へ進む
  enterRedSpace();
  // シルエットは 'break' の**まん中**で作られるので、飛ばすと作られないまま
  // 'man' に入ってしまい、姿が無いのに攻撃してくる状態になっていた
  makeKingMan(boss);
  return boss.fsm.state;
}

/**
 * デバッグ用: **局面の移り変わりの記録**を読む。
 * 「何コマ目に、どの機械が、どこからどこへ移ったか」が並ぶ
 */
mmsxx.expose('mmsxxLog', (n = 40) => StateMachine.history(n));

/**
 * デバッグ用: **自機を定位置(画面の下)へ置く。**
 *
 * mmsxxBoss() で入っただけだと、自機は**前にいた場所のまま**(たいてい画面の上)。
 * 上へ飛ぶ弾が相手の下へ回り込めず、当たる場所が偏る。
 * (きんぐを調べたとき「13 発とも頭に当たる」で行き詰まった原因がこれ)
 *
 * **mmsxxBoss() の中ではやらない。**公開版と突き合わせるとき、
 * 向こうにこの直しは無いので、自機の位置が全部食い違ってしまう
 */
mmsxx.expose('mmsxxPlacePlayer', (x = (SCREEN_W - 16) / 2) => {
  player.x = x; player.y = SCREEN_H - 32;
  player.visible = true;
  leaving = false; entering = false; enterDelay = 0; respawnDelay = 0;
  return { x: Math.round(player.x), y: Math.round(player.y) };
});

/**
 * デバッグ用: **挙動確認の面に並べた的の場所**を返す。
 * 試験はこれを見て狙う(`mmsxxBoss(110)` で入る)
 */
mmsxx.expose('mmsxxHitTargets', () => (hitTargets || []).map((t) => ({
  種類: t.中身.kind, 型: t.中身.type || '-',
  // **いまの場所**を返す(置いたつもりの場所ではなく)。
  // ここを「置いたつもり」にしていたせいで、動いている的が止まって見えていた
  x: Math.round(t.sp.x), y: Math.round(t.sp.y),
  生きている: t.list.includes(t.obj),
})));

/**
 * デバッグ用: **ボスが何をされたかを局面ごとに見る。**
 * 「当てているつもりで当たっていない」「当たっているのに効いていない」を
 * 数で切り分けるためのもの
 */
mmsxx.expose('mmsxxTally', () => (boss && boss.tally) || lastTally);

/**
 * デバッグ用: **いまのボスを好きな局面へ飛ばす。**
 * `mmsxxState('charge')` でドラゴンの突進、`mmsxxState('moon')` でラスボスの
 * サマーソルト。第 2 引数に 'act' を渡すと技の機械のほうを動かす。
 * 引数なしで呼ぶと、いまの局面と行き先を返す
 */
mmsxx.expose('mmsxxState', (name, which = 'auto') => {
  if (!boss) return null;
  const stages = boss.fsm, acts = boss.actFsm || boss.gun;
  const pick = which === 'act' ? acts
    : which === 'stage' ? stages
    : (name && acts && acts.defs[name]) ? acts : stages;
  if (!pick) return null;
  // **知らない名前で落とさない。**技の機械はラスボスが第 2 段階に入るまで
  // 無いので、そこへ 'stun' と打つと段階のほうへ行って例外になっていた
  if (name && !pick.defs[name]) {
    const here = Object.keys(pick.defs).join(' / ');
    const other = acts && acts !== pick ? Object.keys(acts.defs).join(' / ') : null;
    return { エラー: '「' + name + '」という局面は無い', 選べるもの: here,
      技のほう: other || '(まだ無い)' };
  }
  if (name) pick.go(name, boss);
  return { kind: boss.kind, stage: stages && stages.state, act: acts && acts.state,
    残り: pick.timer, 次: pick.nextName(), 通ってきた道: pick.trail.join(' -> ') };
});

/**
 * デバッグ用: **局面の宣言を取り出す。**
 * 試験はここから `bad`(粗さがしの結果)を見て、図は `mermaid` をそのまま使う。
 * 宣言が 1 か所にあるので、**仕様書のほうが古くなることがない**
 */
mmsxx.expose('mmsxxStates', (kind = 'crab') => {
  const defs = {
    crab: CRAB_STATES, dragon: DRAGON_STATES, nautilus: NAUT_STATES,
    king: KING_STAGES, kingActs: KING_ACTS, moai: MOAI_STATES,
    octopus: OCTO_STATES, octoGun: OCTO_GUN, todo: TODO_STATES,
  }[kind];
  if (!defs) return null;
  const fsm = new StateMachine(defs);
  // defs もそのまま返す。図を別に起こす道具から、宣言を直に読めるように
  return { kind, names: fsm.names, bad: fsm.check(), mermaid: fsm.toMermaid(kind), defs };
});

/**
 * デバッグ用: **いまのボスの装甲を壊す**(第 2 形態へ)。
 * breakShip() はボス共通の入り口なので、どの種類でも通ることを試験から見る
 * (タコ専用の go() をここへ置いてしまい、カニで例外になったことがある)
 */
mmsxx.expose('mmsxxPhase2', () => {
  if (!boss || boss.phase2) return null;
  breakShip();
  return { kind: boss.kind, phase2: !!boss.phase2, stage: boss.fsm && boss.fsm.state };
});

/** デバッグ用: カニの脚を全部折って第 2 形態(斜めの姿)にする */
mmsxx.expose('mmsxxCrabPhase2', () => {
  if (!boss || boss.kind !== 'crab') return null;
  for (const lg of boss.legs) lg.hp = 0;
  boss.phase2 = true;
  boss.fsm.go('float', boss);
  return 'phase2';
});

/** デバッグ用: コンティニュー先の面を決める(タイトルの並びを確かめる用) */
mmsxx.expose('mmsxxContinue', (n) => {
  continueStages.normal = n || 1;
  refreshModes();
  if (state === 'title' && titlePage === 0) drawModeLine();
  return { ...continueStages, modes: MODES.map(m => m.id) };
});

/**
 * **その面をはじめからやり直す**(撮り直し用)。
 *
 * 面の頭で控えた持ちもの(点・残機・装備・乱数の進み具合)へ戻してから
 * 面を作り直す。**音は切れ目で止める**ので、あとでつないでも継ぎ目が鳴らない。
 *
 *   mmsxxMark()     … いまの持ちものを控え直す(面の途中を起点にしたいとき)
 *   mmsxxRewind()   … 控えたところへ戻す
 */
/**
 * **クリアの流れへ飛ばす**(結果画面まで進める)。
 * 撮り直しのときに、そこまで遊ばずに継ぎ目の絵を確かめるためのもの
 */
/** **タイトルへ戻す**(片づけ忘れを見るときに使う) */
mmsxx.expose('mmsxxTitle', () => { resetToTitle(); return 'タイトルへ戻りました'; });

mmsxx.expose('mmsxxClear', (frames = 960) => {
  if (state !== 'play') return '遊びの最中ではありません(' + state + ')';
  clearTimer = frames;
  return 'クリアの流れへ入りました(' + frames + ' コマ)';
});

mmsxx.expose('mmsxxMark', () => {
  const m = markStage();
  return 'STAGE ' + m.stageNo + ' / SCORE ' + m.score + ' を控えました';
});
mmsxx.expose('mmsxxRewind', () => rewindStage());

/** デバッグ用: 敵や障害物をその場に出す(引数なしで一覧が返る) */
mmsxx.expose('mmsxxEnemy', (kind) => {
  if (kind === 'count') return { 敵: enemies.length, 敵弾: enemyBullets.length,
    種類: enemies.map(e => e.type).join(''), おもり: weights.length };
  if (kind === 'glower') { spawnGlower(); return 'glower'; }
  if (kind === 'weight') { startWeightVolley(); return 'weight'; }
  if (kind === 'rocket') { spawnRocket(); return 'rocket'; }
  if (kind === 'waller') spawnWaller();
  else if (kind === 'spreader') spawnSpreader();
  else if (kind === 'diver') spawnDiver();
  else return 'waller / spreader / diver / weight / rocket / glower';
  return enemies.filter(e => 'KLM'.includes(e.type)).map(e => e.type);
});

/** デバッグ用: モアイをその場に出す */
/** デバッグ用: 未実装さんに会った印を消す(コンティニューでまた出るようにする) */
mmsxx.expose('mmsxxForgetTodo', () => {
  progress.set('todoMet', false);
  progress.set('todoDown', false);
  progress.flush();
  return '未実装さんの印を消しました(次のゲームの 2 回目のコンティニューで出ます)';
});

mmsxx.expose('mmsxxMoai', (what) => {
  // 'angry' を渡すと、その場で怒った状態にする(帰るまでを確かめる用)
  if (what === 'angry' && moai) { moai.rage = MOAI_RAGE_HITS - 1; angerMoai(moai); return moai.angryTimer; }
  clearMoai(); moaiSpawned = true; spawnMoai(); return 'moai';
});

/**
 * デバッグ用: ラスボスを好きな段階へ飛ばす。
 * 'rift' 裂け目 / 'break' 裂け目が壊れる / 'pose' シルエット登場 /
 * 'man' 第 2 段階 / 'die' 撃破の演出(第 2 段階のときだけ)
 */
mmsxx.expose('mmsxxKing', (stage) => {
  if (!boss || boss.kind !== 'king') { mmsxxBoss(6); }
  if (stage === 'die' && bossIs(boss, 'man')) {
    killKingWithRoar();
    return boss.fsm.state;
  }
  if (stage === 'break') {
    boss.hp = 1;
    hitKingRift(boss, RIFT_CX, RIFT_CY);
  } else if (stage === 'pose' || stage === 'man') {
    kingToPhase2();
  }
  return boss.fsm.state;
});

/** デバッグ用: 名前入力の画面をその場で出す(第 2 引数で得点を決められる) */
mmsxx.expose('mmsxxNameEntry', (target = 'score', s) => {
  if (s !== undefined) score = s;
  enterNameEntry(target);
  return state;
});

/** デバッグ用: いまのボスの体力を書き換える(段階の変わり目をすぐ確かめる) */
mmsxx.expose('mmsxxBossHp', (n) => {
  if (!boss) return null;
  boss.hp = n;
  drawBossBar();
  return boss.hp;
});

// ---- 絵の書き出し(開発用) ----
// 外の道具で見たり直したりするため。V2 で「直した絵を取り込み直す」流れを作る
//   mmsxxArt('player', 4)          … 1 枚を 4 倍で落とす
//   mmsxxSheet('sprite', 2, 512)   … スプライトを 2 倍で 512 ドット幅に並べて落とす
//   mmsxxSheet('bg', 1, 1024)      … BG も同じように
//   mmsxxSheet('all', 1, 1024)     … **作った絵ぜんぶ**(派生したものも含む)
//   mmsxxSymbols()                 … 名前と大きさの一覧(文字)
mmsxx.expose('mmsxxArt', (name, scale = 4) => {
  const sym = SPRITE_SYMBOLS[name] || BG_SYMBOLS[name];
  if (!sym) return '知らない名前: ' + name;
  downloadArt(exportSymbol(mmsxx, sym, { scale }), name + '.png');
  return name + ' を ' + scale + ' 倍で落としました';
});
mmsxx.expose('mmsxxSheet', (kind = 'sprite', scale = 2, width = 512, padding = 2) => {
  // 'all' はエンジンの控えから引く。**ゲームの辞書に入れていない絵も出る**
  // (色替えや走査線で派生したもの。抜けがあると気づけないので、こちらが本命)
  const list = kind === 'all'
    ? mmsxx.symbols().map(s => [s.name, s.sym])
    : (kind === 'bg' ? BG_SYMBOLS : SPRITE_SYMBOLS);
  const c = exportSheet(mmsxx, list, {
    scale, width, padding, sort: kind !== 'all',
    label: true, labelColor: '#333333', checker: true,
  });
  downloadArt(c, kind + '-sheet.png');
  const n = Array.isArray(list) ? list.length : Object.keys(list).length;
  return `${n} 枚を ${c.width}x${c.height} に並べました`;
});
// 絵ぜんぶを、大きさで組に分けて何枚かに落とす。
// **1 枚にまとめると升目がいちばん大きい絵に合わせて巨大になる**ので分ける
mmsxx.expose('mmsxxSheets', (scale = 1, width = 1024) => {
  const all = mmsxx.symbols();
  const groups = [
    ['sprite', s => s.kind === 'sprite'],
    ['bg-small', s => s.kind === 'bg' && s.width <= 64 && s.height <= 64],
    ['bg-large', s => s.kind === 'bg' && (s.width > 64 || s.height > 64)],
  ];
  const done = [];
  for (const [name, pick] of groups) {
    const list = all.filter(pick).map(s => [s.name, s.sym]);
    if (!list.length) continue;
    const c = exportSheet(mmsxx, list, {
      scale, width, padding: 3, label: true, labelColor: '#333333', checker: true });
    downloadArt(c, 'sheet-' + name + '.png');
    done.push(`${name}: ${list.length} 枚 ${c.width}x${c.height}`);
  }
  return done.join(' / ');
});
// 名前と大きさだけの一覧(文字)。**絵を直したときの差分を git で追える**
mmsxx.expose('mmsxxSymbols', () => mmsxx.symbols()
  .map(s => `${s.kind}\t${s.width}x${s.height}\t${s.derived ? '派生\t' : '\t'}${s.name}`)
  .join('\n'));

mmsxx.expose('mmsxxDebug', () => ({
  state, modeIndex, mode: gameMode(), titlePage, charPage, stageNo,
  playFrame, bossIntro, bossMode, stars, need: starsNeeded(), paused,
  score,
  gear: { shotLevel, speedLevel, maxVolleys, damageLevel, barrierHP, ships },
  playerX: Math.round(player.x), playerY: Math.round(player.y), bullets: bullets.length,
  talkHold, continueStages: { ...continueStages },
  // こすり打ちの案内(出すまでの残りコマ / もう出した場面)
  rub: { in: rubHintIn, done: [...rubHintDone] },
  // パッドの受け入れ具合(使うと答えたか / 断られた回数 / 札が出ているか)
  pad: { enabled: padEnabled, declined: padDeclined, notice: padNotice.open,
    pads: gamepad.usable().length, unsupported: gamepad.unsupported().length },
  rank: { mode: RANK_MODE, browserId, playId, seed: mmsxx.rng.masterSeed,
    delay: RANK_DELAY, errorRate: RANK_ERROR,
    platform: rankPlatform(),
    // 控えているもの と、実際に送るもの(送らないときは空)
    inputHeld: mmsxx.input.usedInputs(), inputSent: rankInput(),
    gameVersion: BUILD.version.replace(/^v/, ''), rankingVersion: RANKING_VERSION },
  dragon: dragonSpot ? { hits: dragonSpot.hits, done: dragonSpot.done,
    x: dragonSpot.x, y: dragonSpotY() } : null,
  secret: secretSpots ? secretSpots.map(s => ({ x: s.x, y: s.y, hits: s.hits, done: s.done })) : null,
  boss: boss ? {
    kind: boss.kind, hp: boss.hp, max: boss.max,
    phase2: !!boss.phase2, firing: boss.gun && boss.gun.is('fire') ? 1 : 0,
    mode: boss.fsm ? boss.fsm.state : boss.mode,
    stage: boss.fsm ? boss.fsm.state : null, act: boss.actFsm ? boss.actFsm.state : null, beams: kingBeams.length,
    // 崩し(ピヨらせ)の様子。撃たれるほど slowMul が下がり、0.1 で固まる
    slowMul: boss.slowMul, stunStock: boss.stunStock, guard: boss.guard | 0,
    bx: Math.round(boss.x), by: Math.round(boss.y), py: Math.round(player.y),
    blink: boss.man ? boss.man.blink + ':' + boss.man.blinkOn : null,
    guards: (boss.guards || []).map(g => g.hp),
    legs: (boss.legs || []).map(g => g.hp),
    bullets: bullets.length,
  } : null,
  moai: moai ? { state: moai.fsm.state, shape: moaiShape(moai), hp: moai.hp, max: moai.max,
    parts: moai.parts.map(p => p.hp), lost: moai.lost,
    rage: moai.rage, angry: moai.angry } : null,
}));

/** デバッグ用: 貯めた統計をまとめて見る */
mmsxx.expose('mmsxxStats', () => {
  const sessions = stats.sessions;
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    plays: sessions.length,
    avgScore: Math.round(avg(sessions.map(x => x.score || 0))),
    avgMaxStage: +avg(sessions.map(x => x.maxStage || 1)).toFixed(2),
    avgPlaySeconds: Math.round(avg(sessions.map(x => x.seconds || 0))),
    deathCauses: stats.countBy('death', 'cause'),
    itemsTaken: stats.countBy('item', 'kind'),
    avgBossSeconds: +(stats.avg('boss', 'frames') / 60).toFixed(1),
    avgStageSeconds: +(stats.avg('stage', 'frames') / 60).toFixed(1),
    scoreByStage: stats.avgBy('stage', 'stage', 'score'),
    deathsByStage: stats.countBy('death', 'stage'),
    // これまでに畳んだぶんの累積
    totals: stats.totals,
    sessions,
  };
});
/** デバッグ用: いま集計して生ログを捨てる */
mmsxx.expose('mmsxxStatsCompact', () => stats.compact(STAT_AGGREGATORS));
/** デバッグ用: 統計を全部消す */
mmsxx.expose('mmsxxStatsReset', () => { stats.reset(); return 'クリアしました'; });
// ---- 開発用の口 ここまで ----

// ---- ボスラッシュ ----// ---- ボスラッシュ ----
// 実装済みのボスをランダムな順で 1 巡する。
// 種類が増えたら BOSS_RUSH_STAGES に足すだけでよい。
// 1 = タコ / 2 = カニ / 3 = ドラゴン / 4 = オウムガイ / 5 = モアイ
// ラスボスと仮ボスは入れない(本編のボスを 1 巡するだけ)
const BOSS_RUSH_STAGES = [1, 2, 3, 4];
const RUSH_KEY = 'starfable-rushtimes';
const RUSH_MAX = 100;
// 得点の表と同じく、作り物の初期データは持たない
let rushDone = false;      // ボスラッシュを 1 巡したか
let rushStartFrame = -1;   // ボスラッシュ開始フレーム(通算)
let rushFrames = 0;        // 経過フレーム
let rushOrder = [];
let rushIndex = 0;

let lastRushFirst = -1;   // 前回のボスラッシュで最初に出たボス

function startBossRush() {
  if (rushOne > 0) {
    // 相手を選んでいるときは、その相手だけと戦う
    rushOrder = [rushOne];
    rushIndex = 0; rushStartFrame = 0; rushFrames = 0; rushDone = false;
    stageNo = rushOrder[0];
    startStage();
    return;
  }
  rushOrder = BOSS_RUSH_STAGES.slice().sort(() => rnd() - 0.5);
  // 1 匹目は前回と違うボスにする(同じ相手が続かないように)
  if (rushOrder.length > 1 && rushOrder[0] === lastRushFirst) {
    const i = 1 + Math.floor(rnd() * (rushOrder.length - 1));
    [rushOrder[0], rushOrder[i]] = [rushOrder[i], rushOrder[0]];
  }
  lastRushFirst = rushOrder[0];
  rushIndex = 0;
  rushStartFrame = 0;
  rushFrames = 0;
  rushDone = false;
  stageNo = rushOrder[0];
  startStage();
}

function advanceBossRush() {
  rushIndex++;
  if (rushIndex >= rushOrder.length) {
    // 1 巡したら終わり。タイムは名前を入れてから記録する
    rushDone = true;
    recordRushTime(rushFrames);   // 手元のいちばん速いタイム
    const t = 'ALL BOSSES DOWN!  ' + formatTime(rushFrames);
    hud.print(centerX(t), 72, t, 11);
    // タイムが表に載るならゲームオーバー画面を通さず、そのまま名前入力へ。
    // 載らなければ、いつもどおりゲームオーバー画面を見せる
    if (rushTable.qualifies({ frames: rushFrames })) {
      statsFinish();   // enterGameOver を通らないので、ここで記録を締める
      enterNameEntry('rush');
    } else {
      enterGameOver();
    }
    return;
  }
  stageNo = rushOrder[rushIndex];
  startStage();
}

/** 経過時間を「分:秒.1/100秒」で表す。1 巡ぶんの長いタイムでも桁が足りるように */
function formatTime(frames) {
  const cs = Math.round(frames * 100 / 60);        // 1/100 秒
  const m = Math.floor(cs / 6000);
  const s = Math.floor(cs / 100) % 60;
  const h = cs % 100;
  return String(m).padStart(2, '0') + ':' +
    String(s).padStart(2, '0') + '.' + String(h).padStart(2, '0');
}

/** ボスラッシュのタイムを保存する(速い順に 10 件) */
// タイムは短いほど上位。こちらもエンジンの仕組みを使う
const rushTable = new RankingBoard({
  source: rankSource,
  key: RUSH_KEY,
  meKey: RUSH_KEY + '-me',
  max: RUSH_MAX,
  defaults: [],
  compare: byTime,
});

// ボスラッシュのタイム一覧(タイトルの 4 枚目)
let rushTop = 0;
function drawRushList() {
  // 一覧と同じく、裏で件数が変わっていてもはみ出さないように丸める
  rushTop = Math.max(0, Math.min(rushTop, Math.max(0, rushTable.entries.length - HISCORE_ROWS)));
  hud.fill(0, 0, 0, VW, 176);
  const t = '- BOSS RUSH TIME -';
  hud.print(centerX(t), 8, t, 15);
  for (let r = 0; r < HISCORE_ROWS; r++) {
    const i = rushTop + r;
    const e = rushTable.entries[i];
    if (!e) continue;
    const y = HI_LIST_Y + r * 16;
    const mine = !!e.mine;
    hud.print(16, y, String(i + 1).padStart(3) + '.', mine ? 11 : 14);
    hud.print(56, y, ((e.name || 'YOU') + '     ').slice(0, 5), mine ? 11 : 7);
    hud.print(104, y, formatTime(e.frames), mine ? 11 : 15);
  }
  if (rushTable.entries.length === 0) drawNoRecords();
  drawRushArrows();
  drawPageArrows();   // 一覧を描き直すと消えるので、ここでも出し直す
}
function drawRushArrows() {
  const up = String.fromCharCode(0x18), down = String.fromCharCode(0x19);
  const yUp = HI_LIST_Y - 12, yDown = HI_LIST_Y + HISCORE_ROWS * 16 - 4;
  const x = centerX(up);
  hud.fill(0, x, yUp, 8, 8);
  hud.fill(0, x, yDown, 8, 8);
  if (rushTop > 0) hud.print(x, yUp, up, 11);
  if (rushTop + HISCORE_ROWS < rushTable.entries.length) hud.print(x, yDown, down, 11);
}
function updateRushList() {
  const maxTop = Math.max(0, rushTable.entries.length - HISCORE_ROWS);
  if (mmsxx.input.repeat('ArrowUp')) {
    touchTitle(); rushTop = Math.max(0, rushTop - 1); drawRushList(); return;
  }
  if (mmsxx.input.repeat('ArrowDown')) {
    touchTitle(); rushTop = Math.min(maxTop, rushTop + 1); drawRushList(); return;
  }
}

/** ステージワープ。boss=true ならそのステージのボスから始める */
// ボス練習モード。倒しても先へ進まず、同じボスが出続ける
let bossPractice = false;

function warpToStage(n, boss) {
  stageNo = n;
  setPaused(false);
  bossPractice = !!boss;
  hud.fill(0, 0, 112, VW, 24);
  startStage();
  if (boss) stars = starsNeeded(); // 次の更新でボス登場の演出に入る
}

/**
 * 裏技で面やボスへ飛ぶ。**得点は 0 に戻す**。
 * 飛び回って稼ぐ道をふさぐため(飛んだ時点で記録には残せなくなる)。
 * シーン選択から呼ぶ warpToStage は、始めたばかりで 0 なのでそのままでよい
 */
function cheatWarp(n, boss) {
  score = 0;
  drawHUD();
  cheatNotice('SCORE RESET');
  warpToStage(n, boss);
}

function checkCheatCode() {
  // ↑↑↓↓←→←→BA
  for (const code of new Set(KONAMI_CODE)) {
    if (!mmsxx.input.wasPressed(code)) continue;
    if (ARROW_GLYPH[code]) pushTypedShow(ARROW_GLYPH[code]);
    if (code === KONAMI_CODE[konamiPos]) {
      konamiPos++;
      if (konamiPos >= KONAMI_CODE.length) {
        konamiPos = 0;
        if (!usedKonami) { usedKonami = true; grantFullPower('FULL POWER!'); }
      }
    } else {
      konamiPos = code === KONAMI_CODE[0] ? 1 : 0;
    }
    break;
  }

  // 英字と数字を打ち込むタイプのコマンド。打ち終わったら RETURN で確定する
  // (VDP の名前のように、数字を含む語もあるため)。
  // **Ctrl / ⌘ / ALT を押しながらのキーは数えない**。
  // 貼り付け(Ctrl+V)の V や、画面のコピー(ALT+S)の S が入ってしまうため
  const holdMod = mmsxx.input.isDown('ControlLeft') || mmsxx.input.isDown('ControlRight')
    || mmsxx.input.isDown('MetaLeft') || mmsxx.input.isDown('MetaRight')
    || altDown();
  for (let i = 0; !holdMod && i < 36; i++) {
    const ch = i < 26 ? String.fromCharCode(65 + i) : String(i - 26);
    const key = i < 26 ? 'Key' + ch : 'Digit' + ch;
    if (mmsxx.input.wasPressed(key) || (i >= 26 && mmsxx.input.wasPressed('Numpad' + ch))) {
      typed = (typed + ch).slice(-12);
      pushTypedShow(ch);
      return;
    }
  }
  if (mmsxx.input.wasPressed('Backspace') && typedShow) {
    typed = typed.slice(0, -1);
    typedShow = typedShow.slice(0, -1);
    drawCheatInput();
    return;
  }
  if (mmsxx.input.wasPressed('Enter')) {
    const word = typed;
    typed = '';
    typedShow = '';
    drawCheatInput();
    runCheatWord(word);
  }
}

// PC からは貼り付け(Ctrl+V)でも入れられる。長い語を何度も打つのが手間なので。
// 英数字だけを拾い、あとは打ったときと同じ道を通す
if (typeof window !== 'undefined') {
  window.addEventListener('paste', (e) => {
    // 打ち込みを受け付けているとき(ポーズ中)だけ。遊んでいる最中は無視する
    if (!paused) return;
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    const word = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!word) return;
    e.preventDefault();
    for (const ch of word.slice(-12)) {
      typed = (typed + ch).slice(-12);
      pushTypedShow(ch);
    }
  });
}

// ポーズ中に打ち込んだものを画面に出す(RETURN で確定)。
// 英字だけでなく、↑↓←→ も記号にして見せる。
let typedShow = '';
const ARROW_GLYPH = {
  ArrowUp: String.fromCharCode(0x18), ArrowDown: String.fromCharCode(0x19),
  ArrowLeft: String.fromCharCode(0x1a), ArrowRight: String.fromCharCode(0x1b),
};
function pushTypedShow(ch) {
  typedShow = (typedShow + ch).slice(-14);
  drawCheatInput();
}
function drawCheatInput() {
  hud.fill(0, 0, 136, VW, 8);
  if (!typedShow) return;
  const t = typedShow + '-';
  hud.print(centerX(t), 136, t, 7);
}

/**
 * **遊びを途中で捨ててタイトルへ戻る。**
 * 入口は 2 つ(ポーズの RESET ボタンと、打ち込みの Q)。
 * どちらから来ても同じことをして、**同じ数に足す**
 */
function resetToTitle() {
  setPaused(false);
  record.add('resets', 1);
  statsFinish();
  // ポーズから抜けて終わった場合は、**コンティニューできない**。
  // (やられていないのに、同じ面から何度でも始められてしまうため)
  if (continueStages[continueKey()] !== undefined) continueStages[continueKey()] = 1;
  enterTitle();
}

/** 打ち込まれた語を判定して効果を出す */
function runCheatWord(word) {
  // タイトルへ戻る。ほかの語と違い**ちょうど 'Q' のときだけ**効かせる。
  // (endsWith にすると 'AAAAQ' のような打ち間違いでも終わってしまう。
  //  遊びを捨てる操作なので、案内に出したとおりの打ち方だけを通す)
  if (word === 'Q') {
    resetToTitle();
    return;
  }
  // CLS: ポーズ中の文字(PAUSE / ESC:RESUME... / 打ち込み)を消す。
  // **画面写真を撮るためのもの**なので、止めたままで何も知らせない
  // (知らせを出すと、それが写ってしまう)。
  // Q と同じく**ちょうど 'CLS' のときだけ**効かせる
  if (word === 'CLS') {
    clearPauseText();
    return;
  }
  // オート連射のコマンド(MEIJIN / TAKAHASHI / TOSHIYUKI)。
  // **打たれた名前ごとに 1 回だけ**効く
  const autoCode = AUTO_CODES.find(c => word.endsWith(c));
  if (autoCode) {
    if (!autoUsed.has(autoCode)) {
      autoUsed.add(autoCode);
      autoFire = AUTO_FIRE_TIME;
      maxVolleys = MAX_VOLLEY_LIMIT;   // ラピッドも最大にする
      drawHUD();
      cheatNotice('AUTO FIRE!');
      mmsxx.audio.playSE('item');
    }
    return;
  }
  // ORB / ORBMAX: 宝珠を満タンにして、すぐボスへ行けるようにする(手元の開発中だけ)。
  // **どちらの綴りでも効く**(ORB は endsWith では ORBMAX に当たらないため両方見る)
  if (word.endsWith('ORBMAX') || word.endsWith('ORB')) {
    if (!DEV) return;
    stars = starsNeeded();
    drawHUD();
    cheatNotice('ORBS FULL');
    mmsxx.audio.playSE('item');
    return;
  }
  // 当たり判定の表示を切り替える(手元の開発中だけ)
  if (word.endsWith('HITAREA')) {
    if (!DEV) return;
    showHitArea = !showHitArea;
    if (!showHitArea) dbg.clear();
    cheatNotice('HIT AREA ' + (showHitArea ? 'ON' : 'OFF'));
    mmsxx.audio.playSE('item');
    return;
  }
  // VDP の名前を打つと、画面の色合いが変わる。
  //   TMS9918 = MSX1 の流派だけを順ぐりに(MSX2 の色へは飛ばない)
  //   V9938   = MSX2 の色へ。もう MSX2 なら MSX1 へ戻る
  // 絵は色番号で持っているので、描き直さずに色だけ入れ替わる
  if (word.endsWith('TMS9918') || word.endsWith('V9938')) {
    const names = mmsxx.paletteNames;
    const msx1 = names.filter((n) => mmsxx.paletteFamily(n) === 'msx1');
    const msx2 = names.filter((n) => mmsxx.paletteFamily(n) === 'msx2');
    let next;
    if (word.endsWith('V9938')) {
      next = mmsxx.paletteFamily() === 'msx2' ? msx1[0] : msx2[0];
    } else {
      // MSX2 の色から打たれたときは、MSX1 のいちばん最初へ戻す
      const at = msx1.indexOf(mmsxx.palette);
      next = at < 0 ? msx1[0] : msx1[(at + 1) % msx1.length];
    }
    mmsxx.setPalette(next);
    drawMuteBtn();   // ボタンの絵もパレットの色で描いているので、作り直す
    // 名乗りはエンジン側が持っている(色合いを増やしてもここは直さなくていい)
    cheatNotice(mmsxx.paletteLabel());
    mmsxx.audio.playSE('item');
    return;
  }
  // DRAGON: 七色の推進炎を手に入れる(開発用)。
  // ドラゴンの星座が出る 5 面から先でだけ効く。
  // やられても消えないので、1 回打てばそのゲーム中はずっと使える
  if (word.endsWith('DRAGON')) {
    if (stageNo >= LAST_STAGE) {
      dragonFlame = true;
      showNotice('DRAGON FLAME!');
      mmsxx.audio.playSE('item');
    }
    return;
  }
  if (word.endsWith('HYPER')) {
    if (!usedHyper) { usedHyper = true; grantFullPower('HYPER!'); }
    return;
  }
  // 一気にゲームオーバー。残機を捨てて終わらせる(スタッフロールには載せない)。
  // 'AHO' より先に見ること(AHOAHO は AHO でも終わってしまうため)
  if (word.endsWith('AHOAHO') || word.endsWith('BAKABON')) {
    setPaused(false);
    hud.fill(0, 0, 80, VW, 64);
    ships = 0;
    barrierHP = 0;   // バリアで肩代わりされないように
    destroyPlayer('CHEAT GIVE UP');
    return;
  }
  if (word.endsWith('AHO') || word.endsWith('BAKA')) {
    setPaused(false);
    hud.fill(0, 0, 80, VW, 64);
    destroyPlayer("CHEAT SUICIDE");
    return;
  }
  // 面移動とボスへの移動は、それぞれ 1 ゲームに 1 回だけ。
  // 2 回目からは打っても何も起きない
  for (const [w, n] of Object.entries(STAGE_CODES)) {
    if (!word.endsWith(w)) continue;
    if (usedStageWarp) return;
    usedStageWarp = true;
    cheatWarp(n, false);
    return;
  }
  for (const [w, n] of Object.entries(BOSS_CODES)) {
    if (!word.endsWith(w)) continue;
    if (usedBossWarp) return;
    usedBossWarp = true;
    cheatWarp(n, true);
    return;
  }
  // 仮ボス「未実装君」との対決(本編には出てこない)。これもボス移動の 1 回に数える
  if (word.endsWith(MIJISSOU_CODE)) {
    if (usedBossWarp) return;
    usedBossWarp = true;
    cheatWarp(RUSH_TODO, true);
    return;
  }
  // エンディングを見る(まだ作っていないので、いまは合図だけ)
  if (word.endsWith(ENDING_CODE)) { enterEnding(); return; }
}

// ---- シーン選択(手元の開発中だけ) ----
// もとはタイトルで BOSS RUSH を選んで CTRL を押す裏技だったが、
// 見たい場面が増えてきたので、独立した画面に移した。
// 公開版ではモード自体が出てこない(BUILD.dev)。
let sceneSel = 0;
let sceneTop = 0;
const SCENE_ROWS = 9;    // 一度に出す行数(いちばん下と操作の案内のあいだを空ける)
const SCENE_TOP_Y = 24;  // 1 行目の高さ
// 行の送り。**8 の倍数にすること**。文字は 8 ドット単位に丸められるので、
// 半端な送りにすると 8 と 16 が交互になって行間が不ぞろいに見える
const SCENE_STEP = 16;

/** 通常モードでゲームを始めてから、指定の面(またはそのボス)へ飛ぶ */
function sceneStart(stage, boss) {
  modeIndex = MODES.findIndex(m => m.id === 'normal');
  enterPlay();
  warpToStage(stage, boss);
}

/** ボスラッシュを、決まった相手だけで始める */
/** @param {number} stage 0 = 4 体タイムアタック / それ以外はその相手だけ */
function sceneRush(stage) {
  modeIndex = MODES.findIndex(m => m.id === 'bossrush');
  rushOne = stage;
  enterPlay();
}

/** 選べる場面の一覧。増やしたければここに 1 行足すだけ */
function sceneList() {
  const list = [
    { label: 'ENDING', run: () => enterEnding() },
    // **開発用の口は経由しない。**あれは公開版のビルドで切り落とされるので、
    // ここから呼ぶと参照だけが残ってしまう
    { label: 'NAME ENTRY', run: () => { score = 123456; enterNameEntry('score'); } },
  ];
  for (let n = 1; n <= LAST_STAGE; n++) {
    list.push({ label: 'STAGE ' + n, run: () => sceneStart(n, false) });
  }
  // 1〜4 面のボスはボスラッシュで戦えるので、ここにはラスボスだけ置く
  list.push({
    label: 'BOSS ' + LAST_STAGE + '  ' + BOSS_NAMES[LAST_STAGE - 1],
    run: () => sceneStart(LAST_STAGE, true),
  });
  // ラスボスの第 2 段階(シルエットマン)から始める。裂け目を飛ばして確かめられる
  list.push({
    label: 'BOSS ' + LAST_STAGE + '  PHASE 2',
    run: () => { sceneStart(LAST_STAGE, true); pendingKingPhase2 = true; },
  });
  list.push({ label: 'BIG MOAI', run: () => sceneStart(RUSH_MOAI, true) });
  list.push({ label: 'TWIN EYES', run: () => sceneStart(RUSH_EYES, true) });
  // 未実装さん。**ここで戦っても印は付かない**(図鑑もボスラッシュも開かない)。
  // 出会うのは 2 回目のコンティニューだけ
  list.push({ label: 'Mr. MIJISSOU', run: () => sceneStart(RUSH_TODO, true) });
  // ボスラッシュの個別選択は、ボスラッシュのメニュー側に移した
  return list;
}
let scenes = [];

/** 一覧から選ぶ画面(シーン選択とボスラッシュのメニューで使い回す) */
function enterListMenu(title, items) {
  state = 'scene';
  setPaused(false);
  clearEntities();
  for (const sp of helpIconSprites()) sp.visible = false;
  player.visible = false;
  aux.visible = false;   // 炎とバリアも一緒に消す
  mmsxx.audio.stopBGM();
  currentBGM = null;
  neb.clear();
  sceneTitle = title;
  scenes = items;
  sceneSel = 0;
  sceneTop = 0;
  drawSceneSelect();
}
let sceneTitle = '- SCENE SELECT -';

function enterSceneSelect() { enterListMenu('- SCENE SELECT -', sceneList()); }

// ---- 記録の画面(STATISTICS) ----
// 遊んだあとの数字を並べるだけの画面。項目が多いので縦に送れる。
// **手元にしか残らない**ことを最後に書いておく(消えても仕方ない、と分かるように)。

// **ことわりが無いときの形で画面を組む**。ことわりはその上に一時的に重ねるだけで、
// 消えたあとに空きができないようにする
const STAT_ROWS = 18;      // 出せる行数(下まで使いきる)
const STAT_TOP = 24;       // 1 行目の高さ
// 行の送り。**8 の倍数にすること**。エンジンの文字は 8 ドット単位に丸められるので、
// 半端な送りにすると 8 と 16 が交互になって行間が不ぞろいに見える
const STAT_STEP = 8;
const STAT_NOTE_Y = 160;   // ことわりを重ねる高さ(2 行ぶん)
const STAT_NOTE_TIME = 360;// 1 枚を出しておく長さ(6 秒)
// 出しておきたいことわり。**1 枚ずつ順に**出す(空く時間は作らず、すぐ次へ)。
// 一覧の最後にも同じものを置いてあるので、あとから読み直せる。
// 1 行は 32 文字まで(画面の幅)
const STAT_NOTES = [
  ['RECORD IS KEPT IN THIS BROWSER.', 'IT IS LOST IF YOU SWITCH.'],
  ['SAVING HAPPENS ON STAGE CLEAR', 'AND ON GAME OVER.'],
];
let statTop = 0;
let statNoteAt = 0;        // いま出しているのは何枚目
let statNoteRow = -1;      // 一覧のことわりが始まる行
let statNoteTimer = 0;


/**
 * 統計に出す数。**3 桁ごとの区切りは入れない**。
 * 画面が狭く、名前と数が同じ行に並ぶので、点の 2〜3 文字が効いてくる
 */
function statNum(n) {
  return String(Math.floor(n));
}

/** 秒を H:MM:SS にする */
function formatSpan(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor(sec / 60) % 60;
  const s = Math.floor(sec) % 60;
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

/**
 * 出す行を組む。['見出し', '値'] の並び。値が null なら見出しだけの区切り行。
 * 増やしたければここに 1 行足すだけ
 */
function statList() {
  const g = (name) => record.get(name);
  const rows = [];
  const add = (name, text) => rows.push([record.label(name), text]);
  // 見出しの前後を 1 行あける(かたまりの切れ目を見せる)。先頭の前だけは空けない
  const gap = (title) => {
    if (rows.length) rows.push(['', null]);
    rows.push([title, null]);
    rows.push(['', null]);
  };

  gap('- GAME PLAY -');
  add('playsNormal', statNum(g('playsNormal')));
  add('playsHard', statNum(g('playsHard')));
  add('playSeconds', formatSpan(g('playSeconds')));
  add('totalScore', statNum(g('totalScore')));
  add('deaths', statNum(g('deaths')));
  add('resets', statNum(g('resets')));
  add('hits', statNum(g('hits')));

  gap('- SHOTS -');
  add('enemyKills', statNum(g('enemyKills')));
  add('backfireKills', statNum(g('backfireKills')));
  add('shots', statNum(g('shots')));
  add('mostShots', statNum(g('mostShots')));
  add('maxRapid', g('maxRapid').toFixed(1));
  add('maxStreak', g('maxStreak') + ' SEC');
  // 通算の平均は、持っている 2 つの数から出せるので記録には持たない
  const sec = g('playSeconds');
  rows.push(['AVG SHOTS/SEC', sec > 0 ? (g('shots') / sec).toFixed(1) : '0.0']);

  gap('- BOSS -');
  for (let n = 1; n <= 4; n++) add('boss' + n + 'S', statNum(g('boss' + n + 'S')));
  // ラスボスは、倒したことがある人にだけ出す(いること自体は図鑑で分かる)
  if (met('kingDown')) add('kingS', statNum(g('kingS')));

  gap('- LOCAL HIGH SCORE -');
  add('hiNormal', statNum(g('hiNormal')));
  add('hiHard', statNum(g('hiHard')));
  add('rushBest', g('rushBest') > 0 ? formatTime(g('rushBest')) : '--:--.--');

  gap('- OTHER -');
  add('shares', statNum(g('shares')));

  // 一覧の最後にも同じことわりを置く(重ねて出したものは消えてしまうため)。
  // こちらは**2 つとも続けて**並べ、時間で消したりはしない
  rows.push(['', null]);
  for (const note of STAT_NOTES) {
    for (const line of note) rows.push([line, null, 13]);
  }
  return rows;
}
let statRows = [];

function enterStats() {
  state = 'stats';
  setPaused(false);
  clearEntities();
  for (const sp of helpIconSprites()) sp.visible = false;
  player.visible = false;
  aux.visible = false;
  neb.clear();
  playBGM('beat', true, true);   // 記録を眺めているあいだのリズム
  statRows = statList();
  // 一覧の最後に置いたことわりが何行目から始まるか(重ねているほうを消す目印)
  statNoteRow = statRows.findIndex((r) => r[2] === 13);
  statTop = 0;
  statNoteAt = 0;
  statNoteTimer = STAT_NOTE_TIME;
  drawStats();
}

function drawStats() {
  hud.clear();
  const title = '- STATISTICS -';
  hud.print(centerX(title), 8, title, 15);
  for (let r = 0; r < STAT_ROWS; r++) {
    const row = statRows[statTop + r];
    if (!row) break;
    const y = STAT_TOP + r * STAT_STEP;
    const [label, value, col] = row;
    if (value === null) {
      // 色を決めてある行(ことわり)は**画面いっぱいまで届く**ので中央に置く。
      // 区切りの見出しは、ほかの行と頭をそろえる
      if (col) hud.print(centerX(label), y, label, col);
      else hud.print(24, y, label, 11);
      continue;
    }
    // 見出しは灰色、数字は水色。目が数字だけを拾えるように分ける
    hud.print(24, y, label, 14);
    hud.print(VW - value.length * 8 - 24, y, value, 7);
  }
  // 送れることは下の案内(↑↓:SCROLL)で足りるので、右上には何も出さない
  drawStatNote();
  const help = String.fromCharCode(0x18, 0x19) + ':SCROLL  ESC:EXIT';
  hud.print(centerX(help), 184, help, 10);
}

/**
 * ことわり。**2 つを並べて**一度に出し、赤とピンクを 2 コマずつで点滅させる。
 * 消えるコマを挟むと読みづらいので、**色だけ**を入れ替える。
 * 一覧の上に重ねるだけなので、消えたあとに空きはできない
 */
function drawStatNote() {
  const note = STAT_NOTES[statNoteAt];
  // 出すものが無いときは**帯を消さない**。消すと、そこに出ている行まで消えてしまう
  if (!note || statNoteTimer <= 0) return;
  hud.fill(0, 0, STAT_NOTE_Y, VW, 16);
  const col = Math.floor(mmsxx.frame / 2) % 2 ? 13 : 8;   // ピンク / 赤
  note.forEach((t, i) => hud.print(centerX(t), STAT_NOTE_Y + i * 8, t, col));
}

/**
 * ことわりを 1 コマぶん進める。
 * 1 枚出し終わったら**間を置かずに**次の 1 枚へ移り、
 * 全部終わったら消して、隠れていた行を出し直す
 */
function updateStatNote() {
  if (statNoteAt >= STAT_NOTES.length) return;
  if (--statNoteTimer > 0) { drawStatNote(); return; }
  statNoteAt++;
  statNoteTimer = STAT_NOTE_TIME;
  if (statNoteAt < STAT_NOTES.length) drawStatNote();
  else drawStats();
}

/**
 * 送った先に**一覧のことわり**が見えてきたら、重ねているほうは消す。
 * 同じ文が 2 つ出ていると読みづらいため
 */
function dropStatNoteIfListed() {
  if (statNoteAt >= STAT_NOTES.length) return;
  if (statNoteRow < 0 || statTop + STAT_ROWS <= statNoteRow) return;
  statNoteAt = STAT_NOTES.length;
  statNoteTimer = 0;
}

function updateStats() {
  // ことわりは点滅させるので、出ているあいだは毎コマ描き直す
  updateStatNote();
  if (mmsxx.input.wasPressed('Escape')) { enterTitle(); return; }
  const maxTop = Math.max(0, statRows.length - STAT_ROWS);
  // 押しっぱなしで送れるようにする(項目が多いので 1 回ずつでは遅い)
  if (mmsxx.input.repeat('ArrowUp') && statTop > 0) {
    statTop--; dropStatNoteIfListed(); drawStats(); return;
  }
  if (mmsxx.input.repeat('ArrowDown') && statTop < maxTop) {
    statTop++; dropStatNoteIfListed(); drawStats(); return;
  }
}

// ---- 開発用の設定画面(手元の開発中だけ) ----
// 進みぐあいの印を、遊ばずに立てたり落としたりする。
// 開いた状態と閉じた状態の見た目を、その場で見くらべるためのもの。
// **押した時点では保存しない**。APPLY を選んだときにまとめて書き込む
// (触っている途中の状態がそのまま残ると、確かめたい形を作りにくいため)。

/** 触れる印。ボスラッシュの 5 つと、図鑑のラスボス */
const DEVSET_NAMES = [
  'boss1Met', 'boss1Down', 'boss2Met', 'boss2Down',
  'boss3Met', 'boss3Down', 'boss4Met', 'boss4Down',
  'todoMet', 'todoDown', 'kingMet', 'kingDown',
];
const DEVSET_TOP = 24;    // 1 行目の高さ
// 行の送り。**8 の倍数にすること**(文字は 8 ドット単位に丸められるため)
const DEVSET_STEP = 8;
let devSel = 0;
/** 画面で触っている途中の値(APPLY するまで保存しない) */
let devEdit = {};
/** 消したときなどの知らせ(しばらく出して消える) */
let devMsg = '';
let devMsgTimer = 0;

function enterDevSettings() {
  state = 'devset';
  setPaused(false);
  clearEntities();
  for (const sp of helpIconSprites()) sp.visible = false;
  player.visible = false;
  aux.visible = false;
  mmsxx.audio.stopBGM();
  currentBGM = null;
  neb.clear();
  devEdit = {};
  for (const name of DEVSET_NAMES) devEdit[name] = progress.get(name);
  devSel = 0;
  drawDevSettings();
}

function drawDevSettings() {
  hud.clear();
  const title = '- DEV SETTINGS -';
  hud.print(centerX(title), 8, title, 15);
  for (let r = 0; r < DEVSET_NAMES.length; r++) {
    const name = DEVSET_NAMES[r];
    const here = r === devSel;
    const mark = here ? String.fromCharCode(0x1b) : ' ';
    hud.print(24, DEVSET_TOP + r * DEVSET_STEP, mark + progress.label(name), here ? 11 : 14);
    // ON / OFF は水色にして、見出しと見分けやすくする(STATISTICS と同じ)。
    // 変えたところだけ色を変えて、まだ書き込んでいないことを見せる
    const changed = devEdit[name] !== progress.get(name);
    hud.print(200, DEVSET_TOP + r * DEVSET_STEP,
      devEdit[name] ? 'ON' : 'OFF', changed ? 10 : 7);
  }
  const at = DEVSET_NAMES.length;
  const mark = (i) => (devSel === i ? String.fromCharCode(0x1b) : ' ');
  const col = (i) => (devSel === i ? 11 : 14);
  hud.print(24, DEVSET_TOP + (at + 1) * DEVSET_STEP, mark(at) + 'APPLY', col(at));
  // 記録の消去。項目ごとに消せてもうれしくないので、まとめて消すだけにする
  hud.print(24, DEVSET_TOP + (at + 2) * DEVSET_STEP,
    mark(at + 1) + 'RESET STATISTICS', col(at + 1));
  if (devMsgTimer > 0) hud.print(24, DEVSET_TOP + (at + 4) * DEVSET_STEP, devMsg, 10);
  const help = 'SP:TOGGLE  ESC:EXIT';
  hud.print(centerX(help), 176, help, 10);
}

/** 画面で触った値を書き込む */
function applyDevSettings() {
  for (const name of DEVSET_NAMES) progress.set(name, devEdit[name]);
  progress.flush();
}

function updateDevSettings() {
  if (devMsgTimer > 0 && --devMsgTimer === 0) drawDevSettings();
  if (mmsxx.input.wasPressed('Escape')) { enterTitle(); return; }   // 書かずに戻る
  const n = DEVSET_NAMES.length + 2;   // うしろの 2 行は APPLY と RESET STATISTICS
  let moved = false;
  if (mmsxx.input.wasPressed('ArrowUp')) { devSel = (devSel + n - 1) % n; moved = true; }
  if (mmsxx.input.wasPressed('ArrowDown')) { devSel = (devSel + 1) % n; moved = true; }
  if (moved) { mmsxx.audio.playSE('item'); drawDevSettings(); }
  if (mmsxx.input.wasPressed('Space')) {
    if (devSel === DEVSET_NAMES.length) {
      applyDevSettings();
      mmsxx.audio.playSE('item');
      enterTitle();
      return;
    }
    if (devSel === DEVSET_NAMES.length + 1) {
      // 記録をまとめて消す。数えている途中のぶんも捨てる
      // (残しておくと、消した直後の書き出しでまた増えてしまう)
      record.resetAll();
      tally.kills = tally.backfire = tally.shots = tally.hits = tally.deaths = tally.frames = 0;
      tallyScore = score;
      framesLeft = 0;
      playShots = 0;
      mmsxx.audio.playSE('item');
      devMsg = 'STATISTICS CLEARED';
      devMsgTimer = 180;
      drawDevSettings();
      return;
    }
    const name = DEVSET_NAMES[devSel];
    devEdit[name] = !devEdit[name];
    mmsxx.audio.playSE('item');
    drawDevSettings();
  }
}

/**
 * ボスラッシュのメニュー。
 * 4 体タイムアタックはいつでも。個別の相手は**倒したことのあるボスだけ**。
 * ラスボスはここには出さない。4 体そろったら未実装君がおまけで増える。
 */
/**
 * まだ倒していない相手の名前を伏せる。
 * 「KING ?????」のように、**頭の 1 語だけ残して**あとを ? に置き換える。
 * 名前の長さがそのまま見えるので、開いたときの答え合わせにもなる
 */
function maskName(name) {
  const at = name.indexOf(' ');
  if (at < 0) return '?'.repeat(name.length);
  return name.slice(0, at + 1) + '?'.repeat(name.length - at - 1);
}

function rushMenuList() {
  const list = [
    { label: 'BOSS x 4 TIME ATTACK', run: () => sceneRush(0) },
  ];
  // まだ倒していない相手も**行としては出す**。
  // 暗い色と伏せた名前で見せて、「倒せば開く」と分からせる
  let known = 0;
  for (const n of BOSS_RUSH_STAGES) {
    const open = met('boss' + n + 'Down');
    if (open) known++;
    // 開発版では、まだ倒していない相手も**選べる**(名前は伏せたまま)。
    // 作っている最中に、開けるまで戦えないのでは確かめられない
    list.push(open
      ? { label: 'VS ' + BOSS_NAMES[n - 1], run: () => sceneRush(n) }
      : { label: 'VS ' + maskName(BOSS_NAMES[n - 1]), closed: true, locked: !DEV,
        run: DEV ? () => sceneRush(n) : undefined });
  }
  // 4 体そろったごほうび。本編には出てこない相手。
  // そろうまでは「まだ何かある」ことだけを見せる
  // 未実装さんは **一度会っていれば** 選べる。
  // 会えるのはコンティニューのときだけなので、開けかたはその 1 とおり
  // (「ラッシュで倒したら」を条件にすると、開くために開いている必要が出てしまう)
  const metTodo = met('todoMet');
  list.push(metTodo
    ? { label: 'VS Mr. MIJISSOU', run: () => sceneRush(RUSH_TODO) }
    : { label: 'VS ' + maskName('Mr. MIJISSOU'), closed: true, locked: !DEV,
      run: DEV ? () => sceneRush(RUSH_TODO) : undefined });
  return list;
}

function enterBossRushMenu() { enterListMenu('- BOSS RUSH -', rushMenuList()); }

function drawSceneSelect() {
  hud.clear();
  hud.print(centerX(sceneTitle), 8, sceneTitle, 15);
  // 選んでいる行が真ん中あたりに来るように切り出す
  sceneTop = Math.max(0, Math.min(scenes.length - SCENE_ROWS, sceneSel - (SCENE_ROWS >> 1)));
  for (let r = 0; r < SCENE_ROWS; r++) {
    const i = sceneTop + r;
    if (i >= scenes.length) break;
    const here = i === sceneSel;
    const mark = here ? String.fromCharCode(0x1b) : ' ';
    // 色で見せるのは**開いているかどうか**。まだ開いていない行は、
    // カーソルが乗っても暗いままにする。
    // 押せるかどうか(locked)は色に出さない。開発版では、まだ開いていない相手にも
    // 入れるようにしてあるが、見た目は公開版と同じにしておきたいため
    const col = scenes[i].closed ? 12 : (here ? 11 : 14);
    hud.print(24, SCENE_TOP_Y + r * SCENE_STEP, mark + scenes[i].label, col);
  }
  const pos = (sceneSel + 1) + '/' + scenes.length;
  hud.print(VW - pos.length * 8 - 8, 8, pos, 14);
  const help = 'SP:GO  ESC:EXIT';
  hud.print(centerX(help), 176, help, 10);
}

function updateSceneSelect() {
  if (mmsxx.input.wasPressed('Escape')) { enterTitle(); return; }
  const n = scenes.length;
  let moved = false;
  if (mmsxx.input.wasPressed('ArrowUp')) { sceneSel = (sceneSel + n - 1) % n; moved = true; }
  if (mmsxx.input.wasPressed('ArrowDown')) { sceneSel = (sceneSel + 1) % n; moved = true; }
  if (moved) { mmsxx.audio.playSE('item'); drawSceneSelect(); }
  if (mmsxx.input.wasPressed('Space')) {
    // まだ開いていない項目は選べない。断る音だけ鳴らす
    if (scenes[sceneSel].locked || !scenes[sceneSel].run) {
      mmsxx.audio.playSE('nobreak', SE_HIT);
      return;
    }
    hud.clear();
    scenes[sceneSel].run();
  }
}

// ---- ストーリー画面(エンディング / エンジンの紹介) ----
// どちらもエンジンの任意部品 StoryScenes にまかせる(docs/UTIL.md 参照)。
// ここでは「どんな場面を出すか」だけを書く。
let story = null;
let storyDone = null;   // 見終わったあとにどこへ行くか
// ストーリー用のスプライト(場面ごとに出し入れする)
let storySprites = null;

function storySpriteSet() {
  if (!storySprites) {
    const man = mmsxx.sprite(SPRITE_SYMBOLS.kingMan00);
    man.priority = 20;
    const ship = mmsxx.sprite(SPRITE_SYMBOLS.player);
    ship.priority = 20;
    const jet = mmsxx.sprite(SPRITE_SYMBOLS.flameBig);
    jet.priority = 19;
    // パイロットの目。絵に描き込むとディザでつぶれるのでスプライトにする。
    // 見開いた目(青い丸)は 1 色スプライトだと「玉」にしか見えず気味が悪いので、
    // **両目とも閉じた線**にする。左右で線の向きを反転させて表情をそろえる
    const eye = mmsxx.sprite(SPRITE_SYMBOLS.pilotWink);
    eye.flipX = true;
    const wink = mmsxx.sprite(SPRITE_SYMBOLS.pilotWink);
    const smile = mmsxx.sprite(SPRITE_SYMBOLS.pilotSmile);   // 笑った口
    // ひとみ。絵に描いた 1 ドットの点の上に重ねる 4x4 の黒い丸
    const pupilL = mmsxx.sprite(SPRITE_SYMBOLS.pilotPupil);
    const pupilR = mmsxx.sprite(SPRITE_SYMBOLS.pilotPupil);
    eye.priority = wink.priority = smile.priority = 21;
    pupilL.priority = pupilR.priority = 22;
    // 裂け目の真ん中を補う光。走査線で落ちる明るさをここで足す
    const glow = mmsxx.sprite(SPRITE_SYMBOLS.riftGlow);
    glow.priority = 21;
    // エンディングの茶々。**走査線は掛けない**(絵から浮かせたいので、
    // まわりのディザに合わせずに素のドットで出す)
    const lol = mmsxx.sprite(SPRITE_SYMBOLS.markLol);
    // W は 1 ドットずつ空けると 16 に入らないので、**2 枚に分けて**並べる
    const ww = mmsxx.sprite(SPRITE_SYMBOLS.markWw);
    const w3 = mmsxx.sprite(SPRITE_SYMBOLS.markW);
    lol.priority = ww.priority = w3.priority = 23;
    storySprites = { man, ship, jet, eye, wink, smile, pupilL, pupilR, glow, lol, ww, w3 };
    for (const sp of Object.values(storySprites)) sp.visible = false;
  }
  return storySprites;
}

/** エンディング。4 秒 x 3 枚 */
// エンディング最後の場面(青いひび)を置く高さ。文字と離すぶんだけ上げてある
const RIFT_SCENE_Y = -8;

function buildEnding() {
  return new StoryScenes(mmsxx, {
    artLayer: 3, textLayer: 4, textY: 160, lineStep: 12,
    // 時間では進まない。読み終えたらスペースで自分で送る
    manual: true,
    // 「押してほしそう」を文字ではなく 8x8 の絵の動きで伝える。
    // 場所を書かないと、文章の最後の行のうしろに付く
    prompt: { frames: [BG_SYMBOLS.guiNext0, BG_SYMBOLS.guiNext1, BG_SYMBOLS.guiNext2, BG_SYMBOLS.guiNext3], rate: 8, after: 24 },
    scenes: [
      {
        // 1. 宇宙に平和が戻った
        hold: 360,
        text: ['PEACE RETURNED', 'TO THE STARS.'],
        onEnter: () => { mmsxx.backdrop = 1; },
        // 192x192。中間色は 1 ライン おきのディザ。
        // duo を持つ場面は、1 コマごとにディザを裏返して描き直す(下の updateStory)
        duo: { image: BG_SYMBOLS.earthBig, maps: GAME_DATA.duo.earth, x: 32, y: 0 },
        draw: (m, art) => { art.draw(32, 0, BG_SYMBOLS.earthBig, true,
          { colorMap: GAME_DATA.duo.earth[0] }); },
        sprites: () => {
          const s = storySpriteSet();
          // 地球の真ん中あたりに置く(地球は 192x192 を y=0 から描いている)
          s.ship.x = 120; s.ship.y = 84;
          s.jet.x = 120; s.jet.y = 100;
          return [s.ship, s.jet];
        },
      },
      {
        // 2. みんなが待っている基地へ、戦闘機が降りてくる
        hold: 360,
        text: ['BACK AMONG FRIENDS AT LAST.', 'MAY SHE NEVER LAUNCH AGAIN.'],
        textColor: 11,
        onEnter: () => { mmsxx.backdrop = 1; },
        duo: { image: BG_SYMBOLS.endBase, maps: GAME_DATA.duo.base, x: 16, y: 0 },
        draw: (m, art) => { art.draw(16, 0, BG_SYMBOLS.endBase, true,
          { colorMap: GAME_DATA.duo.base[0] }); },
      },
      {
        // 3. パイロットが手を振って見送る
        hold: 360,
        // パイロットはこの子であり、遊んでいる本人でもある。呼びかけない
        text: ['STAR FABLE, SIGNING OFF.', 'UNTIL THE NEXT FLIGHT.'],
        textColor: 11,
        // この子が出たところで、コンソールに ひとこと(ふざけた注釈)。
        // 画面には出さない。開いている人にだけ届くおまけ
        onEnter: () => { mmsxx.backdrop = 1; tellPortraitJoke(); },
        // 中間色は 1 ライン おきのディザ。目印の色を実際の色へ置き換えて描く
        duo: { image: BG_SYMBOLS.pilot, maps: GAME_DATA.duo.pilot, x: PILOT_X, y: 0 },
        draw: (m, art) => { art.draw(PILOT_X, 0, BG_SYMBOLS.pilot, true,
          { colorMap: GAME_DATA.duo.pilot[0] }); },
        sprites: () => {
          // 顔の上に目を置く。絵は中身を測って中央に寄せてあり、
          // そのときの顔の中心が絵の x=138(makedata が出している)
          const s = storySpriteSet();
          // 顔の中心 x=102 / 顔は y=45..73(絵から実測した値)。
          // 紙吹雪が画面いっぱいに散るので絵の中央寄せは効かない。
          // ここは計算ではなく、実測した位置に合わせている
          const fx = PILOT_X + 102;
          // **目は出さない**(丸い青目も、閉じた線も置かない)。
          // 表情は絵に描いたまゆと、この口だけで見せる。
          // 口はさらに 右 2 ドット・下 2 ドット
          s.smile.x = fx - 2; s.smile.y = 64;
          // ひとみ。絵の中の点(x=99 / 114, y=57)にぴったり重ねる。
          // 5x5 なので、点の 2 ドット左上から置く(中心は動かさない)
          s.pupilL.x = PILOT_X + 97; s.pupilL.y = 55;
          s.pupilR.x = PILOT_X + 112; s.pupilR.y = 55;
          // 絵と同じ走査線をスプライトにも掛ける。
          // 画面のどの行が消えるかをそろえたいので、置く y の偶奇を足す
          for (const sp of [s.smile, s.pupilL, s.pupilR]) sp.scanline = (sp.y + 1) & 1;
          // 茶々。**8 ドットの升目に乗せない**位置へ置いて、
          // あとから書き込んだように浮かせる(走査線も掛けない)
          s.lol.x = PILOT_X + 13; s.lol.y = 77;    // 左の生きもののそば
          // WWW は 2 枚に分けて、1 ドット空けて並べる。
          // **目と同じ行に並べない**(1 行に出せる数の取り合いで欠けるため)
          // ので、目より下へ置く。手にかぶってよい
          s.ww.x = PILOT_X + 147; s.ww.y = 66;
          s.w3.x = PILOT_X + 159; s.w3.y = 66;
          return [s.smile, s.pupilL, s.pupilR, s.lol, s.ww, s.w3];
        },
      },
      {
        // 4. 宇宙に走った青いひびが、あやしく光っている
        hold: 360,
        text: ['TO BE CONTINUED?'],
        textColor: 15,
        // 青いひびが出きってから文字を出す。
        // ひびは 2 秒待って(fadeDelay 120)から 2.5 秒かけて現れる(STORY_FADE_LEN 150)
        textWait: 280,
        typing: 0.045,   // 1 文字ずつ、ゆっくり浮かび上がらせる(4 倍おそく)
        // ひびの光を沈ませるため、背景は黒に戻す。
        // ここで曲も落とす(最後の場面は静かに終わらせる)
        // 曲は 10 秒かけてゆっくり落とす(場面は 6 秒なので、
        // 消えきる前に静かになっていく)
        onEnter: () => { mmsxx.backdrop = 1; mmsxx.audio.fadeOutBGM(10); },
        // **8 ドット上へ**。下は 160 から出る「TO BE CONTINUED?」の行なので、
        // そのままだとひびの下端(絵の 159 行目)と文字がくっついて見える。
        // 絵の上 32 行は空なので、上へずらしても欠けるところは無い
        duo: { image: BG_SYMBOLS.endRift, maps: GAME_DATA.duo.rift, x: 16, y: RIFT_SCENE_Y },
        draw: (m, art) => { art.draw(16, RIFT_SCENE_Y, BG_SYMBOLS.endRift, true,
          { colorMap: GAME_DATA.duo.rift[0] }); },
        // 絵は 4 コマのパラパラアニメで、真ん中から上下へ裂けて出てくる。
        // ちらつきも重ねて「まだ実体でない」感じを出す。
        // はじめの 2 秒は真っ黒のまま待ってから出はじめる
        fadeIn: true,
        fadeDelay: 120,
        growFrames: [BG_SYMBOLS.endRift0, BG_SYMBOLS.endRift1, BG_SYMBOLS.endRift2, BG_SYMBOLS.endRift],
        sprites: () => {
          // 縦の真ん中だけ、スプライトで白く光らせて補う。
          // 走査線は絵のほうに残したまま、明るさだけ足す形
          const s = storySpriteSet();
          // 絵は 32 幅で、背景と同じだけ左右へ曲がっている。
          // 切り出した位置(裂け目の中ほど)に合わせて置く
          s.glow.x = 16 + 112 - 16;
          s.glow.y = RIFT_SCENE_Y + 32 + Math.round((128 - 64) / 2);
          return [s.glow];
        },
      },
    ],
    onEnd: () => finishStory(),
  });
}

/** 見終わったあとの後始末 */
function finishStory() {
  neb.scanline = null;   // 走査線を止めて元に戻す
  neb.clear();           // 絵を残さない(次の画面の背景に重なる)
  restoreSpace();
  mmsxx.audio.stopBGM();
  currentBGM = null;
  (storyDone || enterTitle)();
}

/** ストーリー画面を出す共通の入口 */
function enterStory(build, bgm, onDone) {
  storyDone = onDone || null;
  state = 'story';
  setPaused(false);
  clearEntities();
  for (const sp of helpIconSprites()) sp.visible = false;
  player.visible = false;
  aux.visible = false;   // 炎とバリアも一緒に消す
  hud.clear();
  neb.clear();
  neb.scroll(0, 0);
  // 星は消しておく(場面ごとに背景色を変えるので、混ざらないように)
  far.visible = mid.visible = near.visible = false;
  story = build();
  story.start();
  playBGM(bgm, true, true);
}

/** @param {function} [onDone] 見終わったあとに呼ぶもの(既定はタイトルへ戻る) */
/**
 * エンディングでこの子が出たときの、コンソールへのひとこと。
 * **画面には出さない**(遊ぶ人の目に入るのはゲームの絵だけにする)。
 * 1 回の読み込みにつき 1 度だけ
 */
let portraitJokeTold = false;
function tellPortraitJoke() {
  if (portraitJokeTold) return;
  portraitJokeTold = true;
  console.log(
    `%cDrawn in homage to T&E SOFT / STAR ARTHUR LEGEND. (a lie)\n`
    + `%cBehold the craft of Claude the painter, master of the humble shape.`,
    'color:#ffe000;font-weight:bold', 'color:#7ce8ff',
  );
}

function enterEnding(onDone) { enterStory(buildEnding, 'salut', onDone); }

// ちらちらしながら現れる場面の進み具合(0 = 出はじめ)
let storyFade = 0;
const STORY_FADE_LEN = 150;   // 2.5 秒かけて実体になる

// エンディングの絵には 2 つの仕掛けをかける。
//   ・中間色 … 1 ライン おきのディザで塗ってある(絵のほうに焼き込み済み)。
//   ・走査線 … 位相 1 で固定。1 ライン おきに行が消える。
//   ・中間色 … 消えずに残った行の色を 1 コマごとに入れ替える(1:1)。
//     同じ行が 2 色を行き来するので、目のなかで混ざって中間色になる。
//   ・走査線(インターレース)はいまは外してある。中間色はディザの
//     入れ替えだけで出す。戻すときは neb.scanline に 0 を入れる。
function updateStory() {
  if (mmsxx.input.wasPressed('Escape')) {
    story.stop();
    finishStory();
    return;
  }
  // 終わったフレームは何もしない。ここで走査線を掛け直してしまうと、
  // finishStory() が戻した設定を上書きして、タイトルの背景まで
  // 1 ライン おきに間引かれたままになる
  if (story.update()) return;
  // 暗転が明けるまでは描き足さない。ここで描くと、絵だけ先に出て
  // スプライト(裂け目の光や目)が 12 フレームおくれて出てしまう
  if (story.entering) return;
  const scene = story.scenes[story.index];
  const duo = scene && scene.duo;
  // ちらちらしながら現れる場面。
  // 出はじめは 4 コマに 1 回だけ見せ、だんだん出る回数を増やして
  // 最後はちらつきなしになる(実体が定まっていく見せ方)
  if (scene && scene.fadeIn) {
    storyFade++;
    // 出はじめまでの間。ここでは絵も光もまだ出さない(真っ黒のまま待つ)
    const delay = scene.fadeDelay || 0;
    if (storyFade <= delay) {
      neb.visible = false;
      if (storySprites && storySprites.glow) storySprites.glow.visible = false;
      return;
    }
    const t = Math.min(1, (storyFade - delay) / STORY_FADE_LEN);
    // 最後まで 1:1 のちらつきを残す(実体にならず、あやしく光りつづける)
    const period = t > 0.5 ? 2 : t > 0.25 ? 3 : 4;
    const on = period === 1 || (mmsxx.frame % period) === 0;
    neb.visible = on;
    for (const sp of [storySprites && storySprites.glow]) {
      if (sp) { sp.visible = true; sp.blink = period; }
    }
  } else {
    storyFade = 0;
    neb.visible = true;
  }
  // 残った行の色を 1 コマごとに入れ替える(1:1)。走査線で片方の行は
  // 消えているので、見えている行だけが 2 色を行き来して中間色になる
  if (duo) {
    // 4 コマのパラパラアニメが指定されていれば、出はじめからの時間でコマを選ぶ
    let img = duo.image;
    if (scene.growFrames) {
      const n = scene.growFrames.length;
      const i = Math.min(n - 1, Math.floor(storyFade / (STORY_FADE_LEN / n)));
      img = scene.growFrames[i];
    }
    neb.draw(duo.x, duo.y, img, true, { colorMap: duo.maps[mmsxx.frame & 1] });
  }
  // 走査線は位相 1 のまま動かさない
  // (見せ方は上の fadeIn / それ以外で決めてある)
  neb.scanline = 1;
}

// パイロットの絵は 224x192。画面いっぱいに出す(横だけ中央に寄せる)
const PILOT_X = (SCREEN_W - 224) >> 1;

// ---- スタッフロール ----
// 並んでいる「名前」は、そのまま裏技コードのヒントになっている。
// 名前のうしろの改行マークは「RETURN で確定」のヒント
const RET = String.fromCharCode(0x1c);
const STAFF_LINES = [
  'STAR FABLE STAFF',
  '',
  'DIRECTOR',
  'HARAYOKI',
  '',
  'PROGRAM',
  'FABLE5 / OPUS5',
  '',
  'DESIGN',
  'OPUS5',
  '',
  'MUSIC',
  // 打ち込みの曲と効果音、mp3 の曲で作り手が違うので分けて書く。
  // **行は 1 行ずつ真ん中に置かれる**ので、名前の頭をそろえるには
  // 2 行の長さも同じにする(短いほうは後ろを空白で埋める)
  'MML BGM/SE  OPUS5    ',
  'MP3 BGM     SUNO v5.5',
  '',
  'DEBUG STAFF',
  'AHO' + RET,
  'BAKA' + RET,
  '',
  // 行の長さをそろえて、# の位置が縦にそろうようにする
  '#1 MOMOKO' + RET,
  '#2 CHIE' + RET + '  ',
  '#3 AKEMI' + RET + ' ',
  '#4 SYUKO' + RET + ' ',
  '#5 CHIAKI' + RET,
  '',
  '#1 NORIKO' + RET,
  '#2 SATOE' + RET + ' ',
  '#3 YASUKO' + RET,
  '#4 KINUYO' + RET,
  '#5 HISAE' + RET + ' ',
  '',
  'MIYUKI' + RET,
  'YOHKO' + RET,
  '',
  // 画面の色を作った VDP たち。打ち込むと色合いが変わる裏技でもある
  'ART SUPPORT',
  'TMS9918' + RET,
  'V9938' + RET,
  '',
  'SPECIAL THANKS',
  'HYPER' + RET,
  'MEIJIN' + RET,
  String.fromCharCode(0x18, 0x18, 0x19, 0x19, 0x1a, 0x1b, 0x1a, 0x1b) + 'BA',
  '',
  '',
  'ABOUT MMS/XX ENGINE',
  '',
  'A MACHINE THAT NEVER EXISTED.',
  'MOCK MACHINE SYSTEM, MODEL XX.',
  '',
  'TMS9918 AND AY-3-8910,',
  'GROWN THE WRONG WAY.',
  '',
  'STILL SCROLLING IN 8 DOT JUMPS,',
  'BUT IN MANY LAYERS AT ONCE.',
  '',
  'FIFTEEN COLORS ALL ITS OWN,',
  'AND SPRITES OF ONE COLOR EACH.',
  '',
  'SQUARE, SINE, TRIANGLE WAVES,',
  'WAVETABLES AND 2-OP FM.',
  'IT EVEN SPEAKS.',
  '',
  'BUILT WITH HELP FROM CLAUDE AI.',
  '',
  'CODE, PIXEL ART, BGM AND SE',
  'ARE ALL MADE BY THE AI.',
  'THE HUMAN ONLY DIRECTS.',
  '',
  'BGM IS WRITTEN AS MML BY OPUS',
  'AND CONVERTED TO WAVEFORMS.',
  'SOME MP3 TRACKS ARE BY SUNO.',
  '',
  'STAR FABLE IS ITS SAMPLE GAME',
  'PACKED WITH HOMAGES TO',
  'THE SHOOTERS WE GREW UP WITH',
  '',
  'A SECOND ONE IS ON THE WAY',
  'SEE YOU AGAIN!',
  '',
  '',
  'THANK YOU FOR PLAYING!',
];
// 役職の見出し(色を変えて出す)。
// **いちばん上の大見出しだけ赤**にして、役職の見出し(黄)と分ける
const STAFF_HEADINGS = new Map([
  ['STAR FABLE STAFF', 8],          // いちばん上の大見出しは赤
  ['THANK YOU FOR PLAYING!', 7],    // 締めの一言は水色
  ...['DIRECTOR', 'PROGRAM', 'DESIGN', 'MUSIC', 'DEBUG STAFF',
    'ART SUPPORT', 'SPECIAL THANKS', 'ABOUT MMS/XX ENGINE'].map((k) => [k, true]),
]);
// 流すところはエンジンの任意部品 StaffRoll にまかせる(docs/UTIL.md 参照)
let staffRoll = null;

function enterStaffRoll() {
  if (currentBGM === 'elise') { mmsxx.audio.stopBGM(); currentBGM = null; }
  state = 'staff';
  setPaused(false);
  clearEntities();
  for (const sp of helpIconSprites()) sp.visible = false;
  player.visible = false;
  aux.visible = false;   // 炎とバリアも一緒に消す
  hud.clear();
  // 星空はそのまま流しつつ、うしろに星座を 4 つ置いてゆっくり流す。
  // スプライトは使わず、レイヤーへ直接描く(文字より奥に出したいので)
  neb.clear();
  neb.scroll(0, 0);
  // 裏画面は 1024 ドットぶんある。縦に散らして置き、端で回り込ませる
  for (const [img, x, y] of STAFF_STARS) neb.draw(x, y, img);
  staffRoll = new StaffRoll(mmsxx, {
    layer: 4,                  // HUD レイヤーに流す
    lines: STAFF_LINES,
    headings: STAFF_HEADINGS,
    onEnd: () => enterTitle(),
  });
  staffRoll.start();
  staffFading = false;
  playBGM('staff', true);
}

// 背景の星座。大きさも図柄もばらばらの 4 つを、縦に散らして置く。
// 裏画面(1024 ドット)を少しずつスクロールさせて、ゆっくり流していく
// 置く y は、始めたときの表示範囲(0〜191)より下に取ってある。
// レイヤーを上へたどる向きにスクロールさせるので、裏画面の下端(1024 の近く)から
// 順に画面の上へ入ってくる = どれも「画面の外から流れてくる」ことになる
// 置く y は、始めたときの表示範囲(0〜191)より下、かつ裏画面の下端(1024)を
// はみ出さない場所に取ってある。はみ出すと回り込んで上端に出てしまい、
// 始めた瞬間から画面に写ってしまう。
// レイヤーを上へたどる向きにスクロールさせるので、下端に近いものから順に
// 画面の上へ入ってくる = どれも「画面の外から流れてくる」ことになる
// 出てくる順は「とり -> くじら -> ふね -> りゅう」。
// 小さいものから見せて、いちばん大きいりゅうを最後に持ってくる。
// 横位置もそろえない
const STAFF_STARS = [
  [BG_SYMBOLS.birdStar, 88, 900],     // 900 + 122 = 1022
  [BG_SYMBOLS.whaleStar, 30, 692],    // 692 + 136 = 828
  [BG_SYMBOLS.shipStar, 110, 468],    // 468 + 104 = 572
  [BG_SYMBOLS.dragonStar, 34, 220],   // 220 + 156 = 376
];
// 文字と同じ向き(下から上へ)にゆっくり流して、奥にあるように見せる
const STAFF_STAR_SPEED = -0.18;

// スタッフロールの終わりぎわ。曲をフェードアウトさせる長さ(4 秒)
const STAFF_FADE = 240;
let staffFading = false;

function updateStaffRoll() {
  neb.scrollBy(0, STAFF_STAR_SPEED);
  // 残りが 4 秒を切ったら、曲を少しずつ小さくしていく。
  // (最後の 1 行が消えるのと、音が消えるのをそろえる)
  const left = staffRoll.remaining;
  if (!staffFading && left <= STAFF_FADE) {
    staffFading = true;
    mmsxx.audio.fadeOutBGM(STAFF_FADE / 60);
    currentBGM = null;
  }
  staffRoll.update();
}

// ---- サウンドテスト ----
// 曲(ループするもの)は BGM 側、短いジングルは SE 側の先頭にまとめる
// 未使用曲や場面ごとの曲もここから聴ける。
// **没にした曲(botsu1)はここに並べない**。データは残してあるので、
// この行に足せばまた聴ける
const SOUND_BGM = ['main', 'power', 'boss', 'lastboss', 'moai', 'todo', 'gameover',
  'elise', 'fate', 'salut', 'beat', 'finalbattle', 'staff'];
// ジングルは BGM として登録されているので、鳴らし方が SE と違う。欄も分ける
// start1〜4 は開始ジングルの差し替え候補(鳴らして選ぶためだけに並べてある)
const SOUND_JINGLE = ['start', 'start1', 'start2', 'start3', 'start4',
  'unused1', 'fanfare', 'bonus'];
const SOUND_SE = ['shutter', 'autofire', 'heal', 'scold',
  'shot', 'boom', 'hit', 'item', 'clink', 'thud', 'ricochet', 'eyeAppear',
  'laser', 'charging', 'rifttear', 'bigboom', 'bossboom', 'powerdown', 'appear', 'warning',
  'dragonRoar', 'count3', 'count2', 'count1',
  'weak', 'armor', 'guardhit', 'piyo'];
// しゃべるもの(TALK)。SE とは鳴らし方が違うので分けておく
const SOUND_TALK = ['kozorite', 'kingLaugh', 'kiaiA', 'kiaiB', 'kiaiC'];
// 音色テスト。**1 つの音色だけ**で同じ小曲を鳴らして聞き比べる。
// 曲はエンジン側(demotunes.js)にある。音色が増えれば、この欄も自然に増える。
// 打楽器の音色(fmDrum...)だけは、ドレミではなくリズムの曲になる
const SOUND_TONE = mmsxx.audio.waveNames;
for (const w of SOUND_TONE) mmsxx.audio.defineBGM('tone_' + w, demoFor(w));
// **打楽器を全部使った曲**。音色そのものではないので、欄のいちばん下へ足す。
// 1 つずつ聞いたあとに、組にするとどう鳴るかを聞くためのもの
const DRUM_KIT = 'drumKit';
mmsxx.audio.defineBGM('tone_' + DRUM_KIT, drumKitDemo());
const SOUND_TONE_LIST = [...SOUND_TONE, DRUM_KIT];
// 音色を次々に替えてドレミを鳴らす曲。聞き比べは TONE 欄でやるので、
// こちらはコンソールから鳴らしたいとき用に置いておくだけ
mmsxx.audio.defineBGM('scale', scaleDemo(SOUND_TONE));
// 左が BGM、右が SE。左右キーで列を移り、上下で曲を選ぶ
// BGM 側の一覧はいちばん上に [ALL](全曲再生)と [STOP](止める)を足して見せる。
// 止めるのは**専用のキーではなく一覧の項目**にしてある(選んで押す道に揃える)
const SOUND_BGM_LIST = ['- ALL -', '- STOP -', ...SOUND_BGM];
const soundList = (col) => (col === 0 ? SOUND_BGM_LIST : SOUND_SE);

// 列の並べ方・選択・キーの受け付けはエンジンの任意部品 SoundTest にまかせる。
// 全曲再生の進行と、ジングルのあとの復帰だけゲーム側に残す(docs/UTIL.md)
let soundPage = null;

function enterSoundTest() {
  if (currentBGM === 'elise') { mmsxx.audio.stopBGM(); currentBGM = null; }
  state = 'sound';
  setPaused(false);
  clearEntities();
  player.visible = false;
  aux.visible = false;   // 炎とバリアも一緒に消す
  for (const sp of helpIconSprites()) sp.visible = false;
  mmsxx.audio.stopBGM();
  currentBGM = null;
  neb.clear();          // 背景の大きな絵は消して読みやすくする
  soundAll = -1;
  soundAllFollow = false;
  soundBack = null;
  soundPage = new SoundTest(mmsxx, {
    layer: 4,
    columns: [
      {
        title: 'BGM', items: SOUND_BGM_LIST,
        play: (name, i) => {
          if (i === 0) {
            // いちばん上の - ALL - は全曲続けて再生する
            if (soundAll >= 0) stopSoundAll(); else startSoundAll();
            return;
          }
          // - STOP - は鳴っているものを全部止める
          if (i === 1) { stopSoundTest(); return; }
          if (soundAll >= 0) stopSoundAll();
          soundBack = SOUND_BGM[i - 2];
          mmsxx.audio.playBGM(soundBack, true, true);
        },
      },
      {
        title: 'SE', items: SOUND_SE,
        // **前の音を止めてから鳴らす**。長い音(レーザーなど)が残っていると、
        // 場所が空かずに次の音が捨てられて「だんだん鳴らなくなる」ため
        play: (name) => { mmsxx.audio.stopSE(); mmsxx.audio.playSE(name, SE_JINGLE); },
      },
      {
        // ジングルは **BGM を止めずに黙らせて**重ねる。
        // 鳴り終われば曲の続きが聞こえてくるので、戻す仕掛けは要らない
        title: 'JINGLE', items: SOUND_JINGLE,
        play: (name) => mmsxx.audio.playJingle(name),
      },
      // しゃべるもの(TALK)。録音ではなく、鳴らすときに合成している。
      // **ラスボスを倒すまで列ごと出さない**(先にセリフを聞かせないため)。
      // 会っただけでは開かない。手元の開発中だけはいつも出す
      {
        // 音色テスト。波形メモリ(wt〜)もここに並ぶ
        title: 'TONE', items: SOUND_TONE_LIST,
        play: (name) => { soundBack = 'tone_' + name; mmsxx.audio.playBGM(soundBack, false, true); },
      },
      ...((DEV || met('kingDown')) ? [{
        title: 'VOICE', items: SOUND_TALK,
        // 次のセリフを鳴らすと前のセリフは止まる(エンジン側でそうしてある)
        play: (name) => mmsxx.audio.playTalk(name, 6),
      }] : []),
    ],
    // 全曲再生のあいだは、いま鳴っている曲名を出す
    note: () => (soundAll >= 0 ? 'ALL: ' + SOUND_BGM[soundAll].toUpperCase() : ''),
    stop: stopSoundTest,
    onExit: () => enterTitle(),
  });
  soundPage.open();
}

/** サウンドテストで鳴っているものを全部止める(一覧の - STOP - と、閉じるとき) */
function stopSoundTest() {
  soundBack = null;
  if (soundAll >= 0) stopSoundAll();
  mmsxx.audio.stopBGM();
  mmsxx.audio.stopSE();
}

// 全曲再生。1 曲ずつ最低 30 秒ぶん鳴らしてからフェードアウトして次へ進む
const SOUND_ALL_LEN = 1800;   // 1 曲あたりの長さ(30 秒)
const SOUND_ALL_FADE = 120;   // 消えていく時間(2 秒)
let soundAll = -1;            // -1 = 全曲再生していない
let soundAllTimer = 0;
// **カーソルを鳴っている曲へ連れていくか**。
// 全曲再生を始めた直後だけ true で、遊ぶ人が何か触ったところで落とす
// (自分で選んでいる最中にカーソルが動くと、選びなおしになってしまう)
let soundAllFollow = false;
/** 鳴っている曲へカーソルを移す(BGM の列は ALL と STOP のぶん 2 つずれる) */
function followSoundAll() {
  if (!soundAllFollow || !soundPage || soundAll < 0) return;
  soundPage.col = 0;
  soundPage.sel[0] = soundAll + 2;
  soundPage.draw();
}
// 直前に鳴らしていた BGM(ジングルは BGM を黙らせて重ねるので、戻す仕掛けは要らない)
let soundBack = null;

function startSoundAll() {
  soundAll = 0;
  soundAllTimer = SOUND_ALL_LEN;
  soundAllFollow = true;   // 触られるまではカーソルも付いていく
  mmsxx.audio.playBGM(SOUND_BGM[0], true, true);
  followSoundAll();
}
function stopSoundAll() {
  soundAll = -1;
  soundAllFollow = false;
  mmsxx.audio.stopBGM();
}

function updateSoundAll() {
  if (soundAll < 0) return;
  soundAllTimer--;
  if (soundAllTimer === SOUND_ALL_FADE) mmsxx.audio.fadeOutBGM(SOUND_ALL_FADE / 60);
  if (soundAllTimer > 0) return;
  soundAll++;
  // 最後まで行ったら頭に戻る(全体でループ)
  if (soundAll >= SOUND_BGM.length) soundAll = 0;
  soundAllTimer = SOUND_ALL_LEN;
  mmsxx.audio.playBGM(SOUND_BGM[soundAll], true, true);
  followSoundAll();
}

function updateSoundTest() {
  // **何か触ったら、カーソルは付いていくのをやめる**。
  // 見るのは一覧を動かすキーだけ(SPACE は下の update が受け取ってから決まる)
  const key = mmsxx.input;
  if (soundAllFollow && (key.wasPressed('ArrowUp') || key.wasPressed('ArrowDown')
      || key.wasPressed('ArrowLeft') || key.wasPressed('ArrowRight')
      || key.wasPressed('Space'))) {
    soundAllFollow = false;
  }
  updateSoundAll();
  soundPage.update();
}

// ---- キャラクター一覧 ----
// 出てくる敵やボスを並べて見せる。上下キーでページを送る。
// 大きい絵(ボス)は BG レイヤーに、小さい絵はスプライトで出す。
// 背景の賑やかしのページは、絵の大きさが小さい順に並べて自動で組む。
// 小さいものは 2 つ並べ、大きいものは 1 ページ使う。
const BG_PART_LIST = [
  ['station', 'STATION'], ['moon', 'MOON'], ['colony', 'COLONY'], ['moai', 'MOAI'],
  ['saturn', 'SATURN'], ['debris', 'DEBRIS'], ['blackhole', 'BLACK HOLE'],
  ['earth', 'EARTH'], ['nebula', 'NEBULA'], ['nebulaRed', 'NEBULA RED'], ['milkyway', 'MILKY WAY'],
  ['jupiter', 'JUPITER'],
];

function buildBgPartPages() {
  const items = BG_PART_LIST
    .map(([name, label]) => ({ name, label, w: BG_SYMBOLS[name].width, h: BG_SYMBOLS[name].height }))
    .sort((a, b) => (a.w * a.h) - (b.w * b.h));
  const pages = [];
  for (let i = 0; i < items.length;) {
    const a = items[i], b = items[i + 1];
    // 横に 2 つ収まって、名前を出す高さも残るなら 2 つ並べる
    const two = b && (a.w + b.w + 32 <= 240) && Math.max(a.h, b.h) <= 96;
    const list = two ? [a, b] : [a];
    // 2 つ並べるときは左右の端に振り分けず、16 ドット空けて真ん中にまとめる
    // (小さい絵どうしだと、端に置くと離れすぎて 1 組に見えない)
    const GAP = 16;
    const left = two ? Math.round((SCREEN_W - (a.w + GAP + b.w)) / 2) : 0;
    const big = list.map((it, k) => {
      const x = two ? (k === 0 ? left : left + a.w + GAP)
        : Math.round((SCREEN_W - it.w) / 2);
      const y = Math.max(24, Math.min(150 - it.h, 96 - (it.h >> 1)));
      return [it.name, it.label, x, y];
    });
    pages.push({ title: 'BG PARTS ' + (pages.length + 1), big });
    i += list.length;
  }
  return pages;
}

const CHAR_PAGES = [
  {
    title: 'ENEMIES',
    items: [
      ['enemyA', 'SCOUT'],
      ['enemyB', 'UFO'],
      ['enemyC', 'UFO S'],
      ['enemyF', 'RISER'],
      ['enemyG', 'CHASER'],
    ],
  },
  {
    // 1 ページに 6 体まで入るので、2 と 3 はまとめて 1 ページにする
    title: 'ENEMIES 2',
    items: [
      ['bouncer', 'BOUNCER'],
      ['rammer', 'RAMMER'],
      ['warper', 'WARPER'],
      ['enemyH', 'WALLER'],
      ['enemyI', 'SPREADER'],
      ['enemyJ', 'DIVER'],
    ],
  },
  // 光る敵(宝箱)は没にしたので、図鑑にも出さない
  {
    // キューブは小さい敵のあとに置く(隊列で来る別枠の相手なので)
    title: 'CUBES',
    items: [
      ['cube', 'CUBE'],
      ['cubeItem', 'CUBE GREEN'],
      ['cubeStar', 'CUBE PURPLE'],
      ['cubeAuto', 'CUBE YELLOW'],
    ],
  },
  {
    // 壊せない。当たると一撃なので、姿を覚えてもらう
    title: 'HAZARD',
    // 48x32 に描き直したので、中央に来るよう置き直す
    big: [['weight16tBG', 'MONTY', 104, 88]],
  },
  {
    // ボスはゲーム中と同じように、パーツを組み合わせて見せる
    title: 'BOSS 1',
    name: 'KING OCTOPOT',
    secret: 'boss1Met',   // 出会うまでは姿を伏せる(名前は先に出す)
    parts: [
      // 頭を先に描いて、あとから壺をかぶせる = 顔が壺にめり込んで見える
      ['bossHead', 104, 64],
      ['bossShip', 96, 88],
      { img: 'octoCrown', x: 126, y: 54, sprite: true },
      { img: 'bossEye2', x: 112, y: 73, sprite: true },
      { img: 'bossEye2', x: 128, y: 73, sprite: true },
      // 手のひらはゲーム中と同じ 8 つ。楕円の軌道に並べる
      { img: 'ufoGuard', x: 116, y: 40, sprite: true },
      { img: 'ufoGuard', x: 156, y: 52, sprite: true },
      { img: 'ufoGuard', x: 176, y: 84, sprite: true },
      { img: 'ufoGuard', x: 156, y: 116, sprite: true },
      { img: 'ufoGuard', x: 116, y: 128, sprite: true },
      { img: 'ufoGuard', x: 76, y: 116, sprite: true, flipX: true },
      { img: 'ufoGuard', x: 56, y: 84, sprite: true, flipX: true },
      { img: 'ufoGuard', x: 76, y: 52, sprite: true, flipX: true },
    ],
  },
  {
    title: 'BOSS 2',
    name: 'KING FOSSIL',
    secret: 'boss2Met',
    parts: [
      // 図鑑では、ジャンプ中の伸ばした脚(細いほう)を見せる。
      // **甲羅より先に描く**(あとから描くと、甲羅にめり込んだ付け根まで見えてしまう)。
      // 踏ん張ったときと同じく、甲羅の左ふちから 14 ドット出す。
      // 脚は 4 本(CRAB_LEG_Y と同じ間隔で、甲羅の上端から 16/34/52/70)
      ['crabLegExt', 42, 56],
      ['crabLegExt', 42, 72],
      ['crabLegExt', 42, 88],
      ['crabLegExt', 42, 104],
      ['crabR', 56, 40],
      ['crabClawBig', 96, 40],
      ['crabClawBig', 96, 88],
      { img: 'octoCrown', x: 76, y: 34, sprite: true },
      { img: 'bossEye2', x: 86, y: 74, sprite: true },
      { img: 'bossEye2', x: 86, y: 90, sprite: true },
      { img: 'crabPod', x: 69, y: 50, sprite: true },
      { img: 'crabPod', x: 69, y: 84, sprite: true, flipX: true },
      { img: 'crabPod', x: 69, y: 116, sprite: true },
    ],
  },
  {
    title: 'BOSS 3',
    name: 'KING OARFISH',
    secret: 'boss3Met',
    parts: [
      ['dragonBody', 148, 122],
      ['dragonBody', 134, 108],
      ['dragonBody', 120, 94],
      ['dragonTail', 162, 136],
      ['dragonHead', 88, 48],
      { img: 'octoCrown', x: 92, y: 38, sprite: true, flipX: true },
      { img: 'bossEye2', x: 96, y: 61, sprite: true },
      { img: 'bossEye2', x: 112, y: 61, sprite: true },
    ],
  },
  {
    title: 'BOSS 4',
    name: 'KING NAUTILUS',
    secret: 'boss4Met',
    parts: [
      ['nautilus', 104, 64],
      { img: 'octoCrown', x: 118, y: 54, sprite: true },
      { img: 'bossEye2', x: 114, y: 85, sprite: true },
      ['gearBlock', 120, 16], ['gearBlock', 168, 32], ['gearBlock', 192, 80],
      ['gearBlock', 168, 128], ['gearBlock', 120, 144], ['gearBlock', 72, 128],
      ['gearBlock', 48, 80], ['gearWeak1', 72, 32],
    ],
  },
  {
    // ラスボスは出会うまで ? のまま(誰と戦うのか先に見せない)
    title: 'LAST BOSS',
    // 名乗りの名前(コゾリテ)をかっこ書きで添える。
    // 出会うまでは「THE KING」だけ(名乗りを聞く前に名前が割れないように)
    name: 'THE KING (KOZORITE)',
    secretName: 'THE KING',
    secret: 'kingMet',
    // 倒すまでは「?」ではなく**裂け目**を出す。
    // 最初に出会うのはこの姿なので、これだけでも十分に思わせぶりになる
    secretArt: ['kingRift1', 112, 64],
    parts: [
      // 中身は、出てくるときの**つま先立ちの構え**を青 1 色で。
      // キックの姿は形が分かりにくかったので、こちらにした。
      // (黒 1 色のままだと宇宙の黒に沈むので青へ置き換える)
      { img: 'kingMan01', x: 104, y: 64, sprite: true, color: 4 },
    ],
  },
  {
    title: 'SECRET BOSS',   // 本編には出てこない仮ボス
    name: 'Mr. MIJISSOU',
    // 出会うまでは**ページごと出さない**(? のページも見せない)。
    // いること自体が秘密なので、伏せた姿を並べると居ることが分かってしまう
    hideUntil: 'todoMet',
    // ゲーム中と同じ部品でそろえる。
    // 王冠は octoCrown ではなく水色の crownCyan(顔と色がかぶるため)、
    // ほおの赤みと目の中の反射も、本編と同じ位置に置く
    parts: [
      ['todoFace', 104, 56],
      { img: 'crownCyan', x: 104 + 48 - 28, y: 56 - 4, sprite: true },
      { img: 'todoBlush', x: 104 + 2, y: 56 + 26, sprite: true },
      { img: 'todoBlush', x: 104 + 34, y: 56 + 26, sprite: true },
      { img: 'todoGlint', x: 104 + 15, y: 56 + 20, sprite: true },
    ],
  },
  {
    // 目玉は 2 体そろって出る相手なので、単独のページにする
    title: 'TWIN EYES',
    name: 'TWIN EYES',
    big: [
      ['eyeball', '', 72, 64],
      ['eyeball', '', 136, 64],
    ],
    overlay: [['eyeIris0', 80, 72], ['eyeVein', 72, 64],
              ['eyeIris0', 144, 72], ['eyeVein', 136, 64]],
  },
  {
    title: 'BIG ENEMIES',
    big: [
      ['asteroid', 'ASTEROID', 40, 56],
      ['rocket', 'ROCKET', 160, 40],
    ],
    overlay: [['asteroidHi', 40, 56]],
  },
  {
    // モアイはボスではなく、大きい敵のひとつとして並べる
    title: 'BIG ENEMIES 2',
    name: 'BIG MOAI',
    // ゲーム中と同じく 4 分割(すき間 8 ドット)。色変わりと明滅もそのまま見せる
    moai: true,
    parts: [
      ['moaiTL', 92, 44], ['moaiTR', 132, 44],
      ['moaiBL', 92, 92], ['moaiBR', 132, 92],
    ],
  },
  ...buildBgPartPages(),
  // ---- 壁紙のページ(いったん止めてある) ----
  // 目の位置が絵の側の基準と合わないので、直すまで出さない。
  // 戻すときは、この下の「//」を外すだけでよい
  // {
  // // いちばん最後は、4 体のボスが一堂に会した絵。
  // // 置き場所は BOSS 1〜4 のページの並びを、それぞれまるごとずらして作った
  // // (タコ +78/-38、カニ -36/-42、ドラゴン -85/+40、貝 +59/+40)
  // title: 'WALLPAPER #1',
  // // 全画面の絵なので、最初は見出しも案内も出さない(キーを押すと出る)
  // bare: true,
  // credit: 'STAR FABLE  © 2026 HARAYOKI',
  // parts: [
  // // いちばん奥に赤い裂け目(ラスボスの空間)を真ん中へ
  // ['kingRift2', 116, 76],
  // // 4 体とも、それぞれ真ん中へ 8/4 ドット寄せてある
  // // (カニ +8/+4、タコ -8/+4、ドラゴン +8/-4、貝 -8/-4)
  // // 貝(いちばん大きいので奥)
  // ['nautilus', 155, 100],
  // ['gearBlock', 171, 52], ['gearBlock', 219, 68], ['gearBlock', 232, 116],
  // ['gearBlock', 219, 164], ['gearBlock', 171, 180], ['gearBlock', 123, 164],
  // ['gearBlock', 99, 116], ['gearWeak1', 123, 68],
  // // カニ(左上)
  // ['crabLegExt', 14, 18], ['crabLegExt', 14, 34],
  // ['crabLegExt', 14, 50], ['crabLegExt', 14, 66],
  // ['crabR', 28, 2],
  // ['crabClawBig', 68, 2], ['crabClawBig', 68, 50],
  // // タコ(右上)
  // ['bossHead', 174, 30],
  // ['bossShip', 166, 54],
  // // ドラゴン(左下・手前)
  // ['dragonBody', 71, 158], ['dragonBody', 57, 144], ['dragonBody', 43, 130],
  // ['dragonTail', 85, 172],
  // ['dragonHead', 11, 84],
  // // ここから先はスプライト(王冠・目・手のひら・装置)。
  // // **目は BOSS 1〜4 のページと同じ「体の絵からの差」で置く**。
  // // 勝手に足し引きすると、直したはずのずれがまた出る
  // { img: 'octoCrown', x: 169, y: 90, sprite: true },
  // { img: 'bossEye2', x: 165, y: 121, sprite: true },
  // { img: 'octoCrown', x: 48, y: -4, sprite: true },
  // { img: 'bossEye2', x: 58, y: 36, sprite: true },
  // { img: 'bossEye2', x: 58, y: 52, sprite: true },
  // { img: 'crabPod', x: 41, y: 12, sprite: true },
  // { img: 'crabPod', x: 41, y: 46, sprite: true, flipX: true },
  // { img: 'crabPod', x: 41, y: 78, sprite: true },
  // { img: 'octoCrown', x: 196, y: 20, sprite: true },
  // // タコの目は、頭の絵に開いた**眼窩の穴の中心**から決めてある
  // // (穴の中心 17/32, 15.5 - レンズの中心 7.5)
  // { img: 'bossEye2', x: 183, y: 38, sprite: true },
  // { img: 'bossEye2', x: 198, y: 38, sprite: true },
  // { img: 'ufoGuard', x: 186, y: 6, sprite: true },
  // { img: 'ufoGuard', x: 226, y: 18, sprite: true },
  // { img: 'ufoGuard', x: 246, y: 50, sprite: true },
  // { img: 'ufoGuard', x: 226, y: 82, sprite: true },
  // { img: 'ufoGuard', x: 186, y: 94, sprite: true },
  // { img: 'ufoGuard', x: 146, y: 82, sprite: true, flipX: true },
  // { img: 'ufoGuard', x: 126, y: 50, sprite: true, flipX: true },
  // { img: 'ufoGuard', x: 146, y: 18, sprite: true, flipX: true },
  // { img: 'octoCrown', x: 15, y: 74, sprite: true, flipX: true },
  // { img: 'bossEye2', x: 19, y: 97, sprite: true },
  // { img: 'bossEye2', x: 35, y: 97, sprite: true },
  // // 自機は真ん中の下。4 体に立ち向かう絵にする
  // { img: 'player', x: 124, y: 144, sprite: true },
  // ],
  // },
  {
    // **ちらつき見物のページ。** 敵も自機も弾も、ゲーム中と同じ姿で
    // いっぺんに出す。1 行に出せる数の制限や処理落ちを、目で確かめるためのもの。
    // 出す顔ぶれは前のページから拾うので、敵が増えれば勝手に増える
    title: 'ALL STAR',
    crowd: true,
  },
];
let charPage = 0;
let charSprites = [];
let charFlash = [];        // 点滅させる BG(小惑星)
let charMoai = null;       // モアイのページ(色変わりと明滅を動かす)
let charMoaiShown = true, charMoaiBlue = false;
let charRocket = [];       // ちらつかせるロケット
let charRocketAlt = false;
let charCrowd = null;      // ちらつき見物のページ(動かすものを覚えておく)
let charFlashPhase = -1;

function clearCharSprites() {
  for (const sp of charSprites) mmsxx.removeSprite(sp);
  charSprites = [];
}

// ページ送り・見出し・ページ番号はエンジンの任意部品 Gallery にまかせる。
// ここでは「1 ページに何を描くか」と「毎フレームの動き」だけを書く(docs/UTIL.md)
let charBook = null;

function enterCharList() {
  if (currentBGM === 'elise') { mmsxx.audio.stopBGM(); currentBGM = null; }
  state = 'chars';
  setPaused(false);
  clearEntities();
  player.visible = false;
  aux.visible = false;   // 炎とバリアも一緒に消す
  for (const sp of helpIconSprites()) sp.visible = false;
  mmsxx.audio.stopBGM();
  currentBGM = null;
  charBook = new Gallery(mmsxx, {
    hudLayer: 4, artLayer: 3,
    // hideUntil の付いたページは、印が立つまで一覧に入れない。
    // 番号(charPage)はもとの並びのままにしておく(絵を描く側がそれで引くため)
    pages: CHAR_PAGES
      .map((page, i) => ({ page, i }))
      .filter(({ page }) => !page.hideUntil || met(page.hideUntil))
      .map(({ page, i }) => ({
        title: page.title,
        bare: page.bare,
        draw: () => { charPage = i; charCrowd = null; drawCharList(); },
        update: () => updateCharAnim(),
        leave: () => { clearCharSprites(); neb.clear(); },
      })),
    help: String.fromCharCode(0x1a, 0x1b) + ':PAGE  SP:NEXT  ESC:EXIT',
    onExit: () => { clearCharSprites(); neb.clear(); enterTitle(); },
  });
  charBook.open(0);
}

// 図鑑の「まだ出会っていない」ページに出す大きな ?(8 ドットのブロックで組む)
const BIG_Q = [
  '.####.',
  '##..##',
  '....##',
  '...##.',
  '..##..',
  '..##..',
  '......',
  '..##..',
];
function drawBigQuestion(cx, cy, color = 14) {
  const w = BIG_Q[0].length, h = BIG_Q.length;
  const x0 = cx - (w * 8) / 2, y0 = cy - (h * 8) / 2;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (BIG_Q[r][c] === '#') hud.fill(color, x0 + c * 8, y0 + r * 8, 8, 8);
    }
  }
}

function drawCharList() {
  clearCharSprites();
  neb.scroll(0, 0);
  const page = CHAR_PAGES[charPage];
  // まだ出会っていない相手は、名前も姿も見せずに ? だけを出す
  // 名前は先に出してよい。隠すのは姿だけ
  const hidden = page.secret && !met(page.secret);
  if (hidden) {
    // 姿の代わりに出すものが決めてあれば、? ではなくそれを出す
    if (page.secretArt) {
      const [name, bx, by] = page.secretArt;
      neb.draw(bx, by, BG_SYMBOLS[name], true);
    } else drawBigQuestion(SCREEN_W / 2, 92);
    // 名前も伏せたいページは、伏せたときの表記に差し替える。
    // true なら ???、文字列ならそれを出す(「THE KING」だけ見せる、など)
    const nm = page.secretName === true ? '???'
      : (page.secretName || page.name);
    if (nm) hud.print(centerX(nm), 160, nm, 11);
    charMoai = null; charFlash = []; charRocket = [];
    return;
  }
  // 赤い空間など、下地を敷きたいページ(黒地だと絵が読めない相手のため)
  if (page.panel) {
    const p = page.panel;
    neb.fill(p.color, p.x, p.y, p.w, p.h);
  }
  // ボスはパーツを組み合わせて、ゲーム中と同じ姿を作る
  for (const part of (page.parts || [])) {
    if (Array.isArray(part)) {
      const [name, bx, by] = part;
      neb.draw(bx, by, BG_SYMBOLS[name], true);
      continue;
    }
    const sp = mmsxx.sprite(SPRITE_SYMBOLS[part.img]);
    sp.x = part.x; sp.y = part.y; sp.priority = 20;
    if (part.flipX) sp.flipX = true;
    // 黒 1 色の絵は宇宙の黒に沈むので、色を指定して置き換えられるようにする
    if (part.color) sp.colorMap = { 1: part.color };
    charSprites.push(sp);
  }
  // 壁紙は下に著作権表示を入れる。
  // 絵がそのまま後ろに来ると読めないので、その行だけ黒で埋めてから置く
  if (page.credit) {
    hud.fill(1, 0, 184, SCREEN_W, 16);
    hud.print(centerX(page.credit), 188, page.credit, 14);
  }
  if (page.name) hud.print(centerX(page.name), 160, page.name, 11);
  charMoai = page.moai ? (page.parts || []).filter(p => Array.isArray(p)) : null;
  // 大きい絵は BG に直接置いて、名前をその下に出す
  for (const [name, label, bx, by] of (page.big || [])) {
    const img = BG_SYMBOLS[name];
    neb.draw(bx, by, img);
    // 名前は絵から 8 ドット空ける(くっついて読みにくかった)
    if (label) hud.print(bx, Math.min(160, by + img.height + 12), label, 11);
  }
  // BG の絵に重ねるスプライト(目玉の瞳と血管)。
  // ゲーム中と同じく、瞳と血管は 1 フレームおきの交互表示にする
  for (const [name, ox, oy] of (page.overlay || [])) {
    const sp = mmsxx.sprite(SPRITE_SYMBOLS[name]);
    sp.x = ox; sp.y = oy; sp.priority = 20;
    // ゲーム中と同じちらつき(瞳と血管を交互に、ハイライトは 3 回に 1 回)
    if (name === 'eyeVein') { sp.blink = 2; sp.blinkPhase = 1; }
    else if (name === 'eyeIris0') { sp.blink = 2; sp.blinkPhase = 0; }
    else if (name === 'asteroidHi') sp.blink = 3;
    charSprites.push(sp);
  }
  // 点滅する BG(小惑星)を覚えておいて、あとで描き替える
  charFlash = (page.big || []).filter(b => b[0] === 'asteroid')
    .map(([name, , bx, by]) => ({ name, bx, by }));
  // ロケットはゲーム中と同じく、灰と白を毎コマ入れ替える
  charRocket = (page.big || []).filter(b => b[0] === 'rocket')
    .map(([, , bx, by]) => ({ bx, by }));
  charFlashPhase = -1;
  if (page.crowd) { drawCrowdPage(); return; }
  // 6 つ並ぶページは、最後の行が下のナビに近づくので 8 ドット上から始める
  let y = (page.items || []).length >= 6 ? 32 : 40;
  for (const [name, label] of (page.items || [])) {
    const img = SPRITE_SYMBOLS[name];
    const sp = mmsxx.sprite(img);
    sp.x = 48; sp.y = y - 4; sp.priority = 20;
    charSprites.push(sp);
    hud.print(80, y, label, 11);
    y += Math.max(24, img.height + 8);
  }
}

/**
 * **ちらつき見物のページ**を組み立てる。
 *
 * 敵は図鑑のほかのページから拾うので、**顔ぶれは勝手に増える**。
 * 弾は多めに出す。1 行に出せる数の制限が効くと、
 * 横に並んだところから順に消えるのが見える。
 *
 * 席の強さもゲーム中と同じにしてある(自機は消えない、弾はまっさきに譲る)ので、
 * ここで見た目を決めれば、そのまま遊びに持っていける
 */
function drawCrowdPage() {
  charCrowd = true;
  const put = (img, x, y, priority, rank) => {
    const sp = mmsxx.sprite(img);
    sp.x = x; sp.y = y; sp.priority = priority;
    if (rank) sp.rank = rank;
    charSprites.push(sp);
    return sp;
  };
  // 図鑑のほかのページに載っている敵を全部集める(敵が増えれば勝手に増える)
  const names = [];
  for (const pg of CHAR_PAGES) {
    for (const [name] of (pg.items || [])) {
      if (SPRITE_SYMBOLS[name] && !names.includes(name)) names.push(name);
    }
  }
  let n = 0;
  // **置き場所はでたらめに取る。** 手で並べるとどう散らしても目が規則を見つけて
  // しまい、遊んでいる最中の画面に見えないため。
  // **開くたびに違う絵**になる(見た目だけのものなので、種は持たない)。
  // 近づきすぎたら取り直すので、重なってつぶれることはない
  const rand = Math.random;
  const taken = [];
  /** 空いているところを探して置く(near ドットより近いものが無いところ) */
  const scatter = (img, x0, x1, y0, y1, near, priority, rank) => {
    let x = 0, y = 0;
    for (let i = 0; i < 40; i++) {
      x = Math.round(x0 + rand() * (x1 - x0));
      y = Math.round(y0 + rand() * (y1 - y0));
      if (!taken.some((t) => Math.abs(t[0] - x) < near && Math.abs(t[1] - y) < near)) break;
    }
    taken.push([x, y]);
    put(img, x, y, priority, rank);
    n++;
  };
  // 敵。画面のあちこちに散らす(上に寄せない。追ってくる敵は下にもいる)
  for (const name of names) scatter(SPRITE_SYMBOLS[name], 6, 226, 20, 132, 22, 20);
  // 16t のおもり。ゲーム中と同じく上から落ちてくる
  scatter(SPRITE_SYMBOLS.weight16t, 24, 208, 14, 40, 20, 20);
  // 敵の弾。**敵とは別に**散らす(重なってよいので近さは見ない)
  // ゲーム中と同じく 'weak'(自機の弾より 1 段強い)
  for (let i = 0; i < 12; i++) {
    const x = Math.round(10 + rand() * 220);
    const y = Math.round(30 + rand() * 120);
    put(SPRITE_SYMBOLS.bulletE, x, y, 6, 'weak'); n++;
  }
  // 自機の弾。**5 方向**に開いた形(いちばん混む撃ちかた)。
  // 弾の間は撃った時間差のぶんだけ空くので、そこにも ゆらぎを入れる
  for (let i = 0; i < 11; i++) {
    const lane = (i % 5) - 2;                    // -2..2 の 5 方向
    const step = Math.floor(i / 5) + 1;          // 何発めか
    const x = Math.round(120 + lane * (10 + step * 6) + (rand() - 0.5) * 6);
    const y = Math.round(146 - step * 22 - Math.abs(lane) * 6 + (rand() - 0.5) * 10);
    put(SPRITE_SYMBOLS.bulletP, x, y, 5, 'last'); n++;
  }
  // 自機と、その下の推進炎。ゲーム中と同じく**自機は消えない**扱い
  put(SPRITE_SYMBOLS.flameBig, 120, 168, 19); n++;
  put(SPRITE_SYMBOLS.player, 120, 152, 22, 'always'); n++;
  // 取り巻きのアイテムも少し置いて、実戦の混みぐあいに近づける
  scatter(SPRITE_SYMBOLS.item, 12, 80, 136, 156, 20, 18);
  scatter(SPRITE_SYMBOLS.coinItem, 170, 230, 130, 156, 20, 18);
  // 枚数は左下へ(下のナビの文字と重ならないように)
  hud.print(8, 166, 'SPRITES ' + n, 11);
}

function updateCharList() {
  charBook.update();
}

/** ページごとの動き(モアイの色変わり・ロケットの色替え・小惑星の明滅) */
function updateCharAnim() {
  // ちらつき見物のページは**動かさない**(止まっていても、
  // 消える顔ぶれはコマごとに入れ替わるので見える)
  if (charCrowd) return;
  // モアイのページは、ゲーム中と同じ色変わり(緑 <-> 青)と 1 コマおきの明滅を見せる
  if (charMoai) {
    const holo = (mmsxx.frame & 1) === 0;
    const blue = Math.floor(mmsxx.frame / 5) % 10;   // 10 コマの色変わり
    if (holo !== charMoaiShown || blue !== charMoaiBlue) {
      charMoaiShown = holo; charMoaiBlue = blue;
      // ゲーム中と同じく、緑 -> 青 -> 緑 と「行ごとに」色が変わっていく
      // 10 コマの絵を使う(2 枚の切り替えでは実機の見え方にならない)
      const KEY = { moaiTL: 'TL', moaiTR: 'TR', moaiBL: 'BL', moaiBR: 'BR' };
      const step = Math.floor(mmsxx.frame / 5) % 10;
      for (const [name, bx, by] of charMoai) {
        neb.fill(0, bx, by, 32, 40, true);
        if (holo) neb.draw(bx, by, moaiWaveImage(step, KEY[name] || 'TL'));
      }
    }
  }
  // ロケットは灰と白を毎コマ入れ替える(当たり判定のある BG の目印)
  if (charRocket.length) {
    charRocketAlt = !charRocketAlt;
    for (const r of charRocket) {
      neb.draw(r.bx, r.by, charRocketAlt ? BG_SYMBOLS.rocketAlt : BG_SYMBOLS.rocket);
    }
  }
  // 小惑星はゆっくり白く光る(ゲーム中と同じ周期)
  const phase = (mmsxx.frame % 48) < 6 ? 1 : 0;
  if (phase !== charFlashPhase) {
    charFlashPhase = phase;
    for (const f of charFlash) {
      neb.draw(f.bx, f.by, phase ? astFlash(0) : BG_SYMBOLS[f.name]);
    }
  }
}

const PAUSE_TEXT = 'PAUSE';
// タイトルへ戻るのは**打ち込みの側**に置いてある。キー 1 つで戻せると、
// 打ち込みの途中で Q を打っただけで終わってしまうため(Q が使えない字になる)
const PAUSE_HINT = 'ESC:RESUME  TYPE Q' + RET + ' TO TITLE';
const PAUSE_HINT2 = 'CODE + RETURN';
/** ポーズ中に出している文字(88〜152 の 5 行)をまとめて消す */
function clearPauseText() {
  for (let y = 88; y <= 152; y += 16) hud.fill(0, 0, y, VW, 8);
}
function togglePause() {
  resetAsk = false;   // 聞き返しの途中でポーズを出入りしたら、聞かなかったことにする
  setPaused(!paused);
  // エンジンが持っている音。ふつうの playSE() で鳴らすと、
  // すぐ下の pauseSE() に巻き込まれて自分で黙らせてしまう
  mmsxx.audio.playPauseSE();
  if (paused) {
    // **止めずに凍らせる**。stopBGM() だと続きが分からなくなるので、
    // 抜けたときにイントロから鳴り直してしまう
    mmsxx.audio.pauseBGM();
    // くり返し中の SE(レーザーなど)も一緒に止める。
    // 解除すると、止めてあったものだけが鳴り直す
    mmsxx.audio.pauseSE();
    hud.print(centerX(PAUSE_TEXT), 88, PAUSE_TEXT, 15);
    hud.print(centerX(PAUSE_HINT), 104, PAUSE_HINT, 14);
  } else {
    clearPauseText();
    konamiPos = 0;
    typed = '';
    typedShow = '';
    mmsxx.audio.resumeSE();
    // 曲は続きから。**currentBGM は消さない**(消すと updateBGM が
    // playBGM(…, true) で鳴らし直し、頭から流れてしまう)。
    // ポーズ中の裏技で局面が変わったときは、次のコマで want が変わるので
    // そちらの道でちゃんと曲が切り替わる
    mmsxx.audio.resumeBGM();
    // ALT+S を押した直後にポーズを抜けたときは、**もう 1 枚**コピーする。
    // ポーズの文字が写らない絵がほしいときの流れ:
    //   ポーズ → 構図を決める → ALT+S(そのまま 1 枚) → ESC(文字なしで 1 枚)
    // capture() が読むのは「最後に描き終わった画面」なので、
    // ポーズの文字を消した絵が出るまで 1 フレーム待ってから撮る
    if (captureArmed > 0) { capturePending = 2; captureArmed = 0; }
  }
}

// ポーズを抜けた直後にもう 1 枚撮るまでの、残りフレーム数
let capturePending = 0;
// ALT+S を押してから、ポーズを抜けたら 2 枚目を撮る猶予(1 秒)
let captureArmed = 0;

/** ALT が押されているか(左右どちらでも) */
function altDown() {
  return mmsxx.input.isDown('AltLeft') || mmsxx.input.isDown('AltRight');
}

// ---- メインループ ----
// コマ数の表示は**開発版だけ**。DOM に出すので画面写真には写らない
const fpsMeter = DEV ? new FpsMeter() : null;
// いまの局面(ボスの段階と技)も**開発版だけ**。これも DOM なので写らない。
// ?states=0 で消せる(演出を見たいときにじゃまなことがある)
const stateMeter = DEV && OPT.get('states') !== '0'
  ? new StateMeter({ canvas: document.getElementById('screen') }) : null;
// 丸ごと録画(ALT+R)は **localhost のときだけ**。目印の REC も DOM に出すので写らない。
// dev:true のまま固めた手元用ビルドを人に渡しても、そちらでは動かない。
// **読み込むのも localhost のときだけ**にしてある(公開版には 1 バイトも入らない)
let recorder = null;
const RECORD_HOST = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
if (DEV && RECORD_HOST) {
  import('./recorder.js').then(({ RawRecorder }) => {
    recorder = new RawRecorder(mmsxx);
    // **ここで直に受ける。** フォルダを選ぶ窓は「人が押した流れ」からしか
    // 開けないので、ほかの ALT+ ショートカットのようにゲームループから
    // 読む作り(altDown + wasPressed)では弾かれてしまう
    window.addEventListener('keydown', (e) => {
      if (!e.altKey || e.code !== 'KeyR' || e.repeat) return;
      e.preventDefault();
      recorder.toggle();
    });
    // 閉じ忘れの保険。ファイルは閉じるまで完成しないので、
    // 読み込み直すとそこまでのぶんが読めなくなる
    window.addEventListener('pagehide', () => { if (recorder.recording) recorder.stop(); });
  }).catch((e) => mmsxx.errors.log('録画の部品を読めませんでした: ' + e));
}
enterTitle();
// URL で始めかたが指定されていれば、タイトルを飛ばしてそこから始める。
// **?stage= は開発版だけ**(遊ぶ人に途中の面を渡さない)
{
  const want = OPT.get('mode');
  const at = want ? MODES.findIndex((m) => m.id === want) : -1;
  const stage = DEV ? Math.max(0, Math.min(9, Number(OPT.get('stage')) || 0)) : 0;
  if (stage > 0) sceneStart(stage, false);
  else if (at >= 0) {
    modeIndex = at;
    const id = MODES[at].id;
    if (id === 'staff') enterStaffRoll();
    else if (id === 'sound') enterSoundTest();
    else if (id === 'chars') enterCharList();
    else if (id === 'stats') enterStats();
    else if (id === 'scene') enterSceneSelect();
    else if (id === 'devset') enterDevSettings();
    else if (id === 'bossrush') enterBossRushMenu();
    else enterPlay();
  }
}
// ---- ゲームパッド ----
// **このゲームでの割り当て**。部品(engine/util/gamepad.js)は番号と位置しか知らないので、
// どのボタンを何にするかはここで決める。差し替えるときはこの表だけを直す。
//
//   十字(12〜15) / 左スティック … 矢印
//   A(0) / B(1)                 … SPACE(ショット・決定)
//   X(2) / Y(3)                 … ESC(ポーズ・もどる)
//   START(9)                    … ESC
//   **それ以外のボタンはショット**
//
// 右手の 4 つを下段(A・B)と上段(X・Y)で分け、**下段を撃つ・上段を戻す**にする。
// 親指をどちらに置いても、そのまま押せば弾が出る。
// 残りのボタンもショットにしてあるので、割り当てを覚えてもらう必要がない。
//
// 連射は入れない。**こすり打ちのゲーム**なので、こちらから連射を足すと
// 記録の意味が変わってしまう(docs/TODO.md の J 章)。
// なお**パッド側が持っている連射は止められない**。人が速く叩いたのと
// まったく同じ形で届くので、見分けがつかない
const PAD_MAP = {
  8: 'Escape', 9: 'Escape',   // Back と Start だけポーズ。ABXY はすべてショット
  12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight',
};
for (let i = 0; i < 32; i++) if (PAD_MAP[i] === undefined) PAD_MAP[i] = 'Space';

const gamepad = createGamepad({
  // **第 2 引数の 'pad' を忘れない**。省くとキーボードで遊んだことになり、
  // ランキングへ誤った操作方法が載る(engine/input.js の usedInputs)。
  //
  // 使うと答えてもらうまでは流さない(下の padEnabled)。
  // **離すほうは常に流す**。切り替わった拍子に押しっぱなしが残らないように
  press: (code) => { if (padEnabled) mmsxx.input.press(code, 'pad'); },
  release: (code) => mmsxx.input.release(code),
  // **倒し量もそのまま流す**(4 方向のキーとは別の口)。
  // 読むのは遊びの最中だけ。メニューは今までどおり矢印で動く
  onStick: (x, y) => { if (padEnabled) mmsxx.input.setStick('pad', x, y); },
  map: PAD_MAP,
});

// ---- パッドを認識したことの知らせ ----
// **キャンバスに描かず、DOM を上に重ねる**(docs/SMARTPHONE.md の 5 節)。
// 画面の下に置くとキー入力が二重になったり奪われたりするので、
// キャンバスの上に白い札として出し、**出ているあいだはゲームを止める**。
//
// スペースを押してもらうのには意味が 2 つある。
//   1. パッドを繋いだ人に「使える」と伝える
//   2. **音を出す**。ブラウザはパッドの操作を「人が触った」と数えないので、
//      キーかクリックが 1 回ないと音が鳴りはじめない
const PAD_NOTICE_TEXT = {
  // キーの名前は**ボタンの中に書く**。案内を別の行に出すと、同じことを 2 回言うことになる
  ja: {
    ok: 'ゲームパッドを認識しました。',
    ng: 'ゲームパッドを認識しましたが、対応していない形式です。',
    use: '使う（SPACE）', dont: '使わない（ESC）', close: 'とじる（SPACE）',
  },
  en: {
    ok: 'GAMEPAD DETECTED.',
    ng: 'GAMEPAD DETECTED, BUT THIS FORMAT IS NOT SUPPORTED.',
    use: 'USE (SPACE)', dont: "DON'T USE (ESC)", close: 'CLOSE (SPACE)',
  },
};
let padEnabled = false;       // パッドの入力をゲームへ流すか。**スペースで入り、ESC で切れる**
let padDeclined = 0;          // ESC で断られた回数
let padNgShown = false;       // 対応していないパッドの知らせを出したか(1 ページに 1 回)
// **これだけ断られたら、そのページでは二度と出さない。**
// 3 回続くのは、ボタンが張り付いているなど**こちらの都合ではない何か**が
// 起きているとき。出し続けても邪魔にしかならない
const PAD_DECLINE_MAX = 3;
// 札そのものはエンジンの道具(engine/util/notice.js)。文言と返事の中身だけここで決める
const padNotice = createNotice(mmsxx, {
  mount: document.getElementById('stage'),
  canvas: document.getElementById('screen'),
  className: 'pad-notice',
});
/**
 * 知らせを出す。出ているあいだはゲームが止まる。
 * **使うと決めたあとは出さない**し、断られ続けたときも出さない
 */
function showPadNotice() {
  if (padNotice.open || padEnabled || padDeclined >= PAD_DECLINE_MAX) return false;
  // **タイトル(ランキングの一覧もここ)のときだけ**。
  // 札はゲームを止めるので、遊んでいる最中に出すと弾の合間だろうが画面が凍る。
  // リプレイの再生ともかみ合わない(絵はエンジン側で進み、ゲームだけ止まる)。
  // 遊んでいる途中で繋いだ人は、**次にタイトルへ戻ってボタンを押したときに**気づく
  if (state !== 'title') return false;
  const ok = gamepad.usable().length > 0;
  // 日本語の環境なら日本語、それ以外は英語
  const text = PAD_NOTICE_TEXT[pickLanguage(['ja'], 'en')];
  // 閉じたときに押されていたキーで返事が変わる。
  //   ESC    … **使わない**。パッドの入力を切ったままにする
  //            (うっかり触れただけの人の逃げ道。ゲームを止めているので逃げ道が要る)
  //   その他  … **使う**。あわせて音も解禁される(エンジンが keydown で unlock する)
  // ボタンも置く。**キーボードの無い端末は、これでしか答えられない**
  const buttons = ok
    ? [{ label: text.use, code: 'Space' }, { label: text.dont, code: 'Escape' }]
    : [{ label: text.close, code: 'Escape' }];
  padNotice.show(ok ? text.ok : text.ng, (e) => {
    // **また押されたら、もう一度聞く**。断られ続けたときだけ黙る
    if (e.code === 'Escape') { padEnabled = false; padDeclined++; return; }
    padEnabled = true;
    // 使うと答えてもらえた合図。ここで初めて音が出せるようになっている
    mmsxx.audio.playSE('item', SE_EVENT);
  }, buttons);
  return true;
}
// **押されるまでパッドは見えない**ので、知らせを出す機会もここになる
gamepad.onRawPress = () => showPadNotice();

// ---- スマホのタッチ操作 ----
// 器は engine/util/touchgui.js、十字とショットは engine/util/touch.js、
// ジェスチャの見分けは engine/util/gesture.js。**ここで決めるのは
// 「どの画面で何ができるか」だけ**(docs/SMARTPHONE.md)。
//
//   ゲーム中          … 左に十字、右にこすり打ちのショット
//   タイトル・ポーズ・一覧 … どちらも出さず、画面ぜんぶでジェスチャを受ける。
//                        空いた左右には**いま何ができるか**を書く
//
// 出すのは**スマホと見なした端末だけ**。PC で確かめたい人のために口を 2 つ:
//
//   ?pad=1            … パッドを出すだけ。窓の大きさはそのまま
//   ?device=<機種>    … **スマホモードを丸ごと強制する**。パッドを出し、
//                       指で触る端末として扱い(縦持ちなら 90 度回す)、
//                       置ける場所を**その機種の画角**に区切る。
//                       名前は下の DEVICES を見ること(mobile で既定の機種)
//   ?notch=left/right … ノッチをどちら側に来させるか
//
// **?device= の機種名は device.js には無い名前**。あちらは mobile / desktop しか
// 見ないので、知らない名前は無視されて自動判定に戻る。だからここで PAD_ON も
// 立ててやる必要がある(下の DEVICE を見ている)
//
// キーボードはどちらでも今までどおり効く。
/**
 * ?device= で選ばれた機種。**知らない名前と実機では null**(区切らない)。
 * 一覧は engine/util/devices.js。ノッチがどちら側に来るかは ?notch= で選ぶ
 */
const DEVICE = coarsePointer() ? null : findDevice(OPT.get('device'));
function coarsePointer() {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
}
// 機種を名指しされたときも出す(device.js は機種名を知らないので、ここで足す)
const PAD_ON = isMobileLike() || OPT.get('pad') === '1' || !!DEVICE;
/**
 * 案内の文言。**ここだけ日本語と英語を出し分ける**(canvas の中は英語のまま)。
 * **?lang=ja / ?lang=en で決め打ちにできる**(両方の見えかたを撮るため。
 * ふだんはブラウザの希望どおりで、知らない値は無視する)
 */
// **'en' も受け付ける一覧に入れておくこと。** testLang は「用意していない言葉は
// 無視する」ので、['ja'] だけにしていると **?lang=en が知らない値として捨てられ**、
// ブラウザの希望(日本語)へ落ちていた。日本語の端末で英語の見えかたが撮れない
const TG_LANG = testLang(['ja', 'en'], 'en');
/** 左の空きに出す案内。上下と左右で 1 つずつ */
// **用事だけを書く。** 「スワイプで」「ドラッグで」は要らない。
// 下敷きの矢印が向きを言っているし、そこを払うより先に指が動くことはない。
// 日本語は**漢字を積極的に使って詰める**(「えらぶ」より「選択」)
/**
 * **数個から選ぶ場面で、縦に 1 歩送るのに要る指の移動**(px)。
 * 何十行もある一覧(既定 26px)と同じ細かさにすると、
 * ちょっと動かしただけで飛んでしまう
 */
const TG_PICK = 52;

/**
 * **画面の大きさを遊ぶ人が決める**(左上の ＋ / −)。
 * **一度でも押されたら、こちらからは動かさない**(onNeedRoom を黙らせる)。
 * 自分で決めたものを勝手に戻されるのがいちばん困る。
 *
 * **宣言はここ。** 使うのは下の bindZoomButtons() だが、
 * あちらは PAD_ON の block から呼ばれるので、**それより前に置く**
 * (const は巻き上がらない。下に置くと初期化前に触って落ちる)
 */
let zoomByUser = false;
/** つまみのボタンを出しているか(遊んでいる最中は出さない) */
let tuneShown = true;
/** キーボードのボタンが押せる状態か(打てる場面だけ) */
let kbdUsable = null;
/** 180 度のボタンを出しているか(ポーズ中だけ) */
let rotateShown = null;
/** つまみのボタンを出しているか(ポーズ中だけ) */
let padSenseShown = null;
/** 遊びかたの ? を出しているか(ポーズ中だけ) */
let howToShown = null;
/** 段を選ぶ部品(engine/util/stepper.js)。**PAD_ON のときだけ作る** */
let padFeelUI = null;
/** 行き先の数を選ぶ部品。**パッドレスのときだけ作る** */
let padTargetsUI = null;
/**
 * **十字の効きぐあい**(ポーズ中に切り替える)。
 *
 * 指をどれだけ動かせば自機が全速になるか、を段で選ぶ。
 * **速いほど「ちょっと動かしただけで自機が付いてくる」**が、
 * そのぶん止めたいところで行き過ぎる。好みが分かれるので遊ぶ人に決めてもらう。
 *
 * **自機の最高速は どの段でも同じ**(上げると記録の公平さに触るため)。
 * 変えているのは「全速に届くまでの指の速さ」だけ。
 *
 * **宣言はここ。** 使うのは下の bindPadSenseButton() だが、あちらは
 * bindZoomButtons() から呼ばれるので、**それより前に置く**
 * (const は巻き上がらない。下に置くと初期化前に触って落ちる)
 */
const PAD_SENSE = [
  { name: 'LOW', full: 0.20, min: 0.05 },
  { name: 'NORMAL', full: 0.10, min: 0.03 },
  { name: 'HIGH', full: 0.05, min: 0.02 },
];
/**
 * **効きぐあい(PAD RESPONSE)のボタンを出すか。** いまは出さない。
 *
 * 上の表が書き換えるのは `stickFullSpeed` / `stickMinSpeed` の 2 つで、
 * **どちらも `stickMode: 'move'` のときしか読まれない**。
 * いまの既定は `'origin'`(原点からの距離で倒し量を作る)なので、
 * **押しても札の字が変わるだけで、効きぐあいは何も動かない**。
 * 実測でも LOW と HIGH で出る値が 1 つも違わなかった。
 *
 * **表と applyPadSense() は残してある**(いまはどこからも呼んでいない)。
 * `move` を既定へ戻したときや、`origin` で効くつまみ
 * (`stickFullDist` / `stickCurve` / `dragMax`)を動かす形へ書き替えたときに、
 * この旗を見て出し直す。
 * **ポーズ中のボタンそのものは、いま下の切り返しの段が使っている**ので、
 * 両方を出したいならボタンをもう 1 つ増やすことになる
 */
const PAD_SENSE_ON = false;

/**
 * **十字の効きぐあい。ポーズ中のボタンで、組み合わせを選ぶ。**
 *
 * つまみを 1 本ずつ出したこともあったが、**数が多くて選びきれない**
 * (不感帯・停止域・曲線・折り返しで 4 つあった)。しかも 1 つだけ動かしても
 * 良くならない ── 「留まってほしい」は不感帯と停止域の両方が要るし、
 * 「裏返りすぎ」は折り返しと曲線の兼ね合いで決まる。
 * **効きぐあいは 1 本の軸**にして、きびきび〜落ち着く、で並べてある。
 *
 * 中身(engine/util/touch.js のつまみ):
 *
 *   dead  … 原点からこれだけの内は倒し量 0(deadzone)
 *   home  … **触れた点**のまわりの止まりどころ(stickHome)。原点は引きずりで
 *           動くがこちらは動かないので、速く払って戻っても必ず止まる
 *   curve … 手前の割りふり(stickCurve)。大きいほど手前が這う
 *   angle … 折り返しと決める開き(stickFlipAngle。0 で切)
 *   move  … 折り返しと見なすのに要る 1 回ぶんの動き(stickFlipMove)
 */
const PAD_FEEL = [
  // 指に素直。**すぐ効いて、すぐ裏返る**
  { name: 'QUICK', dead: 2, home: 6, curve: 2, angle: 120, move: 4 },
  { name: 'NORMAL', dead: 4, home: 10, curve: 3.2, angle: 145, move: 6 },
  // 留まる域を広げ、裏返りも重くする
  { name: 'CALM', dead: 7, home: 16, curve: 3.8, angle: 165, move: 8 },
  // **裏返りは切る。** いちばん落ち着く(狙って止めやすいぶん、切り返しは遅い)
  { name: 'STEADY', dead: 10, home: 22, curve: 4.5, angle: 0, move: 8 },
];
/** いまの段。**まん中から始める** */
let padFeel = 1;

/**
 * **パッドレスで溜めておける行き先の数**(ポーズ中に選ぶ)。
 *
 * 1 なら叩いたところへ行くだけ。増やすと**先の手まで置いておける**ので、
 * 弾幕の切れ目を 2 手 3 手 先に引いておける。
 *
 * **既定は 1。** 増えるほど画面に赤い十字が並ぶので、
 * 慣れないうちは何が起きているのか分かりにくい
 */
/**
 * **4 つ目はバーチャルパッド。** 数ではなく遊びかたそのものを選ぶ。
 * 同じ 1 つのボタンで選べるようにしてあるのは、
 * **どちらも「どうやって動かすか」の話**だから(別の場所に分けると、
 * パッドに戻したい人が CONTROL を見つけられない)
 */
const PAD_TARGETS = [
  // **並びは既定のものから。** 初めて開いた人がまず見るのは先頭なので、
  // 既定(十字)を先頭に置く
  { name: 'V-PAD', points: 0 },   // 0 = 行き先を置くのをやめて十字を出す
  { name: 'TGT1', points: 1 },
  // **2 つまで。** 3 つ置けるようにしてあったが、画面に赤い十字が
  // 3 つ並ぶと、どれが次の行き先なのか見て取れなかった
  { name: 'TGT2', points: 2 },
  // **指を筆にして引っぱる**(engine/util/trace.js)。
  // 手ブレ補正の掛かった遅延ドローで、自機が筆先として付いてくる
  { name: 'DRAW', points: 0, draw: true },
];
/**
 * いまの段(PAD_TARGETS の番号)。**十字から始める**。
 *
 * 行き先を置く遊びかたのほうが後から作ったものだが、
 * 初めて触る人には十字のほうが読める(見れば何をするものか分かる)。
 * 置く遊びかたはポーズ中の CONTROL で選んでもらう
 */
let padTargets = PAD_TARGETS.findIndex(s => s.name === 'V-PAD');
/** いまの段。**まん中から始める** */
let padSense = 1;
const ZOOM_STEP = 1.12;   // 1 回で 1 割ちょっと。押した手応えが分かるくらい
const ZOOM_MIN = 0.4, ZOOM_MAX = 1;
/**
 * **自動で縮めるときの下限**(ゲーム画面の見た目の幅 px)。
 *
 * **1 ドットが CSS で 2px** になるところ(256 ドット + ボーダー 16 で 544)。
 * ここを割ってまで GUI の場所を作らない。当たったら諦めて重ねる。
 *
 * これで**小さい機種は縮まず、大きい機種だけ縮む**。
 *   iPhone SE  … 等倍でも 416px しかない → 縮めない(重ねる)
 *   iPad       … 960px あるので 820px まで縮めて、帯を開ける
 *
 * **遊ぶ人が ＋ / − で縮めるぶんには効かない**(あちらは自分で決めたこと)
 */
const MIN_GAME_W = 544;
const TG = {
  // **長押しで出す説明(tip)は、見えている文字より詳しく書く。**
  // 同じことが書いてあるだけなら、長押しした甲斐が無い。
  // 見えている側は用事だけ、長押し側は**指の動かしかたまで**
  page: { icon: 'leftright', en: 'PAGE', ja: 'ページ切り替え',
    tipEn: 'SWIPE LEFT / RIGHT TO TURN THE PAGE', tipJa: '左右にスワイプでページを送る' },
  scroll: { icon: 'updown', en: 'SCROLL', ja: 'スクロール',
    tipEn: 'DRAG UP / DOWN TO SCROLL THE LIST', tipJa: '上下にドラッグで一覧を送る' },
  // **何を選ぶのかまで書く。** ただの「選択」では、その画面で
  // 上下が何に効くのか分からない
  menu: { icon: 'updown', en: 'MENU', ja: 'メニュー選択',
    tipEn: 'DRAG UP / DOWN TO PICK A MENU', tipJa: '上下にドラッグでメニューを選ぶ' },
  select: { icon: 'updown', en: 'SELECT', ja: '選択',
    tipEn: 'DRAG UP / DOWN TO PICK AN ITEM', tipJa: '上下にドラッグで項目を選ぶ' },
  sound: { icon: 'updown', en: 'SOUND', ja: 'サウンド選択',
    tipEn: 'DRAG UP / DOWN TO PICK A SOUND', tipJa: '上下にドラッグで曲や音を選ぶ' },
  category: { icon: 'leftright', en: 'CATEGORY', ja: 'カテゴリ変更',
    tipEn: 'SWIPE LEFT / RIGHT TO CHANGE CATEGORY', tipJa: '左右にスワイプで種類を変える' },
  letter: { icon: 'updown', en: 'LETTER', ja: '文字選択',
    tipEn: 'DRAG UP / DOWN TO CHANGE THE LETTER', tipJa: '上下にドラッグで文字を変える' },
  cursor: { icon: 'leftright', en: 'CURSOR', ja: 'カーソル移動',
    tipEn: 'SWIPE LEFT / RIGHT TO MOVE THE CURSOR', tipJa: '左右にスワイプで桁を移る' },
};
/**
 * **OK と ESC のボタンに入れる文言。** 場面ごとに中身だけ入れ替える。
 * 「タップで◯◯」という案内は出さない。**ボタンにそう書いてあれば足りる**。
 * 場所と大きさは動かさないので、押す位置は覚えたままでよい
 */
// **やさしい英語はそのまま英語で出す。** SKIP や BACK まで訳すと、
// かえって回りくどく読める。日本語にするのは、左の空きに出す**説明の文**だけ
const OK = {
  start: 'START',
  title: 'TITLE',
  next: 'NEXT',
  enter: 'ENTER',
  select: 'SELECT',
  play: 'PLAY',
  skip: 'SKIP',
  back: 'BACK',
  // **先へ進むだけ**の場面。何が起きるかを名前で言えないときはこれ
  ok: 'OK',
  /**
   * **タイトルで選んでいるものの名前**(NORMAL GAME / HARD GAME / ...)。
   * 上下で選んだものと押すボタンが結びつくように、名前をそのまま出す。
   * **毎コマ呼ばれる**ので、関数のまま持っておく
   */
  pick: () => MODES[modeIndex].name,
  // **やめる**。いまは OPTBTN.keepPlaying(ポーズの聞き返し)だけが使う。
  // **名前入力では使わない** — あちらは画面の中が ESC:SKIP と書いているので、
  // ボタンも SKIP に揃えてある(CANCEL だと「打ったぶんを取り消す」とも読める)
  cancel: 'CANCEL',
  pause: 'PAUSE',
  resume: 'RESUME',
  stop: 'STOP',
  // 記録を送るところ。**送り直すか / あきらめるか**を聞いている場面
  retry: 'RETRY',
  no: 'NO',
};
/**
 * **ESC の下の OPTION ボタン**。場面ごとに割り当てが変わる 3 つめ。
 * キーのある用事は `code`、キーの無い用事は `run` を渡す
 */
const OPTBTN = {
  // **押しても、まだ捨てない。** 遊びを捨てる操作なので、
  // 隣の RESUME と間違えて触ったぶんが取り返せるように、一度聞き返す
  reset: { en: 'RESET', run: () => { resetAsk = true; } },
  // 聞き返しているあいだの 2 つ。**捨てるほうを上、やめるほうを下**に置く
  goTitle: { en: 'TITLE', run: () => { resetAsk = false; resetToTitle(); } },
  keepPlaying: { en: 'CANCEL', run: () => { resetAsk = false; } },
  // サウンドテストの停止。**鳴らしっぱなしを止める口**が要る。
  // ESC は画面を出るほうなので、止めるだけの関数を直に呼ぶ
  soundStop: { en: 'STOP', run: () => stopSoundTest() },
  // 名前入力の 1 文字消し。左キーは桁を移るだけなので、消す口がここに要る。
  // **BACK とは書かない。** 前の画面へ戻るようにも、1 桁戻るようにも読める。
  // するのは「消す」なので DEL
  del: { en: 'DEL', code: 'Backspace' },
  // **名前入力の確定。** キーボードの SPACE は「ENTER の枠にいるときだけ」
  // 効くので、指では枠まで移らないと先へ進めず、行き止まりに見えていた。
  // ボタンは**どこにいても確定**にする(打ち終わったら押すもの、で通る)
  submit: { en: 'ENTER', run: () => startSubmit() },
};
/** RESET を押して、まだ答えていない状態。ポーズを抜けたら忘れる */
let resetAsk = false;

/**
 * いまの画面でできること。**ここに書いてあるのは、その画面が実際に
 * 見ているキーだけ**(押せないものを案内すると嘘になる)。
 * ok / esc はボタンを効かせるかどうかで、置き場所は動かさない
 */
function menuGuide() {
  // ポーズ中。抜けるのは ESC だけ(SPACE は裏技の打ち込みに使う)
  // ポーズ中。**RESET は OPTION ボタン**(打ち込みの Q と同じことをする)
  if (paused) {
    // RESET を押したあとは**聞き返す**。上が捨てるほう、下がやめるほう
    // **捨てるほうを下、やめるほうを上。** 上は RESUME / RESET を押した指が
    // そのまま残っている場所なので、そこに「タイトルへ」を置くと押し間違える
    // (実際そうなった)。取り返しのつかないほうを、指から遠いところへ置く
    if (resetAsk) return { left: [], esc: OPTBTN.keepPlaying, ok: OPTBTN.goTitle, opt: null };
    return { left: [], ok: null, esc: OK.resume, opt: OPTBTN.reset };
  }
  switch (state) {
    case 'title':
      // ロゴのページだけ上下でモードを選べる。一覧のページは上下がスクロール
      // モードは数個しかないので、**1 歩ぶんを大きく取る**(TG_PICK)
      if (titlePage === 0) {
        // **選んでいるものの名前をボタンに出す。**
        // START とだけ書いてあると、上下で選んだものと押すものが
        // 結びつかない(canvas の中の並びと、指が触るボタンが別の場所にある)。
        // 名前がそのまま出ていれば、押す前にどれを選んだのかが分かる
        return { left: [TG.page, TG.menu], ok: OK.pick(), esc: null, step: TG_PICK,
          okBig: true };
      }
      if (titlePage === 1) return { left: [TG.page], ok: OK.title, esc: null };
      return { left: [TG.page, TG.scroll], ok: OK.title, esc: null };
    case 'over':
      // **同じ SKIP を 2 つ並べない。** どちらを押しても同じことが起きるので、
      // 上に置いてあると「別の何かだろうか」と考えさせるだけだった。
      // 残すのは下の 1 つ。**する事は先へ進むこと**なので OK と書く
      return { left: [], ok: OK.ok, esc: null };
    case 'entry':
      // 左右で桁と ENTER を選び、上下でその桁の文字を送る。
      // **画面の中の案内と同じ言葉にする**(あちらは ESC:SKIP)。
      // CANCEL だと「打ったぶんを取り消す」とも読めるが、するのは
      // 名前を付けずに先へ行くこと
      // **ここだけ横払いの向きが逆。** ほかの場面は「ページをめくる」ので
      // 左へ払うと次が出てくるが、ここで動くのは指の先にあるカーソル。
      // 既定のままだと右へ払って左へ動き、実機で「左右が逆」になっていた
      return { left: [TG.cursor, TG.letter], xFollow: true,
        ok: OPTBTN.submit, esc: OK.skip, opt: OPTBTN.del };
    // **記録を送っているところ。** ここを書き忘れていて、下の default
    // (何も押せない)に落ちていた。**キーボードなら SPACE で進めるのに、
    // 指では押すものが 1 つも無く、ランキングに載ったあとタイトルへ戻れなかった**
    case 'submitting':
      // 送れなかったので「もう一度送るか」を聞いている
      if (submitAsk) return { left: [], ok: OK.retry, esc: OK.no };
      // 知らせ(送れた / 手元だけ)を読み終わるのを待っている。**どちらでも進む**
      if (submitWaitKey) return { left: [], ok: OK.next, esc: OK.next };
      // 送っている最中。返事が来るまでは触らせない
      return { left: [], ok: null, esc: null };
    case 'story':
      return { left: [], ok: OK.next, esc: OK.skip };
    case 'staff':
      return { left: [], ok: OK.skip, esc: OK.skip };
    case 'chars':
      // ページ送りは左右だけ。SPACE は先へ進むだけ(戻るのは左)
      return { left: [TG.page], ok: OK.next, esc: OK.back };
    case 'stats':
      return { left: [TG.scroll], ok: null, esc: OK.back };
    case 'sound':
      return { left: [TG.category, TG.sound], ok: OK.play, esc: OK.back,
        opt: OPTBTN.soundStop, step: TG_PICK };
    case 'scene':
    case 'devset':
      return { left: [TG.select], ok: OK.select, esc: OK.back, step: TG_PICK };
    // リプレイは見ているだけ。止められるのは ESC
    case 'replay':
      return { left: [], ok: null, esc: OK.stop };
    // 送っている最中は触らせない
    default:
      return { left: [], ok: null, esc: null };
  }
}

let touchGui = null;
if (PAD_ON) {
  touchGui = new TouchGui({
    canvas: document.getElementById('screen'),
    // 回しているかどうかを知っているのはエンジン(engine/video.js)。
    // **角度で渡す**(0/90/180/270)。180 度は下の rotate-btn で入る
    isRotated: () => mmsxx.vdp.rotated,
    viewAngle: () => mmsxx.vdp.viewAngle,
    // **第 2 引数の種別をそのまま流す**。付け忘れが起きないよう素通しにする
    // (engine/input.js の usedInputs。ランキングへ操作方法として載る)
    onPress: (code, source) => {
      // **指でも音を解禁する。** ブラウザは「人が触った」合図がないと
      // 音を出さない。エンジンがそれをやっているのは keydown のときだけで
      // (engine.js の new Input)、タッチは input.press() を直に呼ぶので
      // その道を通らない。**繋がないかぎり最初から最後まで無音になっていた**。
      // ここは pointerdown の中から呼ばれているので、合図として通る
      mmsxx.audio.unlock();
      mmsxx.input.press(code, source);
    },
    onRelease: (code) => mmsxx.input.release(code),
    // **倒している向きと強さも流す**(8 方向のキーとは別の口)。
    // 読むのは遊びの最中だけ。メニューは今までどおり矢印で動く
    onStick: (x, y) => mmsxx.input.setStick('touch', x, y),
    // **置いたままなら、キーボードの SPACE を押しっぱなしにしたのと同じ。**
    // 触れた 1 発のあとは何も起きない、では指を離す理由が分からない。
    // 押しっぱなしに何をさせるか(ゆっくりの自動連射)を決めているのは
    // ゲーム側なので、キーボードと指で答えが変わらない
    touch: {
      // **撃っているのがふつうで、止めるために触る。**
      //   触っていない … 押しっぱなし(ゆっくりの自動連射)
      //   置いて動かさない … 撃たない
      //   こする … そのぶん押し直す(今までどおり)
      // 弾を撃たない時間のほうが珍しい遊びなので、指をふだん自由にしておける
      idleFire: true,
      // **向きは触れたところからの倒しかたで決める**('origin')。
      // いったん「指の動く向き」('move')を既定にしてみたが、つまみを詰め直す
      // ことにしたので戻してある。**?stick=move で新しいほうを試せる**。
      //   origin … 触れたところが原点。倒した向きを保てる。
      //            折り返すには原点をまたぐまで戻す必要がある
      //   move   … いま指が動いている向き。折り返しがその場でつながり、
      //            指を止めれば止まる
      stickMode: OPT.get('stick') === 'move' ? 'move' : 'origin',
      /**
       * **原点を引きずる距離**(`?drag=`)。既定は部品まかせ(28px)。
       * `?drag=0` で引きずらないほう(前の効きぐあい)に戻せるので、
       * 行きつ戻りつする感じが減ったかどうかを**実機で見比べられる**。
       * 全開の距離(14px)を下回る値は受けない(全開に届かなくなるため)
       */
      ...(() => {
        const v = Number(OPT.get('drag'));
        return (OPT.get('drag') != null && Number.isFinite(v)
          && (v === 0 || (v >= 16 && v <= 120))) ? { dragMax: v } : {};
      })(),
      /**
       * **全開までの距離**(`?full=`。既定 14px)と
       * **効きぐあいの曲がりかた**(`?curve=`。既定 1 = 直線)。
       *
       * この 2 つは**組で見ること**。曲線は「不感帯から全開までの
       * あいだの割りふり」しか変えないので、いまの 14px のように
       * あいだがほとんど無いと、どう曲げても見た目が変わらない。
       * 例: `?full=55&curve=0.45` … 1/8 動かせば 3 割、半分で 7 割
       */
      ...(() => {
        const v = Number(OPT.get('full'));
        return (v >= 8 && v <= 160) ? { stickFullDist: v } : {};
      })(),
      // **`?curve=` はここでは見ない。** 曲線はポーズ中の CURVE が持ち主で、
      // 立ち上げのときに applyPadCurve() が当て直すので、ここで入れても
      // 上書きされて消える(持ち主が 2 つあると、どちらが効いているのか
      // 分からなくなる)。段の名前で選ぶなら `?padcurve=SOFT`
      // **ポーズ中のつまみが持っているぶんはここでは見ない。**
      // 不感帯(NEUTRAL)・曲線(CURVE)・折り返し(TURN BACK)は、
      // 立ち上げのときに applyPadNeutral / applyPadCurve / applyPadFlip が
      // 当て直す。ここでも入れると、同じ値の持ち主が 2 つになって食い違う
    },
    lang: TG_LANG,
    // 強制したときだけ、器も同じ画角に区切る(canvas 側は下の fitSize)
    frame: DEVICE ? () => DEVICE : null,
    /**
     * **GUI の置き場所がまったく無いと言われたら、画面を 1 段小さくする。**
     * 重ねるのは最後の手。iPad のように画面の大きい機種なら、
     * 少し縮めても十分大きいので、そちらのほうがよい。
     * @returns {boolean} 縮めたか(縮めたら器が測り直す)
     */
    onNeedRoom: (want, cur) => {
      // **遊ぶ人が自分で決めたあとは、こちらから動かさない**(下の zoom ボタン)
      if (zoomByUser) return false;
      if (!(cur > 0) || !(want > 0)) return false;
      // **等倍を割ってまでは縮めない。** GUI の置き場所より、
      // ゲーム画面が読めることのほうが先。ここに当たったら、
      // 帯が足りなくても諦めて重ねる
      if (cur <= MIN_GAME_W) return false;
      const room = Math.max(want, MIN_GAME_W);
      const z = mmsxx.vdp.zoom * (room / cur);
      if (z >= mmsxx.vdp.zoom - 0.01) return false;
      mmsxx.vdp.zoom = z;
      mmsxx.vdp.refitCss();
      return true;
    },
  });
  // PC で ?device=mobile を付けたときは、**指で触る端末として扱う**。
  // 縦持ちで見せる回転もここで効くようになる
  if (DEVICE) {
    mmsxx.vdp.touchLike = true;
    mmsxx.vdp.fitSize = DEVICE;
    mmsxx.vdp.zoom = 1;
    // **dpr も真似る。** 倍率は実画素で整数に丸めるので、
    // dpr が違うと同じ画角でも倍率が変わってしまう(PC は 1、スマホは 3 が多い)
    mmsxx.vdp.fitDpr = DEVICE.dpr;
    // 端末に食われるぶんも真似る。
    //
    // **ホームバーはいつも居る**(そういう機種なら)。ノッチがどちら側だろうと
    // 下の長い辺に沿って座っていて、そこは上スワイプを OS に吸われる
    const st = document.documentElement.style;
    if (DEVICE.home) st.setProperty('--mmsxx-safe-bottom', DEVICE.home + 'px');
    // **横持ちのノッチは左右どちらに来るか分からない**ので、両方見られるようにする
    //   ?notch=left   … 左がくびれる
    //   ?notch=right  … 右がくびれる
    //   指定なし      … くびれなし(ホームバーのぶんだけ)
    const notch = OPT.get('notch');
    if (DEVICE.notch && (notch === 'left' || notch === 'right')) {
      st.setProperty('--mmsxx-safe-' + notch, DEVICE.notch + 'px');
    }
  }
  // **取り付ける前に、画面の大きさを決めきっておく。**
  // 取り付けると器がその場で測るので、まだ小さい(あるいは大きい)canvas を
  // 見て「空きが無い」と判断し、要らない縮小が掛かってしまう。
  // canvas の下の文字を消すのも、縦が空いて大きさが変わるのでここでやる
  document.body.classList.add('touch-gui');
  // **既定はドットをそろえるほう。** 切り下げるぶん画面は少し小さくなるが、
  // 1 ドットの大きさがまだらにならない。大きさが欲しい人は、
  // ボタンで切ってもらう(その判断は遊ぶ人のもの)
  mmsxx.vdp.pixelPerfect = true;
  mmsxx.vdp.refitCss();

  touchGui.attach();
  // **?areas=1 で受け場所を色分けして見せる。** 絵の外まで受けているので、
  // 見た目からは境目が分からない。効く / 効かないを追うときの最初の一手
  if (OPT.get('areas') === '1') touchGui.showAreas(true);
  // **開発版では、食われていると思っているところに目印を出す。**
  // 実機のノッチは本物が見えているので、**同じ側に出ているか**で
  // 左右を取り違えていないかが分かる(?safe=0 で消せる)
  if (DEV && OPT.get('safe') !== '0') touchGui.showSafeArea(true);
  // **丸の下の説明は出さない。**
  // 消えるのは一度こすったときだけなので、撃ちっぱなしの遊びでは
  // **触る理由が無いまま出っぱなし**になる(画面のすぐ隣に居座る)。
  // こすりかたは、遊びかたの案内(?)と、狙いどきに出る知らせが受け持つ
  touchGui.setPadLabels({ shotNote: '' });
  // 音の入切とシェアのボタンは、器の右の空きへ移す。
  // **器は画面ぜんぶを覆う**ので、外に置いたままでは指が届かない
  const toolsEl = document.getElementById('tools');
  if (toolsEl && touchGui.toolsSlot) touchGui.toolsSlot.appendChild(toolsEl);
  // **キーボードは右へ。** 左は十字の居場所。文字を打つのは
  // 裏技のときだけなので、遊びの手とは反対側でよい
  const kbd = document.getElementById('keyboard-btn');
  if (kbd && touchGui.toolsSlotRight) touchGui.toolsSlotRight.appendChild(kbd);
  // **遊びかたの ? もキーボードの隣へ。**
  // 左の列は道具(音・大きさ・写真)が並ぶところで、? はその仲間ではない。
  // どちらも「読む・打つ」ための口なので、右にまとめるほうが探しやすい
  const howto = document.getElementById('howto-btn');
  if (howto && touchGui.toolsSlotRight) touchGui.toolsSlotRight.appendChild(howto);
  // **DEV の印は器の外へ出す。** スマホの画面のつもりで見ているところに
  // 開発版の印が居ると、そのぶん置き場所を食うし、写真にも写る。
  // 窓の隅(画角の外)へ逃がす
  const devEl = document.getElementById('dev-badge');
  if (devEl) {
    document.body.appendChild(devEl);
    Object.assign(devEl.style, { position: 'fixed', left: '6px', top: '4px', zIndex: '20' });
  }
  // ボタンを移したぶん帯の中身が変わっているので、もう一度測る
  touchGui.layout();
  // ---- 開発用の口 ここから ----
  // 実機を繋いで中を覗くとき用(touch-tool の window.touch と同じ考えかた)
  mmsxx.expose('touchGui', touchGui);
  // ---- 開発用の口 ここまで ----
  // **十字を出すかどうかは遊びかたしだい**(ポーズ中の CONTROL)。
  // パッドレスでは絵と当たりが消えて指がうしろへ抜けるので、
  // canvas を直に叩けるようになる。連射の四角はどちらでも残る。
  // 当てるのは applyPadTargets(下の bindPadSenseButton から呼ぶ)
  if (DEVICE) showDeviceLinks();
  restoreZoom();
}
// **パッドレスの指を受ける。** 受けるのは canvas そのもの。
// 十字を切ってあるので器は素通しになっていて、ここまで上がってくる。
//
// **遊びの最中だけ**。メニューは器のジェスチャで動いているので、
// そちらへ横から口を出さない(ポーズ中も同じ)
if (PAD_ON) {
  setupPadless();
  traceMove = createTrace();
  bindPadlessTaps();
  // ---- 開発用の口 ここから ----
  // 実機を繋いで中を覗くとき用(touchGui と同じ考えかた)。
  // つまみもここから当てられる: padless.state / padless.marker / padless.heading
  mmsxx.expose('padless', padlessMove);
  mmsxx.expose('trace', traceMove);
  // ---- 開発用の口 ここまで ----
}

function bindPadlessTaps() {
  const canvas = document.getElementById('screen');
  if (!canvas) return;
  /** いま追いかけている指。**1 本だけ見る**(2 本目は捨てる) */
  let id = null;
  /** 遊びの最中か。ここ以外では指を受けない */
  // **画面を触って動かすあいだだけ受ける**(ポーズ中の CONTROL で切り替わる)
  const live = () => (padlessOn || traceOn) && canSteer();
  /** 画面の点を、自機の真ん中と同じものさしのドットへ */
  const at = (e) => mmsxx.vdp.pointToScreen(e.clientX, e.clientY);
  /** 自機の真ん中(スプライトは 16x16 なので +8) */
  const selfX = () => player.x + 8;
  const selfY = () => player.y + 8;

  canvas.addEventListener('pointerdown', (e) => {
    if (!live() || id !== null) return;
    const p = at(e);
    // **枠の外を叩いたら止まる**(仕様の 3.3)。行き先にはしない
    if (!p.inside) {
      if (traceOn) { traceMove.stop(); clearTracePath(); } else padlessMove.stop();
      return;
    }
    e.preventDefault();
    id = e.pointerId;
    try { canvas.setPointerCapture(id); } catch (err) { /* 捕まえられなくても続ける */ }
    const c = aimClamp(p.x, p.y);
    if (traceOn) {
      // **前の道は捨てて引き直す**(部品の down がそうする)。
      // 絵のほうも同じところで捨てる
      traceMove.down(c.x, c.y);
      paintTracePath();
    } else {
      padlessMove.down(c.x, c.y, selfX(), selfY());
    }
  });

  // **動きも window で拾う**(上の pointerup と同じ理由。
  // 捕まえ損ねても、指が枠から出ても、離すまで面倒を見る)
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const p = at(e);
    const c = aimClamp(p.x, p.y);
    if (traceOn) {
      // **均すのは部品の仕事。** ここは指の場所を渡すだけ
      traceMove.move(c.x, c.y);
    } else {
      padlessMove.move(c.x, c.y);
    }
  });

  const up = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    // 行き先はもう指の下に置いてあるので、離すだけでよい
    if (traceOn) traceMove.up(); else padlessMove.up();
  };
  // **離したことは window で拾う。** canvas だけで待っていると、
  // 捕まえ損ねたまま指が canvas の外(連射の四角やポーズの上)へ抜けて
  // 離されたときに来ない。**来ないと押している扱いのまま残り、
  // 印が指を追い続ける**(行き先が勝手に動いて見えるのはこれ)
  window.addEventListener('pointerup', up);
  canvas.addEventListener('lostpointercapture', up);
  // 着信やジェスチャで指が消えたぶん。**行き先はそのまま**、曲げるのだけやめる
  window.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== id) return;
    id = null;
    if (traceOn) traceMove.cancel(); else padlessMove.cancel();
  });
  // 長押しのメニュー(iOS の「コピー」など)を断る
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
// **PC でも要る。** 大きさもドットのそろえかたも、指で触る端末だけの話ではない。
// スマホ用の分岐の中に入れていたせいで、PC ではボタンが空のままだった
// **最初のひと触りで音を解禁する。**
//
// ブラウザは「人が触った」合図が 1 回ないと音を出さない。エンジンがそれを
// やっているのは keydown のときだけで、指で遊ぶ端末はその道を通らない。
//
// **払っただけでは数えてもらえない。** iOS が人の操作と数えるのは
// 押した / 離した の瞬間だけで、指を滑らせているあいだ(pointermove)は
// 数に入らない。メニューはスワイプで動かすので、キーが立つのを待っていると
// **どこかを一度 叩くまで音が出ないまま**になる(実機でそうなっていた)。
// だから押した瞬間そのもので通す。**何度呼んでも害は無い**
// (もう鳴らせる状態なら、エンジン側で素通りする)
for (const type of ['pointerdown', 'pointerup']) {
  window.addEventListener(type, () => mmsxx.audio.unlock(), { capture: true, passive: true });
}

// **二度たたきの拡大を潰す。**
//
// `touch-action` では止まらない(iOS の癖)。連射ボタンを何度か叩いただけで
// 画面が拡大してしまい、しかも縮めかたが分からない、という状態になっていた。
// **2 回目のタップの touchend を潰す**のが、いまのところ唯一 効く手
// (tools/touch-tool/ で先に確かめてある)。
//
// **ボタンや入力欄の上では潰さない。** 潰すと click が飛ばなくなって、
// 音の入切もシェアも押せなくなる。
//
// なお**指 3 本のタップで起きる拡大は OS のもの**(アクセシビリティのズーム)で、
// ページ側からは止められない。あちらはもう一度 3 本指で叩けば戻る
let lastTapAt = 0;
window.addEventListener('touchend', (e) => {
  if (e.target.closest && e.target.closest('button, input, textarea, summary, label, a')) return;
  const now = Date.now();
  if (now - lastTapAt <= 350) e.preventDefault();
  lastTapAt = now;
}, { passive: false });

bindZoomButtons();
setupOsShare();
// **ホームに勧める 1 枚はここでは呼ばない。** 中で見ている IS_STANDALONE は
// もっと下で作る const で、**const は巻き上がらない**(初期化前に触ると落ちる)。
// 呼ぶのはその節の終わり

/**
 * **画面の大きさを遊ぶ人が決める**(左上の ＋ / −)。
 * 空きの取りかたは自動で決めているが、好みや持ちかたで合わないことがある。
 *
 * **一度でも押されたら、こちらからは動かさない**(onNeedRoom を黙らせる)。
 * 自分で決めたものを勝手に戻されるのがいちばん困る
 */
/**
 * 大きさを当てる。**当てた時点で「遊ぶ人が決めた」印**を立てるので、
 * 以後こちらからは動かさない(自動縮小が黙る)
 */
function applyZoom(z) {
  zoomByUser = true;
  mmsxx.vdp.zoom = z;
  mmsxx.vdp.refitCss();
  if (touchGui) touchGui.layout();
}

/**
 * 前に決めた大きさがあれば、それで始める。
 * 決めていなければ、**指で遊ぶときだけ 1 段小さくしておく**。
 *
 * いっぱいまで広げると、**画面の広い機種(iPad)でボタンがほとんど隠れる** —
 * 画面が縦横いっぱいに育って、左右の帯が残らなくなるため。
 * 1 段落としても遊ぶには十分大きい。**自分で決めた印は立てない**ので、
 * 狭いところでは今までどおり自動でさらに縮む
 */
function restoreZoom() {
  if (!DEVICE && settings.get('zoomSet')) {
    const z = settings.get('zoom');
    if (typeof z === 'number' && z >= ZOOM_MIN && z <= ZOOM_MAX) { applyZoom(z); return; }
  }
  if (!PAD_ON) return;
  mmsxx.vdp.zoom = Math.max(ZOOM_MIN, ZOOM_MAX / ZOOM_STEP);
  mmsxx.vdp.refitCss();
  if (touchGui) touchGui.layout();
}

function bindZoomButtons() {
  const step = (mul) => {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, mmsxx.vdp.zoom * mul));
    if (Math.abs(z - mmsxx.vdp.zoom) < 0.001) return;
    applyZoom(z);
    updateZoomButtons();   // 端まで来たら、そのボタンを灰色にする
    // **決めたぶんは覚えておく。** 次に開いたときも同じ大きさで始まる。
    // ただし**確認モード(?device=)では覚えない**。機種を渡り歩くときに、
    // 前の機種で決めた大きさが次の機種へ持ち越されて話が分からなくなる
    if (DEVICE) return;
    settings.set('zoom', z);
    settings.set('zoomSet', true);
    settings.flush();
  };
  const bind = (id, mul) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => step(mul));
  };
  // **＋ / − は指で触る端末だけ。** PC は窓の大きさがそのまま画面の大きさなので、
  // 窓を変えれば済む。ボタンを出しても手が増えるだけ
  for (const id of ['zoom-in', 'zoom-out']) {
    const el = document.getElementById(id);
    if (el && !PAD_ON) el.style.display = 'none';
  }
  bind('zoom-in', ZOOM_STEP);
  bind('zoom-out', 1 / ZOOM_STEP);
  bindRotateButton();
  bindKeyboardButton();
  bindPadSenseButton();
  bindHowToButton();

  // **ドットをそろえるかどうか**。既定は「置けるだけ大きく」だが、
  // ドットのガタつきが気になる人のために、整数倍へ切り下げる道も残す
  const pf = document.getElementById('pixel-fit');
  if (pf) {
    pf.addEventListener('click', () => {
      mmsxx.vdp.pixelPerfect = !mmsxx.vdp.pixelPerfect;
      mmsxx.vdp.refitCss();
      if (touchGui) touchGui.layout();
      drawToolIcons();
      if (!DEVICE) {
        settings.set('pixelFit', mmsxx.vdp.pixelPerfect);
        settings.set('pixelFitSet', true);
        settings.flush();
      }
    });
    // **既定は入りなので、覚えるのは「切った」ほう**。
    // 印が無いかぎり触らない(切ったことがある人だけ、切ったまま始まる)
    if (!DEVICE && settings.get('pixelFitSet')) {
      mmsxx.vdp.pixelPerfect = !!settings.get('pixelFit');
      mmsxx.vdp.refitCss();
    }
  }
  drawToolIcons();
}

/**
 * **画面を 180 度回す。**
 *
 * 縦横の食い違いは engine/video.js が勝手に合わせているので、
 * 遊ぶ人に選ばせる意味があるのは「上下どちらを手前にするか」だけ。
 * 寝ころんで遊ぶときや、ホームバー・ノッチが指の側に来てしまうときに使う。
 *
 * **回すところが 4 つある**(canvas / 器 / 点 / 指の動き)ので、
 * 向きそのものはエンジンが 1 つだけ持ち(vdp.viewAngle)、
 * 器はそれを見て付いてくる。ここでするのは「裏返して測り直させる」だけ
 */
function turnScreen180() {
  mmsxx.vdp.upsideDown = !mmsxx.vdp.upsideDown;
  mmsxx.vdp.refitCss();
  if (touchGui) touchGui.layout();
  // シェアの板も画面の座標のまま置かれているので、開いていれば一緒に回す
  if (shareOpen) fitShareEl();
}

function bindRotateButton() {
  const el = document.getElementById('rotate-btn');
  if (el) el.addEventListener('click', () => { el.blur(); turnScreen180(); });
}

/** 段を当てる。**部品へ流して、覚えて、画面に出す** */
function applyPadSense(n, tell) {
  padSense = ((n % PAD_SENSE.length) + PAD_SENSE.length) % PAD_SENSE.length;
  const s = PAD_SENSE[padSense];
  if (touchGui) touchGui.touch.setOptions({ stickFullSpeed: s.full, stickMinSpeed: s.min });
  // **札の字は部品が書く**(engine/util/stepper.js)。戻すときは
  // createStepper({ label: 'PAD RESPONSE', items: PAD_SENSE.map(s => s.name) })
  // をもう 1 つ作って、その onChange からここを呼ぶこと
  // 押したときは画面にも出す(ポーズ中なので弾の邪魔にもならない)
  if (tell) showNotice('PAD: ' + s.name);
  if (DEVICE) return;
  settings.set('padSense', padSense);
  settings.set('padSenseSet', true);
  settings.flush();
}

/**
 * **ポーズ中に出すつまみ。** 2 つ並ぶ。
 *
 *   CONTROL  … どうやって動かすか(PAD_TARGETS)
 *   PAD FEEL … 十字の効きぐあい(PAD_FEEL)。**十字のときだけ出す**
 */
function bindPadSenseButton() {
  // **PC には要らない。** 十字が出ないので効きようがない
  if (!PAD_ON) return;
  const tools = document.getElementById('tools');
  if (!tools) return;
  // **並びは 3 つ。** いちばん上が「どうやって動かすか」(PAD_TARGETS)で、
  // その下の 2 つは**十字の効きぐあい**。
  //
  // **下の 2 つは十字を選んでいるときだけ出す。** 効かないつまみが
  // 並んでいると、押しても変わらないものを探すことになる
  // (PAD RESPONSE で懲りた)。出し入れは applyPadTargets が受け持つ
  /**
   * **行を折るための当て板。**
   *
   * `#tools` は横並びの折り返し(flex-wrap)なので、そのまま足すと
   * **絵のボタンの続き**として同じ行に並ぶ。高さ 0 で幅いっぱいのものを
   * 先に入れておくと、そこで行が折れて、この下は**絵の無い行**になる
   */
  const br = document.createElement('div');
  br.style.cssText = 'flex-basis:100%;height:0;margin:0';
  tools.appendChild(br);
  padTargetsUI = createStepper({
    mount: tools,
    label: 'CONTROL',
    items: PAD_TARGETS.map(s => s.name),
    index: startPadTargets(),
    // **端まで行ったら回り込む。** 数が少ないので、端で止まると
    // 逆の端へ行くのに何度も押すことになる(実機で言われたぶん)
    wrap: true,
    onChange: (i, name, byUser) => applyPadTargets(i, byUser),
  });
  // **絵のボタンの列から少し離す。** 合間に割り込むと、ポーズのたびに
  // 上のボタンが押し下がって場所を覚えられない
  // **絵のボタンの列から 1 行ぶん空ける。**
  // すぐ下に付けていたころは、絵の並びの続きに見えて
  // ポーズのたびに上のボタンが押し下がり、場所を覚えられなかった。
  // 空き行を 1 つ挟めば、**別のものだと見て取れる**
  // (ボタンは 32px、間は 4px。合わせて 1 行ぶん)
  padTargetsUI.el.style.marginTop = '40px';

  // ---- 十字の効きぐあい。**十字のときだけ出す** ----
  //
  // 実機で困っていたのは 2 つ ── **すぐ裏返る**のと、
  // **その場に留まってくれない**。つまみもその 2 つに合わせてある。
  // 曲線(CURVE)は、そのあいだの速さの割りふり
  padFeelUI = createStepper({
    mount: tools,
    label: 'PAD FEEL',
    items: PAD_FEEL.map(s => s.name),
    index: startPadStep('feel', PAD_FEEL, padFeel),
    wrap: true,
    onChange: (i, name, byUser) => applyPadFeel(i, byUser),
  });
  // **CONTROL のすぐ下に詰めて置く。** 2 つで 1 かたまり(動かしかたの設定)
  padFeelUI.el.style.marginTop = '8px';
  

  // 部品は作った時点では onChange を呼ばない(**当てるのは借りる側の仕事**)
  applyPadFeel(padFeelUI.index, false);
  applyPadTargets(padTargetsUI.index, false);
}

/**
 * どの段から始めるか。**?pad<名前>= → 前に決めた段 → 既定** の順に見る。
 * URL からは段の名前でも番号でも渡せる(`?padcurve=SOFT` / `?padcurve=1`)
 */
function startPadStep(key, table, fallback) {
  const raw = (OPT.get('pad' + key) || '').toUpperCase();
  if (raw) {
    const at = table.findIndex(s => s.name === raw);
    if (at >= 0) return at;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n < table.length) return n;
  }
  if (!DEVICE && settings.get('pad' + key + 'Set')) return settings.get('pad' + key);
  return fallback;
}

/**
 * 効きぐあいを当てる。**部品へ流して、覚えて、画面に出す**。
 * 中身は 5 つのつまみをまとめて動かす(上の PAD_FEEL)
 */
function applyPadFeel(n, tell) {
  padFeel = Math.max(0, Math.min(PAD_FEEL.length - 1, n));
  const s = PAD_FEEL[padFeel];
  if (touchGui) {
    touchGui.touch.setOptions({
      deadzone: s.dead, stickHome: s.home, stickCurve: s.curve,
      stickFlipAngle: s.angle, stickFlipMove: s.move,
    });
  }
  // **札の字は部品が書く**(engine/util/stepper.js)。ここでは中身だけ当てる。
  // 押したときは画面にも出す(ポーズ中なので弾の邪魔にもならない)
  if (tell) showNotice('PAD FEEL: ' + s.name);
  if (DEVICE) return;
  settings.set('padfeel', padFeel);
  settings.set('padfeelSet', true);
  settings.flush();
}

/** 行き先の数を当てる。**部品へ流して、覚えて、画面に出す** */
function applyPadTargets(n, tell) {
  padTargets = Math.max(0, Math.min(PAD_TARGETS.length - 1, n));
  const s = PAD_TARGETS[padTargets];
  padlessOn = s.points > 0;
  traceOn = !!s.draw;
  if (padlessMove) {
    if (padlessOn) padlessMove.maxPoints = s.points;
    // **ほかの動かしかたへ移るときは置いたぶんを消す。**
    // 残すと、十字で動かしているのに赤い十字が残って、
    // 自機がそちらへ勝手に向かう
    else padlessMove.stop();
  }
  // 道も同じ。**残すと、なぞる番でもないのに線が居座る**
  if (traceMove && !traceOn) { traceMove.stop(); clearTracePath(); }
  if (touchGui) {
    // 十字はパッドのときだけ出す(画面を触って動かすときは絵も当たりも消して、
    // canvas を直に受けられるようにする)
    const onCanvas = padlessOn || traceOn;
    touchGui.touch.dpadOn = !onCanvas;
    // 連射の受け場所を画面から外すのも、画面を触って動かすときだけ
    touchGui.setOptions({ shotHitOffCanvas: onCanvas });
  }
  // **効きぐあいのつまみは十字のときだけ。**
  // 叩いて動かす遊びかたでは 1 つも効かないので、出すと
  // 「押しても変わらないつまみ」を探させることになる
  const padOn = !padlessOn && !traceOn;
  if (padFeelUI) padFeelUI.el.style.display = (padOn && paused) ? 'block' : 'none';
  // **canvas で指を受けるときだけ、ブラウザのジェスチャを止める**(index.html)。
  // 十字のときに止めると、画面の上でつまんで拡大できなくなる
  document.body.classList.toggle('touch-canvas', !padOn);
  if (tell) showNotice('CONTROL: ' + s.name);
  if (DEVICE) return;
  settings.set('padTargets', padTargets);
  settings.set('padTargetsSet', true);
  settings.flush();
}

/**
 * どの段から始めるか。**?targets= / ?stick= → 前に決めた段 → 既定** の順に見る。
 * `?stick=` にパッドレス以外(origin / move)が入っていたら、パッドから始める
 */
function startPadTargets() {
  const raw = (OPT.get('targets') || '').toUpperCase();
  // **十字の番号は名前で引く。** 一覧に足すたびに番号が動くので、
  // 「いちばん後ろが十字」と数えると、後ろへ足した瞬間に別のものになる
  const padAt = PAD_TARGETS.findIndex(s => s.name === 'V-PAD');
  if (raw === 'PAD' || raw === 'V-PAD') return padAt;
  // **短い書きかたも受ける。** 番号ではなく名前で引く(並びが変わっても効く)
  const byName = (n) => PAD_TARGETS.findIndex(s => s.name === n);
  if (raw === '1') return byName('TGT1');
  if (raw === '2') return byName('TGT2');
  const at = PAD_TARGETS.findIndex(s => s.name === raw);
  if (at >= 0) return at;
  const stick = OPT.get('stick');
  if (stick && stick !== 'padless') return padAt;
  if (!DEVICE && settings.get('padTargetsSet')) return settings.get('padTargets');
  return padTargets;
}

/**
 * つまみのボタンも**ポーズ中だけ**。
 * 遊んでいる最中に触るものではないし、そのぶん十字の場所を食う
 */
function showPadSenseButton() {
  if (!padTargetsUI) return;
  const on = paused;
  if (padSenseShown === on) return;
  padSenseShown = on;
  padTargetsUI.show(on);
  // **効きぐあいのつまみは、さらに十字のときだけ**(applyPadTargets と同じ条件)。
  // ポーズを抜けたら 3 つとも引っ込める
  const padOn = !padlessOn && !traceOn;
  if (padFeelUI) {
    padFeelUI.show(on && padOn);
    padFeelUI.el.style.display = (on && padOn) ? 'block' : 'none';
  }
}

/**
 * **ポーズ中とタイトルで出す。**
 *
 * 持ちかたを決めるのは遊びはじめる前なので、**タイトルにも要る**
 * (ポーズまで来ないと回せないのでは、最初のひと勝負を遠回りして遊ぶことになる)。
 * 遊んでいる最中は出さない。弾を避けている最中に触るものではないし、
 * そのぶん十字の場所を食う
 */
function showRotateButton() {
  const el = document.getElementById('rotate-btn');
  if (!el) return;
  const on = paused || state === 'title';
  if (rotateShown === on) return;
  rotateShown = on;
  el.style.display = on ? '' : 'none';
}

/**
 * 借りているボタンの絵を、**画面のスプライトと同じ並び**から作って貼る
 * (engine/util/icons.js)。絵文字や SVG で描くと、canvas の中と外で
 * 字形が食い違う
 */
function drawToolIcons() {
  const put = (id, rows, accent) => {
    const el = document.getElementById(id);
    if (!el || !rows) return;
    try {
      el.style.backgroundImage =
        `url("${iconDataURL(mmsxx, rows, { body: ICON_BODY, accent, scale: 2, key: id })}")`;
      el.textContent = '';
    } catch (e) { /* 絵が作れない環境では文字のまま */ }
  };
  put('zoom-in', ICONS.zoomIn, 10);      // 明るい緑。増やすほう
  put('zoom-out', ICONS.zoomOut, 8);     // 赤。減らすほう
  // **カメラ。** あの窓は X への投稿だけでなくダウンロードもできるので、
  // 外のボタンで行き先を名乗らない。することは「画面を撮る」
  put('share-btn', ICONS.camera, 7);
  put('os-share', ICONS.share, 7);
  // **横長のボタンには横長の絵。** 16x16 を引き伸ばすとキーが長方形になって崩れる
  put('keyboard-btn', ICONS.keyboardWide, 7);
  put('rotate-btn', ICONS.rotate180, 7);
  put('howto-btn', ICONS.help, 7);
  // 段を選ぶボタンは字のボタン(絵は入れない)。engine/util/stepper.js が書く
  // **切り替えのボタンは中の絵だけで状態を出す。**(枠は白いまま。いつでも押せる)
  // 効いていないときは差し色も灰色にして、絵ごとモノクロにする
  put('pixel-fit', ICONS.pixelFit, mmsxx.vdp.pixelPerfect ? 7 : ICON_MONO);
  updateZoomButtons();
}

/**
 * **シェアの板で選んでいるコマ**(原寸)。板が閉じていれば null。
 *
 * 板は溜めてあるコマを左右で選べる。**選んだものが送信の絵になる**
 * のと同じように、OS へ渡す絵も選んだものでなければならない
 */
function shareSourceCanvas() {
  if (!shareOpen) return null;
  if (shareBack >= 0) return mmsxx.frameBackCanvas(shareBack, 1);
  return (shareBack === SHARE_EXTRA ? shareExtra : shareFixed) || null;
}

/**
 * **画面を PNG にする**(3 倍のドットのまま)。
 * クリップボードへ貼るのも OS へ渡すのも、元はこれ 1 つ。
 *
 * **シェアの板が開いていれば、そこで選んでいるコマ**を撮る。
 * いつも「いまの画面」を撮っていたので、**左右で選んだコマが
 * 入っていなかった**(板には選んだ絵が出ているのに、保存されるのは
 * その裏で動いている今の画面だった)
 */
function screenshotBlob() {
  const canvas = shareSourceCanvas() || mmsxx.capture({ type: 'canvas' });
  const out = document.createElement('canvas');
  out.width = canvas.width * 3;
  out.height = canvas.height * 3;
  const cx = out.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.drawImage(canvas, 0, 0, out.width, out.height);
  return new Promise((res) => out.toBlob(res, 'image/png'));
}

/**
 * **いまの画面を OS の共有シートへ渡す**(「写真に保存」も「送る」もその先で選ぶ)。
 *
 * 入口は 2 つ。**PC は表のボタン**(#os-share)、**スマホはシェアの板の中**
 * (X の隣)。どちらから来ても同じことをする
 */
async function osShareImage() {
  // **渡せない環境では何もしない。** PC ではボタンを出しっぱなしにしてあるので
  // (見た目を手元で確かめるため)、ここへ来ることがある。
  // 先に返さないと、渡せないのにゲームだけ止まってしまう
  if (!navigator.share) return;
  // **絵を取ったら、そのまま止める。** 共有シートが開いているあいだも
  // ゲームは走り続けるので、実機では戻ってきたときにやられていた。
  // 撮ったのは押した瞬間の絵なので、止めても写るものは変わらない
  const wasPaused = paused;
  try {
    const blob = await screenshotBlob();
    if (!blob) return;
    if (!wasPaused && state === 'play') togglePause();
    await navigator.share({
      files: [new File([blob], 'star-fable.png', { type: 'image/png' })],
      title: 'STAR FABLE',
    });
  } catch (e) { /* 取り消されただけのことが多い。何も知らせない */ }
}

/**
 * **OS へ画像を渡す口を用意する**(箱から矢印)。
 *
 * **出せるかどうかは環境の名前で決めない。** 実際に PNG を 1 枚作って
 * `canShare({files})` に聞く。これなら Windows / Mac / スマホの別も、
 * ブラウザの別(Firefox には無い)も、こちらが表を持たずに済む。
 * 聞けるのは**ファイルを 1 つ用意してから**なので、起動時に 1 回だけ試す。
 *
 * **どこへ出すかは端末で分ける。**
 *   PC     … 今までどおり表のボタン(#os-share)
 *   スマホ … 表には出さず、**カメラを押して開く板の中**(X の隣)。
 *            遊んでいる最中の画面からボタンが 1 つ減るし、
 *            「撮ってから行き先を選ぶ」という順のほうが迷わない
 */
async function setupOsShare() {
  const btn = document.getElementById('os-share');
  if (!btn || !navigator.share || !navigator.canShare) return;
  try {
    const blob = await screenshotBlob();
    if (!blob) return;
    if (!navigator.canShare({ files: [new File([blob], 'star-fable.png', { type: 'image/png' })] })) {
      return;   // 渡せない環境
    }
  } catch (e) { return; }
  osShareOK = true;
  if (PAD_ON) {
    // スマホ。表のボタンは出さないまま、板の中のぶんに絵を入れておく
    updateShareOsBtn();
    return;
  }
  btn.style.display = '';
  drawToolIcons();
  btn.addEventListener('click', () => { btn.blur(); osShareImage(); });
}

/**
 * 板の中の「OS へ渡す」ボタンを出す / 隠す。**スマホなら いつでも出す**。
 *
 * 出すのは**渡せる環境**か、**手元で機種を真似ているとき**。
 * あとのほうは、PC の localhost に ?device= を付けて見えかたを確かめる場面のこと。
 * PC のブラウザは画像を渡せないことが多く、そこだけボタンが消えていては
 * 並びが確かめられない。**押しても何も起きないだけ**(osShareImage が先に返る)。
 * 絵は借りているボタンと同じ並びから作る(engine/util/icons.js)
 */
function updateShareOsBtn() {
  if (!shareOsBtn) return;
  const on = PAD_ON && (osShareOK || (RECORD_HOST && !!DEVICE));
  shareOsBtn.style.display = on ? '' : 'none';
  const mark = shareOsBtn.firstElementChild;
  // 絵を入れるのは 1 度だけ。**入れたかどうかは印で持つ**
  // (background-image を見ると、敷いていなくても 'none' が返って入っていることになる)
  if (!on || !mark || mark.dataset.ready) return;
  try {
    mark.style.backgroundImage =
      `url("${iconDataURL(mmsxx, ICONS.share, { body: ICON_BODY, accent: 7, scale: 2, key: 'share-os' })}")`;
    mark.dataset.ready = '1';
  } catch (e) { shareOsBtn.textContent = 'SHARE'; }
}

// ---- ホーム画面に置いてもらう ----
//
// **ホームのアイコンから開くと、アドレスバーとタブが消えて画面が広くなる。**
// 縦に 100px 以上 空くので、ゲーム画面が 1 段階 大きくなる。勧める理由はそこ。
//
// ## 出すのは「ふつうに web で開いたスマホ」だけ
//
// すでにホームから開いている人には用が無いし、PC にも要らない。
//
// ## Android と iOS で道が違う
//
//   Android … `beforeinstallprompt` を捕まえておいて、ボタンから prompt() を呼ぶ。
//             **押されたその場で呼ぶこと**(あとから呼ぶと効かない)
//   iOS     … サイト側から登録画面は開けない。**やりかたを書いて見せるだけ**
//
// ## ボタンは「来てから」生やす
//
// **`beforeinstallprompt` は開いた直後には飛んでこない。**
// Chrome は「1 回は触った」「30 秒ほど見た」あたりを満たすまで出さないので、
// 初回に出す 1 枚の中では、まだ来ていないのがふつう。
// なので**やりかたの説明を常設にして、イベントが来たらボタンが増える**形にする。
// どのみち iOS でも Firefox でも すでに入っていても来ないので、
// 「来ていない場合」の道は必ず要る。

/** ホーム画面のアイコンから開いているか(そのときは勧めない) */
const IS_STANDALONE = (() => {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch (e) { /* 古い環境では見ない */ }
  return window.navigator.standalone === true;   // iOS はこちら
})();
/** 捕まえた `beforeinstallprompt`。**押されるまで持っておく** */
let installPrompt = null;
/** 出している板 */
let a2hsEl = null;

/**
 * **ホームに置くことを勧める 1 枚。** 初回に 1 度だけ。
 * 断られたら覚えて、二度と出さない(勧誘は 1 回で十分)
 */
function setupHomeInstall() {
  // **イベントの受けは、板を出すかどうかと別に必ず付ける。**
  // 30 秒ほど遊んだあとに飛んでくるので、そのとき板が出ていれば
  // ボタンを生やす。出ていなければ、次に出したときに使う
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // ブラウザが勝手に出すバーは止める
    installPrompt = e;
    showInstallButton();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    closeHomeInstall();
  });
  // **?a2hs=off は出さない。** 手元では毎回出るようにしてあるので、
  // 写真を撮るとき(npm run uishot)に必ずかぶってしまう
  if (A2HS_LOOK === 'off') return;
  // 出すのは**ふつうに web で開いたスマホ**だけ。
  // **断られても覚えない。** 開くたびに出す。
  // 置いてもらえたら standalone になって、そこで自然に出なくなる
  // (「もう勧めるな」と言われる前に、勧める理由のほうが消える)
  if (IS_STANDALONE || !PAD_ON) return;
  openHomeInstall();
}

/**
 * **見えかたを決め打ちにする口**(`?a2hs=`)。**手元で 3 通りを見比べるため**。
 *
 *   ?a2hs=off     … 出さない(写真を撮るとき。手元では毎回出るのでかぶる)
 *   ?a2hs=1       … 覚えたぶんを飛ばして、いつもどおりの見えかたで出す
 *   ?a2hs=ios     … iOS の見えかた(共有ボタンの絵入りの説明)
 *   ?a2hs=android … Android の、**まだ合図が来ていない**見えかた(説明だけ)
 *   ?a2hs=add     … Android の、**合図が来たあと**の見えかた(登録ボタンが出る)
 *
 * `add` の登録ボタンは**本物の合図が無ければ何もしない**(閉じるだけ)。
 * PC の Chrome には合図が飛んでこないので、並びを見るためだけのもの
 */
const A2HS_LOOK = OPT.get('a2hs') || '';

/** iOS(Safari)か。**やりかたの説明を出す相手** */
function isIOS() {
  if (A2HS_LOOK === 'ios') return true;
  if (A2HS_LOOK === 'android' || A2HS_LOOK === 'add') return false;
  try {
    return Bowser.parse(navigator.userAgent).os.name === 'iOS';
  } catch (e) { return false; }
}

const A2HS_TEXT = {
  title: { ja: 'ホーム画面に追加すると', en: 'ADD TO HOME SCREEN' },
  why: {
    ja: 'アドレスバーとタブが消えて、ゲーム画面が大きくなります。',
    en: 'The address bar and tabs go away, so the game gets bigger.',
  },
  // **iOS は絵で言う。** 共有ボタンは端末の向きで場所が変わるので、
  // 「下の」「右上の」とは書かない(横持ちだと嘘になる)。
  // **探すものは絵で見せる**(前後の文のあいだに挟む)。
  // 「□に↑」と字で言うより、同じ形が出ているほうが早い
  ios: {
    ja: ['共有ボタン ', ' を押して、「ホーム画面に追加」を選んでください。'],
    en: ['Tap the Share button ', ' and pick "Add to Home Screen".'],
  },
  // Android。**イベントが来るまでの あいだだけ**出す(来たらボタンに替わる)
  other: {
    ja: 'ブラウザのメニューから「アプリをインストール」を選んでください。',
    en: 'Open the browser menu and pick "Install app".',
  },
  // **合図はすぐには来ない。** Chrome は「1 回は触った」あたりを満たすまで
  // `beforeinstallprompt` を出さないので、開いた直後はボタンが無い。
  // **待てば出る**ことを言っておかないと、メニューを探しに行かせてしまう
  // (iOS には来ないので、あちらでは出さない)
  tapFirst: {
    ja: '画面を一度タップすると、ここに追加ボタンが出ます。',
    en: 'Tap the screen once and an ADD button appears here.',
  },
  add: { ja: 'ホームに追加', en: 'ADD' },
  later: { ja: 'このまま遊ぶ', en: 'PLAY HERE' },
  // **まだ作りかけだと先に断っておく。** 遊びはじめてから使いにくさに
  // ぶつかるより、置く前に分かっているほうがよい
  // **「使いづらい」とまでは言わなくなった。** 一通り触れる形になったので、
  // 断るのは まだ動いている最中だということだけでよい
  wip: {
    ja: '※スマホ版のインターフェースはまだ調整中です。',
    en: '* The phone controls are still being tuned.',
  },
};

/** その人の言葉で 1 つ取り出す */
function a2hsText(key) {
  const v = A2HS_TEXT[key];
  return (TG_LANG === 'ja' ? v.ja : v.en) || v.en;
}

/**
 * **iOS の共有ボタンの絵**(箱から矢が上へ)。文の中へ挟んで使う。
 * 絵は借りているボタンと同じ並びから作るので、画面の中の絵と顔がそろう
 */
function shareGlyph() {
  const el = document.createElement('span');
  // **字と同じ高さ**にして、文のあいだに座らせる
  el.style.cssText = 'display:inline-block;width:1.4em;height:1.4em;'
    + 'vertical-align:-0.35em;background-repeat:no-repeat;'
    + 'background-position:center;background-size:contain;image-rendering:pixelated';
  try {
    el.style.backgroundImage =
      `url("${iconDataURL(mmsxx, ICONS.share, { body: ICON_BODY, accent: 7, scale: 2, key: 'a2hs-share' })}")`;
  } catch (e) { el.textContent = '[↑]'; }   // 絵が作れない環境では字で
  return el;
}

function openHomeInstall() {
  if (a2hsEl) return;
  const el = document.createElement('div');
  el.id = 'a2hs';
  Object.assign(el.style, {
    position: 'fixed', inset: '0', zIndex: '9997', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.78)',
  });
  const box = document.createElement('div');
  Object.assign(box.style, {
    font: 'clamp(14px, var(--mmsxx-gui-font-size, 16px), 24px) var(--mmsxx-gui-font, monospace)',
    color: '#e8e8e8', textAlign: 'center', lineHeight: '1.5',
    background: '#101010', border: '2px solid #cccccc',
    padding: '16px 18px', maxWidth: '88vw', maxHeight: '92vh',
    boxSizing: 'border-box', overflowY: 'auto',
  });
  const line = (text, css) => {
    const d = document.createElement('div');
    d.textContent = text;
    if (css) Object.assign(d.style, css);
    box.appendChild(d);
    return d;
  };
  // アイコンを見せる。**これがホームに並ぶ**、が一目で分かる
  const icon = document.createElement('img');
  icon.src = '/icons/icon-192.png';
  icon.alt = '';
  Object.assign(icon.style, {
    width: '64px', height: '64px', imageRendering: 'pixelated',
    display: 'block', margin: '0 auto 10px',
  });
  box.appendChild(icon);
  line(a2hsText('title'), { color: '#ffe000', marginBottom: '6px' });
  line(a2hsText('why'), { color: '#bbbbcc', marginBottom: '12px' });
  // iOS は自分で登録できないので、やりかたを常設で出す。
  // Android も**イベントが来るまではこちら**(来たら下のボタンが増える)
  const how = line('', { color: '#bbbbcc', marginBottom: '12px' });
  how.id = 'a2hs-how';
  if (isIOS()) {
    // 探してもらうものを**そのままの形で**挟む。絵はエンジンの持ちもの
    // (engine/util/icons.js)なので、画面の中の絵と顔がそろう
    const [head, tail] = A2HS_TEXT.ios[TG_LANG === 'ja' ? 'ja' : 'en'];
    how.append(head, shareGlyph(), tail);
  } else {
    how.textContent = a2hsText('other');
    // **待てばボタンが出る**ことを添える。
    // 出たら要らなくなるので、そのときに消す(showInstallButton)
    const tip = line(a2hsText('tapFirst'), { color: '#bbbbcc', marginBottom: '12px' });
    tip.id = 'a2hs-tap';
  }
  // **赤で断り書き。** スマホの操作まわりはまだ詰めている最中なので、
  // ホームへ置いてもらう前にそれと分かるようにしておく
  line(a2hsText('wip'), { color: '#ff5a5a', marginBottom: '12px' });

  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', gap: '10px', justifyContent: 'center',
    alignItems: 'center', flexWrap: 'wrap', marginTop: '4px',
  });
  // **Android の登録ボタン。** イベントが来るまでは出さない
  const add = document.createElement('button');
  add.type = 'button';
  add.id = 'a2hs-add';
  add.textContent = a2hsText('add');
  Object.assign(add.style, {
    font: 'inherit', color: '#111122', background: '#ffe000',
    border: '2px solid #ffe000', padding: '10px 20px', cursor: 'pointer',
    display: 'none',
  });
  add.addEventListener('click', async () => {
    // 合図が無いのに出ているのは ?a2hs=add のときだけ。閉じるだけにする
    if (!installPrompt) { closeHomeInstall(); return; }
    const p = installPrompt;
    installPrompt = null;                 // 1 つの合図は 1 回しか使えない
    try { await p.prompt(); } catch (e) { /* 断られただけ */ }
    closeHomeInstall();
  });
  // **このまま遊ぶは目立たせない。** 枠だけの控えめなボタン
  const later = document.createElement('button');
  later.type = 'button';
  later.textContent = a2hsText('later');
  Object.assign(later.style, {
    font: 'inherit', color: '#9a9aa8', background: 'transparent',
    border: '2px solid #55556a', padding: '10px 16px', cursor: 'pointer',
  });
  later.addEventListener('click', () => closeHomeInstall());
  row.append(add, later);
  box.appendChild(row);

  // **裏で人かどうかを見ている件は、ここで断っておく。**
  // 記録を送るときに Turnstile を通すので、その表記の置き場所がこの 1 枚
  // (スマホでは canvas の下の文字を消しているため、ほかに出す場所が無い)
  const note = document.createElement('div');
  Object.assign(note.style, { marginTop: '14px', fontSize: '0.72em', color: '#7a7a88' });
  note.innerHTML = 'Protected by Cloudflare Turnstile — '
    + '<a href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank"'
    + ' rel="noopener" style="color:#8fa2d8">Privacy Addendum</a>';
  box.appendChild(note);

  el.appendChild(box);
  document.body.appendChild(el);
  a2hsEl = el;
  fitOverlayEl(el);
  showInstallButton();
}

/** イベントが来ていればボタンを生やす。**来ていなければ説明だけのまま** */
function showInstallButton() {
  const add = a2hsEl && a2hsEl.querySelector('#a2hs-add');
  if (!add) return;
  // ?a2hs=add のときは、合図が無くても出す(手元で並びを見るため)
  const on = !!installPrompt || A2HS_LOOK === 'add';
  add.style.display = on ? '' : 'none';
  // ボタンが出たら、やりかたの説明はもう要らない(押せば済むので)。
  // 「一度タップすれば出る」の 1 行も、出たあとは用が済んでいる
  for (const id of ['#a2hs-how', '#a2hs-tap']) {
    const el = a2hsEl.querySelector(id);
    if (el) el.style.display = on ? 'none' : '';
  }
}

/** 板をしまう。**断られたことは覚えない**(次に開いたらまた出す) */
function closeHomeInstall() {
  if (!a2hsEl) return;
  a2hsEl.remove();
  a2hsEl = null;
}

// ---- 遊びかたの案内 ----
//
// **スマホだけ。** PC は画面の下に操作の一覧が出ているし、
// 触りかたも見て分かる。指で遊ぶときだけ、先に読んでもらう。
//
// **初めて遊びはじめるときに 1 度**出して、そのあとはポーズ中の ? から
// いつでも読み直せる。読み終わるまでゲームは止めておく
// (読んでいるあいだにやられていた、では案内の意味が無い)。
//
// 中身はこれから決める。**いまは 3 ページの下書き**が入っている。

/**
 * 案内のページ。**ここだけ日英を出し分ける**(canvas の中は英語のまま。
 * これは DOM なので、読んでほしいことは読める言葉で出す)。
 *
 * **遊びかたごとに 2 とおりある。** 十字で動かす人にターゲットの話をしても、
 * 画面をタップしても何も起きないので嘘になる。逆も同じ。
 * どちらを出すかは `howToPages()` が、そのとき効いているほうで決める
 * (`?targets=` などで既定が入れ替わっても、読むものは合っている)。
 *
 * こちらは**ターゲット型**(画面をタップして動かす)のぶん
 */
const HOWTO_PAGES_AIM = [
  {
    title: { ja: 'うごかす', en: 'MOVE' },
    body: {
      // **置いてある十字をつかめることは書かない。**
      // 使えると強いが、知らなくても遊べる。最初に読ませるものへ
      // 全部を並べると、肝心の「タップで動く」がぼやける
      // **ここで「ターゲット」という呼び名を出しておく。**
      // 3 ページ目の「ターゲットの数」と、ポーズ中のつまみ(TARGETS)に
      // 名前がつながる(赤い十字とターゲットが別ものに見えていた)
      ja: '画面をタップすると、赤い十字（ターゲット）が置かれ、\n'
        + 'そこへ自機が動きます。\n'
        + '押さえたまま指をずらすと、\n'
        + '行き先も付いてきます。',
      en: 'Tap the screen to drop a red cross (TARGET).\n'
        + 'Your ship flies to it.\n'
        + 'Hold and drag to bring\n'
        + 'the target with you.',
    },
  },
  {
    title: { ja: 'うつ', en: 'SHOOT' },
    body: {
      ja: '弾は自動で出ます。\n'
        + '丸いボタンをこすると はやく撃てます。\n'
        + 'ボスはこれで攻略しよう。',
      en: 'You fire automatically.\n'
        + 'Rub the round button to fire faster.\n'
        + 'That is how you take down a boss.',
    },
  },
  {
    title: { ja: 'めぐる', en: 'TOUR' },
    body: {
      ja: 'ターゲットの数をふやすと、\n'
        + '自機が順番にめぐるようになります。\n'
        + 'さきまわりの操作ができるので、\n'
        + '慣れたらやってみよう。\n'
        + '数はポーズ中、CONTROL で選べます。',
      en: 'Raise the number of targets and your ship\n'
        + 'visits them in order.\n'
        + 'It lets you plan a move ahead,\n'
        + 'so try it once you are used to the game.\n'
        + 'Pick the number with CONTROL while paused.',
    },
  },
  {
    title: { ja: 'その他のそうさ', en: 'OTHER CONTROLS' },
    body: {
      ja: 'ゲームパッドも使えます。\n'
        + 'タイトルでボタンを押して、\n'
        + '出てくる案内にしたがってください。\n'
        + '\n'
        + '他の操作方法も追加されてる事があるよ！',
      en: 'A game pad works too.\n'
        + 'Press a button on the title screen\n'
        + 'and follow what it says.\n'
        + '\n'
        + 'More ways to play may have been added!',
    },
  },
  {
    // **締めの 1 枚。** 遊びかたの話はここまでで、最後はこの板そのものの
    // 話だけを 1 行置く。**本文は置かない** — 黄色い 1 行だけを見せたいので、
    // ほかに字があるとそちらへ目が行く
    title: null,
    body: { ja: '', en: '' },
    // **締めの 1 行**。本文とは色を分ける(遊びかたではなく、この板の話なので)
    note: {
      ja: 'この案内は ? でいつでも出せます。',
      en: 'Press ? any time to read this again.',
    },
  },
];

/**
 * **十字(バーチャルパッド)で動かすぶん**の案内。
 *
 * 2 枚目(うつ)と 4 枚目(そのほか)は上と同じ話なので、そのまま借りる。
 * 違うのは 1 枚目(動かしかた)と 3 枚目(もう片方の遊びかたの案内)だけ
 */
const HOWTO_PAGES_PAD = [
  {
    title: { ja: 'うごかす', en: 'MOVE' },
    body: {
      // **「触れたところに出る」を最初に書く。** 決まった場所を探しに
      // いかなくてよいことが分かっていないと、いちいち目で探すことになる
      ja: '画面の左がわを指でおさえると、\n'
        + 'おさえたところにパッドが出ます。\n'
        + 'そのまま指をずらすと、\n'
        + 'ずらした向きへ自機が動きます。',
      en: 'Press the left side of the screen and\n'
        + 'a pad appears right where you pressed.\n'
        + 'Slide from there and your ship\n'
        + 'flies the way you slide.',
    },
  },
  HOWTO_PAGES_AIM[1],
  {
    title: { ja: 'ターゲット', en: 'TARGETS' },
    body: {
      ja: '画面をタップして動かす方法もあります。\n'
        + '赤い十字（ターゲット）を置くと、\n'
        + 'そこへ自機が動きます。\n'
        + '画面の広いタブレット向けです。\n'
        + 'ポーズ中、CONTROL で切り替えられます。',
      en: 'You can also fly by tapping the screen.\n'
        + 'Drop a red cross (TARGET) and\n'
        + 'your ship flies to it.\n'
        + 'It suits the wider screen of a tablet.\n'
        + 'Switch with CONTROL while paused.',
    },
  },
  HOWTO_PAGES_AIM[3],
  HOWTO_PAGES_AIM[4],
];

/**
 * いま出す案内。**いつも十字(V-PAD)のぶん**を出す。
 *
 * 遊びかたごとに出し分ける作りにしてあったが、**初めての人が読むのは
 * 既定の遊びかたの話**でよい(ほかは 4 枚目の「他の操作方法も
 * 追加されてる事があるよ！」と、ポーズ中の CONTROL が受け持つ)。
 *
 * **行き先を置くほう(HOWTO_PAGES_AIM)は残してある。**
 * そちらを既定に戻すことがあるので、そのときは下の 2 つを
 * `(padlessOn || traceOn) ? …AIM : …PAD` に戻せばよい
 */
function howToPages() { return HOWTO_PAGES_PAD; }
/** 挿絵も同じ(上と同じ並び) */
function howToArt() { return HOWTO_ART_PAD; }

/** 開いている板。**開いているあいだはゲームを止める** */
let howToEl = null;
/** 案内で止めたのか(自分で止めていたポーズを、閉じるときに戻さないため) */
let howToPaused = false;
/** ページ送りの部品。**キーとパッドから送るのに要る**(下の howToNext) */
let howToPager = null;

/** 次のページへ。**最後まで行ったら 1 ページ目へ回る**(閉じるのは X と ESC) */
function howToNext() { if (howToPager) howToPager.step(1); }

/** その人の言葉で取り出す */
function howToText(v) { return (TG_LANG === 'ja' ? v.ja : v.en) || v.en; }

/**
 * **挿絵。** ページごとに、ゲームの絵をそのまま並べる。
 *
 * 新しく描かない — **遊んでいるあいだに出てくるものと同じ絵**でないと、
 * 読んだあとに見つけられない。そのぶん、**大きくしたり傾けたり**して
 * 図としての見栄えを作る(ドットは pixelated のまま。にじませない)。
 *
 * 置き場所は**割合**(`l` / `t` = 板の左上からの %)。px で置くと、
 * 板の大きさが機種で変わるぶん、狭いところで外へ出てしまう。
 *
 * **字の座布団を避けて、まわりへ散らす。** 重なってもよいことにはしてあるが、
 * 真ん中へ置くと座布団の裏に丸ごと隠れて、何も見えなくなる
 *
 * `{ sym | icon, scale, deg, l, t }`
 */
const HOWTO_ART_AIM = [
  // うごかす: 右上に置かれたターゲットと、左下から向かう自機
  [
    { sym: 'aimMark', scale: 4, deg: 0, l: 86, t: 18 },
    { sym: 'player', scale: 4, deg: -18, l: 12, t: 78 },
  ],
  // うつ: 左の端を弾が並んで昇り、右下に こする丸を置く
  [
    { sym: 'bulletP', scale: 4, deg: 0, l: 12, t: 14 },
    { sym: 'bulletP', scale: 4, deg: 0, l: 12, t: 34 },
    { sym: 'bulletP', scale: 4, deg: 0, l: 12, t: 54 },
    { sym: 'player', scale: 4, deg: 0, l: 12, t: 80 },
    // **丸はスプライトではない**(CSS で描いてある)ので、絵の代わりに
    // 同じ見た目の丸をここで作る(下の howToArtImg を見ること)
    { fire: true, size: 88, l: 84, t: 74 },
  ],
  // めぐる: ターゲットを 3 つ散らして、道筋に見せる
  [
    { sym: 'player', scale: 3, deg: -24, l: 8, t: 84 },
    { sym: 'aimMark', scale: 3, deg: 0, l: 22, t: 16 },
    { sym: 'aimMark', scale: 3, deg: 0, l: 78, t: 14 },
    { sym: 'aimMark', scale: 3, deg: 0, l: 90, t: 82 },
  ],
  // そのほか: **挿絵は無し。**
  // パッドの話なのにキーボードの絵を借りていたが、別のものを指していて変だった。
  // パッドの絵は engine/util/icons.js にまだ無いので、置くなら足すところから
  [],
  // 締めの 1 枚も挿絵は無し(黄色い 1 行だけを読ませたい)
  [],
];

/**
 * 十字で動かすぶんの挿絵。**並びは HOWTO_PAGES_PAD と同じ**。
 *
 * 1 枚目にターゲットは置かない(あちらの遊びかたの絵なので、
 * 十字で遊ぶ人には出てこないものを見せることになる)。
 * 3 枚目は逆に、もう片方の遊びかたの話なのでターゲットを並べる
 */
const HOWTO_ART_PAD = [
  // うごかす: 自機だけ。**パッドの絵はまだ無い**(icons.js に足すところから)
  [
    { sym: 'player', scale: 4, deg: -18, l: 84, t: 22 },
  ],
  HOWTO_ART_AIM[1],
  HOWTO_ART_AIM[2],
  HOWTO_ART_AIM[3],
  HOWTO_ART_AIM[4],
];

/** 1 枚ぶんの絵を img にする。**作れなければ null**(絵が無くても案内は読める) */
function howToArtImg(a) {
  try {
    // **こする丸だけは絵ではない。** engine/util/touch.js が CSS で描いていて、
    // スプライトとして取り出せないので、同じ見た目の丸をここで作る。
    // **色と厚みはあちらに合わせること**(離れると、案内と実物が別ものに見える)
    if (a.fire) {
      const px = a.size || 80;
      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'absolute', left: (a.l || 50) + '%', top: (a.t || 50) + '%',
        transform: 'translate(-50%, -50%)', width: px + 'px', height: px + 'px',
      });
      const ring = document.createElement('div');
      Object.assign(ring.style, {
        position: 'absolute', inset: '0', boxSizing: 'border-box',
        borderRadius: '50%', border: `${Math.round(px * 0.1)}px solid #224466`,
        background: '#3d5f96',
      });
      box.appendChild(ring);
      // **指と矢印は、出ているものをそのまま複製する。**
      // 描き直すと実物と別ものになるうえ、あちらを直したときに
      // こちらだけ古いまま残る。動き(こする仕草)も付いてくる。
      // 絵の中でボタンが占めるのは 48 のうち 34x0.9 = 30.6 なので、
      // こちらの丸に合わせるにはその割合ぶん大きくする
      const live = touchGui && touchGui.touch && touchGui.touch._shot
        && touchGui.touch._shot.querySelector('.mmsxx-touch-gesture');
      if (live) {
        const g = live.cloneNode(true);
        const w = Math.round(px * 48 / (34 * 0.9));
        Object.assign(g.style, {
          // **出すことをここで言う。** 実物は「こすりを教える場面」でだけ
          // 出す決まりになっていて、ふだんは display:none。
          // 複製にもその指定が効くので、案内では出しっぱなしにすると言い直す
          // (これを書き忘れていて、うつのページから指が消えていた)
          display: 'block',
          position: 'absolute', left: '50%', top: '50%', bottom: 'auto',
          transform: 'translate(-50%, -50%)', width: w + 'px', height: w + 'px',
        });
        // **一度きりのお手本は止める。**
        // 実物のほうは 6 秒かけて 2 通りのこすりかたを見せてから消えるが
        // (way-a / way-b が forwards で 0 になる)、案内では出しっぱなしにしたい。
        // 見せるのは往復のほうだけ。**中の指の動きは残す**(あちらは無限に続く)
        const w1 = g.querySelector('.mmsxx-touch-way1');
        const w2 = g.querySelector('.mmsxx-touch-way2');
        if (w1) { w1.style.animation = 'none'; w1.style.opacity = '1'; }
        if (w2) w2.style.display = 'none';
        box.appendChild(g);
      }
      return box;
    }
    const img = document.createElement('img');
    if (a.icon) {
      img.src = iconDataURL(mmsxx, ICONS[a.icon],
        { body: ICON_BODY, accent: 7, scale: a.scale || 2, key: 'howto-' + a.icon });
    } else {
      const sym = SPRITE_SYMBOLS[a.sym];
      if (!sym) return null;
      img.src = exportSymbol(mmsxx, sym, { scale: a.scale || 3 }).toDataURL();
    }
    img.alt = '';
    Object.assign(img.style, {
      position: 'absolute', left: (a.l || 50) + '%', top: (a.t || 50) + '%',
      transform: `translate(-50%, -50%) rotate(${a.deg || 0}deg)`,
      imageRendering: 'pixelated',
    });
    return img;
  } catch (e) { return null; }   // 絵が作れない環境では字だけで出す
}

/**
 * ページの挿絵をまとめた箱。**板いっぱいに敷く**(字の下に回る)。
 *
 * 絵のための場所を別に取ると、狭い機種では字か絵のどちらかが潰れる。
 * **敷いてしまって、字は座布団を敷いて上に乗せる**ほうが、
 * どちらも読める(絵は隠れても、何の絵かは分かる)
 */
function howToArtBox(i) {
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none',
  });
  for (const a of (howToArt()[i] || [])) {
    const img = howToArtImg(a);
    if (img) box.appendChild(img);
  }
  return box;
}

/**
 * 板の大きさ。**遊びの画面と同じ広さまで**で頭打ちにする。
 *
 * 実機では器が窓ぜんぶを覆っているので、窓いっぱいと同じ意味になる。
 * `?device=` で枠を作っているときや窓の大きい端末では、
 * **窓いっぱいに広げると枠の外まではみ出して**、どこを押せばよいのか
 * 分からなくなる。器の大きさを借りて、そこへ収める
 */
function howToBox() {
  // **器の中に居るときは割合で取る。** 器は回っていることがあるので、
  // px で測ると 90 度のときに縦横が入れ替わったまま渡してしまう。
  // 割合なら、回る前の器の大きさに対する比になる
  // **幅と高さは根(ステッパーの箱)へ入れる。**
  // 本体へ % で入れても、その親が中身なりに縮むので効かない
  // (親の幅が中身で決まり、その中身が親の 92% を欲しがって堂々巡りになる)
  const w = '100%';
  const h = '100%';
  return {
    background: '#101010', borderColor: '#cccccc', color: '#e8e8e8',
    // 絵を敷くので、中身は板いっぱいに広げる(余白は座布団の側で取る)
    padding: '8px 34px',
    width: w, maxWidth: w, minHeight: h, maxHeight: h,
    boxSizing: 'border-box', overflow: 'hidden',
  };
}

/**
 * **初めて遊びはじめるときに 1 度だけ出す。**
 * `?howto=1` で毎回出せる(見た目を確かめるため)。
 *
 * **PC では毎回出す。** あちらで案内を読むのは中身を確かめるときなので、
 * 1 度きりだと**書き替えたぶんを見るのに覚えた印を消して回る**ことになる。
 * 指で遊ぶ端末では今までどおり 1 度きり(遊ぶ人の邪魔をしない)
 */
function maybeShowHowTo() {
  if (!PAD_ON) { openHowTo(); return; }      // PC は毎回
  if (OPT.get('howto') !== '1') {
    if (DEVICE) return;                      // 機種を渡り歩くときは出さない
    if (settings.get('howToSeen')) return;
    settings.set('howToSeen', true);
    settings.flush();
  }
  openHowTo();
}

/** 案内を開く。**ポーズ中の ? からも、遊びはじめからも ここへ来る** */
function openHowTo() {
  if (howToEl) return;
  // **止めてから出す。** 読んでいるあいだに敵が動いていては読めない
  howToPaused = !paused;
  if (howToPaused) setPaused(true);

  // **器の中へ入れる。** 器は見た目の角度で回っているので、
  // window へ直に置くと、90 度回して見せている機種で**そこだけ横倒し**で出る
  // (実機でそうなった)。中へ入れれば回転も画角の枠も付いてくる。
  // 器が無いとき(PC)は今までどおり窓へ
  const host = (touchGui && touchGui.el) || document.body;
  const inGui = host !== document.body;
  const el = document.createElement('div');
  el.id = 'howto';
  Object.assign(el.style, {
    position: inGui ? 'absolute' : 'fixed', inset: '0', zIndex: '9997',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.82)',
    // 器は遊びの最中 素通しにしてあるので、こちらで受け直す
    pointerEvents: 'auto',
  });
  // **指の話を器へ上げない。**
  // 器にはメニュー中だけ払う動きの見分けが付いていて、そこで
  // setPointerCapture を取られる。取られると、こちらのボタンは
  // 押し下げただけで終わって**押せたことにならない**(板が閉じなくなった)
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }
  // **板そのものがページ送りのボタン。**
  // つまみ(TARGETS)と同じ作りにしてある — 左右の端に矢印が居て、
  // **板の左半分を押せば前へ、右半分を押せば次へ**。
  // 閉じるボタンは置かない。**最後のページから次へ送ったら閉じる**
  // (読み終わったら先へ進む、が 1 つの動きで済む)
  // **絵を下に敷いて、字はその上へ。**
  // 字には半透明の黒い座布団を敷くので、絵と重なっても読める
  const inner = document.createElement('div');
  Object.assign(inner.style, {
    position: 'relative', width: '100%', minHeight: '100%',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: '10px',
  });
  const art = document.createElement('div');
  Object.assign(art.style, { position: 'absolute', inset: '0' });
  const text = document.createElement('div');
  Object.assign(text.style, {
    position: 'relative',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
  });
  // **座布団は行ごとに敷く。** 大きな 1 枚を置くと、そのぶん挿絵が
  // まるごと隠れる。字の下だけを塗れば、あいだから絵が見える。
  // 角は丸めない(ドット絵の画面に丸みは合わない)
  const PAD_BG = 'rgba(0, 0, 0, 0.66)';
  const cushion = (el) => {
    Object.assign(el.style, { background: PAD_BG, padding: '2px 10px' });
    return el;
  };
  const title = document.createElement('div');
  Object.assign(title.style, { color: '#ffe000' });
  cushion(title);
  const body = document.createElement('div');
  // **高さを決め打ちにする。** ページごとに行数が違うと、
  // 送るたびに板の大きさが変わって、押す場所が動く
  Object.assign(body.style, {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
    minHeight: '5.5em', lineHeight: '1.6',
  });
  // 締めの 1 行。**題と同じ黄色**にして、本文と読み分ける
  const note = document.createElement('div');
  Object.assign(note.style, { color: '#ffe000' });
  cushion(note);
  const pageNo = document.createElement('div');
  Object.assign(pageNo.style, { color: '#9a9aa8', fontSize: '0.8em' });
  cushion(pageNo);
  text.append(title, body, note, pageNo);
  inner.append(art, text);

  /** 本文を**行ごとの座布団**に置き直す。空の行は隙間だけ空ける */
  const setBody = (s) => {
    body.replaceChildren(...s.split('\n').map((line) => {
      const d = document.createElement('div');
      if (!line) { d.style.height = '0.6em'; return d; }
      d.textContent = line;
      return cushion(d);
    }));
  };

  const paint = (i) => {
    const p = howToPages()[i];
    // **題の無いページは箱ごと引っ込める。** 空のまま残すと、
    // そのぶんの隙間だけが空いて、本文の位置がページごとに動く
    title.style.display = p.title ? '' : 'none';
    title.textContent = p.title ? howToText(p.title) : '';
    // **本文の無いページは箱ごと引っ込める。**
    // 空の座布団が 1 枚残って、黒い帯だけが見えることになる
    const text = p.body ? howToText(p.body) : '';
    body.style.display = text ? '' : 'none';
    setBody(text);
    note.style.display = p.note ? '' : 'none';
    note.textContent = p.note ? howToText(p.note) : '';
    art.replaceChildren(howToArtBox(i));
    pageNo.textContent = `${i + 1} / ${howToPages().length}`;
  };
  paint(0);

  const pager = createStepper({
    mount: el,
    items: howToPages().map((p, i) => String(i + 1)),
    index: 0,
    // **回り込む。** 1 ページ目から左へ送れば最後のページへ行く。
    // 端で止まると「もう無い」のか「効いていない」のか分からないし、
    // **閉じるのは右上の × に任せる**ので、送りきる必要も無い
    wrap: true,
    fontSize: 24,                // **8 の倍数**。ドット絵の書体はそこでしか揃わない
    content: inner,
    // 板の見た目。矢印に貸すぶんだけ左右を広く取る
    // **画面いっぱいに取る。** 読ませる板なので、小さくして余白を残す
    // 意味が無い。押す場所(左半分 / 右半分)も広いほうが当てやすい。
    // ただし**大きくするのはスマホの画面までで頭打ち**にする
    // (`?device=` の枠や、窓の大きい端末では、窓いっぱいだと board が
    // 画面の外まではみ出して、どこを押せばよいのか分からなくなる)
    mainStyle: howToBox(),
    onChange: (i) => paint(i),
  });
  pager.show(true);
  // **大きさはここで決める**(本体ではなく根。上の howToBox を見ること)。
  // 器の中に居るなら器に対する割合、外(PC)なら窓に対する割合
  Object.assign(pager.el.style, {
    alignSelf: 'center',
    width: inGui ? '92%' : '92vw',
    height: inGui ? '88%' : '88vh',
  });
  howToPager = pager;   // キーとパッドから送るため(howToNext)

  // **右上に小さい X。閉じるのはここだけ。**
  // ページは回り込むので、送っているうちに閉じてしまうことは無い。
  // **矢印の列とは重ねない**(右の矢印は右端 2px から 20px ぶん居るので、
  // その内側へ寄せる)。板の子ではなく**根の子**にする —
  // 板そのものがボタンなので、中へ入れると押し分けられない
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'CLOSE');
  // **指で当てられる大きさにする**(44px。28px では小さすぎた)。
  // 絵は小さいままでよいが、受ける四角は指なりに取る
  Object.assign(close.style, {
    position: 'absolute', top: '4px', right: '26px',
    width: '44px', height: '44px', padding: '0',
    font: '24px/1 var(--mmsxx-gui-font, monospace)',
    color: '#e8e8e8', background: 'transparent', border: '0', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  close.addEventListener('click', () => { close.blur(); closeHowTo(); });
  pager.el.appendChild(close);
  host.appendChild(el);
  howToEl = el;
}

/** 案内を閉じる。**自分で止めていたポーズは戻さない** */
function closeHowTo() {
  if (!howToEl) return;
  howToEl.remove();
  howToEl = null;
  howToPager = null;
  if (howToPaused) setPaused(false);
  howToPaused = false;
}

// ---- 開発用の口 ここから ----
// **開発版だけ**: 遊びはじめまで進まなくても案内を出せるようにする。
// 中身を詰めているあいだ、毎回ゲームを始め直すのは手間なので
if (DEV) mmsxx.expose('mmsxxHowTo', () => { openHowTo(); return howToPages().length + ' ページ'; });
// ---- 開発用の口 ここまで ----

/** ポーズ中の ? ボタン。**スマホだけ**(PC には案内が画面の下に出ている) */
function bindHowToButton() {
  const el = document.getElementById('howto-btn');
  if (!el) return;
  if (!PAD_ON) { el.style.display = 'none'; return; }
  el.addEventListener('click', () => { el.blur(); openHowTo(); });
}

/**
 * **ポーズ中とタイトルで出す。**
 *
 * 遊びかたを読むのは遊びはじめる前でもあるので、タイトルにも要る
 * (ポーズまで来ないと読めないのでは、初めてのひと勝負を手探りで遊ぶことになる)。
 * 遊んでいる最中は出さない — 弾を避けている最中に触るものではない
 */
function showHowToButton() {
  const el = document.getElementById('howto-btn');
  if (!el || !PAD_ON) return;
  const on = paused || state === 'title';
  if (howToShown === on) return;
  howToShown = on;
  el.style.display = on ? '' : 'none';
}

// **ここで呼ぶ。** 上の const(IS_STANDALONE)より前では触れない
setupHomeInstall();
// スマホの画角への入口(DEV のときだけ)。DEVICE / DEVICES を見るので、
// **こちらも上の const が出そろってから**
showDeviceEntry();

/**
 * **PC では、canvas の下に置いてあるぶんを引いてから合わせる。**
 *
 * エンジンは窓の高さいっぱいに canvas を合わせる。PC ではその下に
 * 操作の一覧と断り書きが並んでいるので、**そのぶんページが窓より高くなり、
 * スクロールバーが出て、上がはみ出す**(実機ならぬ PC でそうなった)。
 *
 * 下に何行あるかはゲームしだいなので、ここで測ってエンジンへ渡す
 * (`fitSize` は「これに収めてほしい大きさ」)。
 * **指で遊ぶ端末では触らない** — あちらは canvas の下に何も置かず、
 * 器が窓ぜんぶを覆っている
 */
function fitScreenToPage() {
  if (PAD_ON || DEVICE) return;
  const el = document.documentElement;
  if (!el) return;
  // **はみ出したぶんを引く、をくり返す。**
  //
  // 「canvas 以外の高さ」を先に測って引く手も試したが、余白の取りかたで
  // 数 px 残り、スクロールバーが消えなかった。**実際にはみ出した量**を
  // 見て引けば、余白が何であろうと収まる。
  //
  // まず窓いっぱいに戻してから始めるので、**窓を広げたときも付いてくる**
  // (縮める一方だと、広げても小さいまま残る)
  mmsxx.vdp.fitSize = { w: el.clientWidth, h: el.clientHeight };
  mmsxx.vdp.refitCss();
  for (let i = 0; i < 5; i++) {
    // **はみ出しは「いちばん上の子がどこから始まるか」で測る。**
    //
    // 中身は縦の真ん中に寄せてあるので、収まらないと**上下へ半分ずつ**
    // はみ出す。上へ出たぶんは**スクロールでは見えない**(scrollHeight にも
    // 出てこない)ので、そこだけを見ていると気づけない ──
    // 実際、スクロールバーは消えたのに上が切れたままになった。
    // 上へ出た量が分かれば、その 2 倍が収めるべき量
    const first = document.body.firstElementChild;
    const top = first ? first.getBoundingClientRect().top : 0;
    const over = Math.max(
      Math.max(0, document.body.scrollHeight - el.clientHeight) * 2,
      Math.max(0, Math.ceil(-top)) * 2,
    );
    if (over <= 0) break;
    // **下限は置く。** 窓を極端に低くしたときに 0 以下にしない
    const h = Math.max(160, mmsxx.vdp.fitSize.h - over);
    if (h === mmsxx.vdp.fitSize.h) break;
    mmsxx.vdp.fitSize = { w: el.clientWidth, h };
    mmsxx.vdp.refitCss();
  }
  // **上へ戻す。** 縮める前にページが下へ送られていると、
  // 収まったあとも送られたままで、画面の上が切れて見える
  if (window.scrollY) window.scrollTo(0, 0);
}
// **エンジンの合わせ直しのあとに呼ぶ。** あちらは窓いっぱいで合わせるので、
// そのあとで下の字のぶんを引き直す
window.addEventListener('resize', fitScreenToPage);
fitScreenToPage();

/** 端まで来た ＋ / − を灰色にする。**枠ごと**沈めて、押せないことを見せる */
function updateZoomButtons() {
  const z = mmsxx.vdp.zoom;
  const off = (id, yes) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('off', yes);
  };
  off('zoom-in', z >= ZOOM_MAX - 0.001);
  off('zoom-out', z <= ZOOM_MIN + 0.001);
}

/**
 * **機種を渡り歩くためのリンク**。仮想の画面の外(窓の下端)に置く。
 * 機種を替えるたびに URL を打ち直すのが手間だったので。
 * **中に置かない**。画角の中に無いものが写ると、確かめている絵にならない
 */
function showDeviceLinks() {
  const keys = Object.keys(DEVICES);
  const at = keys.findIndex((k) => DEVICES[k] === DEVICE);
  const go = (d) => {
    const q = new URLSearchParams(location.search);
    q.set('device', keys[(at + d + keys.length) % keys.length]);
    return location.pathname + '?' + q;
  };
  const bar = document.createElement('div');
  // **枠の外は地の色が読めない**(白いことも黒いこともある)ので、
  // 札そのものに背景を敷いて、どこに出ても読めるようにする
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:6px;z-index:30;'
    + 'display:flex;gap:10px;align-items:center;justify-content:center;'
    + 'font:14px monospace;color:#ffffff;pointer-events:auto';
  const link = (text, href) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.style.cssText = 'color:#cfe0ff;text-decoration:none;padding:4px 10px;'
      + 'background:#1b1d2a;border:1px solid #5a6180';
    return a;
  };
  const now = Object.assign(document.createElement('span'), {
    textContent: `${DEVICE.name}  ${DEVICE.w}x${DEVICE.h} @${DEVICE.dpr}`,
  });
  now.style.cssText = 'padding:4px 10px;background:#1b1d2a;border:1px solid #5a6180';
  // **言葉も切り替えられるようにする。** 案内の文言は日英で出し分けているので、
  // 機種と同じくらい見比べたい(いま出ているほうは押しても意味が無いので沈める)
  const langLink = (v) => {
    const q = new URLSearchParams(location.search);
    q.set('lang', v);
    const a = link(v.toUpperCase(), location.pathname + '?' + q);
    if (TG_LANG === v) a.style.opacity = '0.4';
    return a;
  };
  bar.append(
    link('◀ ' + DEVICES[keys[(at - 1 + keys.length) % keys.length]].name, go(-1)),
    now,
    link(DEVICES[keys[(at + 1) % keys.length]].name + ' ▶', go(1)),
    langLink('ja'),
    langLink('en'),
  );
  document.body.appendChild(bar);
}

/**
 * **PC からスマホの画角へ入るための入口**(`?device=`)。ページの下端に置く。
 *
 * セーフエリアの枠つきで立ち上がるのは `?device=` を付けたときだけなので、
 * 毎回 URL を打ち直していた。中へ入ってからは上の showDeviceLinks で
 * 渡り歩けるので、**ここに要るのは「入る」ぶんだけ**。
 *
 * **DEV のときだけ。本番には出さない**(遊びに来た人には関わりが無い)。
 * すでに画角の中に居るときと、指で触る端末では出さない
 * (あちらは本物のセーフエリアがあるので、作りものの枠は邪魔にしかならない)
 */
function showDeviceEntry() {
  if (!DEV || DEVICE || coarsePointer()) return;
  const bar = document.createElement('p');
  // **器より前に出す。** 器(.mmsxx-gui)は fixed で窓ぜんぶを覆っていて、
  // メニューのあいだは指を受ける(pointer-events: auto)ので、
  // ふつうに置くと**この帯が器の下に潜って押せなくなる**(?pad=1 のとき)。
  // 器は z-index: 10 なので、それより上へ
  bar.style.cssText = 'position:relative;z-index:20;'
    + 'display:flex;gap:8px;align-items:center;'
    + 'justify-content:center;flex-wrap:wrap';
  bar.append(Object.assign(document.createElement('span'), {
    textContent: 'DEV: OPEN AS PHONE',
  }));
  for (const [key, d] of Object.entries(DEVICES)) {
    const q = new URLSearchParams(location.search);
    q.set('device', key);
    const a = document.createElement('a');
    a.href = location.pathname + '?' + q;
    a.textContent = d.name;
    a.title = `${d.w}x${d.h} @${d.dpr}`;
    a.style.cssText = 'color:#cfe0ff;text-decoration:none;padding:2px 8px;'
      + 'background:#1b1d2a;border:1px solid #5a6180';
    bar.appendChild(a);
  }
  document.body.appendChild(bar);
}

/** いまの画面から、出すものと案内を決める。**毎コマ呼んでよい**(同じなら何もしない) */
function updateTouchGui() {
  if (!touchGui) return;
  // 遊んでいる最中だけゲームモード。ポーズは選ぶ場面なのでメニュー側
  // 遊んでいる最中。**上のボタンだけ出して「PAUSE」と書く**。
  // 器に一本化してあるので、メニューのときと大きさも位置もそろう
  if (state === 'play' && !paused) {
    touchGui.setMode('game');
    // **撃ちっぱなしを毎コマ言い直す。** 受け取る側が入力を捨てても
    // (画面が非アクティブになった・知らせの札を閉じた)、次のコマで戻る。
    // これが無いと、一度 連射ボタンを触るまで撃ちっぱなしが返ってこなかった
    touchGui.keepFire();
    // **面クリアの集計は飛ばせる。** キーボードなら SPACE で飛ばせるのに、
    // 指では押すものが 1 つも無く、**終わるまで待つしかなかった**。
    // 出すのは飛ばせるようになってから(clearTimer < 900。それまでは
    // ボーナスが出そろっていないので、飛ばしても読むものが無い)
    // **キーは送らず、直に飛ばす。** OK のふだんの Space は撃つキーでもあり、
    // 撃ちっぱなしの遊びでは押しっぱなしのままなので、押し直しとして
    // 数えてもらえない(飛ばすほうは押した瞬間を見ている)
    const canSkipClear = clearTimer > 0 && clearTimer < 900;
    touchGui.setGuide({ left: [], esc: OK.pause,
      ok: canSkipClear ? { en: OK.skip, run: () => { clearTimer = 1; } } : null,
      opt: null });
    showTuneButtons(false);
    showKeyboardButton();
    showRotateButton();
    showPadSenseButton();
    showHowToButton();
    return;
  }
  touchGui.setMode('menu');
  touchGui.setGuide(menuGuide());
  showTuneButtons(true);
  showKeyboardButton();
  showRotateButton();
  showPadSenseButton();
  showHowToButton();
}

/**
 * **大きさとドットのつまみは、遊んでいる最中は出さない。**
 * 弾を避けている最中に触るものではないし、そのぶん十字の場所を食う。
 * ポーズやタイトルでは出るので、見比べて決められる
 */
function showKeyboardButton() {
  const el = document.getElementById('keyboard-btn');
  if (!el) return;
  // 打てるのは**ポーズ中の裏技**と**名前入力**。
  // 名前入力は上下左右でも選べるが、**1 文字ずつ送るのは指では重い**
  // (5 文字入れるのに何十回も払うことになる)。打てるなら打つほうが早い
  const usable = paused || state === 'entry';
  if (kbdUsable === usable) return;
  kbdUsable = usable;
  el.classList.toggle('off', !usable);
  // **打てない場面へ移ったら板ごとしまう。** 出しっぱなしにすると、
  // ゲームが動いている上にキーボードが載ったままになる。
  // 打ちかけのぶんは**流さない**(打ち終わっていないものを勝手に入れない)
  if (!usable) closeSoftKeys(false);
}

// ---- ソフトキーボード(裏技の打ち込み) ----
//
// スマホには打つところが無いので、**ふつうのテキスト欄を画面に重ねて出し**、
// そこへ焦点を当てて OS のキーボードを呼ぶ。
// **打っているあいだ、ゲームには何も入れない。** 打ち終わって OK を押したときに、
// 欄の中身から使える字を前から拾い、まとめてキーの押下に化かして流す。
//
// ## なぜ「打つたびに流す」のをやめたか
//
// はじめは隠し欄の値の増減を見て 1 文字ずつ流していたが、**iOS で 1 文字打つと
// 3 文字ほど入った**。予測変換や大文字化が値をまるごと書き替えるので、
// 「増えたぶん = 打たれた字」が成り立たない。
// **Android の挙動を手元で確かめられない以上、機種ごとの癖に賭ける作りにしない。**
// 欄を見せて最後に 1 回だけ読めば、途中で何が起きていようと結果は同じになる。
//
// ## 欄は回さない
//
// 画面を 90 度回して見せていても、**この欄だけは端末の向きのまま**置く。
// OS のキーボードは端末の向きで出てくるので、欄だけ回すと
// 打つところと打つ道具が食い違う。**打つときは端末を横に持つ**のが正しい姿で、
// そうすれば回転そのものが外れて全部そろう。

/**
 * 打たれたぶんを溜めておく列。**1 コマに 1 つずつ流す**。
 * まとめて press すると、ゲームは 1 コマぶんしか読めないので取りこぼす
 */
const softQueue = [];
/** 前のコマで押したキー。次のコマの頭で離す */
let softHeld = null;
/** 打ち込みの板(入力欄と OK)。**初めて押されたときに作る** */
let softPanel = null;
let softInput = null;
/**
 * **何文字まで拾うか。** 打ち終わった中身から前へ数えて、ここで切る。
 * 名前は 5 文字(NAME_MAX)、裏技の語は 12 文字(typed の持ちぶんと同じ)
 */
function softLimit() { return state === 'entry' ? NAME_MAX : 12; }

/** 文字を、エンジンが知っているキーの名前へ直す。**知らない字は捨てる** */
function softKeyCode(ch) {
  if (ch >= 'A' && ch <= 'Z') return 'Key' + ch;
  if (ch >= 'a' && ch <= 'z') return 'Key' + ch.toUpperCase();
  if (ch >= '0' && ch <= '9') return 'Digit' + ch;
  // 名前に使える記号(game/main.js の updateNameEntry と同じ並び)
  return { ' ': 'Space', '-': 'Minus', ',': 'Comma', '.': 'Period',
    '?': 'Slash', '!': 'Backslash' }[ch] || '';
}

/**
 * **1 コマに 1 つずつキーを流す。** 遊びのループの頭で呼ぶこと。
 * 押したものは**次のコマの頭で離す**(押してすぐ離すと、
 * ゲーム側の wasPressed() が拾えない)
 */
function pumpSoftKeys() {
  if (softHeld) { mmsxx.input.release(softHeld); softHeld = null; }
  const code = softQueue.shift();
  if (!code) return;
  // 種別は 'touch'。画面の上のキーボードなので、遊びかたとしては指の操作
  mmsxx.input.press(code, 'touch');
  softHeld = code;
}

/**
 * 打ち込みの板を作る(1 度だけ)。**入力欄と OK だけ**。
 *
 * **画面の上のほうに置く。** ソフトキーボードは下半分を覆うので、
 * 下に置くと自分が打っているものが見えない
 */
function makeSoftPanel() {
  if (softPanel) return softPanel;
  const box = document.createElement('div');
  box.id = 'soft-keys';
  // **器の外に置く。** 器は画面を回して見せているときに一緒に回るが、
  // OS のキーボードは端末の向きで出てくるので、ここが回ると食い違う
  box.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);'
    + 'z-index:9999;display:none;gap:8px;align-items:center;'
    + 'padding:8px;background:#101010;border:2px solid #cccccc';
  const el = document.createElement('input');
  el.type = 'text';
  el.setAttribute('autocomplete', 'off');
  el.setAttribute('autocorrect', 'off');
  el.setAttribute('spellcheck', 'false');
  // 裏技の語も名前も**大文字**なので、はじめから大文字で出させる
  el.setAttribute('autocapitalize', 'characters');
  el.setAttribute('enterkeyhint', 'done');
  // **英数字のキーボードを出させる。** 既定のままだと、日本語の入力に
  // 設定している端末では かな が出てくる(打っても 1 字も入らないので途方に暮れる)。
  // inputmode は「どの並びのキーボードを出すか」の希望で、
  // **かなへ切り替えることは止められない**。止めるのは下の間引き
  el.setAttribute('inputmode', 'email');
  el.setAttribute('lang', 'en');
  // **字は 16px 以上。** これを割ると iOS が焦点を当てたときに画面へ寄っていく
  el.style.cssText = 'font:16px monospace;letter-spacing:2px;width:9em;'
    + 'padding:6px 8px;background:#202020;border:2px solid #8888aa;color:#ffffff';
  // **打ったそばから、使える字だけに間引く。**
  //
  // かなへ切り替えられたら inputmode では止められないので、
  // **入った字のほうを落とす**。ゲームが受け取れない字は欄にも残さない、
  // で通しておけば、**見えているものがそのまま入る**(最後に黙って
  // 消えるのがいちばん分かりにくい)。
  // 大文字に直すのもここ。裏技の語も名前も大文字なので、
  // 打ちながら見えているものと入るものをそろえる
  el.addEventListener('input', () => {
    const kept = [...el.value.toUpperCase()]
      .filter((ch) => softKeyCode(ch))
      .slice(0, softLimit())
      .join('');
    if (kept === el.value) return;
    el.value = kept;
    // カーソルは末尾へ。**間引いたあとの位置は当てにならない**
    try { el.setSelectionRange(kept.length, kept.length); } catch (e) { /* 古い環境 */ }
  });
  // **打っているあいだ、キーはゲームへ流さない。** エンジンは window で
  // keydown を拾っているので、止めないと打った字がそのまま操作になる
  // (裏技の打ち込みが二重に入り、矢印は自機を動かしてしまう)
  for (const type of ['keydown', 'keyup', 'keypress']) {
    el.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'keydown' && e.key === 'Enter') { e.preventDefault(); closeSoftKeys(true); }
    });
  }
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.textContent = 'OK';
  ok.style.cssText = 'font:16px monospace;padding:6px 14px;'
    + 'background:#333344;border:2px solid #aabbcc;color:#ffffff;cursor:pointer';
  ok.addEventListener('click', () => closeSoftKeys(true));
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '×';
  cancel.setAttribute('aria-label', 'CANCEL');
  cancel.style.cssText = 'font:16px monospace;padding:6px 12px;'
    + 'background:#202020;border:2px solid #aaaaaa;color:#ff6a6a;cursor:pointer';
  cancel.addEventListener('click', () => closeSoftKeys(false));
  box.append(el, ok, cancel);
  document.body.appendChild(box);
  softPanel = box;
  softInput = el;
  return box;
}

/** 打ち込みの板を出す / しまう */
function toggleSoftKeys() {
  if (softPanel && softPanel.style.display === 'flex') { closeSoftKeys(false); return; }
  const box = makeSoftPanel();
  softInput.value = '';
  box.style.display = 'flex';
  // **押されたその場で focus() を呼ぶ**こと。あとから(タイマや await の先で)
  // 呼んでも、iOS は「人が触った」と見なさずキーボードを出さない
  softInput.focus({ preventScroll: true });
}

/**
 * 板をしまう。`commit` なら**中身をゲームへ流す**。
 *
 * 流すのは**前から数えて使える字だけ**。予測変換で余計なものが混じっていても、
 * ここで落ちる。**打っている途中は何も流していない**ので、
 * 機種ごとの癖に関わらず、入るのはここで読んだものだけになる
 */
function closeSoftKeys(commit) {
  if (!softPanel || softPanel.style.display !== 'flex') return;
  const raw = commit ? softInput.value : '';
  softPanel.style.display = 'none';
  softInput.blur();
  if (!raw) return;
  const max = softLimit();
  let n = 0;
  for (const ch of raw.toUpperCase()) {
    if (n >= max) break;
    const code = softKeyCode(ch);
    if (!code) continue;      // 使えない字は黙って捨てる
    softQueue.push(code);
    n++;
  }
  // **裏技は確定まで面倒を見る。** RETURN を押す口が指では無いので、
  // 打ち終わり = 確定でよい。名前入力は GUI に ENTER があるので送らない
  if (n && state !== 'entry') softQueue.push('Enter');
}

function bindKeyboardButton() {
  const el = document.getElementById('keyboard-btn');
  if (!el) return;
  // **PC には要らない。** 打つところが最初からある
  if (!PAD_ON) { el.style.display = 'none'; return; }
  // **pointerdown ではなく click。** pointerdown で焦点を当てても、
  // そのあとの既定の動きで焦点が外れてしまう
  el.addEventListener('click', () => {
    if (el.classList.contains('off')) return;
    // 指で触ったこの機会に、音も解禁しておく(engine.js は keydown でしかやらない)
    mmsxx.audio.unlock();
    toggleSoftKeys();
  });
}

function showTuneButtons(on) {
  if (tuneShown === on) return;
  tuneShown = on;
  for (const id of ['zoom-in', 'zoom-out', 'pixel-fit']) {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? '' : 'none';
  }
}

mmsxx.run(() => {
  // ソフトキーボードで打たれたぶんを 1 コマに 1 つ流す。**パッドより先**に
  // 置くのは、どちらも「ゲームが読む前に入れる」ものだから(順は問わない)
  pumpSoftKeys();
  // ポーズ中だけ、パッドの下段 2 つを打ち込みの B / A に貸す
  applyPadTyping();
  // **ゲームが入力を読む前に**パッドを流し込む。
  // エンジンは update() のあとで endFrame() を呼ぶので、押したそのコマで効く
  gamepad.poll();
  // 出すものと案内を、いまの画面に合わせる。**同じなら何もしない**
  updateTouchGui();
  // **道の見張りはここでもする。**
  // 消す仕掛けは trace.update の中にあるが、**あれは遊びの最中しか
  // 呼ばれない** — やられた直後やタイトルへ戻ったあとは呼ばれないので、
  // 線だけが画面に残る。ここは毎コマ通るので、そこでも片付ける
  sweepTracePath();
  // 対応していないパッドは poll() が相手にしないので、押されたことも伝わってこない。
  // **繋いだのに何も起きない**を放っておかないよう、ここで見つけて知らせる
  // 対応していないパッドは**押しても番号が読めない**ので、「また押されたら
  // もう一度」ができない。ページを開いているあいだ 1 回だけ知らせる
  // **出せたときだけ**印を立てる。遊んでいる最中は出さないので、
  // ここで印を立ててしまうと、タイトルへ戻っても二度と知らせられなくなる
  if (!padNgShown && gamepad.unsupported().length && showPadNotice()) padNgShown = true;
  // 札が出ているあいだは**ゲームを進めない**。
  // 読んでもらう間に敵が寄ってきたり、パッドの入力で画面が変わったりしない
  if (padNotice.open) return;
  if (fpsMeter) fpsMeter.tick();
  // ボスの段階と技。中ボスのモアイも出す
  if (stateMeter) {
    // 崩し(ピヨらせ)は局面では表せないので、数のまま並べる。
    // 撃たれるほど「動き」が下がり、0.1 で 3 秒固まる。
    // 頭に当てても下がらない(腕で受けたぶんだけ溜まる)ので、
    // **狙いどころによって崩れかたが変わる**のがここで見える
    const kingBreak = boss && boss.actFsm
      ? '動き ' + (boss.slowMul == null ? 1 : boss.slowMul).toFixed(2)
        + '  たくわえ ' + (boss.stunStock | 0)
      : null;
    stateMeter.tick({
      ボス: boss && boss.fsm, 技: boss && boss.actFsm, レーザー: boss && boss.gun, 崩し: kingBreak,
      モアイ: moai && moai.fsm,
    });
  }
  // 名乗りのあいだは、画面も HUD もいっさい動かさない
  if (talkHold > 0) {
    talkHold--;
    // 名乗りの前の 2 秒は「爆圧」の見せ場。
    // ここだけは止めずに、KING のまわりで爆発を連発して画面を揺らす
    if (talkBlast && talkHold > TALK_HOLD_FRAMES) {
      if (boss && (talkHold & 3) === 0) {
        spawnBoom(boss.x - 12 + Math.random() * (KING_MAN_W + 24),
          boss.y - 12 + Math.random() * (KING_MAN_H + 24));
        mmsxx.audio.playSE('boom', SE_HIT);
      }
      if ((talkHold % 10) === 0) flashTimer = 2;
      // 揺れは 1 ドット単位。だんだん小さくしていく
      const t = (talkHold - TALK_HOLD_FRAMES) / KING_ROAR_WAIT;
      const amp = Math.round(3 * t);
      mmsxx.setAdjust(amp ? (Math.random() * 2 - 1) * amp : 0,
        amp ? (Math.random() * 2 - 1) * amp : 0);
      updateBooms();
      updateFlash();
      drawBossBody();
    }
    // 止まってから 2 秒おいて名乗る
    if (talkHold === TALK_HOLD_FRAMES) {
      mmsxx.setAdjust(0, 0);
      mmsxx.audio.playTalk(talkName, 9, { exclusive: true });
    }
    // 高笑いが終わったら、そこでゲームオーバーの曲を始める
    if (talkHold === 0 && talkName === 'kingLaugh') playBGM('gameover', false);
    // 声が終わったところで爆発。ここから倒れる演出が動き出す
    if (talkHold === 0 && boss && boss.deathRoar) {
      boss.deathRoar = false;
      mmsxx.audio.playSE('bossboom', SE_HIT);
    }
    return;
  }
  // シェアのダイアログが出ているあいだは、**キーをゲームへ流さない**。
  // 閉じるのは ESC だけ
  if (shareOpen) {
    // **上下で「矢印」と「下のボタン」を行き来する**。
    //   矢印にいるとき … 左右でコマ(時間)を選ぶ
    //   ボタンにいるとき … 左右で選び、SPACE で実行
    // ESC はどこにいても閉じる(CLOSE を押したのと同じ)
    const key = mmsxx.input;
    if (key.wasPressed('Escape')) { closeShare(); return; }
    if (shareBack !== SHARE_ONE && (key.wasPressed('ArrowUp') || key.wasPressed('ArrowDown'))) {
      setShareZone(shareZone === 'frame' ? 'buttons' : 'frame');
    } else if (shareZone === 'frame') {
      // 左右は**矢印を選ぶ**。送るのは SPACE(下のボタンと同じ操作にそろえる)。
      // 押しっぱなしのときは少し待ってから送り続ける
      if (key.wasPressed('ArrowLeft')) focusShareArrow(0);
      else if (key.wasPressed('ArrowRight')) focusShareArrow(1);
      else if (key.wasPressed('Space')) {
        runShareArrow(); shareRepeat = 20; shareHold = shareArrow;
      } else if (key.isDown('Space') && shareHold === shareArrow) {
        // 選んでいる矢印が押しはじめと同じあいだだけ続ける。
        // 端で反対側へ移ったら、ここで途切れて逆へは進まない
        if (--shareRepeat <= 0) { runShareArrow(); shareRepeat = 3; }
      }
    } else {
      if (key.wasPressed('ArrowLeft')) moveShareFocus(-1);
      else if (key.wasPressed('ArrowRight')) moveShareFocus(1);
      else if (key.wasPressed('Space')) runShareFocus();
    }
    return;
  }
  // ALT + P でシェアのダイアログを出す。どの画面でも効く
  // (ALT 付きのキーは打ち込みに入らないので、P が名前や裏技に混ざることはない)
  if (altDown() && mmsxx.input.wasPressed('KeyP')) {
    openShare();
    return;
  }
  // ALT + M で音を消す / 戻す。どの画面でも効く。
  // 曲は止めずに出口を閉じるだけなので、戻せば続きから聞こえる
  if (altDown() && mmsxx.input.wasPressed('KeyM')) {
    const off = setMute();
    showNotice(off ? 'SOUND OFF' : 'SOUND ON');
  }
  // ALT + S で、どの画面でもその場を**クリップボードへ**コピーする。
  // タイトルでも図鑑でもポーズ中でも効く(DEV でなくても使える)
  if (altDown() && mmsxx.input.wasPressed('KeyS')) {
    captureClipboard();
    captureArmed = 60;   // すぐ ESC で抜けたら、文字なしでもう 1 枚
  } else if (captureArmed > 0) captureArmed--;
  // ポーズを抜けた直後の画面(ポーズの文字が写らない)をもう 1 枚
  if (capturePending > 0 && --capturePending === 0) captureClipboard();
  // **遊びかたの板が開いているあいだは、キーとパッドをそちらへ渡す。**
  // 板は DOM なので指では触れるが、パッドで遊ぶ人には触りようが無かった。
  // パッドは A → Space、B / Start → Escape で落ちてくる
  // (engine/util/gamepad.js の STANDARD_MAP)ので、そのまま使える。
  // **ポーズの解除より先に見る。** あとに置くと、閉じる ESC が
  // そのままポーズも解いてしまう
  if (howToEl) {
    if (mmsxx.input.wasPressed('Escape')) closeHowTo();
    else if (mmsxx.input.wasPressed('Space') || mmsxx.input.wasPressed('Enter')) howToNext();
    return;
  }
  if (paused) {
    // 解除は ESC だけ。ENTER は裏技コードの確定に使う
    if (mmsxx.input.wasPressed('Escape')) {
      togglePause();
      return;
    }
    checkCheatCode();
    return;
  }
  // ボーナス集計を出しているあいだ(clearTimer)はポーズさせない。
  // あそこは ESC が「集計を飛ばす」に割り当ててあるので、
  // 止められるようにしておくと**飛ばすのと同時にポーズが掛かる**
  if (state === 'play' && clearTimer <= 0
      && (mmsxx.input.wasPressed('KeyP') || mmsxx.input.wasPressed('Escape'))) {
    togglePause();
    return;
  }

  // 背景スクロール (視差付き縦スクロール)
  // レイヤーごとの速度差を大きくして遠近感を出す(最背面 : 中景 : 近景 = 1 : 3 : 8)
  // 星は 3 段階で速度差をつける(遠い星ほどゆっくり)
  // 壁紙のページだけは、絵として見せたいので星も止める
  //
  // **面をクリアしたら、宇宙は減速して止まる**(下の bgStopMul)。
  // 結果画面のあいだは動かないので、**そこが必ず同じ絵になる**。
  // 面ごとに録った動画をつなぐとき、継ぎ目で背景が飛ばずに済む
  const bgMul = bgStopMul();
  if (!(state === 'chars' && CHAR_PAGES[charPage] && CHAR_PAGES[charPage].bare)) {
    far.scrollBy(0, -0.25 * bgMul);
    mid.scrollBy(0, -0.9 * bgMul);
    near.scrollBy(0, -2.0 * bgMul);
  }
  // 大きな背景オブジェクトは手前のレイヤーに描いているが、
  // 速度は最背面と同じにして遠くにあるように見せる
  // 図鑑では絵を止めて見せるので、このレイヤーはスクロールさせない
  // 揺れはどの画面でも戻せるよう、メインループで進める
  updateShake();
  updateHitArea();   // 当たり判定の枠(HITAREA のときだけ)
  // 図鑑とストーリー画面は絵を止めて見せるので、このレイヤーは動かさない
  if (!bossMode && state !== 'chars' && state !== 'story' && state !== 'staff') {
    neb.scrollBy(0, -0.25 * bgMul);
  }

  if (state === 'title') {
    updateTitleSparks();
    updateLogoShine();
    // ロゴ画面とアイテム説明画面を交互に見せる
    // ハイスコア画面は自動スクロールを見せるぶん長めに出す
    // **上下で操作すると数え直す**(touchTitle)。選んでいる途中で流れていかない
    const isList = titlePage >= 2;
    const pageLen = isList ? 1350 : 720;
    if (titlePage === 2 || titlePage === 3) updateHiScoreList();
    else if (titlePage === 4) updateRushList();
    // 左右キーでページを送る(押さなくても順に流れていく)
    let turn = 0;
    if (mmsxx.input.wasPressed('ArrowRight')) turn = 1;
    else if (mmsxx.input.wasPressed('ArrowLeft')) turn = -1;
    if (turn || ++titleTimer > pageLen) {
      titleTimer = 0;
      titlePage = (titlePage + (turn || 1) + TITLE_PAGES) % TITLE_PAGES;
      drawTitlePage();
      // **自分で送ったときだけ**音を鳴らす。
      // ひとりでに流れていくぶんまで鳴ると、ずっと鳴りっぱなしになる
      if (turn) mmsxx.audio.playSE('item');
    }
    if (titlePage === 0) {
      // ロゴのページだけ、上下キーでゲームモードを選ぶ。
      // (一覧のページでは上下がスクロールなので、そちらとぶつからない)
      // 一覧と同じく**押しっぱなしで送れる**(モードは 7〜9 個あるため)
      const d = mmsxx.input.repeat('ArrowDown') ? 1
        : mmsxx.input.repeat('ArrowUp') ? -1 : 0;
      if (d) {
        modeIndex = stepMode(d);
        touchTitle();   // 選んでいるあいだは次の画面へ流さない
        mmsxx.audio.playSE('item');
        drawModeLine();
      }
      updateModeLine();
      if (mmsxx.input.wasPressed('Space')) {
        if (gameMode() === 'staff') enterStaffRoll();
        else if (gameMode() === 'sound') enterSoundTest();
        else if (gameMode() === 'chars') enterCharList();
        else if (gameMode() === 'stats') enterStats();
        else if (gameMode() === 'scene') enterSceneSelect();
        else if (gameMode() === 'devset') enterDevSettings();
        else if (gameMode() === 'bossrush') enterBossRushMenu();
        // **CONTINUE を選んだとき**は、最後に遊んでいた面から始める
        else {
          const cont = gameMode() === 'continue';
          enterPlay(cont);
        }
      }
    } else {
      updateBackLine();
      // ロゴ以外のページでは、SPACE はロゴへ戻すことにあてる
      // (モードを選べるのはロゴのページだけなので、開始とはぶつからない)
      if (mmsxx.input.wasPressed('Space')) {
        titleTimer = 0;
        titlePage = 0;
        drawTitlePage();
      }
    }
  } else if (state === 'play') {
    updateStageNotice();
    updatePlay();
  } else if (state === 'replay') {
    updateReplay();
  } else if (state === 'over') {
    updatePlay(); // 残った敵や爆発は動かし続ける
    stateTimer++;
    // 「月光」を全部聞きたくないときのために、**どのモードでも**
    // 少し待てばキーで先へ進める(ボスラッシュはタイムを競うのですぐ効く)
    // 連射したままだと一瞬で飛んでしまうので、2 秒たってから効くようにする
    const skipOK = gameMode() === 'bossrush' || stateTimer > 120;
    if (skipOK &&
        (mmsxx.input.wasPressed('Space') || mmsxx.input.wasPressed('Escape'))) {
      stateTimer = GAMEOVER_WAIT + 1;
    }
    // 記録を出したときは、少し待てばスペースですぐ名前入力へ飛べる
    if (stateTimer > 90 && scoreCountsForRanking() && isHiScore(score) &&
        gameMode() !== 'bossrush' && mmsxx.input.wasPressed('Space')) {
      enterNameEntry('score');
      return;
    }
    // 「月光」を最後まで聞かせてから次へ進む
    if (stateTimer > GAMEOVER_WAIT) {
      if (gameMode() === 'bossrush') {
        // 1 巡できて、しかもタイムが上位なら名前を入れてもらう
        if (rushDone && rushTable.qualifies({ frames: rushFrames })) enterNameEntry('rush');
        else enterTitle();
      } else if (scoreCountsForRanking() && isHiScore(score)) {
        // 記録を出したときは名前入力へ。**シェアは登録し終えたあと**に出す
        // (名前と順位が決まってからでないと、スコアの札で投稿できない)
        enterNameEntry('score');
      } else {
        // ゲームオーバーから戻ったときは CONTINUE が選ばれた状態にする
        enterTitle(0, -1, true);
      }
    }
  } else if (state === 'entry') {
    updateNameEntry();
  } else if (state === 'submitting') {
    updateSubmitting();
  } else if (state === 'story') {
    updateStory();
  } else if (state === 'scene') {
    updateSceneSelect();
  } else if (state === 'devset') {
    updateDevSettings();
  } else if (state === 'staff') {
    updateStaffRoll();
  } else if (state === 'sound') {
    updateSoundTest();
  } else if (state === 'chars') {
    updateCharList();
  } else if (state === 'stats') {
    updateStats();
  }
});
