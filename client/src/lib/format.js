/**
 * Presentation helpers. Pure functions only — no API access, no state.
 */

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const DATE_ONLY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const TIME_ONLY = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

const asDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** "24 Sep 2026, 14:05" — the default for timestamps in lists and details. */
export function formatDateTime(value) {
  const date = asDate(value);
  return date ? DATE_TIME.format(date) : "—";
}

export function formatDate(value) {
  const date = asDate(value);
  return date ? DATE_ONLY.format(date) : "—";
}

export function formatTime(value) {
  const date = asDate(value);
  return date ? TIME_ONLY.format(date) : "—";
}

/** Short day label used by the trend chart axis: "24 Sep". */
export function formatDayShort(value) {
  const date = asDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

/** "just now", "12 min ago", "3 h ago", "2 d ago", else the plain date. */
export function formatRelative(value) {
  const date = asDate(value);
  if (!date) return "—";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} min ago`;
  }
  if (seconds < 86_400) {
    const hours = Math.round(seconds / 3600);
    return `${hours} h ago`;
  }
  if (seconds < 604_800) {
    const days = Math.round(seconds / 86_400);
    return `${days} d ago`;
  }
  return formatDate(date);
}

/** Hour counts arrive as decimal numbers from the analytics service. */
export function formatHours(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const hours = Number(value);
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

export function formatDistance(metres) {
  if (metres === null || metres === undefined || Number.isNaN(Number(metres))) return "—";
  const value = Number(metres);
  return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
}

export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "0";
  return new Intl.NumberFormat("en-GB").format(Number(value));
}

/** "1 report" / "4 reports" */
export function pluralise(count, singular, plural = `${singular}s`) {
  return `${formatNumber(count)} ${Number(count) === 1 ? singular : plural}`;
}

export function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** "under_intervention" -> "Under intervention" */
export function humanise(value) {
  const text = String(value || "").replace(/[_.]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/**
 * Public incident coordinates are already rounded by the API. The UI shows
 * them as an approximate position, never as a precise address.
 */
export function formatApproximate(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "Location unavailable";
  return `≈ ${lat.toFixed(3)}°, ${lng.toFixed(3)}°`;
}

/** Turns a timestamp into the value a datetime-local input expects. */
export function toInputDate(value) {
  const date = asDate(value) || new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** True when the timestamp falls on today's calendar day. */
export function isToday(value) {
  const date = asDate(value);
  if (!date) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
}
