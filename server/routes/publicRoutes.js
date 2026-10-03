/**
 * Public (unauthenticated) endpoints powering the citizen map.
 *
 * Everything here is deliberately coarse: incidents are returned with rounded
 * coordinates and without reporter names, phone numbers or exact positions, so
 * the public map can never be used to locate a specific household.
 */

const express = require("express");
const { asyncHandler } = require("../http/errors");
const { REPORT_CATEGORIES } = require("../services/incidentService");
const { INCIDENT_STATUSES } = require("../domain/incidentLifecycle");

module.exports = function createPublicRoutes({ auth, incidents, store, config }) {
  const router = express.Router();

  router.get("/config", asyncHandler(async (_req, res) => {
    res.json({
      report_categories: REPORT_CATEGORIES,
      incident_statuses: INCIDENT_STATUSES,
      clustering: await incidents.clusterConfig(),
      subcontractor_name: config.subcontractorName,
      location_precision: config.locationPrecision
    });
  }));

  router.get("/incidents", asyncHandler(async (_req, res) => {
    res.json({ incidents: await incidents.publicIncidents() });
  }));

  router.get("/incidents/:id", asyncHandler(async (req, res) => {
    res.json(await incidents.publicIncidentDetail(req.params.id));
  }));

  /** Citizen report intake. Works signed-in or as a guest. */
  router.post("/reports", auth.optionalAuth, asyncHandler(async (req, res) => {
    const result = await incidents.submitReport(req.body || {}, { auth: req.auth });
    res.status(result.isNew ? 201 : 200).json({
      reference: result.incident.reference,
      incident_id: result.incident.id,
      incident_status: result.incident.status,
      reports_count: result.incident.reports_count,
      severity: result.incident.severity,
      matched_existing: !result.isNew,
      distance_m: result.matchedDistanceM,
      message: result.isNew
        ? "Report received. Neighbours reporting the same area will be grouped automatically."
        : "Report added to an existing outage cluster — thank you for confirming."
    });
  }));

  /** "Me too" / "power is back" — one confirmation per person per type. */
  router.post("/incidents/:id/confirmations", auth.optionalAuth, asyncHandler(async (req, res) => {
    const result = await incidents.confirmIncident(req.params.id, {
      type: req.body?.type,
      deviceId: req.body?.deviceId || req.body?.reporter_key,
      comment: req.body?.comment,
      auth: req.auth
    });
    res.status(201).json({ ok: true, confirmations: result.counts });
  }));

  router.get("/announcements", asyncHandler(async (_req, res) => {
    res.json({ announcements: await store.listAnnouncements({ publishedOnly: true }) });
  }));

  return router;
};
