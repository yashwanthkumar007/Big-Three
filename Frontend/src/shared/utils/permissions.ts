/**
 * Role-Based Access Control (RBAC) — permission keys, role definitions
 * and helpers used to authorize access to administration screen(s).
 *
 * Backend authorization must also mirror these-permission checks (each
 * admin API endpoint should reject requests that lack the required
 * permission server-side).- translate this model later into a config/API
 * response if a real backend starts providing roles/permissions.
 */

export type Role =
  | "USER"
  | "REVIEWER"
  | "ADMIN"
  | "TENANT_ADMIN";

export const ROLES: Role[] = [
  "USER",
  "REVIEWER",
  "ADMIN",
  "TENANT_ADMIN",
];

/** Every permission key supported by the application. */
export type Permission =
  | "VIEW_SYSTEM_SETUP"
  | "MANAGE_USERS"
  | "VIEW_LOGGED_IN_USERS"
  | "VIEW_AUDIT_TRAIL"
  | "MANAGE_LEVELS_COMMENTS"
  | "MANAGE_DICTIONARY"
  | "MANAGE_TEXT_PROFILES"
  | "MANAGE_GRAPHICS_PROFILES"
  | "MANAGE_BARCODE_PROFILES"
  | "MANAGE_LICENSE";

/** Permission keys that control navigation to /settings/* (and the hub itself). */
export const SYSTEM_SETUP_ACCESS: Permission =
  "VIEW_SYSTEM_SETUP";

/** Permission → role mapping. ADMIN/TENANT_ADMIN have administration capabilities. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  USER: [],
  REVIEWER: [],
  ADMIN: [
    "VIEW_SYSTEM_SETUP",
    "MANAGE_USERS",
    "VIEW_LOGGED_IN_USERS",
    "VIEW_AUDIT_TRAIL",
    "MANAGE_LEVELS_COMMENTS",
    "MANAGE_DICTIONARY",
    "MANAGE_TEXT_PROFILES",
    "MANAGE_GRAPHICS_PROFILES",
    "MANAGE_BARCODE_PROFILES",
    "MANAGE_LICENSE",
  ],
  TENANT_ADMIN: [
    "VIEW_SYSTEM_SETUP",
    "MANAGE_USERS",
    "VIEW_LOGGED_IN_USERS",
    "VIEW_AUDIT_TRAIL",
    "MANAGE_LEVELS_COMMENTS",
    "MANAGE_DICTIONARY",
    "MANAGE_TEXT_PROFILES",
    "MANAGE_GRAPHICS_PROFILES",
    "MANAGE_BARCODE_PROFILES",
    "MANAGE_LICENSE",
  ],
};

export type PermissionCheck = {
  permission: Permission;
};

/** Returns true when the given role carries the permission. */
export function roleHasPermission(
  role: Role | string | undefined | null,
  permission: Permission,
): boolean {
  if (!role) return false;
  return (ROLE_PERMISSIONS[role as Role] ?? []).includes(permission);
}

export function hasAnyPermission(
  roles: (Role | string | undefined)[] | undefined,
  ...permissions: Permission[]
): boolean {
  if (!roles || roles.length === 0) return false;
  return permissions.some((permission) =>
    roles.some((role) => roleHasPermission(role, permission))
  );
}