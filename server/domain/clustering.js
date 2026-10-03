/**
 * Rule-based geographic + temporal clustering (Workflow C).
 *
 * Pure functions only: the repository layer feeds in candidate rows and gets
 * back a decision. This keeps the intelligence independently testable and
 * identical whether the application runs on MySQL or the built-in store.
 */

const { distanceMeters, boundingBox, severityForCluster } = require("./geo");
const { CLUSTERABLE_STATUSES } = require("./incidentLifecycle");

const DEFAULT_CLUSTER_CONFIG = {
  cluster_distance_m: 500,
  cluster_window_minutes: 30,
  min_reports_to_qualify: 1
};

function normalizeConfig(input = {}, fallback = DEFAULT_CLUSTER_CONFIG) {
  const merged = { ...fallback, ...input };
  return {
    cluster_distance_m: Number(merged.cluster_distance_m),
    cluster_window_minutes: Number(merged.cluster_window_minutes),
    min_reports_to_qualify: Number(merged.min_reports_to_qualify)
  };
}

/**
 * True when a candidate incident is still open, reported inside the temporal
 * window, and geographically within the configured radius of the new report.
 */
function isClusterMatch(incident, point, config, now = Date.now()) {
  if (!CLUSTERABLE_STATUSES.includes(incident.status)) return false;
  const windowStart = now - config.cluster_window_minutes * 60_000;
  const lastReportAt = new Date(incident.last_report_at || incident.created_at || 0).getTime();
  if (!(lastReportAt >= windowStart)) return false;
  const distance = distanceMeters(point.latitude, point.longitude, Number(incident.latitude), Number(incident.longitude));
  return distance <= config.cluster_distance_m;
}

/**
 * Chooses the most recently active incident a new report belongs to.
 * Returns the incident plus its distance in metres, or null when the report is
 * the first of a new potential incident.
 */
function matchIncident(incidents, point, config, now = Date.now()) {
  let best = null;
  for (const incident of incidents || []) {
    if (!isClusterMatch(incident, point, config, now)) continue;
    const distance = distanceMeters(point.latitude, point.longitude, Number(incident.latitude), Number(incident.longitude));
    const lastReportAt = new Date(incident.last_report_at || incident.created_at || 0).getTime();
    const better =
      !best ||
      lastReportAt > best.incidentLastReportAt ||
      (lastReportAt === best.incidentLastReportAt && distance < best.distanceM);
    if (better) {
      best = { incident, distanceM: Math.round(distance), incidentLastReportAt: lastReportAt };
    }
  }
  return best;
}

/** Centroid, affected radius, severity and qualification for a member set. */
function recalcCluster(members, config) {
  const points = (members || [])
    .map(member => ({ latitude: Number(member.latitude), longitude: Number(member.longitude) }))
    .filter(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (!points.length) {
    return {
      latitude: 0,
      longitude: 0,
      radius_m: Math.max(50, Math.round(config.cluster_distance_m / 2)),
      reports_count: 0,
      ...severityForCluster(0, 50),
      qualified: false
    };
  }
  const centerLat = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const centerLon = points.reduce((sum, point) => sum + point.longitude, 0) / points.length;
  const radius = Math.max(50, Math.ceil(Math.max(...points.map(point => distanceMeters(centerLat, centerLon, point.latitude, point.longitude)))));
  const count = members.length;
  const severity = severityForCluster(count, radius);
  return {
    latitude: centerLat,
    longitude: centerLon,
    radius_m: radius,
    reports_count: count,
    severity: severity.severity,
    estimated_area_m2: severity.areaM2,
    severity_score: severity.score,
    qualified: count >= config.min_reports_to_qualify
  };
}

/** A new reference code such as INC-2026-00004821. */
function nextReference(date = new Date()) {
  return `INC-${date.getFullYear()}-${String(date.getTime()).slice(-8)}`;
}

module.exports = {
  DEFAULT_CLUSTER_CONFIG,
  normalizeConfig,
  isClusterMatch,
  matchIncident,
  recalcCluster,
  nextReference,
  boundingBox
};
