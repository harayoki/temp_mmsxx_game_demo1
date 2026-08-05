# vendor/

外から持ってきた部品を、**そのまま置いてある**フォルダです。

このゲームはバンドラを通さず、ブラウザが ES モジュールを直接読みます。
`node_modules/` は公開物に含めないので、ブラウザから読むものはここへ写します。

## bowser

- 版: 2.14.1
- ライセンス: MIT（`bowser/LICENSE` を同梱）
- 出どころ: `node_modules/bowser/src/`（`npm i bowser` で入る）
- 使う側: [engine/util/device.js](../engine/util/device.js) の判定を差し替えるために、
  [game/main.js](../game/main.js) から読んでいます

**エンジン本体はこれに依存していません。** 入れなければ `device.js` の目安で動きます。
更新するときは `npm i bowser@最新` のあと、`node_modules/bowser/src/*.js` と
`LICENSE` をこのフォルダへ写し直してください。
