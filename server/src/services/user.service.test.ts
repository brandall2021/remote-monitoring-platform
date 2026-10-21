import { UserService, Actor } from "./user.service";
import { Permission, Role } from "../types";
import { hasPermission } from "../security/permissions";

// C-5 (segunda capa): la politica de roles vive en permissions.ts, pero el agujero era de servicio:
// create/update/changePassword aceptaban cualquier rol y cualquier objetivo con USERS_WRITE.
jest.mock("../config/database", () => {
  // Literales, no el enum: el factory de jest.mock se ejecuta antes que los imports del test y
  // referenciar Role aca arriba deja el modulo en TDZ ("Cannot access 'types_1' before init").
  const roles: Record<string, { id: string; name: string }> = {
    SUPER_ADMIN: { id: "role-super", name: "SUPER_ADMIN" },
    ADMIN: { id: "role-admin", name: "ADMIN" },
    OPERATOR: { id: "role-operator", name: "OPERATOR" },
  };

  const state = {
    users: [
      { id: "u-admin", email: "a@x", username: "a", roleId: "role-admin", passwordHash: "x", isActive: true },
      { id: "u-super", email: "s@x", username: "s", roleId: "role-super", passwordHash: "x", isActive: true },
      { id: "u-op", email: "o@x", username: "o", roleId: "role-operator", passwordHash: "x", isActive: true },
    ] as Record<string, unknown>[],
  };

  const roleName = (userId: string) => {
    const user = state.users.find((u) => u.id === userId) as { roleId?: string };
    return Object.values(roles).find((r) => r.id === user?.roleId)?.name;
  };

  const user = {
    findUnique: jest.fn(async (args: { where: { id?: string }; select?: unknown }) => {
      const row = state.users.find((u) => u.id === args.where.id) as Record<string, unknown>;
      if (!row) return null;
      return { ...row, role: { name: roleName(String(row.id)) } };
    }),
    findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => {
      const or = (args.where.OR || []) as Record<string, unknown>[];
      return (
        state.users.find((u) =>
          or.some((cond) => Object.entries(cond).some(([k, v]) => u[k] === v))
        ) || null
      );
    }),
    create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "u-new",
      ...args.data,
    })),
    update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
      id: args.where.id,
      ...args.data,
    })),
    delete: jest.fn(async () => ({ id: "u-op" })),
    findMany: jest.fn(async () => []),
    count: jest.fn(async () => 0),
  };

  return {
    __esModule: true,
    default: {
      user,
      role: { findFirst: jest.fn(async (args: { where: { name: string } }) => roles[args.where.name] || null) },
      refreshToken: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      auditLog: { create: jest.fn(async () => ({})) },
    },
  };
});

const prismaModule = require("../config/database") as {
  default: {
    user: { update: jest.Mock; create: jest.Mock; delete: jest.Mock };
    refreshToken: { deleteMany: jest.Mock };
    role: { findFirst: jest.Mock };
  };
};

const actor = (userId: string, role: Role): Actor => ({ userId, role });
const admin = actor("u-admin", Role.ADMIN);
const superAdmin = actor("u-super", Role.SUPER_ADMIN);

const service = new UserService();

describe("userService.create", () => {
  it("blocks an ADMIN from creating a SUPER_ADMIN", async () => {
    await expect(
      service.create(admin, {
        email: "nuevo@x.com",
        username: "nuevo",
        password: "una-clave-larga",
        firstName: "N",
        lastName: "V",
        role: Role.SUPER_ADMIN,
      })
    ).rejects.toMatchObject({ status: 403 });

    expect(prismaModule.default.user.create).not.toHaveBeenCalled();
  });

  it("lets an ADMIN create an OPERATOR", async () => {
    prismaModule.default.user.create.mockClear();

    const created = await service.create(admin, {
      email: "nuevo@x.com",
      username: "nuevo-op",
      password: "una-clave-larga",
      firstName: "N",
      lastName: "V",
      role: Role.OPERATOR,
    });

    expect(created.id).toBe("u-new");
  });

  it("still requires USERS_WRITE at the route level", () => {
    expect(hasPermission(Role.ADMIN, Permission.USERS_WRITE)).toBe(true);
    expect(hasPermission(Role.OPERATOR, Permission.USERS_WRITE)).toBe(false);
  });
});

describe("userService.update", () => {
  it("blocks an ADMIN from editing the SUPER_ADMIN account", async () => {
    await expect(service.update(admin, "u-super", { firstName: "Hacked" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("blocks an ADMIN from promoting anyone, including themselves", async () => {
    await expect(
      service.update(admin, "u-op", { role: Role.SUPER_ADMIN })
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      service.update(admin, "u-admin", { role: Role.SUPER_ADMIN })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("blocks self-deactivation", async () => {
    await expect(service.update(admin, "u-admin", { isActive: false })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("lets SUPER_ADMIN change a role downward", async () => {
    prismaModule.default.user.update.mockClear();

    await service.update(superAdmin, "u-op", { role: Role.OPERATOR });

    expect(prismaModule.default.user.update).toHaveBeenCalled();
  });
});

describe("userService.delete", () => {
  it("blocks an ADMIN from deleting the SUPER_ADMIN", async () => {
    await expect(service.delete(admin, "u-super")).rejects.toMatchObject({ status: 403 });
  });

  it("blocks self-deletion", async () => {
    await expect(service.delete(superAdmin, "u-super")).rejects.toMatchObject({ status: 403 });
  });
});

describe("userService.changePassword", () => {
  it("blocks the ADMIN -> SUPER_ADMIN password reset that took over the system", async () => {
    await expect(
      service.changePassword(admin, "u-super", "otra-clave-larga")
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a short password before touching the database", async () => {
    await expect(service.changePassword(superAdmin, "u-op", "x")).rejects.toMatchObject({
      status: 400,
    });
  });

  it("revokes the refresh tokens of the account it rotates", async () => {
    prismaModule.default.refreshToken.deleteMany.mockClear();

    await service.changePassword(superAdmin, "u-op", "otra-clave-larga");

    expect(prismaModule.default.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u-op" },
    });
  });
});
