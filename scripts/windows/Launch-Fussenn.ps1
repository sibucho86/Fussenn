param([ValidateRange(1024, 65535)][int]$Port = 3000, [switch]$NoBrowser, [switch]$Quiet)
. (Join-Path $PSScriptRoot 'Common.ps1')
$mutex = New-Object Threading.Mutex($false, "Local\Fussenn-$(Get-FussennWorkspaceId)-$Port")
$acquired = $false
$newState = $null
$ready = $false
try {
    try { $acquired = $mutex.WaitOne(120000) } catch [Threading.AbandonedMutexException] { $acquired = $true }
    if (-not $acquired) { throw 'Fussenn is still starting. Please try again shortly.' }
    $health = Get-FussennHealth $Port
    if (-not (Test-FussennHealth $health)) {
        if (Test-FussennPort $Port) { throw "Port $Port is being used by another server. Close that server or use a different port." }
        $node = (Get-Command node -ErrorAction Stop).Source
        $version = & $node --version
        if ($version -notmatch '^v(\d+)\.(\d+)' -or [int]$Matches[1] -lt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 13)) { throw 'Fussenn requires Node.js 22.13 or later.' }
        if (-not (Test-Path -LiteralPath (Join-Path $script:FussennRoot 'node_modules\next\dist\bin\next'))) { throw 'Dependencies are missing. Run npm install in the Fussenn folder first.' }
        New-Item -ItemType Directory -Path $script:FussennRuntime -Force | Out-Null
        $nextScript = Join-Path $script:FussennRoot 'scripts\next.mjs'
        if (-not (Test-Path -LiteralPath (Join-Path $script:FussennRoot '.next\BUILD_ID'))) {
            $build = Start-Process -FilePath $node -ArgumentList @(('"{0}"' -f $nextScript), 'build') -WorkingDirectory $script:FussennRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $script:FussennRuntime 'desktop-build.out.log') -RedirectStandardError (Join-Path $script:FussennRuntime 'desktop-build.err.log') -PassThru
            $build.WaitForExit()
            if ($build.ExitCode -ne 0) { throw 'The build failed. See .tmp\desktop-build.err.log in the Fussenn folder.' }
        }
        $server = Start-Process -FilePath $node -ArgumentList @(('"{0}"' -f $nextScript), 'start', '--hostname', '127.0.0.1', '--port', $Port) -WorkingDirectory $script:FussennRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $script:FussennRuntime "desktop-$Port.out.log") -RedirectStandardError (Join-Path $script:FussennRuntime "desktop-$Port.err.log") -PassThru
        $newState = @{ root = $script:FussennRoot; port = $Port; processId = $server.Id; startedAt = $server.StartTime.ToUniversalTime().Ticks.ToString() }
        $newState | ConvertTo-Json | Set-Content -LiteralPath (Get-FussennStatePath $Port) -Encoding UTF8
        $ready = $false
        $deadline = [DateTime]::UtcNow.AddSeconds(60)
        while ([DateTime]::UtcNow -lt $deadline) {
            if ($server.HasExited) { throw "Fussenn stopped during startup. See .tmp\desktop-$Port.err.log." }
            if (Test-FussennHealth (Get-FussennHealth $Port)) { $ready = $true; break }
            Start-Sleep -Milliseconds 300
        }
        if (-not $ready) { throw "Fussenn did not become ready. See .tmp\desktop-$Port.err.log." }
    }
    if (-not $NoBrowser) { Start-Process -FilePath "http://127.0.0.1:$Port" | Out-Null }
    Write-Output "Fussenn is ready at http://127.0.0.1:$Port"
} catch {
    if ($newState -and -not $ready) { try { Stop-FussennOwnedProcess $newState } catch { Write-Warning 'Could not clean up the server started by this launch.' } }
    Show-FussennError $_.Exception.Message ([bool]$Quiet)
    exit 1
} finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
