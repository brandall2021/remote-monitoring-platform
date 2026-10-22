import { EventEmitter } from "events";
import fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jpeg from "jpeg-js";
import type { ChildProcessWithoutNullStreams } from "child_process";
import {
  LiveCaptureWorker,
  LiveFrameParser,
  LiveWorkerSettings,
  getLiveCaptureWorker,
  stopLiveCaptureWorker,
} from "./liveCaptureWorker";

// Cuadro real (codificado con jpeg-js) para que readImageDimensions lea el ancho y el alto de la
// cabecera, igual que va a pasar con el JPEG que devuelve PowerShell.
function buildFrame(width: number, height: number): Buffer {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 200;
    data[i * 4 + 1] = 40;
    data[i * 4 + 2] = 40;
    data[i * 4 + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 60).data);
}

// Cuadro en el formato del canal: int32 LE con la longitud, seguido del JPEG.
function encodeFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

interface FakeChild {
  child: ChildProcessWithoutNullStreams;
  stdinWrites: string[];
  killed: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  emitExit: (code: number) => void;
  emitError: (message: string) => void;
}

function fakeChild(): FakeChild {
  const proc = new EventEmitter() as any;
  const stdinWrites: string[] = [];
  let killed = 0;

  proc.stdin = { write: (chunk: string) => stdinWrites.push(chunk), destroyed: false };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {
    killed += 1;
    return true;
  };

  return {
    child: proc as ChildProcessWithoutNullStreams,
    stdinWrites,
    get killed() {
      return killed;
    },
    stdout: proc.stdout,
    stderr: proc.stderr,
    emitExit: (code: number) => proc.emit("exit", code),
    emitError: (message: string) => proc.emit("error", new Error(message)),
  };
}

const settings: LiveWorkerSettings = { maxWidth: 1280, quality: 70, maxFrameBytes: 8 * 1024 * 1024 };

function build(options?: { spawnProcess?: (scriptPath: string) => ChildProcessWithoutNullStreams }) {
  const fake = fakeChild();
  const spawnProcess = options?.spawnProcess || vi.fn(() => fake.child);
  const logs: string[] = [];
  const worker = new LiveCaptureWorker({
    settings,
    spawnProcess,
    log: (message) => logs.push(message),
  });
  return { fake, worker, spawnProcess, logs };
}

describe("LiveFrameParser", () => {
  it("recupera el cuadro cuando la cabecera y el payload llegan juntos", () => {
    const parser = new LiveFrameParser(1024 * 1024);
    const frame = buildFrame(64, 48);
    const result = parser.push(encodeFrame(frame));

    expect(result.error).toBeUndefined();
    expect(result.frames).toHaveLength(1);
    expect(Buffer.compare(result.frames[0], frame)).toBe(0);
  });

  it("aguanta un cuadro partido en pedazos sueltos", () => {
    const parser = new LiveFrameParser(1024 * 1024);
    const bytes = encodeFrame(buildFrame(64, 48));

    // La cabecera literalmente cortada al medio: ahi todavia no hay nada para devolver.
    expect(parser.push(bytes.subarray(0, 2)).frames).toEqual([]);
    expect(parser.push(bytes.subarray(2, 40)).frames).toEqual([]);
    expect(parser.push(bytes.subarray(40)).frames).toHaveLength(1);
  });

  it("separa dos cuadros que llegaron en un solo chunk", () => {
    const parser = new LiveFrameParser(1024 * 1024);
    const first = encodeFrame(buildFrame(64, 48));
    const second = encodeFrame(buildFrame(80, 50));
    const result = parser.push(Buffer.concat([first, second]));

    expect(result.error).toBeUndefined();
    expect(result.frames).toHaveLength(2);
    expect(result.frames[1].length).toBe(second.length - 4);
  });

  it("corta el canal con una longitud absurda", () => {
    const parser = new LiveFrameParser(64 * 1024);
    const header = Buffer.alloc(4);
    header.writeInt32LE(10 * 1024 * 1024, 0);

    expect(parser.push(header).error).toMatch(/fuera de rango/);
  });

  it("corta el canal con una longitud de texto: stdout contaminado", () => {
    // Un "P" de "PowerShell" escrito en stdout se lee como longitud y es muchisimo mas chico que un
    // cuadro: senal inequivoca de que el framing se rompió, no de que llego un JPEG miniatura.
    const parser = new LiveFrameParser(64 * 1024);
    expect(parser.push(Buffer.from("PowerShell")).error).toMatch(/fuera de rango/);
  });

  it("acepta una longitud negativa como canal roto", () => {
    const parser = new LiveFrameParser(64 * 1024);
    const header = Buffer.alloc(4);
    header.writeInt32LE(-1, 0);
    expect(parser.push(header).error).toMatch(/fuera de rango/);
  });

  it("reset() descarta lo que quedaba a medio leer", () => {
    const parser = new LiveFrameParser(1024 * 1024);
    parser.push(encodeFrame(buildFrame(64, 48)).subarray(0, 30));
    parser.reset();

    expect(parser.push(encodeFrame(buildFrame(64, 48))).frames).toHaveLength(1);
  });
});

describe("LiveCaptureWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    stopLiveCaptureWorker();
  });

  it("levanta PowerShell una sola vez y le pide los cuadros por stdin", async () => {
    const { fake, worker, spawnProcess } = build();

    const first = worker.requestFrame();
    fake.stdout.emit("data", encodeFrame(buildFrame(1280, 720)));
    await expect(first).resolves.toMatchObject({ width: 1280, height: 720, mimeType: "image/jpeg" });

    const second = worker.requestFrame();
    fake.stdout.emit("data", encodeFrame(buildFrame(1280, 720)));
    await expect(second).resolves.toBeTruthy();

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    // Primero los ajustes, y despues un "g" por cuadro pedido.
    expect(fake.stdinWrites).toEqual(["s 1280 70\n", "g\n", "g\n"]);
  });

  it("no solapa pedidos: un segundo cuadro mientras espera devuelve null", async () => {
    const { fake, worker, spawnProcess } = build();

    const first = worker.requestFrame();
    await expect(worker.requestFrame()).resolves.toBeNull();
    expect(spawnProcess).toHaveBeenCalledTimes(1);

    fake.stdout.emit("data", encodeFrame(buildFrame(320, 200)));
    await expect(first).resolves.toMatchObject({ width: 320 });
    expect(fake.stdinWrites.filter((w) => w === "g\n")).toHaveLength(1);
  });

  it("resuelve null y re-levanta el worker cuando PowerShell muere", async () => {
    const first = fakeChild();
    const second = fakeChild();
    const children = [first, second];
    let index = 0;

    const worker = new LiveCaptureWorker({
      settings,
      log: () => {},
      spawnProcess: () => children[index++].child,
    });

    const pending = worker.requestFrame();
    first.emitExit(1);
    await expect(pending).resolves.toBeNull();
    // Un proceso que ya exitio no se mata: se limpia el estado y se vuelve a spawnear al cuadro siguiente.
    expect(first.killed).toBe(0);

    const retry = worker.requestFrame();
    expect(index).toBe(2);
    second.stdout.emit("data", encodeFrame(buildFrame(640, 480)));
    await expect(retry).resolves.toMatchObject({ width: 640 });
  });

  it("cae a la ruta lenta si el cuadro no llega nunca", async () => {
    const { fake, worker } = build();

    const pending = worker.requestFrame();
    // Dos bytes: todavia no hay cabecera, asi que el pedido sigue esperando (no es un framing roto).
    fake.stdout.emit("data", Buffer.alloc(2));

    await vi.advanceTimersByTimeAsync(9000);
    await expect(pending).resolves.toBeNull();
    // El hijo colgado se mata: si no, quedaria un powershell.exe capturando pantalla sin dueno.
    expect(fake.killed).toBe(1);
  });

  it("mata el canal cuando el framing se rompe en vez de difundir basura", async () => {
    const { fake, worker } = build();

    const pending = worker.requestFrame();
    fake.stdout.emit("data", Buffer.from("PS> algo de texto"));
    await expect(pending).resolves.toBeNull();
    expect(fake.killed).toBe(1);
  });

  it("deja de reintentar despues de varios arranques fallidos", async () => {
    const children: FakeChild[] = [];
    const worker = new LiveCaptureWorker({
      settings,
      log: () => {},
      maxSpawns: 3,
      spawnWindowMs: 60000,
      spawnProcess: () => {
        const fresh = fakeChild();
        children.push(fresh);
        return fresh.child;
      },
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      const pending = worker.requestFrame();
      children[children.length - 1].emitExit(1);
      await expect(pending).resolves.toBeNull();
    }

    expect(worker.isDisabled()).toBe(false);

    // Cuarto arranque dentro de la ventana: se rinde ANTES de volver a spawnear PowerShell.
    await expect(worker.requestFrame()).resolves.toBeNull();
    expect(children).toHaveLength(3);
    expect(worker.isDisabled()).toBe(true);

    await expect(worker.requestFrame()).resolves.toBeNull();
    expect(children).toHaveLength(3);
  });

  it("cierra el hijo cuando pasa el tiempo de inactividad", async () => {
    const { fake, worker } = build();

    const pending = worker.requestFrame();
    fake.stdout.emit("data", encodeFrame(buildFrame(64, 48)));
    await expect(pending).resolves.toBeTruthy();

    await vi.advanceTimersByTimeAsync(70000);
    expect(fake.killed).toBe(1);
    expect(worker.isRunning()).toBe(false);
  });

  it("stop() pide salir y mata; despues de dispose() no se vuelve a levantar", async () => {
    const { fake, worker, spawnProcess } = build();

    const pending = worker.requestFrame();
    fake.stdout.emit("data", encodeFrame(buildFrame(64, 48)));
    await pending;

    worker.stop();
    expect(fake.stdinWrites).toContain("q\n");
    expect(fake.killed).toBe(1);
    expect(worker.isRunning()).toBe(false);

    worker.dispose();
    await expect(worker.requestFrame()).resolves.toBeNull();
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("reenvia al log lo que PowerShell escribe por stderr", async () => {
    const { fake, worker, logs } = build();

    const pending = worker.requestFrame();
    fake.stderr.emit("data", Buffer.from("virtual screen too small\n"));
    fake.stdout.emit("data", encodeFrame(buildFrame(64, 48)));
    await expect(pending).resolves.toBeTruthy();

    expect(logs.join("\n")).toContain("virtual screen too small");
  });

  it("escribe el script en una temp propia y la borra al cerrarse", async () => {
    const fake = fakeChild();
    const scriptPaths: string[] = [];
    const worker = new LiveCaptureWorker({
      settings,
      log: () => {},
      spawnProcess: (scriptPath) => {
        scriptPaths.push(scriptPath);
        return fake.child;
      },
    });

    const pending = worker.requestFrame();
    fake.stdout.emit("data", encodeFrame(buildFrame(64, 48)));
    await pending;

    expect(scriptPaths).toHaveLength(1);
    expect(fs.existsSync(scriptPaths[0])).toBe(true);

    worker.dispose();
    expect(fs.existsSync(scriptPaths[0])).toBe(false);
  });
});

describe("getLiveCaptureWorker", () => {
  afterEach(() => {
    stopLiveCaptureWorker();
  });

  it("reutiliza el worker mientras los ajustes no cambien", () => {
    const a = getLiveCaptureWorker(settings);
    const b = getLiveCaptureWorker(settings);
    expect(a).toBe(b);
  });

  it("descarta el worker viejo si cambia la calidad o el ancho", () => {
    const a = getLiveCaptureWorker(settings);
    const b = getLiveCaptureWorker({ ...settings, quality: 85 });

    expect(b).not.toBe(a);
    // El viejo queda descartado: un requestFrame posterior no tiene que volver a usarlo.
    return expect(a.requestFrame()).resolves.toBeNull();
  });

  it("stopLiveCaptureWorker() suelta el singleton", () => {
    const a = getLiveCaptureWorker(settings);
    stopLiveCaptureWorker();
    expect(getLiveCaptureWorker(settings)).not.toBe(a);
  });
});
