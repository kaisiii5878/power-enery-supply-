/**
 * PostgreSQL connection pool factory.
 *
 * Lives in its own module so both the store factory and the migration runner can
 * build a pool without importing one another (which would be circular: the store
 * factory bootstraps migrations on first boot).
 *
 * `pg` is an optional runtime dependency: demo and test runs use the in-memory
 * store and never load it, so it is required lazily.
 */

function createPgPool(config) {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  const { Pool } = require("pg");
  const settings = (config && (config.pg || config.postgres)) || {};

  const ssl = settings.ssl ? { rejectUnauthorized: false } : undefined;
  const shared = { ssl, max: Number(settings.max) || 10 };

  if (settings.connectionString) {
    return new Pool({ connectionString: settings.connectionString, ...shared });
  }

  const pool = new Pool({
    host: settings.host,
    port: settings.port,
    user: settings.user,
    database: settings.database,
    ...shared
  });

  // An unset password must be omitted rather than sent as an empty string, so a
  // local server using trust authentication (or a .pgpass file) still works.
  if (settings.password !== undefined && settings.password !== null && String(settings.password) !== "") {
    pool.options.password = String(settings.password);
  }

  return pool;
}

/** A human-readable target for logs, never containing the password. */
function describePgTarget(config) {
  const settings = (config && (config.pg || config.postgres)) || {};
  if (settings.connectionString) {
    try {
      const url = new URL(settings.connectionString);
      return `${url.hostname}:${url.port || 5432}${url.pathname}`;
    } catch {
      return "DATABASE_URL";
    }
  }
  return `${settings.host || "localhost"}:${settings.port || 5432}/${settings.database || "powerwatch"}`;
}

module.exports = { createPgPool, describePgTarget };