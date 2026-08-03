param(
  [string]$TaskName = "RemoteMonitoringAgent",
  [string]$InstallDir = "$env:ProgramFiles\RemoteMonitoringAgent",
  [string]$ConfigDir = "$env:ProgramData\RemoteMonitoringAgent",
  [switch]$KeepConfig
)

$ErrorActionPreference = "Stop"

Write-Host "== Desinstalacion silenciosa del agente =="

try {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
  Write-Host "Tarea '$TaskName' removida."
} catch {
  & schtasks.exe /delete /f /tn $TaskName 2>$null | Out-Null
}

$exePath = Join-Path $InstallDir "agent.exe"

Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $exePath } |
  Stop-Process -Force

$deadline = (Get-Date).AddSeconds(10)
while (
  (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath }) -and
  (Get-Date) -lt $deadline
) {
  Start-Sleep -Milliseconds 200
}

$deadline = (Get-Date).AddSeconds(10)
while ((Test-Path -LiteralPath $InstallDir) -and (Get-Date) -lt $deadline) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $InstallDir) {
    Start-Sleep -Milliseconds 200
  }
}

if (Test-Path -LiteralPath $InstallDir) {
  Write-Warning "No se pudo borrar $InstallDir (probablemente en uso)."
}

if (-not $KeepConfig) {
  $deadline = (Get-Date).AddSeconds(10)
  while ((Test-Path -LiteralPath $ConfigDir) -and (Get-Date) -lt $deadline) {
    Remove-Item -LiteralPath $ConfigDir -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $ConfigDir) {
      Start-Sleep -Milliseconds 200
    }
  }
  if (Test-Path -LiteralPath $ConfigDir) {
    Write-Warning "No se pudo borrar $ConfigDir (probablemente en uso)."
  }
}

Write-Host "Agente desinstalado. La tarea $TaskName fue removida."
exit 0
