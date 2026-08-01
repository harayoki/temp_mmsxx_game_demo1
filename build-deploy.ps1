# 公開用の deploy フォルダと ZIP を作る:  powershell -File build-deploy.ps1
#
# 注意: PowerShell の Compress-Archive は ZIP エントリ名に "\" を使うことがある。
# ZIP の仕様ではディレクトリ区切りは "/" であり、"\" のままだと展開側
# (Cloudflare Pages など) がサブフォルダと認識せず、"game\main.js" という
# 名前の 1 ファイルとして扱われて /game/main.js が 404 になる。
# そのためここでは ZipArchive でエントリ名を明示して作る。

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$deploy = Join-Path $root 'deploy'
$zipPath = Join-Path $root 'star-fable-deploy.zip'

# 公開に必要なファイルだけを deploy/ にそろえる
if (Test-Path $deploy) { Remove-Item -Recurse -Force $deploy }
New-Item -ItemType Directory -Force $deploy | Out-Null
Copy-Item (Join-Path $root 'index.html') $deploy
Copy-Item -Recurse (Join-Path $root 'engine') (Join-Path $deploy 'engine')
Copy-Item -Recurse (Join-Path $root 'game') (Join-Path $deploy 'game')
# 音声ファイル(スタッフロールの mp3 など)
if (Test-Path (Join-Path $root 'assets')) {
  Copy-Item -Recurse (Join-Path $root 'assets') (Join-Path $deploy 'assets')
}

# ZIP を作り直す (エントリ名は必ず "/" 区切り)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  Get-ChildItem -Recurse -File $deploy | ForEach-Object {
    $name = $_.FullName.Substring($deploy.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name)
  }
} finally {
  $zip.Dispose()
}

# 確認のためエントリ名を表示する
$check = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$check.Entries | ForEach-Object { $_.FullName }
$check.Dispose()
"{0:N0} bytes" -f (Get-Item $zipPath).Length
