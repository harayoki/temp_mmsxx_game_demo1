# MMS-XX Engine

**MMS-XX** は **Mock Machine System, model XX** の略。実在しなかった機械の型番です。
コードの中の識別子(`MMSXXEngine` / `mmsxx`)はハイフン無しのままにしてあります。

MSX1 と同じグラフィックス性能を持つ「ように感じられる」仮想マシンを、簡単に操れる
ブラウザ用ゲームエンジン(GUI なし)です。内部の VRAM レイアウトは本物と異なりますが、
最終的な画面と音が MSX1 らしく感じられることを目標にしています。

サンプルとして縦スクロールシューティング **STAR FABLE** が付属します。

- **エンジンの使い方** → [docs/ENGINE.md](docs/ENGINE.md)
- **サンプルゲームの仕様** → [docs/STAR_FABLE.md](docs/STAR_FABLE.md)
- **ボスの仕様（5 体 + ラスボス）** → [docs/BOSSES.md](docs/BOSSES.md)
- **裏技一覧** → [docs/CHEATS.md](docs/CHEATS.md)
- **UTIL(任意の部品)** → [docs/UTIL.md](docs/UTIL.md)
- **残りの課題・これから作るもの** → [docs/TODO.md](docs/TODO.md)
- **どこに置くか(配信先の考察)** → [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)

## できること(要約)

- 表示画面 256x192。裏画面はレイヤーごとに別サイズ(256〜2048 の 2 の冪)、枚数の上限なし
- RGBA 画像を書き込むと自動で MSX1 の 15 色 + 「横 8 ドット 2 色」制約へ変換(キャッシュ付き)
- パレット 0 は透明。レイヤーを奥から合成し、背景色(バックドロップ)を指定できる
- スプライトは個数・横並びとも制限なし。BG スプライト(8 ドット単位・大きさ自由)もある
- スプライトは反転と回転(0/90/180/270)ができ、1 枚の絵から向き違いを作れる
- MML で BGM / SE を登録・再生(波形 8 種・エンベロープ 6 種・デチューン・ビブラート・エコー)
- ビルド不要。素の ES Modules なので、フォルダごと静的ホスティングに上げるだけで動く

## 動かし方

```
npm run data      # ゲームデータ生成 (= node assets-src/makedata.mjs)
npm run serve     # 開発サーバ起動 (= node serve.js) → http://localhost:8080
npm run checkbgm  # 各BGMのトラック長がそろっているか確認
npm run preview   # 生成した絵を文字で表示して形を確認 (例: npm run preview crabR)
```

公開用のフォルダと ZIP は次のコマンドで作れます(ZIP 内の区切りは `/` なので、
Cloudflare Pages などにそのままアップロードできます)。

```
powershell -ExecutionPolicy Bypass -File build-deploy.ps1
```

## ファイル構成

```
engine/            エンジン本体(ブラウザ用・依存なし)
  engine.js        エンジン入口 (MMSXXEngine)
  video.js         仮想VDP: レイヤー・スプライト・BGスプライト・反転回転・合成
  palette.js       MSX1パレット / SCREEN2制約への変換 / キャッシュ用ハッシュ
  audio.js         PSG風サウンドドライバ (BGM/SE・フェードアウト)
  mml.js           MMLコンパイラ (波形・エンベロープ・デチューン等)
  input.js         キーボード入力
  errorlog.js      エラーログ(日付ごと・3日ぶん)
  font.js          内蔵6x7フォント(矢印・宝珠マーク入り)
  util/            任意の部品(import しなければ読み込まれない)
    story.js       OP/ED のストーリー画面
    staffroll.js   スタッフロール
    gallery.js     図鑑(グラフィック一覧)
    soundtest.js   サウンドテスト
    ranking.js     ランキング(保存先を差し替えられる)
assets-src/
  makedata.mjs     アセット定義コード (node で実行してデータ生成)
  checkbgm.mjs     各BGMのトラック長がそろっているか確認する(開発用)
  preview.mjs      生成した絵を文字で表示して形を確認する(開発用)
docs/
  ENGINE.md        エンジンのドキュメント
  STAR_FABLE.md    サンプルゲームのドキュメント
  TODO.md          エンジンの未着手の課題
game/
  gamedata.js      生成されたゲームデータ (自動生成・編集しない)
  main.js          サンプルシューティング本体
online/            外へ送る実装だけの置き場(公開しないときは丸ごと外す)
  ranking-remote.js  ランキングサーバへ記録を送る・取る
  README.md        何をここへ入れるか・外したときどうなるか
index.html         エントリHTML
serve.js           開発用静的サーバ (Cache-Control: no-store)
build-deploy.ps1   deploy/ と ZIP を作る
```
