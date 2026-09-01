import axios from "axios";

import { getAccessToken } from "@/shared/utils/auth";

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? "");

const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** True when the backend endpoint isn't implemented yet (offline/404/405). */
function isBackendUnavailable(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return !error.response || error.response.status === 404 || error.response.status === 405;
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
  sdkVersion: string;
  companyName: string;
  licenseType: "ACTIVE" | "EXPIRED" | "EXPIRING";
  userLimit: number;
  licenseExpiry: string;
  ssoEnabled: boolean;
  restApiAuthenticationType: string;
};

export type UserStatus = "Active" | "Inactive" | "Locked";
export type AccountTypeOption = "User" | "Reviewer" | "Administrator" | "Tenant Admin";

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
  date: string;
  user: string;
  action: AuditAction;
  module: string;
  description: string;
  ipAddress: string;
  status: "Success" | "Failed" | "Warning";
};

export type AuditLogFilters = {
  user?: string;
  module?: string;
  action?: AuditAction;
  status?: AuditLog["status"];
  search?: string;
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
  applicationVersion: "4.2.0",
  sdkVersion: "5.13.0",
  companyName: "Viatris",
  licenseType: "ACTIVE",
  userLimit: 20,
  licenseExpiry: "2026-10-15",
  ssoEnabled: false,
  restApiAuthenticationType: "TOKEN",
};

const MOCK_USERS: User[] = [
  { id: "u1", username: "tejaswini.vangimalla", email: "tejaswini.vangimalla@viatris.com", firstName: "Tejaswini", lastName: "Vangimalla", accountType: "Tenant Admin", accountStatus: "Active", company: "Viatris", lastLogin: "2026-08-30T09:12:00Z", passwordExpiry: "2026-10-19T06:20:52Z", createdAt: "2026-07-17T09:22:29Z", emailNotificationEnabled: true },
  { id: "u2", username: "admin", email: "admin@example.com", firstName: "System", lastName: "Administrator", accountType: "Administrator", accountStatus: "Active", company: "Viatris", lastLogin: "2026-08-31T14:05:00Z", passwordExpiry: "2026-11-01T00:00:00Z", createdAt: "2026-06-01T08:00:00Z", emailNotificationEnabled: false },
  { id: "u3", username: "ravi.kumar", email: "ravi.kumar@viatris.com", firstName: "Ravi", lastName: "Kumar", accountType: "Reviewer", accountStatus: "Active", company: "Viatris", lastLogin: "2026-08-29T11:40:00Z", passwordExpiry: "2026-09-30T00:00:00Z", createdAt: "2026-07-02T10:15:00Z", emailNotificationEnabled: true },
  { id: "u4", username: "priya.sharma", email: "priya.sharma@viatris.com", firstName: "Priya", lastName: "Sharma", accountType: "User", accountStatus: "Inactive", company: "Viatris", lastLogin: "2026-08-10T16:22:00Z", passwordExpiry: "2026-10-05T00:00:00Z", createdAt: "2026-07-20T12:00:00Z", emailNotificationEnabled: false },
];

const MOCK_SESSIONS: LoggedInUser[] = [
  { id: "s1", user: "Tejaswini Vangimalla", email: "tejaswini.vangimalla@viatris.com", loginTime: "2026-09-01T08:30:00Z", lastActivity: "2026-09-01T09:45:00Z", ipAddress: "10.20.30.41", browser: "Chrome 128", operatingSystem: "Windows 11", sessionStatus: "Active" },
  { id: "s2", user: "Ravi Kumar", email: "ravi.kumar@viatris.com", loginTime: "2026-09-01T07:55:00Z", lastActivity: "2026-09-01T09:10:00Z", ipAddress: "10.20.30.52", browser: "Edge 127", operatingSystem: "Windows 10", sessionStatus: "Idle" },
];

const MOCK_LOGS: AuditLog[] = [
  { id: "a1", date: "2026-09-01T09:40:12Z", user: "tejaswini.vangimalla", action: "LOGIN", module: "Authentication", description: "User logged in successfully", ipAddress: "10.20.30.41", status: "Success" },
  { id: "a2", date: "2026-08-31T15:02:44Z", user: "admin", action: "CREATE_USER", module: "User Management", description: "Created user priya.sharma@viatris.com", ipAddress: "10.20.30.18", status: "Success" },
  { id: "a3", date: "2026-08-31T14:55:03Z", user: "admin", action: "RESET_PASSWORD", module: "User Management", description: "Reset password for ravi.kumar@viatris.com", ipAddress: "10.20.30.18", status: "Success" },
  { id: "a4", date: "2026-08-30T11:20:37Z", user: "ravi.kumar", action: "START_INSPECTION", module: "Text Inspection", description: "Started text inspection for master.pdf vs sample.pdf", ipAddress: "10.20.30.52", status: "Success" },
  { id: "a5", date: "2026-08-30T11:26:09Z", user: "ravi.kumar", action: "DOWNLOAD_REPORT", module: "Text Inspection", description: "Downloaded PDF inspection report", ipAddress: "10.20.30.52", status: "Success" },
  { id: "a6", date: "2026-08-29T17:44:51Z", user: "unknown", action: "LOGIN", module: "Authentication", description: "Failed login attempt (invalid password)", ipAddress: "192.168.5.7", status: "Failed" },
  { id: "a7", date: "2026-08-29T10:05:20Z", user: "tejaswini.vangimalla", action: "CHANGE_SETTINGS", module: "System Setup", description: "Modified inspection severity levels", ipAddress: "10.20.30.41", status: "Success" },
  { id: "a8", date: "2026-08-28T09:12:33Z", user: "admin", action: "GENERATE_API_TOKEN", module: "REST API", description: "Generated REST API token 'ci-integration'", ipAddress: "10.20.30.18", status: "Success" },
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

let mockUsers = [...MOCK_USERS];
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

export async function getUsers(): Promise<User[]> {
  try {
    const res = await api.get<User[]>("/api/users");
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
      return [...mockUsers];
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function getUser(id: string): Promise<User> {
  try {
    const res = await api.get<User>(`/api/users/${id}`);
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const found = mockUsers.find((u) => u.id === id);
      if (found) return found;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function createUser(data: CreateUserData): Promise<User> {
  try {
    const res = await api.post<User>("/api/users", data);
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      if (mockUsers.some((u) => u.username.toLowerCase() === data.username.toLowerCase())) {
        throw makeApiError(new Error(`Username "${data.username}" already exists.`), `Username "${data.username}" already exists.`);
      }
      const user: User = {
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
      return user;
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function updateUser(id: string, data: UpdateUserData): Promise<User> {
  try {
    const res = await api.put<User>(`/api/users/${id}`, data);
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      const index = mockUsers.findIndex((u) => u.id === id);
      if (index === -1) throw makeApiError(new Error("User not found."), "User not found.");
      mockUsers[index] = { ...mockUsers[index], ...data };
      return mockUsers[index];
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function deleteUser(id: string): Promise<void> {
  try {
    await api.delete(`/api/users/${id}`);
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
    await api.patch(`/api/users/${id}/disable`);
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
    await api.patch(`/api/users/${id}/enable`);
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

export async function getLoggedInUsers(): Promise<LoggedInUser[]> {
  try {
    const res = await api.get<LoggedInUser[]>("/api/sessions");
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
      return [...MOCK_SESSIONS];
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

export async function getAuditLogs(filters?: AuditLogFilters): Promise<AuditLog[]> {
  try {
    const res = await api.get<AuditLog[]>("/api/audit-logs", { params: filters });
    return res.data;
  } catch (error) {
    if (isBackendUnavailable(error)) {
      await delay(200);
      return [...MOCK_LOGS];
    }
    throw new Error(getErrorMessage(error));
  }
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


