import net from "net";
import {
  FrameDecoder,
  SESSION_PIPE_NAME,
  SessionRequestType,
  SessionResponseHeader,
  encodeFrame,
} from "./sessionProtocol";
import { takeLiveFrame, takeScreenshot } from "./commands";

export class SessionWorker {
  private readonly pipeName: string;
  private readonly decoder = new FrameDecoder();
  private socket: net.Socket | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(pipeName: string = SESSION_PIPE_NAME) {
    this.pipeName = pipeName;
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
  }

  private connect(): void {
    if (this.stopped) return;

    const socket = net.createConnection(this.pipeName);
    this.socket = socket;

    socket.on("data", (chunk: Buffer) => {
      for (const frame of this.decoder.push(chunk)) {
        if (frame.header.kind === "request") {
          void this.handleRequest(frame.header.id, frame.header.type);
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

  private send(header: SessionResponseHeader, payload?: Buffer): void {
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
