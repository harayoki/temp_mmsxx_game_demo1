# MMSXX Engine UTIL

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
import { RemoteRankingSource } from './engine/util/ranking-remote.js';
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
| `skipKeys` | Space / Z / Enter | 押すと先へ進む |
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
| `skipKeys` | Space / Z / ESC | 押すと最後まで飛ばす |
| `onEnd` | — | 流し終わったら呼ばれる |

- `length` … 流れきるまでのフレーム数

---

## 3. `gallery.js` — `Gallery`

図鑑（グラフィック一覧）。**1 ページ 1 枚を上下でめくる**。
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
- 操作は **↑↓（←→も可）でページ送り**

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
| `playKeys` / `stopKeys` / `exitKeys` | Space / Z / ESC | キー |
| `stop()` | — | 止める処理 |
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

サーバがまだ無いうちに「取れるまでのあいだ何が見えているか」
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

## 7. `ranking-remote.js` — `RemoteRankingSource`

`RankingBoard` の供給元をランキングサーバにするもの。
**`fetch` を含むコードはここだけ**なので、手元だけで遊ぶゲームはこのファイルを
読み込まずに済みます。

```js
new RemoteRankingSource({
  baseUrl: 'https://ranking.example.com',
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

`?delay=5` / `?error=0.3` を付けて開くと、通信の遅さと失敗を手元で試せます。
サーバへ繋ぐ段取りは [RANKING_PLAN.md](RANKING_PLAN.md) にまとめてあります。

## これから作るもの

- **バーチャルパッド** … 同じ考え方で、見た目と配置を差し替えられる形にする（[TODO.md](TODO.md) J-2）
- **ランキングの表示** … 一覧の描画も UTIL 側に寄せるか検討中
- **ランキングサーバへ接続** … `source` を `RemoteRankingSource` に差し替える（[RANKING_PLAN.md](RANKING_PLAN.md)）
- **スマホのセンサー** … ジャイロ・位置情報（まだやらない）
