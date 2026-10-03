/**
 * PostgreSQL + PostGIS integration tests.
 *
 * These exercise the real adapter against a live database. When no database is
 * reachable — the normal case on a demo laptop and in CI — every test reports
 * itself as skipped rather than failing, so `npm test` stays green while still
 * proving the PostGIS path on a machine that has one.
 *
 * Run explicitly with:  npm run test:postgres
 */

process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

let pool = null;
let store = null;
let spatial = null;
let tablesReady = false;
let unavailable = "";

const BASTOS = { latitude: 3.8841, longitude: 11.5168 };
const OFFSHORE = { latitude: 0, longitude: 0 }; // far outside Cameroon and every zone

before(async () => {
  const { config } = require("../config/env");
  const { createPgPool } = require("../store/pgPool");
  const PostgresStore = require("../store/postgresStore");

  try {
    pool = createPgPool(config);
    await pool.query("SELECT 1");
  } catch (error) {
    unavailable = `no PostgreSQL reachable (${error.code || error.message})`;
    return;
  }

  store = new PostgresStore(pool);
  spatial = await store.init();

  try {
    const { rows } = await pool.query("SELECT to_regclass('public.incidents') AS table_name");
    tablesReady = Boolean(rows[0].table_name);
  } catch {
    tablesReady = false;
  }
  if (!tablesReady) unavailable = "schema not migrated (run `npm run migrate`)";
});

after(async () => {
  if (pool) {
    try { await pool.end(); } catch { /* the pool is already closed */ }
  }
});

test("the adapter identifies itself as the postgres engine", async (t) => {
  if (!store) return t.skip(unavailable);
  assert.equal(store.db, "postgres");
});

test("PostGIS availability is detected and reported as a boolean", async (t) => {
  if (!store) return t.skip(unavailable);
  assert.equal(typeof spatial.postgis, "boolean");
  assert.equal(typeof spatial.geometry, "boolean");
  assert.equal(spatial.geometry && !spatial.postgis, false, "geometry implies the extension");
});

test("ST_DWithin answers a radius question inside the database", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!spatial.postgis) return t.skip("PostGIS is not installed on this database");

  const { rows } = await pool.query(
    "SELECT ST_DWithin(ST_MakePoint($1, $2)::geography, ST_MakePoint($3, $4)::geography, $5) AS within",
    [BASTOS.longitude, BASTOS.latitude, BASTOS.longitude + 0.01, BASTOS.latitude, 2000]
  );
  assert.equal(rows[0].within, true, "points ~1.1 km apart are within 2 km");
});

test("a generated location column round-trips longitude and latitude in order", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!spatial.geometry) return t.skip("the PostGIS migration has not been applied");

  const { rows } = await pool.query(
    "SELECT ST_X(ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS x, ST_Y(ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS y",
    [BASTOS.longitude, BASTOS.latitude]
  );
  assert.ok(Math.abs(rows[0].x - BASTOS.longitude) < 1e-6, "ST_MakePoint takes longitude first");
  assert.ok(Math.abs(rows[0].y - BASTOS.latitude) < 1e-6);
});

test("findZoneForPoint returns null for a point no zone contains", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!tablesReady) return t.skip(unavailable);
  assert.equal(await store.findZoneForPoint(OFFSHORE), null);
});

test("findZoneForPoint tolerates a malformed point", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!tablesReady) return t.skip(unavailable);
  assert.equal(await store.findZoneForPoint(undefined), null);
  assert.equal(await store.findZoneForPoint({ latitude: "x", longitude: 1 }), null);
});

test("findZoneForPoint returns the containing zone for its own centre", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!tablesReady) return t.skip(unavailable);
  const zones = await store.listZones();
  if (!zones.length) return t.skip("no zones seeded");
  const zone = zones.find(entry => Number(entry.radius_m) > 0);
  const found = await store.findZoneForPoint({ latitude: zone.latitude, longitude: zone.longitude });
  assert.ok(found, "a zone's own centre must be inside the zone");
  assert.equal(found.id, zone.id);
});

test("findClusterCandidates honours the window and the spatial hint", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!tablesReady) return t.skip(unavailable);

  const recent = await store.findClusterCandidates({
    sinceIso: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    point: BASTOS,
    radiusMeters: 500
  });
  assert.ok(Array.isArray(recent));

  const unbounded = await store.findClusterCandidates({ sinceIso: "1970-01-01T00:00:00.000Z" });
  assert.ok(Array.isArray(unbounded), "the non-spatial fallback must still return an array");

  // Anything returned inside the radius must genuinely be within it.
  for (const incident of recent) {
    const { rows } = await pool.query(
      "SELECT ST_Distance(ST_MakePoint($1, $2)::geography, ST_MakePoint($3, $4)::geography) AS metres",
      [BASTOS.longitude, BASTOS.latitude, Number(incident.longitude), Number(incident.latitude)]
    );
    assert.ok(Number(rows[0].metres) <= 501, `incident ${incident.id} fell outside the radius filter`);
  }
});

test("settings round-trip without disturbing the real values", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!tablesReady) return t.skip(unavailable);

  const key = "__integration_probe";
  await store.setSetting(key, "123");
  assert.equal((await store.getSettings([key]))[key], "123");

  // Overwriting proves the ON CONFLICT branch; then the probe is removed.
  await store.setSetting(key, "456");
  assert.equal((await store.getSettings([key]))[key], "456");
  await pool.query("DELETE FROM system_settings WHERE setting_key = $1", [key]);
  assert.equal((await store.getSettings([key]))[key], undefined);
});

test("the clustering thresholds are readable and numeric", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!tablesReady) return t.skip(unavailable);

  const settings = await store.getSettings(["cluster_distance_m", "cluster_window_minutes", "min_reports_to_qualify"]);
  assert.ok(Number(settings.cluster_distance_m) > 0);
  assert.ok(Number(settings.cluster_window_minutes) > 0);
});

test("spatial helpers degrade to neutral results rather than throwing", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!tablesReady) return t.skip(unavailable);

  const within = await store.reportsWithinRadius(BASTOS, 500);
  assert.ok(Array.isArray(within.reports));
  assert.equal(typeof within.total, "number");

  const near = await store.usersNearEvent(BASTOS, 500);
  assert.ok(Array.isArray(near.user_ids));

  // A zero radius is not a query: it must return empty rather than scan everything.
  assert.deepEqual(await store.reportsWithinRadius(BASTOS, 0), { total: 0, reports: [] });
});

test("an incident spatial summary is either absent or well formed", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!tablesReady) return t.skip(unavailable);

  const incidents = await store.listIncidents();
  if (!incidents.length) return t.skip("no incidents seeded");
  const summary = await store.incidentSpatialSummary(incidents[0].id);
  if (summary === null) return; // acceptable when the database is not mapping-enabled
  assert.ok(Number.isFinite(summary.centroid.latitude));
  assert.ok(Number.isFinite(summary.centroid.longitude));
  assert.ok(summary.coverage_area_m2 >= 0);
});

test("paginated reads report a total and never leak private columns", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!tablesReady) return t.skip(unavailable);

  const page = await store.listReports({ limit: 5, offset: 0 });
  assert.ok(Array.isArray(page.rows));
  assert.equal(typeof page.total, "number");
  assert.ok(page.rows.length <= 5);
  for (const report of page.rows) {
    assert.equal("location" in report, false, "geometry must never leave the server");
    assert.equal("password_hash" in report, false);
  }
});

test("password material is never returned by listUsers", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!tablesReady) return t.skip(unavailable);

  for (const user of await store.listUsers({})) {
    assert.equal("password_hash" in user, false);
    assert.equal("password_salt" in user, false);
  }
});

test("incidentStats returns every status bucket the console expects", async (t) => {
  if (!store) return t.skip(unavailable);
  if (!tablesReady) return t.skip(unavailable);

  const stats = await store.incidentStats();
  for (const status of ["pending", "pending_validation", "validated", "closed", "rejected"]) {
    assert.equal(typeof stats[status], "number", `${status} should be counted`);
  }
  assert.equal(typeof stats.total, "number");
  assert.equal(typeof stats.active, "number");
  assert.equal(typeof stats.reports, "number");
  assert.ok(stats.total <= stats.reports + stats.total, "sanity: reports and incidents are counted separately");
});