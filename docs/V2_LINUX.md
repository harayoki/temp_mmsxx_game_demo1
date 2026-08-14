# V2 を Linux ベースにする件(考察)

エンジンを V2 にして別のゲームで磨いていくにあたり、ビルド・配信まわりを
Windows 依存から外しておきたい。その下調べと方針。

## なぜやるか

開発をクラウドのセッション上で行うと、家では PC・外出先ではスマホから同じように触れる。
このときセッションが動くのは **Linux コンテナ**なので、PowerShell と `.bat` に
依存していると外出先では何もできない。

現状の Star Fable は、ビルドと配信が完全に Windows 前提になっている。
V2 ではここを最初から Node に寄せておく。

## 現状の棚卸し

`build-deploy.ps1`(205行) が何をしているかを読んだ結果。**難所は無い。**

| 処理 | 中身 | Linux 化 |
|---|---|---|
| ファイル・ディレクトリのコピー | `Copy-Item -Recurse` | `node:fs` の `cp(src, dst, {recursive:true})` で素直に置き換わる |
| index.html へのビーコン埋め込み | 目印コメントを文字列置換 | 同じことを Node で書くだけ |
| manifest の start_url 差し替え(ローカル版) | 文字列置換 | 同上 |
| build-number.txt のインクリメント | 読んで +1 して書く | 同上(ただし下記「判断が要る点」参照) |
| game/build.js の生成 | 文字列を組んで書き出し | 同上 |
| 難読化 | **`node tools/obfuscate.mjs` を呼んでいるだけ** | すでに Node。手を入れる必要なし |
| ZIP 生成 | .NET の `System.IO.Compression` | 下記「判断が要る点」参照 |
| ZIP の中身検証・サイズ表示 | 同上 | 同上 |

`deploy-pages.bat` は「ps1 を呼んで `npx wrangler pages deploy` する」だけ。
`movie.bat` / `movie-youtube.bat` も `tools/rec2mp4.mjs` を呼ぶだけの薄いラッパーで、
**中身の Node スクリプトはすでにクロスプラットフォーム**(ffmpeg が PATH にあればよい)。

つまり Windows に縛られているのは、**処理の中身ではなく、外側のラッパーだけ**である。

## 判断が要る点

### ZIP をどうするか

Node には ZIP の標準機能がない(`zlib` はあるが ZIP コンテナは無い)。選択肢:

1. **作らない。** `wrangler pages deploy` はディレクトリを直接受けるので、
   Actions から配信する限り ZIP は不要。手動アップロード用の保険として作っていたもの
2. 自前で書く。ZIP コンテナは deflate + ヘッダなので、依存なしでも書ける
   (mmsxx-pixel-studio では同じ考えで PNG コーデックを依存なしで自前実装した)
3. 開発時依存として npm パッケージを使う

配信経路を Actions に一本化するなら 1 が一番安い。手元での ZIP 配布を続けたいなら 2。

### ビルド番号をどうするか

今は `build-number.txt` を +1 して**リポジトリにコミットする**運用。
これを CI で回すと、CI 自身がリポジトリに push し返すことになる(できるが、
コミットが増え、押し戻しの競合も起きうる)。

代案として、GitHub Actions の run number を使えばファイル自体が不要になる。
ただし手元ビルドと番号体系が分かれるので、`v1.05.42` のような表記の意味が変わる。
どちらにするか決めてから移植する。

### wrangler の認証

`deploy-pages.bat` は対話ログイン前提。Actions から回すには、リポジトリの Secrets に
`CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録して環境変数で渡す。
トークンは Cloudflare 側で Pages の編集権限だけに絞って発行する。

なお `build-deploy.ps1` にベタ書きされている analytics トークンは、
Cloudflare Web Analytics のビーコン用でクライアントに配信されるもの。**秘密ではない**ので
Secrets に移す必要はない。

### 動画作成は対象外

`movie.bat` / `movie-youtube.bat` (`tools/rec2mp4.mjs`) は**手元で回す前提のまま**でよい。
録画フォルダを扱うもので CI から回すものではないし、ffmpeg も要る。

ただし**スクリプト自体は Linux でも動く形を保っておく**。中身の `rec2mp4.mjs` は
すでにクロスプラットフォームなので、`.bat` のラッパーを `npm run movie` に置き換えるだけで、
どちらの環境からでも同じコマンドで叩ける。手元の作業が楽になるうえ、
将来「外出先で録画を書き出したい」となったときに詰まらない。

## 移行の順序

1. `build-deploy.ps1` を `tools/build-deploy.mjs` に移す。引数は `--local` `--obfuscate` `--logo-trap`
2. `npm run build` / `npm run build:local` から叩けるようにする
3. Windows でも同じコマンドで動くことを確認する(移行中は両方使える状態を保つ)
4. Actions を作る。`workflow_dispatch` で手動実行できるようにしておくと、スマホからでも配信できる
5. `.ps1` / `.bat` を消す。`movie` 系は `npm run movie` に置き換える(手元用のまま)

## V2 で最初から気をつけること

- **新しいスクリプトは `.mjs` か `.ts` で書く。`.ps1` / `.bat` を作らない**
- パス連結は必ず `node:path` を使う。`\` を文字列で書かない
- `pause` で終わりを待つ前提の作りにしない(CI では止まる)
- 改行コードを混ぜない。`.gitattributes` に `* text=auto eol=lf` を入れておくと、
  Windows とコンテナを行き来しても差分が出ない
- スクリプトのファイル自体を BOM 付きで保存しない
- 外部コマンド(ffmpeg など)に依存する処理は、**無い場合に何が起きるかを明示**する。
  CI では入っていないのが普通なので、そのステップは分けておく

## 参考

同じ考え方で `mmsxx-pixel-studio` を作っている。あちらでの確認済みの構成:

- Node 22.18 以降は `.ts` をそのまま実行できる(型を消して実行するだけ)。ビルド成果物が要らない
  - ただし `enum` / `namespace` など「消せない構文」は使えず、import は拡張子まで書く必要がある
  - 型検査はしてくれないので `tsc --noEmit` を別途回す
- 実行時の外部依存をゼロにしておくと、セッションを開いた直後から何も入れずに動く
- GitHub Actions で型チェックとテストを回している
