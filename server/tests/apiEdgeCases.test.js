/**
 * HTTP edge-case tests for the API surface.
 *
 * The happy paths are covered by `api.test.js`; this suite deliberately pushes
 * on the boundaries the brief calls out — duplicate reports, invalid
 * coordinates, unauthorised administration, expired tokens, invalid status
 * transitions and an empty analytics dataset — and asserts the human-readable
 * error envelope rather than a crash.
 *
 * The app is booted against the in-memory store, so this runs anywhere.
 */

process.env.NODE_ENV = "test";
process.env.STORAGE_DRIVER = "memory";
process.env.ADMIN_USERNAME = "edge.admin";
process.env.ADMIN_PASSWORD = "Console!2026";
process.env.JWT_SECRET = "edge-case-secret-not-used-anywhere-else";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../config/env");
const MemoryStore = require("../store/memoryStore");
const { createApp } = require("../app");
const { sign } = require("../http/tokens");

const silent = { log() {}, warn() {}, error() {} };
const BASTOS = { latitude: 3.8841, longitude: 11.5168, district: "Bastos, Yaounde" };
const FAR = { latitude: 3.9041, longitude: 11.5168, district: "Bastos, Yaounde" }; // ~2.2 km north
/** A point used by exactly one test, so clustering assertions are order-independent. */
const BONAMOUSSADI = { latitude: 4.0908, longitude: 9.7434, district: "Bonamoussadi, Douala" };

const state = {};
let mainServer;
let mainBase;
let emptyBase;

async function startServer(store, { bootstrap = true } = {}) {
  const { app, dependencies } = createApp({ store, log: silent });
  if (bootstrap) await dependencies.accounts.bootstrapAdministrator();
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.on("error", reject);
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function call(base, method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  return { status: response.status, body: payload };
}

const submitReport = (base, extra = {}) =>
  call(base, "POST", "/api/public/reports", {
    body: { category: "Total outage", reporterName: "Edge Tester", description: "Lights are out.", ...BASTOS, ...extra }
  });

before(async () => {
  const store = new MemoryStore({ clusterConfig: config.cluster, seed: false });
  const started = await startServer(store);
  mainServer = started.server;
  mainBase = started.base;

  // A second, deliberately empty application for the "no data yet" cases.
  const emptyStore = new MemoryStore({ clusterConfig: config.cluster, seed: false });
  emptyBase = (await startServer(emptyStore)).base;

  // Administrator + a citizen to drive the authenticated cases.
  state.admin = (await call(mainBase, "POST", "/api/auth/login", {
    body: { username: "edge.admin", password: "Console!2026" }
  })).body;

  state.citizen = (await call(mainBase, "POST", "/api/auth/register", {
    body: { username: "edge.citizen", password: "Citizen!2026", fullName: "Edge Citizen", phone: "+237600000099" }
  })).body;

  state.adminToken = state.admin.token;
  state.citizenToken = state.citizen.token;
});

after(async () => {
  if (mainServer) await new Promise(resolve => mainServer.close(resolve));
});

// ---- registration and login boundaries -------------------------------------

test("public registration cannot create a privileged account", async () => {
  const { status, body } = await call(mainBase, "POST", "/api/auth/register", {
    body: { username: "sneaky.operator", password: "Citizen!2026", fullName: "Sneaky Operator", role: "socadel" }
  });
  assert.equal(status, 403);
  assert.match(body.error, /citizen accounts/i);
});

test("registration rejects a weak password with a human-readable message", async () => {
  const { status, body } = await call(mainBase, "POST", "/api/auth/register", {
    body: { username: "weak.pass", password: "short", fullName: "Weak Pass" }
  });
  assert.equal(status, 400);
  assert.match(body.error, /password/i);
});

test("registration rejects a malformed username", async () => {
  const { status } = await call(mainBase, "POST", "/api/auth/register", {
    body: { username: "No Spaces Allowed", password: "Citizen!2026", fullName: "Bad Username" }
  });
  assert.equal(status, 400);
});

test("a duplicate username is a conflict, not a crash", async () => {
  const payload = { username: "duplicate.user", password: "Citizen!2026", fullName: "Duplicate User" };
  assert.equal((await call(mainBase, "POST", "/api/auth/register", { body: payload })).status, 201);
  const second = await call(mainBase, "POST", "/api/auth/register", { body: payload });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /already taken/i);
});

test("login with a wrong password is indistinguishable from an unknown account", async () => {
  const wrong = await call(mainBase, "POST", "/api/auth/login", {
    body: { username: "edge.citizen", password: "definitely-wrong" }
  });
  const missing = await call(mainBase, "POST", "/api/auth/login", {
    body: { username: "nobody.here", password: "definitely-wrong" }
  });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.equal(wrong.body.error, missing.body.error, "the two failures must not be tellable apart");
});

test("login without credentials is a bad request, not a 500", async () => {
  const { status } = await call(mainBase, "POST", "/api/auth/login", { body: { username: "edge.citizen" } });
  assert.equal(status, 400);
});

// ---- authorization boundaries ----------------------------------------------

test("a protected route refuses an anonymous caller", async () => {
  const { status, body } = await call(mainBase, "GET", "/api/notifications");
  assert.equal(status, 401);
  assert.ok(body.error);
});

test("an administrator route refuses a citizen token", async () => {
  for (const path of ["/api/admin/stats", "/api/admin/analytics", "/api/admin/users", "/api/admin/audit"]) {
    const { status } = await call(mainBase, "GET", path, { token: state.citizenToken });
    assert.equal(status, 403, `${path} must require the socadel role`);
  }
});

test("an administrator route refuses a forged token", async () => {
  const { status } = await call(mainBase, "GET", "/api/admin/stats", { token: "not.a.valid.token" });
  assert.equal(status, 401);
});

test("an expired token is refused even though it is correctly signed", async () => {
  const expired = sign(
    { sub: state.citizen.user.id, role: "client", name: "Edge Citizen" },
    { secret: config.auth.secret, issuer: config.auth.issuer, ttlMs: -60_000 }
  );
  const { status, body } = await call(mainBase, "GET", "/api/auth/me", { token: expired });
  assert.equal(status, 401);
  assert.match(body.error, /expired/i);
});

test("a token whose account still exists is accepted", async () => {
  const { status, body } = await call(mainBase, "GET", "/api/auth/me", { token: state.citizenToken });
  assert.equal(status, 200);
  assert.equal(body.user.username, "edge.citizen");
  assert.equal(body.user.user_role, "client");
});

test("an incident detail route refuses a citizen token", async () => {
  const created = await submitReport(mainBase);
  const { status } = await call(mainBase, "GET", `/api/incidents/${created.body.incident_id}`, {
    token: state.citizenToken
  });
  assert.equal(status, 403);
});

// ---- geolocation validation ------------------------------------------------

test("a report without coordinates is refused", async () => {
  const { status, body } = await call(mainBase, "POST", "/api/public/reports", {
    body: { category: "Total outage", district: "Bastos, Yaounde", reporterName: "No GPS" }
  });
  assert.equal(status, 400);
  assert.match(body.error, /coordinates/i);
});

test("coordinates outside Cameroon are refused", async () => {
  const { status, body } = await submitReport(mainBase, { latitude: 48.8566, longitude: 2.3522 });
  assert.equal(status, 400);
  assert.match(body.error, /inside Cameroon/i);
});

test("non-numeric coordinates are refused", async () => {
  const { status } = await submitReport(mainBase, { latitude: "north", longitude: "east" });
  assert.equal(status, 400);
});

test("a report without a neighbourhood is refused", async () => {
  const { latitude, longitude } = BASTOS;
  const { status, body } = await call(mainBase, "POST", "/api/public/reports", {
    body: { category: "Total outage", reporterName: "Anonymous citizen", latitude, longitude, district: "   " }
  });
  assert.equal(status, 400);
  assert.match(body.error, /district or neighbourhood/i);
});

// ---- clustering through the HTTP surface -----------------------------------

test("a duplicate report is grouped into the same incident rather than creating a second one", async () => {
  const first = await submitReport(mainBase, { ...BONAMOUSSADI, reporterName: "First Reporter" });
  assert.equal(first.status, 201, "the first report opens a new cluster");

  const second = await submitReport(mainBase, { ...BONAMOUSSADI, reporterName: "Second Reporter" });
  assert.equal(second.status, 200, "the second report joins the existing cluster");
  assert.equal(second.body.matched_existing, true);
  assert.equal(second.body.incident_id, first.body.incident_id);
  assert.equal(second.body.reports_count, first.body.reports_count + 1);
  assert.match(second.body.message, /existing outage cluster/i);
});

test("a report beyond the cluster radius starts a separate incident", async () => {
  const near = await submitReport(mainBase, { reporterName: "Near Reporter" });
  const far = await call(mainBase, "POST", "/api/public/reports", {
    body: { category: "Total outage", reporterName: "Far Reporter", ...FAR }
  });
  assert.equal(far.status, 201);
  assert.notEqual(far.body.incident_id, near.body.incident_id);
});

test("the clustering radius is published and can be retuned by an operator", async () => {
  const before = await call(mainBase, "GET", "/api/public/config");
  assert.equal(before.body.clustering.cluster_distance_m, config.cluster.cluster_distance_m);

  const updated = await call(mainBase, "PUT", "/api/admin/clustering-config", {
    token: state.adminToken,
    body: { cluster_distance_m: 750 }
  });
  assert.equal(updated.status, 200);

  const after = await call(mainBase, "GET", "/api/public/config");
  assert.equal(after.body.clustering.cluster_distance_m, 750);

  await call(mainBase, "PUT", "/api/admin/clustering-config", {
    token: state.adminToken,
    body: { cluster_distance_m: config.cluster.cluster_distance_m }
  });
});

test("a negative clustering radius is rejected", async () => {
  const { status } = await call(mainBase, "PUT", "/api/admin/clustering-config", {
    token: state.adminToken,
    body: { cluster_distance_m: -10 }
  });
  assert.equal(status, 400);
});

// ---- status transitions ----------------------------------------------------

test("an invalid status transition is refused with the allowed moves", async () => {
  const created = await submitReport(mainBase, { reporterName: "Transition Tester" });
  const incidentId = created.body.incident_id;

  const rejected = await call(mainBase, "POST", `/api/incidents/${incidentId}/reject`, {
    token: state.adminToken,
    body: { reason: "Duplicate of a known planned maintenance window." }
  });
  assert.equal(rejected.status, 200);

  const revalidated = await call(mainBase, "POST", `/api/incidents/${incidentId}/validate`, {
    token: state.adminToken,
    body: { agencyReport: "Reopening a rejected incident is not allowed." }
  });
  assert.equal(revalidated.status, 409);
  assert.equal(revalidated.body.code, "INVALID_TRANSITION");
  assert.deepEqual(revalidated.body.allowed, []);
});

test("validating an incident that does not exist is a 404", async () => {
  const { status } = await call(mainBase, "POST", "/api/incidents/999999/validate", {
    token: state.adminToken,
    body: {}
  });
  assert.equal(status, 404);
});

test("a citizen cannot drive the incident workflow", async () => {
  const created = await submitReport(mainBase, { reporterName: "Workflow Intruder" });
  const { status } = await call(mainBase, "POST", `/api/incidents/${created.body.incident_id}/validate`, {
    token: state.citizenToken,
    body: {}
  });
  assert.equal(status, 403);
});

// ---- empty and malformed input ---------------------------------------------

test("analytics on an empty database returns zeros instead of failing", async () => {
  const emptyAdmin = await call(emptyBase, "POST", "/api/auth/login", {
    body: { username: "edge.admin", password: "Console!2026" }
  });
  const { status, body } = await call(emptyBase, "GET", "/api/admin/analytics", { token: emptyAdmin.body.token });
  assert.equal(status, 200);
  assert.equal(body.kpis.active_incidents, 0);
  assert.equal(body.kpis.reports_total, 0);
  assert.ok(Array.isArray(body.trend));
  assert.ok(body.trend.every(day => day.reports === 0 && day.incidents === 0), "zero days must still be plotted");
  assert.deepEqual(body.districts, []);
});

test("the public map on an empty database is an empty list, not an error", async () => {
  const { status, body } = await call(emptyBase, "GET", "/api/public/incidents");
  assert.equal(status, 200);
  assert.deepEqual(body.incidents, []);
});

test("malformed JSON is answered with a 400 envelope", async () => {
  const { status, body } = await call(mainBase, "POST", "/api/public/reports", { raw: "{ not json" });
  assert.equal(status, 400);
  assert.ok(body.error);
});

test("an unknown endpoint returns a 404 envelope", async () => {
  const { status, body } = await call(mainBase, "GET", "/api/not-a-real-endpoint", { token: state.adminToken });
  assert.equal(status, 404);
  assert.match(body.error, /does not exist/i);
});
