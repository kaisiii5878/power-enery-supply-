/**
 * API surface. Mounted at /api by `server/app.js`.
 *
 *   /api/health                      liveness and active storage engine
 *   /api/auth/*                      sign-up, sign-in, own account
 *   /api/public/*                    citizen map, no account required
 *   /api/geocode/*                   place search proxy
 *   /api/incidents/*                 the incident workflow (signed in)
 *   /api/notifications/*             in-app inbox
 *   /api/work/*                      subcontractor queue
 *   /api/admin/*                     SOCADEL console
 */

const express = require("express");

const createAuthRoutes = require("./authRoutes");
const createPublicRoutes = require("./publicRoutes");
const createGeocodeRoutes = require("./geocodeRoutes");
const createIncidentRoutes = require("./incidentRoutes");
const createSessionRoutes = require("./sessionRoutes");
const createAdminRoutes = require("./adminRoutes");

module.exports = function createApiRouter(dependencies) {
  const { store, config, log = console } = dependencies;
  const startedAt = Date.now();
  const api = express.Router();

  api.get("/health", (_req, res) => {
    res.json({
      ok: true,
      database: store.db,
      environment: config.nodeEnv,
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000)
    });
  });

  api.use("/auth", createAuthRoutes(dependencies));
  api.use("/public", createPublicRoutes(dependencies));
  api.use("/geocode", createGeocodeRoutes(dependencies));
  api.use("/incidents", createIncidentRoutes(dependencies));
  api.use("/", createSessionRoutes(dependencies));
  api.use("/admin", createAdminRoutes(dependencies));

  return api;
};
