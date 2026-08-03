param(
  [string]$TaskName = "RemoteMonitoringAgent",
  [string]$InstallDir = "$env:LOCALAPPDATA\RemoteMonitoringAgent",
  [switch]$RemoveConfig
)

$ErrorActionPreference = "Stop"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$exePath = Join-Path $InstallDir "agent.exe"

Get-Process -Name "agent" -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $exePath } |
  Stop-Process -Force

$deadline = (Get-Date).AddSeconds(10)
while (
  (Get-Process -Name "agent" -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath }) -and
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

if ($RemoveConfig) {
  $configPath = Join-Path $env:APPDATA "remote-monitor-agent.json"
  if (Test-Path -LiteralPath $configPath) {
    Remove-Item -LiteralPath $configPath -Force
  }
}

Write-Host "Agente desinstalado. La tarea $TaskName fue removida."
