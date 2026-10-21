export interface DetectedImage {
  mimeType: string;
  extension: string;
}

// El server guardaba en disco el imageBase64 que mandaba el agente sin mirar el contenido, y la
// fila Screenshot guardaba el mimeType que el propio agente declarara. Con esto el tipo se deduce
// de los magic bytes: un agente comprometido no puede hacerse pasar por otro formato.
export function detectImage(buf: Buffer): DetectedImage | null {
  if (buf.length < 12) return null;

  // 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: "png" };
  }

  // FFD8FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }

  // RIFF....WEBVP (el agente también puede emitir webp por el canal de live)
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }

  return null;
}
