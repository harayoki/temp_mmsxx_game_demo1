# 引き継ぎ: ランキングを「差し替えられる」形にする

別セッションの初回指示としてそのまま渡せるように書いてある。
このファイルの内容をコピーして最初のメッセージにするか、
`docs/HANDOFF_RANKING.md を読んで作業して` と伝える。

---

## お願いしたいこと（ゴール）

いま **localStorage に保存しているランキング**を、あとから
**ランキングサーバー**へ差し替えられるようにしたい。
サーバーはまだ無い。**今回はサーバーにはつながない**。

- **同じインターフェース（呼び出し口）で、いまの実装がそのまま動く**ところまで
- サーバー版は、あとで同じ口を持つ別の実装を足すだけで済む状態にする
- **仕様書は人間から別途渡される**。それを見てから口の形を決めること。
  仕様書が来ていない場合は、先に「どんな形にするつもりか」を提案して確認を取る

## いまの作り

| ファイル | 役割 |
|---|---|
| `engine/util/ranking.js` | ランキングの部品（エンジンの**任意部品**）。保存先は差し替え可能 |
| `game/main.js` | ゲーム側。`Ranking` を 3 つ作って使っている |

### `engine/util/ranking.js`

- `LocalStorageStore` / `MemoryStore` … 保存先。`load(key)` / `save(key, value)` を持つ
- `class Ranking`
  - `constructor({ key, max, defaults, compare, storage, meKey })`
  - `entries` … 並んだ記録の配列（`{ name, score }` か `{ name, frames }`）
  - `me` … 自分が最後に登録した記録
  - `load()` / `save()` / `reset()`
  - `top()` … 1 位
  - `qualifies(entry)` … その記録が表に載るか
  - `add(entry, asMine = true)` … 登録して、順位（0 始まり）を返す
  - `rankOf(entry)` … 登録したら何位になるか（**登録はしない**）
  - `myIndex()` … 自分の記録の位置
  - `page(top, rows)` … 表示用の切り出し

**保存先はすでに差し替えられる**（`storage` を渡すだけ）。
ただし **すべて同期（`load()` がその場で値を返す前提）**で書いてあるので、
サーバー（非同期）をそのまま入れることはできない。ここが今回の山。

### `game/main.js` の使いどころ

| 行のあたり | 使いかた |
|---|---|
| `hardTable` / `normalTable` | 得点のランキング（HARD / NORMAL 別）。`max: 100` |
| `rushTable` | ボスラッシュのタイム（`compare: byTime`） |
| `scoreTable()` / `listTable()` | いま使う表を選ぶ小さな関数 |
| `roundHiScores()` | 起動時に古い記録の 10 の位を 0 に丸めて `save()` |
| `snapshotRanking()` / `willRankIn()` | ゲーム開始時の順位を覚えて「ランクインしたか」を見る |
| 名前入力 `enterNameEntry` → `add()` | 登録して、その順位へスクロールする |
| タイトルの一覧 `drawHiScoreList()` / `drawRushList()` | `entries` / `myIndex()` を直接読んでいる |
| `msxResetHiScores()` | デバッグ用。3 つとも `reset()` |

## 気をつけてほしいこと

- **ゲームの見た目・遊び心地は変えない**。今回は内部の作りだけ
- **通信は入れない**。`fetch` を書くのはサーバー版を作るときで、今回ではない
- ランキングの表示は**毎フレーム描いていない**（画面を切り替えたときだけ描く）。
  非同期にするなら「読み込み中」の間に何を出すかを決めること
  （**いまの動き＝すぐ出る**を壊さないこと。ローカル実装は同期のままでよい）
- 記録は **100 件**まで。初期データ 100 件を持っている（`DEFAULT_HISCORES`）
- 得点は **100 点刻み**（10 の位から下は必ず 0）
- コメントは**日本語で、実装の意図**を書く（このプロジェクトの決まり）

## 動かしかた

```
npm run data     # アセット生成（今回は不要なはず）
node serve.js    # http://localhost:8080
powershell -ExecutionPolicy Bypass -File build-deploy.ps1   # deploy/ を作る
```

確認は**ブラウザで実際に動かして**行うこと。
`msxDebug()` / `msxResetHiScores()` / `mmsxx.errors.read()` が使える。
タイトル → ハイスコア一覧、ゲームオーバー → 名前入力 → 一覧、の流れが
**今までどおり**であることを必ず見ること。

## 仕上げに

- 作った口（インターフェース）を `docs/UTIL.md` に追記する
- サーバー版を足すときに何を実装すればよいかを、短くまとめて残す
