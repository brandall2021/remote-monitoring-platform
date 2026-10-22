import { describe, expect, it } from "vitest";
import {
  LIVE_MAX_INTERVAL_MS,
  LIVE_MIN_INTERVAL_MS,
  clampInt,
  clampLiveInterval,
  liveCaptureSettings,
  nextFrameDelayMs,
} from "./liveStream";

describe("clampInt", () => {
  it("usa el fallback cuando el valor no es un numero", () => {
    expect(clampInt(undefined, 1280, 320, 3840)).toBe(1280);
    expect(clampInt("no-sirve", 1280, 320, 3840)).toBe(1280);
    expect(clampInt("", 1280, 320, 3840)).toBe(1280);
    expect(clampInt(NaN, 70, 30, 95)).toBe(70);
  });

  it("recorta contra minimo y maximo", () => {
    expect(clampInt("100", 1280, 320, 3840)).toBe(320);
    expect(clampInt("99999", 1280, 320, 3840)).toBe(3840);
    expect(clampInt("1920", 1280, 320, 3840)).toBe(1920);
  });

  it("redondea, porque un ancho fraccionado no lo acepta GDI+", () => {
    expect(clampInt("1279.6", 1280, 320, 3840)).toBe(1280);
  });
});

describe("clampLiveInterval", () => {
  it("acepta el intervalo pedido por el panel", () => {
    expect(clampLiveInterval(1000)).toBe(1000);
    expect(clampLiveInterval("2000")).toBe(2000);
  });

  it("no deja un ritmo que sature el uplink", () => {
    expect(clampLiveInterval(1)).toBe(LIVE_MIN_INTERVAL_MS);
    expect(clampLiveInterval(0)).toBe(LIVE_MIN_INTERVAL_MS);
    expect(clampLiveInterval(-500)).toBe(LIVE_MIN_INTERVAL_MS);
  });

  it("no deja una corriente dormida para siempre", () => {
    expect(clampLiveInterval(10_000_000)).toBe(LIVE_MAX_INTERVAL_MS);
  });

  it("cae en el default con basura", () => {
    expect(clampLiveInterval(undefined)).toBe(1000);
    expect(clampLiveInterval("abc")).toBe(1000);
    expect(clampLiveInterval(null)).toBe(1000);
  });
});

describe("nextFrameDelayMs", () => {
  it("descuenta lo que ya tardo la captura, para mantener el periodo objetivo", () => {
    expect(nextFrameDelayMs(1000, 400)).toBe(600);
  });

  it("nunca encadena cuadros seguidos si la captura se paso del intervalo", () => {
    expect(nextFrameDelayMs(1000, 4000)).toBe(50);
    expect(nextFrameDelayMs(1000, 1000)).toBe(50);
  });

  it("tolera elapsed invalidos sin programar un delay negativo", () => {
    expect(nextFrameDelayMs(1000, NaN)).toBe(1000);
    expect(nextFrameDelayMs(1000, -50)).toBe(1000);
  });

  it("recorta el intervalo antes de calcular el delay", () => {
    // 10 ms se recorta al minimo (250) y de ahi sale el delay: nunca un timer casi en cero.
    expect(nextFrameDelayMs(10, 0)).toBe(LIVE_MIN_INTERVAL_MS);
  });
});

describe("liveCaptureSettings", () => {
  it("por defecto baja el cuadro a 1280 px con calidad 70 y worker activo", () => {
    expect(liveCaptureSettings({})).toEqual({
      maxWidth: 1280,
      quality: 70,
      maxFrameBytes: 8 * 1024 * 1024,
      worker: true,
    });
  });

  it("respeta el entorno del agente", () => {
    expect(liveCaptureSettings({ LIVE_MAX_WIDTH: "1920", LIVE_JPEG_QUALITY: "85" })).toEqual({
      maxWidth: 1920,
      quality: 85,
      maxFrameBytes: 8 * 1024 * 1024,
      worker: true,
    });
  });

  it("no deja una calidad que de cuadros ilegibles ni un ancho de pantalla completa 4K+", () => {
    expect(liveCaptureSettings({ LIVE_MAX_WIDTH: "1", LIVE_JPEG_QUALITY: "1" })).toEqual({
      maxWidth: 320,
      quality: 30,
      maxFrameBytes: 8 * 1024 * 1024,
      worker: true,
    });
    expect(liveCaptureSettings({ LIVE_MAX_WIDTH: "99999", LIVE_JPEG_QUALITY: "999" })).toEqual({
      maxWidth: 3840,
      quality: 95,
      maxFrameBytes: 8 * 1024 * 1024,
      worker: true,
    });
  });

  it("deja apagar el worker solo con un valor explicito", () => {
    // LIVE_CAPTURE_WORKER=0 es la via de escape si PowerShell falla en un equipo concreto; un valor
    // basura no puede apagar la ruta rapida por accidente.
    expect(liveCaptureSettings({ LIVE_CAPTURE_WORKER: "0" }).worker).toBe(false);
    expect(liveCaptureSettings({ LIVE_CAPTURE_WORKER: "false" }).worker).toBe(false);
    expect(liveCaptureSettings({ LIVE_CAPTURE_WORKER: "FALSE" }).worker).toBe(false);
    expect(liveCaptureSettings({ LIVE_CAPTURE_WORKER: "" }).worker).toBe(true);
    expect(liveCaptureSettings({ LIVE_CAPTURE_WORKER: "1" }).worker).toBe(true);
  });

  it("acota el tamano maximo de cuadro al rango util", () => {
    expect(liveCaptureSettings({ LIVE_MAX_FRAME_BYTES: "10" }).maxFrameBytes).toBe(64 * 1024);
    expect(liveCaptureSettings({ LIVE_MAX_FRAME_BYTES: "999999999" }).maxFrameBytes).toBe(32 * 1024 * 1024);
    expect(liveCaptureSettings({ LIVE_MAX_FRAME_BYTES: "abc" }).maxFrameBytes).toBe(8 * 1024 * 1024);
  });
});
