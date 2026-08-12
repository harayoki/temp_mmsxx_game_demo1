// **段を選ぶボタン。** 何のつまみかを上の行に、いまの段を下の行に出し、
// 左右の矢印で前後へ送る。
//
//   import { createStepper } from '../engine/util/stepper.js';
//
//   const turn = createStepper({
//     mount: document.getElementById('tools'),
//     label: 'TURN BACK',
//     items: ['OFF', 'QUICK', 'NORMAL', 'FIRM'],
//     index: 3,
//     onChange: (i, name, byUser) => つまみを当てる(i, byUser),
//   });
//   turn.show(paused);
//
// ## なぜ矢印を囲みの内側へ重ねるか
//
// **横へ並べると場所を食う。** これが置かれるのは画面の左右に残った細い帯で、
// はみ出したぶんはそのままゲーム画面に掛かる。囲みの幅を変えずに済ませたいので、
// 矢印は本体の上へ重ねて置き、**左右の端を貸す**形にしてある。
// 押す場所は本体の左半分・右半分とちょうど重なるので、
// **どちらを押しても同じ向きへ動く**(矢印を狙い損ねても外れない)。
//
// ## なぜ見た目を style で書くか
//
// **借りる側の CSS に負けないため。** 置き場所が `#tools` のような id の下だと、
// `#tools button { width: 32px }` のような指定が class で書いたこちらの指定に勝つ
// (id + 要素 は class より強い)。実際それで 32px の絵のボタンに潰れていた。
// style 属性ならどの指定より強いので、どこへ置いても同じ姿で出る
// (engine/util/notice.js も同じ理由で style に書いてある)。
//
// 色と書体だけは差し替えられるようにしてある(下の `colors`)。

/** 既定の色。**画面に出る字は英語**なので、名前もそのまま出す前提 */
const COLORS = {
  text: '#ffffff',
  back: '#2a2a3c',
  edge: '#ffffff',
  arrow: '#ffffff',
};

/**
 * 段を選ぶボタンを作る。
 * @param {{
 *   mount?: HTMLElement,   置き場所(省略すると作るだけ。あとで el を自分で挿す)
 *   label?: string,        上の行。**何のつまみか**を書く(省略すると 1 行になる)
 *   items: (string|{name:string})[],  下の行に出る名前
 *   index?: number,        はじめの段(既定 0)
 *   wrap?: boolean,        端で回り込むか(既定 true)
 *   colors?: object,       上の COLORS を部分的に差し替える
 *   fontSize?: number,     字の大きさ(px。既定 16。**8 の倍数にすること**)
 *   content?: HTMLElement, **字の代わりに中へ入れるもの**。
 *                          渡すと label / items の字は書かず、中身の面倒は
 *                          呼ぶ側が onChange で見る(遊びかたの案内など、
 *                          板そのものを送りたいときに使う)
 *   mainStyle?: object,    本体の見た目を上書きする(板にするときの地色・枠・余白)
 *   onPastEnd?: () => void, **端の先へ送ろうとしたとき**(wrap が false のとき
 *                          だけ)。最後まで読んだら閉じる、のような締めに使う
 *   onChange?: (index:number, name:string, byUser:boolean) => void,
 * }} opts
 */
export function createStepper(opts) {
  const items = (opts.items || []).map(v => (typeof v === 'string' ? v : v.name));
  if (!items.length) throw new Error('createStepper: items が空です');
  const colors = Object.assign({}, COLORS, opts.colors);
  const wrap = opts.wrap !== false;
  // **8 の倍数にする。** ドット絵の書体は決まった大きさでしか揃わない
  const size = opts.fontSize || 16;
  // 矢印に貸す幅。本体の左右の余白はこれより広く取る(字が矢印に重ならないように)
  const arrowW = 20;

  const root = document.createElement('div');
  root.className = 'mmsxx-stepper';
  root.style.cssText = 'position:relative;display:none;align-self:flex-start';

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'mmsxx-stepper-main';
  main.style.cssText = 'display:block;width:auto;height:auto;'
    // 左右は矢印に貸すぶんだけ広げる
    + `padding:6px ${arrowW + 4}px;`
    + `color:${colors.text};background:${colors.back};background-image:none;`
    + `border:2px solid ${colors.edge};`
    + `font:${size}px/1.4 var(--mmsxx-gui-font, monospace);letter-spacing:0;`
    // **2 行で出す。** 上に何のつまみかを書かないと、段の名前だけでは
    // 何がその段なのか分からない
    + 'white-space:pre;text-align:center;cursor:pointer';
  // **字の代わりに中身を入れる**(板を送りたいとき)。
  // 送る仕掛けは同じものを使いまわす — 半分押しを二度書かない
  if (opts.content) {
    main.style.whiteSpace = 'normal';
    main.appendChild(opts.content);
  }
  if (opts.mainStyle) Object.assign(main.style, opts.mainStyle);

  const arrow = (side, glyph) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mmsxx-stepper-' + side;
    b.textContent = glyph;
    b.setAttribute('aria-label', side === 'prev' ? 'PREVIOUS' : 'NEXT');
    b.style.cssText = 'position:absolute;top:2px;bottom:2px;'
      + `${side === 'prev' ? 'left' : 'right'}:2px;`
      + `width:${arrowW}px;height:auto;padding:0;`
      + `color:${colors.arrow};background:transparent;background-image:none;border:0;`
      + `font:${Math.round(size * 0.75)}px/1 var(--mmsxx-gui-font, monospace);`
      + 'cursor:pointer';
    return b;
  };
  const prev = arrow('prev', '◀');
  const next = arrow('next', '▶');
  /**
   * **左半分 / 右半分の当たり。**
   *
   * 押した場所を座標で測って半分に分けていたが、**板が回っていると崩れる**
   * (画面の座標と、回った板の中の左右が食い違う。90 度で見せる機種では
   * どこを押しても片側になった)。当たりそのものを 2 つに割れば、
   * 場所の計算がまるごと要らない。
   *
   * **矢印より先に並べる。** あとに置いたほうが上に来るので、
   * 矢印の上を押したときは矢印が取る
   */
  const half = (side) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mmsxx-stepper-half-' + side;
    b.setAttribute('aria-label', side === 'prev' ? 'PREVIOUS' : 'NEXT');
    // **height:auto を必ず書く。** 借りる側に `#tools button { height: 32px }`
    // のような指定があると、top/bottom を書いても**高さのほうが勝つ**
    // (上下と高さが同時に決まっているときは bottom が捨てられる)。
    // 実際それで上半分しか受けておらず、**2 行目の数字のあたりを押しても
    // 何も起きなかった**。本体と矢印には書いてあって、ここだけ抜けていた
    b.style.cssText = 'position:absolute;top:0;bottom:0;height:auto;width:50%;'
      + `${side === 'prev' ? 'left' : 'right'}:0;`
      + 'padding:0;border:0;background:transparent;cursor:pointer';
    return b;
  };
  const halfPrev = half('prev');
  const halfNext = half('next');
  root.append(main, halfPrev, halfNext, prev, next);

  /**
   * **指の話を、置かせてもらっている先へ上げない。**
   *
   * 置き場所がスマホの器(engine/util/touchgui.js)の中だと、
   * あちらはメニューのあいだ 払う動きを見分けていて、そこで
   * setPointerCapture を取る。**取られるとこちらのボタンは押し下げた
   * だけで終わり、押せたことにならない**。
   * 実機で「押しづらい」となっていたのがこれで、ときどき効かないのではなく
   * **払いと見なされたぶんが丸ごと落ちていた**。案内の板でも同じことが
   * 起きていて、あちらは同じやりかたで塞いである
   */
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  let index = clamp(opts.index || 0);

  function clamp(n) {
    const len = items.length;
    if (wrap) return ((n % len) + len) % len;
    return Math.max(0, Math.min(len - 1, n));
  }

  function paint() {
    // 中身を渡されているときは、書くのは呼ぶ側の仕事(onChange で受ける)
    if (!opts.content) {
      main.textContent = (opts.label ? opts.label + '\n' : '') + items[index];
    }
    if (!wrap) {
      // 端では沈める。**枠ごと薄くする**(押せないことを見せる)
      prev.style.opacity = index <= 0 ? '0.3' : '1';
      next.style.opacity = index >= items.length - 1 ? '0.3' : '1';
    }
  }

  function set(n, byUser) {
    // **端の先へ送ろうとしたら、締めを呼ぶ**(回り込まないときだけ)。
    // 「最後まで読んだら閉じる」のような終わりかたを、
    // 呼ぶ側が別のボタンを足さずに書けるようにするため
    if (!wrap && byUser && n >= items.length && opts.onPastEnd) { opts.onPastEnd(); return; }
    const at = clamp(n);
    index = at;
    paint();
    if (opts.onChange) opts.onChange(index, items[index], !!byUser);
  }

  // **本体そのものも左右に割れている。**
  // 矢印は「替えられる」と見せるための目印で、指が行くのは字の出ている本体のほう
  const step = (b, d) => b.addEventListener('click', () => { b.blur(); set(index + d, true); });
  step(halfPrev, -1);
  step(halfNext, 1);
  step(prev, -1);
  step(next, 1);

  paint();
  if (opts.mount) opts.mount.appendChild(root);

  return {
    /** 根の要素。置き場所を自分で決めたいときに使う */
    el: root,
    /** いまの段 */
    get index() { return index; },
    /** いまの段の名前 */
    get name() { return items[index]; },
    /** 段を当てる。**onChange は byUser=false で呼ばれる** */
    set(n) { set(n, false); },
    /** 前後へ送る */
    step(d) { set(index + d, true); },
    /** 出し入れ。**矢印ごと**(本体だけ消すと矢印が残る) */
    show(on) { root.style.display = on ? 'block' : 'none'; },
    /** 出ているか */
    get shown() { return root.style.display !== 'none'; },
    /** 片付ける */
    destroy() { root.remove(); },
  };
}
