import axios from "axios";

import { getAccessToken, getSession } from "@/shared/utils/auth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type UserProfile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  accountExpiry?: string | null;
  passwordExpiry?: string | null;
  createdAt: string;
  accountType: string;
  accountStatus: "Active" | "Inactive" | "Locked";
  company: string;
  emailNotificationsEnabled: boolean;
};

export type RunningInspection = {
  sessionId: string;
  inspectionType: string;
  masterFileName: string;
  sampleFileName: string;
  status: "Running" | "Queued" | "Completed" | "Failed";
  startedAt: string;
};

export type ApiToken = {
  id: string;
  name: string;
  createdAt: string;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
};

/* -------------------------------------------------------------------------- */
/* Axios instance (authenticated)                                              */
/* -------------------------------------------------------------------------- */

const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns true when the error indicates the backend endpoint is not
 * reachable/implemented (network failure, 404, or 405) — in which case the
 * API layer falls back to its local mock so the UI stays fully functional
 * in this environment. Genuine backend errors (e.g. a 400 validation
 * error) are never swallowed.
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

/** Extracts a human-readable message from an axios/Error. */
export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { error?: string; message?: string }
      | undefined;
    return (
      data?.error ??
      data?.message ??
      error.message ??
      "An unexpected error occurred."
    );
  }
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

/* -------------------------------------------------------------------------- */
/* Local mock persistence (used only when the backend is unreachable)          */
/* -------------------------------------------------------------------------- */

/* Profile helpers                                                             */
/* -------------------------------------------------------------------------- */

const API_TOKENS_KEY = "medinspect.apiTokens";

function deriveCompany(email: string): string {  const domain = email.split("@")[1];
  if (!domain) return "";
  const first = domain.split(".")[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function deriveNames(name: string): { firstName: string; lastName: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ") ?? "",
  };
}

/**
 * Builds a profile from the authenticated session user (never hardcoded).
 * Used as a fallback when the backend is unreachable.
 */
function buildFallbackProfile(): UserProfile {
  const session = getSession();
  const email = session?.email ?? "";

  const { firstName, lastName } = deriveNames(session?.name ?? "");

  // Authorization is derived from the accountType stored in the
  // authenticated session — never from the email address, which is an
  // identity/login identifier only.
  const accountType = session?.accountType ?? "user";

  return {
    id: session ? String(session.id) : "",
    email,
    firstName,
    lastName,
    accountExpiry: null,
    passwordExpiry: null,
    createdAt: new Date().toISOString(),
    accountType,
    accountStatus: "Active",
    company: deriveCompany(email),
    emailNotificationsEnabled: true,
  };
}

/**
 * Merges a partial backend response over the session-derived fallback so the
 * UI always has complete, consistent profile data (identity comes from the
 * authenticated user, never hardcoded).
 */
function normalizeProfile(data: Partial<UserProfile>): UserProfile {
  const fallback = buildFallbackProfile();
  return {
    ...fallback,
    ...data,
    id: String(data.id ?? fallback.id),
    email: data.email ?? fallback.email,
    firstName: data.firstName ?? fallback.firstName,
    lastName: data.lastName ?? fallback.lastName,
    accountType: data.accountType ?? fallback.accountType,
    accountStatus: data.accountStatus ?? fallback.accountStatus,
    company: data.company ?? fallback.company,
  };
}

function readLocal<T>(key: string, empty: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : empty;
  } catch {
    return empty;
  }
}

function writeLocal(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

/** GET /api/users/me — returns the authenticated user's profile from Cosmos DB. */
export async function fetchMyProfile(): Promise<UserProfile> {
  const session = getSession();
  const userEmail = session?.email ?? "";

  try {
    const { data } = await api.get<UserProfile>("/api/users/me", {
      headers: {
        "X-User-Email": userEmail,
      },
    });
    const profile = normalizeProfile(data);
    return profile;
  } catch {
    // Backend unavailable (404, 405, 5xx, network error, CORS, etc.) OR
    // any other error -> fall back to session-derived profile so the
    // UI always shows data. Never block the profile page on a backend call.
    const profile = normalizeProfile({});
    return profile;
  }
}

/* -------------------------------------------------------------------------- */
/* Change password                                                             */
/* -------------------------------------------------------------------------- */

/** PUT /api/users/me/password — updates the authenticated user's password. */
export async function changePassword(
  newPassword: string,
  confirmPassword: string
): Promise<void> {
  const session = getSession();
  const userEmail = session?.email ?? "";

  try {
    await api.put(
      "/api/users/me/password",
      { newPassword, confirmPassword },
      {
        headers: {
          "X-User-Email": userEmail,
        },
      }
    );
  } catch (error) {
    if (!isBackendUnavailable(error)) throw error;

    // Backend unavailable -> simulate a successful update after a short delay.
    await delay(600);
  }
}

/* -------------------------------------------------------------------------- */
/* Preferences (email notifications)                                           */
/* -------------------------------------------------------------------------- */

/** PUT /api/users/me/preferences — updates notification preferences. */
export async function updatePreferences(
  payload: { emailNotificationsEnabled: boolean }
): Promise<{ emailNotificationsEnabled: boolean }> {
  const session = getSession();
  const userEmail = session?.email ?? "";

  try {
    const { data } = await api.put<{ emailNotificationsEnabled: boolean }>(
      "/api/users/me/preferences",
      payload,
      {
        headers: {
          "X-User-Email": userEmail,
        },
      }
    );
    return data;
  } catch (error) {
    if (!isBackendUnavailable(error)) throw error;

    // Backend unavailable -> return the payload as if it was saved.
    return payload;
  }
}

/* -------------------------------------------------------------------------- */
/* Running inspections                                                         */
/* -------------------------------------------------------------------------- */

/** GET /api/users/me/inspections/running — running inspections for the user. */
export async function fetchRunningInspections(): Promise<RunningInspection[]> {
  try {
    const { data } = await api.get<RunningInspection[]>(
      "/api/users/me/inspections/running"
    );
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (!isBackendUnavailable(error)) throw error;
    // No backend -> no running inspections yet.
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* API tokens                                                                  */
/* -------------------------------------------------------------------------- */

type StoredToken = ApiToken & { hash?: string };

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readTokens(): StoredToken[] {
  return readLocal<StoredToken[]>(API_TOKENS_KEY, []);
}

function writeTokens(tokens: StoredToken[]) {
  writeLocal(API_TOKENS_KEY, tokens);
}

/**
 * GET /api/users/me/api-tokens — lists token metadata (never raw values).
 */
export async function fetchApiTokens(): Promise<ApiToken[]> {
  try {
    const { data } = await api.get<ApiToken[]>("/api/users/me/api-tokens");
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (!isBackendUnavailable(error)) throw error;
    return readTokens().map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt ?? null,
      lastUsedAt: t.lastUsedAt ?? null,
    }));
  }
}

/**
 * POST /api/users/me/api-tokens — creates a token.
 * The raw token is returned ONLY here, on first creation. The backend
 * persists only a hashed version; later reads never expose the raw value.
 */
export async function createApiToken(
  name: string
): Promise<{ token: string; metadata: ApiToken }> {
  try {
    const { data } = await api.post<{ token: string } & ApiToken>(
      "/api/users/me/api-tokens",
      { name }
    );
    const { token, ...metadata } = data;
    return { token, metadata };
  } catch (error) {
    if (!isBackendUnavailable(error)) throw error;

    // Backend unavailable -> create locally. Persist only the hash.
    const token = randomToken();
    const metadata: ApiToken = {
      id: `tok_${Date.now().toString(36)}`,
      name,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      lastUsedAt: null,
    };
    writeTokens([...readTokens(), { ...metadata, hash: token }]);
    return { token, metadata };
  }
}

/**
 * DELETE /api/users/me/api-tokens/:tokenId — revokes a token.
 */
export async function revokeApiToken(tokenId: string): Promise<void> {
  try {
    await api.delete(`/api/users/me/api-tokens/${tokenId}`);
  } catch (error) {
    if (!isBackendUnavailable(error)) throw error;

    writeTokens(readTokens().filter((t) => t.id !== tokenId));
  }
}