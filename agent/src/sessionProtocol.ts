export type SessionRequestType = "live-frame" | "screenshot" | "ping";

export interface SessionRequestHeader {
  id: string;
  kind: "request";
  type: SessionRequestType;
}

export interface SessionResponseHeader {
  id: string;
  kind: "response";
  ok: boolean;
  error?: string;
  mimeType?: string;
  width?: number;
  height?: number;
}

export type SessionMessageHeader = SessionRequestHeader | SessionResponseHeader;

export interface SessionFrame {
  header: SessionMessageHeader;
  payload?: Buffer;
}

export const SESSION_PIPE_NAME = "\\\\.\\pipe\\rmagent-session";

const HEADER_LENGTH_BYTES = 4;
const PAYLOAD_LENGTH_BYTES = 4;
const PREFIX_BYTES = HEADER_LENGTH_BYTES + PAYLOAD_LENGTH_BYTES;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;

export function defaultSessionPipeName(): string {
  return process.platform === "win32" ? SESSION_PIPE_NAME : "/tmp/rmagent-session.sock";
}

export function encodeFrame(header: SessionMessageHeader, payload?: Buffer): Buffer {
  const body = payload || Buffer.alloc(0);
  const json = Buffer.from(JSON.stringify(header), "utf8");

  if (json.length > MAX_HEADER_BYTES) {
    throw new Error(`Session message header too large: ${json.length} bytes`);
  }
  if (body.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`Session payload too large: ${body.length} bytes`);
  }

  const frame = Buffer.alloc(PREFIX_BYTES + json.length + body.length);
  frame.writeUInt32LE(json.length, 0);
  frame.writeUInt32LE(body.length, HEADER_LENGTH_BYTES);
  json.copy(frame, PREFIX_BYTES);
  body.copy(frame, PREFIX_BYTES + json.length);
  return frame;
}

export function parseHeader(json: string): SessionMessageHeader | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof decoded !== "object" || decoded === null) return null;

  const candidate = decoded as Record<string, unknown>;
  if (typeof candidate.id !== "string") return null;

  if (candidate.kind === "request") {
    if (
      candidate.type === "live-frame" ||
      candidate.type === "screenshot" ||
      candidate.type === "ping"
    ) {
      return { id: candidate.id, kind: "request", type: candidate.type };
    }
    return null;
  }

  if (candidate.kind === "response" && typeof candidate.ok === "boolean") {
    return {
      id: candidate.id,
      kind: "response",
      ok: candidate.ok,
      error: typeof candidate.error === "string" ? candidate.error : undefined,
      mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : undefined,
      width: typeof candidate.width === "number" ? candidate.width : undefined,
      height: typeof candidate.height === "number" ? candidate.height : undefined,
    };
  }

  return null;
}

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): SessionFrame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    const frames: SessionFrame[] = [];

    while (this.buffer.length >= PREFIX_BYTES) {
      const headerLength = this.buffer.readUInt32LE(0);
      const payloadLength = this.buffer.readUInt32LE(HEADER_LENGTH_BYTES);

      if (headerLength > MAX_HEADER_BYTES || payloadLength > MAX_PAYLOAD_BYTES) {
        this.buffer = Buffer.alloc(0);
        return frames;
      }

      const total = PREFIX_BYTES + headerLength + payloadLength;
      if (this.buffer.length < total) break;

      const header = parseHeader(this.buffer.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength).toString("utf8"));
      const payload = payloadLength > 0
        ? this.buffer.subarray(PREFIX_BYTES + headerLength, total)
        : undefined;

      this.buffer = this.buffer.subarray(total);
      if (header) frames.push({ header, payload });
    }

    return frames;
  }
}
