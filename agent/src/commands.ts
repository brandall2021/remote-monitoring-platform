import { exec, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import { readImageDimensions } from "./imageSize";
import { getLiveCaptureWorker } from "./liveCaptureWorker";
import { resizeJpeg } from "./jpegResize";
import { liveCaptureSettings } from "./liveStream";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface ScreenshotResult {
  imageBase64: string;
  width: number;
  height: number;
  format: string;
  [key: string]: unknown;
}

export interface LiveFrameResult {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  [key: string]: unknown;
}

interface CapturedFrame {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  [key: string]: unknown;
}

export async function takeScreenshot(): Promise<ScreenshotResult> {
  const frame = await captureFrame("png");
  return {
    imageBase64: frame.data.toString("base64"),
    width: frame.width,
    height: frame.height,
    format: "png",
  };
}

export async function takeLiveFrame(): Promise<LiveFrameResult> {
  // Cada cuadro del live view viaja por websocket, asi que importan dos cosas: que sea chico y que
  // llegue rapido. La ruta buena es el worker de captura persistente (powershell.exe levantado una sola
  // vez): ~170 ms por cuadro a 1280 px. Detras quedan los planes B, todos medidos en una estacion real:
  //   - screenshot-desktop + re-encode en JS: ~720 ms, 124 KB (captura rapido pero no escala)
  //   - powershell.exe por cuadro: ~1400 ms, 55 KB (el arranque de .NET se paga cada vez)
  // requestFrame() devuelve null ante cualquier duda (worker desactivado, PowerShell muerto, cuadro
  // fuera de tiempo), y ahi se cae al plan B; el live view nunca se queda sin cuadro por el worker.
  const { maxWidth, quality, maxFrameBytes, worker } = liveCaptureSettings();

  if (worker) {
    const frame = await getLiveCaptureWorker({ maxWidth, quality, maxFrameBytes }).requestFrame();
    if (frame) return frame;
  }

  try {
    const { default: screenshot } = await import("screenshot-desktop");
    const raw = await screenshot({ format: "jpg" });

    try {
      const resized = resizeJpeg(raw, { maxWidth, quality });
      return { data: resized.data, mimeType: "image/jpeg", width: resized.width, height: resized.height };
    } catch (resizeError) {
      // Un cuadro nativo y grande sirve mas que no mandar nada; se avisa una sola vez para que el log
      // del servicio diga por que el live view esta consumiendo tantas KB.
      if (!warnedFullResolution) {
        warnedFullResolution = true;
        console.warn(`Live frame sent at full resolution (${maxWidth}px skipped): ${resizeError}`);
      }
      return { data: raw, mimeType: "image/jpeg", ...requireDimensions(raw) };
    }
  } catch (captureError) {
    try {
      return await captureWithPowerShell("jpg", "image/jpeg", { maxWidth, quality });
    } catch (fallbackError) {
      throw new Error(`Live capture failed: ${fallbackError}`);
    }
  }
}

let warnedFullResolution = false;

async function captureFrame(format: "png" | "jpg"): Promise<CapturedFrame> {
  const mimeType = format === "png" ? "image/png" : "image/jpeg";

  try {
    const { default: screenshot } = await import("screenshot-desktop");
    const imgBuffer = await screenshot({ format });
    return { data: imgBuffer, mimeType, ...requireDimensions(imgBuffer) };
  } catch (error) {
    try {
      // La captura guardada es archivo: se conserva a resolucion nativa, sin escalado.
      return await captureWithPowerShell(format, mimeType, { maxWidth: 0, quality: 95 });
    } catch (fallbackError) {
      throw new Error(`Screenshot failed: ${fallbackError}`);
    }
  }
}

function requireDimensions(buffer: Buffer): { width: number; height: number } {
  const dimensions = readImageDimensions(buffer);
  if (!dimensions) {
    throw new Error("Could not read image dimensions from the captured frame");
  }
  return dimensions;
}

async function captureWithPowerShell(
  format: "png" | "jpg",
  mimeType: string,
  options: { maxWidth: number; quality: number }
): Promise<CapturedFrame> {
  // maxWidth = 0 significa "no escalar"; la calidad solo aplica al JPEG.
  const maxWidth = Math.max(0, Math.round(options.maxWidth) || 0);
  const quality = Math.min(Math.max(Math.round(options.quality) || 70, 1), 100);
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "remote-monitor-"));
  const scriptPath = path.join(tempDirectory, "capture.ps1");
  const tempPath = path.join(tempDirectory, `capture.${format}`);

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screens = [System.Windows.Forms.Screen]::AllScreens
$left = ($screens | ForEach-Object { $_.Bounds.Left } | Measure-Object -Minimum).Minimum
$top = ($screens | ForEach-Object { $_.Bounds.Top } | Measure-Object -Minimum).Minimum
$right = ($screens | ForEach-Object { $_.Bounds.Right } | Measure-Object -Maximum).Maximum
$bottom = ($screens | ForEach-Object { $_.Bounds.Bottom } | Measure-Object -Maximum).Maximum
$width = $right - $left
$height = $bottom - $top
$bounds = New-Object System.Drawing.Rectangle($left, $top, $width, $height)
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$format = '${format}'
$encoder = $null
$params = $null
if ($format -eq 'jpg') {
  $encoders = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()
  $encoder = $encoders | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, ${quality}L)
}
$maxWidth = ${maxWidth}
if ($maxWidth -gt 0 -and $bounds.Width -gt $maxWidth) {
  $scale = $maxWidth / $bounds.Width
  $newW = [int]($bounds.Width * $scale)
  $newH = [int]($bounds.Height * $scale)
  $resized = New-Object System.Drawing.Bitmap($newW, $newH)
  $rg = [System.Drawing.Graphics]::FromImage($resized)
  $rg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $rg.DrawImage($bmp, 0, 0, $newW, $newH)
  if ($format -eq 'jpg') { $resized.Save('${tempPath.replace(/'/g, "''")}', $encoder, $params) } else { $resized.Save('${tempPath.replace(/'/g, "''")}') }
  $resized.Dispose()
  $rg.Dispose()
  // Las llaves de delimitacion son obligatorias: sin ellas PowerShell lee newW: como una variable con
  // unidad de disco (estilo env:PATH) y el script ni siquiera parsea ["La referencia de variable no es
  // valida"], con lo que la captura entera fallaba.
  Write-Output "SIZE:\${newW}:\${newH}"
} else {
  if ($format -eq 'jpg') { $bmp.Save('${tempPath.replace(/'/g, "''")}', $encoder, $params) } else { $bmp.Save('${tempPath.replace(/'/g, "''")}') }
  Write-Output "SIZE:$($bounds.Width):$($bounds.Height)"
}
$bmp.Dispose()
$g.Dispose()
  `;

  try {
    fs.writeFileSync(scriptPath, script, "utf8");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath]);
    const buffer = fs.readFileSync(tempPath);
    const match = stdout.match(/SIZE:(\d+):(\d+)/);
    return {
      data: buffer,
      mimeType,
      width: match ? parseInt(match[1], 10) : 0,
      height: match ? parseInt(match[2], 10) : 0,
    };
  } catch (fallbackError) {
    throw new Error(`Capture failed: ${fallbackError}`);
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
    try { fs.unlinkSync(tempPath); } catch {}
    try { fs.rmSync(tempDirectory, { recursive: true, force: true }); } catch {}
  }
}

export async function getSystemInfo(): Promise<Record<string, unknown>> {
  const os = require("os");
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpus: os.cpus().length,
    uptime: os.uptime(),
    username: os.userInfo().username,
  };
}

export async function getProcessList(): Promise<Record<string, unknown>[]> {
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-Process | Select-Object Id, ProcessName, CPU, WorkingSet64 | ConvertTo-Json -Compress",
    ]);
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return [];
  }
}

export async function lockScreen(): Promise<void> {
  await execAsync(
    "rundll32.exe user32.dll,LockWorkStation"
  );
}

export async function shutdown(): Promise<void> {
  await execAsync("shutdown /s /t 0");
}

export async function restart(): Promise<void> {
  await execAsync("shutdown /r /t 0");
}

export async function logout(): Promise<void> {
  await execAsync("shutdown /l");
}
