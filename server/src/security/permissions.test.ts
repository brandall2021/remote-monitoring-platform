import { describe, expect, it } from "@jest/globals";
import { Role, Permission, ROLE_PERMISSIONS } from "../types";
import { canAssignRole, canManageUser, hasPermission, rankOf, ROLE_RANK } from "./permissions";

// C-5: un ADMIN con USERS_WRITE podia crear/promover usuarios SUPER_ADMIN y resetearles la
// contraseña. USERS_WRITE sigue existiendo, pero ahora choca contra el rango del actor.
describe("canAssignRole", () => {
  it("lets SUPER_ADMIN assign any role", () => {
    for (const target of Object.values(Role)) {
      expect(canAssignRole(Role.SUPER_ADMIN, target)).toBe(true);
    }
  });

  it("blocks ADMIN from creating or promoting to SUPER_ADMIN", () => {
    expect(canAssignRole(Role.ADMIN, Role.SUPER_ADMIN)).toBe(false);
  });

  it("lets ADMIN manage the roles below it", () => {
    expect(canAssignRole(Role.ADMIN, Role.ADMIN)).toBe(false);
    expect(canAssignRole(Role.ADMIN, Role.OPERATOR)).toBe(true);
  });

  it("blocks OPERATOR from assigning anything above itself", () => {
    expect(canAssignRole(Role.OPERATOR, Role.ADMIN)).toBe(false);
    expect(canAssignRole(Role.OPERATOR, Role.SUPER_ADMIN)).toBe(false);
    expect(canAssignRole(Role.OPERATOR, Role.OPERATOR)).toBe(false);
  });

  it("rejects an unknown role instead of defaulting to full access", () => {
    expect(rankOf("NOEXISTE")).toBe(0);
    expect(canAssignRole("NOEXISTE", Role.SUPER_ADMIN)).toBe(false);
  });
});

describe("canManageUser", () => {
  it("stops ADMIN from touching a SUPER_ADMIN account", () => {
    expect(canManageUser(Role.ADMIN, Role.SUPER_ADMIN)).toBe(false);
  });

  it("lets SUPER_ADMIN manage its own tier, including itself", () => {
    expect(canManageUser(Role.SUPER_ADMIN, Role.SUPER_ADMIN)).toBe(true);
  });

  it("keeps ADMIN strictly below its own tier: peers do not manage each other", () => {
    expect(canManageUser(Role.ADMIN, Role.ADMIN)).toBe(false);
    expect(canManageUser(Role.ADMIN, Role.OPERATOR)).toBe(true);
    expect(canManageUser(Role.OPERATOR, Role.ADMIN)).toBe(false);
  });

  it("only SUPER_ADMIN can manage another SUPER_ADMIN", () => {
    expect(canManageUser(Role.SUPER_ADMIN, Role.SUPER_ADMIN)).toBe(true);
    expect(canManageUser(Role.ADMIN, Role.SUPER_ADMIN)).toBe(false);
  });
});

describe("ROLE_RANK", () => {
  it("has a rank for every role in the enum", () => {
    for (const role of Object.values(Role)) {
      expect(typeof ROLE_RANK[role]).toBe("number");
    }
  });

  it("orders the hierarchy strictly", () => {
    expect(ROLE_RANK[Role.SUPER_ADMIN]).toBeGreaterThan(ROLE_RANK[Role.ADMIN]);
    expect(ROLE_RANK[Role.ADMIN]).toBeGreaterThan(ROLE_RANK[Role.OPERATOR]);
  });
});

describe("ROLE_PERMISSIONS", () => {
  it("does not give OPERATOR the destructive command permission", () => {
    expect(hasPermission(Role.OPERATOR, Permission.COMMANDS_EXECUTE)).toBe(false);
    expect(hasPermission(Role.OPERATOR, Permission.USERS_WRITE)).toBe(false);
  });

  it("does not give ADMIN user deletion or system settings", () => {
    expect(hasPermission(Role.ADMIN, Permission.USERS_DELETE)).toBe(false);
    expect(hasPermission(Role.ADMIN, Permission.SYSTEM_SETTINGS)).toBe(false);
  });

  it("gives SUPER_ADMIN everything", () => {
    for (const permission of Object.values(Permission)) {
      expect(ROLE_PERMISSIONS[Role.SUPER_ADMIN]).toContain(permission);
    }
  });
});
