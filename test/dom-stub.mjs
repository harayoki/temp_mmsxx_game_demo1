// **試験のためだけの、いちばん薄い DOM の当て板。**
//
// ゲーム本体(game/main.js)は読み込みの途中で document を触る。
// 画面なしで回すには、そこで落ちないだけの受け皿が要る。
//
// **本物に似せない。** 要素は「何を聞かれても無い」を返すだけ。
// ゲーム側はもともと「無ければ出さない」で書いてあるところが多いので、
// それに乗る。似せようとすると、こちらが第二のブラウザになってしまう。
const noop = () => {};
const style = new Proxy({}, {
  get: (t, k) => (k === 'setProperty' || k === 'removeProperty' ? noop : (t[k] ?? '')),
  set: (t, k, v) => { t[k] = v; return true; },
});
function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    style, dataset: {}, children: [], classList: {
      add: noop, remove: noop, toggle: noop, contains: () => false,
    },
    innerHTML: '', textContent: '', value: '',
    appendChild: (c) => c, append: noop, replaceChildren: noop, remove: noop,
    insertBefore: (c) => c, setAttribute: noop, getAttribute: () => null,
    removeAttribute: noop, addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getContext: () => null, focus: noop, blur: noop, click: noop, closest: () => null,
    dispatchEvent: () => true, contains: () => false,
  };
  return el;
}
const doc = {
  documentElement: makeEl('html'),
  body: makeEl('body'),
  head: makeEl('head'),
  // **画面は返さない。** null が返れば、エンジンは headless で立ち上がる
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (t) => makeEl(t),
  createElementNS: (ns, t) => makeEl(t),
  addEventListener: noop, removeEventListener: noop,
  createTextNode: (t) => ({ textContent: t }),
  fonts: { ready: Promise.resolve() },
  visibilityState: 'visible',
  hidden: false,
};
const win = {
  document: doc,
  location: { href: 'http://localhost/', search: '', pathname: '/', origin: 'http://localhost' },
  navigator: { userAgent: 'node', language: 'ja', maxTouchPoints: 0 },
  localStorage: (() => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      clear: () => m.clear(),
    };
  })(),
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: noop,
  devicePixelRatio: 1,
  innerWidth: 1280, innerHeight: 720,
  getComputedStyle: () => new Proxy({}, { get: () => '' }),
};
win.window = win;
win.top = win;
win.self = win;

/** グローバルへ据える。**game/main.js を読み込む前に呼ぶこと** */
export function installDomStub() {
  globalThis.window = win;
  globalThis.document = doc;
  // navigator は Node にもう在って**書き換えを断る**ので、無いときだけ据える
  if (!globalThis.navigator) {
    Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
  }
  globalThis.localStorage = win.localStorage;
  // **裸で使われるもの**も据える(location / innerWidth など。
  // ゲーム側は window を付けずに書いているところがある)
  globalThis.location = win.location;
  globalThis.innerWidth = win.innerWidth;
  globalThis.innerHeight = win.innerHeight;
  globalThis.devicePixelRatio = win.devicePixelRatio;
  globalThis.addEventListener = win.addEventListener;
  globalThis.removeEventListener = win.removeEventListener;
  globalThis.getComputedStyle = win.getComputedStyle;
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  globalThis.matchMedia = win.matchMedia;
  return { window: win, document: doc };
}
