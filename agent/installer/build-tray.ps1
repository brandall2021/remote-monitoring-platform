param(
  [string]$Csc = "",
  [switch]$SkipIfNewer
)

$ErrorActionPreference = "Stop"

# RmTray.exe se compila con el csc que trae .NET Framework 4.x (viene con Windows, no hay que
# instalar SDK ni NuGet). El fuente es C# 5 compatible y ASCII puro.

$agentDir = Split-Path $PSScriptRoot -Parent
$trayDir = Join-Path $agentDir "tray"
$source = Join-Path $trayDir "RmTray.cs"
$output = Join-Path $trayDir "RmTray.exe"

if (-not (Test-Path -LiteralPath $source)) { throw "No existe $source" }

if ($SkipIfNewer -and (Test-Path -LiteralPath $output)) {
  if ((Get-Item $output).LastWriteTime -gt (Get-Item $source).LastWriteTime) {
    Write-Host "RmTray.exe vigente, se omite la compilacion."
    exit 0
  }
}

if (-not $Csc) {
  $framework = [Environment]::GetEnvironmentVariable("WINDIR")
  if (-not $framework) { $framework = "C:\Windows" }

  $candidates = @(
    (Join-Path $framework "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $framework "Microsoft.NET\Framework\v4.0.30319\csc.exe")
  )
  $Csc = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if (-not $Csc) {
  throw "No se encontro csc.exe de .NET Framework 4.x en $framework\Microsoft.NET*. Instale .NET Framework 4.8 (Developer Pack)."
}

# /target:winexe: sin consola. Una ventana negra al lado del icono de bandeja es exactamente el
# detalle que hace que el empleado crea que "el programa esta roto".
& $Csc -nologo -target:winexe -optimize+ ("-out:" + $output) $source
if ($LASTEXITCODE -ne 0) { throw "csc termino con codigo $LASTEXITCODE." }

Write-Host "Bandeja compilada: $output ($([math]::Round((Get-Item $output).Length / 1KB, 1)) KB)"
