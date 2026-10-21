import { DeviceService, DEVICE_PUBLIC_SELECT } from "./device.service";

// C-4: GET /api/devices devolvía la fila completa de Prisma, así que el panel mostraba (y
// cualquiera con DEVICES_READ podía leer) el registrationToken de TODOS los equipos. Ese token es
// la credencial del agente: con él se uno a /agent como si fuera ese PC.
//
// El mock proyecta con `select` igual que Prisma, así que si alguien vuelve a pedir la fila entera
// el test falla: la proyección es el contrato.
jest.mock("../config/database", () => {
  const project = (row: Record<string, unknown>, select: unknown): Record<string, unknown> => {
    if (!select || typeof select !== "object") return { ...row };
    const out: Record<string, unknown> = {};
    for (const [key, wanted] of Object.entries(select as Record<string, unknown>)) {
      if (wanted === true && key in row) out[key] = row[key];
      else if (wanted && typeof wanted === "object" && key in row) out[key] = row[key];
    }
    return out;
  };

  const state: { devices: Record<string, unknown>[] } = {
    devices: [
      {
        id: "device-1",
        hostname: "PC-ASESOR-01",
        alias: null,
        agentVersion: "1.0.0",
        operatingSystem: "win32",
        osVersion: "Windows 10",
        ipAddress: "192.168.0.10",
        macAddress: "aa:bb:cc:dd:ee:ff",
        platform: "x64",
        role: "ASESOR",
        status: "ONLINE",
        lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
        registeredAt: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        registrationToken: "token-secreto-del-equipo-1",
        _count: { commands: 0, screenshots: 0 },
      },
      {
        id: "device-2",
        hostname: "PC-ASESOR-02",
        registrationToken: "token-secreto-del-equipo-2",
        status: "OFFLINE",
        lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ],
  };

  const device = {
    findMany: jest.fn(async (args: { select?: unknown }) =>
      state.devices.map((row) => project(row, args.select))
    ),
    findUnique: jest.fn(async (args: { where: { id?: string }; select?: unknown }) => {
      const row = state.devices.find((d) => d.id === args.where.id);
      return row ? project(row, args.select) : null;
    }),
    count: jest.fn(async () => state.devices.length),
    create: jest.fn(async (args: { data: Record<string, unknown>; select?: unknown }) =>
      project({ id: "device-new", ...args.data }, args.select)
    ),
    update: jest.fn(async (args: { where: { id: string }; select?: unknown }) => {
      const row = state.devices.find((d) => d.id === args.where.id) || {};
      return project(row, args.select);
    }),
    updateMany: jest.fn(async () => ({ count: 0 })),
    delete: jest.fn(async () => ({ id: "device-1" })),
    findFirst: jest.fn(async () => null),
  };

  return {
    __esModule: true,
    default: {
      device,
      deviceEvent: { create: jest.fn(async () => ({})), findFirst: jest.fn(async () => null) },
      auditLog: { create: jest.fn(async () => ({})) },
      screenshot: { findMany: jest.fn(async () => []), deleteMany: jest.fn(async () => ({})) },
      __setDevices: (rows: Record<string, unknown>[]) => {
        state.devices = rows;
      },
    },
  };
});

const prismaModule = require("../config/database") as {
  default: {
    device: { findMany: jest.Mock; findUnique: jest.Mock };
    __setDevices: (rows: Record<string, unknown>[]) => void;
  };
};

const setDevices = prismaModule.default.__setDevices;
const fullDeviceRow = () => ({
  id: "device-1",
  hostname: "PC-ASESOR-01",
  status: "ONLINE",
  lastSeenAt: new Date(),
  registrationToken: "token-secreto-del-equipo-1",
});

const service = new DeviceService();

describe("DEVICE_PUBLIC_SELECT", () => {
  it("does not project the per-device credential", () => {
    expect(Object.keys(DEVICE_PUBLIC_SELECT)).not.toContain("registrationToken");
  });

  it("keeps the fields the panel actually renders", () => {
    for (const field of ["id", "hostname", "status", "lastSeenAt"]) {
      expect(DEVICE_PUBLIC_SELECT).toHaveProperty(field);
    }
  });
});

describe("deviceService.findAll", () => {
  it("never returns a registrationToken", async () => {
    setDevices([fullDeviceRow()]);

    const result = await service.findAll(1, 20);

    expect(result.devices).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("token-secreto-del-equipo-1");
    expect(result.devices[0]).not.toHaveProperty("registrationToken");
  });

  it("caps an abusive page size instead of dumping the whole table", async () => {
    setDevices([fullDeviceRow()]);
    const findMany = prismaModule.default.device.findMany;
    findMany.mockClear();

    await service.findAll(1, 100_000);

    expect(findMany.mock.calls[0][0].take).toBeLessThanOrEqual(100);
  });
});

describe("deviceService.findById", () => {
  it("hides the token on the detail view too", async () => {
    setDevices([fullDeviceRow()]);

    const device = await service.findById("device-1");

    expect(device).not.toHaveProperty("registrationToken");
  });
});

describe("deviceService.register", () => {
  it("hands the new token back exactly once, to the agent that just registered", async () => {
    setDevices([]);

    const device = await service.register({
      hostname: "PC-NUEVA",
      operatingSystem: "win32",
      osVersion: "Windows 11",
      ipAddress: "192.168.0.50",
      platform: "x64",
      agentVersion: "1.0.0",
    });

    expect(typeof device.registrationToken).toBe("string");
    expect(String(device.registrationToken).length).toBeGreaterThanOrEqual(16);
  });

  it("ignores a status or token forced from the request body", async () => {
    setDevices([]);

    const device = await service.register({
      hostname: "PC-NUEVA",
      operatingSystem: "win32",
      ipAddress: "192.168.0.50",
      platform: "x64",
      agentVersion: "1.0.0",
    } as Parameters<DeviceService["register"]>[0] & { status?: string });

    expect(device.status).toBe("ONLINE");
    expect(JSON.stringify(device)).not.toContain("registrationToken-inyectado");
  });
});
