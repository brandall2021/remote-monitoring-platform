// Espejo del ROLE_PERMISSIONS del server (server/src/types/index.ts). Solo sirve para ocultar
// acciones en la UI: la autorización real la hace el server. Si acá y allá se disagree, gana allá
// y lo peor que puede pasar es que un botón aparezca y devuelva 403.
export type RoleName = "SUPER_ADMIN" | "ADMIN" | "OPERATOR";

const SUPER_ADMIN: string[] = [
  "USERS_READ", "USERS_WRITE", "USERS_DELETE",
  "DEVICES_READ", "DEVICES_WRITE", "DEVICES_DELETE",
  "COMMANDS_READ", "COMMANDS_WRITE", "COMMANDS_EXECUTE",
  "SCREENSHOTS_REQUEST", "SCREENSHOTS_VIEW",
  "AUDIT_READ", "SYSTEM_SETTINGS",
];

const ADMIN: string[] = [
  "USERS_READ", "USERS_WRITE",
  "DEVICES_READ", "DEVICES_WRITE",
  "COMMANDS_READ", "COMMANDS_WRITE", "COMMANDS_EXECUTE",
  "SCREENSHOTS_REQUEST", "SCREENSHOTS_VIEW",
  "AUDIT_READ",
];

const OPERATOR: string[] = [
  "DEVICES_READ",
  "COMMANDS_READ",
  "SCREENSHOTS_VIEW",
  "AUDIT_READ",
];

const BY_ROLE: Record<RoleName, string[]> = {
  SUPER_ADMIN,
  ADMIN,
  OPERATOR,
};

export function roleName(user?: { role?: { name?: string } | string } | null): RoleName | null {
  if (!user) return null;
  const name = typeof user.role === "string" ? user.role : user.role?.name;
  return name && name in BY_ROLE ? (name as RoleName) : null;
}

export function can(user: unknown, permission: string): boolean {
  const role = roleName(user as { role?: { name?: string } });
  if (!role) return false;
  return BY_ROLE[role].includes(permission);
}

// Rutas del panel reservadas: un OPERATOR que escriba /users en la barra de direcciones ve el
// formulario y recibe 403 en cada llamada. El guard lo manda afuera antes de eso.
export const ROUTE_PERMISSIONS: Record<string, string> = {
  "/users": "USERS_READ",
  "/audit": "AUDIT_READ",
};
