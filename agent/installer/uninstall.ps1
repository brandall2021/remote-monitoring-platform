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

if (Test-Path -LiteralPath $InstallDir) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
}

if ($RemoveConfig) {
  $configPath = Join-Path $env:APPDATA "remote-monitor-agent.json"
  if (Test-Path -LiteralPath $configPath) {
    Remove-Item -LiteralPath $configPath -Force
  }
}

Write-Host "Agente desinstalado. La tarea $TaskName fue removida."
