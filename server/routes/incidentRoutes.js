/**
 * Authenticated incident workflow endpoints.
 *
 * Role rules enforced here (the domain layer double-checks the state machine):
 *   validate / reject / assign / close  -> SOCADEL operators only
 *   field status updates                -> the assigned crew (or an operator)
 *   chat                               -> any signed-in participant
 */

const express = require("express");
const { asyncHandler } = require("../http/errors");

module.exports = function createIncidentRoutes({ auth, incidents, store }) {
  const router = express.Router();
  const operator = auth.requireRole("socadel");
  const field = auth.requireRole("subcontractor", "socadel");

  // Console queue: staff only. Citizens read the map through
  // /api/public/incidents, which is coarse and carries no reporter data.
  router.get("/", auth.requireRole("socadel", "subcontractor"), asyncHandler(async (req, res) => {
    const rows = await incidents.listIncidents({
      status: req.query.status,
      severity: req.query.severity,
      search: req.query.search
    });
    res.json({ incidents: rows });
  }));

  /** Reports the signed-in citizen submitted. */
  router.get("/mine", auth.requireAuth, asyncHandler(async (req, res) => {
    const { rows, total } = await store.listReports({ userId: req.auth.id, limit: 100 });
    res.json({ reports: rows, total });
  }));

  // Full detail includes reporter names and phone numbers: staff only.
  router.get("/:id", auth.requireRole("socadel", "subcontractor"), asyncHandler(async (req, res) => {
    res.json(await incidents.incidentDetail(req.params.id));
  }));

  router.post("/:id/messages", auth.requireAuth, asyncHandler(async (req, res) => {
    res.status(201).json(await incidents.addMessage(req.params.id, { actor: req.auth, body: req.body?.body }));
  }));

  router.post("/:id/validate", operator, asyncHandler(async (req, res) => {
    res.json(await incidents.validateIncident(req.params.id, { actor: req.auth, ...req.body }));
  }));

  router.post("/:id/reject", operator, asyncHandler(async (req, res) => {
    res.json(await incidents.rejectIncident(req.params.id, { actor: req.auth, reason: req.body?.reason }));
  }));

  router.post("/:id/assign", operator, asyncHandler(async (req, res) => {
    res.json(await incidents.assignIncident(req.params.id, { actor: req.auth, contractor: req.body?.contractor }));
  }));

  /** on_the_way | under_intervention | completed */
  router.post("/:id/field-status", field, asyncHandler(async (req, res) => {
    res.json(await incidents.updateFromField(req.params.id, {
      actor: req.auth,
      status: req.body?.status,
      notes: req.body
    }));
  }));

  router.post("/:id/close", operator, asyncHandler(async (req, res) => {
    res.json(await incidents.closeIncident(req.params.id, {
      actor: req.auth,
      summary: req.body?.summary,
      override: req.body?.override
    }));
  }));

  router.post("/:id/reopen", field, asyncHandler(async (req, res) => {
    res.json(await incidents.reopenIncident(req.params.id, { actor: req.auth, reason: req.body?.reason }));
  }));

  return router;
};
