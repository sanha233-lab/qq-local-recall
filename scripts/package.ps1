$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Delivery = Join-Path $Root 'delivery'
$Version = (Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
$Stage = Join-Path $Delivery '.staging'
Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
Get-ChildItem -LiteralPath $Delivery -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^QQ-Local-Recall(?:-source)?-v[0-9.]+(?:-installer)?\.zip$' } |
    Remove-Item -Force

$PluginRoot = Join-Path $Stage 'QQ-Local-Recall'
New-Item -ItemType Directory -Path $PluginRoot -Force | Out-Null
foreach ($item in @('manifest.json', 'LICENSE', 'NOTICE.md', 'README.md', 'src')) {
    Copy-Item -LiteralPath (Join-Path $Root $item) -Destination $PluginRoot -Recurse
}
$PluginZip = Join-Path $Delivery "QQ-Local-Recall-v$Version.zip"
Remove-Item -LiteralPath $PluginZip -Force -ErrorAction SilentlyContinue
Compress-Archive -LiteralPath $PluginRoot -DestinationPath $PluginZip -CompressionLevel Optimal

$SourceRoot = Join-Path $Stage 'QQ-Local-Recall-source'
New-Item -ItemType Directory -Path $SourceRoot -Force | Out-Null
foreach ($item in @('manifest.json', 'package.json', 'LICENSE', 'NOTICE.md', 'README.md', 'CHANGELOG.md', 'src', 'test', 'scripts', 'docs')) {
    Copy-Item -LiteralPath (Join-Path $Root $item) -Destination $SourceRoot -Recurse
}
Remove-Item -LiteralPath (Join-Path $SourceRoot 'docs\superpowers') -Recurse -Force -ErrorAction SilentlyContinue
$SourceZip = Join-Path $Delivery "QQ-Local-Recall-source-v$Version.zip"
Remove-Item -LiteralPath $SourceZip -Force -ErrorAction SilentlyContinue
Compress-Archive -LiteralPath $SourceRoot -DestinationPath $SourceZip -CompressionLevel Optimal

Copy-Item -LiteralPath (Join-Path $Root 'scripts\install.ps1') -Destination (Join-Path $Delivery 'install.ps1') -Force
Copy-Item -LiteralPath (Join-Path $Root 'scripts\rollback.ps1') -Destination (Join-Path $Delivery 'rollback.ps1') -Force
New-Item -ItemType Directory -Path (Join-Path $Delivery 'vendor') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Root 'vendor\LiteLoaderQQNT-1.4.1.zip') -Destination (Join-Path $Delivery 'vendor\LiteLoaderQQNT-1.4.1.zip') -Force
Copy-Item -LiteralPath (Join-Path $Root 'vendor\dbghelp_x64-1.1.2.dll') -Destination (Join-Path $Delivery 'vendor\dbghelp_x64-1.1.2.dll') -Force

$hashFiles = @($PluginZip, $SourceZip, (Join-Path $Delivery 'install.ps1'), (Join-Path $Delivery 'rollback.ps1'),
    (Join-Path $Delivery 'vendor\LiteLoaderQQNT-1.4.1.zip'), (Join-Path $Delivery 'vendor\dbghelp_x64-1.1.2.dll'))
$hashLines = foreach ($file in $hashFiles) {
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    $relative = $file.Substring($Delivery.Length).TrimStart('\').Replace('\', '/')
    "$hash  $relative"
}
[IO.File]::WriteAllLines((Join-Path $Delivery 'SHA256SUMS.txt'), $hashLines, [Text.UTF8Encoding]::new($false))

# Self-contained installer bundle for users without LiteLoaderQQNT; its layout
# matches what install.ps1 expects next to itself.
$InstallerRoot = Join-Path $Stage 'installer'
New-Item -ItemType Directory -Path $InstallerRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Delivery 'install.ps1'), (Join-Path $Delivery 'rollback.ps1'), $PluginZip, (Join-Path $Delivery 'SHA256SUMS.txt') -Destination $InstallerRoot
Copy-Item -LiteralPath (Join-Path $Delivery 'vendor') -Destination $InstallerRoot -Recurse
$InstallerZip = Join-Path $Delivery "QQ-Local-Recall-v$Version-installer.zip"
Remove-Item -LiteralPath $InstallerZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $InstallerRoot '*') -DestinationPath $InstallerZip -CompressionLevel Optimal

$installerHash = (Get-FileHash -LiteralPath $InstallerZip -Algorithm SHA256).Hash
[IO.File]::AppendAllText(
    (Join-Path $Delivery 'SHA256SUMS.txt'),
    "$installerHash  $([IO.Path]::GetFileName($InstallerZip))`n",
    [Text.UTF8Encoding]::new($false)
)

Remove-Item -LiteralPath $Stage -Recurse -Force
Write-Host "Delivery package created: $Delivery"
