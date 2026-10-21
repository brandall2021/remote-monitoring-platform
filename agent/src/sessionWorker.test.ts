import os from "os";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NoSessionWorkerError, SessionSupervisor } from "./sessionSupervisor";
import { SessionWorker } from "./sessionWorker";
import { readAgentStatus } from "./agentStatus";

const supervisorSecret = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

let supervisor: SessionSupervisor | null = null;
let worker: SessionWorker | null = null;
let statusDirs: string[] = [];

function pipePath(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\rmagent-worker-${process.pid}-${randomUUID()}`;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rmagent-worker-"));
  return path.join(dir, "session.sock");
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  return predicate();
}

// Devuelve la primera ruta que contenga `needle`, o null: el agente escribe en dos destinos y cual
// de los dos exista depende de las variables de entorno del proceso.
async function waitForFirst(files: string[], needle: string, timeoutMs = 1500): Promise<string | null> {
  let hit: string | null = null;
  const found = await waitFor(() => {
    hit = files.find((file) => {
      try {
        return fs.readFileSync(file, "utf-8").includes(needle);
      } catch {
        return false;
      }
    }) ?? null;
    return hit !== null;
  }, timeoutMs);
  return found ? hit : null;
}

afterEach(() => {
  if (worker) worker.stop();
  worker = null;
  if (supervisor) supervisor.stop();
  supervisor = null;
  for (const dir of statusDirs) fs.rmSync(dir, { recursive: true, force: true });
  statusDirs = [];
  delete process.env.ProgramData;
  delete process.env.LOCALAPPDATA;
});

// Ruta de status.json dentro de un directorio temporal, redirigiendo las dos variables de entorno
// que usa el agente para decidir donde escribir (maquina y usuario).
function useTempStatusDir(): { dir: string; files: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rmstatus-push-"));
  statusDirs.push(dir);
  process.env.ProgramData = path.join(dir, "ProgramData");
  process.env.LOCALAPPDATA = path.join(dir, "LocalAppData");
  return {
    dir,
    files: [
      path.join(process.env.ProgramData, "RemoteMonitoringAgent", "status.json"),
      path.join(process.env.LOCALAPPDATA, "RemoteMonitoringAgent", "status.json"),
    ],
  };
}

describe("SessionWorker", () => {
  it("refuses to run without the secret handed over by the supervisor", () => {
    expect(() => new SessionWorker({ secret: "" } as { secret: string })).toThrow(/session secret/);
  });

  it("authenticates with the supervisor and answers a ping", async () => {
    const pipe = pipePath();
    supervisor = new SessionSupervisor({ pipeName: pipe, secret: supervisorSecret, requestTimeoutMs: 800 });
    await supervisor.start();

    worker = new SessionWorker({ secret: supervisorSecret, pipeName: pipe });
    worker.run();

    expect(await waitFor(() => supervisor!.hasLiveWorker())).toBe(true);
    await expect(supervisor.request("ping")).resolves.toBeDefined();
  });

  it("cannot get registered when it presents another boot secret", async () => {
    const pipe = pipePath();
    supervisor = new SessionSupervisor({ pipeName: pipe, secret: supervisorSecret, requestTimeoutMs: 300 });
    await supervisor.start();

    worker = new SessionWorker({ secret: "f".repeat(supervisorSecret.length), pipeName: pipe });
    worker.run();

    expect(await waitFor(() => supervisor!.hasLiveWorker(), 300)).toBe(false);
    await expect(supervisor.request("ping")).rejects.toBeInstanceOf(NoSessionWorkerError);
  });

  it("persists the status the supervisor pushes over the pipe", async () => {
    const { files } = useTempStatusDir();
    const pipe = pipePath();
    supervisor = new SessionSupervisor({ pipeName: pipe, secret: supervisorSecret, requestTimeoutMs: 800 });
    await supervisor.start();

    worker = new SessionWorker({ secret: supervisorSecret, pipeName: pipe });
    worker.run();
    expect(await waitFor(() => supervisor!.hasLiveWorker())).toBe(true);

    // El supervisor corre como SYSTEM en el despliegue real y no puede escribir en el perfil del
    // usuario: el estado de la coneccion viaja por la pipe y lo persiste el worker.
    supervisor.broadcastStatus({
      state: "connected",
      serverUrl: "https://monitor.example.com",
      deviceId: "dev-9",
      role: "supervisor",
      hostname: "PC-09",
      pid: 111,
      updatedAt: new Date().toISOString(),
      // ruido que la proyeccion del worker tiene que descartar:
      registrationToken: "NO-TIENE-QUE-ESCRIBIRSE",
      payload: "zzz",
    });

    const target = await waitForFirst(files, "dev-9");
    expect(target).toBeTruthy();

    const written = readAgentStatus(target as string);
    expect(written?.state).toBe("connected");
    expect(written?.deviceId).toBe("dev-9");
    expect(written?.serverUrl).toBe("https://monitor.example.com");
    expect(fs.readFileSync(target as string, "utf-8")).not.toContain("NO-TIENE-QUE-ESCRIBIRSE");
  });

  it("broadcasting with no worker attached is a no-op", async () => {
    const pipe = pipePath();
    supervisor = new SessionSupervisor({ pipeName: pipe, secret: supervisorSecret });
    await supervisor.start();
    expect(() => supervisor?.broadcastStatus({ state: "connected" })).not.toThrow();
    expect(supervisor.hasLiveWorker()).toBe(false);
  });
});
