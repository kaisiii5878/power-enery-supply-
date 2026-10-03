/**
 * Unit tests for the PostgreSQL SQL/row helpers (`server/store/pgQuery.js`).
 *
 * These check the two things that would silently corrupt data if wrong:
 * parameter numbering, and the row shape the services receive (numbers as
 * numbers, dates as ISO strings, booleans as 0/1, geometry never leaving).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  PG_ERROR_MAP,
  toPg,
  placeholders,
  insertSql,
  updateSql,
  translateError,
  normalizePgRow,
  normalizePgRows
} = require("../store/pgQuery");

test("placeholders number from one", () => {
  assert.equal(placeholders(0), "");
  assert.equal(placeholders(1), "$1");
  assert.equal(placeholders(3), "$1, $2, $3");
});

test("insertSql names every column, numbers the parameters and returns the row", () => {
  const { sql, params } = insertSql("reports", { incident_id: 3, district: "Bastos", latitude: 3.88, note: undefined });
  assert.equal(sql, 'INSERT INTO reports ("incident_id", "district", "latitude") VALUES ($1, $2, $3) RETURNING *');
  assert.deepEqual(params, [3, "Bastos", 3.88]);
});

test("insertSql skips undefined values so defaults apply", () => {
  const { sql, params } = insertSql("zones", { name: "Douala Wouri", region: undefined, radius_m: 7000 });
  assert.ok(!sql.includes("region"));
  assert.deepEqual(params, ["Douala Wouri", 7000]);
});

test("updateSql numbers the assignments and appends the id last", () => {
  const statement = updateSql("incidents", 7, { status: "validated", severity: "high" });
  assert.equal(statement.sql, 'UPDATE incidents SET "status" = $1, "severity" = $2 WHERE id = $3 RETURNING *');
  assert.deepEqual(statement.params, ["validated", "high", 7]);
});

test("updateSql returns null when there is nothing to change", () => {
  assert.equal(updateSql("incidents", 7, { status: undefined }), null);
  assert.equal(updateSql("incidents", 7, {}), null);
});

test("toPg converts JavaScript values into bindable ones", () => {
  assert.equal(toPg(undefined), null);
  assert.equal(toPg(null), null);
  assert.equal(toPg(true), 1);
  assert.equal(toPg(false), 0);
  assert.equal(toPg("Bastos"), "Bastos");
  assert.equal(toPg(3.8841), 3.8841);
  assert.equal(toPg({ a: 1 }), '{"a":1}');
  const date = new Date("2026-09-22T18:42:00Z");
  assert.equal(toPg(date), date, "a Date is passed straight to the driver");
});

test("Postgres unique violations are translated to the code the services catch", () => {
  const error = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
  const translated = translateError(error);
  assert.equal(translated.code, "ER_DUP_ENTRY");
  assert.equal(translated.sqlState, "23505", "the original SQLSTATE is preserved for logs");
  assert.equal(PG_ERROR_MAP["23505"], "ER_DUP_ENTRY");
});

test("known foreign-key and check violations are translated too", () => {
  assert.equal(translateError(Object.assign(new Error("fk"), { code: "23503" })).code, "ER_NO_REFERENCED_ROW");
  assert.equal(translateError(Object.assign(new Error("check"), { code: "23514" })).code, "ER_CHECK_CONSTRAINT");
});

test("unrecognised and missing errors pass through untouched", () => {
  const other = Object.assign(new Error("boom"), { code: "XX000" });
  assert.equal(translateError(other).code, "XX000");
  assert.equal(translateError(null), null);
});

test("normalizePgRow converts numeric strings, dates and booleans to the shared shape", () => {
  const row = normalizePgRow({
    id: "12",
    reports_count: "37",
    latitude: "3.8841000",
    longitude: "11.5168000",
    severity_score: "75.50",
    estimated_area_m2: "785398",
    radius_m: "500",
    is_active: true,
    is_read: false,
    district: "Bastos, Yaounde",
    created_at: new Date("2026-09-22T18:42:00Z")
  });

  assert.equal(row.id, 12);
  assert.equal(row.reports_count, 37);
  assert.equal(row.latitude, 3.8841);
  assert.equal(row.longitude, 11.5168);
  assert.equal(row.severity_score, 75.5);
  assert.equal(row.estimated_area_m2, 785398);
  assert.equal(row.radius_m, 500);
  assert.equal(row.is_active, 1, "booleans are reported as 0/1 like the other stores");
  assert.equal(row.is_read, 0);
  assert.equal(row.district, "Bastos, Yaounde");
  assert.equal(row.created_at, "2026-09-22T18:42:00.000Z");
});

test("normalizePgRow never leaks the geometry column", () => {
  const row = normalizePgRow({ id: "1", location: "0101000020E6100000A1B2C3D4E5F60718", latitude: "3.88", longitude: "11.5" });
  assert.equal("location" in row, false);
  assert.equal(row.latitude, 3.88);
});

test("normalizePgRow keeps jsonb objects (audit details) intact", () => {
  const row = normalizePgRow({ id: "5", details: { from: "pending", reports_count: 3 } });
  assert.deepEqual(row.details, { from: "pending", reports_count: 3 });
});

test("normalizePgRow returns null for a missing row", () => {
  assert.equal(normalizePgRow(null), null);
  assert.equal(normalizePgRow(undefined), null);
});

test("normalizePgRows maps a result set", () => {
  const rows = normalizePgRows([{ id: "1", reports_count: "2" }, { id: "2", reports_count: "3" }]);
  assert.deepEqual(rows.map(row => row.reports_count), [2, 3]);
});
