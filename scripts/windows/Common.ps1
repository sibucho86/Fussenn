Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:FussennRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$script:FussennRuntime = Join-Path $script:FussennRoot '.tmp'

function Get-FussennWorkspaceId {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($script:FussennRoot.ToLowerInvariant())))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
}
function Get-FussennHealth([int]$Port) {
    try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2 }
    catch { return $null }
}
function Test-FussennHealth($Health) {
    # A server started before the rename from SideNote AI reports its previous name.
    return $null -ne $Health -and $Health.PSObject.Properties.Name -contains 'app' -and $Health.app -in @('fussenn', 'sidenote-ai') -and $Health.PSObject.Properties.Name -contains 'workspaceId' -and $Health.workspaceId -eq (Get-FussennWorkspaceId)
}
function Test-FussennPort([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try { $task = $client.ConnectAsync('127.0.0.1', $Port); return $task.Wait(700) -and $client.Connected }
    catch { return $false }
    finally { $client.Dispose() }
}
function Get-FussennStatePath([int]$Port) { return Join-Path $script:FussennRuntime "desktop-server-$Port.json" }
function Get-FussennOwnedProcess($State) {
    if ($State.root -ne $script:FussennRoot) { throw 'The recorded server belongs to a different folder.' }
    $running = Get-Process -Id $State.processId -ErrorAction SilentlyContinue
    if (-not $running) { return $null }
    if ($running.StartTime.ToUniversalTime().Ticks -ne $State.startedAt) { throw 'The recorded process has been replaced. No process was stopped.' }
    $info = Get-CimInstance Win32_Process -Filter "ProcessId = $($State.processId)"
    $nextScript = Join-Path $script:FussennRoot 'scripts\next.mjs'
    if (-not $info -or $info.CommandLine.Trim() -notlike "*$nextScript* start --hostname 127.0.0.1 --port $($State.port)") { throw 'The recorded process is not this Fussenn server.' }
    return $running
}
function Stop-FussennOwnedProcess($State) {
    if (Get-FussennOwnedProcess $State) {
        & taskkill.exe /PID $State.processId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'The Fussenn process could not be stopped.' }
    }
}
function Show-FussennError([string]$Message, [bool]$Quiet) {
    if (-not $Quiet) {
        Add-Type -AssemblyName PresentationFramework
        [Windows.MessageBox]::Show($Message, 'Fussenn', 'OK', 'Error') | Out-Null
    }
    Write-Error -Message $Message -ErrorAction Continue
}
