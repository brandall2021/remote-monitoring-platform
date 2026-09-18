import os from "os";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";

export interface AgentConfig {
  serverUrl: string;
  deviceId?: string;
  registrationToken: string;
  agentVersion: string;
  heartbeatInterval: number;
}

const USER_CONFIG_FILE = path.join(
  process.env.APPDATA || process.env.HOME || ".",
  "remote-monitor-agent.json"
);

const MACHINE_CONFIG_FILE = path.join(
  process.env.ProgramData || "C:\\ProgramData",
  "RemoteMonitoringAgent",
  "agent.json"
);

let activeConfigFile: string | null = null;

export function loadConfig(): AgentConfig | null {
  const candidates = [MACHINE_CONFIG_FILE, USER_CONFIG_FILE];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const data = fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, "");
        const parsed = JSON.parse(data) as Partial<AgentConfig>;
        if (
          typeof parsed.serverUrl !== "string" ||
          typeof parsed.registrationToken !== "string" ||
          !parsed.serverUrl.trim() ||
          !parsed.registrationToken.trim()
        ) {
          throw new Error("Invalid agent configuration: serverUrl and registrationToken are required");
        }

        activeConfigFile = file;
        return {
          serverUrl: parsed.serverUrl.trim(),
          deviceId: typeof parsed.deviceId === "string" ? parsed.deviceId : undefined,
          registrationToken: parsed.registrationToken,
          agentVersion: typeof parsed.agentVersion === "string" ? parsed.agentVersion : "1.0.0",
          heartbeatInterval: normalizeHeartbeat(parsed.heartbeatInterval),
        };
      }
    } catch (error) {
      console.error(`Failed to load config (${file}):`, error);
    }
  }
  return null;
}

export function saveConfig(config: AgentConfig): void {
  const file = activeConfigFile || MACHINE_CONFIG_FILE;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tempFile = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempFile, file);
    activeConfigFile = file;
    console.log(`Config saved to ${file}`);
  } catch (error) {
    console.error("Failed to save config:", error);
    // A non-admin interactive user may not be able to write ProgramData.
    // Keep the device usable by falling back to that user's AppData.
    if (file !== USER_CONFIG_FILE) {
      try {
        fs.mkdirSync(path.dirname(USER_CONFIG_FILE), { recursive: true });
        fs.writeFileSync(USER_CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        activeConfigFile = USER_CONFIG_FILE;
        console.log(`Config saved to ${USER_CONFIG_FILE}`);
      } catch (fallbackError) {
        console.error("Failed to save fallback config:", fallbackError);
      }
    }
  }
}

function normalizeHeartbeat(value: unknown): number {
  const heartbeat = typeof value === "number" && Number.isFinite(value) ? value : 30000;
  return Math.min(Math.max(Math.round(heartbeat), 5000), 300000);
}

export function getSystemInfo() {
  return {
    hostname: os.hostname(),
    operatingSystem: os.platform(),
    osVersion: os.release(),
    platform: os.arch(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpus: os.cpus().length,
    uptime: os.uptime(),
    username: os.userInfo().username,
    networkInterfaces: Object.entries(os.networkInterfaces())
      .flatMap(([name, interfaces]) =>
        (interfaces || [])
          .filter((i) => !i.internal && i.family === "IPv4")
          .map((i) => ({ name, address: i.address, mac: i.mac }))
      ),
  };
}

export function generateDeviceId(): string {
  return uuidv4();
}
