param(
  [string]$InnoSetupCompiler = ""
)

$ErrorActionPreference = "Stop"

$agentDir = Split-Path $PSScriptRoot -Parent
$nodeModulesBin = Join-Path $agentDir "node_modules\.bin"

if (-not (Test-Path -LiteralPath (Join-Path $agentDir "agent-live.exe"))) {
  throw "Falta agent-live.exe. Ejecute 'npm run build' y 'npm run package' dentro de agent."
}

# La bandeja se compila aqui y no antes: el .iss la toma como payload obligatorio, asi que un
# setup sin RmTray.exe no compila. El script es idempotente y salta si el exe es mas nuevo.
& (Join-Path $PSScriptRoot "build-tray.ps1")
if ($LASTEXITCODE -ne 0) { throw "build-tray.ps1 termino con codigo $LASTEXITCODE." }

if (-not (Test-Path -LiteralPath (Join-Path $agentDir "tray\RmTray.exe"))) {
  throw "Falta tray\RmTray.exe despues de compilar la bandeja."
}

if (-not $InnoSetupCompiler) {
  # Ojo con ${env:ProgramFiles(x86)}: sin las llaves PowerShell interpreta "ProgramFiles" y deja
  # "(x86)" colgando, y la ruta armada asi nunca existe. Escribimos las dos formas.
  $x86Root = ""
  if (Test-Path -LiteralPath "env:ProgramFiles(x86)") { $x86Root = ${env:ProgramFiles(x86)} }
  if (-not $x86Root -and $env:ProgramW6432) { $x86Root = Join-Path (Split-Path $env:ProgramW6432 -Parent) "Program Files (x86)" }

  $candidates = @(
    $(if ($x86Root) { Join-Path $x86Root "Inno Setup 6\ISCC.exe" }),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe" }),
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
  )
  $InnoSetupCompiler = $candidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
    Select-Object -First 1
}

if (-not $InnoSetupCompiler -or -not (Test-Path -LiteralPath $InnoSetupCompiler)) {
  throw "No se encontro Inno Setup 6. Instale Inno Setup o use -InnoSetupCompiler <ruta-a-ISCC.exe>."
}

& $InnoSetupCompiler (Join-Path $PSScriptRoot "RemoteMonitoringAgent.iss")
if ($LASTEXITCODE -ne 0) {
  throw "Inno Setup termino con codigo $LASTEXITCODE."
}

Write-Host "Instalador generado: $(Join-Path (Split-Path $agentDir -Parent) 'RemoteMonitoringAgentSetup.exe')"
