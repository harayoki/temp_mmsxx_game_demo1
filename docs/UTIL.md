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

## STAR FABLE での使いどころ

| UTIL | 使っているところ |
|---|---|
| `StoryScenes` | エンディング |
| `StaffRoll` | スタッフロール |
| `Gallery` | CHARACTERS(図鑑) |
| `SoundTest` | SOUND TEST |
| `Ranking` | ハイスコア・ボスラッシュのタイム |

## これから作るもの

- **バーチャルパッド** … 同じ考え方で、見た目と配置を差し替えられる形にする（[TODO.md](TODO.md) J-2）
- **ランキングの表示** … 一覧の描画も UTIL 側に寄せるか検討中
- **スマホのセンサー** … ジャイロ・位置情報（まだやらない）
