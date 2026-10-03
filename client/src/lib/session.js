/**
 * Session storage.
 *
 * The bearer token and the cached account live in sessionStorage so a closed
 * tab ends the session. Nothing here trusts the cached copy for authorisation
 * decisions — the server re-reads the account on every request, and
 * `GET /auth/me` refreshes the cached user when the app boots.
 */

const TOKEN_KEY = "powerwatch.token";
const USER_KEY = "powerwatch.user";
const DEVICE_KEY = "powerwatch.device-id";

/** Roles the API actually issues. */
export const ROLES = {
  CITIZEN: "client",
  AGENT: "subcontractor",
  OPERATOR: "socadel"
};

/** Which role a URL path requires, or null when the path is public. */
export function roleForPath(pathname) {
  if (pathname.startsWith("/admin")) return ROLES.OPERATOR;
  if (pathname.startsWith("/agency") || pathname.startsWith("/agent")) return ROLES.AGENT;
  if (pathname.startsWith("/client")) return ROLES.CITIZEN;
  return null;
}

export function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser() {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession({ token, user }) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage can be unavailable in private modes — the app still works */
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * A stable, anonymous device identifier used for "me too" / "power is back"
 * confirmations from guests. It is a random UUID, never a fingerprint.
 */
export function getDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const created = globalThis.crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return `dev-${Date.now()}`;
  }
}

/** Human label for a role, used in copy and badges. */
export const ROLE_LABEL = {
  [ROLES.CITIZEN]: "Citizen",
  [ROLES.AGENT]: "Field agent",
  [ROLES.OPERATOR]: "Administrator"
};
