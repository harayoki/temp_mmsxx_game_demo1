@echo off
setlocal
rem 録画フォルダ(ALT+R でできる rec-* )を mp4 にする。**余白なし**。
rem YouTube に上げるものは movie-youtube.bat のほうを使う。
rem
rem   movie.bat <録画フォルダ> [追加のオプション]
rem   フォルダをこのファイルへドラッグ＆ドロップしてもよい
rem
rem 既定は 3 倍(816x624)。あとから足したオプションより**先に書いたほうが勝つ**ので、
rem   movie.bat <フォルダ> --scale 4
rem のように書けば上書きできる。
rem 画面に出す文字は英語(コマンドプロンプトの文字コードに引っぱられないように)

if "%~1"=="" goto usage
if not exist "%~f1\meta.json" goto notrec

rem 変換の道具は **このバッチと同じ場所**から探す(%~dp0)。
rem ショートカットから起動されても、作業フォルダに関係なく動くようにするため。
rem 渡されたフォルダも %~f1 でフルパスに直しておく
node "%~dp0tools\rec2mp4.mjs" "%~f1" %2 %3 %4 %5 %6 --scale 3 --out "%~f1\out-plain.mp4"
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" goto failed
echo.
echo Done: %~f1\out-plain.mp4  (816x624, no padding)
echo You can delete frames.idx.gz and audio.pcm once the mp4 looks right.
goto end

:usage
echo Usage: movie.bat ^<recording folder^> [options]
echo   or drag a rec-* folder onto this file.
echo.
echo   Makes a 816x624 mp4 with no padding (3x).
echo   For YouTube, use movie-youtube.bat instead.
echo.
echo   --scale 4          bigger (default 3)
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
