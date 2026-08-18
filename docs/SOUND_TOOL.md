# サウンドツール — コンセプト

**この文書は [mmsxx-mml-studio](https://github.com/harayoki/mmsxx-mml-studio) へ移した。**

手元では submodule の中にある →
[vendor/mmsxx-mml-studio/docs/SOUND_TOOL.md](../vendor/mmsxx-mml-studio/docs/SOUND_TOOL.md)

## このゲームとの関係

サウンドは `vendor/mmsxx-mml-studio/` に **submodule でポインタを固定**して入っている。
**このゲームが使うサウンドエンジンは固定。** 更新は、仕様を見て問題なければ取り込む。

- ゲームから import するのは **`sound/` だけ**
- 同じリポジトリに作曲ツール(`tool/`)とサンプル(`samples/`)が同居していて、
  そちらは**非公開**。`build-deploy.ps1` は配布物へ `sound/` だけを写す

クローンし直したときは:

```
git submodule update --init
```
