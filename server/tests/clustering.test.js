/**
 * Unit tests for the geographic + temporal clustering rules.
 *
 * The engine is pure on purpose, so every branch (inside the window, inside the
 * radius, both, neither) can be exercised without a database.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_CLUSTER_CONFIG,
  normalizeConfig,
  isClusterMatch,
  matchIncident,
  recalcCluster,
  nextReference
} = require("../domain/clustering");

const CONFIG = { cluster_distance_m: 500, cluster_window_minutes: 30, min_reports_to_qualify: 2 };
const NOW = Date.UTC(2026, 8, 22, 18, 48, 0); // 2026-09-22T18:48:00Z

const incidentAt = (latitude, longitude, minutesAgo, overrides = {}) => ({
  id: 1,
  reference: "INC-2026-00000001",
  latitude,
  longitude,
  status: "pending",
  severity: "low",
  reports_count: 1,
  last_report_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
  created_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
  ...overrides
});

const BASTOS = { latitude: 3.8841, longitude: 11.5168 };

test("defaults are the documented thresholds", () => {
  assert.deepEqual(DEFAULT_CLUSTER_CONFIG, {
    cluster_distance_m: 500,
    cluster_window_minutes: 30,
    min_reports_to_qualify: 1
  });
});

test("normalizeConfig coerces strings from the settings table into numbers", () => {
  const normalized = normalizeConfig({ cluster_distance_m: "800", cluster_window_minutes: "45", min_reports_to_qualify: "3" });
  assert.deepEqual(normalized, { cluster_distance_m: 800, cluster_window_minutes: 45, min_reports_to_qualify: 3 });
});

test("normalizeConfig falls back when a key is missing", () => {
  const normalized = normalizeConfig({ cluster_distance_m: 800 }, CONFIG);
  assert.equal(normalized.cluster_distance_m, 800);
  assert.equal(normalized.cluster_window_minutes, CONFIG.cluster_window_minutes);
});

test("a report within the radius and the time window matches", () => {
  const incident = incidentAt(BASTOS.latitude, BASTOS.longitude, 5);
  assert.equal(isClusterMatch(incident, BASTOS, CONFIG, NOW), true);
});

test("a report inside the window but outside the radius does not match", () => {
  const incident = incidentAt(BASTOS.latitude + 0.02, BASTOS.longitude, 5); // ~2.2 km away
  assert.equal(isClusterMatch(incident, BASTOS, CONFIG, NOW), false);
});

test("a report inside the radius but older than the window does not match", () => {
  const incident = incidentAt(BASTOS.latitude, BASTOS.longitude, 45);
  assert.equal(isClusterMatch(incident, BASTOS, CONFIG, NOW), false);
});

test("an incident that is no longer open never clusters new reports", () => {
  for (const status of ["validated", "under_intervention", "closed", "rejected"]) {
    const incident = incidentAt(BASTOS.latitude, BASTOS.longitude, 1, { status });
    assert.equal(isClusterMatch(incident, BASTOS, CONFIG, NOW), false, `${status} should not cluster`);
  }
});

test("matchIncident picks the most recently active candidate", () => {
  const candidates = [
    incidentAt(BASTOS.latitude, BASTOS.longitude, 20, { id: 1 }),
    incidentAt(BASTOS.latitude, BASTOS.longitude, 3, { id: 2 }),
    incidentAt(BASTOS.latitude, BASTOS.longitude, 10, { id: 3 })
  ];
  const match = matchIncident(candidates, BASTOS, CONFIG, NOW);
  assert.equal(match.incident.id, 2);
  assert.ok(match.distanceM >= 0);
});

test("matchIncident prefers the nearer incident when recency ties", () => {
  const candidates = [
    incidentAt(BASTOS.latitude + 0.003, BASTOS.longitude, 5, { id: 1 }), // ~335 m
    incidentAt(BASTOS.latitude, BASTOS.longitude, 5, { id: 2 }) // 0 m
  ];
  const match = matchIncident(candidates, BASTOS, CONFIG, NOW);
  assert.equal(match.incident.id, 2);
  assert.equal(match.distanceM, 0);
});

test("matchIncident returns null when nothing is within range", () => {
  const candidates = [incidentAt(BASTOS.latitude + 0.5, BASTOS.longitude, 1)];
  assert.equal(matchIncident(candidates, BASTOS, CONFIG, NOW), null);
});

test("matchIncident tolerates an empty candidate list", () => {
  assert.equal(matchIncident([], BASTOS, CONFIG, NOW), null);
  assert.equal(matchIncident(undefined, BASTOS, CONFIG, NOW), null);
});

test("recalcCluster derives the centroid, radius, count and severity", () => {
  const members = [
    { latitude: 3.8841, longitude: 11.5168 },
    { latitude: 3.8861, longitude: 11.5168 },
    { latitude: 3.8821, longitude: 11.5168 }
  ];
  const cluster = recalcCluster(members, CONFIG);
  assert.equal(cluster.reports_count, 3);
  assert.ok(Math.abs(cluster.latitude - 3.8841) < 1e-9, "centroid latitude should be the mean");
  assert.ok(cluster.radius_m >= 50, "a radius is always reported");
  assert.ok(["low", "medium", "high", "critical"].includes(cluster.severity));
});

test("recalcCluster never reports a radius below 50 m so the map stays legible", () => {
  const cluster = recalcCluster([{ latitude: BASTOS.latitude, longitude: BASTOS.longitude }], CONFIG);
  assert.ok(cluster.radius_m >= 50);
});

test("recalcCluster qualifies once the minimum report count is met", () => {
  const one = recalcCluster([{ latitude: 3.884, longitude: 11.516 }], CONFIG);
  const two = recalcCluster([
    { latitude: 3.884, longitude: 11.516 },
    { latitude: 3.8845, longitude: 11.5165 }
  ], CONFIG);
  assert.equal(one.qualified, false, "one report is below the configured minimum of 2");
  assert.equal(two.qualified, true);
});

test("recalcCluster handles an empty member set without throwing", () => {
  const cluster = recalcCluster([], CONFIG);
  assert.equal(cluster.reports_count, 0);
  assert.equal(cluster.qualified, false);
  assert.equal(cluster.severity, "low");
});

test("nextReference produces a unique, prefixed incident code", () => {
  const first = nextReference(new Date("2026-09-22T18:48:00Z"));
  const second = nextReference(new Date("2026-09-22T18:48:01Z"));
  assert.match(first, /^INC-2026-\d{8}$/);
  assert.notEqual(first, second, "the reference must change with time");
});
