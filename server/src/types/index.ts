export enum Role {
  SUPER_ADMIN = "SUPER_ADMIN",
  ADMIN = "ADMIN",
  OPERATOR = "OPERATOR",
}

export enum Permission {
  USERS_READ = "USERS_READ",
  USERS_WRITE = "USERS_WRITE",
  USERS_DELETE = "USERS_DELETE",
  DEVICES_READ = "DEVICES_READ",
  DEVICES_WRITE = "DEVICES_WRITE",
  DEVICES_DELETE = "DEVICES_DELETE",
  COMMANDS_READ = "COMMANDS_READ",
  COMMANDS_WRITE = "COMMANDS_WRITE",
  COMMANDS_EXECUTE = "COMMANDS_EXECUTE",
  SCREENSHOTS_REQUEST = "SCREENSHOTS_REQUEST",
  SCREENSHOTS_VIEW = "SCREENSHOTS_VIEW",
  AUDIT_READ = "AUDIT_READ",
  SYSTEM_SETTINGS = "SYSTEM_SETTINGS",
}

export enum DeviceStatus {
  ONLINE = "ONLINE",
  OFFLINE = "OFFLINE",
}

export enum CommandStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  EXECUTING = "EXECUTING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  REJECTED = "REJECTED",
}

export enum CommandType {
  SCREENSHOT = "SCREENSHOT",
  SYSTEM_INFO = "SYSTEM_INFO",
  PROCESS_LIST = "PROCESS_LIST",
  LOCK_SCREEN = "LOCK_SCREEN",
  SHUTDOWN = "SHUTDOWN",
  RESTART = "RESTART",
  LOGOUT = "LOGOUT",
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
}

export interface AuthRequest extends Express.Request {
  user?: JwtPayload;
}

export interface AgentPayload {
  deviceId: string;
  registrationToken: string;
}

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.SUPER_ADMIN]: Object.values(Permission),
  [Role.ADMIN]: [
    Permission.USERS_READ,
    Permission.USERS_WRITE,
    Permission.DEVICES_READ,
    Permission.DEVICES_WRITE,
    Permission.COMMANDS_READ,
    Permission.COMMANDS_WRITE,
    Permission.COMMANDS_EXECUTE,
    Permission.SCREENSHOTS_REQUEST,
    Permission.SCREENSHOTS_VIEW,
    Permission.AUDIT_READ,
  ],
  [Role.OPERATOR]: [
    Permission.DEVICES_READ,
    Permission.COMMANDS_READ,
    Permission.SCREENSHOTS_VIEW,
    Permission.AUDIT_READ,
  ],
};
