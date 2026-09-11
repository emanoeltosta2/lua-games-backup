$ErrorActionPreference = 'Stop'

$projectDirectory = Split-Path -Parent $PSScriptRoot
$releaseDirectory = Join-Path $projectDirectory 'release'
$stageDirectory = Join-Path $releaseDirectory 'stage'
$packageDirectory = Join-Path $stageDirectory 'lua-games-backup'
$version = (Get-Content (Join-Path $projectDirectory 'plugin.json') -Raw | ConvertFrom-Json).version
$archivePath = Join-Path $releaseDirectory ("Lua-Games-Backup-v" + $version + ".zip")

if (Test-Path -LiteralPath $stageDirectory) {
    Remove-Item -LiteralPath $stageDirectory -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

New-Item -ItemType Directory -Path (Join-Path $packageDirectory 'backend') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDirectory '.millennium\Dist') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDirectory 'google-drive-bridge') -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $projectDirectory 'plugin.json') -Destination $packageDirectory
Copy-Item -LiteralPath (Join-Path $projectDirectory 'README.md') -Destination $packageDirectory
Copy-Item -LiteralPath (Join-Path $projectDirectory 'PRIVACY.md') -Destination $packageDirectory
Copy-Item -LiteralPath (Join-Path $projectDirectory 'TERMS.md') -Destination $packageDirectory
Copy-Item -LiteralPath (Join-Path $projectDirectory 'backend\main.lua') -Destination (Join-Path $packageDirectory 'backend')
Copy-Item -LiteralPath (Join-Path $projectDirectory 'backend\rpc_functions.lua') -Destination (Join-Path $packageDirectory 'backend')
Copy-Item -LiteralPath (Join-Path $projectDirectory '.millennium\Dist\index.js') -Destination (Join-Path $packageDirectory '.millennium\Dist')
Copy-Item -LiteralPath (Join-Path $projectDirectory 'google-drive-bridge\LuaGamesBackup.GoogleDrive.exe') -Destination (Join-Path $packageDirectory 'google-drive-bridge')
Copy-Item -LiteralPath (Join-Path $projectDirectory 'google-drive-bridge\oauth-client.json') -Destination (Join-Path $packageDirectory 'google-drive-bridge')

Compress-Archive -LiteralPath $packageDirectory -DestinationPath $archivePath -CompressionLevel Optimal
Remove-Item -LiteralPath $stageDirectory -Recurse -Force
Write-Output $archivePath
