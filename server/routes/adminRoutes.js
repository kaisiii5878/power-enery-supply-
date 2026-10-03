/**
 * SOCADEL administration endpoints: analytics, accounts, zones, announcements,
 * clustering rules and the audit trail. Every route requires the socadel role.
 */

const express = require("express");
const { asyncHandler } = require("../http/errors");

module.exports = function createAdminRoutes({ auth, admin, analytics, accounts, incidents, store }) {
  const router = express.Router();
  router.use(auth.requireRole("socadel"));

  router.get("/analytics", asyncHandler(async (req, res) => {
    const days = Math.min(90, Math.max(3, Number(req.query.days || 14)));
    res.json(await analytics.overview({ days }));
  }));

  router.get("/stats", asyncHandler(async (_req, res) => {
    res.json(await store.incidentStats());
  }));

  // ---- accounts -----------------------------------------------------------
  router.get("/users", asyncHandler(async (req, res) => {
    res.json({ users: await admin.listUsers({ role: req.query.role, search: req.query.search }) });
  }));

  router.post("/users", asyncHandler(async (req, res) => {
    res.status(201).json(await accounts.createStaff(req.body || {}, req.auth));
  }));

  router.patch("/users/:id/active", asyncHandler(async (req, res) => {
    res.json(await admin.setUserActive(req.params.id, { actor: req.auth, isActive: Boolean(req.body?.is_active) }));
  }));

  /** Contractor names offered in the assignment dropdown. */
  router.get("/contractors", asyncHandler(async (_req, res) => {
    const users = await store.listUsers({ role: "subcontractor" });
    res.json({ contractors: users.map(user => ({ id: user.id, username: user.username, name: user.full_name, is_active: Number(user.is_active) })) });
  }));

  // ---- zones --------------------------------------------------------------
  router.get("/zones", asyncHandler(async (_req, res) => {
    res.json({ zones: await store.listZones() });
  }));

  router.post("/zones", asyncHandler(async (req, res) => {
    res.status(201).json(await admin.createZone(req.body || {}, { actor: req.auth }));
  }));

  router.patch("/zones/:id", asyncHandler(async (req, res) => {
    res.json(await admin.updateZone(req.params.id, req.body || {}, { actor: req.auth }));
  }));

  router.delete("/zones/:id", asyncHandler(async (req, res) => {
    res.json(await admin.deleteZone(req.params.id, { actor: req.auth }));
  }));

  // ---- announcements ------------------------------------------------------
  router.get("/announcements", asyncHandler(async (_req, res) => {
    res.json({ announcements: await store.listAnnouncements() });
  }));

  router.post("/announcements", asyncHandler(async (req, res) => {
    res.status(201).json(await admin.saveAnnouncement(req.body || {}, { actor: req.auth }));
  }));

  router.patch("/announcements/:id", asyncHandler(async (req, res) => {
    res.json(await admin.saveAnnouncement(req.body || {}, { actor: req.auth, id: req.params.id }));
  }));

  router.delete("/announcements/:id", asyncHandler(async (req, res) => {
    res.json(await admin.deleteAnnouncement(req.params.id, { actor: req.auth }));
  }));

  // ---- detection rules + audit -------------------------------------------
  router.get("/clustering-config", asyncHandler(async (_req, res) => {
    res.json(await incidents.clusterConfig());
  }));

  router.put("/clustering-config", asyncHandler(async (req, res) => {
    res.json(await incidents.updateClusteringSettings({ actor: req.auth, settings: req.body || {} }));
  }));

  router.get("/audit", asyncHandler(async (req, res) => {
    res.json({ audit: await admin.listAudit({ incidentId: req.query.incident_id, limit: req.query.limit }) });
  }));

  return router;
};
