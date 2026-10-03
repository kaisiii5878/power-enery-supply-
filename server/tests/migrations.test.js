/**
 * File-level checks on the PostgreSQL migration set.
 *
 * These run without a database: they guarantee the migration runner finds the
 * files in the right order, that the PostGIS step is correctly marked optional,
 * and that the baseline schema really defines every table the store queries.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const { listMigrations, checksum, runMigrations, ensureLedger, MIGRATIONS_DIR } = require("../database/migrate");

/** Every table the PostgresStore issues SQL against. */
const REQUIRED_TABLES = [
  "app_users", "zones", "incidents", "reports", "incident_messages",
  "incident_confirmations", "work_requests", "agency_notifications",
  "system_settings", "audit_log", "announcements"
];

test("the runner exposes its database entry points", () => {
  assert.equal(typeof runMigrations, "function");
  assert.equal(typeof ensureLedger, "function");
  assert.equal(typeof listMigrations, "function");
});

test("migrations are discovered in filename order", async () => {
  const files = await listMigrations();
  assert.ok(files.length >= 2, "expected at least the baseline and the PostGIS step");
  const names = files.map(file => file.filename);
  assert.deepEqual(names, [...names].sort(), "files must already be in apply order");
  assert.equal(names[0], "0001_init.sql");
});

test("the baseline schema is mandatory and the PostGIS layer is optional", async () => {
  const files = await listMigrations();
  const baseline = files.find(file => file.filename === "0001_init.sql");
  const postgis = files.find(file => file.filename.startsWith("0002_postgis"));
  assert.ok(baseline && baseline.optional === false, "0001 must never be skipped");
  assert.ok(postgis && postgis.optional === true, "the PostGIS step must be skippable");
  assert.ok(postgis.filename.endsWith(".optional.sql"));
});

test("the baseline creates every table the store reads and writes", async () => {
  const sql = await fs.readFile(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8");
  for (const table of REQUIRED_TABLES) {
    assert.match(
      sql,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`),
      `0001_init.sql must create ${table}`
    );
  }
});

test("the baseline seeds the tunable clustering thresholds", async () => {
  const sql = await fs.readFile(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8");
  for (const key of ["cluster_distance_m", "cluster_window_minutes", "min_reports_to_qualify"]) {
    assert.ok(sql.includes(key), `system_settings must be seeded with ${key}`);
  }
});

test("the baseline keeps the status and severity vocabularies constrained", async () => {
  const sql = await fs.readFile(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8");
  for (const status of ["pending_validation", "verification_pending", "closed", "rejected"]) {
    assert.ok(sql.includes(`'${status}'`), `the incidents CHECK must mention ${status}`);
  }
  for (const severity of ["low", "medium", "high", "critical"]) {
    assert.ok(sql.includes(`'${severity}'`), `the severity CHECK must mention ${severity}`);
  }
});

test("the PostGIS migration enables the extension and indexes the point columns", async () => {
  const files = await listMigrations();
  const postgis = files.find(file => file.filename.startsWith("0002_postgis"));
  const sql = await fs.readFile(postgis.path, "utf8");

  assert.ok(sql.includes("CREATE EXTENSION IF NOT EXISTS postgis"), "the extension must be enabled first");
  for (const table of ["reports", "incidents", "zones", "app_users"]) {
    assert.ok(
      sql.includes(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS location geometry(Point, 4326)`),
      `${table} must gain a point geometry column`
    );
    assert.ok(
      sql.includes(`ON ${table} USING GIST (location)`),
      `${table} must gain a GIST index on location`
    );
  }
  assert.ok(sql.includes("ST_MakePoint(longitude::double precision, latitude::double precision)"),
    "geometry must be generated from longitude/latitude in the correct order");
});

test("migration checksums are stable for identical content", () => {
  assert.equal(checksum("SELECT 1;"), checksum("SELECT 1;"));
  assert.notEqual(checksum("SELECT 1;"), checksum("SELECT 2;"));
});

test("the PostGIS migration holds no destructive statement", async () => {
  const files = await listMigrations();
  const postgis = files.find(file => file.filename.startsWith("0002_postgis"));
  const sql = (await fs.readFile(postgis.path, "utf8")).toUpperCase();
  for (const forbidden of ["DROP TABLE", "DROP COLUMN", "TRUNCATE", "DELETE FROM"]) {
    assert.ok(!sql.includes(forbidden), `0002 must not contain ${forbidden}`);
  }
});
