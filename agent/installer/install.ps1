param(
  [string]$AgentPath = "",
  [string]$TrayPath = "",
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

if (-not $TrayPath) {
  $TrayPath = "$PSScriptRoot\..\tray\RmTray.exe"
}

$trayAvailable = Test-Path -LiteralPath $TrayPath
if (-not $trayAvailable) {
  # Sin la bandeja el agente sigue funcionando; solo perdemos el icono de aviso.
  # Se avisa en vez de fallar: instalar el monitoreo no puede romperse por un binario opcional.
  Write-Warning "No se encontro $TrayPath. Ejecute 'npm run build:tray' en agent/ para generarlo."
}

$exePath = Join-Path $InstallDir "agent.exe"
$trayExePath = Join-Path $InstallDir "RmTray.exe"
$vbsPath = Join-Path $InstallDir "run-hidden.vbs"
$configPath = Join-Path $env:APPDATA "remote-monitor-agent.json"

function Write-ConfigNoBom {
  param([string]$Path, [hashtable]$Config)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, ($Config | ConvertTo-Json), $utf8NoBom)
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

Get-Process -Name "agent", "RmTray" -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $exePath -or $_.Path -eq $trayExePath } |
  Stop-Process -Force

$deadline = (Get-Date).AddSeconds(10)
while (
  (Get-Process -Name "agent" -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath }) -and
  (Get-Date) -lt $deadline
) {
  Start-Sleep -Milliseconds 200
}

Copy-Item -LiteralPath $AgentPath -Destination $exePath -Force
if ($trayAvailable) {
  Copy-Item -LiteralPath $TrayPath -Destination $trayExePath -Force
  Remove-Item -LiteralPath $vbsPath -Force -ErrorAction SilentlyContinue
}

if ($trayAvailable) {
  # RmTray.exe es /target:winexe: no abre consola, asi que ya no hace falta el envoltorio vbs.
  # La bandeja levanta y vigila al agente (reinicio con backoff) ademas de mostrar el estado.
  $launchExe = $trayExePath
  $launchArgs = ""
} else {
  @"
Set sh = CreateObject("WScript.Shell")
sh.Run """" & WScript.Arguments(0) & """", 0, False
"@ | Set-Content -LiteralPath $vbsPath -Encoding ASCII
  $launchExe = "$env:SystemRoot\System32\wscript.exe"
  $launchArgs = "`"$vbsPath`" `"$exePath`""
}

$action = New-ScheduledTaskAction -Execute $launchExe -Argument $launchArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Agente de Monitoreo Remoto (icono de bandeja + agente)" -Force | Out-Null

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
  if (-not $ServerUrl -or -not $RegistrationToken) {
    Write-Error "SERVER_URL y AGENT_REGISTRATION_TOKEN son obligatorios."
    exit 1
  }
  # Persist bootstrap data. Environment variables from this installer process
  # are not inherited by the scheduled task at the next logon.
  Write-ConfigNoBom -Path $configPath -Config @{
    serverUrl = $ServerUrl.TrimEnd('/')
    registrationToken = $RegistrationToken
    agentVersion = "1.1.0"
    heartbeatInterval = 30000
  }
}

if ($trayAvailable) {
  Start-Process -FilePath $trayExePath -WindowStyle Hidden
} else {
  Start-Process -FilePath $launchExe -ArgumentList @("`"$vbsPath`"", "`"$exePath`"") -WindowStyle Hidden
}

Write-Host ""
Write-Host "Agente instalado y en ejecucion."
Write-Host "  Tarea:      $TaskName (se ejecuta al iniciar sesion)"
Write-Host "  Bandeja:    $(if ($trayAvailable) { $trayExePath } else { 'no instalada' })"
Write-Host "  Instalado:  $exePath"
Write-Host ""
Write-Host "El empleado ve un punto de color en la bandeja y el menu del icono es solo informativo:"
Write-Host "no se puede pausar ni apagar el monitoreo desde ahi."
Write-Host ""
Write-Host "Para desinstalar:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSScriptRoot\uninstall.ps1`""
