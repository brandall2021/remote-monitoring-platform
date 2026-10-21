import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  AgentStatus,
  STATUS_STALE_MS,
  isStale,
  makeStatus,
  readAgentStatus,
  statusFilePaths,
  writeAgentStatus,
  newestStatus,
} from "./agentStatus";

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rmstatus-"));
  env = { ProgramData: dir, LOCALAPPDATA: dir };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const base: AgentStatus = {
  state: "connected",
  serverUrl: "https://monitor.example.com",
  deviceId: "dev-1",
  hostname: "PC-01",
  role: "standalone",
  pid: 4242,
  updatedAt: new Date().toISOString(),
  lastHeartbeatAt: new Date().toISOString(),
};

describe("statusFilePaths", () => {
  it("usa ProgramData para el modo SYSTEM y LOCALAPPDATA para el modo logon", () => {
    const { machine, user } = statusFilePaths(env);
    expect(machine).toBe(path.join(dir, "RemoteMonitoringAgent", "status.json"));
    expect(user).toBe(path.join(dir, "RemoteMonitoringAgent", "status.json"));
  });

  it("separa ambos destinos cuando la sesion y la maquina tienen carpetas distintas", () => {
    const { machine, user } = statusFilePaths({ ProgramData: "C:\\ProgramData", LOCALAPPDATA: "C:\\Users\\ana\\AppData\\Local" });
    expect(machine).toContain(path.join("ProgramData", "RemoteMonitoringAgent"));
    expect(user).toContain(path.join("ana", "AppData", "Local", "RemoteMonitoringAgent"));
    expect(machine).not.toBe(user);
  });

  it("no revienta sin ninguna variable de entorno (usa tmpdir)", () => {
    const { machine, user } = statusFilePaths({});
    expect(machine.endsWith(path.join("RemoteMonitoringAgent", "status.json"))).toBe(true);
    expect(user.endsWith(path.join("RemoteMonitoringAgent", "status.json"))).toBe(true);
  });
});

describe("writeAgentStatus / readAgentStatus", () => {
  it("escribe JSON parseable y lo vuelve a leer intacto", () => {
    const original = process.env;
    process.env = { ...process.env, ...env };
    try {
      const written = writeAgentStatus(makeStatus(base));
      expect(written.length).toBeGreaterThan(0);
      const back = readAgentStatus(written[0]);
      expect(back?.state).toBe("connected");
      expect(back?.deviceId).toBe("dev-1");
    } finally {
      process.env = original;
    }
  });

  it("nunca escribe la credencial en el archivo de estado", () => {
    const original = process.env;
    process.env = { ...process.env, ...env };
    try {
      // makeStatus recibe un objeto tipado: si alguien agregara un campo de token, este test es la
      // red que avisa que el tray no puede ver secretos.
      const leaked = { ...makeStatus(base), registrationToken: "SECRETO" } as AgentStatus;
      const [file] = writeAgentStatus(leaked);
      const raw = fs.readFileSync(file, "utf-8");
      expect(raw).not.toContain("SECRETO");
      // Las opcionales (lastError) solo aparecen si vienen cargadas: la proyeccion no escribe null.
      const expectedKeys = [
        "state",
        "serverUrl",
        "deviceId",
        "hostname",
        "role",
        "pid",
        "updatedAt",
        "lastHeartbeatAt",
      ].sort();
      expect(Object.keys(JSON.parse(raw)).sort()).toEqual(expectedKeys);
    } finally {
      process.env = original;
    }
  });

  it("no deja archivos temporales despues del rename", () => {
    const original = process.env;
    process.env = { ...process.env, ...env };
    try {
      writeAgentStatus(makeStatus(base));
      const leftovers = fs.readdirSync(path.join(dir, "RemoteMonitoringAgent")).filter((f) => f.endsWith(".tmp"));
      expect(leftovers).toEqual([]);
    } finally {
      process.env = original;
    }
  });

  it("rechaza estados malformeados o de un estado desconocido", () => {
    const file = path.join(dir, "roto.json");
    fs.writeFileSync(file, "{no es json");
    expect(readAgentStatus(file)).toBeNull();

    fs.writeFileSync(file, JSON.stringify({ ...base, state: "yunque" }));
    expect(readAgentStatus(file)).toBeNull();

    fs.writeFileSync(file, JSON.stringify({ state: "connected" }));
    expect(readAgentStatus(file)).toBeNull();
  });

  it("falla cerrado si el archivo no existe", () => {
    expect(readAgentStatus(path.join(dir, "nunca.csv"))).toBeNull();
  });

  it("escribir cuando el destino esta bloqueado no lanza: devuelve lista vacia", () => {
    const original = process.env;
    // ProgramData apuntando a un archivo (no a un dir) hace que mkdir falle.
    const blocker = path.join(dir, "soy-un-archivo");
    fs.writeFileSync(blocker, "x");
    process.env = { ...process.env, ProgramData: blocker, LOCALAPPDATA: blocker };
    try {
      expect(writeAgentStatus(base)).toEqual([]);
    } finally {
      process.env = original;
    }
  });
});

describe("newestStatus", () => {
  const write = (file: string, status: AgentStatus) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(status));
    return file;
  };

  it("elige el renglon mas nuevo entre los dos destinos", () => {
    const old = path.join(dir, "a", "status.json");
    const fresh = path.join(dir, "b", "status.json");
    const now = Date.now();
    write(old, { ...base, hostname: "viejo", updatedAt: new Date(now - 60_000).toISOString() });
    write(fresh, { ...base, hostname: "nuevo", updatedAt: new Date(now - 1_000).toISOString() });

    expect(newestStatus([old, fresh], now)?.status.hostname).toBe("nuevo");
    expect(newestStatus([fresh, old], now)?.status.hostname).toBe("nuevo");
  });

  it("descarta un estado del agente muerto hace 3 latidos", () => {
    const file = path.join(dir, "c", "status.json");
    const now = Date.now();
    write(file, { ...base, updatedAt: new Date(now - STATUS_STALE_MS - 1000).toISOString() });
    expect(newestStatus([file], now)).toBeNull();
    expect(isStale(readAgentStatus(file) as AgentStatus, now)).toBe(true);
  });

  it("sin archivos, devuelve null (el tray muestra 'sin datos')", () => {
    expect(newestStatus([path.join(dir, "no-existe.json")])).toBeNull();
  });
});
