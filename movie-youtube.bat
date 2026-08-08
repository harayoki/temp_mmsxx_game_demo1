@echo off
setlocal
rem 録画フォルダ(ALT+R でできる rec-* )を **YouTube 用**の mp4 にする。
rem 5 倍(1360x1040)にして、1920x1080 の真ん中に置く。
rem 余白の要らないもの(X へ直接上げるなど)は movie.bat のほうを使う。
rem
rem   movie-youtube.bat <録画フォルダ> [追加のオプション]
rem   フォルダをこのファイルへドラッグ＆ドロップしてもよい
rem
rem あとから足したオプションより**先に書いたほうが勝つ**ので、
rem   movie-youtube.bat <フォルダ> --scale 4
rem のように書けば上書きできる。
rem 画面に出す文字は英語(コマンドプロンプトの文字コードに引っぱられないように)

if "%~1"=="" goto usage
if not exist "%~f1\meta.json" goto notrec

rem 出来上がりの名前に **録画フォルダの名前**を入れる。
rem いくつも撮ったものを 1 か所に集めても、どれがどれだか分かるように
for %%I in ("%~f1") do set "RECNAME=%%~nxI"

rem 変換の道具は **このバッチと同じ場所**から探す(%~dp0)。
rem ショートカットから起動されても、作業フォルダに関係なく動くようにするため。
rem 渡されたフォルダも %~f1 でフルパスに直しておく
node "%~dp0tools\rec2mp4.mjs" "%~f1" %2 %3 %4 %5 %6 --scale 5 --pad 1920x1080 --out "%~f1\%RECNAME%-youtube.mp4"
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" goto failed
echo.
echo Done: %~f1\%RECNAME%-youtube.mp4  (1920x1080, 5x centered)
echo You can delete frames.idx.gz and audio.pcm once the mp4 looks right.
goto end

:usage
echo Usage: movie-youtube.bat ^<recording folder^> [options]
echo   or drag a rec-* folder onto this file.
echo.
echo   Makes a 1920x1080 mp4 (5x, centered with black bars).
echo   For no padding, use movie.bat instead.
echo.
echo   --scale 4          smaller picture inside the frame (default 5)
echo   --fps 30           fewer frames (default 60)
goto end

:notrec
echo Not a recording folder (meta.json not found):
echo   %~f1
goto end

:failed
echo.
echo Failed. (exit code %ERR%)
echo ffmpeg must be installed and on PATH.

:end
echo.
pause
