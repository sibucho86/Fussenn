param(
    [Parameter(Mandatory = $true)][ValidatePattern('^Fussenn-Test-[a-f0-9]{12}$')][string]$ProductName,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9-]{36}$')][string]$TestGuid
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Read-Sha256([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

function Read-RegistryValues([string]$Path) {
    if (!(Test-Path -LiteralPath $Path)) { return $null }
    $key = Get-Item -LiteralPath $Path
    $values = [ordered]@{}
    foreach ($name in ($key.GetValueNames() | Sort-Object)) { $values[$name] = $key.GetValue($name) }
    return $values
}
function Read-Shortcut([string]$Path) {
    if (!(Test-Path -LiteralPath $Path)) { return $null }
    $shell = New-Object -ComObject WScript.Shell
    try {
        $link = $shell.CreateShortcut($Path)
        return [ordered]@{
            path = $Path; target = $link.TargetPath; arguments = $link.Arguments
            icon = $link.IconLocation; workingDirectory = $link.WorkingDirectory
            sha256 = Read-Sha256 $Path
        }
    } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}

$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$programs = [Environment]::GetFolderPath('Programs')
$uninstallRoot = 'Software\Microsoft\Windows\CurrentVersion\Uninstall'
# The everyday app may still be the version from before the rename (SideNote AI); protect both.
$production = [ordered]@{ registry = @(); shortcuts = @(); executables = @() }
foreach ($hive in @('HKEY_CURRENT_USER', 'HKEY_LOCAL_MACHINE')) {
    foreach ($suffix in @($uninstallRoot, "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")) {
        $base = "Registry::$hive\$suffix"
        if (!(Test-Path -LiteralPath $base)) { continue }
        foreach ($key in (Get-ChildItem -LiteralPath $base | Sort-Object Name)) {
            if ($key.GetValue('DisplayName') -notmatch '^(Fussenn|SideNote AI)( |$)') { continue }
            $production.registry += [ordered]@{
                path = $key.Name; values = (Read-RegistryValues "Registry::$($key.Name)")
                installInfo = (Read-RegistryValues "Registry::$hive\Software\$($key.PSChildName)")
            }
        }
    }
}
foreach ($folder in @($desktop, $programs)) {
    foreach ($link in (@('Fussenn*.lnk', 'SideNote*.lnk') | ForEach-Object { Get-ChildItem -LiteralPath $folder -Filter $_ -File } | Sort-Object Name)) {
        if ($link.BaseName -eq $ProductName) { continue }
        $production.shortcuts += Read-Shortcut $link.FullName
    }
}
foreach ($realExe in @((Join-Path $env:LOCALAPPDATA 'Programs\Fussenn\Fussenn.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\SideNote AI\SideNote AI.exe'))) {
    if (Test-Path -LiteralPath $realExe) { $production.executables += [ordered]@{ path = $realExe; sha256 = Read-Sha256 $realExe } }
}
[ordered]@{
    desktop = $desktop; programs = $programs; localAppData = $env:LOCALAPPDATA
    currentUser = Read-RegistryValues "Registry::HKEY_CURRENT_USER\$uninstallRoot\$TestGuid"
    installInfo = Read-RegistryValues "Registry::HKEY_CURRENT_USER\Software\$TestGuid"
    allUsers = Read-RegistryValues "Registry::HKEY_LOCAL_MACHINE\$uninstallRoot\$TestGuid"
    allUsers32 = Read-RegistryValues "Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$TestGuid"
    desktopShortcut = Read-Shortcut (Join-Path $desktop "$ProductName.lnk")
    startMenuShortcut = Read-Shortcut (Join-Path $programs "$ProductName.lnk")
    production = $production
} | ConvertTo-Json -Depth 10 -Compress
