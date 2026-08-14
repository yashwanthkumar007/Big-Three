const USER_KEY = "user";
const SESSION_EXPIRY_KEY = "session_expiry";

// Session timeout in milliseconds (e.g., 30 minutes)
const SESSION_TIMEOUT = 30 * 60 * 1000;

type User = {
  id: number;
  name: string;
  email: string;
};

export const setSession = (user: User) => {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(
    SESSION_EXPIRY_KEY,
    String(Date.now() + SESSION_TIMEOUT)
  );
};

export const clearSession = () => {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(SESSION_EXPIRY_KEY);
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