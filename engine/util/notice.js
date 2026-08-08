// キャンバスの上に重ねる、**読ませて止める**ための知らせ。
//
//   const notice = createNotice(mmsxx, {
//     mount: document.getElementById('stage'),
//     canvas: document.getElementById('screen'),
//   });
//   notice.show('つないだ道具を認識しました。<br>キーを押してください。', (e) => {
//     if (e.code === 'Escape') やめる(); else つかう();
//   });
//   if (notice.open) return;   // 出ているあいだはゲームを進めない
//
// ## なぜキャンバスに描かないか
//
// **キャンバスの外(画面の下など)へ置くと、キー入力が二重になったり奪われたりする**。
// かといってキャンバスへ描くと、共有の絵や録画に写り込み、文字の大きさも
// 8 ドットの升目に縛られる。だから **DOM を上に重ねる**(docs/SMARTPHONE.md の 5 節)。
// 押せるものは置かず、`pointer-events: none` で焦点も取らない。
//
// ## 閉じかた
//
// **キーボードを 1 回押すと閉じる**。どのキーで閉じたかは呼び出し側へ渡すので、
// 「ESC ならやめる、それ以外なら使う」のような分けかたができる。
//
// キーで閉じるのには、もう 1 つ意味がある。ブラウザは**パッドやセンサーの操作を
// 「人が触った」と数えない**ので、キーかクリックが 1 回ないと音が鳴りはじめない。
// この知らせを読んでもらうこと自体が、音の解禁を兼ねる。

/** 白い札の見た目。**ゲームごとに変えたくなったら style で差し替える** */
const BASE_STYLE = 'display:none;position:absolute;left:0;top:50%;'
  + 'transform:translateY(-50%);box-sizing:border-box;padding:16px 12px;'
  + 'background:#ffffff;color:#111111;font-family:monospace;font-size:14px;'
  + 'line-height:1.8;text-align:center;pointer-events:none';

/**
 * @param {object} mmsxx エンジン(閉じたときに入力を捨てるのに使う)
 * @param {object} opt
 * @param {HTMLElement} opt.mount 札を入れる親。**キャンバスを含む箱**を渡す
 * @param {HTMLElement} [opt.canvas] 幅を合わせるキャンバス(無ければ親の幅いっぱい)
 * @param {string} [opt.className] 目印の class(既定 'mmsxx-notice')
 * @param {string} [opt.style] 見た目を丸ごと差し替える
 */
export function createNotice(mmsxx, opt = {}) {
  const doc = typeof document === 'undefined' ? null : document;
  const el = doc ? doc.createElement('div') : null;
  if (el) {
    el.className = opt.className || 'mmsxx-notice';
    el.style.cssText = opt.style || BASE_STYLE;
  }
  let onKey = null;

  const notice = {
    el,
    /** 出ているあいだ true。**ゲームを止める印**にする */
    open: false,
  };

  const keyHandler = (e) => {
    if (!notice.open) return;
    window.removeEventListener('keydown', keyHandler);
    notice.hide();
    if (onKey) onKey(e);
  };

  /**
   * 札を出す。**出ているあいだはゲームを止めるのは呼び出し側の仕事**
   * (`if (notice.open) return;` を書く)
   * @param {string} html 中身。改行は <br>
   * @param {(e: KeyboardEvent) => void} [answer] 閉じたときに、押されたキーを渡す
   */
  notice.show = (html, answer) => {
    if (!el || notice.open) return;
    notice.open = true;
    onKey = answer || null;
    el.innerHTML = html;
    const mount = opt.mount;
    if (mount) {
      // 札を重ねられるようにしておく(親が動いていなければ何も変わらない)
      if (getComputedStyle(mount).position === 'static') mount.style.position = 'relative';
      mount.appendChild(el);
    }
    if (opt.canvas) el.style.width = opt.canvas.offsetWidth + 'px';
    el.style.display = 'block';
    window.addEventListener('keydown', keyHandler);
  };

  /** 札を消す。ふつうはキーで閉じるので、呼ぶのは横から止めたいときだけ */
  notice.hide = () => {
    if (!notice.open) return;
    notice.open = false;
    if (el) el.style.display = 'none';
    window.removeEventListener('keydown', keyHandler);
    // **札を消すために押したキーは、ゲームへ渡さない**。
    // 渡すと、タイトルでスペースを押しただけでゲームが始まってしまう
    // (エンジンの keydown が先に走って、もう控えられている)
    if (mmsxx && mmsxx.input) { mmsxx.input.clear(); mmsxx.input.pressed.clear(); }
  };

  return notice;
}
