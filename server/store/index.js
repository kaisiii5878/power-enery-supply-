/**
 * Store factory.
 *
 * The rest of the application only ever sees a store interface, so PowerWatch
 * runs against PostgreSQL + PostGIS when it is configured and reachable (the
 * authoritative MVP database), then MySQL, and against the in-memory store
 * otherwise (demo machines, CI, the test suite).
 */

const path = require("path");
const MemoryStore = require("./memoryStore");

function createPool(config) {
  // mysql2 is an optional runtime dependency in demo mode, so load it lazily.
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  const mysql = require("mysql2/promise");
  return mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: false,
    multipleStatements: true // required only by schema.sql bootstrap
  });
}

/** Applies server/schema.sql to an empty database (idempotent statements). */
async function bootstrapSchema(pool, schemaFile = path.join(__dirname, "..", "schema.sql")) {
  const fs = require("fs/promises");
  const sql = await fs.readFile(schemaFile, "utf8");
  await pool.query(sql);
}

/** PostgreSQL + PostGIS — the authoritative engine. */
async function createPostgresStore(config, { log = console } = {}) {
  const { createPgPool, describePgTarget } = require("./pgPool");
  const pool = createPgPool(config);
  await pool.query("SELECT 1");

  if (config.pg.bootstrap) {
    try {
      const { runMigrations } = require("../database/migrate");
      await runMigrations(pool, { log });
    } catch (error) {
      // Never block boot on a migration problem: the API reports what it can and
      // `npm run migrate` surfaces the detail with a proper exit code.
      log.warn?.(`[store] postgres migrations skipped: ${error.message}`);
    }
  }

  const PostgresStore = require("./postgresStore");
  const store = new PostgresStore(pool);
  const spatial = await store.init();
  log.log?.(
    `[store] connected to PostgreSQL ${describePgTarget(config)} ` +
    `(postgis=${spatial.postgis ? "on" : "off"}, spatial_index=${spatial.geometry ? "on" : "off"})`
  );
  return store;
}

async function createMySqlStore(config, { log = console } = {}) {
  const pool = createPool(config);
  await pool.query("SELECT 1");
  const MySqlStore = require("./mysqlStore");
  const store = new MySqlStore(pool);
  if (config.db.bootstrap) {
    try {
      await bootstrapSchema(pool);
    } catch (error) {
      log.warn?.(`[store] schema bootstrap skipped: ${error.message}`);
    }
  }
  log.log?.(`[store] connected to MySQL ${config.db.host}:${config.db.port}/${config.db.database}`);
  return store;
}

async function createStore(config, { log = console } = {}) {
  const driver = config.storage.driver;

  if (driver === "memory") {
    log.log?.("[store] using in-memory store (STORAGE_DRIVER=memory)");
    return new MemoryStore({ clusterConfig: config.cluster });
  }

  // `auto` prefers PostgreSQL (authoritative), then MySQL, then memory.
  const order = driver === "auto" ? ["postgres", "mysql"] : [driver];
  let lastError = null;

  for (const engine of order) {
    try {
      return engine === "postgres"
        ? await createPostgresStore(config, { log })
        : await createMySqlStore(config, { log });
    } catch (error) {
      lastError = error;
      log.warn?.(`[store] ${engine} unavailable (${error.code || error.message})`);
    }
  }

  if (config.storage.strict || driver !== "auto") throw lastError;
  log.warn?.("[store] no database reachable — falling back to the in-memory store");
  return new MemoryStore({ clusterConfig: config.cluster });
}

module.exports = { createStore, createPool, bootstrapSchema };
