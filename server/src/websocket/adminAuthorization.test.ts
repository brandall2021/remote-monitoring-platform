// Sin @jest/globals a proposito: el factory de jest.mock() no puede referenciar variables del
// scope del modulo, y `jest`/`describe`/`expect` globales (vienen de @types/jest) si se permiten.
jest.mock("../config/database", () => ({
  __esModule: true,
  default: {
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
  },
}));

import prisma from "../config/database";
import { AdminSocket, requireAdminPermission } from "./index";
import { Permission, Role } from "../types";

const auditCreate = prisma.auditLog.create as jest.Mock;

function stubSocket(userId?: string, role?: Role): AdminSocket & { emit: jest.Mock } {
  return {
    userId,
    role,
    emit: jest.fn(),
  } as unknown as AdminSocket & { emit: jest.Mock };
}

describe("requireAdminPermission", () => {
  beforeEach(() => {
    auditCreate.mockClear();
  });

  it("rejects an unauthenticated socket before checking the role", () => {
    const socket = stubSocket(undefined, undefined);

    expect(requireAdminPermission(socket, Permission.COMMANDS_EXECUTE, "send-command")).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith("error", { message: "Sesión no válida" });
  });

  it("blocks OPERATOR from destructive commands even though HTTP and WS used to disagree", () => {
    const socket = stubSocket("user-1", Role.OPERATOR);

    for (const action of ["SHUTDOWN", "RESTART", "LOGOUT", "LOCK_SCREEN"]) {
      expect(requireAdminPermission(socket, Permission.COMMANDS_EXECUTE, action)).toBe(false);
    }

    expect(socket.emit).toHaveBeenCalledWith("error", {
      message: "El rol OPERATOR no puede ejecutar SHUTDOWN",
    });
  });

  it("records the denial in the audit trail", async () => {
    const socket = stubSocket("user-9", Role.OPERATOR);

    requireAdminPermission(socket, Permission.COMMANDS_EXECUTE, "send-command");
    await new Promise((resolve) => setImmediate(resolve));

    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-9",
          action: "WS_send-command_DENIED",
        }),
      })
    );
  });

  it("allows ADMIN to execute commands and SCREENSHOTS_REQUEST", () => {
    const socket = stubSocket("user-2", Role.ADMIN);

    expect(requireAdminPermission(socket, Permission.COMMANDS_EXECUTE, "send-command")).toBe(true);
    expect(requireAdminPermission(socket, Permission.SCREENSHOTS_REQUEST, "request-screenshot")).toBe(true);
    expect(socket.emit).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("keeps AUDIT_READ out of reach for OPERATOR only where the role map says so", () => {
    const operator = stubSocket("user-3", Role.OPERATOR);
    const admin = stubSocket("user-4", Role.ADMIN);

    expect(requireAdminPermission(operator, Permission.USERS_WRITE, "create-user")).toBe(false);
    expect(requireAdminPermission(admin, Permission.USERS_WRITE, "create-user")).toBe(true);
  });
});
