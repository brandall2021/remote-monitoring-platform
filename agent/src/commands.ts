import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface ScreenshotResult {
  imageBase64: string;
  width: number;
  height: number;
  format: string;
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
