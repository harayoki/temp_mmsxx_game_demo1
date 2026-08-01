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

### 通信の遅さを手元で試す

サーバがまだ無いので、`LocalRankingSource` に**遅れ**を入れられるようにしてある。

```js
new LocalRankingSource({ delay: 5 })   // 取得・登録に 5 秒かかることにする
LocalRankingSource.defaultDelay = 5;   // 既定を 5 秒にする
```

STAR FABLE では URL に `?delay=5` を付けて開くと効く（既定は 0 = 待たない）。

**遅れを入れているあいだは `peek()` が値を返さない。**
サーバには同期で出せる値が無いので、そこも同じにしてある。
つまり既定データから始まり、取れた時点で本物に入れ替わる — 本番と同じ道筋を手元でたどれる。

`replace()` / `clear()` は通信ではなく手元の手入れなので遅れは入らない。

## 段取り

| | やること | ゲームに触るか |
|---|---|---|
| 1 | この文書 | いいえ |
| 2 | `engine/util/ranking-board.js` を新規作成 | いいえ |
| 3 | `game/main.js` の import と 3 表の生成を差し替え | **はい**（import 1 行で戻せる） |
| 4 | `enterTitle()` で `refresh()` を投げっぱなしにする＋スクロール位置の丸め | はい |
| 5 | `roundHiScores()` / `reset()` をローカル専用の扱いへ寄せる | はい |
| 6 | `RemoteRankingSource` を足す（`fetch` を書く初回） | サーバ完成後 |
| 7 | [UTIL.md](UTIL.md) に口の形を追記 | いいえ |

**1 と 2 まで完了。** ここまでは既存ファイルを 1 文字も変えていないので、
ゲームの動きには何の影響も無い。

## 3 のときに気をつけること

- 一覧の描画は毎フレームではなく画面切り替えのときだけ。
  背後で件数が変わると `hiTop` / `rushTop` が範囲外になり得るので、
  `drawHiScoreList()` / `drawRushList()` の頭で丸める
- `roundHiScores()` は `entries` を直接書き換えて `save()` している。
  サーバには対応する操作が無いので、ローカル専用の手入れとして隔離する
- `msxResetHiScores()` も同じく手元だけの操作
- `drawRushList()` は `myIndex()` ではなく `e.mine` を直接見ている。
  `RankingBoard` は取り直した一覧にも目印を付け直すので、そのままでよい

## 6 のときに実装するもの

`RemoteRankingSource` が仕様書のどの API を叩くか。

| 口 | API |
|---|---|
| `fetch(key)` | `GET /api/v1/rankings/{gameId}/{rankingKey}?limit=100` |
| `submit(key, entry)` | `POST /api/v1/runs` → 応答の `data.ranks[rankingKey]` が順位（**1 起点**。`RankingBoard` は 0 起点なので 1 引く） |
| `peek` / `replace` / `clear` | 実装しない |

- `entries` への変換 … `{ name: playerName, score または frames }`
- タイムアウトを付ける（失敗しても遊びは止まらないので短くてよい）
- 再送するときは `playId` を変えない（`409 PLAY_ALREADY_SUBMITTED` を素通しする）
- 起動時の 3 表ぶんは並列でよい
