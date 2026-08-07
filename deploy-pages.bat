@echo off
rem 配布物を作って Cloudflare Pages へ上げる。
rem
rem   deploy-pages.bat        本番    … 公開版ビルド(dev:false・難読化あり)を main へ
rem   deploy-pages.bat dev    お試し … 手元用ビルド(dev:true・素のまま)を dev へ
rem
rem 上げ先の違いはブランチ名だけ。Pages は本番ブランチ(main)へ上げたものを
rem msxpoi1.pages.dev に出し、それ以外はプレビュー用の URL に出す。
rem
rem   本番      https://msxpoi1.pages.dev
rem   お試し    https://dev.msxpoi1.pages.dev  (デプロイごとの URL も出る)
rem
rem **zip のドラッグ&ドロップでは functions/ が動かない。** wrangler で上げると
rem コンパイルされて Pages Functions になる(だからこのバッチがある)。
rem
rem 注意:
rem   - お試しは**素のソースが読める**ビルドです。人に配る URL には使わないこと
rem   - SNS への投稿は Origin で許されたところからしか通らない。
rem     プレビューの URL から投稿したいときは、サーバ側に許可をもらうこと
setlocal
set PROJECT=msxpoi1

if /I "%~1"=="dev" goto :dev

set OUTDIR=%~dp0deploy
echo === 公開版をビルドします
powershell -ExecutionPolicy Bypass -File "%~dp0build-deploy.ps1" -Obfuscate
if errorlevel 1 goto :failed
echo.
echo === 本番へ上げます (branch main)
call npx -y wrangler@4 pages deploy "%~dp0deploy" --project-name %PROJECT% --branch main --commit-dirty=true
if errorlevel 1 goto :failed
goto :done

:dev
set OUTDIR=%~dp0deploy-local
echo === 手元用をビルドします
powershell -ExecutionPolicy Bypass -File "%~dp0build-deploy.ps1" -Local
if errorlevel 1 goto :failed
echo.
echo === お試しへ上げます (branch dev)
call npx -y wrangler@4 pages deploy "%~dp0deploy-local" --project-name %PROJECT% --branch dev --commit-dirty=true
if errorlevel 1 goto :failed
goto :done

:failed
echo.
echo *** 失敗しました ***
endlocal
exit /b 1

:done
rem 何版を上げたのかを最後に出す。
rem 公開版は難読化で書き方が変わるので、版らしい並びを探して取り出す
set VER=
for /f %%v in ('powershell -NoProfile -Command "[regex]::Match((Get-Content -Raw '%OUTDIR%\game\build.js'), 'v[0-9]+\.[0-9]+\.[0-9]+').Value"') do set VER=%%v
echo.
echo 上げ終わりました  版: %VER%
endlocal
pause
exit /b 0
