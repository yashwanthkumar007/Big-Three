const USER_KEY = "user";
const ACCESS_TOKEN_KEY = "access_token";
const SESSION_EXPIRY_KEY = "session_expiry";

import type { Permission, Role } from "@/shared/utils/permissions";
import { ROLE_PERMISSIONS } from "@/shared/utils/permissions";

// Session timeout in milliseconds (e.g., 30 minutes)
const SESSION_TIMEOUT = 30 * 60 * 1000;

export type AccountType = "Tenant admin" | "user" | string;

type User = {
  id: number;
  name: string;
  username?: string;
  email: string;
  accountType: AccountType;
  sessionId?: string;
  loginTime?: string;
};

export const setSession = (user: User, accessToken?: string) => {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(
    SESSION_EXPIRY_KEY,
    String(Date.now() + SESSION_TIMEOUT)
  );

  if (accessToken) {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  }
};

export const clearSession = () => {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(SESSION_EXPIRY_KEY);
};

/**
 * Returns the bearer/access token used to authenticate API requests,
 * or null when the user is not logged in (mock environment).
 */
export const getAccessToken = (): string | null => {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
};

export const getSession = (): User | null => {
  const userStr = localStorage.getItem(USER_KEY);

  if (!userStr) {
    return null;
  }

  try {
    return JSON.parse(userStr) as User;
  } catch (error) {
    console.error("Failed to parse user data:", error);
    return null;
  }
};

/**
 * Returns the sessionId of the currently authenticated session, or null
 * when there is no active session. The sessionId identifies the current
 * login session so the UI can protect the "current session" from
 * termination using a session-id comparison rather than email matching.
 */
export const getCurrentSessionId = (): string | null => {
  const user = getSession();
  return user?.sessionId ?? null;
};

export const isSessionValid = (): boolean => {
  const user = getSession();

  if (!user) {
    return false;
  }

  const expiry = localStorage.getItem(SESSION_EXPIRY_KEY);

  if (!expiry) {
    return false;
  }

  const expiryTime = Number(expiry);

  if (Number.isNaN(expiryTime) || Date.now() > expiryTime) {
    // Session expired - clear it
    clearSession();
    return false;
  }

  return true;
};

/**
 * Returns the account type of the currently logged-in user, or null when
 * there is no active session (e.g. "Tenant admin" or "user").
 *
 * Authorization is derived solely from the accountType field stored in
 * the authenticated session. The email address is an identity/login
 * identifier only and must NEVER be used to determine permissions.
 */
export const getAccountType = (): AccountType | null => {
  const user = getSession();

  if (!user) {
    return null;
  }

  return user.accountType || null;
};

/**
 * True when the logged-in user has administrator privileges ("Administrator",
 * or the legacy "Tenant admin" type). Used to conditionally show admin-only
 * UI (gear icon / admin pages). Read fresh on every call so an account-type
 * change is reflected immediately.
 */
export const isTenantAdmin = (): boolean => {
  const accountType = getAccountType();
  return accountType === "Administrator" || accountType === "Tenant admin";
};
/* -------------------------------------------------------------------------- */
/* CurrentUser model                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The currently authenticated user, as surfaced by the session. The
 * displayed name/email always comes from the authenticated user — never
 * hardcoded. Roles/permissions are derived from the account type so the
 * same model drives the administration UI.
 */
export type CurrentUser = {
  id: number | string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  accountType: string;
  sessionId?: string | null;
  company: string;
  accountStatus: "Active" | "Inactive" | "Locked";
  roles: Role[];
  permissions: Permission[];
  accountExpiry?: string | null;
  passwordExpiry?: string | null;
  createdAt?: string;
  emailNotificationEnabled: boolean;
};

const ROLE_BY_ACCOUNT_TYPE: Record<string, Role> = {
  "Tenant admin": "TENANT_ADMIN",
  user: "USER",
  Administrator: "ADMIN",
  reviewer: "REVIEWER",
};

/** Derives the role for a stored account-type string (case-insensitive fallback). */
function roleForAccountType(accountType: string | null | undefined): Role {
  if (!accountType) return "USER";
  if (ROLE_BY_ACCOUNT_TYPE[accountType]) return ROLE_BY_ACCOUNT_TYPE[accountType];
  const lower = accountType.toLowerCase();
  if (ROLE_BY_ACCOUNT_TYPE[lower]) return ROLE_BY_ACCOUNT_TYPE[lower];
  return "USER";
}

/**
 * Builds the full current-user model from the session (never hardcoded).
 * Roles/permissions are derived from the account type..
 */
export function getCurrentUser(): CurrentUser | null {
  const session = getSession();
  if (!session) return null;

  const nameParts = (session.name ?? '').split(/\s+/).filter(Boolean);
  const role = roleForAccountType(getAccountType() ?? session.accountType);
  const permissions = ROLE_PERMISSIONS[role] ?? [];
  return {
    id: session.id,
    username: session.username ?? session.email.split("@")[0],
    email: session.email,
    firstName: nameParts[0] ?? "",
    lastName: nameParts.slice(1).join(" "),
    accountType: getAccountType() ?? session.accountType ?? "",
    sessionId: session.sessionId ?? null,
    company: "",
    accountStatus: "Active",
    roles: [role],
    permissions,
    emailNotificationEnabled: true,
  };
}

/**
 * True when the current user may access the System Setup / administration area.
 */
export function canAccessSystemSetup(): boolean {
  return getCurrentUser()?.permissions.includes("VIEW_SYSTEM_SETUP") ?? false;
}
