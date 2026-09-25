import { exec, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import { readImageDimensions } from "./imageSize";

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
  return captureFrame("jpg");
}

async function captureFrame(format: "png" | "jpg"): Promise<CapturedFrame> {
  const mimeType = format === "png" ? "image/png" : "image/jpeg";

  try {
    const { default: screenshot } = await import("screenshot-desktop");
    const imgBuffer = await screenshot({ format });
    return { data: imgBuffer, mimeType, ...requireDimensions(imgBuffer) };
  } catch (error) {
    try {
      return await captureWithPowerShell(format, mimeType);
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

async function captureWithPowerShell(format: "png" | "jpg", mimeType: string): Promise<CapturedFrame> {
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
  $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 70L)
}
$maxWidth = 1280
if ($bounds.Width -gt $maxWidth) {
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
  Write-Output "SIZE:$newW:$newH"
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
