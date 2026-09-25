import net from "net";
import { randomUUID } from "crypto";
import {
  FrameDecoder,
  SessionRequestType,
  SessionResponseHeader,
  defaultSessionPipeName,
  encodeFrame,
} from "./sessionProtocol";

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

export class NoSessionWorkerError extends Error {
  constructor() {
    super("No interactive session is available on this device");
    this.name = "NoSessionWorkerError";
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface SessionSupervisorOptions {
  pipeName?: string;
  requestTimeoutMs?: number;
  onWorkerChange?: (hasWorker: boolean) => void;
}

export class SessionSupervisor {
  private readonly pipeName: string;
  private readonly requestTimeoutMs: number;
  private readonly onWorkerChange?: (hasWorker: boolean) => void;
  private readonly workers = new Set<net.Socket>();
  private readonly pending = new Map<string, PendingRequest>();
  private server: net.Server | null = null;

  constructor(options: SessionSupervisorOptions = {}) {
    this.pipeName = options.pipeName || defaultSessionPipeName();
    this.requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    this.onWorkerChange = options.onWorkerChange;
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.attachWorker(socket));
      server.once("error", reject);
      server.listen(this.pipeName, () => {
        server.removeListener("error", reject);
        this.server = server;
        resolve();
      });
    });
  }

  stop(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Session supervisor stopped"));
    }
    this.pending.clear();
    this.workers.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  hasLiveWorker(): boolean {
    return this.workers.size > 0;
  }

  async request(type: SessionRequestType): Promise<unknown> {
    const socket = this.pickWorker();
    if (!socket) throw new NoSessionWorkerError();

    const id = randomUUID();

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Session request ${type} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      if (typeof timer.unref === "function") timer.unref();

      this.pending.set(id, { resolve, reject, timer });
      socket.write(encodeFrame({ id, kind: "request", type }));
    });
  }

  private pickWorker(): net.Socket | null {
    for (const socket of this.workers) {
      if (!socket.destroyed) return socket;
    }
    return null;
  }

  private attachWorker(socket: net.Socket): void {
    const decoder = new FrameDecoder();
    this.workers.add(socket);
    this.notifyWorkerChange();

    socket.on("data", (chunk: Buffer) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.header.kind === "response") this.resolvePending(frame.header, frame.payload);
      }
    });

    socket.on("close", () => this.dropWorker(socket));
    socket.on("error", () => this.dropWorker(socket));
  }

  private dropWorker(socket: net.Socket): void {
    if (!this.workers.delete(socket)) return;
    this.notifyWorkerChange();
  }

  private notifyWorkerChange(): void {
    if (this.onWorkerChange) this.onWorkerChange(this.hasLiveWorker());
  }

  private resolvePending(header: SessionResponseHeader, payload?: Buffer): void {
    const pending = this.pending.get(header.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(header.id);

    if (!header.ok) {
      pending.reject(new Error(header.error || "Session request failed"));
      return;
    }

    pending.resolve({
      data: payload,
      mimeType: header.mimeType,
      width: header.width,
      height: header.height,
    });
  }
}
