param(
  [string]$InnoSetupCompiler = ""
)

$ErrorActionPreference = "Stop"

$agentDir = Split-Path $PSScriptRoot -Parent
$nodeModulesBin = Join-Path $agentDir "node_modules\.bin"

if (-not (Test-Path -LiteralPath (Join-Path $agentDir "agent-live.exe"))) {
  throw "Falta agent-live.exe. Ejecute 'npm run build' y 'npm run package' dentro de agent."
}

if (-not $InnoSetupCompiler) {
  $candidates = @(
    "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
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
