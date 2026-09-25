import { execFile } from "child_process";
import fs from "fs";
import path from "path";

export type ExecFileRunner = (
  file: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>;

export interface PowerShellBridgeOptions {
  scriptPath: string;
  agentExePath: string;
  run?: ExecFileRunner;
  powershellPath?: string;
}

export function createPowerShellBridgeRunner(options: PowerShellBridgeOptions): () => Promise<void> {
  const run = options.run || defaultRunner;

  return async () => {
    const { stdout } = await run(options.powershellPath || "powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      options.scriptPath,
      "-AgentExe",
      options.agentExePath,
    ]);

    if (/error|exception/i.test(stdout)) {
      throw new Error(`Session bridge failed: ${stdout.trim()}`);
    }
  };
}

export function defaultBridgeScriptPath(): string {
  const fromEnv = process.env.RM_BRIDGE_SCRIPT;
  if (fromEnv) return fromEnv;

  const exeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(exeDir, "start-session.ps1"),
    path.join(exeDir, "installer", "start-session.ps1"),
    path.join(__dirname, "..", "installer", "start-session.ps1"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0];
}

function defaultRunner(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
