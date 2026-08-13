# MMS/XX Engine UTIL

`engine/util/` は「ゲームでよくある表現」をまとめた**任意の部品**です。
エンジン本体（`engine/*.js`）からは切り離してあり、**import しなければ 1 バイトも読み込まれません**。
本体の API だけでゲームは作れます。UTIL は「あると楽」という位置づけです。

```js
import { StoryScenes } from './engine/util/story.js';
import { StaffRoll }   from './engine/util/staffroll.js';
import { Gallery }     from './engine/util/gallery.js';
import { SoundTest }   from './engine/util/soundtest.js';
import { Ranking, byScore, byTime } from './engine/util/ranking.js';
import { RankingBoard, LocalRankingSource } from './engine/util/ranking-board.js';
// これだけ engine/util/ ではなく online/ にある(公開しない実装の置き場)
const { RemoteRankingSource } = await import('./online/ranking-remote.js');
```

## 共通の作法

どれも同じ形で使います。

1. `new Xxx(mmsxx, opts)` で作る
2. `start()` / `open()` で始める
3. **毎フレーム `update()` を呼ぶ**。終わったら `true` を返す
4. 終わりは `onEnd` / `onExit` のコールバックで受ける

描く先は**レイヤー番号**で指定します（ゲーム側のレイヤー構成に合わせられるように）。
画面サイズ（256x192）は `engine/video.js` から取っています。

**同じインターフェースで別実装に差し替える**ことを前提にしています。
たとえばランキングは保存先を丸ごと入れ替えられますし、
バーチャルパッド（これから）も同じ考え方で作ります。

---

## 1. `story.js` — `StoryScenes`

オープニング / エンディング。**絵を見せながら下に文章を出し、何秒かで次の場面へ**。

| オプション | 既定 | 意味 |
|---|---|---|
| `scenes` | — | 場面の配列（下記） |
| `artLayer` | 0 | 絵を描くレイヤー |
| `textLayer` | artLayer | 文字を描くレイヤー |
| `textY` | 下から 2 行ぶん上 | 文章の 1 行目の y |
| `lineStep` | 12 | 行間 |
| `typing` | 0.5 | 1 フレームに出す文字数（0 = 一度に全部） |
| `gap` | 12 | 場面と場面のあいだの暗転（フレーム） |
| `skipKeys` | Space | 押すと先へ進む |
| `manual` | false | true にすると**時間では進まない**。押されるまでその場面のまま |
| `prompt` | — | 「押すと次へ」を伝える 8x8 の絵（下記） |
| `onEnd` | — | 最後の場面が終わったら呼ばれる |

**場面**（`scenes[]` の 1 つ）:

| キー | 意味 |
|---|---|
| `hold` | この場面を見せるフレーム数（既定 240 = 4 秒） |
| `text` | 下に出す文章（文字列の配列） |
| `textColor` | 文字色（既定 15） |
| `draw(mmsxx, artLayer)` | 絵を描く。レイヤーは暗転のあいだに消えている |
| `sprites()` | 出したいスプライトの配列。場面が終わると自動で隠す |
| `onEnter(mmsxx)` | 曲を変えるなど |

- `length` … 全体で何フレームになるか（尺の確認用）
- `skip()` … 文章がまだ出そろっていなければ全部出す、済んでいれば次の場面へ（**2 回押しで送る**）
- `stop()` … 途中でやめるときの後始末

**`prompt`**（文字を出さずに「押してほしそう」を伝える）:

| キー | 意味 |
|---|---|
| `frames` | パラパラ動かす 8x8 の絵（2 枚以上） |
| `rate` | 1 コマ何フレームか（既定 10） |
| `x` / `y` | 置く場所。**省略すると文章の最後の行のうしろ**に付く |
| `after` | 文章が出そろってから何フレーム待って出すか（既定 0） |

文章がまだ出ている途中は出ません（読んでいる最中に急かさないため）。

```js
const ending = new StoryScenes(mmsxx, {
  artLayer: 3, textLayer: 4, textY: 152,
  scenes: [
    { hold: 240, text: ['THE KING FLED INTO', 'A BLUE RIFT IN SPACE.'],
      draw: (m, art) => art.draw(96, 40, IMG.riftBlue) },
  ],
  onEnd: () => enterTitle(),
});
ending.start();
```

---

## 2. `staffroll.js` — `StaffRoll`

下から上へ文字が流れるスタッフロール。

| オプション | 既定 | 意味 |
|---|---|---|
| `lines` | — | 流す行（空文字は 1 行ぶんの空き） |
| `layer` | 0 | 描くレイヤー |
| `headings` | 空 | 見出しにする行の `Set`（色を変える） |
| `step` | 16 | 行間 |
| `speed` | 0.35 | 1 フレームに動くドット数 |
| `color` / `headingColor` | 15 / 11 | 色 |
| `top` / `bottom` | 8 / 184 | この範囲の外は描かない |
| `skipKeys` | Space / ESC | 押すと最後まで飛ばす |
| `onEnd` | — | 流し終わったら呼ばれる |

- `length` … 流れきるまでのフレーム数

---

## 3. `gallery.js` — `Gallery`

図鑑（グラフィック一覧）。**1 ページ 1 枚を左右でめくる**。
見出しと「**何ページ中の何ページ目か**」を自動で出します。

| オプション | 既定 | 意味 |
|---|---|---|
| `pages` | — | ページの配列（下記） |
| `hudLayer` | 0 | 見出し・文字のレイヤー |
| `artLayer` | hudLayer | 絵のレイヤー |
| `titleY` | 8 | 見出しの y |
| `showCount` | true | 右上に `3/17` を出すか |
| `help` / `helpY` | '' / 180 | 下に出す操作の案内 |
| `wrap` | true | 端で反対側へ回り込む |
| `exitKeys` | ESC | 閉じるキー |
| `onExit` | — | 閉じたら呼ばれる |

**ページ**:

| キー | 意味 |
|---|---|
| `title` | 見出し（`- TITLE -` の形で出る） |
| `draw(mmsxx, artLayer, hudLayer)` | 中身を描く |
| `update(mmsxx)` | 毎フレームの動き（明滅・色変わりなど） |
| `leave(mmsxx)` | そのページを離れるときの後始末（スプライトを消すなど） |

- `open(index)` / `turn(n)` / `update()`
- 操作は **←→でページ送り**。SPACE は**先へ進むだけ**
- 上下は使わない（**上下 = スクロール / 左右 = ページ送り**で全画面を揃えるため）

---

## 4. `soundtest.js` — `SoundTest`

曲と効果音を列に並べて選んで鳴らすページ。

| オプション | 既定 | 意味 |
|---|---|---|
| `columns` | — | 列の配列（下記） |
| `layer` | 0 | 描くレイヤー |
| `rows` | 8 | 一度に出す行数（選んでいる行が真ん中に来る） |
| `header` | `- SOUND TEST -` | いちばん上の見出し |
| `help` / `helpY` | 既定の案内 / 180 | 下の案内 |
| `note()` / `noteY` | — / 168 | 「いま鳴っているもの」を毎フレーム出す |
| `playKeys` / `exitKeys` | Space / ESC | キー |
| `stop()` | — | 閉じるときに呼ぶ「止める処理」。止める操作を出したいときは、一覧の項目として並べる |
| `onExit` | — | 閉じたら呼ばれる |

**列**: `{ title, items: string[], play(name, index), x? }`

- 操作は **←→で列、↑↓で曲**、`current` でいま選んでいる名前が取れる

---

## 5. `ranking.js` — `Ranking`

得点でもタイムでも使えるランキング表。並び順は比較関数で決めます
（`byScore` = 高いほど上位 / `byTime` = 短いほど上位）。

> **手元だけで完結する版です。**
> サーバに載せる見込みがあるなら [6. `RankingBoard`](#6-ranking-boardjs--rankingboard) を使ってください。
> こちらは「保存先がその場で値を返す」前提なので、非同期の保存先は入りません。

| オプション | 既定 | 意味 |
|---|---|---|
| `key` | — | 保存に使うキー |
| `max` | 100 | 記録する件数 |
| `defaults` | [] | 足りないぶんを埋める既定データ |
| `compare` | byScore | 並び順 |
| `storage` | localStorage | **保存先（差し替えられる）** |
| `meKey` | key + '-me' | 「自分の記録」を覚えるキー |

| メソッド | 意味 |
|---|---|
| `qualifies(entry)` | この記録が表に載るか |
| `rankOf(entry)` | **入れたら何位になるか**（0 起点。載らないときは -1）。登録前に見せる用 |
| `add(entry, asMine?)` | 追加して保存。入った順位を返す |
| `myIndex()` | 自分の記録が何番目か |
| `top()` / `page(top, rows)` / `reset()` | |

### 保存先の差し替え

`storage` に次の 3 つを持ったものを渡せば、localStorage でもサーバでも構いません。

```js
{
  load(key)         // 値（あるいは Promise）
  save(key, value)  // void（あるいは Promise）
  remove(key)       // void（あるいは Promise）
}
```

同梱は `LocalStorageStore`（既定）と `MemoryStore`（テスト用）。
サーバ上の共通ランキングに替えるときは、この形を実装したものを差し込みます。
いまは同期の保存先しか使っていませんが、非同期へ広げられるよう戻り値を見ない作りです。

---

## 6. `ranking-board.js` — `RankingBoard`

サーバに載せられるランキング表。`Ranking` との違いは**通信を前提にしている**ことだけで、
読み出しの使い勝手は変わりません。

`Ranking` をそのまま非同期にすると「毎回 `await` してから描く」ことになり、
"開いた瞬間に出る" 手ざわりが壊れます。そこで **手元に一覧の写しを持ち、
読み出しは同期のまま**にしてあります。通信するのは 2 か所だけです。

```js
// 同期。描画も判定もこれだけ使う（Ranking と同じ書き味）
board.entries / board.me
board.top() / board.page(top, rows)
board.qualifies(entry) / board.rankOf(entry) / board.myIndex()

// 非同期。通信するのはこの 2 つだけ
await board.refresh()      // 一覧を取り直す。投げっぱなしで呼ぶ
await board.submit(entry)  // 登録して、サーバが数えた順位を受け取る
```

| オプション | 既定 | 意味 |
|---|---|---|
| `key` | — | この表を指すキー |
| `max` | 100 | 手元に持つ件数 |
| `defaults` | [] | 足りないぶんを埋める既定データ |
| `compare` | byScore | 並び順 |
| `source` | `LocalRankingSource` | **供給元（差し替えられる）** |
| `meKey` | key + '-me' | 「自分の記録」を覚えるキー |
| `meStore` | localStorage | 自分の記録の保存先（供給元がサーバでも必ず手元） |
| `minIntervalMs` | 30000 | 取り直しの間隔の下限 |

| メソッド | 意味 |
|---|---|
| `qualifies(entry)` / `rankOf(entry)` / `myIndex()` | `Ranking` と同じ（**手元の写しでの判定**） |
| `add(entry, asMine?)` | 手元へ入れて順位を**同期で**返し、裏で登録も投げる |
| `submit(entry, asMine?)` | 登録して**正しい順位**を受け取る（唯一プレイヤーを待たせる場所）。**送り直しても二重に載らない** |
| `refresh({force?})` | 一覧を取り直す。**決して例外を投げない** |
| `save()` | 手元の一覧を書き戻す（古い記録の手入れなど。サーバ相手では何も起きない） |
| `reset()` | 既定データに戻す（**手元だけ**。サーバの記録には触らない） |
| `editable` | 手元の記録を直接いじれるか（サーバ相手なら false） |
| `busy` / `fetchedAt` / `lastError` | 取得の様子 |

### 割り切っていること

- **順位はだいたい合っていればよい。** 遊んでいる最中の `qualifies()` / `rankOf()` は
  手元の写しで判定するので、実際とずれることがあります。次に取り直せば直ります
- **取れなくても遊びは止まらない。** `refresh()` は失敗しても手元の写しを残して `false` を返すだけ
- **表示中に入れ替わっても描き直さない。** 次にその画面を開いたときに新しくなります
- **`submit()` は送り直しても安全。** 送れなかった記録は手元の一覧へ入ったままなので、
  同じ記録をもう一度送るときは先に取り除いてから入れ直します。
  何度 RETRY しても同じ名前が並ぶことはありません
  （別の記録を送るときは、前に送れなかったぶんはそのまま残します）

### 供給元（source）の差し替え

```js
{
  fetch(key, ctx)          -> Promise<entries[]>        一覧を取る
  submit(key, entry, ctx)  -> Promise<{rank, entries?}> 記録を送る
  peek(key)                -> entries[] | null   任意。同期で出せる値があれば
  replace(key, entries)    -> Promise<void>      任意。一覧を丸ごと差し替える
  clear(key)               -> Promise<void>      任意。消す
}
```

同梱の `LocalRankingSource` は localStorage を読み書きしますが、
**同期で済むものまで Promise で返します**。サーバ版と呼ばれ方をそろえてあるので、
切り替えは `source` を渡す 1 行だけです。

`peek()` は「起動した瞬間から並んでいてほしい」ための抜け道。ローカル保存は持っている
ので今までどおり即座に出ます。サーバは持たないので、既定データから始まって
`refresh()` のあとで本物に入れ替わります。

`replace()` / `clear()` は手元の記録をいじる操作なのでローカル保存だけが持ちます
（`editable` がこれを見ています）。サーバ側の削除・無効化は管理者の仕事です。

### 通信の遅さと失敗を試す

サーバへ繋がなくても「取れるまでのあいだ何が見えているか」
「取れなかったときどうなるか」を確かめられます。

```js
new LocalRankingSource({ delay: 5 })        // 取得・登録に 5 秒かかることにする
new LocalRankingSource({ errorRate: 0.3 })  // 3 割の見込みで失敗することにする
LocalRankingSource.defaultDelay = 5;        // 既定を 5 秒にする
LocalRankingSource.defaultErrorRate = 0.3;  // 既定を 3 割にする
```

失敗するのは通信に当たる `fetch()` と `submit()` だけです。
**遅れを待ってから失敗します**（待たされた末に駄目だった、という一番つらい形）。
`replace()` / `clear()` は手元の手入れなので、失敗もしないし待ちもしません。

`submit()` が失敗すると手元にも保存されないので、読み込み直すとその記録は消えます。
サーバが受け取れなかったときと同じことなので、これでよいことにしています。

どちらかを入れているあいだは **`peek()` が値を返しません**。サーバには同期で出せる値が
無いので、そこも同じにしてあります。つまり既定データから始まって取れた時点で
入れ替わる ―― 本番と同じ道筋を手元でたどれます。
（ここで値を返してしまうと、一覧が最初から並んでしまい、待っている様子も
取れなかった様子も見えなくなります）

---

## 7. `online/ranking-remote.js` — `RemoteRankingSource`

`RankingBoard` の供給元をランキングサーバにするもの。
**`fetch` を含むコードはここだけ**なので、手元だけで遊ぶゲームはこのファイルを
読み込まずに済みます。

これだけは `engine/util/` ではなく **`online/`** に置いてあります。
ソースを一般公開するときにフォルダごと外せるようにするためで、
外した配布物では手元の保存に落ちて遊べます。→ [online/README.md](../online/README.md)

```js
new RemoteRankingSource({
  dev: true,                       // 開発用サーバか本番か(URL は部品側が持つ)
  browserId,                       // 値でも関数でもよい
  playId: () => currentPlayId,     // 送るたびに今の値を聞く
  timeoutMs: 5000,
  games: {
    'mygame-scores': {
      gameId: 'mygame-normal',     // サーバ側のゲーム
      rankingKey: 'high-score',    // どの並びを見るか
      valueKey: 'score',           // 記録が持っている値の名前
    },
  },
});
```

`RankingBoard` は自分の `key` で問い合わせてくるので、そこから宛先を引きます。
1 つの供給元を複数の表で使い回せます。

| 口 | API |
|---|---|
| `fetch(key)` | `GET /api/v1/rankings/{gameId}/{rankingKey}?limit=100` |
| `submit(key, entry)` | `POST /api/v1/runs` |
| `peek` / `replace` / `clear` | 持たない |

- サーバの順位は **1 位から**数えるので、1 引いて 0 起点にして返します
- `409 PLAY_ALREADY_SUBMITTED` は**失敗にしません**。すでに登録できているので、
  手元の見込み順位をそのまま使います
- それ以外の失敗はすべて `RankingRequestError`（`status` と `code` を持つ）にそろえます
- `timeoutMs` を過ぎたらあきらめます。取れなくても遊びは止まらないので短くて構いません
- `playId` は 1 プレイに 1 つ。送り直しても同じ ID を使えば二重に載りません
- `playId` / `browserId` は **UUID の形**でなければ受け取ってもらえません

宛先（開発用と本番の URL）は**部品側が両方とも持っていて**、`dev` で選びます。
引っ越したときに直す場所を 1 か所にするためです。別の宛先を見たいときだけ
`baseUrl` を渡すと、そちらが優先されます。

### 送信確認（Turnstile）

`turnstile` を渡すと、記録を送る直前に Cloudflare Turnstile のトークンを
1 枚もらって一緒に送ります。**既定では本番（`dev: false`）のときだけ**有効で、
開発用サーバへは何も添えません（`turnstile: null` で明示的に切れます）。

→ [online/turnstile.js](../online/turnstile.js)

- Cloudflare のスクリプトを読むのは**初めて記録を送るとき**だけ。
  起動時にも一覧を取るときにも通りません
- ふだんは画面に何も出ません（怪しいと判断されたときだけ確認の枠が出ます）
- トークンは使い捨てなので送るたびに取り直し、枠が 1 つなので送信は 1 件ずつ通します
- 失敗も `RankingRequestError` にそろえるので、呼ぶ側は場合分けが要りません
- `siteKey` は公開してよい値です。**secret key はゲームに入れません**

---

## 8. `urloptions.js` — `urlOptions`

**URL で変えられる設定**をまとめて読む部品。画面の大きさ・色合い・スプライトの
枚数・コマ数・音など、**どのゲームでも意味が同じもの**だけを持ちます。

```js
import { urlOptions } from '../engine/util/urloptions.js';

const URL = urlOptions(location.search, {
  dev: BUILD.dev,
  devOnly: ['fps'],                        // 開発版でだけ効かせる
  drop: ['scale'],                         // その項目を無かったことにする
  defaults: { linesprites: 4, maxsprites: 32 },   // 既定値の差し替え
});
const mmsxx = new MMSXXEngine(canvas, { ...URL.engine, virtualWidth: 256 });
URL.apply(mmsxx);   // 色合いと音は、作ったあとに効かせる
```

読める指定です。

| 指定 | 中身 |
|---|---|
| `?scale=3` | 画面の拡大率（1〜8） |
| `?fps=60` | 1 秒あたりのコマ数（1〜120） |
| `?linesprites=4` | **1 行**に出せるスプライトの数（0 = 無制限） |
| `?maxsprites=32` | 画面ぜんぶで出せる数（0 = 無制限） |
| `?rotate=stride` | 消える順の回しかた（step / stride / random / slow / off） |
| `?slow=24` | この数を超えたら処理落ち（0 = しない） |
| `?slowmode=soft` | 落ちかた（hard / soft） |
| `?slowfps=30` | 処理落ち中のコマ数（hard のとき） |
| `?palette=rf` | 画面の色合い |
| `?mute=1` | 音を消して始める |
| `?volume=70` | 音の大きさ（0〜100） |

**おかしな値や知らない名前は黙って既定に戻します。** URL をいじった人が、
動かない画面に当たらないようにするためです。

「どの面から始めるか」のような**そのゲームだけの話は持ちません**。
ゲーム側で `URLSearchParams` を読んでください
（STAR FABLE は `?mode=` `?stage=` `?seed=` `?invincible=` を自分で読んでいます）。

## STAR FABLE での使いどころ

| UTIL | 使っているところ |
|---|---|
| `StoryScenes` | エンディング |
| `StaffRoll` | スタッフロール |
| `Gallery` | CHARACTERS(図鑑) |
| `SoundTest` | SOUND TEST |
| `RankingBoard` | ハイスコア・ボスラッシュのタイム（供給元は localStorage） |
| `urlOptions` | 画面まわりの URL 指定（`?fps=` は開発版だけにしてある） |
| `ICONS` | 音のラッパ（画面のスプライトと DOM のボタンを同じ並びから作る） |
| `artexport` | 絵の書き出し（開発版のコンソールから `mmsxxArt` / `mmsxxSheet`） |

`?delay=5` / `?error=0.3` を付けて開くと、通信の遅さと失敗を手元で試せます。
サーバへ繋ぐ段取りは [RANKING_PLAN.md](RANKING_PLAN.md) にまとめてあります。

## 9. `device.js` — `isMobileLike` / `useUAParser`

**スマホ・タブレットかどうか**の 1 ビットだけを返す部品。出しかたを変えるためのもので、
**キーの受け付けを塞ぐためのものではありません**（文字の打ち込みはいつでも素通し）。

```js
import { isMobileLike } from '../engine/util/device.js';
if (isMobileLike()) { /* パッドを出す / TAP TO … に替える */ }
```

| 使いどころ | 条件 |
|---|---|
| バーチャルパッドを出す | `isMobileLike()` |
| ALT のショートカットと、その案内 | `!isMobileLike()` |
| `SPACE TO …` を `TAP TO …` に | `isMobileLike()` |

**キーボードが付いていてもスマホはスマホ**として扱います。タブレットに繋いだ
キーボードは名前入力などでそのまま使えるので、塞ぐ必要がありません。

### 判定の順

1. `?device=mobile` / `?device=desktop` の上書き（PC で確かめるために要る）
2. 差し替えられた判定（`useUAParser`）。`undefined` を返すと次へ落ちる
3. `navigator.userAgentData.mobile`（Chromium 系だけ）
4. UA 文字列。iPad は `Macintosh` かつ `maxTouchPoints > 1` で拾う
5. `(pointer: coarse)` かつ `(any-pointer: fine)` でない

### もっと確かに見分けたいとき

ここの判定は目安です。**エンジンは npm の部品に依存しない**ので、要るゲームだけが
入れて差し替えます。

```js
npm i bowser

import Bowser from '../vendor/bowser/bowser.js';
import { useUAParser } from '../engine/util/device.js';

useUAParser(() => {
  const type = Bowser.parse(navigator.userAgent).platform.type;
  return type ? type !== 'desktop' : undefined;   // 分からなければ目安へ
});
```

`ua-parser-js` は v2 から AGPLv3 と有償の二択になったので、緩いものを選ぶなら
`bowser`（MIT）などにしてください。バンドラを通さない配布では、読ませるファイルを
[vendor/](../vendor/README.md) へ写す手当ても要ります。

---

## 10. `icons.js` — `ICONS` / `iconSymbol` / `iconDataURL`

**どのゲームでも使いそうな絵**を、ドットの並びで持っておく部品。
いまは音のラッパ(`soundOn` / `soundOff`、16x16 の 2 色)が入っている。

```js
import { ICONS, iconSymbol, iconDataURL } from '../engine/util/icons.js';

const sp = mmsxx.sprite(iconSymbol(mmsxx, ICONS.soundOn, { accent: 7 }));
btn.style.backgroundImage = `url("${iconDataURL(mmsxx, ICONS.soundOn, { accent: 7 })}")`;
```

**画面のスプライトと DOM のボタンを、同じ並びから作る**のが狙い。
絵文字(🔊 など)は環境ごとに字形が違うので、画面と DOM で別の絵になってしまう。

- 並びは `#`(本体)と `+`(差し色)の 2 色。**色は使う側が決める**
- `iconDataURL` は**パレットの色で描く**ので、色合いを切り替えたら呼び直せば付いてくる
- 作ったものは覚えておいて、同じ絵・同じ色・同じ色合いなら作り直さない

## 11. `artexport.js` — `exportSymbol` / `exportSheet` / `downloadArt`

**絵を画像として書き出す**開発用の道具。外の道具で見たり直したり、
素材の一覧を作って抜けを確かめたりするため。

```js
import { exportSymbol, exportSheet, downloadArt } from '../engine/util/artexport.js';

downloadArt(exportSymbol(mmsxx, SPRITE_SYMBOLS.player, { scale: 4 }), 'player.png');
downloadArt(exportSheet(mmsxx, SPRITE_SYMBOLS, { scale: 2, width: 512, padding: 4 }), 'sheet.png');
```

- 倍率は整数倍(ドットはぼかさない)
- まとめて並べるときは**いちばん大きい絵に合わせた升目**に置く。幅と余白を決められる
- 色は**画面と同じパレット**から引く。透明(色番号 0)は透けたまま残る
- 出てくるのは canvas。**保存はしない**(呼んだ側が落とすなり送るなり決める)
- `{ label: true }` で**升目の下に名前**が出る(エンジンの 8x8 の字を 4x8 に間引いて描く)
- `{ checker: true }` で**透けているところに白と灰の市松**を敷く。
  画像編集の道具と同じ見え方なので、どこが透明かひと目で分かる
  (`background` で色を指定したときは そちらが勝つ)
- 渡せるのは 3 通り。名前つきの入れもの / 絵の配列 / **`[名前, 絵]` の配列**。
  3 つめは**同じ名前が何枚あってもそのまま並ぶ**ので、一覧に向く

### 作った絵をぜんぶ出す

エンジンは**開発版のあいだ、作った絵を控えています**(`mmsxx.symbols()`)。
`bgSymbol()` / `spriteSymbol()` で登録したものに加えて、
**色替え・走査線・反転で派生した絵も入る**ので、
「ゲーム側の辞書に入れ忘れた絵」も漏れません。

```js
mmsxx.symbols()          // [{ name, kind, width, height, derived, sym }, ...]
mmsxx.trackSymbol(sym)   // 自前で derive() した絵を控えに足す(公開版では何もしない)
```

**公開版では控えません。** 控えると使い終わった派生の絵も捨てられなくなるためです
(`engine.js` が `_dev` を見て決めます)。

STAR FABLE では開発版のコンソールから呼べる。

```js
mmsxxArt('player', 4)           // 1 枚を 4 倍で
mmsxxSheet('sprite', 2, 512)    // スプライトを 2 倍で 512 ドット幅に並べて
mmsxxSheet('bg', 1, 1024)       // BG も同じように
mmsxxSheet('all', 1, 1024)      // **作った絵ぜんぶ**(派生したものも含む)
mmsxxSheets()                   // 大きさで組に分けて何枚かに落とす(下を見ること)
mmsxxSymbols()                  // 名前と大きさの一覧(文字)
```

`mmsxxSheets()` が組に分けるのは、**1 枚にまとめると升目がいちばん大きい絵に
合わせて巨大になる**ため。`sprite` / `bg-small`(64 ドット以下) / `bg-large` に分けて落とす。

`mmsxxSymbols()` の文字の一覧は、**絵を直したときの差分を git で追う**のに使える。

索引(JSON)を添えて読み戻せるようにするのは V2([TODO.md](TODO.md) の L)。

## 12. `gamepad.js` — `createGamepad`

**ゲームパッドを読んで、押した / 離した を呼び出し側へ通知する**部品。
`Input` は知らないので、ゲームは「キーのコードへ変換して流し込む」、
確かめる器は「画面へ書き出す」と、同じ部品を別の使いかたができる。

```js
import { createGamepad } from '../engine/util/gamepad.js';

const pad = createGamepad({
  press:   (code) => mmsxx.input.press(code, 'pad'),   // **第 2 引数を忘れない**
  release: (code) => mmsxx.input.release(code),
  map: { 9: 'Escape', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight' },
});
pad.poll();   // 毎コマ。**ゲームが入力を読む前に**呼ぶと遅れ 0 コマ
```

- **`mapping === 'standard'` のパッドだけ相手にする**。それ以外は番号が製品ごとに
  ばらばらなので、当てずっぽうで読むと押していないボタンでポーズが掛かる。
  `usable()` / `unsupported()` で分けて数えられる
- **十字（12〜15）と左スティックはどちらでも動く**（`mode` で片方だけにもできる）
- スティックの遊びは `deadzone`（既定 0.5）。**機種で癖が違う**ので外から変えられる
- **パッドはボタンを 1 回押すまで見えない**（指紋取りの防止）。
  `onRawPress` で「押された」を受けて、そこから案内を出す
- 見失ったとき・画面が非アクティブになったときは**押していたものを全部離す**
  （残ると自機が流れ続ける）
- 使うパッドは既定で**最後にボタンを押されたもの**。`index` で固定もできる
- `rapid` で連射を掛けられる（既定 0＝なし）。手ざわりを見るための口で、ゲームでは使わない

確かめる器は `tools/gamepad-tool/`（配布には入らない）。詳しくは [GAMEPAD.md](GAMEPAD.md)。

## 13. `notice.js` — `createNotice`

**キャンバスの上に重ねる、読ませて止めるための知らせ**。

```js
import { createNotice } from '../engine/util/notice.js';

const notice = createNotice(mmsxx, {
  mount: document.getElementById('stage'),
  canvas: document.getElementById('screen'),
});
notice.show('道具を認識しました。', (e) => {
  if (e.code === 'Escape') やめる(); else つかう();
}, [{ label: '使う（SPACE）', code: 'Space' }, { label: '使わない（ESC）', code: 'Escape' }]);

if (notice.open) return;   // 出ているあいだはゲームを進めない(**呼ぶ側の仕事**)
```

- **キャンバスへ描かない。** 描くと共有の絵や録画に写り込み、文字も 8 ドットの升目に縛られる。
  かといって画面の下へ置くと**キー入力が二重になったり奪われたりする**ので、上に重ねる
- **キーボードを 1 回押すと閉じる。** どのキーで閉じたかを呼び出し側へ渡すので、
  「ESC ならやめる、それ以外なら使う」のような分けかたができる
- **ボタンも置ける。** キーボードの無い端末はこれでしか答えられない。
  押すと、そのキーが押されたのと同じ返事になる
- **閉じたキーはゲームへ渡さない**（`input.clear()`）。渡すと、タイトルでスペースを
  押しただけでゲームが始まってしまう
- **キーかクリックで閉じてもらうこと自体に意味がある。** ブラウザはパッドやセンサーの
  操作を「人が触った」と数えないので、これが**音の解禁**を兼ねる
  （ボタンを押したときは `audio.unlock()` を呼ぶ）
- **音は持たない。** 鳴らすかどうか・どの音かはゲームが決める（返事を受けたところで鳴らす）

## これから作るもの

- **バーチャルパッド** … 同じ考え方で、見た目と配置を差し替えられる形にする（[TODO.md](TODO.md) J-2）
- **ランキングの表示** … 一覧の描画も UTIL 側に寄せるか検討中
- **ランキングサーバへ接続** … `source` を `RemoteRankingSource` に差し替える（[RANKING_PLAN.md](RANKING_PLAN.md)）
- **スマホのセンサー** … ジャイロ・位置情報（まだやらない）
