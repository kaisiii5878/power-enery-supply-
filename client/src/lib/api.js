/**
 * API client.
 *
 * One place that knows the base URL, attaches the bearer token, unwraps the
 * server's `{ error }` envelope into a typed ApiError and reports an expired
 * session so the app can return to the sign-in screen.
 *
 * Every path here matches the mounted routes in `server/routes/index.js`.
 */

import { getToken, clearSession } from "./session.js";

/**
 * The base URL is injected by Vite from VITE_API_BASE.
 *
 * `import.meta.env` only exists inside a bundler, so it is read defensively: the
 * module stays importable from plain Node, which is what lets the test suite load
 * `authApi` and assert on the requests it builds.
 */
const ENV = import.meta.env || {};
const API_BASE = ENV.VITE_API_BASE || "http://localhost:4000/api";

export const SESSION_EXPIRED_EVENT = "powerwatch:session-expired";

export class ApiError extends Error {
  constructor(message, { status = 0, code = "", allowed = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.allowed = allowed;
  }

  /** True when retrying the exact same request could plausibly succeed. */
  get isRetryable() {
    return this.status === 0 || this.status === 408 || this.status >= 500;
  }

  get isConflict() {
    return this.status === 409;
  }
}

/** A raw fetch failure must never reach the screen. */
const NETWORK_MESSAGE = "We could not reach PowerWatch. Check your connection and try again.";

/** Per-status fallbacks, used only when the server sends no message. */
function fallbackMessage(status) {
  if (status === 400) return "Some of the information sent was not accepted. Please review the form.";
  if (status === 403) return "You do not have permission to do that.";
  if (status === 404) return "We could not find what you asked for.";
  if (status === 409) return "That action conflicts with the current state of the incident.";
  if (status === 429) return "Too many requests just now. Please wait a moment and try again.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return "Something went wrong. Please try again.";
}

export async function request(path, { method = "GET", body, signal, anonymous = false } = {}) {
  const headers = {};
  const token = anonymous ? null : getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError(NETWORK_MESSAGE, { status: 0 });
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (response.ok) return payload ?? {};

  // A rejected token means the session is over: drop it and tell the app.
  const expired = response.status === 401 && Boolean(token);
  if (expired) {
    clearSession();
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }

  const message =
    payload?.error ||
    (expired ? "Your session ended. Please sign in again." : fallbackMessage(response.status));

  throw new ApiError(message, {
    status: response.status,
    code: payload?.code || "",
    allowed: payload?.allowed || null
  });
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "" || value === "all") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/* ---- accounts ---------------------------------------------------------- */

export const authApi = {
  login: (body) => request("/auth/login", { method: "POST", body, anonymous: true }),
  register: (body) => request("/auth/register", { method: "POST", body, anonymous: true }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me"),
  changePassword: (body) => request("/auth/password", { method: "POST", body })
};

/* ---- public / citizen -------------------------------------------------- */

export const publicApi = {
  config: () => request("/public/config", { anonymous: true }),
  incidents: () => request("/public/incidents", { anonymous: true }),
  incident: (id) => request(`/public/incidents/${id}`, { anonymous: true }),
  submitReport: (body) => request("/public/reports", { method: "POST", body }),
  confirm: (id, body) => request(`/public/incidents/${id}/confirmations`, { method: "POST", body }),
  announcements: () => request("/public/announcements", { anonymous: true }),
  geocode: (text, signal) => request(`/geocode/quarters?q=${encodeURIComponent(text)}`, { anonymous: true, signal })
};

/* ---- incidents (staff) -------------------------------------------------
   The workflow is a set of explicit transitions, so each step is its own
   endpoint rather than a generic PATCH. `next_statuses` on the detail
   response tells the console which of them are currently legal.           */

export const incidentsApi = {
  list: (filters) => request(`/incidents${query(filters)}`),
  mine: () => request("/incidents/mine"),
  detail: (id) => request(`/incidents/${id}`),
  sendMessage: (id, body) => request(`/incidents/${id}/messages`, { method: "POST", body: { body } }),
  validate: (id, body) => request(`/incidents/${id}/validate`, { method: "POST", body: body || {} }),
  reject: (id, reason) => request(`/incidents/${id}/reject`, { method: "POST", body: { reason } }),
  assign: (id, contractor) => request(`/incidents/${id}/assign`, { method: "POST", body: { contractor } }),
  fieldStatus: (id, body) => request(`/incidents/${id}/field-status`, { method: "POST", body }),
  close: (id, body) => request(`/incidents/${id}/close`, { method: "POST", body: body || {} }),
  reopen: (id, reason) => request(`/incidents/${id}/reopen`, { method: "POST", body: { reason } })
};

/* ---- per-account ------------------------------------------------------- */

export const sessionApi = {
  notifications: () => request("/notifications"),
  markNotificationsRead: () => request("/notifications/read", { method: "POST" }),
  workQueue: () => request("/work/queue")
};

/* ---- administration ---------------------------------------------------- */

export const adminApi = {
  analytics: (days) => request(`/admin/analytics${query({ days })}`),
  stats: () => request("/admin/stats"),
  users: (filters) => request(`/admin/users${query(filters)}`),
  createUser: (body) => request("/admin/users", { method: "POST", body }),
  setUserActive: (id, isActive) =>
    request(`/admin/users/${id}/active`, { method: "PATCH", body: { is_active: isActive } }),
  contractors: () => request("/admin/contractors"),
  zones: () => request("/admin/zones"),
  createZone: (body) => request("/admin/zones", { method: "POST", body }),
  updateZone: (id, body) => request(`/admin/zones/${id}`, { method: "PATCH", body }),
  deleteZone: (id) => request(`/admin/zones/${id}`, { method: "DELETE" }),
  announcements: () => request("/admin/announcements"),
  createAnnouncement: (body) => request("/admin/announcements", { method: "POST", body }),
  updateAnnouncement: (id, body) => request(`/admin/announcements/${id}`, { method: "PATCH", body }),
  deleteAnnouncement: (id) => request(`/admin/announcements/${id}`, { method: "DELETE" }),
  clusteringConfig: () => request("/admin/clustering-config"),
  saveClusteringConfig: (body) => request("/admin/clustering-config", { method: "PUT", body }),
  audit: (params) => request(`/admin/audit${query(params)}`)
};

export { API_BASE };

