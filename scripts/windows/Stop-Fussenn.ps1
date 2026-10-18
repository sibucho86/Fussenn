param([ValidateRange(1024, 65535)][int]$Port = 3000, [switch]$Quiet)
. (Join-Path $PSScriptRoot 'Common.ps1')
$mutex = New-Object Threading.Mutex($false, "Local\Fussenn-$(Get-FussennWorkspaceId)-$Port")
$acquired = $false
try {
    try { $acquired = $mutex.WaitOne(120000) } catch [Threading.AbandonedMutexException] { $acquired = $true }
    if (-not $acquired) { throw 'Fussenn is still starting. Please try again shortly.' }
    $statePath = Get-FussennStatePath $Port
    if (-not (Test-Path -LiteralPath $statePath)) {
        if (Test-FussennPort $Port) { throw 'This server was not started by the desktop launcher. Close it from its original terminal.' }
        Write-Output 'Fussenn is already stopped.'
        exit 0
    }
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if (Get-FussennOwnedProcess $state) {
        $health = Get-FussennHealth $Port
        if (-not (Test-FussennHealth $health)) { throw 'The server status could not be verified. Please try again shortly.' }
        if ($health.activeGenerations -gt 0) { throw 'An AI answer is still being generated. Wait for it to finish before closing Fussenn.' }
        Stop-FussennOwnedProcess $state
    }
    Remove-Item -LiteralPath $statePath
    Write-Output 'Fussenn has stopped. Your saved conversations are kept.'
} catch { Show-FussennError $_.Exception.Message ([bool]$Quiet); exit 1 }
finally { if ($acquired) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
