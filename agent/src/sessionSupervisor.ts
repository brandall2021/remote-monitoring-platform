import net from "net";
import { randomUUID } from "crypto";
import {
  FrameDecoder,
  SessionRequestType,
  SessionResponseHeader,
  createStatusHeader,
  defaultSessionPipeName,
  encodeFrame,
} from "./sessionProtocol";
import { sessionSecretsMatch } from "./sessionSecret";

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const HELLO_TIMEOUT_MS = 3000;

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
  worker: net.Socket;
}

export interface SessionSupervisorOptions {
  pipeName?: string;
  requestTimeoutMs?: number;
  helloTimeoutMs?: number;
  secret: string;
  onWorkerChange?: (hasWorker: boolean) => void;
}

export class SessionSupervisor {
  private readonly pipeName: string;
  private readonly requestTimeoutMs: number;
  private readonly helloTimeoutMs: number;
  private readonly secret: string;
  private readonly onWorkerChange?: (hasWorker: boolean) => void;
  private readonly workers = new Set<net.Socket>();
  private readonly unauthenticated = new Set<net.Socket>();
  private readonly pending = new Map<string, PendingRequest>();
  private server: net.Server | null = null;

  constructor(options: SessionSupervisorOptions) {
    if (typeof options.secret !== "string" || options.secret.length < 32) {
      throw new Error("SessionSupervisor requires a session secret of at least 32 characters");
    }
    this.pipeName = options.pipeName || defaultSessionPipeName();
    this.requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    this.helloTimeoutMs = options.helloTimeoutMs || HELLO_TIMEOUT_MS;
    this.secret = options.secret;
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
    for (const socket of this.unauthenticated) socket.destroy();
    this.unauthenticated.clear();
    this.workers.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  hasLiveWorker(): boolean {
    return this.workers.size > 0;
  }

  // El supervisor (SYSTEM) no puede escribir en el perfil del usuario; le pasa el estado al worker,
  // que corre en la sesion interactiva y es quien lo persiste para la bandeja. Fire-and-forget: si
  // no hay worker conectado, simplemente no hay estado visible hasta que vuelva a aparecer.
  broadcastStatus(status: Record<string, unknown>): void {
    if (this.workers.size === 0) return;
    const frame = encodeFrame(createStatusHeader(randomUUID(), status));

    for (const socket of this.workers) {
      if (socket.destroyed) continue;
      socket.write(frame, (error) => {
        if (error) this.dropWorker(socket);
      });
    }
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

      this.pending.set(id, { resolve, reject, timer, worker: socket });
      socket.write(encodeFrame({ id, kind: "request", type }), (error) => {
        if (error) this.rejectPendingForWorker(socket, new Error(`Failed to send session request: ${error.message}`));
      });
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
    let authenticated = false;

    this.unauthenticated.add(socket);
    const helloTimer = setTimeout(() => {
      if (!authenticated) this.rejectWorker(socket);
    }, this.helloTimeoutMs);
    if (typeof helloTimer.unref === "function") helloTimer.unref();

    socket.on("data", (chunk: Buffer) => {
      for (const frame of decoder.push(chunk)) {
        if (!authenticated) {
          // Cualquier otro cuadro antes del hello, o un hello con otro secreto, cierra la coneccion:
          // la pipe es visible desde todas las cuentas del equipo y la unica admision es el secreto.
          if (frame.header.kind === "hello" && sessionSecretsMatch(this.secret, frame.header.secret)) {
            authenticated = true;
            clearTimeout(helloTimer);
            this.unauthenticated.delete(socket);
            this.workers.add(socket);
            this.notifyWorkerChange();
          } else {
            this.rejectWorker(socket);
            return;
          }
          continue;
        }

        if (frame.header.kind === "response") this.resolvePending(frame.header, frame.payload);
      }
    });

    const drop = () => {
      clearTimeout(helloTimer);
      this.unauthenticated.delete(socket);
      this.dropWorker(socket);
    };

    socket.on("close", drop);
    socket.on("error", drop);
  }

  private rejectWorker(socket: net.Socket): void {
    this.unauthenticated.delete(socket);
    socket.destroy();
  }

  private dropWorker(socket: net.Socket): void {
    if (!this.workers.delete(socket)) return;
    this.rejectPendingForWorker(socket, new NoSessionWorkerError());
    this.notifyWorkerChange();
  }

  private rejectPendingForWorker(socket: net.Socket, error: Error): void {
    for (const [id, pending] of this.pending) {
      if (pending.worker !== socket) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
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
