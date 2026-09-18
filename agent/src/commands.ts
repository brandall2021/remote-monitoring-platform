import { exec, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

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
  imageBase64: string;
  mimeType: string;
  width: number;
  height: number;
  [key: string]: unknown;
}

export async function takeScreenshot(): Promise<ScreenshotResult> {
  try {
    const { default: screenshot } = await import("screenshot-desktop");
    const imgBuffer = await screenshot({ format: "png" });
    return {
      imageBase64: imgBuffer.toString("base64"),
      width: 0,
      height: 0,
      format: "png",
    };
  } catch (error) {
    try {
      return captureWithPowerShell("png");
    } catch (fallbackError) {
      throw new Error(`Screenshot failed: ${fallbackError}`);
    }
  }
}

export async function takeLiveFrame(): Promise<LiveFrameResult> {
  try {
    const { default: screenshot } = await import("screenshot-desktop");
    const imgBuffer = await screenshot({ format: "jpg" });
    return {
      imageBase64: imgBuffer.toString("base64"),
      mimeType: "image/jpeg",
      width: 0,
      height: 0,
    };
  } catch {
    return captureWithPowerShell();
  }
}

function captureWithPowerShell(format: "png"): Promise<ScreenshotResult>;
function captureWithPowerShell(format?: "jpg"): Promise<LiveFrameResult>;
async function captureWithPowerShell(format: "jpg" | "png" = "jpg"): Promise<LiveFrameResult | ScreenshotResult> {
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
    const result = {
      imageBase64: buffer.toString("base64"),
      width: match ? parseInt(match[1], 10) : 0,
      height: match ? parseInt(match[2], 10) : 0,
    };
    return format === "png" ? { ...result, format: "png" } : { ...result, mimeType: "image/jpeg" };
  } catch (fallbackError) {
    throw new Error(`Live frame failed: ${fallbackError}`);
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
