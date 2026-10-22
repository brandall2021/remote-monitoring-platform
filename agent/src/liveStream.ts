// Logica pura del streaming de vista en vivo: sin sockets ni captura, para poder probarla con vitest.
// El agente solia responder un frame por cada "live-command" que mandaba el server, y el server
// mandaba uno por cada tick del setInterval del navegador. Ese diseño de request/response por frame
// es lo que hacia que la vista se sintiera a saltos: cada cuadro cuesta un round-trip completo
// (browser -> server -> agente -> captura -> server -> browser) y si la captura tarda mas que el
// intervalo, el flag isCapturing descarta el pedido sin avisar. Con el push loop el agente regula su
// propio ritmo y nunca se pierde cuadros por solapamiento.

export const LIVE_DEFAULT_INTERVAL_MS = 1000;
// Piso de 250 ms: el worker de captura persistente entrega un cuadro cada ~170 ms, asi que 4 cuadros
// por segundo es lo mas rapido que se puede prometer sin acumular pedidos. Con la ruta lenta (un
// powershell.exe por cuadro) el piso solo significa que el agente va a ir tan rapido como pueda.
export const LIVE_MIN_INTERVAL_MS = 250;
export const LIVE_MAX_INTERVAL_MS = 60000;

// Piso de separacion entre cuadros: si la captura ya tardo mas que el intervalo pedido, no encadenamos
// cuadros seguidos; eso saturaria el uplink justo cuando ya esta lento.
export const LIVE_MIN_DELAY_MS = 50;

// Todo lo que llega de afuera (env, payload del server, argv) entra aca como unknown: un string
// vacio o un null no pueden significar "intervalo 0", tienen que caer en el valor por defecto.
function toNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim() !== "") return Number(raw);
  return NaN;
}

export function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = toNumber(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

export function clampLiveInterval(raw: unknown): number {
  return clampInt(raw, LIVE_DEFAULT_INTERVAL_MS, LIVE_MIN_INTERVAL_MS, LIVE_MAX_INTERVAL_MS);
}

// Proximo delay para mantener un periodo objetivo: lo que la captura + emision ya consumio se descuenta.
export function nextFrameDelayMs(intervalMs: number, elapsedMs: number): number {
  const interval = clampLiveInterval(intervalMs);
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  return Math.max(LIVE_MIN_DELAY_MS, interval - elapsed);
}

export interface LiveCaptureSettings {
  maxWidth: number;
  quality: number;
  // Techo de tamano de un cuadro: un JPEG de 1280 px pesa ~60 KB; si el worker de captura devuelve
  // algo de este orden de magnitud o mayor, el canal binario esta roto y es mejor no difundirlo.
  maxFrameBytes: number;
  // El worker persistente de PowerShell es la ruta rapida; con LIVE_CAPTURE_WORKER=0 se vuelve a la
  // captura por proceso (mas lenta) sin reinstalar el agente.
  worker: boolean;
}

// Un JPEG a resolucion nativa de un monitor 2K/4K pesa varios MB; por websocket eso es lo que
// entorpece la conexion. Reducir a 1280 px y calidad 70 deja el cuadro en ~80-150 KB, que es el
// orden de magnitud que necesita una vista fluida por internet.
export function liveCaptureSettings(env: NodeJS.ProcessEnv = process.env): LiveCaptureSettings {
  const workerFlag = String(env.LIVE_CAPTURE_WORKER ?? "").trim().toLowerCase();

  return {
    maxWidth: clampInt(env.LIVE_MAX_WIDTH, 1280, 320, 3840),
    quality: clampInt(env.LIVE_JPEG_QUALITY, 70, 30, 95),
    maxFrameBytes: clampInt(env.LIVE_MAX_FRAME_BYTES, 8 * 1024 * 1024, 64 * 1024, 32 * 1024 * 1024),
    worker: workerFlag !== "0" && workerFlag !== "false",
  };
}
