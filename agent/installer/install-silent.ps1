param(
  [string]$ServerUrl = "",
  [string]$RegistrationToken = "",
  [string]$AgentPath = "",
  [string]$TaskName = "RemoteMonitoringAgent",
  [string]$InstallDir = "$env:ProgramFiles\RemoteMonitoringAgent",
  [string]$ConfigDir = "$env:ProgramData\RemoteMonitoringAgent",
  [switch]$SkipTaskRegistration
)

$ErrorActionPreference = "Stop"

function Write-ConfigNoBom {
  param([string]$Path, [string]$Json)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Json, $utf8NoBom)
}

if (-not $ServerUrl) {
  $ServerUrl = $env:RM_SERVER_URL
}
if (-not $RegistrationToken) {
  $RegistrationToken = $env:RM_REGISTRATION_TOKEN
}

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
$configPath = Join-Path $ConfigDir "agent.json"

Write-Host "== Instalacion silenciosa del agente =="

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

# Detener instancias previas instaladas en este directorio
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

Copy-Item -LiteralPath $AgentPath -Destination $exePath -Force

@"
Set sh = CreateObject("WScript.Shell")
sh.Run """" & WScript.Arguments(0) & """", 0, False
"@ | Set-Content -LiteralPath $vbsPath -Encoding ASCII

# La config se guarda a nivel maquina (%ProgramData%) para que todos los
# usuarios de la PC compartan un unico deviceId. El agente ya la lee desde ahi.
$existingConfig = $null
if (Test-Path -LiteralPath $configPath) {
  try { $existingConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } catch { $existingConfig = $null }
}

if (-not $existingConfig -or -not $existingConfig.deviceId) {
  if ($ServerUrl -and $RegistrationToken) {
    Write-Host "Registrando el equipo contra $ServerUrl ..."
    try {
      $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" } |
        Select-Object -First 1).IPAddress
      if (-not $ip) { $ip = "unknown" }
      $mac = (Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
        Where-Object { $_.Status -eq "Up" } | Select-Object -First 1).MacAddress
      if (-not $mac) { $mac = $null }

      $body = @{
        hostname          = $env:COMPUTERNAME
        operatingSystem   = "win32"
        osVersion         = [System.Environment]::OSVersion.VersionString
        ipAddress         = $ip
        macAddress        = $mac
        platform          = $env:PROCESSOR_ARCHITECTURE
        agentVersion      = "1.0.0"
        registrationToken = $RegistrationToken
      } | ConvertTo-Json

      $resp = Invoke-RestMethod -Uri "$ServerUrl/api/devices/register" -Method Post `
        -ContentType "application/json" -Body $body -TimeoutSec 20

      $config = @{
        serverUrl         = $ServerUrl
        deviceId          = $resp.id
        registrationToken = $resp.registrationToken
        agentVersion      = "1.0.0"
        heartbeatInterval = 30000
      } | ConvertTo-Json
      Write-ConfigNoBom -Path $configPath -Json $config
      Write-Host "Equipo registrado con deviceId $($resp.id)"
    } catch {
      Write-Warning "No se pudo registrar el equipo ahora ($($_.Exception.Message)). El agente se registrara en el primer inicio de sesion."
      $config = @{
        serverUrl         = $ServerUrl
        registrationToken = $RegistrationToken
        agentVersion      = "1.0.0"
        heartbeatInterval = 30000
      } | ConvertTo-Json
      Write-ConfigNoBom -Path $configPath -Json $config
    }
  } elseif (-not $existingConfig) {
    Write-Error "Faltan -ServerUrl y -RegistrationToken (o no hay config previa)."
    exit 1
  }
}

# Permiso de escritura para que el agente (usuario comun) pueda guardar el
# deviceId de registro en la config de maquina si fuera necesario.
icacls $ConfigDir /grant "*S-1-5-32-545:(OI)(CI)M" /T | Out-Null

if (-not $SkipTaskRegistration) {
  Write-Host "Registrando tarea '$TaskName' al logon de cualquier usuario ..."
  try {
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument "`"$vbsPath`" `"$exePath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
    $principal = New-ScheduledTaskPrincipal -UserId "S-1-5-32-545" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
      -Settings $settings -Principal $principal -Description "Agente de Monitoreo Remoto" -Force | Out-Null
  } catch {
    Write-Warning "Register-ScheduledTask fallo ($($_.Exception.Message)), probando schtasks ..."
    $cmd = "wscript.exe `"$vbsPath`" `"$exePath`""
    & schtasks.exe /create /f /tn $TaskName /tr $cmd /sc onlogon /rl LIMITED | Out-Null
  }
}

# Arrancar el agente en la sesion actual si hay una sesion interactiva activa
# (no en Session 0). Si no hay sesion, la tarea lo levanta en el proximo logon.
$activeSession = quser 2>$null | Out-String
if ($activeSession -match "Active") {
  Start-Process -FilePath "$env:SystemRoot\System32\wscript.exe" -ArgumentList @("`"$vbsPath`"", "`"$exePath`"") -WindowStyle Hidden
  Write-Host "Agente iniciado en la sesion activa."
} else {
  Write-Host "No hay sesion interactiva activa: el agente arrancara en el proximo inicio de sesion."
}

Write-Host ""
Write-Host "Instalacion completada."
Write-Host "  Ejecutable: $exePath"
Write-Host "  Config:     $configPath"
Write-Host "  Tarea:      $TaskName (al logon de cualquier usuario)"
Write-Host ""
Write-Host "Desinstalacion:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSScriptRoot\uninstall-silent.ps1`""
exit 0
