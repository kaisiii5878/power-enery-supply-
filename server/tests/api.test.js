/**
 * HTTP integration tests for the whole API surface.
 *
 * The app is booted exactly the way `server/index.js` boots it, against the
 * in-memory store, so the suite runs anywhere — no MySQL, no fixtures, and no
 * mocking of our own modules. Run with: npm test
 */

process.env.NODE_ENV = "test";
process.env.STORAGE_DRIVER = "memory";
process.env.ADMIN_USERNAME = "console.admin";
process.env.ADMIN_PASSWORD = "Console!2026";
process.env.JWT_SECRET = "integration-test-secret-not-used-anywhere-else";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../config/env");
const MemoryStore = require("../store/memoryStore");
const { createApp } = require("../app");

const silent = { log() {}, warn() {}, error() {} };
const DOUALA = { latitude: 4.0535, longitude: 9.6846 };
const offset = (point, metresNorth, metresEast) => ({
  latitude: point.latitude + metresNorth / 111_320,
  longitude: point.longitude + metresEast / (111_320 * Math.cos((point.latitude * Math.PI) / 180))
});

let store;
let server;
let base;
const state = {};

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, body: payload };
}

before(async () => {
  store = new MemoryStore({ clusterConfig: config.cluster, seed: false });
  const { app, dependencies } = createApp({ store, log: silent });
  await dependencies.accounts.bootstrapAdministrator();
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

// ---- health & public configuration -----------------------------------------

test("health reports the active storage engine", async () => {
  const { status, body } = await call("GET", "/api/health");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.database, "memory");
  assert.equal(body.environment, "test");
});

test("public configuration exposes categories and clustering rules", async () => {
  const { status, body } = await call("GET", "/api/public/config");
  assert.equal(status, 200);
  assert.ok(body.report_categories.includes("Sparking / unsafe line"));
  assert.equal(body.clustering.cluster_distance_m, config.cluster.cluster_distance_m);
  assert.equal(body.location_precision, config.locationPrecision);
});

// ---- accounts ---------------------------------------------------------------

test("a citizen can register and receives a token", async () => {
  const { status, body } = await call("POST", "/api/auth/register", {
    body: { username: "aida.ngombe", password: "Citizen!2026", fullName: "Aida Ngombe", phone: "+237600000001" }
  });
  assert.equal(status, 201);
  assert.ok(body.token);
  assert.equal(body.user.user_role, "client");
  assert.equal(body.user.password_hash, undefined);
  state.citizenToken = body.token;
});

test("public sign-up cannot create staff accounts", async () => {
  const { status, body } = await call("POST", "/api/auth/register", {
    body: { username: "fake.operator", password: "Operator!2026", fullName: "Fake Operator", role: "socadel" }
  });
  assert.equal(status, 403);
  assert.match(body.error, /citizen/i);
});

test("duplicate usernames and weak passwords are rejected", async () => {
  const duplicate = await call("POST", "/api/auth/register", {
    body: { username: "aida.ngombe", password: "Another!2026", fullName: "Name Clash" }
  });
  assert.equal(duplicate.status, 409);

  const weak = await call("POST", "/api/auth/register", {
    body: { username: "weak.peter", password: "12345", fullName: "Weak Peter" }
  });
  assert.equal(weak.status, 400);
});

test("a wrong password reveals nothing about the account", async () => {
  const wrong = await call("POST", "/api/auth/login", { body: { username: "console.admin", password: "nope" } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, "Username or password is incorrect.");

  const missing = await call("POST", "/api/auth/login", { body: { username: "ghost.user", password: "nope" } });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, wrong.body.error);
});

test("the seeded SOCADEL administrator can sign in", async () => {
  const { status, body } = await call("POST", "/api/auth/login", {
    body: { username: "console.admin", password: "Console!2026" }
  });
  assert.equal(status, 200);
  assert.equal(body.user.user_role, "socadel");
  state.adminToken = body.token;
});

test("protected endpoints reject anonymous callers, tampered tokens and the wrong role", async () => {
  assert.equal((await call("GET", "/api/incidents")).status, 401);

  const tampered = `${state.adminToken.slice(0, -2)}AA`;
  assert.equal((await call("GET", "/api/incidents", { token: tampered })).status, 401);
  assert.equal((await call("GET", "/api/incidents", { token: state.citizenToken })).status, 403);
  assert.equal((await call("GET", "/api/admin/analytics", { token: state.citizenToken })).status, 403);
});

test("me returns the live account behind the token", async () => {
  const { status, body } = await call("GET", "/api/auth/me", { token: state.citizenToken });
  assert.equal(status, 200);
  assert.equal(body.user.username, "aida.ngombe");
  assert.equal(body.user.password_hash, undefined);
});

// ---- citizen reporting and clustering --------------------------------------

test("a citizen report opens a cluster and gets a reference", async () => {
  const { status, body } = await call("POST", "/api/public/reports", {
    token: state.citizenToken,
    body: {
      ...DOUALA,
      category: "Total outage",
      district: "Bonanjo, Douala",
      description: "No power since 18:30",
      phone: "+237600000001"
    }
  });
  assert.equal(status, 201);
  assert.match(body.reference, /^INC-\d{4}-\d+$/);
  assert.equal(body.matched_existing, false);
  assert.equal(body.reports_count, 1);
  assert.equal(body.incident_status, "pending_validation");
  state.incidentId = body.incident_id;
  state.reference = body.reference;
});

test("a neighbour 120 m away joins the same cluster", async () => {
  const { status, body } = await call("POST", "/api/public/reports", {
    body: { ...offset(DOUALA, 100, 70), category: "Total outage", district: "Bonanjo, Douala", deviceId: "guest-device-1" }
  });
  assert.equal(status, 200);
  assert.equal(body.matched_existing, true);
  assert.equal(body.incident_id, state.incidentId);
  assert.equal(body.reports_count, 2);
  assert.ok(body.distance_m < 200, `expected a short match distance, got ${body.distance_m}`);
});

test("a report 3 km away opens its own cluster", async () => {
  const { status, body } = await call("POST", "/api/public/reports", {
    body: { ...offset(DOUALA, 3000, 0), category: "Low voltage", district: "Deido, Douala", deviceId: "guest-device-2" }
  });
  assert.equal(status, 201);
  assert.notEqual(body.incident_id, state.incidentId);
  state.farIncidentId = body.incident_id;
});

test("coordinates outside Cameroon are refused", async () => {
  const { status, body } = await call("POST", "/api/public/reports", {
    body: { latitude: 51.5, longitude: -0.12, category: "Other", district: "London" }
  });
  assert.equal(status, 400);
  assert.match(body.error, /Cameroon/i);
});

test("a missing district is refused before anything is written", async () => {
  const { status, body } = await call("POST", "/api/public/reports", {
    body: { ...DOUALA, category: "Other", deviceId: "guest-device-3" }
  });
  assert.equal(status, 400);
  assert.match(body.error, /district/i);
});

test("the public feed rounds coordinates and hides reporters", async () => {
  const { status, body } = await call("GET", "/api/public/incidents");
  assert.equal(status, 200);
  const listed = body.incidents.find(incident => incident.id === state.incidentId);
  assert.ok(listed, "the new incident should be on the public map");
  const precision = Math.pow(10, config.locationPrecision);
  const isCoarse = value => Math.abs(value * precision - Math.round(value * precision)) < 1e-6;
  assert.ok(Math.abs(listed.latitude - DOUALA.latitude) <= 0.6 / precision,
    "coarse coordinates must stay within a fraction of the configured precision");
  assert.ok(isCoarse(listed.latitude), "public latitude must be rounded to the configured precision");
  assert.ok(isCoarse(listed.longitude), "public longitude must be rounded to the configured precision");
  assert.equal(listed.reports_count, 2);
  assert.equal(listed.assignee, null);
  assert.equal(JSON.stringify(listed).includes("phone"), false);
  assert.equal(JSON.stringify(listed).includes("Bonanjo"), true);
});

test("the public incident detail never exposes reporter names", async () => {
  const { status, body } = await call("GET", `/api/public/incidents/${state.incidentId}`);
  assert.equal(status, 200);
  assert.equal(body.reports_count, 2);
  assert.equal(body.reports, undefined);
  assert.equal(JSON.stringify(body).includes("Aida"), false);
  assert.equal(body.can_confirm_affected, true);
  assert.equal(body.can_confirm_restored, false);
});

test("citizens confirm they are affected, once per device", async () => {
  const first = await call("POST", `/api/public/incidents/${state.incidentId}/confirmations`, {
    body: { type: "also_affected", deviceId: "guest-device-9" }
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.confirmations.also_affected, 1);

  const twice = await call("POST", `/api/public/incidents/${state.incidentId}/confirmations`, {
    body: { type: "also_affected", deviceId: "guest-device-9" }
  });
  assert.equal(twice.status, 409);

  const anonymousGuest = await call("POST", `/api/public/incidents/${state.incidentId}/confirmations`, {
    body: { type: "also_affected" }
  });
  assert.equal(anonymousGuest.status, 400);
});

// ---- the workflow: validate, assign, intervene, verify, close ---------------

test("only SOCADEL can validate a cluster", async () => {
  const asCitizen = await call("POST", `/api/incidents/${state.incidentId}/validate`, {
    token: state.citizenToken,
    body: { agencyReport: "nope" }
  });
  assert.equal(asCitizen.status, 403);

  const { status, body } = await call("POST", `/api/incidents/${state.incidentId}/validate`, {
    token: state.adminToken,
    body: { agencyReport: "Feeder F3 trip confirmed by SCADA", rootCause: "Feeder trip" }
  });
  assert.equal(status, 200);
  assert.equal(body.status, "validated");
  assert.equal(body.agency_report, "Feeder F3 trip confirmed by SCADA");
});

test("an incident cannot be assigned before validation or without a contractor", async () => {
  const early = await call("POST", `/api/incidents/${state.farIncidentId}/assign`, {
    token: state.adminToken,
    body: { contractor: "Eneo Crew 1" }
  });
  assert.equal(early.status, 409, "an unvalidated cluster must not be assignable");
  assert.equal(early.body.code, "ASSIGNMENT_NOT_ALLOWED");

  const missing = await call("POST", `/api/incidents/${state.incidentId}/assign`, {
    token: state.adminToken,
    body: {}
  });
  assert.equal(missing.status, 400);
});

test("an administrator creates the crew accounts and the crew signs in", async () => {
  const created = await call("POST", "/api/admin/users", {
    token: state.adminToken,
    body: { username: "ledinergy.crew1", password: "Crew!2026abc", fullName: "Ledinergy Crew 1", role: "subcontractor" }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.user_role, "subcontractor");

  const other = await call("POST", "/api/admin/users", {
    token: state.adminToken,
    body: { username: "ledinergy.crew2", password: "Crew!2026abd", fullName: "Ledinergy Crew 2", role: "subcontractor" }
  });
  assert.equal(other.status, 201);

  state.crewToken = (await call("POST", "/api/auth/login", {
    body: { username: "ledinergy.crew1", password: "Crew!2026abc" }
  })).body.token;
  state.otherCrewToken = (await call("POST", "/api/auth/login", {
    body: { username: "ledinergy.crew2", password: "Crew!2026abd" }
  })).body.token;
  assert.ok(state.crewToken && state.otherCrewToken);
});

test("assignment creates a work order addressed to the chosen contractor", async () => {
  const { status, body } = await call("POST", `/api/incidents/${state.incidentId}/assign`, {
    token: state.adminToken,
    body: { contractor: "Ledinergy Crew 1" }
  });
  assert.equal(status, 200);
  assert.equal(body.incident.status, "assigned");
  assert.equal(body.incident.assignee, "Ledinergy Crew 1");
  assert.equal(body.workRequest.incident_id, state.incidentId);
  assert.equal(body.workRequest.contractor, "Ledinergy Crew 1");
});

test("field updates are refused for the wrong contractor and for bad statuses", async () => {
  const wrongCrew = await call("POST", `/api/incidents/${state.incidentId}/field-status`, {
    token: state.otherCrewToken,
    body: { status: "on_the_way" }
  });
  assert.equal(wrongCrew.status, 400);
  assert.match(wrongCrew.body.error, /another contractor/i);

  const badStatus = await call("POST", `/api/incidents/${state.incidentId}/field-status`, {
    token: state.crewToken,
    body: { status: "closed" }
  });
  assert.equal(badStatus.status, 400);

  const citizenAttempt = await call("POST", `/api/incidents/${state.incidentId}/field-status`, {
    token: state.citizenToken,
    body: { status: "on_the_way" }
  });
  assert.equal(citizenAttempt.status, 403);
});

test("the crew walks the job through to citizen verification", async () => {
  const departed = await call("POST", `/api/incidents/${state.incidentId}/field-status`, {
    token: state.crewToken,
    body: { status: "on_the_way" }
  });
  assert.equal(departed.status, 200);
  assert.equal(departed.body.incident.status, "on_the_way");

  const onSite = await call("POST", `/api/incidents/${state.incidentId}/field-status`, {
    token: state.crewToken,
    body: { status: "under_intervention" }
  });
  assert.equal(onSite.body.incident.status, "under_intervention");
  assert.ok(onSite.body.workRequest.arrival_time, "arrival must be timestamped");

  const completed = await call("POST", `/api/incidents/${state.incidentId}/field-status`, {
    token: state.crewToken,
    body: {
      status: "completed",
      rootCause: "Blown fuse on the Bonanjo distributor",
      diagnosis: "Phase 2 fuse holder burnt",
      equipment: "NH fuse 400A",
      comments: "Replaced and tested under load"
    }
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.incident.status, "verification_pending", "completion must open verification");
  assert.equal(completed.body.workRequest.status, "completed");
  assert.equal(completed.body.incident.root_cause, "Blown fuse on the Bonanjo distributor");
});

test("closure waits for a citizen to confirm restoration", async () => {
  const tooEarly = await call("POST", `/api/incidents/${state.incidentId}/close`, {
    token: state.adminToken,
    body: { summary: "Fixed" }
  });
  assert.equal(tooEarly.status, 409);
  assert.equal(tooEarly.body.code, "RESTORATION_UNVERIFIED");

  const restored = await call("POST", `/api/public/incidents/${state.incidentId}/confirmations`, {
    body: { type: "restored", deviceId: "guest-device-1" }
  });
  assert.equal(restored.status, 201);
  assert.equal(restored.body.confirmations.restored, 1);

  const closed = await call("POST", `/api/incidents/${state.incidentId}/close`, {
    token: state.adminToken,
    body: { summary: "Fuse replaced, supply restored" }
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.status, "closed");
  assert.ok(closed.body.restored_at);
  assert.equal(closed.body.resolution, "Fuse replaced, supply restored");

  const again = await call("POST", `/api/incidents/${state.incidentId}/close`, {
    token: state.adminToken,
    body: { override: true }
  });
  assert.equal(again.status, 409, "a closed incident is terminal");
});

test("verification can fail: reopening sends the crew back on site", async () => {
  await call("POST", "/api/public/reports", {
    body: { ...offset(DOUALA, 20000, 0), category: "Sparking / unsafe line", district: "Ndogpassi, Douala", deviceId: "guest-device-4" }
  }).then(async opened => {
    state.reopenedId = opened.body.incident_id;
    await call("POST", `/api/incidents/${state.reopenedId}/validate`, { token: state.adminToken, body: {} });
    await call("POST", `/api/incidents/${state.reopenedId}/assign`, { token: state.adminToken, body: { contractor: "Ledinergy Crew 1" } });
    await call("POST", `/api/incidents/${state.reopenedId}/field-status`, { token: state.crewToken, body: { status: "on_the_way" } });
    await call("POST", `/api/incidents/${state.reopenedId}/field-status`, { token: state.crewToken, body: { status: "under_intervention" } });
    const done = await call("POST", `/api/incidents/${state.reopenedId}/field-status`, {
      token: state.crewToken,
      body: { status: "completed", comments: "Hazards cleared" }
    });
    assert.equal(done.body.incident.status, "verification_pending");

    const reopened = await call("POST", `/api/incidents/${state.reopenedId}/reopen`, {
      token: state.crewToken,
      body: { reason: "Neighbours report the line is still down" }
    });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.status, "under_intervention");
    assert.equal(reopened.body.restored_at, null);

    const closed = await call("POST", `/api/incidents/${state.reopenedId}/field-status`, {
      token: state.crewToken,
      body: { status: "completed", comments: "Second visit: replaced the whole section" }
    });
    assert.equal(closed.body.incident.status, "verification_pending");

    const overrideClose = await call("POST", `/api/incidents/${state.reopenedId}/close`, {
      token: state.adminToken,
      body: { override: true, summary: "Closed on operator judgement after two visits" }
    });
    assert.equal(overrideClose.status, 200);
    assert.equal(overrideClose.body.status, "closed");
  });
});

// ---- detail, chat, queues, analytics ---------------------------------------

test("the incident detail is staff-only and carries reports plus the audit trail", async () => {
  const asCitizen = await call("GET", `/api/incidents/${state.incidentId}`, { token: state.citizenToken });
  assert.equal(asCitizen.status, 403);

  const { status, body } = await call("GET", `/api/incidents/${state.incidentId}`, { token: state.adminToken });
  assert.equal(status, 200);
  assert.equal(body.incident.id, state.incidentId);
  assert.equal(body.reports_total, 2);
  assert.ok(body.reports.some(report => report.phone), "staff see the reporter contact details");
  assert.deepEqual(body.next_statuses, []);
  const actions = body.audit.map(entry => entry.action);
  assert.ok(actions.includes("incident.validated"), "validation must be audited");
  assert.ok(actions.includes("incident.assigned"), "assignment must be audited");
  assert.ok(actions.includes("incident.closed"), "closure must be audited");

  const missing = await call("GET", "/api/incidents/999999", { token: state.adminToken });
  assert.equal(missing.status, 404);
});

test("signed-in participants can discuss an incident", async () => {
  const empty = await call("POST", `/api/incidents/${state.incidentId}/messages`, {
    token: state.citizenToken,
    body: { body: "x" }
  });
  assert.equal(empty.status, 400);

  const posted = await call("POST", `/api/incidents/${state.incidentId}/messages`, {
    token: state.citizenToken,
    body: { body: "The whole street is still dark." }
  });
  assert.equal(posted.status, 201);
  assert.equal(posted.body.author_role, "client");

  const detail = await call("GET", `/api/incidents/${state.incidentId}`, { token: state.adminToken });
  assert.ok(detail.body.messages.some(message => message.body === "The whole street is still dark."));
});

test("a citizen only ever sees their own reports", async () => {
  const { status, body } = await call("GET", "/api/incidents/mine", { token: state.citizenToken });
  assert.equal(status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.reports[0].district, "Bonanjo, Douala");
});

test("notifications reach the right audience and can be marked read", async () => {
  const admin = await call("GET", "/api/notifications", { token: state.adminToken });
  assert.equal(admin.status, 200);
  assert.ok(admin.body.notifications.length >= 2, "operators get validation and verification alerts");
  assert.ok(admin.body.notifications.some(item => item.event_type === "restoration.verification") === false,
    "citizen alerts must not leak into the operator inbox");

  const crew = await call("GET", "/api/notifications", { token: state.crewToken });
  assert.ok(crew.body.notifications.some(item => item.event_type === "work.assigned"));

  const marked = await call("POST", "/api/notifications/read", { token: state.crewToken });
  assert.equal(marked.status, 200);
  const afterRead = await call("GET", "/api/notifications?limit=60", { token: state.crewToken });
  assert.ok(afterRead.body.notifications.every(item => Number(item.is_read) === 1));

  const anonymous = await call("GET", "/api/notifications");
  assert.equal(anonymous.status, 401);
});

test("the contractor queue only contains open work for that company", async () => {
  const queue = await call("GET", "/api/work/queue", { token: state.crewToken });
  assert.equal(queue.status, 200);
  assert.ok(Array.isArray(queue.body.work));
  assert.ok(queue.body.work.every(item => item.contractor === "Ledinergy Crew 1"));
  assert.ok(queue.body.work.every(item => item.incident && item.incident.status !== "closed"));

  const other = await call("GET", "/api/work/queue", { token: state.otherCrewToken });
  assert.equal(other.body.work.length, 0);

  const operator = await call("GET", "/api/work/queue", { token: state.adminToken });
  assert.equal(operator.status, 403, "operators do not have a crew queue");
});

test("analytics aggregates the workflow that just ran", async () => {
  const { status, body } = await call("GET", "/api/admin/analytics?days=14", { token: state.adminToken });
  assert.equal(status, 200);
  assert.equal(body.window_days, 14);
  assert.equal(body.kpis.closed_total, 2);
  assert.equal(body.kpis.reports_total, 4);
  assert.equal(body.trend.length, 14);
  assert.equal(body.trend[body.trend.length - 1].reports, 4);
  assert.ok(body.kpis.accounts.total >= 4, "the KPI tile needs a plain account total");
  assert.equal(typeof body.kpis.accounts.client, "number", "the accounts breakdown stays available");
  const crew = body.contractors.find(item => item.contractor === "Ledinergy Crew 1");
  assert.equal(crew.jobs, 2);
  assert.ok(Number.isFinite(crew.avg_repair_hours), "repair duration must be computed from the work orders");
  assert.ok(body.severity_distribution.every(item => ["critical", "high", "medium", "low"].includes(item.severity)));
});

// ---- administration --------------------------------------------------------

test("zones can be created, listed, updated and removed", async () => {
  const created = await call("POST", "/api/admin/zones", {
    token: state.adminToken,
    body: { name: "Douala Centre", latitude: 4.0483, longitude: 9.7043, radius_m: 4000, region: "Littoral" }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, "Douala Centre");
  const zoneId = created.body.id;

  const listed = await call("GET", "/api/admin/zones", { token: state.adminToken });
  assert.ok(listed.body.zones.some(zone => zone.id === zoneId));

  const clash = await call("POST", "/api/admin/zones", {
    token: state.adminToken,
    body: { name: "Douala Centre", latitude: 4.05, longitude: 9.71 }
  });
  assert.equal(clash.status, 409);

  const tooSmall = await call("POST", "/api/admin/zones", {
    token: state.adminToken,
    body: { name: "Too Small", latitude: 4.05, longitude: 9.71, radius_m: 20 }
  });
  assert.equal(tooSmall.status, 400);

  const updated = await call("PATCH", `/api/admin/zones/${zoneId}`, {
    token: state.adminToken,
    body: { name: "Douala Centre Zone", latitude: 4.0483, longitude: 9.7043, radius_m: 6000 }
  });
  assert.equal(updated.body.radius_m, 6000);

  const removed = await call("DELETE", `/api/admin/zones/${zoneId}`, { token: state.adminToken });
  assert.equal(removed.status, 200);
  const missing = await call("DELETE", `/api/admin/zones/${zoneId}`, { token: state.adminToken });
  assert.equal(missing.status, 404);
});

test("announcements are published or kept as drafts", async () => {
  const draft = await call("POST", "/api/admin/announcements", {
    token: state.adminToken,
    body: { title: "Planned works in Bonanjo", body: "Crews will be on Bonanjo main road.", published: false }
  });
  assert.equal(draft.status, 201);

  const published = await call("POST", "/api/admin/announcements", {
    token: state.adminToken,
    body: { title: "Restoration in Bonanjo", body: "Supply restored after fuse replacement.", audience: "client" }
  });
  assert.equal(published.status, 201);

  const publicList = await call("GET", "/api/public/announcements");
  assert.ok(publicList.body.announcements.some(item => item.title === "Restoration in Bonanjo"));
  assert.equal(publicList.body.announcements.some(item => item.title === "Planned works in Bonanjo"), false);

  const adminList = await call("GET", "/api/admin/announcements", { token: state.adminToken });
  assert.equal(adminList.body.announcements.length, 2);

  const tooShort = await call("POST", "/api/admin/announcements", {
    token: state.adminToken,
    body: { title: "Hi", body: "no" }
  });
  assert.equal(tooShort.status, 400);

  const removed = await call("DELETE", `/api/admin/announcements/${published.body.id}`, { token: state.adminToken });
  assert.equal(removed.status, 200);
});

test("detection rules can be tuned and reach the public configuration", async () => {
  const updated = await call("PUT", "/api/admin/clustering-config", {
    token: state.adminToken,
    body: { cluster_distance_m: 800, cluster_window_minutes: 45 }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.cluster_distance_m, 800);

  const publicConfig = await call("GET", "/api/public/config");
  assert.equal(publicConfig.body.clustering.cluster_distance_m, 800);

  const invalid = await call("PUT", "/api/admin/clustering-config", {
    token: state.adminToken,
    body: { cluster_distance_m: -5 }
  });
  assert.equal(invalid.status, 400);

  await call("PUT", "/api/admin/clustering-config", {
    token: state.adminToken,
    body: {
      cluster_distance_m: config.cluster.cluster_distance_m,
      cluster_window_minutes: config.cluster.cluster_window_minutes
    }
  });
});

test("accounts can be listed, searched and deactivated", async () => {
  const { status, body } = await call("GET", "/api/admin/users", { token: state.adminToken });
  assert.equal(status, 200);
  assert.equal(body.users.some(user => user.password_hash || user.password_salt), false);

  const crews = await call("GET", "/api/admin/users?role=subcontractor", { token: state.adminToken });
  assert.equal(crews.body.users.length, 2);

  const crew = crews.body.users.find(user => user.username === "ledinergy.crew1");
  const deactivated = await call("PATCH", `/api/admin/users/${crew.id}/active`, {
    token: state.adminToken,
    body: { is_active: false }
  });
  assert.equal(deactivated.status, 200);
  assert.equal(Number(deactivated.body.is_active), 0);

  const lockedOut = await call("POST", "/api/auth/login", {
    body: { username: "ledinergy.crew1", password: "Crew!2026abc" }
  });
  assert.equal(lockedOut.status, 403);

  const staleToken = await call("GET", "/api/notifications", { token: state.crewToken });
  assert.equal(staleToken.status, 403, "a token for a deactivated account stops working at once");

  const admin = body.users.find(user => user.username === "console.admin");
  const selfDeactivation = await call("PATCH", `/api/admin/users/${admin.id}/active`, {
    token: state.adminToken,
    body: { is_active: false }
  });
  assert.equal(selfDeactivation.status, 400);

  const contractors = await call("GET", "/api/admin/contractors", { token: state.adminToken });
  assert.equal(contractors.body.contractors.length, 2);
});

test("the audit trail is admin-only and readable", async () => {
  const { status, body } = await call("GET", "/api/admin/audit?limit=200", { token: state.adminToken });
  assert.equal(status, 200);
  assert.ok(body.audit.length > 5);
  assert.ok(body.audit.some(entry => entry.action === "auth.login"));
  assert.ok(body.audit.some(entry => entry.action === "settings.clustering_updated"));
  const asCrew = await call("GET", "/api/admin/audit", { token: state.otherCrewToken });
  assert.equal(asCrew.status, 403);
});

test("stats, 404s and malformed JSON are handled", async () => {
  const stats = await call("GET", "/api/admin/stats", { token: state.adminToken });
  assert.equal(stats.status, 200);

  const unknown = await call("GET", "/api/does-not-exist", { token: state.adminToken });
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /does not exist/);

  const malformed = await fetch(`${base}/api/public/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ not json"
  });
  assert.equal(malformed.status, 400);
});







