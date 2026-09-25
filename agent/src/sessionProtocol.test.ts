import { describe, expect, it } from "vitest";
import { FrameDecoder, encodeFrame, parseHeader } from "./sessionProtocol";

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

describe("encodeFrame", () => {
  it("prefixes the frame with the header and payload lengths", () => {
    const frame = encodeFrame({ id: "a", kind: "request", type: "ping" });

    expect(frame.readUInt32LE(0)).toBeGreaterThan(0);
    expect(frame.readUInt32LE(4)).toBe(0);
    expect(frame.length).toBe(8 + frame.readUInt32LE(0));
  });

  it("carries binary payloads without corrupting them", () => {
    const decoder = new FrameDecoder();
    const frames = decoder.push(encodeFrame({ id: "a", kind: "response", ok: true, width: 1920 }, JPEG_BYTES));

    expect(frames).toHaveLength(1);
    expect(frames[0].payload).toEqual(JPEG_BYTES);
    expect(frames[0].header).toEqual({ id: "a", kind: "response", ok: true, error: undefined, mimeType: undefined, width: 1920, height: undefined });
  });

  it("rejects oversized payloads", () => {
    expect(() => encodeFrame({ id: "a", kind: "response", ok: true }, Buffer.alloc(33 * 1024 * 1024))).toThrow(/too large/);
  });
});

describe("parseHeader", () => {
  it("parses a request", () => {
    expect(parseHeader(JSON.stringify({ id: "a", kind: "request", type: "live-frame" }))).toEqual({
      id: "a",
      kind: "request",
      type: "live-frame",
    });
  });

  it("parses a response", () => {
    expect(parseHeader(JSON.stringify({ id: "a", kind: "response", ok: false, error: "boom" }))).toMatchObject({
      ok: false,
      error: "boom",
    });
  });

  it("ignores non numeric dimensions", () => {
    expect(parseHeader(JSON.stringify({ id: "a", kind: "response", ok: true, width: "1920" }))).toMatchObject({
      width: undefined,
    });
  });

  it("rejects malformed headers", () => {
    expect(parseHeader("not json")).toBeNull();
    expect(parseHeader("null")).toBeNull();
    expect(parseHeader("42")).toBeNull();
    expect(parseHeader(JSON.stringify({ kind: "request", type: "ping" }))).toBeNull();
    expect(parseHeader(JSON.stringify({ id: "a" }))).toBeNull();
    expect(parseHeader(JSON.stringify({ id: "a", kind: "response" }))).toBeNull();
    expect(parseHeader(JSON.stringify({ id: "a", kind: "request", type: "rm-rf" }))).toBeNull();
  });
});

describe("FrameDecoder", () => {
  it("decodes several frames from one chunk", () => {
    const decoder = new FrameDecoder();
    const chunk = Buffer.concat([
      encodeFrame({ id: "1", kind: "request", type: "ping" }),
      encodeFrame({ id: "2", kind: "request", type: "screenshot" }),
    ]);

    expect(decoder.push(chunk).map((frame) => frame.header.id)).toEqual(["1", "2"]);
  });

  it("buffers a frame split across chunks", () => {
    const decoder = new FrameDecoder();
    const encoded = encodeFrame({ id: "1", kind: "response", ok: true }, JPEG_BYTES);
    const splits = [3, 9, 20, encoded.length - 1];

    let consumed = 0;
    for (const split of splits) {
      expect(decoder.push(encoded.subarray(consumed, split))).toEqual([]);
      consumed = split;
    }

    const frames = decoder.push(encoded.subarray(consumed));

    expect(frames).toHaveLength(1);
    expect(frames[0].payload).toEqual(JPEG_BYTES);
  });

  it("handles a frame arriving one byte at a time", () => {
    const decoder = new FrameDecoder();
    const encoded = encodeFrame({ id: "1", kind: "response", ok: true }, JPEG_BYTES);
    const collected = [];

    for (const byte of encoded) {
      collected.push(...decoder.push(Buffer.from([byte])));
    }

    expect(collected).toHaveLength(1);
    expect(collected[0].payload).toEqual(JPEG_BYTES);
  });

  it("drops the stream when a length prefix is impossible", () => {
    const decoder = new FrameDecoder();
    const bogus = Buffer.alloc(8);
    bogus.writeUInt32LE(0x7fffffff, 0);

    expect(decoder.push(bogus)).toEqual([]);
    expect(decoder.push(encodeFrame({ id: "1", kind: "request", type: "ping" }))).toHaveLength(1);
  });
});
