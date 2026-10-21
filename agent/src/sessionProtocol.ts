export type SessionRequestType = "live-frame" | "screenshot" | "ping";

// La pipe es un objeto del sistema visible para cualquier proceso del equipo: sin este handshake,
// un usuario local puede conectarse antes que el worker real, recibir los pedidos de captura y
// responder con una imagen fabricada (o vaciar el stream). El worker prueba que es el proceso que
// arrancó el supervisor con el secreto efímero que inyecta start-session.ps1 en su entorno.
export interface SessionHelloHeader {
  id: string;
  kind: "hello";
  secret: string;
}

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

// Push unidireccional supervisor -> worker con el estado de la coneccion al server. Lo necesita el
// modo Session 0: el proceso que habla con el server corre como SYSTEM y no puede escribir en el
// perfil del usuario, mientras que el icono de la bandeja vive en la sesion interactiva. El worker
// (que SI corre como ese usuario) es quien persiste el status.json que lee el tray. No espera
// respuesta: si el worker no esta, el mensaje se pierde y no pasa nada.
export interface SessionStatusHeader {
  id: string;
  kind: "status";
  status: Record<string, unknown>;
}

export type SessionMessageHeader =
  | SessionHelloHeader
  | SessionRequestHeader
  | SessionResponseHeader
  | SessionStatusHeader;

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

// El secreto viaja en texto hex (64 chars) o base64url; 512 deja margen pero acota el parseo.
export const MAX_SECRET_LENGTH = 512;

export function createHelloHeader(id: string, secret: string): SessionHelloHeader {
  return { id, kind: "hello", secret };
}

export function createStatusHeader(id: string, status: Record<string, unknown>): SessionStatusHeader {
  // Se sanitiza tambien al emitir, no solo al recibir: el cuadro que sale por la pipe ya tiene que
  // estar acotado, para que un bug del emisor no obligue al lector a desconfiar.
  const sanitized = sanitizeStatusObject(status) || {};
  return { id, kind: "status", status: sanitized };
}

const STATUS_FIELDS = [
  "state",
  "serverUrl",
  "deviceId",
  "hostname",
  "role",
  "pid",
  "updatedAt",
  "lastHeartbeatAt",
  "lastError",
] as const;

// El worker escribe este objeto en el perfil del usuario sin volver a validarlo contra el server,
// así que la cota va acá: solo claves conocidas, solo escalares, largo acotado. Un supervisor
// comprometido o un bug de serializacion no alcanzan para meter JSON arbitrario en status.json.
function sanitizeStatusObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const field of STATUS_FIELDS) {
    const raw = source[field];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[field] = Math.trunc(raw);
    } else if (typeof raw === "boolean") {
      out[field] = raw;
    } else if (typeof raw === "string" && raw.length <= 512) {
      out[field] = raw;
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

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

  if (candidate.kind === "hello") {
    if (
      typeof candidate.secret === "string" &&
      candidate.secret.length > 0 &&
      candidate.secret.length <= MAX_SECRET_LENGTH
    ) {
      return { id: candidate.id, kind: "hello", secret: candidate.secret };
    }
    return null;
  }

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

  if (candidate.kind === "status") {
    const status = sanitizeStatusObject(candidate.status);
    if (!status) return null;
    return { id: candidate.id, kind: "status", status };
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
