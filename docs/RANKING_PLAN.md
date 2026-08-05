# ランキングをサーバへ移す — 決めたこと

[HANDOFF_RANKING.md](HANDOFF_RANKING.md) を受けて、人間から渡された
「ランキングサーバ仕様書」（Cloudflare Workers + D1）と突き合わせて決めた内容。
**サーバはまだ無い。この文書の時点では通信は書いていない。**

## 前提（いちばん大事なところ）

**順位はだいたい合っていればよい。**
更新はそう頻繁ではないし、取り直したときに順位が変わっても構わない。
この割り切りのおかげで、ゲームを通信で待たせずに済む。

- 一覧は **一度取ったら手元（メモリ）に置いて使い回す**
- ゲーム中・ゲームオーバー時は **通信しない**
- **通信するのは記録を登録するときだけ**。ここで正しい順位を受け取る
- 起動時に 1 度取れれば十分。**失敗しても先へ進める**

既定データ 100 件（`DEFAULT_HISCORES` / `DEFAULT_RUSH`）と同じものを
サーバにも初期登録しておく。そうすれば取得の成否にかかわらず見た目が同じになり、
「取れなかったときだけ表が違う」ということが起きない。

## サーバ側 — 設定 JSON を 3 つ置くだけ

仕様書の `rankings` は「**同じ記録集合に対する別のソート順**」なので、
記録集合そのものが違う HARD / NORMAL を 1 つの `gameId` に入れると
互いの表に混ざってしまう。よって **gameId を 3 つに分ける**。
サーバ側にゲーム固有の条件分岐は一切要らない。

| gameId | slot1 | ranking キー | 並び |
|---|---|---|---|
| `star-fable-normal` | `score` (integer, 0〜999999999) | `high-score` | slot1 desc |
| `star-fable-hard` | `score` (integer, 同上) | `high-score` | slot1 desc |
| `star-fable-rush` | `frames` (integer) | `fastest` | slot1 asc |

- **タイムは `frames` のまま送る**。ゲーム内部が 60fps のフレーム数で、
  表示の `formatTime()` もフレームから計算しているので、ms へ換算すると
  往復で丸めが入り、同じタイムが別の値になり得る
- `playerName` … `required: true` / `minLength: 1` / `maxLength: 5`
  （入力できる文字は `NAME_CHARS`。空白と `-,.?!` を含む）
- `limits.maxRankingLimit: 100`
- `rules` は無し。`sharing` は当面 `enabled: false`
- 得点が 100 点刻みであることはサーバでは縛らない（仕様に倍数の検査が無い）

送信に必要で、いまゲームが持っていないもの:

- `playId` … 毎プレイ `crypto.randomUUID()` で作る
- `browserId` … localStorage に永続させる
- `gameId` … 上の 3 つから選ぶ

## クライアント側 — `RankingBoard`

「**読み出しは同期のまま、背後で更新する**」という形は他のゲームでも使うので、
エンジンの部品として切り出した → [engine/util/ranking-board.js](../engine/util/ranking-board.js)

既存の [engine/util/ranking.js](../engine/util/ranking.js) は**残す**。
差し替えに失敗してもすぐ戻せるようにしておくため。

```js
// 同期。描画も判定もこれだけ使う（＝今までのコードがそのまま動く）
board.entries / board.me
board.top() / board.page(top, rows)
board.qualifies(entry) / board.rankOf(entry) / board.myIndex()

// 非同期。通信するのはこの 2 つだけ
await board.refresh()      // 一覧を取り直す。投げっぱなしで呼ぶ
await board.submit(entry)  // 登録して正しい順位を受け取る
```

`add()` も残してある。手元へ入れて順位を同期で返しつつ、裏で登録を投げる。
移行の途中は `add()` のままで動き、正しい順位が要る場所だけ `submit()` にできる。

### いつ取り直すか

**タイトル画面へ戻ってきたとき**に 3 表ぶんを投げっぱなしで `refresh()` する。
`await` しないので、取得中でもそのままゲームを始められる。

- 取得中の再要求はしない（`busy`）
- 直近の取得から 30 秒以内は取りに行かない（`minIntervalMs`）
- **一覧を表示している最中に入れ替わっても、描き直さない。**
  次にその画面を開いたときに新しい内容になる

### 供給元（source）— ローカルもサーバも同じコードで通る

```js
{
  fetch(key, ctx)          -> Promise<entries[]>
  submit(key, entry, ctx)  -> Promise<{ rank, entries? }>
  peek(key)                -> entries[] | null   任意。同期で出せる値
  replace(key, entries)    -> Promise<void>      任意。手元だけの用事
  clear(key)               -> Promise<void>      任意
}
```

`LocalRankingSource`（同梱）は localStorage を読み書きするが、
**同期で済むものまで Promise で返す**。こうしておけばサーバ版と呼ばれ方が同じになり、
切り替えは `source` を渡す 1 行だけで済む。ローカル開発もこの口を通る。

`peek()` は「起動した瞬間から並んでいてほしい」ための抜け道。
ローカル保存は持っているので今までどおり即座に出る。サーバ版は持たないので
既定データから始まり、`refresh()` のあとで本物に入れ替わる。

`replace()` / `clear()` は手元の記録をいじる操作なのでローカル保存だけが持つ。
サーバ側の削除・無効化は管理 API（管理者の仕事）で、ゲームからは触らない。

### 通信の遅さと失敗を手元で試す

サーバがまだ無いので、`LocalRankingSource` に**遅れ**と**失敗**を入れられるようにしてある。

```js
new LocalRankingSource({ delay: 5 })        // 取得・登録に 5 秒かかることにする
new LocalRankingSource({ errorRate: 0.3 })  // 3 割の見込みで失敗することにする
LocalRankingSource.defaultDelay = 5;        // 既定を 5 秒にする
LocalRankingSource.defaultErrorRate = 0.3;  // 既定を 3 割にする
```

STAR FABLE では URL で切り替えられる（どちらも既定は 0）。

```
?delay=5     取得・登録に 5 秒かかる
?error=0.3   3 割の見込みで失敗する（?error=1 で必ず失敗）
```

- 失敗するのは `fetch()` と `submit()` だけ。**遅れを待ってから失敗する**
- `submit()` が失敗すると手元にも保存されない（読み直すと消える）。
  サーバが受け取れなかったときと同じなので、これでよい
- **どちらかを入れているあいだは `peek()` が値を返さない。**
  サーバには同期で出せる値が無いので、そこも同じにしてある。
  つまり既定データから始まり、取れた時点で本物に入れ替わる — 本番と同じ道筋
- `replace()` / `clear()` は通信ではなく手元の手入れなので、遅れも失敗も入らない

## 段取り

| | やること | ゲームに触るか |
|---|---|---|
| 1 | この文書 | いいえ |
| 2 | `engine/util/ranking-board.js` を新規作成 | いいえ |
| 3 | `game/main.js` の import と 3 表の生成を差し替え | **はい**（import 1 行で戻せる） |
| 4 | `enterTitle()` で `refresh()` を投げっぱなしにする＋スクロール位置の丸め | はい |
| 5 | `roundHiScores()` / `reset()` をローカル専用の扱いへ寄せる | はい |
| 6 | `RemoteRankingSource` を書く＋`playId` / `browserId` を作る | いいえ（**まだ繋がない**） |
| 7 | `source` を差し替えて実際に通信する | サーバ完成後 |
| 8 | [UTIL.md](UTIL.md) に口の形を追記 | いいえ |

**8 まで完了。7 はゲーム側だけ先に済ませてある。**

- 名前登録は `add()` → **`await submit()`**。サーバが数えた順位を使う
- 待たせるあいだの見せかた（`SENDING RECORD` → 結果 → キー待ち）も実装済み
- 繋ぎ先を **`local` / `dev` / `prod`** から選ぶところまで入っている

残っているのは**通信する部品そのもの**だけ。できあがったら
`makeRemoteRankSource()` の中身を 1 行差し替えれば繋がる。

## 3 のときに気をつけること

- 一覧の描画は毎フレームではなく画面切り替えのときだけ。
  背後で件数が変わると `hiTop` / `rushTop` が範囲外になり得るので、
  `drawHiScoreList()` / `drawRushList()` の頭で丸める
- `roundHiScores()` は `entries` を直接書き換えて `save()` している。
  サーバには対応する操作が無いので、ローカル専用の手入れとして隔離する
- `mmsxxResetHiScores()` も同じく手元だけの操作
- `drawRushList()` は `myIndex()` ではなく `e.mine` を直接見ている。
  `RankingBoard` は取り直した一覧にも目印を付け直すので、そのままでよい

## サーバ版 — `RemoteRankingSource`

[online/ranking-remote.js](../online/ranking-remote.js)（別ファイル）。
**サーバを使わないゲームはこれを読み込まない**ので、`fetch` を含むコードが
一切入らない。エンジンの任意部品という方針どおり。

| 口 | API |
|---|---|
| `fetch(key)` | `GET /api/v1/rankings/{gameId}/{rankingKey}?limit=100` |
| `submit(key, entry)` | `POST /api/v1/runs` → 応答の `data.ranks[rankingKey]` が順位（**1 起点**。`RankingBoard` は 0 起点なので 1 引く） |
| `peek` / `replace` / `clear` | 持たない（`editable` が false になる） |

表とサーバの対応づけは `games` に書く。`RankingBoard` は自分の `key` で
問い合わせてくるので、そこから宛先を引く。

```js
new RemoteRankingSource({
  baseUrl: 'https://ranking.example.com',
  browserId, playId: () => playId,     // 値でも関数でもよい
  games: {
    'starfable-hiscores-easy': { gameId: 'star-fable-normal', rankingKey: 'high-score', valueKey: 'score' },
    'starfable-hiscores':      { gameId: 'star-fable-hard',   rankingKey: 'high-score', valueKey: 'score' },
    'starfable-rushtimes':     { gameId: 'star-fable-rush',   rankingKey: 'fastest',    valueKey: 'frames' },
  },
});
```

決めてあること:

- タイムアウト既定 5 秒。取れなくても遊びは止まらないので、あきらめは早くてよい
- `409 PLAY_ALREADY_SUBMITTED` は**失敗にしない**（すでに登録できているので、
  手元の見込み順位をそのまま使う）
- それ以外の失敗はすべて `RankingRequestError` にそろえる
- `playId` は 1 プレイに 1 つ。送り直しても同じ ID を使うので二重に載らない
- `browserId` は `starfable-browser-id` に永続。消されれば別人になるが、それでよい

## 7 — 通信する部品への引き渡し

ゲーム側はもう待っている。**部品ができたら差し込むだけ**。

### 呼ばれかた

`main.js` の `makeRemoteRankSource(dev)` の中だけが繋ぎ目。

```js
function makeRemoteRankSource(dev) {
  return new RemoteRankingSource({ dev });   // ここ 1 行
}
```

- **引数は `dev`（真偽値）だけ。** 開発用サーバか本番サーバかを選ぶ。
  **URL はゲームに持たせない**（部品が両方を知っていて、自分で選ぶ）
- 呼ばれるのは**起動時に 1 回**。作った供給元を 3 つの表で共有する

### 実装する口

`RankingBoard` から呼ばれるのはこの 2 つだけ。**どちらも投げてよい**
（`RankingBoard` が受け止めて `lastError` に入れ、遊びは止めない）。

| 口 | 引数 | 返すもの |
|---|---|---|
| `fetch(key, ctx)` | `ctx = { max }` | `entries[]`（並びは問わない。表が並べ直す） |
| `submit(key, entry, ctx)` | `ctx = { entries, rank, max }` | `{ rank, entries? }` |

- `rank` は **0 起点**（載らないときは -1）。サーバが 1 起点なら 1 引く
- `entries` を返せば、その場で一覧も入れ替わる（登録のついでに取れるなら得）
- `peek()` / `replace()` / `clear()` は**持たなくてよい**。持たないと
  `editable` が false になり、手元向けの手入れ（`roundHiScores()` など）は動かなくなる

### 表と記録の中身

`key` はゲームが決めた文字列。これで宛先を引く。

| `key` | 何の表か | 記録 | 並び |
|---|---|---|---|
| `starfable-hiscores-easy` | NORMAL の得点 | `{ name, score }` | 得点の大きい順 |
| `starfable-hiscores` | HARD の得点 | `{ name, score }` | 同上 |
| `starfable-rushtimes` | ボスラッシュのタイム | `{ name, frames }` | フレーム数の小さい順 |

- `name` は **5 文字まで**（英数字と `- , . ? !`）
- `frames` は 60 分の 1 秒。表示は `formatTime()` が担当
- 手元に持つのはそれぞれ **100 件**まで（`ctx.max`）

### 誰が送ったか

`browserId` と `playId` は**ゲームが持っている**。部品には渡していないので、
必要なら受け取り口を足す（いまの `ranking-remote.js` は `browserId` / `playId` を
値か関数で受ける形にしてある）。

- `playId` … **1 プレイに 1 つ**。送り直しても同じ ID なので二重に載らない
- `browserId` … その端末をずっと指す。`starfable-browser-id` に永続

### 呼ばれる場面と待ち時間

- `fetch()` … タイトルへ戻るたびに 3 表ぶん**投げっぱなし**で呼ぶ。
  取れたぶんは次にその画面を開いたときから新しくなる
- `submit()` … 名前を入れて ENTER を押したとき。**1 プレイに 1 回**。
  ここだけプレイヤーを待たせる。**画面は最低 1 秒**「送っています」を出す
  （手元の保存だと一瞬で返ってしまい、何が起きたか分からないため）
- 失敗したら「もう一度送るか」を**そのたびに聞く**。断られたら手元の見込み順位で先へ進む
- 起動時の 3 表ぶんは並列でよい（`refreshRankings()` がすでにそうなっている）
