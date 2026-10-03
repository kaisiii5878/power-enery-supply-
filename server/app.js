/**
 * Express application assembly.
 *
 * `createApp({ store })` wires the store, the services and the HTTP layer
 * together and returns a ready Express app. Keeping this separate from
 * `index.js` means the test suite can boot the whole API against the in-memory
 * store without touching a database or a network port.
 */

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const { config } = require("./config/env");
const { createAuth } = require("./http/auth");
const { toHttpError } = require("./http/errors");
const createApiRouter = require("./routes");
const { createAuthService } = require("./services/authService");
const { createIncidentService } = require("./services/incidentService");
const { createAnalyticsService } = require("./services/analyticsService");
const { createAdminService } = require("./services/adminService");

/** A small, dependency-free subset of the usual hardening headers. */
function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(self)");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  next();
}

function requestLogger(log) {
  return (req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      if (req.path === "/api/health") return;
      log.log?.(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
    });
    next();
  };
}

function createApp({ store, log = console, serveClient = false } = {}) {
  const auth = createAuth({ store, config });
  const dependencies = {
    store,
    config,
    log,
    auth,
    accounts: createAuthService({ store, auth, config, log }),
    incidents: createIncidentService({ store, config }),
    analytics: createAnalyticsService({ store }),
    admin: createAdminService({ store, auth })
  };

  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(cors({
    origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  }));
  // Reports can carry a base64 photo; nothing else needs a large body.
  app.use(express.json({ limit: "2mb" }));
  if (config.nodeEnv !== "test") app.use(requestLogger(log));

  app.use("/api", createApiRouter(dependencies));

  app.use("/api", (_req, res) => res.status(404).json({ error: "That endpoint does not exist." }));

  if (serveClient) {
    const dist = path.join(__dirname, "..", "dist");
    if (fs.existsSync(dist)) {
      app.use(express.static(dist, { maxAge: "1h", index: false }));
      app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
    } else {
      log.warn?.("[http] no dist/ build found — the client is served by Vite in development");
    }
  }

  /** Single place where every failure becomes a JSON envelope. */
  app.use((error, req, res, _next) => {
    const httpError = toHttpError(error) || new Error("Unexpected error");
    const status = Number.isInteger(httpError.status) ? httpError.status : 500;
    if (status >= 500) log.error?.(`[http] ${req.method} ${req.originalUrl} failed:`, error);
    if (res.headersSent) return;
    res.status(status).json({
      error: status >= 500 ? "Something went wrong on our side. Please try again." : httpError.message,
      ...(httpError.code && status < 500 ? { code: httpError.code } : {}),
      ...(httpError.allowed ? { allowed: httpError.allowed } : {})
    });
  });

  return { app, dependencies, auth };
}

module.exports = { createApp, securityHeaders };
