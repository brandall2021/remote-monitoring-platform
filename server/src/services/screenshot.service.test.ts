import path from "path";
import { config } from "../config";
import { publicRow, ScreenshotService } from "./screenshot.service";

// C-3: las capturas se servían por un express.static público montado antes que las rutas de API.
// Hoy son filas de la base y el binario se resuelve por id, con la ruta contenida en el directorio
// de uploads. Estos dos comportamientos son los que hay que sostener.
jest.mock("../config/database", () => {
  const state: { row: Record<string, unknown> | null } = { row: null };

  return {
    __esModule: true,
    default: {
      screenshot: {
        findUnique: jest.fn(async () => state.row),
        findMany: jest.fn(async () => (state.row ? [state.row] : [])),
        count: jest.fn(async () => (state.row ? 1 : 0)),
        delete: jest.fn(async () => ({ id: "shot-1" })),
      },
      device: { findUnique: jest.fn(async () => ({ id: "device-1" })) },
      deviceCommand: { create: jest.fn(async () => ({})) },
      deviceEvent: { create: jest.fn(async () => ({})) },
      __setRow: (row: Record<string, unknown> | null) => {
        state.row = row;
      },
    },
  };
});

const prismaModule = require("../config/database") as {
  default: { __setRow: (row: Record<string, unknown> | null) => void };
};
const setRow = prismaModule.default.__setRow;

const service = new ScreenshotService();
const UPLOADS_DIR = path.resolve(config.uploads.screenshotsDir);

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "shot-1",
    deviceId: "device-1",
    requestedById: "user-1",
    filePath: path.join(UPLOADS_DIR, "capture.png"),
    fileSize: 1024,
    mimeType: "image/png",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    device: { hostname: "PC-ASESOR-01" },
    requestedBy: { username: "admin" },
    ...overrides,
  };
}

describe("publicRow", () => {
  it("strips the absolute filesystem path", () => {
    const row = publicRow(storedRow() as never);

    expect(row).not.toHaveProperty("filePath");
    expect(JSON.stringify(row)).not.toContain(UPLOADS_DIR);
  });

  it("keeps everything the panel renders", () => {
    const row = publicRow(storedRow() as never) as Record<string, unknown>;

    expect(row.id).toBe("shot-1");
    expect(row.mimeType).toBe("image/png");
    expect(row.device).toEqual({ hostname: "PC-ASESOR-01" });
  });

  it("does not mutate the row that comes out of Prisma", () => {
    const original = storedRow();
    publicRow(original as never);

    expect(original).toHaveProperty("filePath");
  });
});

describe("screenshotService.findAll", () => {
  it("never leaks the uploads path in a list", async () => {
    setRow(storedRow());

    const result = await service.findAll(1, 20);

    expect(result.screenshots).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("capture.png");
  });

  it("throws when the row does not exist", async () => {
    setRow(null);

    await expect(service.findById("missing")).rejects.toMatchObject({ status: 404 });
  });
});

describe("screenshotService.resolveFile", () => {
  it("resolves a normal stored file inside the uploads directory", async () => {
    setRow(storedRow());

    const file = await service.resolveFile("shot-1");

    expect(file.absPath).toBe(path.join(UPLOADS_DIR, "capture.png"));
    expect(file.mimeType).toBe("image/png");
  });

  it("refuses a filePath that points outside uploads", async () => {
    setRow(storedRow({ filePath: path.resolve(process.env.HOME || "C:\\", "etc/passwd") }));

    await expect(service.resolveFile("shot-1")).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a traversal smuggled in the filename", async () => {
    setRow(storedRow({ filePath: path.join(UPLOADS_DIR, "..", "..", "windows", "system32", "config") }));

    await expect(service.resolveFile("shot-1")).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a nested path even when it starts inside uploads", async () => {
    setRow(storedRow({ filePath: path.join(UPLOADS_DIR, "sub", "capture.png") }));

    await expect(service.resolveFile("shot-1")).rejects.toMatchObject({ status: 400 });
  });

  it("404s on an unknown id", async () => {
    setRow(null);

    await expect(service.resolveFile("nope")).rejects.toMatchObject({ status: 404 });
  });
});
