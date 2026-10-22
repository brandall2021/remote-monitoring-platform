import net from "net";
import { randomUUID } from "crypto";
import {
  FrameDecoder,
  SESSION_PIPE_NAME,
  SessionMessageHeader,
  SessionRequestType,
  createHelloHeader,
  encodeFrame,
} from "./sessionProtocol";
import { takeLiveFrame, takeScreenshot } from "./commands";
import { stopLiveCaptureWorker } from "./liveCaptureWorker";
import { writeAgentStatus } from "./agentStatus";

export interface SessionWorkerOptions {
  secret: string;
  pipeName?: string;
}

export class SessionWorker {
  private readonly pipeName: string;
  private readonly secret: string;
  private readonly decoder = new FrameDecoder();
  private socket: net.Socket | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(options: SessionWorkerOptions) {
    if (typeof options.secret !== "string" || options.secret.length < 32) {
      throw new Error("SessionWorker requires the session secret handed over by the supervisor");
    }
    this.secret = options.secret;
    this.pipeName = options.pipeName || SESSION_PIPE_NAME;
  }

  run(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    // Este proceso es el dueno del powershell.exe que captura la pantalla del usuario; si muere sin
    // cerrarlo, el hijo queda vivo siguiendo la captura hasta que Windows lo borre.
    stopLiveCaptureWorker();
  }

  private connect(): void {
    if (this.stopped) return;

    const socket = net.createConnection(this.pipeName);
    this.socket = socket;

    // Primer cuadro obligatorio: sin el hello el supervisor descarta la coneccion y la cierra.
    socket.on("connect", () => {
      this.send(createHelloHeader(randomUUID(), this.secret));
    });

    socket.on("data", (chunk: Buffer) => {
      for (const frame of this.decoder.push(chunk)) {
        if (frame.header.kind === "request") {
          void this.handleRequest(frame.header.id, frame.header.type);
        } else if (frame.header.kind === "status") {
          // El supervisor corre como SYSTEM y no puede tocar el perfil de este usuario; el worker
          // sí, y es el proceso indicado para dejar el estado que lee la bandeja.
          try {
            writeAgentStatus(frame.header.status);
          } catch (error: any) {
            console.error(`Failed to persist agent status: ${error?.message || error}`);
          }
        }
      }
    });

    socket.on("error", () => this.scheduleReconnect());
    socket.on("close", () => this.scheduleReconnect());
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return;

    this.socket = null;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, 2000);

    if (typeof this.retryTimer.unref === "function") this.retryTimer.unref();
  }

  private send(header: SessionMessageHeader, payload?: Buffer): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(encodeFrame(header, payload));
    }
  }

  private async handleRequest(id: string, type: SessionRequestType): Promise<void> {
    try {
      if (type === "ping") {
        this.send({ id, kind: "response", ok: true });
        return;
      }

      if (type === "live-frame") {
        const frame = await takeLiveFrame();
        this.send(
          {
            id,
            kind: "response",
            ok: true,
            mimeType: frame.mimeType,
            width: frame.width,
            height: frame.height,
          },
          frame.data
        );
        return;
      }

      const shot = await takeScreenshot();
      this.send(
        {
          id,
          kind: "response",
          ok: true,
          mimeType: "image/png",
          width: shot.width,
          height: shot.height,
        },
        Buffer.from(shot.imageBase64, "base64")
      );
    } catch (error: any) {
      this.send({
        id,
        kind: "response",
        ok: false,
        error: error?.message || "Session request failed",
      });
    }
  }
}
