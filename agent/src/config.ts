import os from "os";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";

export interface AgentConfig {
  serverUrl: string;
  deviceId: string;
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
        activeConfigFile = file;
        return JSON.parse(data);
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
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
    activeConfigFile = file;
    console.log(`Config saved to ${file}`);
  } catch (error) {
    console.error("Failed to save config:", error);
  }
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
