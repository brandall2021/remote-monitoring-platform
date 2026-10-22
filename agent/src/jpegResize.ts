import * as jpeg from "jpeg-js";

export interface ResizedFrame {
  data: Buffer;
  width: number;
  height: number;
}

export interface ResizeOptions {
  /** Ancho maximo en px. 0 (o mayor que el original) deja la resolucion intacta. */
  maxWidth: number;
  /** Calidad JPEG 1-100 con la que se re-encodifica el cuadro. */
  quality: number;
}

/**
 * Reduce y re-comprime un JPEG ya capturado, sin dependencias nativas.
 *
 * Por que existe: `screenshot-desktop` captura rapido (~0,3 s) pero no admite escalado ni control de
 * calidad, asi que suelta el cuadro a resolucion nativa (300-600 KB por frame, varios MB en un 4K).
 * La alternativa con System.Drawing tarda ~1,4 s por cuadro porque levanta un powershell.exe nuevo cada
 * vez, y eso baja el ritmo real a menos de un cuadro por segundo. Decodificar y re-encodificar aca
 * cuesta ~50 ms y deja el frame en ~60 KB: cuadros chicos y seguidos, que es lo que hace que la vista
 * se sienta fluida. Sin `sharp` ni binarios compilados, que `pkg` no empaqueta bien.
 */
export function resizeJpeg(source: Buffer, options: ResizeOptions): ResizedFrame {
  const decoded = jpeg.decode(source, { useTArray: true });
  if (!decoded.width || !decoded.height) {
    throw new Error("The captured frame has no readable dimensions");
  }

  const scale =
    options.maxWidth > 0 && decoded.width > options.maxWidth ? options.maxWidth / decoded.width : 1;
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));

  const pixels =
    scale === 1
      ? toUint8Array(decoded.data)
      : averageDownscale(toUint8Array(decoded.data), decoded.width, decoded.height, width, height);

  const encoded = jpeg.encode({ data: pixels, width, height }, clampQuality(options.quality));
  return { data: Buffer.from(encoded.data), width, height };
}

function toUint8Array(data: Uint8Array | Uint8ClampedArray): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) return 70;
  return Math.min(Math.max(Math.round(quality), 1), 100);
}

// Promedio por bloque (box filter) en vez de tomar el pixel mas cercano: con escalados tipo 1.5x el
// vecino mas cercano deja el texto de la pantalla con bordes saltando, que es justo lo que se ve mal.
function averageDownscale(
  rgba: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Uint8Array {
  const output = new Uint8Array(targetWidth * targetHeight * 4);
  const xRatio = sourceWidth / targetWidth;
  const yRatio = sourceHeight / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const sourceTop = Math.min(sourceHeight - 1, Math.floor(y * yRatio));
    const sourceBottom = Math.min(sourceHeight - 1, Math.max(sourceTop, Math.floor((y + 1) * yRatio) - 1));

    for (let x = 0; x < targetWidth; x++) {
      const sourceLeft = Math.min(sourceWidth - 1, Math.floor(x * xRatio));
      const sourceRight = Math.min(sourceWidth - 1, Math.max(sourceLeft, Math.floor((x + 1) * xRatio) - 1));

      let red = 0;
      let green = 0;
      let blue = 0;
      let samples = 0;

      for (let sy = sourceTop; sy <= sourceBottom; sy++) {
        const rowOffset = sy * sourceWidth;
        for (let sx = sourceLeft; sx <= sourceRight; sx++) {
          const index = (rowOffset + sx) * 4;
          red += rgba[index];
          green += rgba[index + 1];
          blue += rgba[index + 2];
          samples++;
        }
      }

      const offset = (y * targetWidth + x) * 4;
      output[offset] = red / samples;
      output[offset + 1] = green / samples;
      output[offset + 2] = blue / samples;
      output[offset + 3] = 255;
    }
  }

  return output;
}
