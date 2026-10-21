import { describe, expect, it } from "@jest/globals";
import { CommandType, Permission, Role } from "../types";
import {
  ALLOWED_COMMAND_TYPES,
  canExecute,
  isAllowedCommandType,
  requiredPermissionFor,
} from "./commandPolicy";

// C-2: el handler de WebSocket reenviaba data.commandType al agente sin comprobar tipo ni permiso.
// La politica vive en un modulo puro justamente para poder probarla sin server ni base de datos.
describe("isAllowedCommandType", () => {
  it("accepts every declared command type", () => {
    for (const type of Object.values(CommandType)) {
      expect(isAllowedCommandType(type)).toBe(true);
    }
  });

  it("rejects anything that is not on the allowlist", () => {
    expect(isAllowedCommandType("DELETE_FILES")).toBe(false);
    expect(isAllowedCommandType("EXEC")).toBe(false);
    expect(isAllowedCommandType("")).toBe(false);
    expect(isAllowedCommandType(undefined)).toBe(false);
    expect(isAllowedCommandType(null)).toBe(false);
    expect(isAllowedCommandType(42)).toBe(false);
    expect(isAllowedCommandType({ toString: () => "SCREENSHOT" })).toBe(false);
  });

  it("keeps the allowlist in step with the enum", () => {
    expect(new Set(ALLOWED_COMMAND_TYPES)).toEqual(new Set(Object.values(CommandType)));
  });
});

describe("requiredPermissionFor", () => {
  it("asks for SCREENSHOTS_REQUEST on screenshots", () => {
    expect(requiredPermissionFor(CommandType.SCREENSHOT)).toBe(Permission.SCREENSHOTS_REQUEST);
  });

  it("asks for COMMANDS_EXECUTE on the rest, including the destructive ones", () => {
    for (const type of [
      CommandType.SYSTEM_INFO,
      CommandType.PROCESS_LIST,
      CommandType.LOCK_SCREEN,
      CommandType.SHUTDOWN,
      CommandType.RESTART,
      CommandType.LOGOUT,
    ]) {
      expect(requiredPermissionFor(type)).toBe(Permission.COMMANDS_EXECUTE);
    }
  });
});

describe("canExecute", () => {
  it("lets ADMIN and SUPER_ADMIN run destructive commands", () => {
    for (const role of [Role.ADMIN, Role.SUPER_ADMIN]) {
      expect(canExecute(role, CommandType.SHUTDOWN)).toBe(true);
      expect(canExecute(role, CommandType.RESTART)).toBe(true);
      expect(canExecute(role, CommandType.LOGOUT)).toBe(true);
      expect(canExecute(role, CommandType.LOCK_SCREEN)).toBe(true);
    }
  });

  it("blocks OPERATOR from every command, even though it can view screenshots", () => {
    for (const type of Object.values(CommandType)) {
      expect(canExecute(Role.OPERATOR, type)).toBe(false);
    }
  });

  it("blocks an unknown role", () => {
    expect(canExecute("GUEST", CommandType.SHUTDOWN)).toBe(false);
  });
});
