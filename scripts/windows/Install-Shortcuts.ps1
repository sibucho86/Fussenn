param([switch]$Quiet)
. (Join-Path $PSScriptRoot 'Common.ps1')
try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shell = New-Object -ComObject WScript.Shell
    # Shortcuts from before the rename point to scripts that no longer exist. Remove only the ones for this folder.
    foreach ($legacy in @(@{ name = 'SideNote AI'; script = 'Launch-SideNote.ps1' }, @{ name = 'SideNote AI - Stop'; script = 'Stop-SideNote.ps1' })) {
        $legacyPath = Join-Path $desktop ($legacy.name + '.lnk')
        if ((Test-Path -LiteralPath $legacyPath) -and $shell.CreateShortcut($legacyPath).Arguments -like ('*{0}*' -f (Join-Path $PSScriptRoot $legacy.script))) { Remove-Item -LiteralPath $legacyPath }
    }
    foreach ($entry in @(@{ name = 'Fussenn Browser'; script = 'Launch-Fussenn.ps1'; icon = 1 }, @{ name = 'Fussenn Browser - Stop'; script = 'Stop-Fussenn.ps1'; icon = 131 })) {
        $shortcutPath = Join-Path $desktop ($entry.name + '.lnk')
        $shortcut = $shell.CreateShortcut($shortcutPath)
        if ((Test-Path -LiteralPath $shortcutPath) -and $shortcut.Arguments -notlike ('*{0}*' -f (Join-Path $PSScriptRoot $entry.script))) { throw "An unrelated shortcut already exists: $shortcutPath" }
        $shortcut.TargetPath = $powershell
        $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $PSScriptRoot $entry.script)
        $shortcut.WorkingDirectory = $script:FussennRoot
        $shortcut.WindowStyle = 7
        $shortcut.Description = 'Fussenn local workspace'
        $shortcut.IconLocation = '{0}\System32\shell32.dll,{1}' -f $env:SystemRoot, $entry.icon
        $shortcut.Save()
    }
    Write-Output 'Created Fussenn Browser and Fussenn Browser - Stop on the desktop.'
} catch { Show-FussennError $_.Exception.Message ([bool]$Quiet); exit 1 }
