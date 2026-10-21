import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { SESSION_SECRET_ENV } from "./sessionSecret";

export type ExecFileRunner = (
  file: string,
  args: string[],
  env: Record<string, string | undefined>
) => Promise<{ stdout: string; stderr: string }>;

export interface PowerShellBridgeOptions {
  scriptPath: string;
  agentExePath: string;
  run?: ExecFileRunner;
  powershellPath?: string;
  // El secreto efimero de la pipe viaja solo por entorno: nunca por linea de comandos, porque el
  // command line de un proceso lo puede leer cualquier usuario de la sesion con el explorador/WMI.
  sessionSecret?: string;
}

export function createPowerShellBridgeRunner(options: PowerShellBridgeOptions): () => Promise<void> {
  const run = options.run || defaultRunner;

  return async () => {
    const { stdout } = await run(
      options.powershellPath || "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        options.scriptPath,
        "-AgentExe",
        options.agentExePath,
      ],
      { ...(options.sessionSecret ? { [SESSION_SECRET_ENV]: options.sessionSecret } : {}) }
    );

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

function defaultRunner(
  file: string,
  args: string[],
  extraEnv: Record<string, string | undefined>
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 30000, env: { ...process.env, ...extraEnv } },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}
