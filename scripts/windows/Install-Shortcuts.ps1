param([switch]$Quiet)
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot 'Shortcut.ps1')
try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    # Compare as plain text: a folder name may contain [ or ], which -like reads as a pattern.
    function Test-RunsScript([string]$Link, [string]$Script) { return (Read-FussennShortcut $Link).arguments.IndexOf($Script, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
    # Shortcuts from before the rename point to scripts that no longer exist. Remove only the ones for this folder.
    foreach ($legacy in @(@{ name = 'SideNote AI'; script = 'Launch-SideNote.ps1' }, @{ name = 'SideNote AI - Stop'; script = 'Stop-SideNote.ps1' })) {
        $legacyPath = Join-Path $desktop ($legacy.name + '.lnk')
        if ((Test-Path -LiteralPath $legacyPath) -and (Test-RunsScript $legacyPath (Join-Path $PSScriptRoot $legacy.script))) { Remove-Item -LiteralPath $legacyPath }
    }
    foreach ($entry in @(@{ name = 'Fussenn Browser'; script = 'Launch-Fussenn.ps1'; icon = 1 }, @{ name = 'Fussenn Browser - Stop'; script = 'Stop-Fussenn.ps1'; icon = 131 })) {
        $shortcutPath = Join-Path $desktop ($entry.name + '.lnk')
        $scriptPath = Join-Path $PSScriptRoot $entry.script
        if ((Test-Path -LiteralPath $shortcutPath) -and -not (Test-RunsScript $shortcutPath $scriptPath)) { throw "An unrelated shortcut already exists: $shortcutPath" }
        # Show command 7 starts PowerShell minimized without taking focus.
        Save-FussennShortcut $shortcutPath $powershell ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $scriptPath) $script:FussennRoot 'Fussenn local workspace' (Join-Path $env:SystemRoot 'System32\shell32.dll') $entry.icon 7
    }
    Write-Output 'Created Fussenn Browser and Fussenn Browser - Stop on the desktop.'
} catch { Show-FussennError $_.Exception.Message ([bool]$Quiet); exit 1 }
