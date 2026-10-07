import net from "net";
import os from "os";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NoSessionWorkerError, SessionSupervisor } from "./sessionSupervisor";
import { FrameDecoder, SessionRequestType, encodeFrame } from "./sessionProtocol";

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

const supervisors: SessionSupervisor[] = [];
const sockets: net.Socket[] = [];

function pipePath(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\rmagent-test-${process.pid}-${randomUUID()}`;
  }
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rmagent-test-")), "session.sock");
}

async function createSupervisor(options: { requestTimeoutMs?: number; onWorkerChange?: (hasWorker: boolean) => void } = {}) {
  const supervisor = new SessionSupervisor({
    pipeName: pipePath(),
    requestTimeoutMs: options.requestTimeoutMs || 200,
    onWorkerChange: options.onWorkerChange,
  });
  supervisors.push(supervisor);
  await supervisor.start();
  return supervisor;
}

function connectWorker(
  pipe: string,
  handler?: (type: SessionRequestType, id: string, socket: net.Socket) => void
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipe);
    sockets.push(socket);

    const decoder = new FrameDecoder();
    socket.on("data", (chunk: Buffer) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.header.kind === "request" && handler) {
          handler(frame.header.type, frame.header.id, socket);
        }
      }
    });
    // On Windows the client-side named-pipe connection can fire just before
    // the server's connection callback has attached the worker.
    socket.on("connect", () => setTimeout(() => resolve(socket), 10));
    socket.on("error", reject);
  });
}

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const supervisor of supervisors.splice(0)) supervisor.stop();
});

describe("SessionSupervisor", () => {
  it("rejects requests when no interactive session is available", async () => {
    const supervisor = await createSupervisor();

    expect(supervisor.hasLiveWorker()).toBe(false);
    await expect(supervisor.request("screenshot")).rejects.toBeInstanceOf(NoSessionWorkerError);
  });

  it("proxies a live frame to the worker as raw bytes", async () => {
    const supervisor = await createSupervisor();
    await connectWorker(supervisor["pipeName"], (type, id, socket) => {
      if (type === "live-frame") {
        socket.write(
          encodeFrame({ id, kind: "response", ok: true, mimeType: "image/jpeg", width: 1920, height: 1080 }, JPEG_BYTES)
        );
      }
    });

    const result = (await supervisor.request("live-frame")) as {
      data: Buffer;
      mimeType: string;
      width: number;
      height: number;
    };

    expect(result.data).toEqual(JPEG_BYTES);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  it("survives a large frame", async () => {
    const supervisor = await createSupervisor({ requestTimeoutMs: 2000 });
    const bigFrame = Buffer.alloc(2 * 1024 * 1024, 0x42);
    await connectWorker(supervisor["pipeName"], (type, id, socket) => {
      socket.write(encodeFrame({ id, kind: "response", ok: true, mimeType: "image/jpeg" }, bigFrame));
    });

    const result = (await supervisor.request("live-frame")) as { data: Buffer };

    expect(result.data.length).toBe(bigFrame.length);
    expect(result.data.equals(bigFrame)).toBe(true);
  });

  it("propagates worker errors", async () => {
    const supervisor = await createSupervisor();
    await connectWorker(supervisor["pipeName"], (type, id, socket) => {
      socket.write(encodeFrame({ id, kind: "response", ok: false, error: "capture failed" }));
    });

    await expect(supervisor.request("live-frame")).rejects.toThrow("capture failed");
  });

  it("times out when the worker never answers", async () => {
    const supervisor = await createSupervisor({ requestTimeoutMs: 60 });
    await connectWorker(supervisor["pipeName"]);

    await expect(supervisor.request("ping")).rejects.toThrow(/timed out/);
  });

  it("reports worker arrival and departure", async () => {
    const states: boolean[] = [];
    const supervisor = await createSupervisor({ onWorkerChange: (hasWorker) => states.push(hasWorker) });

    const worker = await connectWorker(supervisor["pipeName"]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(supervisor.hasLiveWorker()).toBe(true);

    worker.destroy();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(supervisor.hasLiveWorker()).toBe(false);
    expect(states).toEqual([true, false]);
  });

  it("stops accepting requests once the worker disconnects", async () => {
    const supervisor = await createSupervisor();
    const worker = await connectWorker(supervisor["pipeName"]);
    worker.destroy();
    await new Promise((resolve) => setTimeout(resolve, 30));

    await expect(supervisor.request("screenshot")).rejects.toBeInstanceOf(NoSessionWorkerError);
  });

  it("rejects an in-flight request as soon as its worker disconnects", async () => {
    const supervisor = await createSupervisor({ requestTimeoutMs: 2000 });
    const worker = await connectWorker(supervisor["pipeName"]);

    const request = supervisor.request("screenshot");
    worker.destroy();

    await expect(request).rejects.toBeInstanceOf(NoSessionWorkerError);
  });
});
