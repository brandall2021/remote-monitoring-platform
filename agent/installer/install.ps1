param(
  [string]$AgentPath = "",
  [string]$ServerUrl = "",
  [string]$RegistrationToken = "",
  [string]$TaskName = "RemoteMonitoringAgent",
  [string]$InstallDir = "$env:LOCALAPPDATA\RemoteMonitoringAgent"
)

$ErrorActionPreference = "Stop"

if (-not $AgentPath) {
  $candidates = @(
    "$PSScriptRoot\..\agent-live.exe",
    "$PSScriptRoot\..\agent.exe"
  )
  $AgentPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if (-not $AgentPath -or -not (Test-Path -LiteralPath $AgentPath)) {
  Write-Error "No se encontro el ejecutable del agente. Pasalo con -AgentPath."
  exit 1
}

$exePath = Join-Path $InstallDir "agent.exe"
$vbsPath = Join-Path $InstallDir "run-hidden.vbs"
$configPath = Join-Path $env:APPDATA "remote-monitor-agent.json"

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

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

Copy-Item -LiteralPath $AgentPath -Destination $exePath -Force

@"
Set sh = CreateObject("WScript.Shell")
sh.Run """" & WScript.Arguments(0) & """", 0, False
"@ | Set-Content -LiteralPath $vbsPath -Encoding ASCII

$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument "`"$vbsPath`" `"$exePath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Agente de Monitoreo Remoto" -Force | Out-Null

if ($ServerUrl -and (Test-Path -LiteralPath $configPath)) {
  Remove-Item -LiteralPath $configPath -Force
}

if (-not (Test-Path -LiteralPath $configPath)) {
  if (-not $ServerUrl) {
    $ServerUrl = Read-Host "SERVER_URL (ej. https://monitor.recuperocrediticio.com)"
  }
  if (-not $RegistrationToken) {
    $RegistrationToken = Read-Host "AGENT_REGISTRATION_TOKEN"
  }
  if ($ServerUrl) { $env:SERVER_URL = $ServerUrl }
  if ($RegistrationToken) { $env:REGISTRATION_TOKEN = $RegistrationToken }
}

Start-Process -FilePath "$env:SystemRoot\System32\wscript.exe" -ArgumentList @("`"$vbsPath`"", "`"$exePath`"") -WindowStyle Hidden

Write-Host ""
Write-Host "Agente instalado y en ejecucion."
Write-Host "  Tarea:      $TaskName (se ejecuta al iniciar sesion)"
Write-Host "  Instalado:  $exePath"
Write-Host ""
Write-Host "Para desinstalar:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSScriptRoot\uninstall.ps1`""
