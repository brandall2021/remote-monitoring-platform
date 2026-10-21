import { Permission, ROLE_PERMISSIONS, Role } from "../types";

// Jerarquía de roles para las reglas de gestión de usuarios. No es lo mismo que Permission:
// Permission dice "qué puede hacer", el rango dice "a quién puede mandar".
export const ROLE_RANK: Record<Role, number> = {
  [Role.SUPER_ADMIN]: 3,
  [Role.ADMIN]: 2,
  [Role.OPERATOR]: 1,
};

export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions ? permissions.includes(permission) : false;
}

export function hasAnyPermission(
  role: Role,
  permissions: Permission[]
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function hasAllPermissions(
  role: Role,
  permissions: Permission[]
): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

export function rankOf(role: string): number {
  return ROLE_RANK[role as Role] ?? 0;
}

// Un ADMIN tiene USERS_WRITE para gestionar OPERATORs. Sin esta función, USERS_WRITE también
// habilitaba a crear un SUPER_ADMIN o a resetearle la contraseña al que está arriba: escalada
// total por una ruta que se suponía acotada. Solo el rango estrictamente superior se puede asignar
// o modificar; SUPER_ADMIN puede todo (incluido su propio usuario, para no autobloquearse).
export function canAssignRole(actorRole: string, targetRole: string): boolean {
  if (rankOf(actorRole) >= rankOf(Role.SUPER_ADMIN)) return true;
  return rankOf(targetRole) < rankOf(actorRole);
}

export function canManageUser(actorRole: string, targetUserRole: string): boolean {
  if (rankOf(actorRole) >= rankOf(Role.SUPER_ADMIN)) return true;
  return rankOf(targetUserRole) < rankOf(actorRole);
}
