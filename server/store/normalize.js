/**
 * Row normalisation shared by both storage adapters.
 *
 * mysql2 returns DECIMAL columns as strings; the in-memory store already holds
 * numbers. Normalising here means every service and controller sees one shape
 * regardless of the active adapter.
 */

const num = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const iso = value => (value instanceof Date ? value.toISOString() : value ? String(value) : null);

function normalizeIncident(row) {
  if (!row) return null;
  return {
    ...row,
    id: num(row.id),
    latitude: num(row.latitude, 0),
    longitude: num(row.longitude, 0),
    radius_m: num(row.radius_m, 500),
    reports_count: num(row.reports_count, 0),
    estimated_area_m2: num(row.estimated_area_m2, 0),
    severity_score: num(row.severity_score, 0),
    zone_id: num(row.zone_id),
    first_report_at: iso(row.first_report_at),
    last_report_at: iso(row.last_report_at),
    validated_at: iso(row.validated_at),
    completed_at: iso(row.completed_at),
    restored_at: iso(row.restored_at),
    closed_at: iso(row.closed_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at)
  };
}

function normalizeReport(row) {
  if (!row) return null;
  return {
    ...row,
    id: num(row.id),
    incident_id: num(row.incident_id),
    user_id: num(row.user_id),
    latitude: num(row.latitude, 0),
    longitude: num(row.longitude, 0),
    created_at: iso(row.created_at)
  };
}

const normalizeRow = row => {
  if (!row) return null;
  const output = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) output[key] = value.toISOString();
    else if (typeof value === "object" && value !== null && !Array.isArray(value)) output[key] = value;
    else if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value) && /(_m2|_score|_m|_count|id|lat|lon|radius)/.test(key)) output[key] = Number(value);
    else output[key] = value;
  }
  return output;
};

/** `LIMIT ? OFFSET ?` helpers shared by paginated list endpoints. */
function paginate(query = {}, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const limit = Math.min(maxLimit, Math.max(1, num(query.limit, defaultLimit)));
  const page = Math.max(1, num(query.page, 1));
  return { limit, page, offset: (page - 1) * limit };
}

module.exports = { normalizeIncident, normalizeReport, normalizeRow, paginate, num, iso };
