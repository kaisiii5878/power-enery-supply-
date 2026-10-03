/**
 * Unit tests for the rule-based geographic helpers (`server/domain/geo.js`).
 *
 * These are the arithmetic primitives the clustering engine depends on, so they
 * are checked directly rather than only through the HTTP surface.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  distanceMeters,
  boundingBox,
  severityForCluster,
  isInsideCameroon,
  SEVERITY_ORDER,
  METERS_PER_DEGREE
} = require("../domain/geo");

const YAOUNDE = { latitude: 3.848, longitude: 11.502 };
const DOUALA = { latitude: 4.0511, longitude: 9.7679 };

test("distance between a point and itself is zero", () => {
  assert.equal(distanceMeters(YAOUNDE.latitude, YAOUNDE.longitude, YAOUNDE.latitude, YAOUNDE.longitude), 0);
});

test("distance between Yaounde and Douala is roughly 190 km", () => {
  const km = distanceMeters(YAOUNDE.latitude, YAOUNDE.longitude, DOUALA.latitude, DOUALA.longitude) / 1000;
  assert.ok(km > 185 && km < 200, `expected ~194 km, received ${km.toFixed(1)} km`);
});

test("distance is symmetric", () => {
  const forward = distanceMeters(YAOUNDE.latitude, YAOUNDE.longitude, DOUALA.latitude, DOUALA.longitude);
  const backward = distanceMeters(DOUALA.latitude, DOUALA.longitude, YAOUNDE.latitude, YAOUNDE.longitude);
  assert.ok(Math.abs(forward - backward) < 0.001);
});

test("a metre per degree conversion matches the great-circle estimate at short range", () => {
  const offset = 500 / METERS_PER_DEGREE; // ~500 m due north
  const metres = distanceMeters(YAOUNDE.latitude, YAOUNDE.longitude, YAOUNDE.latitude + offset, YAOUNDE.longitude);
  assert.ok(metres > 480 && metres < 520, `expected ~500 m, received ${metres.toFixed(1)} m`);
});

test("bounding box contains the origin and spans the requested distance", () => {
  const box = boundingBox(YAOUNDE.latitude, YAOUNDE.longitude, 500);
  assert.ok(box.minLat < YAOUNDE.latitude && box.maxLat > YAOUNDE.latitude);
  assert.ok(box.minLon < YAOUNDE.longitude && box.maxLon > YAOUNDE.longitude);
  // The box must be wide enough that a point 500 m away is never excluded.
  assert.ok(distanceMeters(box.minLat, YAOUNDE.longitude, box.maxLat, YAOUNDE.longitude) >= 500);
});

test("bounding box widens longitude span near the equator handling is safe", () => {
  const box = boundingBox(0, 0, 1000);
  const latSpan = box.maxLat - box.minLat;
  const lonSpan = box.maxLon - box.minLon;
  assert.ok(Number.isFinite(latSpan) && Number.isFinite(lonSpan) && latSpan > 0 && lonSpan > 0);
});

test("isInsideCameroon accepts real Cameroonian coordinates", () => {
  assert.equal(isInsideCameroon(3.848, 11.502), true); // Yaounde
  assert.equal(isInsideCameroon(4.0511, 9.7679), true); // Douala
  assert.equal(isInsideCameroon(10.5, 14.3), true); // Far North
});

test("isInsideCameroon rejects coordinates outside the country and non-numbers", () => {
  assert.equal(isInsideCameroon(-1.2921, 36.8219), false); // Nairobi
  assert.equal(isInsideCameroon(48.8566, 2.3522), false); // Paris
  assert.equal(isInsideCameroon(Number.NaN, 11.5), false);
  assert.equal(isInsideCameroon("4.05", "9.7"), false); // strings are not accepted
});

test("severityForCluster is deterministic and ordered", () => {
  assert.equal(severityForCluster(0, 50).severity, "low");
  assert.equal(severityForCluster(10, 50).severity, "medium");
  assert.equal(severityForCluster(23, 50).severity, "high");
  assert.equal(severityForCluster(38, 50).severity, "critical");
});

test("severityForCluster escalates with geographic spread too", () => {
  const tight = severityForCluster(1, 50);
  const wide = severityForCluster(1, 4000);
  assert.ok(wide.score > tight.score, "a wide cluster should score higher than a tight one");
});

test("severityForCluster reports an estimated area and never exceeds a score of 100", () => {
  const result = severityForCluster(500, 5000);
  assert.equal(result.areaM2, Math.round(Math.PI * 5000 * 5000));
  assert.ok(result.score <= 100);
  assert.ok(SEVERITY_ORDER.includes(result.severity));
});
