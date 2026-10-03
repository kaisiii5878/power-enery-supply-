/**
 * PostgreSQL query helpers for the PostGIS store.
 *
 * Kept apart from `postgresStore.js` so the SQL-shape logic (placeholder
 * numbering, row normalisation, SQLSTATE translation) is unit testable without
 * a live database — the same split `normalize.js` provides for MySQL.
 */

const { normalizeRow } = require("./normalize");

/**
 * Columns the rest of the application reads as 0/1 integers.
 *
 * PostgreSQL returns real booleans while the in-memory and MySQL stores use
 * 0/1, so the adapter coerces them here and every service keeps one shape.
 */
const BOOLEAN_COLUMNS = new Set(["is_active", "is_read", "published"]);

/** Geometry is stored for spatial queries but never needs to leave the server. */
const INTERNAL_COLUMNS = new Set(["location"]);

const toPg = value => {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value;
  // jsonb columns (audit details) are passed through as JSON text.
  if (typeof value === "object") return JSON.stringify(value);
  return value;
};

const placeholders = count => Array.from({ length: count }, (_, index) => `$${index + 1}`).join(", ");

/** Build `INSERT INTO t ("a", "b") VALUES ($1, $2) RETURNING *`. */
function insertSql(table, data) {
  const keys = Object.keys(data).filter(key => data[key] !== undefined);
  const columns = keys.map(key => `"${key}"`).join(", ");
  return {
    sql: `INSERT INTO ${table} (${columns}) VALUES (${placeholders(keys.length)}) RETURNING *`,
    params: keys.map(key => toPg(data[key]))
  };
}

/** Build `UPDATE t SET "a" = $1 WHERE id = $2 RETURNING *`. */
function updateSql(table, id, data, { idColumn = "id" } = {}) {
  const keys = Object.keys(data).filter(key => data[key] !== undefined);
  if (!keys.length) return null;
  const assignments = keys.map((key, index) => `"${key}" = $${index + 1}`).join(", ");
  return {
    sql: `UPDATE ${table} SET ${assignments} WHERE ${idColumn} = $${keys.length + 1} RETURNING *`,
    params: [...keys.map(key => toPg(data[key])), id]
  };
}

/**
 * SQLSTATE → the error codes the services already handle.
 *
 * The use cases catch `ER_DUP_ENTRY` (registration, citizen confirmations) and
 * the schema enforces uniqueness in PostgreSQL too, so translating 23505 means
 * no service needs to know which engine is underneath.
 */
const PG_ERROR_MAP = {
  "23505": "ER_DUP_ENTRY",
  "23503": "ER_NO_REFERENCED_ROW",
  "23514": "ER_CHECK_CONSTRAINT",
  "42P01": "ER_NO_SUCH_TABLE"
};

/** Mutates and returns the error so callers can `throw translateError(error)`. */
function translateError(error) {
  if (!error) return error;
  const mapped = PG_ERROR_MAP[error.code];
  if (!mapped) return error;
  error.sqlState = error.code;
  error.driverCode = error.code;
  error.code = mapped;
  return error;
}

/** One row shape for every engine: numbers as numbers, dates as ISO, no geometry. */
function normalizePgRow(row) {
  if (!row) return null;
  const normalized = normalizeRow(row);
  for (const key of Object.keys(normalized)) {
    if (BOOLEAN_COLUMNS.has(key) && typeof normalized[key] === "boolean") {
      normalized[key] = normalized[key] ? 1 : 0;
    } else if (INTERNAL_COLUMNS.has(key)) {
      delete normalized[key];
    }
  }
  return normalized;
}

const normalizePgRows = rows => (rows || []).map(normalizePgRow);

module.exports = {
  BOOLEAN_COLUMNS,
  INTERNAL_COLUMNS,
  PG_ERROR_MAP,
  toPg,
  placeholders,
  insertSql,
  updateSql,
  translateError,
  normalizePgRow,
  normalizePgRows
};