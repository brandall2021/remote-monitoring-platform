import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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
      const tempPath = `${process.env.TEMP || "/tmp"}/screenshot_${Date.now()}.png`;
      await execAsync(
        `powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bmp); $graphics.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bmp.Save('${tempPath}') }"`
      );
      const fs = require("fs");
      const buffer = fs.readFileSync(tempPath);
      fs.unlinkSync(tempPath);
      return {
        imageBase64: buffer.toString("base64"),
        width: 0,
        height: 0,
        format: "png",
      };
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

async function captureWithPowerShell(): Promise<LiveFrameResult> {
  const fs = require("fs");
  const scriptPath = `${process.env.TEMP || "/tmp"}/live_capture_${Date.now()}.ps1`;
  const tempPath = `${process.env.TEMP || "/tmp"}/live_${Date.now()}.jpg`;

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$encoders = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()
$encoder = $encoders | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 70L)
$maxWidth = 1280
if ($bounds.Width -gt $maxWidth) {
  $scale = $maxWidth / $bounds.Width
  $newW = [int]($bounds.Width * $scale)
  $newH = [int]($bounds.Height * $scale)
  $resized = New-Object System.Drawing.Bitmap($newW, $newH)
  $rg = [System.Drawing.Graphics]::FromImage($resized)
  $rg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $rg.DrawImage($bmp, 0, 0, $newW, $newH)
  $resized.Save('${tempPath.replace(/'/g, "''")}', $encoder, $params)
  $resized.Dispose()
  $rg.Dispose()
  Write-Output "SIZE:$newW:$newH"
} else {
  $bmp.Save('${tempPath.replace(/'/g, "''")}', $encoder, $params)
  Write-Output "SIZE:$($bounds.Width):$($bounds.Height)"
}
$bmp.Dispose()
$g.Dispose()
  `;

  try {
    fs.writeFileSync(scriptPath, script, "utf8");
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`
    );
    const buffer = fs.readFileSync(tempPath);
    const match = stdout.match(/SIZE:(\d+):(\d+)/);
    return {
      imageBase64: buffer.toString("base64"),
      mimeType: "image/jpeg",
      width: match ? parseInt(match[1], 10) : 0,
      height: match ? parseInt(match[2], 10) : 0,
    };
  } catch (fallbackError) {
    throw new Error(`Live frame failed: ${fallbackError}`);
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
    try { fs.unlinkSync(tempPath); } catch {}
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
    const { stdout } = await execAsync(
      'powershell -command "Get-Process | Select-Object Id, ProcessName, CPU, WorkingSet64 | ConvertTo-Json"'
    );
    return JSON.parse(stdout);
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
