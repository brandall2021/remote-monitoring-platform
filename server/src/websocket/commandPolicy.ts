import { CommandType, Permission } from "../types";
import { hasPermission } from "../security/permissions";

// Política única de comandos. El canal WebSocket solía reenviar data.commandType tal cual al
// agente sin validar nada: si el cliente mandaba un tipo inexistente, el error salía del otro lado,
// y si mandaba uno válido, se ejecutaba sin permiso. Todo pasa por acá.

export const ALLOWED_COMMAND_TYPES: readonly CommandType[] = [
  CommandType.SCREENSHOT,
  CommandType.SYSTEM_INFO,
  CommandType.PROCESS_LIST,
  CommandType.LOCK_SCREEN,
  CommandType.SHUTDOWN,
  CommandType.RESTART,
  CommandType.LOGOUT,
];

// Qué hace falta para que cada tipo llegue al agente. Los destructivos piden COMMANDS_EXECUTE;
// COMMANDS_WRITE (crear/ver) no alcanza.
const PERMISSION_BY_TYPE: Record<CommandType, Permission> = {
  [CommandType.SCREENSHOT]: Permission.SCREENSHOTS_REQUEST,
  [CommandType.SYSTEM_INFO]: Permission.COMMANDS_EXECUTE,
  [CommandType.PROCESS_LIST]: Permission.COMMANDS_EXECUTE,
  [CommandType.LOCK_SCREEN]: Permission.COMMANDS_EXECUTE,
  [CommandType.SHUTDOWN]: Permission.COMMANDS_EXECUTE,
  [CommandType.RESTART]: Permission.COMMANDS_EXECUTE,
  [CommandType.LOGOUT]: Permission.COMMANDS_EXECUTE,
};

export function isAllowedCommandType(value: unknown): value is CommandType {
  return typeof value === "string" && (ALLOWED_COMMAND_TYPES as readonly string[]).includes(value);
}

export function requiredPermissionFor(commandType: CommandType): Permission {
  return PERMISSION_BY_TYPE[commandType];
}

export function canExecute(role: string, commandType: CommandType): boolean {
  return hasPermission(role as never, requiredPermissionFor(commandType));
}
