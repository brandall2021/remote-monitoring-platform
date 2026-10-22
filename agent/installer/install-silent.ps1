param(
  [string]$ServerUrl = "",
  [string]$RegistrationToken = "",
  [string]$AgentPath = "",
  [string]$TrayPath = "",
  [string]$TaskName = "RemoteMonitoringAgent",
  [string]$TrayTaskName = "RemoteMonitoringAgent-Tray",
  [string]$InstallDir = "$env:ProgramFiles\RemoteMonitoringAgent",
  [string]$ConfigDir = "$env:ProgramData\RemoteMonitoringAgent",
  [switch]$SkipTaskRegistration,
  [switch]$Session0
)

$ErrorActionPreference = "Stop"

function Write-ConfigNoBom {
  param([string]$Path, [string]$Json)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Json, $utf8NoBom)
}

function Register-TrayLogonTask {
  param(
    [string]$TrayExe,
    [string]$Name,
    [string]$Arguments,
    [string]$Description
  )

  try {
    $action = New-ScheduledTaskAction -Execute $TrayExe -Argument $Arguments
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "S-1-5-32-545" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger `
      -Settings $settings -Principal $principal -Description $Description -Force | Out-Null
    return $true
  } catch {
    Write-Warning "Register-ScheduledTask fallo ($($_.Exception.Message)), probando schtasks ..."
    & schtasks.exe /create /f /tn $Name /tr "`"$TrayExe`" $Arguments" /sc onlogon /rl LIMITED | Out-Null
    return ($LASTEXITCODE -eq 0)
  }
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

if (-not $TrayPath) {
  $TrayPath = "$PSScriptRoot\..\tray\RmTray.exe"
}
$trayAvailable = Test-Path -LiteralPath $TrayPath
if (-not $trayAvailable) {
  # La bandeja es el aviso al usuario, no una dependencia del monitoreo: si falta, se instala igual
  # y se avisa. Perder el icono no justifica que un despliegue por GPO falle.
  Write-Warning "No se encontro $TrayPath. Ejecute 'npm run build:tray' en agent/ para generarlo."
}

$exePath = Join-Path $InstallDir "agent.exe"
$trayExePath = Join-Path $InstallDir "RmTray.exe"
$vbsPath = Join-Path $InstallDir "run-hidden.vbs"
$configPath = Join-Path $ConfigDir "agent.json"

Write-Host "== Instalacion silenciosa del agente =="

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

# Detener instancias previas instaladas en este directorio
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $exePath -or $_.Path -eq $trayExePath } |
  Stop-Process -Force

$deadline = (Get-Date).AddSeconds(10)
while (
  (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exePath }) -and
  (Get-Date) -lt $deadline
) {
  Start-Sleep -Milliseconds 200
}

Copy-Item -LiteralPath $AgentPath -Destination $exePath -Force
if ($trayAvailable) {
  Copy-Item -LiteralPath $TrayPath -Destination $trayExePath -Force
}

# El bridge de sesion es necesario solo en modo Session 0: lo usa el supervisor
# para lanzar el worker dentro de la sesion interactiva del usuario.
if (Test-Path -LiteralPath "$PSScriptRoot\start-session.ps1") {
  Copy-Item -LiteralPath "$PSScriptRoot\start-session.ps1" -Destination (Join-Path $InstallDir "start-session.ps1") -Force
}

if ($trayAvailable) {
  # RmTray.exe se compila con /target:winexe: no abre consola, asi que el envoltorio vbs
  # que usaban las versiones anteriores queda de mas y se borra.
  Remove-Item -LiteralPath $vbsPath -Force -ErrorAction SilentlyContinue
} else {
@"
Set sh = CreateObject("WScript.Shell")
sh.Run """" & WScript.Arguments(0) & """", 0, False
"@ | Set-Content -LiteralPath $vbsPath -Encoding ASCII
}

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
        agentVersion      = "1.1.0"
        registrationToken = $RegistrationToken
      } | ConvertTo-Json

      $resp = Invoke-RestMethod -Uri "$ServerUrl/api/devices/register" -Method Post `
        -ContentType "application/json" -Body $body -TimeoutSec 20

      $config = @{
        serverUrl         = $ServerUrl
        deviceId          = $resp.id
        registrationToken = $resp.registrationToken
        agentVersion      = "1.1.0"
        heartbeatInterval = 30000
      } | ConvertTo-Json
      Write-ConfigNoBom -Path $configPath -Json $config
      Write-Host "Equipo registrado con deviceId $($resp.id)"
    } catch {
      Write-Warning "No se pudo registrar el equipo ahora ($($_.Exception.Message)). El agente se registrara en el primer inicio de sesion."
      $config = @{
        serverUrl         = $ServerUrl
        registrationToken = $RegistrationToken
        agentVersion      = "1.1.0"
        heartbeatInterval = 30000
      } | ConvertTo-Json
      Write-ConfigNoBom -Path $configPath -Json $config
    }
  } elseif (-not $existingConfig) {
    Write-Error "Faltan -ServerUrl y -RegistrationToken (o no hay config previa)."
    exit 1
  }
}

# ACL del config. El token que guarda agent.json es la credencial del equipo: quien lo lee, pasa
# por ese agente ante el server, y quien lo escribe puede repuntar el agente a un server propio.
# El grant historico era Users:(OI)(CI)M, o sea modificar y leer para cualquier cuenta local.
# Se corta la herencia y queda: SYSTEM + Administradores total; Users solo lectura, y nada cuando
# el agente corre como SYSTEM (Session 0), que es el modo del instalador .iss.
& icacls $ConfigDir /inheritance:r `
  /grant "*S-1-5-18:(OI)(CI)F" `
  /grant "*S-1-5-32-544:(OI)(CI)F" | Out-Null

if (-not $Session0) {
  & icacls $ConfigDir /grant "*S-1-5-32-545:(OI)(CI)RX" | Out-Null
  & icacls $configPath /inheritance:r /grant "*S-1-5-18:F" /grant "*S-1-5-32-544:F" /grant "*S-1-5-32-545:R" | Out-Null
  Write-Warning "Modo logon: cualquier usuario local puede leer el token del equipo en $configPath. Para despliegues gestionados usa -Session0."
} else {
  & icacls $configPath /inheritance:r /grant "*S-1-5-18:F" /grant "*S-1-5-32-544:F" | Out-Null
  Write-Host "Config de agente protegida: solo SYSTEM y Administradores la pueden leer."
}

if ($Session0) {
  Write-Host "Registrando tarea '$TaskName' al inicio de Windows como SYSTEM (Session 0) ..."
  $action = New-ScheduledTaskAction -Execute $exePath -Argument "--role=supervisor"
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId "S-1-5-18" -LogonType ServiceAccount -RunLevel Highest
  try {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
      -Settings $settings -Principal $principal -Description "Agente de Monitoreo Remoto (Session 0)" -Force | Out-Null
  } catch {
    Write-Warning "Register-ScheduledTask fallo ($($_.Exception.Message)), probando schtasks ..."
    & schtasks.exe /create /f /tn $TaskName /tr "`"$exePath`" --role=supervisor" /sc onstart /ru SYSTEM /rl HIGHEST | Out-Null
  }

  # AtStartup does not fire until the next boot, so also start the supervisor
  # now. The task settings restart it if the process exits unexpectedly.
  try {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  } catch {
    & schtasks.exe /run /tn $TaskName | Out-Null
  }

  if ($trayAvailable -and -not $SkipTaskRegistration) {
    # Tarea aparte, en la sesion del usuario: el supervisor vive en Session 0 y no puede pintar
    # bandeja. --status-only le quita la vigilancia del proceso: el dueno del agente es SYSTEM, y
    # si la bandeja levantara un agent.exe propio tendriamos dos agentes con el mismo deviceId.
    Write-Host "Registrando tarea '$TrayTaskName' al logon (icono de bandeja, solo lectura de estado) ..."
    [void](Register-TrayLogonTask -TrayExe $trayExePath -Name $TrayTaskName `
      -Arguments "--status-only" `
      -Description "Icono de bandeja del Agente de Monitoreo Remoto (informativo)")
  }

  if ($trayAvailable) {
    $activeSession = quser 2>$null | Out-String
    if ($activeSession -match "Active") {
      Start-Process -FilePath $trayExePath -ArgumentList "--status-only" -WindowStyle Hidden
      Write-Host "Bandeja iniciada en la sesion activa."
    }
  }

  Write-Host ""
  Write-Host "Instalacion completada (modo Session 0)."
  Write-Host "  Ejecutable: $exePath"
  Write-Host "  Config:     $configPath"
  Write-Host "  Tarea:      $TaskName (al inicio de Windows, SYSTEM)"
  if ($trayAvailable) {
    Write-Host "  Bandeja:    $trayExePath (tarea $TrayTaskName, al logon, solo informativa)"
  }
  Write-Host ""
  Write-Host "Desinstalacion:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSScriptRoot\uninstall-silent.ps1`""
  exit 0
}

if (-not $SkipTaskRegistration) {
  if ($trayAvailable) {
    # Modo logon: la unica tarea persistente es la bandeja, que ademas levanta y vigila al agente.
    Write-Host "Registrando tarea '$TaskName' al logon de cualquier usuario (bandeja + agente) ..."
    [void](Register-TrayLogonTask -TrayExe $trayExePath -Name $TaskName `
      -Arguments "" `
      -Description "Agente de Monitoreo Remoto (icono de bandeja + agente)")
  } else {
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
}

# Arrancar el agente en la sesion actual si hay una sesion interactiva activa
# (no en Session 0). Si no hay sesion, la tarea lo levanta en el proximo logon.
$activeSession = quser 2>$null | Out-String
if ($activeSession -match "Active") {
  if ($trayAvailable) {
    Start-Process -FilePath $trayExePath -WindowStyle Hidden
  } else {
    Start-Process -FilePath "$env:SystemRoot\System32\wscript.exe" -ArgumentList @("`"$vbsPath`"", "`"$exePath`"") -WindowStyle Hidden
  }
  Write-Host "Agente iniciado en la sesion activa."
} else {
  Write-Host "No hay sesion interactiva activa: el agente arrancara en el proximo inicio de sesion."
}

Write-Host ""
Write-Host "Instalacion completada."
Write-Host "  Ejecutable: $exePath"
Write-Host "  Config:     $configPath"
Write-Host "  Tarea:      $TaskName (al logon de cualquier usuario)"
if ($trayAvailable) {
  Write-Host "  Bandeja:    $trayExePath (solo informativa: no apaga el monitoreo)"
}
Write-Host ""
Write-Host "Desinstalacion:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSScriptRoot\uninstall-silent.ps1`""
exit 0
