/**
 * Environment access. Every secret and tunable comes from here so no
 * credential is ever hard-coded. `.env.example` documents the full list.
 */

const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

function integer(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function list(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  return raw.split(",").map(item => item.trim()).filter(Boolean);
}

const crypto = require("crypto");

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: integer("PORT", 4000),
  /**
   * Authoritative MVP database: PostgreSQL with PostGIS.
   *
   * `DATABASE_URL` wins when present (the form managed hosts inject), otherwise
   * the discrete PG_* variables are used. Everything is optional so the app
   * still boots on the in-memory store when no database is configured.
   */
  postgres: {
    connectionString: String(process.env.DATABASE_URL || "").trim(),
    host: process.env.PG_HOST || process.env.POSTGRES_HOST || "localhost",
    port: integer("PG_PORT", 5432),
    user: process.env.PG_USER || process.env.POSTGRES_USER || "postgres",
    password: process.env.PG_PASSWORD || process.env.POSTGRES_PASSWORD || "",
    database: process.env.PG_DATABASE || process.env.POSTGRES_DB || "powerwatch",
    /** Managed Postgres usually requires TLS; local installs usually do not. */
    ssl: process.env.PGSSL === "true" || process.env.PG_SSL === "true",
    max: integer("PG_POOL_MAX", 10)
  },
  mysql: {
    host: process.env.MYSQL_HOST || "localhost",
    port: integer("MYSQL_PORT", 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "eneo_outage"
  },
  cluster: {
    cluster_distance_m: integer("CLUSTER_DISTANCE_M", 500),
    cluster_window_minutes: integer("CLUSTER_WINDOW_MINUTES", 30),
    min_reports_to_qualify: integer("MIN_REPORTS_TO_QUALIFY", 1)
  },
  /** Seed administrator, created once on first boot. Never a fixed password. */
  seedAdmin: {
    username: String(process.env.ADMIN_USERNAME || "admin").trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || "",
    name: process.env.ADMIN_FULL_NAME || "SOCADEL Administrator"
  },
  corsOrigins: list("CORS_ORIGIN", ["http://localhost:5173", "http://localhost:4173", "http://localhost:4000"]),
  sessionTtlMs: integer("SESSION_TTL_MINUTES", 480) * 60_000,
  auth: {
    /**
     * A missing secret is tolerated in development (an ephemeral one is
     * generated so sessions simply reset on restart) but never in production.
     */
    secret: process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : crypto.randomBytes(32).toString("hex")),
    issuer: process.env.JWT_ISSUER || "powerwatch"
  },

  subcontractorName: process.env.SUBCONTRACTOR_NAME || "SOCADEL Field Agent",
  /** Optional integrations — the app degrades gracefully when unset. */
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  fcmServerKey: process.env.FCM_SERVER_KEY || "",
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: integer("SMTP_PORT", 587),
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
    from: process.env.MAIL_FROM || ""
  },
  /** Exact coordinates are only ever given to accounts that need them. */
  locationPrecision: integer("LOCATION_PRECISION_DP", 3)
};

/**
 * Storage selection.
 *   auto     — use PostgreSQL when reachable, then MySQL, otherwise memory (default)
 *   postgres — require PostgreSQL; fail fast if it is unavailable
 *   mysql    — require MySQL; fail fast if it is unavailable
 *   memory   — never touch the database (demo, CI, unit tests)
 */
const driver = String(process.env.STORAGE_DRIVER || "auto").trim().toLowerCase();

const config = {
  ...env,
  db: { ...env.mysql, bootstrap: process.env.DB_BOOTSTRAP !== "false" },
  pg: { ...env.postgres, bootstrap: process.env.DB_BOOTSTRAP !== "false" },
  storage: {
    driver: ["auto", "postgres", "mysql", "memory"].includes(driver) ? driver : "auto",
    strict: process.env.STORAGE_STRICT === "true" || (env.nodeEnv === "production" && driver !== "memory")
  }
};

if (env.nodeEnv === "production" && !env.auth.secret) {
  throw new Error("JWT_SECRET must be set in production — sessions cannot be signed without it.");
}

if (env.nodeEnv !== "test" && !env.seedAdmin.password) {
  console.warn(
    "[PowerWatch] ADMIN_PASSWORD is not set. A seeded administrator cannot be created; " +
    "set ADMIN_USERNAME and ADMIN_PASSWORD in .env to enable the SOCADEL console."
  );
}

module.exports = { env, config };

