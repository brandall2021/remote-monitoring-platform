import * as jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { resizeJpeg } from "./jpegResize";

// Imagen sintetica: mitad negra, mitad blanca, con una franja roja. Suficiente para comprobar que el
// re-muestreo conserva la proporcion y que el re-encode no deforma el cuadro.
function buildJpeg(width: number, height: number, quality = 90): Buffer {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const isWhiteHalf = x < width / 2;
      const isStripe = y > height * 0.6 && y < height * 0.7;
      data[offset] = isStripe ? 220 : isWhiteHalf ? 245 : 10;
      data[offset + 1] = isStripe ? 30 : isWhiteHalf ? 245 : 10;
      data[offset + 2] = isStripe ? 30 : isWhiteHalf ? 245 : 10;
      data[offset + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ data, width, height }, quality).data);
}

describe("resizeJpeg", () => {
  it("escala al ancho pedido conservando la relacion de aspecto", () => {
    const source = buildJpeg(1920, 1080);
    const result = resizeJpeg(source, { maxWidth: 1280, quality: 70 });

    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.data.length).toBeLessThan(source.length);
  });

  it("no agranda un cuadro que ya esta por debajo del ancho maximo", () => {
    const source = buildJpeg(800, 600);
    const result = resizeJpeg(source, { maxWidth: 1280, quality: 70 });

    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it("con maxWidth 0 solo re-comprime, sin tocar la resolucion", () => {
    const source = buildJpeg(640, 480);
    const result = resizeJpeg(source, { maxWidth: 0, quality: 40 });

    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
  });

  it("el resultado sigue siendo un JPEG legible con las dimensiones declaradas", () => {
    const result = resizeJpeg(buildJpeg(1600, 900), { maxWidth: 1000, quality: 65 });
    const decoded = jpeg.decode(result.data, { useTArray: true });

    expect(decoded.width).toBe(result.width);
    expect(decoded.height).toBe(result.height);
    // jpeg-js entrega RGBA: 4 bytes por pixel.
    expect(decoded.data.length).toBe(result.width * result.height * 4);
  });

  it("bajar la calidad achica el frame, que es el objetivo del cambio", () => {
    const source = buildJpeg(1920, 1080, 95);
    const high = resizeJpeg(source, { maxWidth: 1280, quality: 92 });
    const low = resizeJpeg(source, { maxWidth: 1280, quality: 45 });

    expect(low.data.length).toBeLessThan(high.data.length);
  });

  it("rechaza lo que no es un JPEG decodificable", () => {
    expect(() => resizeJpeg(Buffer.from("no-es-un-jpeg"), { maxWidth: 1280, quality: 70 })).toThrow();
  });

  it("tolera una calidad absurda sin romperse", () => {
    const source = buildJpeg(400, 300);
    expect(() => resizeJpeg(source, { maxWidth: 200, quality: NaN })).not.toThrow();
    expect(() => resizeJpeg(source, { maxWidth: 200, quality: 10_000 })).not.toThrow();
  });
});
