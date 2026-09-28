/* eslint-disable preserve-caught-error -- mock API layer intentionally replaces network errors with user-facing messages */
import axios from "axios";

import {
  createResource,
  deleteResource,
  getResource,
  listResources,
  updateResource,
} from "@/shared/api/backendCrudApi";
import { getAccessToken, getSession } from "@/shared/utils/auth";

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? "");

const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Authenticated identity + current session id for admin/session endpoints.
  // The backend resolves the accountType from its own database — these headers
  // identify WHO is calling, they never grant permissions by themselves.
  const session = getSession();
  if (session?.email) {
    config.headers["X-User-Email"] = session.email;
  }
  if (session?.sessionId) {
    config.headers["X-Session-Id"] = session.sessionId;
  }
  return config;
});

/**
 * True when the real admin backend doesn't serve the endpoint yet, so the
 * UI should fall back to its in-memory mock data. Only a genuine network
 * failure (no response) or a "not implemented / gateway" status (404, 405,
 * 501-504) means the backend is unreachable. Real HTTP errors such as a 400
 * validation error or a 403 authorization error indicate the backend IS
 * running and returned a meaningful response — those must be surfaced to the
 * user, never masked by mock data.
 */
function isBackendUnavailable(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return (
      !error.response ||
      error.response.status === 404 ||
      error.response.status === 405 ||
      error.response.status === 501 ||
      error.response.status === 502 ||
      error.response.status === 503 ||
      error.response.status === 504
    );
  }
  return false;
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string; message?: string } | undefined;
    return data?.error ?? data?.message ?? "Request failed. Please try again.";
  }
  return error instanceof Error ? error.message : "Request failed. Please try again.";
}

function makeApiError(error: unknown, message?: string): Error {
  return new Error(message ?? getErrorMessage(error), {
    cause: error instanceof Error ? error : new Error(String(error ?? "Unknown error")),
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------ Types ------------------------------ */

export type SystemInformation = {
  applicationVersion: string;
  companyName: string;
  licenseType: string;
  numberOfUsers: number;
  ssoEnabled: boolean;
  restApiAuthenticationType: string;
};

export type UserStatus = "Active" | "Inactive" | "Locked";
export type AccountTypeOption = "user" | "Administrator";

export type User = {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  accountType: AccountTypeOption;
  accountStatus: UserStatus;
  company: string;
  lastLogin?: string | null;
  passwordExpiry?: string | null;
  createdAt: string;
  emailNotificationEnabled: boolean;
  /** Email verification status — single source of truth is the backend
   *  `email_verified` field. Missing field (legacy users) = Unverified. */
  emailVerified?: boolean;
};

export type CreateUserData = {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  accountType: AccountTypeOption;
  company?: string;
  accountStatus: UserStatus;
  password: string;
  confirmPassword: string;
  emailNotificationEnabled?: boolean;
};

export type UpdateUserData = {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  accountType: AccountTypeOption;
  company?: string;
  accountStatus: UserStatus;
  emailNotificationEnabled?: boolean;
};

export type LoggedInUser = {
  id: string;
  user: string;
  email: string;
  accountType: string;
  sessionId?: string | null;
  loginTime: string;
  lastActivity: string;
  ipAddress: string;
  browser: string;
  operatingSystem: string;
  sessionStatus: "Active" | "Idle" | "Expired";
};

export type AuditAction =
  | "LOGIN" | "LOGOUT" | "CREATE_USER" | "UPDATE_USER" | "DELETE_USER"
  | "DISABLE_USER" | "ENABLE_USER" | "RESET_PASSWORD" | "GENERATE_API_TOKEN"
  | "START_INSPECTION" | "COMPLETE_INSPECTION" | "DOWNLOAD_REPORT"
  | "UPDATE_PROFILE" | "CHANGE_SETTINGS";

export type AuditLog = {
  id: string;
  userId: string;
  email: string;
  accountType: string;
  timestamp: string;
  event: string;
  action: string;
  application: string;
  module: string;
  status: string;
  description?: string;
  entityType?: string;
  entityId?: string;
  inspectionId?: string;
  fileId?: string;
  fileName?: string;
  masterFileName?: string;
  sampleFileName?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  changes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type AuditLogFilters = {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  userId?: string;
  accountType?: string;
  event?: string;
  module?: string;
  status?: string;
  inspectionId?: string;
  search?: string;
};

export type AuditLogResponse = {
  items: AuditLog[];
  page: number;
  limit: number;
  total: number;
};

export type InspectionLevel = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  displayOrder: number;
};

export type InspectionComment = {
  id: string;
  comment: string;
  description: string;
  active: boolean;
};

export type SetupLevels = {
  default1: string;
  default2: string;
  custom1: string;
  custom2: string;
  custom3: string;
  custom4: string;
  custom5: string;
};

export type SetupComments = {
  default1: string;
  custom1: string;
  custom2: string;
  custom3: string;
  custom4: string;
  custom5: string;
  custom6: string;
  custom7: string;
  custom8: string;
  custom9: string;
  custom10: string;
};

export type SetupLevelsComments = {
  id: string;
  type: string;
  levels: SetupLevels;
  comments: SetupComments;
  version: number;
  updatedAt: string;
  updatedBy: string;
};

export type DifferenceComment = {
  id: string;
  inspectionId: string;
  differenceId: number;
  configuredComment: string;
  userComment: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type DictionaryEntry = {
  id: string;
  word: string;
  language: string;
  description?: string | null;
  status: "Active" | "Inactive";
};

export type ProfileType = "text" | "graphics" | "barcode";

export type InspectionProfile = {
  id: string;
  name: string;
  description: string;
  status: "Active" | "Inactive";
  createdBy: string;
  createdAt: string;
  modifiedBy?: string | null;
  modifiedAt?: string | null;
};

/* ------------------------ Mock data (backend fallback) ------------------------ */

const MOCK_INFO: SystemInformation = {
  applicationVersion: "1.0.0",
  companyName: "Viatris",
  licenseType: "INTERNAL",
  numberOfUsers: 0,
  ssoEnabled: false,
  restApiAuthenticationType: "TOKEN",
};

const MOCK_USERS: User[] = [
  { id: "u1", username: "tejaswini.vangimalla", email: "tejaswini.vangimalla@viatris.com", firstName: "Tejaswini", lastName: "Vangimalla", accountType: "Administrator", accountStatus: "Active", company: "Viatris", lastLogin: "2026-08-30T09:12:00Z", passwordExpiry: "2026-10-19T06:20:52Z", createdAt: "2026-07-17T09:22:29Z", emailNotificationEnabled: true, emailVerified: true },
  { id: "u2", username: "admin", email: "admin@viatris.com", firstName: "Admin", lastName: "User", accountType: "Administrator", accountStatus: "Active", company: "Viatris", lastLogin: "2026-08-31T14:05:00Z", passwordExpiry: "2026-11-01T00:00:00Z", createdAt: "2026-06-01T08:00:00Z", emailNotificationEnabled: false, emailVerified: true },
  { id: "u3", username: "ravi.kumar", email: "ravi.kumar@viatris.com", firstName: "Ravi", lastName: "Kumar", accountType: "user", accountStatus: "Active", company: "Viatris", lastLogin: "2026-08-29T11:40:00Z", passwordExpiry: "2026-09-30T00:00:00Z", createdAt: "2026-07-02T10:15:00Z", emailNotificationEnabled: true, emailVerified: false },
  { id: "u4", username: "priya.sharma", email: "priya.sharma@viatris.com", firstName: "Priya", lastName: "Sharma", accountType: "user", accountStatus: "Inactive", company: "Viatris", lastLogin: "2026-08-10T16:22:00Z", passwordExpiry: "2026-10-05T00:00:00Z", createdAt: "2026-07-20T12:00:00Z", emailNotificationEnabled: false, emailVerified: false },
  { id: "u5", username: "yashwanth.kumar", email: "YashwanthKumar.k@viatris.com", firstName: "Yashwanth Kumar", lastName: "K", accountType: "user", accountStatus: "Active", company: "Viatris", lastLogin: null, passwordExpiry: "2026-12-02T00:00:00Z", createdAt: "2026-09-08T12:51:31Z", emailNotificationEnabled: true, emailVerified: false },
];

const MOCK_LOGS: AuditLog[] = [
  {
    id: "a1",
    userId: "u1",
    email: "tejaswini.vangimalla@viatris.com",
    accountType: "Administrator",
    timestamp: "2026-09-01T09:40:12Z",
    event: "LOGIN_SUCCESS",
    action: "Login",
    application: "MIT",
    module: "Authentication",
    description: "Successful login.",
    ipAddress: "10.20.30.41",
    status: "Success",
  },
  {
    id: "a9",
    userId: "u5",
    email: "admin@viatris.com",
    accountType: "Administrator",
    timestamp: "2026-09-08T12:51:31Z",
    event: "USER_CREATED",
    action: "Create User",
    application: "MIT",
    module: "User Management",
    description: "User created. Email=YashwanthKumar.k@viatris.com; Account Type=user",
    ipAddress: "127.0.0.1",
    status: "Success",
  },
  {
    id: "a2",
    userId: "u2",
    email: "admin@viatris.com",
    accountType: "Administrator",
    timestamp: "2026-08-31T15:02:44Z",
    event: "USER_CREATED",
    action: "Create User",
    application: "MIT",
    module: "User Management",
    description: "Created user priya.sharma@viatris.com",
    ipAddress: "10.20.30.18",
    status: "Success",
  },
  {
    id: "a3",
    userId: "u2",
    email: "admin@viatris.com",
    accountType: "Administrator",
    timestamp: "2026-08-31T14:55:03Z",
    event: "RESET_PASSWORD",
    action: "Reset Password",
    application: "MIT",
    module: "User Management",
    description: "Reset password for ravi.kumar@viatris.com",
    ipAddress: "10.20.30.18",
    status: "Success",
  },
  {
    id: "a4",
    userId: "u3",
    email: "ravi.kumar@viatris.com",
    accountType: "user",
    timestamp: "2026-08-30T11:20:37Z",
    event: "START_INSPECTION",
    action: "Start Inspection",
    application: "MIT",
    module: "Text Inspection",
    description: "Started text inspection for master.pdf vs sample.pdf",
    ipAddress: "10.20.30.52",
    status: "Success",
  },
  {
    id: "a5",
    userId: "u3",
    email: "ravi.kumar@viatris.com",
    accountType: "user",
    timestamp: "2026-08-30T11:26:09Z",
    event: "DOWNLOAD_REPORT",
    action: "Download Report",
    application: "MIT",
    module: "Text Inspection",
    description: "Downloaded PDF inspection report",
    ipAddress: "10.20.30.52",
    status: "Success",
  },
  {
    id: "a6",
    userId: "unknown",
    email: "unknown@viatris.com",
    accountType: "user",
    timestamp: "2026-08-29T17:44:51Z",
    event: "LOGIN_FAILED",
    action: "Login",
    application: "MIT",
    module: "Authentication",
    description: "Failed login attempt (invalid password)",
    ipAddress: "192.168.5.7",
    status: "Failed",
  },
  {
    id: "a7",
    userId: "u1",
    email: "tejaswini.vangimalla@viatris.com",
    accountType: "Administrator",
    timestamp: "2026-08-29T10:05:20Z",
    event: "CHANGE_SETTINGS",
    action: "Change Settings",
    application: "MIT",
    module: "System Setup",
    description: "Modified inspection severity levels",
    ipAddress: "10.20.30.41",
    status: "Success",
  },
  {
    id: "a8",
    userId: "u2",
    email: "admin@viatris.com",
    accountType: "Administrator",
    timestamp: "2026-08-28T09:12:33Z",
    event: "GENERATE_API_TOKEN",
    action: "Generate API Token",
    application: "MIT",
    module: "REST API",
    description: "Generated REST API token 'ci-integration'",
    ipAddress: "10.20.30.18",
    status: "Success",
  },
];

const MOCK_LEVELS: InspectionLevel[] = ["None", "Ignore All", "Critical", "Major", "Minor", "Not a Defect", "Pass"].map((name, i) => ({
  id: `lv${i + 1}`,
  name,
  description: "",
  active: true,
  displayOrder: i + 1,
}));

const MOCK_COMMENTS: InspectionComment[] = [
  { id: "c1", comment: "Approved artwork variation", description: "Accepted difference per approved artwork", active: true },
  { id: "c2", comment: "Print tolerance", description: "Within acceptable print tolerance", active: true },
];

const MOCK_DICTIONARY: DictionaryEntry[] = [
  { id: "d1", word: "Viatris", language: "English", description: "Company name", status: "Active" },
  { id: "d2", word: "atorvastatin", language: "English", description: "Drug name", status: "Active" },
];

const MOCK_PROFILES: Record<ProfileType, InspectionProfile[]> = {
  text: [
    { id: "p1", name: "Default Text Profile", description: "Standard text inspection settings", status: "Active", createdBy: "admin", createdAt: "2026-07-01T09:00:00Z", modifiedBy: "admin", modifiedAt: "2026-08-15T10:30:00Z" },
  ],
  graphics: [],
  barcode: [],
};

/* Fallback mock users used ONLY when the backend is completely unavailable.
   In normal operation, users are stored in and fetched from Cosmos DB via the backend API. */
let mockUsers: User[] = [...MOCK_USERS];
let mockAuditLogs: AuditLog[] = [...MOCK_LOGS];
const mockLevels = [...MOCK_LEVELS];
const mockComments = [...MOCK_COMMENTS];
const mockDictionary = [...MOCK_DICTIONARY];
const mockProfiles: Record<ProfileType, InspectionProfile[]> = {
  text: [...MOCK_PROFILES.text],
  graphics: [],
  barcode: [],
};

const uid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------ Service functions ------------------------------ */

/* ---------- System Information ---------- */

export async function getSystemInformation(): Promise<SystemInformation> {
  try {
    const res = await api.get<SystemInformation>("/api/settings/system-information");
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
      return MOCK_INFO;
    }
    throw new Error(getErrorMessage(error));
  }
}

/* ---------- Users ---------- */

export async function downloadAdminList(path: "/api/users/export" | "/api/sessions/export", format: "pdf" | "xlsx", filename: string): Promise<void> {
  const response = await api.get<Blob>(path, { params: { format }, responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function getUsers(): Promise<User[]> {
  try {
    // Fetch users from Cosmos DB via the backend API
    const backendUsers = await listResources<User>("users");
    if (backendUsers.length > 0) {
      return backendUsers;
    }
    // Backend returned empty list — fall back to mock users
    return [...mockUsers];
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
      // Backend unavailable -> return fallback mock users
      return [...mockUsers];
    }
    throw new Error(getErrorMessage(error));
  }
}

/**
 * Records a login event for the user with the given email.
 * The backend /api/auth/login endpoint already updates lastLogin in Cosmos DB,
 * so this function is a no-op for Cosmos DB updates. It only updates the
 * in-memory mock users array (fallback for offline mode) so that the UI stays
 * consistent without making a redundant and potentially destructive API call.
 */
export async function recordUserLogin(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date().toISOString();

  // Update in-memory mock users array (fallback for offline mode)
  const userIndex = mockUsers.findIndex((u) => u.email.trim().toLowerCase() === normalizedEmail);
  if (userIndex !== -1) {
    mockUsers[userIndex] = { ...mockUsers[userIndex], lastLogin: now };
  }
}

export async function getUser(id: string): Promise<User> {
  try {
    return await getResource<User>("users", id);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const found = mockUsers.find((u) => u.id === id);
      if (found) return found;
    }
    throw new Error(getErrorMessage(error));
  }
}

/**
 * Add an audit log entry to the mock audit logs (fallback for offline mode).
 * The actor is always the currently authenticated admin (from session).
 */
function addMockAuditLog(entry: Partial<AuditLog>): void {
  const session = getSession();
  const now = new Date().toISOString();
  const logEntry: AuditLog = {
    id: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: session?.id ? String(session.id) : "unknown",
    email: session?.email ?? "unknown@viatris.com",
    accountType: session?.accountType ?? "Administrator",
    timestamp: now,
    event: "USER_CREATED",
    action: "Create User",
    application: "MIT",
    module: "User Management",
    description: "User action recorded.",
    ipAddress: "127.0.0.1",
    status: "Success",
    ...entry,
  };
  mockAuditLogs = [logEntry, ...mockAuditLogs];
}

/**
 * Sends a verification email to the given user. Works for BOTH the admin
 * (User Management page, any user) and the logged-in user (Profile page,
 * own account) — the backend enforces admin-or-self authorization. This
 * NEVER marks the user verified; only clicking the emailed link does.
 */
export type SendVerificationResponse =
  | {
      status: "sent";
      message: string;
      email_verified: false;
      expiresAt: string;
    }
  | {
      status: "already_verified";
      message: string;
      email_verified: true;
    }
  | { error: string };

export async function sendVerificationEmail(
  userId: string
): Promise<SendVerificationResponse> {
  try {
    const { data } = await api.post<SendVerificationResponse>(
      `/api/users/${encodeURIComponent(userId)}/send-verification`
    );
    return data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      // Backend unavailable: update mock users in place
      const userIndex = mockUsers.findIndex((u) => u.id === userId);
      if (userIndex !== -1) {
        mockUsers[userIndex] = {
          ...mockUsers[userIndex],
          emailVerified: false,
        };
      }
      return {
        status: "sent",
        message: "Verification email sent (offline mode).",
        email_verified: false,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function createUser(data: CreateUserData): Promise<User> {
  // Email is the unique identifier for a user account — check for duplicates
  // (across both backend and locally-created users) BEFORE creating.
  let existing: User[];
  try {
    existing = await getUsers();
  } catch {
    existing = [...mockUsers];
  }
  if (existing.some((u) => u.email.trim().toLowerCase() === data.email.trim().toLowerCase())) {
    throw makeApiError(
      new Error(`Email "${data.email}" already registered.`),
      `Email "${data.email}" already registered.`
    );
  }

  const payload = {
    ...data,
    createdAt: new Date().toISOString(),
    emailNotificationEnabled: data.emailNotificationEnabled ?? true,
  };

  let user: User;
  try {
    user = await createResource<User>("users", payload);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      user = {
        id: uid(),
        username: data.username,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        accountType: data.accountType,
        accountStatus: data.accountStatus,
        company: data.company || "Viatris",
        lastLogin: null,
        passwordExpiry: null,
        createdAt: new Date().toISOString(),
        emailNotificationEnabled: data.emailNotificationEnabled ?? true,
      };
            mockUsers = [user, ...mockUsers];
      addMockAuditLog({
        event: "USER_CREATED",
        action: "Create User",
        module: "User Management",
        description: `User created. Email=${data.email}; Account Type=${data.accountType}`,
        entityType: "User",
        entityId: user.id,
        status: "Success",
        metadata: {
          newUserEmail: data.email,
          newAccountType: data.accountType,
          newAccountStatus: data.accountStatus,
          createdUserId: user.id,
        },
      });
    } else {
      throw new Error(getErrorMessage(error));
    }
  }

  return user;
}

export async function updateUser(id: string, data: UpdateUserData): Promise<User> {
  let updated: User;
  let originalUser: User | undefined;

  // Capture original user for change tracking (mock fallback)
  const mockUserIndex = mockUsers.findIndex((u) => u.id === id);
  if (mockUserIndex !== -1) {
    originalUser = { ...mockUsers[mockUserIndex] };
  }

  try {
    updated = await updateResource<User>("users", id, data);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      if (mockUserIndex === -1)
        throw makeApiError(
          new Error("Backend unavailable and this user is not in the local cache. Unable to update."),
          "Backend unavailable. Unable to update this user."
        );
      mockUsers[mockUserIndex] = { ...mockUsers[mockUserIndex], ...data };
      updated = mockUsers[mockUserIndex];
    } else {
      throw new Error(getErrorMessage(error));
    }
  }

  // Keep the in-memory mock users array in sync for fallback mode
  const key = updated.email.trim().toLowerCase();
  const mockIndex = mockUsers.findIndex((u) => u.email.trim().toLowerCase() === key);
  if (mockIndex !== -1) {
    mockUsers[mockIndex] = { ...mockUsers[mockIndex], ...data, id: mockUsers[mockIndex].id };
    updated = mockUsers[mockIndex];
  }

  // Add audit log entries for mock/fallback mode
  if (originalUser && data.accountType && originalUser.accountType !== data.accountType) {
    addMockAuditLog({
      event: "ACCOUNT_TYPE_CHANGED",
      action: "Change Account Type",
      module: "User Management",
      description: `Account type changed from ${originalUser.accountType} to ${data.accountType}. User=${updated.email}`,
      entityType: "User",
      entityId: id,
      status: "Success",
      metadata: {
        previousAccountType: originalUser.accountType,
        newAccountType: data.accountType,
        affectedUserEmail: updated.email,
      },
    });
  } else if (originalUser) {
    addMockAuditLog({
      event: "USER_UPDATED",
      action: "Update User",
      module: "User Management",
      description: `User updated. Email=${updated.email}`,
      entityType: "User",
      entityId: id,
      status: "Success",
    });
  }

  return updated;
}


export async function deleteUser(id: string): Promise<void> {
  try {
    await deleteResource("users", id);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      mockUsers = mockUsers.filter((u) => u.id !== id);
      return;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function disableUser(id: string): Promise<void> {
  try {
    await updateResource<User>("users", id, { accountStatus: "Inactive" });
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const index = mockUsers.findIndex((u) => u.id === id);
      if (index !== -1) {
        mockUsers[index] = { ...mockUsers[index], accountStatus: "Inactive" };
      }
      return;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function enableUser(id: string): Promise<void> {
  try {
    await updateResource<User>("users", id, { accountStatus: "Active" });
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const index = mockUsers.findIndex((u) => u.id === id);
      if (index !== -1) {
        mockUsers[index] = { ...mockUsers[index], accountStatus: "Active" };
      }
      return;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function resetUserPassword(id: string): Promise<void> {
  try {
    await api.post(`/api/users/${id}/reset-password`);
  } catch (error) {
    if (isBackendUnavailable(error)) return;
    throw new Error(getErrorMessage(error));
  }
}

export async function generateRestApiToken(id: string): Promise<string> {
  try {
    const res = await api.post<{ token: string }>(`/api/users/${id}/api-tokens`);
    return res.data.token;
  } catch (error) {
    if (isBackendUnavailable(error)) return `mit_${uid()}${uid()}`;
    throw new Error(getErrorMessage(error));
  }
}

/* ---------- Logged-in users / sessions ---------- */

/** Builds a session entry for the currently authenticated session (fallback). */
function currentUserSession(): LoggedInUser | null {
  const session = getSession();
  if (!session) return null;

  const sessionId = session.sessionId ?? null;
  // A reachable backend supplies the authenticated session id. If the local
  // session predates sessionId (no active login restoring it), fall back to a
  // deterministic value so the current session can still be identified.
  const id = sessionId ?? `sess_${String(session.id)}`;

  // Best-effort device info for the offline fallback only — the real values
  // (IP/browser/OS) come from the backend session registry when reachable.
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Unknown Browser";
  const operatingSystem = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";

  return {
    id,
    user: session.name || session.email,
    email: session.email,
    accountType: session.accountType ?? "user",
    sessionId,
    loginTime: session.loginTime ?? new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    ipAddress: "—",
    browser,
    operatingSystem,
    sessionStatus: "Active",
  };
}

export async function getLoggedInUsers(): Promise<LoggedInUser[]> {
  try {
    const res = await api.get<LoggedInUser[]>("/api/sessions");
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
      // Backend unavailable -> report only the currently authenticated session. No
      // fabricated/hardcoded sessions (e.g. mock users) are ever added. A real
      // backend (/api/auth/me + /api/sessions) is the single source of truth.



      const current = currentUserSession();
      return current ? [current] : [];
    }
    throw new Error(getErrorMessage(error));
  }
}
export async function terminateSession(id: string): Promise<void> {
  try {
    await api.delete(`/api/sessions/${id}`);
  } catch (error) {
    if (isBackendUnavailable(error)) return;
    throw new Error(getErrorMessage(error));
  }
}

/* ---------- Audit trail ---------- */

export async function getAuditLogs(filters?: AuditLogFilters): Promise<AuditLogResponse> {
  try {
    const res = await api.get<AuditLogResponse>("/api/audit-logs", { params: filters });
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
            // Return paginated mock data as fallback
      const mockItems = [...mockAuditLogs] as unknown as AuditLog[];
      return {
        items: mockItems,
        page: 1,
        limit: mockItems.length,
        total: mockItems.length,
      };
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function downloadAuditLogs(filters: AuditLogFilters, format: "pdf" | "xlsx"): Promise<void> {
  try {
    const response = await api.get<Blob>("/api/audit-logs/export", {
      params: { ...filters, page: undefined, limit: undefined, format },
      responseType: "blob",
    });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit_trail.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
      try {
        const payload = JSON.parse(await error.response.data.text()) as { error?: string; message?: string };
        throw new Error(payload.error ?? payload.message ?? "PDF export failed. Please try again.");
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message !== "Unexpected end of JSON input") throw parseError;
        throw new Error("PDF export failed. Please try again.");
      }
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function getAuditLogById(id: string): Promise<AuditLog> {
  try {
    const res = await api.get<AuditLog>(`/api/audit-logs/${id}`);
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
            const found = mockAuditLogs.find((log) => log.id === id);
      if (found) return found as unknown as AuditLog;
      throw new Error("Audit log not found.");
    }
    throw new Error(getErrorMessage(error));
  }
}

/** Payload for recording a frontend-initiated activity in the audit trail. */
export type ClientAuditEvent = {
  /** One of the event names allowed by the backend audit endpoint. */
  event: string;
  /** Human-readable action verb, e.g. "Select Level". */
  action: string;
  /** Module name the event belongs to, e.g. "Text Inspection". */
  module: string;
  description?: string;
  inspectionId?: string;
  differenceId?: number;
  metadata?: Record<string, unknown>;
};

/**
 * Record a frontend-initiated activity event (level/comment selection,
 * report download, difference list view, ...) in the audit trail.
 *
 * The backend derives the authenticated identity from the request context,
 * so this is fire-and-forget from the UI's perspective: an audit failure
 * must never block the user's action.
 */
export async function logAuditEvent(payload: ClientAuditEvent): Promise<void> {
  try {
    await api.post("/api/audit/events", payload);
  } catch (error) {
    // Audit is best-effort — never surface errors to the user, never block.
    console.warn("[AUDIT] Failed to record client audit event:", getErrorMessage(error));
  }
}

/* ---------- Setup Levels and Comments ---------- */

const DEFAULT_SETUP_LEVELS_COMMENTS: SetupLevelsComments = {
  id: "setup-levels-comments",
  type: "setup-levels-comments",
  levels: {
    default1: "None",
    default2: "Ignore All",
    custom1: "Critical",
    custom2: "Major",
    custom3: "Minor",
    custom4: "Not a Defect",
    custom5: "Fail",
  },
  comments: {
    default1: "Reviewed",
    custom1: "Approved",
    custom2: "To be verified",
    custom3: "None",
    custom4: "Comment1",
    custom5: "Comment2",
    custom6: "Comment3",
    custom7: "Comment 4",
    custom8: "",
    custom9: "",
    custom10: "",
  },
  version: 1,
  updatedAt: "",
  updatedBy: "system",
};

let mockSetupLevelsComments: SetupLevelsComments = {
  ...DEFAULT_SETUP_LEVELS_COMMENTS,
  levels: { ...DEFAULT_SETUP_LEVELS_COMMENTS.levels },
  comments: { ...DEFAULT_SETUP_LEVELS_COMMENTS.comments },
};

export async function getSetupLevelsComments(): Promise<SetupLevelsComments> {
  try {
    const res = await api.get<SetupLevelsComments>("/api/setup/levels-comments");
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
      return { ...mockSetupLevelsComments, levels: { ...mockSetupLevelsComments.levels }, comments: { ...mockSetupLevelsComments.comments } };
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function updateSetupLevelsComments(
  data: Pick<SetupLevelsComments, "levels" | "comments">
): Promise<SetupLevelsComments> {
  try {
    const res = await api.put<SetupLevelsComments>("/api/setup/levels-comments", data);
    mockSetupLevelsComments = { ...res.data, levels: { ...res.data.levels }, comments: { ...res.data.comments } };
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      mockSetupLevelsComments = {
        ...mockSetupLevelsComments,
        levels: { ...mockSetupLevelsComments.levels, ...data.levels },
        comments: { ...mockSetupLevelsComments.comments, ...data.comments },
        version: (mockSetupLevelsComments.version || 1) + 1,
      };
      return { ...mockSetupLevelsComments };
    }
    throw new Error(getErrorMessage(error));
  }
}

/* ---------- Difference comments (persisted per inspection) ---------- */

export async function getInspectionDifferenceComments(
  inspectionId: string
): Promise<DifferenceComment[]> {
  try {
    const res = await api.get<DifferenceComment[]>(
      `/api/inspections/${encodeURIComponent(inspectionId)}/comments`
    );
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) return [];
    throw new Error(getErrorMessage(error));
  }
}

export async function updateInspectionDifferenceComment(
  inspectionId: string,
  differenceId: number,
  payload: { configuredComment: string; userComment: string }
): Promise<DifferenceComment> {
  const res = await api.put<DifferenceComment>(
    `/api/inspections/${encodeURIComponent(inspectionId)}/differences/${differenceId}/comment`,
    payload
  );
  return res.data;
}

/* ---------- Levels ---------- */

export async function getLevels(): Promise<InspectionLevel[]> {
  try {
    const res = await api.get<InspectionLevel[]>("/api/settings/levels");
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
      return [...mockLevels];
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function createLevel(data: Omit<InspectionLevel, "id">): Promise<InspectionLevel> {
  try {
    const res = await api.post<InspectionLevel>("/api/settings/levels", data);
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const level = { ...data, id: uid() };
      mockLevels.push(level);
      return level;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function updateLevel(id: string, data: Partial<Omit<InspectionLevel, "id">>): Promise<void> {
  try {
    await api.put(`/api/settings/levels/${id}`, data);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const index = mockLevels.findIndex((l) => l.id === id);
      if (index !== -1) mockLevels[index] = { ...mockLevels[index], ...data };
      return;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function deleteLevel(id: string): Promise<void> {
  try {
    await api.delete(`/api/settings/levels/${id}`);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const index = mockLevels.findIndex((l) => l.id === id);
      if (index !== -1) mockLevels.splice(index, 1);
      return;
    }
    throw new Error(getErrorMessage(error));
  }
}

/* ---------- Comments ---------- */

export async function getComments(): Promise<InspectionComment[]> {
  try {
    const res = await api.get<InspectionComment[]>("/api/settings/comments");
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
      return [...mockComments];
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function createComment(data: Omit<InspectionComment, "id">): Promise<InspectionComment> {
  try {
    const res = await api.post<InspectionComment>("/api/settings/comments", data);
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const comment = { ...data, id: uid() };
      mockComments.push(comment);
      return comment;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function updateComment(id: string, data: Partial<Omit<InspectionComment, "id">>): Promise<void> {
  try {
    await api.put(`/api/settings/comments/${id}`, data);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const index = mockComments.findIndex((c) => c.id === id);
      if (index !== -1) mockComments[index] = { ...mockComments[index], ...data };
      return;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function deleteComment(id: string): Promise<void> {
  try {
    await api.delete(`/api/settings/comments/${id}`);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const index = mockComments.findIndex((c) => c.id === id);
      if (index !== -1) mockComments.splice(index, 1);
      return;
    }
    throw new Error(getErrorMessage(error));
  }
}

/* ---------- User dictionary ---------- */

export async function getDictionary(): Promise<DictionaryEntry[]> {
  try {
    const res = await api.get<DictionaryEntry[]>("/api/settings/dictionary");
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
      return [...mockDictionary];
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function createDictionaryEntry(data: Omit<DictionaryEntry, "id">): Promise<DictionaryEntry> {
  try {
    const res = await api.post<DictionaryEntry>("/api/settings/dictionary", data);
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const entry = { ...data, id: uid() };
      mockDictionary.push(entry);
      return entry;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function updateDictionaryEntry(id: string, data: Partial<Omit<DictionaryEntry, "id">>): Promise<void> {
  try {
    await api.put(`/api/settings/dictionary/${id}`, data);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const index = mockDictionary.findIndex((d) => d.id === id);
      if (index !== -1) mockDictionary[index] = { ...mockDictionary[index], ...data };
      return;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function deleteDictionaryEntry(id: string): Promise<void> {
  try {
    await api.delete(`/api/settings/dictionary/${id}`);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const index = mockDictionary.findIndex((d) => d.id === id);
      if (index !== -1) mockDictionary.splice(index, 1);
      return;
    }
    throw new Error(getErrorMessage(error));
  }
}

/* ---------- Inspection profiles ---------- */

export async function getProfiles(type: ProfileType): Promise<InspectionProfile[]> {
  try {
    const res = await api.get<InspectionProfile[]>(`/api/settings/profiles/${type}`);
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
      return [...mockProfiles[type]];
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function createProfile(
  type: ProfileType,
  data: Pick<InspectionProfile, "name" | "description" | "status">
): Promise<InspectionProfile> {
  try {
    const res = await api.post<InspectionProfile>(`/api/settings/profiles/${type}`, data);
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const profile: InspectionProfile = {
        ...data,
        id: uid(),
        createdBy: "admin",
        createdAt: new Date().toISOString(),
        modifiedBy: null,
        modifiedAt: null,
      };
      mockProfiles[type] = [profile, ...mockProfiles[type]];
      return profile;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function updateProfile(
  type: ProfileType,
  id: string,
  data: Pick<InspectionProfile, "name" | "description" | "status">
): Promise<void> {
  try {
    await api.put(`/api/settings/profiles/${type}/${id}`, data);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const list = mockProfiles[type];
      const index = list.findIndex((p) => p.id === id);
      if (index !== -1)
        list[index] = { ...list[index], ...data, modifiedBy: "admin", modifiedAt: new Date().toISOString() };
      return;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function deleteProfile(type: ProfileType, id: string): Promise<void> {
  try {
    await api.delete(`/api/settings/profiles/${type}/${id}`);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      mockProfiles[type] = mockProfiles[type].filter((p) => p.id !== id);
      return;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function duplicateProfile(type: ProfileType, id: string): Promise<void> {
  try {
    await api.post(`/api/settings/profiles/${type}/${id}/duplicate`);
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const source = mockProfiles[type].find((p) => p.id === id);
      if (source) {
        mockProfiles[type] = [
          {
            ...source,
            id: uid(),
            name: `${source.name} (Copy)`,
            createdBy: "admin",
            createdAt: new Date().toISOString(),
          },
          ...mockProfiles[type],
        ];
      }
      return;
    }
    throw new Error(getErrorMessage(error));
  }
}


