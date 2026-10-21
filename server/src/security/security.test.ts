import crypto from "crypto";
import { safeCompare } from "./tokens";
import { generateToken, hashPassword } from "./password";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE, parsePagination } from "../middleware/pagination";
import { detectImage } from "../lib/image";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
  "hex"
);
const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x08, 0, 0, 0]),
  Buffer.from("WEBPVP8 ", "ascii"),
]);

describe("safeCompare", () => {
  it("matches equal secrets", () => {
    expect(safeCompare("token-de-prueba", "token-de-prueba")).toBe(true);
  });

  it("rejects different secrets regardless of the common prefix", () => {
    expect(safeCompare("token-de-prueba", "token-de-pruebA")).toBe(false);
    expect(safeCompare("token-de-prueba", "x")).toBe(false);
  });

  it("compares the digests, not the raw strings", () => {
    // timingSafeEqual lanza si las longitudes difieren: se prueba que aqui no pasa.
    expect(() => crypto.timingSafeEqual(Buffer.from("a"), Buffer.from("ab"))).toThrow();
    expect(safeCompare("a", "ab")).toBe(false);
  });

  it("does not accept non-strings", () => {
    expect(safeCompare(undefined as unknown as string, "x")).toBe(false);
    expect(safeCompare("", "")).toBe(false);
  });
});

describe("generateToken", () => {
  it("produces url-safe tokens of the requested entropy", () => {
    const token = generateToken(32);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url").length).toBe(32);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));

    expect(tokens.size).toBe(100);
  });

  it("refuses sizes that would make weak or absurd tokens", () => {
    expect(() => generateToken(4)).toThrow(/16 y 128/);
    expect(() => generateToken(1024)).toThrow(/16 y 128/);
    expect(() => generateToken(1.5)).toThrow(/16 y 128/);
  });
});

describe("hashPassword", () => {
  it("salts: the same password yields different hashes", async () => {
    const [a, b] = await Promise.all([hashPassword("clave-compartida"), hashPassword("clave-compartida")]);

    expect(a).not.toBe(b);
  });
});

describe("parsePagination", () => {
  it("caps the page size a client can request", () => {
    expect(parsePagination({ limit: "1000000" }).limit).toBe(MAX_PAGE_SIZE);
    expect(parsePagination({ limit: 5000 }).limit).toBe(MAX_PAGE_SIZE);
  });

  it("defaults when the input is junk", () => {
    expect(parsePagination({}).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePagination({ limit: "abc" }).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePagination({ limit: "-5" }).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePagination({ limit: "0" }).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePagination({ page: "-1" }).page).toBe(1);
    expect(parsePagination({ page: "1e3" }).page).toBe(1);
  });

  it("keeps skip consistent with the bounded page", () => {
    expect(parsePagination({ page: "3", limit: "10" })).toEqual({ page: 3, limit: 10, skip: 20 });
    expect(parsePagination({ page: "2", limit: "1000000" }).skip).toBe(MAX_PAGE_SIZE);
  });
});

describe("detectImage", () => {
  it("recognizes the formats the agent can emit", () => {
    expect(detectImage(PNG)).toEqual({ mimeType: "image/png", extension: "png" });
    expect(detectImage(JPEG)).toEqual({ mimeType: "image/jpeg", extension: "jpg" });
    expect(detectImage(WEBP)).toEqual({ mimeType: "image/webp", extension: "webp" });
  });

  it("refuses anything that is not an image", () => {
    expect(detectImage(Buffer.from("#!/bin/sh\nrm -rf /\n", "utf8"))).toBeNull();
    expect(detectImage(Buffer.from("%PDF-1.4", "utf8"))).toBeNull();
    expect(detectImage(Buffer.alloc(4))).toBeNull();
    expect(detectImage(Buffer.alloc(0))).toBeNull();
  });
});
