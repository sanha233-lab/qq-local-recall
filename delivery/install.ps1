[CmdletBinding()]
param(
    [string]$QQInstallPath,
    [string]$LiteLoaderPath = (Join-Path $env:USERPROFILE 'Documents\LiteLoaderQQNT'),
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ExpectedQQVersion = '9.9.32-51246'
$ExpectedQQMain = './application.asar/app_launcher/index.js'
$LoaderQQMain = './app_launcher/LiteLoaderQQNT.js'
$ExpectedApplicationHash = '65338430A607D4F936CF2A4B497BE5DEC22DCAB1ED9845F2F4E513BBD7421A62'
$LoaderHash = '3B2D9B7214BDFEF16D5007B1F277A9F70688785BA11FC03EF091AA8214CDC343'
$BridgeHash = '4BB8CD08D7E96BD085FA2AFA46D7B36E3F312A6C4D633363411EF763449D700F'
$BundleRoot = $PSScriptRoot
$LoaderArchive = Join-Path $BundleRoot 'vendor\LiteLoaderQQNT-1.4.1.zip'
$BridgeDll = Join-Path $BundleRoot 'vendor\dbghelp_x64-1.1.2.dll'
$PluginArchive = Join-Path $BundleRoot 'QQ-Local-Recall-v1.3.8.zip'

function Get-QQInstallCandidates {
    $paths = @('D:\QQ', 'C:\QQ')
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA, $env:ProgramData)) {
        if (-not [string]::IsNullOrWhiteSpace($base)) {
            $paths += Join-Path $base 'Tencent\QQ'
        }
    }
    $paths += Join-Path $env:USERPROFILE 'AppData\Local\Programs\Tencent\QQ'

    $registryRoots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($root in $registryRoots) {
        foreach ($item in @(Get-ItemProperty -Path $root -ErrorAction SilentlyContinue)) {
            if ([string]$item.DisplayName -notmatch '(?i)QQ') { continue }
            if (-not [string]::IsNullOrWhiteSpace([string]$item.InstallLocation)) {
                $paths += [string]$item.InstallLocation
            }
            $icon = [string]$item.DisplayIcon
            if ($icon -match '^\s*"([^"]+\.exe)') {
                $paths += Split-Path -Parent $matches[1]
            } elseif ($icon -match '^\s*([^,]+\.exe)') {
                $paths += Split-Path -Parent $matches[1].Trim()
            }
        }
    }

    $seen = @{}
    foreach ($rawPath in $paths) {
        if ([string]::IsNullOrWhiteSpace([string]$rawPath)) { continue }
        try { $candidate = [IO.Path]::GetFullPath(([string]$rawPath).Trim().Trim('"')) } catch { continue }
        $key = $candidate.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $configPath = Join-Path $candidate 'versions\config.json'
        if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { continue }
        try { $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } catch { continue }
        if ($config.curVersion -eq $ExpectedQQVersion) { $candidate }
    }
}

function Resolve-QQInstallPath([string]$RequestedPath) {
    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        $resolved = [IO.Path]::GetFullPath($RequestedPath)
        Write-Host "Using specified QQ path: $resolved"
        return $resolved
    }
    $candidates = @(Get-QQInstallCandidates)
    if ($candidates.Count -eq 1) {
        Write-Host "Auto-detected QQ path: $($candidates[0])"
        return $candidates[0]
    }
    if ($candidates.Count -eq 0) {
        throw "Could not auto-detect a compatible QQ installation for version $ExpectedQQVersion. Specify -QQInstallPath."
    }
    throw "Multiple compatible QQ installations were found:`n$($candidates -join "`n")`nSpecify -QQInstallPath to choose one."
}

function Assert-FileHash([string]$Path, [string]$Expected) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing file: $Path" }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($actual -ne $Expected) { throw "SHA-256 mismatch: $Path`nExpected: $Expected`nActual:   $actual" }
}

$QQRunning = [bool](Get-Process -Name QQ -ErrorAction SilentlyContinue)
$QQInstallPath = Resolve-QQInstallPath $QQInstallPath
Assert-FileHash $LoaderArchive $LoaderHash
Assert-FileHash $BridgeDll $BridgeHash
if (-not (Test-Path -LiteralPath $PluginArchive -PathType Leaf)) { throw "Missing plugin archive: $PluginArchive" }

$versionConfig = Get-Content -LiteralPath (Join-Path $QQInstallPath 'versions\config.json') -Raw | ConvertFrom-Json
if ($versionConfig.curVersion -ne $ExpectedQQVersion) {
    throw "Unsupported QQ version: $($versionConfig.curVersion). Expected: $ExpectedQQVersion"
}
$AppPath = Join-Path $QQInstallPath "versions\$ExpectedQQVersion\resources\app"
$PackagePath = Join-Path $AppPath 'package.json'
$ApplicationPath = Join-Path $AppPath 'application.asar'
$LauncherPath = Join-Path $AppPath 'app_launcher\LiteLoaderQQNT.js'
$TargetBridge = Join-Path $QQInstallPath 'dbghelp.dll'
$PluginPath = Join-Path $LiteLoaderPath 'plugins\qq_local_recall'

if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) { throw "Missing file: $PackagePath" }
$qqPackage = Get-Content -LiteralPath $PackagePath -Raw | ConvertFrom-Json
if ($qqPackage.main -notin @($ExpectedQQMain, $LoaderQQMain)) {
    throw "Unexpected QQ main entry: $($qqPackage.main). Expected: $ExpectedQQMain"
}
Assert-FileHash $ApplicationPath $ExpectedApplicationHash

Write-Host "QQ version:       $ExpectedQQVersion"
Write-Host "Official entry:   $ExpectedQQMain"
Write-Host "LiteLoader path:  $LiteLoaderPath"
Write-Host "Plugin path:      $PluginPath"
Write-Host 'QQ.exe replacement: disabled'
if ($DryRun) {
    if ($QQRunning) { Write-Host 'Dry run note: QQ is running and must be exited before actual installation.' }
    Write-Host 'Dry run passed. No files were changed.'
    exit 0
}
if ($QQRunning) { throw 'QQ is running. Exit all QQ processes before installation.' }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupPath = Join-Path $BundleRoot "backup\$ExpectedQQVersion-$timestamp"
New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null
$manifest = [ordered]@{
    qqRoot = [IO.Path]::GetFullPath($QQInstallPath)
    version = $ExpectedQQVersion
    packagePath = [IO.Path]::GetFullPath($PackagePath)
    launcherPath = [IO.Path]::GetFullPath($LauncherPath)
    bridgePath = [IO.Path]::GetFullPath($TargetBridge)
    liteLoaderPath = [IO.Path]::GetFullPath($LiteLoaderPath)
    pluginPath = [IO.Path]::GetFullPath($PluginPath)
    packageHash = (Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256).Hash
    launcherExisted = Test-Path -LiteralPath $LauncherPath
    bridgeExisted = Test-Path -LiteralPath $TargetBridge
    liteLoaderExisted = Test-Path -LiteralPath $LiteLoaderPath
    pluginExisted = Test-Path -LiteralPath $PluginPath
}
Copy-Item -LiteralPath $PackagePath -Destination (Join-Path $BackupPath 'package.json')
if ($manifest.launcherExisted) { Copy-Item -LiteralPath $LauncherPath -Destination (Join-Path $BackupPath 'LiteLoaderQQNT.js') }
if ($manifest.bridgeExisted) { Copy-Item -LiteralPath $TargetBridge -Destination (Join-Path $BackupPath 'dbghelp.dll') }
if ($manifest.pluginExisted) { Copy-Item -LiteralPath $PluginPath -Destination (Join-Path $BackupPath 'plugin') -Recurse }
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $BackupPath 'backup.json') -Encoding UTF8

try {
    if (-not $manifest.liteLoaderExisted) { New-Item -ItemType Directory -Path $LiteLoaderPath -Force | Out-Null }
    Expand-Archive -LiteralPath $LoaderArchive -DestinationPath $LiteLoaderPath -Force
    $loaderStorePath = Join-Path $LiteLoaderPath 'src\main\store.js'
    $loaderStoreText = [IO.File]::ReadAllText($loaderStorePath)
    $oldDirentCode = 'path.join(dirent.path, dirent.name, "manifest.json")'
    $newDirentCode = 'path.join(dirent.parentPath ?? dirent.path, dirent.name, "manifest.json")'
    if (-not $loaderStoreText.Contains($newDirentCode)) {
        $occurrences = ([regex]::Matches($loaderStoreText, [regex]::Escape($oldDirentCode))).Count
        if ($occurrences -ne 1) { throw "Unexpected LiteLoader store.js compatibility pattern count: $occurrences" }
        $loaderStoreText = $loaderStoreText.Replace($oldDirentCode, $newDirentCode)
        [IO.File]::WriteAllText($loaderStorePath, $loaderStoreText, [Text.UTF8Encoding]::new($false))
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $PluginPath) -Force | Out-Null
    $stage = Join-Path $BackupPath 'plugin-stage'
    Expand-Archive -LiteralPath $PluginArchive -DestinationPath $stage -Force
    if (Test-Path -LiteralPath $PluginPath) { Remove-Item -LiteralPath $PluginPath -Recurse -Force }
    Copy-Item -LiteralPath (Join-Path $stage 'QQ-Local-Recall') -Destination $PluginPath -Recurse

    Copy-Item -LiteralPath $BridgeDll -Destination $TargetBridge -Force
    New-Item -ItemType Directory -Path (Split-Path -Parent $LauncherPath) -Force | Out-Null
    $loaderLiteral = $LiteLoaderPath.Replace('`', '``')
    [IO.File]::WriteAllText($LauncherPath, "require(String.raw``$loaderLiteral``);`r`n", [Text.UTF8Encoding]::new($false))

    $packageText = [IO.File]::ReadAllText($PackagePath)
    $pattern = '("main"\s*:\s*)"(?:[^"\\]|\\.)*"'
    $matches = [regex]::Matches($packageText, $pattern)
    if ($matches.Count -ne 1) { throw "Expected one package.json main field, found $($matches.Count)." }
    $updated = [regex]::Replace($packageText, $pattern, '$1"./app_launcher/LiteLoaderQQNT.js"', 1)
    [IO.File]::WriteAllText($PackagePath, $updated, [Text.UTF8Encoding]::new($false))
    Write-Host "Installation files written. Backup: $BackupPath"
} catch {
    Write-Error $_
    & (Join-Path $PSScriptRoot 'rollback.ps1') -BackupPath $BackupPath
    throw
}
