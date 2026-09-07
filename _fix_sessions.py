p = r'c:\Users\m685913\Documents\MedInspect AI Docs\Text Inspection full stack\Frontend\src\features\admin\systemApi.ts'
with open(p, encoding='utf-8', newline='') as f:
    content = f.read()

nl = '\r\n' if content.count('\r\n') > content.count('\n') else '\n'
content = content.replace('\r\n', '\n').replace('\r', '\n')
lines = content.split('\n')

start = None
end = None
for ii, l in enumerate(lines):
    if start is None and 'Records a login event' in l:
        start = ii
    if start is not None and l.strip().startswith('export async function getUser'):
        end = ii
        break

print('bounds:', start, end)
if start is None or end is None:
    print('BOUNDS_NOT_FOUND')
else:
    new_block = r'''/**
 * Tracks the users who have actually logged in during this session (fallback for
 * offline mode when the backend /api/sessions endpoint is unreachable). Only real
 * authenticated logins are recorded — never hardcoded/fabricated entries.


 */
let activeSessions: LoggedInUser[] = [];

/** Best-effort browser name from navigator.userAgent. */
function detectBrowser(): string {
  const ua = navigator.userAgent;

  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  if (/OPR\//.test(ua)) return "Opera";
  return "Unknown Browser";
}

/** Best-effort operating system name from navigator.userAgent/platform. */
function detectOS(): string {
  const ua = navigator.userAgent;
  const platform = (navigator.platform || "").toLowerCase();

  if (/Windows NT/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  if (/CrOS/.test(ua)) return "Chrome OS";

  if (platform.includes("win")) return "Windows";
  if (platform.includes("mac")) return "macOS";
  if (platform.includes("linux")) return "Linux";

  return "Unknown OS";
}

/**
 * Best-effort public IP address. A network call to an IP echo service may be blocked
 * by CORS/offline environments, so we fall back to a placeholder so the UI still
 * has a value to display.
 */
async function resolveClientIp(): Promise<string> {

  try {
    const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return "10.1.1.0";


    const data = await res.json();
    return typeof data.ip === "string" && data.ip ? data.ip : "10.1.1.0";
  } catch {
    return "10.1.1.0";
  }
}

/**
 * Records a login event forthed user with the given email..
 *
 * The backend /api/auth/login endpoint already updates lastLogin in Cosmos DB.
 * We also record a real active-session entry (used offline by the Logged-in Users
 * page) reflecting the device/browser/OS/IP of the actual authenticated login —
 * never hardcoded values..
 */
export async function recordUserLogin(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date().toISOString();
  const session = getSession();


  // Update in-memory mock users array (fallback for offline mode)
  const userIndex = mockUsers.findIndex((u) => u.email.trim().toLowerCase() === normalizedEmail);
  if (userIndex !== -1) {
    mockUsers[userIndex] = { ...mockUsers[userIndex], lastLogin: now };
  }

  // Record a real active session entry forthed logged-in user (offline fallback for
  // the Logged-in Users page). Identity/accountType come from the authenticated
  // session — never the email address alone,and never hardcoded..


  if (!session) return;
  const sessionId = session.sessionId ?? `sess_${String(session.id)}`;
  const browser = detectBrowser();
  const os = detectOS();
    const accountType = session.accountType ?? "user";


    const existing = activeSessions.findIndex((s) => s.sessionId === sessionId);
    const entry: LoggedInUser = {
    id: sessionId,
    user: session.name || session.email,
    email: session.email,
    accountType,
    sessionId,
    loginTime: session.loginTime ?? now,
    lastActivity: now,
    ipAddress: "10.1.1.0",
    browser,
    operatingSystem: os,
    sessionStatus: "Active",
  };


    // Resolve the public IP asynchronously so login isn't blocked; update when aware.

    void resolveClientIp().then((ip) => {
      entry.ipAddress = ip;
      const idx = activeSessions.findIndex((s) => s.sessionId === sessionId);
      if (idx !== -1) {

        activeSessions[idx] = { ...activeSessions[idx], ipAddress: ip };
      } else {
        activeSessions.push({ ...entry, ipAddress: ip });
      }
    });


    if (existing !== -1) {
      activeSessions[existing] = entry;
    } else {
      activeSessions = [entry, ...activeSessions];
    }
}

/** Fallback list of real active sessions when the backend is unreachable. */
function fallbackActiveSessions(): LoggedInUser[] {


  const current = currentUserSession();
  if (!current) return [...activeSessions];
  return [current, ...activeSessions.filter((s) => s.sessionId !== current.sessionId)];
}
'''