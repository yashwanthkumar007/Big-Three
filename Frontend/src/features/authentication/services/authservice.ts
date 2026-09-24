type LoginRequest = {
  email: string;
  password: string;
};

type LoginResponse = {
  accessToken: string;
  user: {
    id: number;
    name: string;
    username: string;
    email: string;
    accountType: string;
    sessionId: string;
    loginTime: string;
  };
};

/**
 * Logs the current session out on the backend, which DELETES the session
 * record from the database so it no longer appears on the Logged-in Users
 * page. Best-effort: failures are swallowed so local logout always works.
 * The session is identified by the server-issued sessionId, never by email.
 */
export const logout = async (
  reason: "user" | "timeout" = "user"
): Promise<void> => {
  let sessionId: string | null = null;

  try {
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem("user");
      sessionId = raw ? JSON.parse(raw)?.sessionId ?? null : null;
    }
  } catch {
    sessionId = null;
  }

  if (!sessionId) return;

  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": sessionId,
        // Tells the backend whether this was an intentional logout by the
        // user ("user") or an automatic session-expiry logout ("timeout"),
        // so the audit trail can distinguish the two.
        "X-Logout-Reason": reason,
      },
    });
  } catch {
    // Backend unavailable — local logout proceeds regardless.
  }
};

export const login = async ({
  email,
  password,
}: LoginRequest): Promise<LoginResponse> => {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Invalid email or password");
  }

  const user = await response.json();

  // Determine account type from the user document
  const accountType =
    user.accountType === "Administrator" ? "Administrator" : "user";

  const username = user.username || user.email.split("@")[0];
  const firstName = user.firstName || "";
  const lastName = user.lastName || "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  const displayName =
    accountType === "Administrator"
      ? username || "Administrator"
      : fullName || username;

  const loginTime =
    typeof user.loginTime === "string" && user.loginTime
      ? user.loginTime
      : new Date().toISOString();

  // Prefer the SERVER-issued session id.
  const sessionId =
    typeof user.sessionId === "string" && user.sessionId
      ? user.sessionId
      : `sess_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 10)}`;

  return {
    accessToken:
      accountType === "Administrator"
        ? "mock-jwt-token"
        : "mock-user-jwt-token",

    user: {
      id: Number(user.id) || (accountType === "Administrator" ? 1 : 2),
      name: displayName,
      username,
      email: user.email,
      accountType,
      sessionId,
      loginTime,
    },
  };
};