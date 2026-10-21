import { hashToken } from "../security/tokens";

// H-4 (segunda capa): el access token ya no vive en localStorage, pero el refresh token de 7 dias
// si se persiste. Esta suite fija el contrato: en la tabla `refresh_tokens` va el digesto, nunca
// el JWT en claro, y el lookup de refresh/logout busca por digesto.
jest.mock("../config/database", () => {
  const store: Record<string, unknown>[] = [];
  const user = {
    id: "u-1",
    email: "a@b.c",
    username: "a",
    firstName: "a",
    lastName: "b",
    isActive: true,
    passwordHash: "hash",
    roleId: "role-admin",
    role: { name: "ADMIN" },
  };
  return {
    __esModule: true,
    default: {
      user: {
        findUnique: jest.fn(async () => user),
        update: jest.fn(async () => user),
      },
      refreshToken: {
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          const row = { id: `rt-${store.length + 1}`, ...args.data };
          store.push(row);
          return row;
        }),
        findUnique: jest.fn(async (args: { where: { token: string } }) =>
          store.find((r) => r.token === args.where.token) || null
        ),
        delete: jest.fn(async (args: { where: { id: string } }) => {
          const i = store.findIndex((r) => r.id === args.where.id);
          if (i >= 0) store.splice(i, 1);
          return null;
        }),
        deleteMany: jest.fn(async (args: { where: { token?: string; userId?: string } }) => {
          const before = store.length;
          for (let i = store.length - 1; i >= 0; i--) {
            const hit =
              (args.where.token && store[i].token === args.where.token) ||
              (args.where.userId && store[i].userId === args.where.userId);
            if (hit) store.splice(i, 1);
          }
          return { count: before - store.length };
        }),
      },
      auditLog: { create: jest.fn(async () => null) },
      __store: store,
    },
  };
});

jest.mock("../security/jwt", () => {
  let n = 0;
  return {
    generateAccessToken: jest.fn(() => "access-static"),
    generateRefreshToken: jest.fn(() => `refresh-jwt-${++n}`),
    verifyRefreshToken: jest.fn((token: string) => {
      if (!token.startsWith("refresh-jwt-")) throw new Error("bad");
      return { userId: "u-1", email: "a@b.c", role: "ADMIN" };
    }),
  };
});

jest.mock("../security/password", () => ({
  comparePassword: jest.fn(async () => true),
}));

import prismaMock from "../config/database";
import { AuthService } from "./auth.service";

const store = (prismaMock as unknown as { __store: Record<string, unknown>[] }).__store;

describe("auth.service refresh tokens", () => {
  beforeEach(() => {
    store.length = 0;
  });

  it("persiste el digesto, no el JWT en claro", async () => {
    const { refreshToken } = await new AuthService().login(
      "a@b.c",
      "pw",
      "1.2.3.4",
      "jest"
    );

    expect(store).toHaveLength(1);
    expect(store[0].token).toBe(hashToken(refreshToken));
    expect(store[0].token).not.toBe(refreshToken);
    expect(String(store[0].token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rota por digesto: el viejo sale de la tabla y el nuevo entra hashheado", async () => {
    const { refreshToken } = await new AuthService().login("a@b.c", "pw", "ip", "ua");
    const rotated = await new AuthService().refresh(refreshToken);

    expect(rotated.refreshToken).not.toBe(refreshToken);
    expect(store.map((r) => r.token)).toEqual([hashToken(rotated.refreshToken)]);

    // Reusar el token ya rotado tiene que fallar: es la deteccion basica de replay.
    await expect(new AuthService().refresh(refreshToken)).rejects.toThrow();
  });

  it("logout borra por digesto", async () => {
    const { refreshToken } = await new AuthService().login("a@b.c", "pw", "ip", "ua");
    await new AuthService().logout(refreshToken);
    expect(store).toHaveLength(0);
  });

  it("un token valido pero no emitido por este server no renueva la sesion", async () => {
    await expect(new AuthService().refresh("refresh-jwt-no-existe")).rejects.toThrow();
  });
});
