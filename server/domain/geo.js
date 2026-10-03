/**
 * Pure geographic helpers.
 * No framework or database dependencies — safe to unit test in isolation.
 */

const EARTH_RADIUS_M = 6371000;
const METERS_PER_DEGREE = 111000;

/** Great-circle distance between two WGS84 points, in metres. */
function distanceMeters(aLat, aLon, bLat, bLon) {
  const rad = value => (value * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

/**
 * Degree half-span covering `meters` around a latitude, so MySQL can use the
 * (last_report_at, latitude, longitude) index before the exact haversine check.
 */
function boundingBox(latitude, longitude, meters) {
  const latSpan = meters / METERS_PER_DEGREE;
  const lonSpan = meters / (METERS_PER_DEGREE * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)));
  return {
    minLat: latitude - latSpan,
    maxLat: latitude + latSpan,
    minLon: longitude - lonSpan,
    maxLon: longitude + lonSpan
  };
}

const SEVERITY_ORDER = ["low", "medium", "high", "critical"];

/**
 * Severity and estimated affected area for a cluster of citizen reports.
 *
 * This is a deliberate rule-based estimate, not a measurement: the proposal asks
 * for an explainable MVP heuristic rather than a predictive model. `areaM2` and
 * `score` are therefore reported to clients as estimates.
 */
function severityForCluster(reportCount, radiusMeters) {
  const areaM2 = Math.round(Math.PI * radiusMeters * radiusMeters);
  const score = Math.min(100, reportCount * 2 + (areaM2 / 1_000_000) * 10);
  if (score >= 75) return { severity: "critical", areaM2, score };
  if (score >= 45) return { severity: "high", areaM2, score };
  if (score >= 20) return { severity: "medium", areaM2, score };
  return { severity: "low", areaM2, score };
}

function isInsideCameroon(latitude, longitude) {
  return (
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= 1.6 && latitude <= 13.1 &&
    longitude >= 8.3 && longitude <= 16.3
  );
}

module.exports = {
  distanceMeters,
  boundingBox,
  severityForCluster,
  isInsideCameroon,
  SEVERITY_ORDER,
  METERS_PER_DEGREE
};
