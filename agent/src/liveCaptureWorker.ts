// Worker de captura persistente para la vista en vivo.
//
// Por que existe. El live view necesita cuadros chicos Y frecuentes, y medir las tres rutas posibles
// en una estacion real (dos monitores, pantalla virtual de 3360x1080) da esta tabla:
//
//   screenshot-desktop + re-encode JPEG en JS ......... ~720 ms por cuadro / 124 KB
//   powershell.exe levantado por cada cuadro .......... ~1400 ms por cuadro /  55 KB
//   este worker (powershell.exe una sola vez) ......... ~170 ms por cuadro /  52 KB
//
// La diferencia no es GDI+ contra JavaScript: es pagar el arranque de powershell.exe, del runtime de
// .NET y la carga de System.Drawing/System.Windows.Forms una vez en vez de una vez por cuadro. Aca ese
// costo solo se paga cuando arranca la corriente; despues cada cuadro es capturar, escalar y codificar.
//
// Como habla con PowerShell. stdin recibe lineas de texto ("g" = un cuadro, "s <ancho> <calidad>" =
// cambiar ajustes, "q" = salir) y stdout devuelve cuadros binarios prefijados con su longitud en
// int32 little-endian. stdout se usa SOLO para eso: cualquier texto que PowerShell escriba por error
// rompe el framing, y el worker lo detecta y se apaga en vez de difundir basura. Los mensajes del
// script van a stderr y se reenvian al log del agente como texto.
//
// Seguridad: el script no lleva interpolacion de Node, asi que ni la configuracion ni un payload del
// server pueden inyectar codigo. Los unicos valores que llegan son dos enteros ya validados por
// clampLiveInterval/clampInt, y se mandan por stdin como argumentos, no como codigo.

import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { readImageDimensions } from "./imageSize";

// Cuadro separador entre la longitud (int32 LE) y el JPEG.
export const LIVE_WORKER_HEADER_BYTES = 4;

// Un JPEG de pantalla nunca va a pesar menos que esto; debajo de la barra es framing roto.
export const LIVE_WORKER_MIN_FRAME_BYTES = 256;

// Silencio tolerado por cuadro: tiene que quedar por debajo del timeout de 10 s del supervisor, asi
// un PowerShell colgado degrada a la ruta lenta en vez de hacer fallar el pedido de la pipe.
export const LIVE_WORKER_FRAME_TIMEOUT_MS = 8000;

// Cuanto sigue vivo el powershell entre pedidos. Los agentes viejos (modo poll) pueden pedir un cuadro
// cada 60 s, y un respawn por cuadro seria justo lo que este worker evita; por eso el idle es mas largo
// que LIVE_MAX_INTERVAL_MS. Cuando el server manda live-stop, stopLiveCaptureWorker() lo cierra ya.
export const LIVE_WORKER_IDLE_MS = 70000;

// Breaker: si PowerShell muere varias veces seguidas en poco tiempo (driver de video, sesion sin
// escritorio, pantalla protegida), se deja de reintentar y la vista vuelve a la ruta anterior.
export const LIVE_WORKER_MAX_SPAWNS = 5;
export const LIVE_WORKER_SPAWN_WINDOW_MS = 300000;

export interface LiveWorkerSettings {
  maxWidth: number;
  quality: number;
  maxFrameBytes: number;
}

// Type alias, no interface: LiveFrameResult (el tipo que manda el agente por websocket) tiene firma
// de indice, y TypeScript solo la infiere implicitamente de los object literal types.
export type LiveWorkerFrame = {
  data: Buffer;
  width: number;
  height: number;
  mimeType: "image/jpeg";
};

export interface SpawnResult {
  frames: Buffer[];
  error?: string;
}

// Parser incremental del canal binario. Acumula chunks hasta tener un cuadro completo y corta en cuanto
// la cabecera no da para arriba (longitud negativa o gigante), que es como se nota el stdout contaminado.
export class LiveFrameParser {
  private buffer = Buffer.alloc(0);

  constructor(private readonly maxFrameBytes: number) {}

  push(chunk: Buffer): SpawnResult {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);

    const frames: Buffer[] = [];

    for (;;) {
      if (this.buffer.length < LIVE_WORKER_HEADER_BYTES) return { frames };

      const length = this.buffer.readInt32LE(0);
      if (length < LIVE_WORKER_MIN_FRAME_BYTES || length > this.maxFrameBytes) {
        return { frames, error: `longitud de cuadro fuera de rango: ${length}` };
      }
      if (this.buffer.length < LIVE_WORKER_HEADER_BYTES + length) return { frames };

      frames.push(this.buffer.subarray(LIVE_WORKER_HEADER_BYTES, LIVE_WORKER_HEADER_BYTES + length));
      this.buffer = this.buffer.subarray(LIVE_WORKER_HEADER_BYTES + length);
    }
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

// El script PowerShell. Plantilla literal sin interpolacion: en JavaScript `${` abriria una expresion,
// asi que aca no aparece ninguna; todo lo que el script necesita le llega por stdin.
const CAPTURE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$out = [Console]::OpenStandardOutput()
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())

$maxWidth = 1280
$quality = 70
$interpolation = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

function Get-VirtualScreen {
  $screens = [System.Windows.Forms.Screen]::AllScreens
  # Measure-Object devuelve Double, y New-Object Bitmap(Double, Double) falla con "El parametro no es
  # valido"; por eso el cast a int en cada extremo.
  $left = [int](($screens | ForEach-Object { $_.Bounds.Left } | Measure-Object -Minimum).Minimum)
  $top = [int](($screens | ForEach-Object { $_.Bounds.Top } | Measure-Object -Minimum).Minimum)
  $right = [int](($screens | ForEach-Object { $_.Bounds.Right } | Measure-Object -Maximum).Maximum)
  $bottom = [int](($screens | ForEach-Object { $_.Bounds.Bottom } | Measure-Object -Maximum).Maximum)
  $rect = New-Object System.Drawing.Rectangle($left, $top, ($right - $left), ($bottom - $top))
  return $rect
}

$encoders = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()
$jpegEncoder = $encoders | Where-Object { $_.MimeType -eq 'image/jpeg' }
if ($null -eq $jpegEncoder) {
  [Console]::Error.WriteLine('jpeg encoder not found')
  exit 3
}

$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$zero = New-Object System.Drawing.Point(0, 0)

while ($true) {
  $line = $reader.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq 'q') { break }

  if ($line.StartsWith('s ')) {
    $parts = $line.Split(' ')
    if ($parts.Count -ge 3) {
      $maxWidth = [int]$parts[1]
      $quality = [int]$parts[2]
    }
    continue
  }

  if ($line -ne 'g') { continue }

  $bounds = Get-VirtualScreen
  if ($bounds.Width -lt 16 -or $bounds.Height -lt 16) {
    [Console]::Error.WriteLine('virtual screen too small')
    continue
  }

  $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($bounds.Location, $zero, $bmp.Size)

  $target = $bmp
  $targetWidth = $bounds.Width
  $targetHeight = $bounds.Height

  if ($maxWidth -gt 0 -and $bounds.Width -gt $maxWidth) {
    $scale = $maxWidth / $bounds.Width
    $targetWidth = [int]($bounds.Width * $scale)
    $targetHeight = [int]($bounds.Height * $scale)
    $resized = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight)
    $rg = [System.Drawing.Graphics]::FromImage($resized)
    $rg.InterpolationMode = $interpolation
    $rg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $rg.DrawImage($bmp, 0, 0, $targetWidth, $targetHeight)
    $rg.Dispose()
    $target = $resized
  }

  $ms = New-Object System.IO.MemoryStream
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
  $target.Save($ms, $jpegEncoder, $params)
  $bytes = $ms.ToArray()
  $ms.Dispose()

  if (-not [Object]::ReferenceEquals($target, $bmp)) { $target.Dispose() }
  $g.Dispose()
  $bmp.Dispose()

  $header = [BitConverter]::GetBytes([int]$bytes.Length)
  $out.Write($header, 0, 4)
  $out.Write($bytes, 0, $bytes.Length)
  $out.Flush()
}
`;

export interface LiveCaptureWorkerDeps {
  settings: LiveWorkerSettings;
  spawnProcess?: (scriptPath: string) => ChildProcessWithoutNullStreams;
  log?: (message: string) => void;
  frameTimeoutMs?: number;
  idleMs?: number;
  maxSpawns?: number;
  spawnWindowMs?: number;
}

interface PendingRequest {
  resolve: (frame: LiveWorkerFrame | null) => void;
  timer: NodeJS.Timeout;
}

// Ningun metodo de esta clase lanza: todo fallo devuelve null para que el llamador degrade a la ruta
// anterior. Un worker roto no puede tumbar el live view, solo hacerlo otra vez mas lento.
export class LiveCaptureWorker {
  private readonly settings: LiveWorkerSettings;
  private readonly spawnProcess: (scriptPath: string) => ChildProcessWithoutNullStreams;
  private readonly log: (message: string) => void;
  private readonly frameTimeoutMs: number;
  private readonly idleMs: number;
  private readonly maxSpawns: number;
  private readonly spawnWindowMs: number;
  private readonly parser: LiveFrameParser;

  private child: ChildProcessWithoutNullStreams | null = null;
  private scriptPath: string | null = null;
  private tempDirectory: string | null = null;
  private pending: PendingRequest | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private spawnTimes: number[] = [];
  private disabled = false;
  private stopped = false;

  constructor(deps: LiveCaptureWorkerDeps) {
    this.settings = deps.settings;
    this.spawnProcess = deps.spawnProcess || defaultSpawn;
    this.log = deps.log || ((message) => console.log(`[LIVE-WORKER] ${message}`));
    this.frameTimeoutMs = deps.frameTimeoutMs || LIVE_WORKER_FRAME_TIMEOUT_MS;
    this.idleMs = deps.idleMs || LIVE_WORKER_IDLE_MS;
    this.maxSpawns = deps.maxSpawns || LIVE_WORKER_MAX_SPAWNS;
    this.spawnWindowMs = deps.spawnWindowMs || LIVE_WORKER_SPAWN_WINDOW_MS;
    this.parser = new LiveFrameParser(deps.settings.maxFrameBytes);
  }

  isDisabled(): boolean {
    return this.disabled;
  }

  isRunning(): boolean {
    return this.child !== null;
  }

  // Devuelve el cuadro o null ("usar la otra ruta"). Nunca espera mas que frameTimeoutMs.
  requestFrame(): Promise<LiveWorkerFrame | null> {
    if (this.disabled || this.stopped) return Promise.resolve(null);

    // El loop de streaming es secuencial, asi que solaparse significa que algo raro pasa (por ejemplo
    // un live-command de un server viejo mientras corre la corriente). Mejor no enredar el canal.
    if (this.pending) return Promise.resolve(null);

    this.clearIdleTimer();

    const child = this.child || this.start();
    if (!child) return Promise.resolve(null);

    return new Promise<LiveWorkerFrame | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending && this.pending.timer === timer) {
          this.pending = null;
          this.fail("el cuadro salio por tiempo");
          resolve(null);
        }
      }, this.frameTimeoutMs);

      this.pending = { resolve, timer };

      try {
        child.stdin.write("g\n");
      } catch {
        if (this.pending && this.pending.timer === timer) {
          this.pending = null;
          this.fail("stdin cerrado");
          resolve(null);
        }
      }
    });
  }

  stop(): void {
    this.teardown("pedido por el agente");
  }

  dispose(): void {
    this.stopped = true;
    this.teardown("fin de la sesion");
  }

  // Levanta PowerShell y devuelve el hijo listo, o null si no se pudo (y entonces el llamador usa la
  // ruta lenta). El script se escribe una vez y se reutiliza entre reinicios del worker.
  private start(): ChildProcessWithoutNullStreams | null {
    this.parser.reset();

    let scriptPath = this.scriptPath;
    if (!scriptPath) {
      try {
        this.tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "remote-monitor-live-"));
        scriptPath = path.join(this.tempDirectory, "liveCapture.ps1");
        fs.writeFileSync(scriptPath, CAPTURE_SCRIPT, "utf8");
        this.scriptPath = scriptPath;
      } catch (error: any) {
        this.disable(`no se pudo escribir el script de captura: ${error?.message || error}`);
        return null;
      }
    }

    if (!this.noteSpawn()) return null;

    try {
      const child = this.spawnProcess(scriptPath);
      this.child = child;

      child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8").trim();
        if (text) this.log(text.slice(0, 500));
      });
      child.on("error", (error: Error) => this.fail(`powershell.exe: ${error.message}`));
      child.on("exit", (code) => {
        if (this.child !== child) return;
        this.child = null;
        this.fail(`salio (exit ${code})`);
      });

      child.stdin.write(`s ${this.settings.maxWidth} ${this.settings.quality}\n`);
      return child;
    } catch (error: any) {
      this.child = null;
      this.disable(`no se pudo levantar powershell.exe: ${error?.message || error}`);
      return null;
    }
  }

  // PowerShell puede morir y hay que re-levantarlo (un monitor desconectado deja CopyFromScreen fuera
  // de rango), pero no en un loop infinito: maxSpawns dentro de spawnWindowMs y ahi se rinde.
  private noteSpawn(): boolean {
    const now = Date.now();
    this.spawnTimes = this.spawnTimes.filter((t) => now - t < this.spawnWindowMs);
    this.spawnTimes.push(now);

    if (this.spawnTimes.length > this.maxSpawns) {
      this.disable(`${this.spawnTimes.length} arranques en ${Math.round(this.spawnWindowMs / 1000)} s, se deja de reintentar`);
      return false;
    }
    return true;
  }

  private onStdout(chunk: Buffer): void {
    const { frames, error } = this.parser.push(chunk);

    if (error) {
      this.fail(`canal de cuadros roto: ${error}`);
      return;
    }

    // Solo interesa el ultimo cuadro: si llegaran dos porque el server insistio con live-command, el
    // primero ya no sirve para mostrar.
    const frame = frames[frames.length - 1];
    if (!frame || !this.pending) return;

    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);

    const dimensions = readImageDimensions(frame);
    pending.resolve({
      data: frame,
      mimeType: "image/jpeg",
      width: dimensions?.width || 0,
      height: dimensions?.height || 0,
    });

    this.scheduleIdleStop();
  }

  // Cierra el worker por un fallo recuperable: el pedido en curso cae a la ruta lenta y el proximo
  // cuadro intenta re-levantar PowerShell.
  private fail(reason: string): void {
    const pending = this.pending;
    this.pending = null;

    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }

    const child = this.child;
    this.child = null;
    this.log(`worker inestable: ${reason}`);

    if (child) {
      try {
        child.kill();
      } catch {
        /* ya murio */
      }
    }

    this.removeScript();
    this.scheduleIdleStop();
  }

  private teardown(reason: string): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }

    this.clearIdleTimer();

    const child = this.child;
    this.child = null;

    if (child) {
      try {
        child.stdin.write("q\n");
      } catch {
        /* stdin ya cerrado */
      }
      try {
        child.kill();
      } catch {
        /* ya murio */
      }
    }

    this.removeScript();

    if (this.spawnTimes.length > 0) this.log(`cerrado (${reason})`);
    this.spawnTimes = [];
  }

  // El idle timer es la red de seguridad: cubre el modo poll (un cuadro cada varios segundos) y los
  // caminos que no pasan por dispose(). No tiene que mantener vivo el proceso del agente, por eso unref.
  private scheduleIdleStop(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.child) this.teardown("inactivo");
    }, this.idleMs);

    if (typeof this.idleTimer.unref === "function") this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private removeScript(): void {
    const directory = this.tempDirectory;
    this.scriptPath = null;
    this.tempDirectory = null;

    if (!directory) return;
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      /* la temp dir la limpia Windows */
    }
  }

  private disable(reason: string): void {
    this.disabled = true;
    this.log(`desactivado: ${reason}`);

    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }

    const child = this.child;
    this.child = null;
    if (child) {
      try {
        child.kill();
      } catch {
        /* ya murio */
      }
    }
    this.removeScript();
  }
}

function defaultSpawn(scriptPath: string): ChildProcessWithoutNullStreams {
  return spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath],
    // windowsHide: el agente corre como servicio; sin esto apareceria una consola negra en el
    // escritorio del usuario monitoreado cada vez que alguien abre la vista en vivo.
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
  ) as ChildProcessWithoutNullStreams;
}

let singleton: LiveCaptureWorker | null = null;
let singletonKey = "";

export function getLiveCaptureWorker(settings: LiveWorkerSettings): LiveCaptureWorker {
  const key = `${settings.maxWidth}:${settings.quality}:${settings.maxFrameBytes}`;

  // Si cambio la calidad por env (reinicio del servicio) se descarta el worker viejo; si no, el mismo.
  if (singleton && singletonKey !== key) {
    singleton.dispose();
    singleton = null;
  }

  if (!singleton) {
    singleton = new LiveCaptureWorker({ settings });
    singletonKey = key;

    // Windows no mata al hijo cuando el padre muere por process.exit(): sin esto quedaria un
    // powershell.exe capturando la pantalla del usuario para siempre, sin nadie que la vea.
    process.once("exit", () => singleton?.dispose());
  }

  return singleton;
}

export function stopLiveCaptureWorker(): void {
  if (!singleton) return;
  singleton.dispose();
  singleton = null;
  singletonKey = "";
}
