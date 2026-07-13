$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Delivery = Join-Path $Root 'delivery'
$Stage = Join-Path $Delivery '.staging'
Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
Get-ChildItem -LiteralPath $Delivery -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^QQ-Local-Recall(?:-source)?-v[0-9.]+\.zip$' } |
    Remove-Item -Force

$PluginRoot = Join-Path $Stage 'QQ-Local-Recall'
New-Item -ItemType Directory -Path $PluginRoot -Force | Out-Null
foreach ($item in @('manifest.json', 'LICENSE', 'NOTICE.md', 'README.md', 'src')) {
    Copy-Item -LiteralPath (Join-Path $Root $item) -Destination $PluginRoot -Recurse
}
$PluginZip = Join-Path $Delivery 'QQ-Local-Recall-v1.3.1.zip'
Remove-Item -LiteralPath $PluginZip -Force -ErrorAction SilentlyContinue
Compress-Archive -LiteralPath $PluginRoot -DestinationPath $PluginZip -CompressionLevel Optimal

$SourceRoot = Join-Path $Stage 'QQ-Local-Recall-source'
New-Item -ItemType Directory -Path $SourceRoot -Force | Out-Null
foreach ($item in @('manifest.json', 'package.json', 'LICENSE', 'NOTICE.md', 'README.md', 'src', 'test', 'scripts', 'docs')) {
    Copy-Item -LiteralPath (Join-Path $Root $item) -Destination $SourceRoot -Recurse
}
$SourceZip = Join-Path $Delivery 'QQ-Local-Recall-source-v1.3.1.zip'
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
Remove-Item -LiteralPath $Stage -Recurse -Force
Write-Host "Delivery package created: $Delivery"
