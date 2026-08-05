// **端末の見分け**。返すのは「スマホ・タブレットか」の 1 ビットだけ。
//
//   import { isMobileLike } from './engine/util/device.js';
//   if (isMobileLike()) { ... }
//
// ## 何に使うか
//
// 出しかたを変えるためのもので、**キーの受け付けを塞ぐためのものではない**。
//   ・バーチャルパッドを出すか           … isMobileLike()
//   ・ALT のショートカットと、その案内     … !isMobileLike()
//   ・「SPACE TO …」を「TAP TO …」にするか … isMobileLike()
//
// 文字の打ち込み(名前入力・裏技)は**いつでも素通し**にすること。
// タブレットにキーボードを繋いだ人は、そのまま打てたほうがよい。
//
// ## ここの判定は最低限
//
// UA の見分けは当たり外れがあるので、ここでは目安しか見ていない。
// **ちゃんとやりたいなら部品を入れて、判定だけ差し替える**:
//
//   npm i bowser
//
//   import Bowser from '../vendor/bowser/bowser.js';
//   import { useUAParser } from './engine/util/device.js';
//   useUAParser(() => Bowser.parse(navigator.userAgent).platform.type !== 'desktop');
//
// 入れなくても下の目安で動く。**エンジンは npm の部品に依存しない**ので、
// 入れるかどうかは使う人が決めてよい。
//
// ## URL で上書きできる
//
//   ?device=mobile    … スマホとして扱う
//   ?device=desktop   … PC として扱う
//
// PC でスマホ用の画面を確かめるために要る。知らない値は無視して自動判定に戻す。

/** 差し替えられた判定。null なら自前の目安を使う */
let uaParser = null;
/** 一度決めたら覚えておく(何度も聞かれるため)。null = まだ調べていない */
let cached = null;

/**
 * UA の判定を差し替える。**エンジンからは呼ばない**(使う人が呼ぶ)。
 * @param {(() => boolean) | null} fn true でスマホ・タブレット。
 *   分からないときは undefined を返せば、下の目安へ落ちる
 */
export function useUAParser(fn) {
  uaParser = typeof fn === 'function' ? fn : null;
  cached = null;   // 差し替えたら調べ直す
}

/** 覚えたものを捨てる(試すときに使う) */
export function resetDevice() { cached = null; }

/** スマホ・タブレットか。**キーボードが付いていてもスマホはスマホ**として扱う */
export function isMobileLike() {
  if (cached === null) cached = detect();
  return cached;
}

/** URL の ?device= を読む。無ければ null */
function fromSearch() {
  if (typeof location === 'undefined') return null;
  try {
    const v = new URLSearchParams(location.search).get('device');
    if (v === 'mobile') return true;
    if (v === 'desktop') return false;
  } catch (e) { /* 読めなくても続ける */ }
  return null;
}

/** 上から順に見て、決まったところで返す */
function detect() {
  const forced = fromSearch();
  if (forced !== null) return forced;

  // 差し替えられた判定(bowser など)。分からなければ次へ
  if (uaParser) {
    try {
      const v = uaParser();
      if (typeof v === 'boolean') return v;
    } catch (e) { /* 壊れていても止めない */ }
  }

  if (typeof navigator === 'undefined') return false;   // ブラウザの外

  // ブラウザが直接答えてくれる場合(Chromium 系だけ)。**部品なしで一番確か**
  const uaData = navigator.userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;

  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13 以降は Macintosh を名乗る。指が 2 本以上使えるかで見分ける
  if (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;

  // 最後の目安。**指で触れて、かつマウスが無い**ものをスマホ扱いにする。
  // タッチの付いたノート PC はマウスもあるので、ここには落ちない
  if (typeof matchMedia === 'function') {
    try {
      return matchMedia('(pointer: coarse)').matches
        && !matchMedia('(any-pointer: fine)').matches;
    } catch (e) { /* 古い環境では PC 扱い */ }
  }
  return false;
}
