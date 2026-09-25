import { describe, expect, it } from "vitest";
import { readImageDimensions } from "./imageSize";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function buildPng(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  PNG_SIGNATURE.copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function buildJpeg(width: number, height: number, sofMarker = 0xc0, extraSegments: Buffer[] = []): Buffer {
  const segments = [
    Buffer.from([0xff, 0xd8]),
    ...extraSegments,
    Buffer.from([0xff, 0xe0, 0x00, 0x07]),
    Buffer.from("JFIF\0", "ascii"),
    Buffer.from([0xff, sofMarker, 0x00, 0x08, 0x08]),
  ];
  const sofTail = Buffer.alloc(5);
  sofTail.writeUInt16BE(height, 0);
  sofTail.writeUInt16BE(width, 2);
  sofTail[4] = 0x03;
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x02]);

  return Buffer.concat([...segments, sofTail, sos]);
}

describe("readImageDimensions", () => {
  it("reads dimensions from a real 1x1 PNG", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    expect(readImageDimensions(png)).toEqual({ width: 1, height: 1 });
  });

  it("reads dimensions from a PNG header", () => {
    expect(readImageDimensions(buildPng(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it("reads dimensions from a JPEG header", () => {
    expect(readImageDimensions(buildJpeg(1280, 720))).toEqual({ width: 1280, height: 720 });
  });

  it("reads dimensions from a progressive JPEG", () => {
    expect(readImageDimensions(buildJpeg(3840, 2160, 0xc2))).toEqual({ width: 3840, height: 2160 });
  });

  it("skips EXIF and APP segments before the SOF marker", () => {
    const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x07]), Buffer.from("Exif\0", "ascii")]);
    expect(readImageDimensions(buildJpeg(1024, 768, 0xc0, [exif]))).toEqual({ width: 1024, height: 768 });
  });

  it("ignores fill bytes before the marker", () => {
    const withFill = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), buildJpeg(800, 600).subarray(2)]);
    expect(readImageDimensions(withFill)).toEqual({ width: 800, height: 600 });
  });

  it("returns null for a JPEG without a frame header", () => {
    const truncated = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
    expect(readImageDimensions(truncated)).toBeNull();
  });

  it("returns null when start of scan is reached before a frame header", () => {
    const noSof = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02]);
    expect(readImageDimensions(noSof)).toBeNull();
  });

  it("returns null for a PNG that is too short to hold an IHDR", () => {
    expect(readImageDimensions(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(4)]))).toBeNull();
  });

  it("returns null for a PNG with a bad signature", () => {
    const buffer = buildPng(800, 600);
    buffer[1] = 0x00;
    expect(readImageDimensions(buffer)).toBeNull();
  });

  it("returns null for a PNG whose first chunk is not IHDR", () => {
    const buffer = buildPng(800, 600);
    buffer.write("IDAT", 12, "ascii");
    expect(readImageDimensions(buffer)).toBeNull();
  });

  it("returns null for unsupported or empty input", () => {
    expect(readImageDimensions(Buffer.alloc(0))).toBeNull();
    expect(readImageDimensions(Buffer.from([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(readImageDimensions(Buffer.from("not an image at all"))).toBeNull();
  });
});
