[CmdletBinding()]
param(
    [string]$BackupPath,
    [switch]$RemoveData,
    [switch]$RemoveLoader
)

$ErrorActionPreference = 'Stop'
$BundleRoot = $PSScriptRoot
if (Get-Process -Name QQ -ErrorAction SilentlyContinue) { throw 'QQ is running. Exit all QQ processes before rollback.' }
if (-not $BackupPath) {
    $BackupPath = Get-ChildItem -LiteralPath (Join-Path $BundleRoot 'backup') -Directory -ErrorAction Stop |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $BackupPath -or -not (Test-Path -LiteralPath (Join-Path $BackupPath 'backup.json'))) {
    throw 'No valid backup was found.'
}
$manifest = Get-Content -LiteralPath (Join-Path $BackupPath 'backup.json') -Raw | ConvertFrom-Json
$qqRoot = [IO.Path]::GetFullPath($manifest.qqRoot).TrimEnd('\') + '\'
foreach ($value in @($manifest.packagePath, $manifest.launcherPath, $manifest.bridgePath)) {
    if (-not [IO.Path]::GetFullPath($value).StartsWith($qqRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Backup contains a path outside QQ root: $value"
    }
}

Copy-Item -LiteralPath (Join-Path $BackupPath 'package.json') -Destination $manifest.packagePath -Force
if ($manifest.launcherExisted) {
    Copy-Item -LiteralPath (Join-Path $BackupPath 'LiteLoaderQQNT.js') -Destination $manifest.launcherPath -Force
} else {
    Remove-Item -LiteralPath $manifest.launcherPath -Force -ErrorAction SilentlyContinue
}
if ($manifest.bridgeExisted) {
    Copy-Item -LiteralPath (Join-Path $BackupPath 'dbghelp.dll') -Destination $manifest.bridgePath -Force
} else {
    Remove-Item -LiteralPath $manifest.bridgePath -Force -ErrorAction SilentlyContinue
}

$loaderRoot = [IO.Path]::GetFullPath($manifest.liteLoaderPath).TrimEnd('\') + '\'
$pluginPath = [IO.Path]::GetFullPath($manifest.pluginPath)
if (-not $pluginPath.StartsWith($loaderRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Plugin path is outside LiteLoader root.' }
Remove-Item -LiteralPath $pluginPath -Recurse -Force -ErrorAction SilentlyContinue
if ($manifest.pluginExisted) { Copy-Item -LiteralPath (Join-Path $BackupPath 'plugin') -Destination $pluginPath -Recurse }

if ($RemoveData) {
    $dataPath = [IO.Path]::GetFullPath((Join-Path $manifest.liteLoaderPath 'data\qq_local_recall'))
    if (-not $dataPath.StartsWith($loaderRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Data path is outside LiteLoader root.' }
    Remove-Item -LiteralPath $dataPath -Recurse -Force -ErrorAction SilentlyContinue
}
if ($RemoveLoader -and -not $manifest.liteLoaderExisted) {
    $resolved = [IO.Path]::GetFullPath($manifest.liteLoaderPath)
    $allowedParents = @(
        ([IO.Path]::GetFullPath([Environment]::GetFolderPath('MyDocuments')).TrimEnd('\') + '\')
        ([IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents')).TrimEnd('\') + '\')
    ) | Select-Object -Unique
    $underAllowedParent = [bool]($allowedParents | Where-Object {
        $resolved.StartsWith($_, [StringComparison]::OrdinalIgnoreCase)
    })
    if (-not $underAllowedParent -or (Split-Path -Leaf $resolved) -ne 'LiteLoaderQQNT') {
        throw 'Refusing to remove an unexpected LiteLoader directory.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Host "Rollback completed from: $BackupPath"
