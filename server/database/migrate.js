/**
 * Migration runner for the PostgreSQL/PostGIS database.
 *
 *   npm run migrate            apply every pending migration
 *   npm run migrate -- --list  show what has been applied and what is pending
 *   node server/database/migrate.js --force   re-apply (checksum drift report)
 *
 * Files in `server/database/migrations` are applied in filename order and
 * recorded in `schema_migrations`, so running this twice is a no-op.
 *
 * A file whose name ends in `.optional.sql` is allowed to fail: it is skipped
 * with a warning instead. That is how the PostGIS migration behaves on a
 * PostgreSQL where the extension cannot be installed — the application then runs
 * on plain latitude/longitude columns.
 */

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const OPTIONAL_SUFFIX = ".optional.sql";

const checksum = sql => crypto.createHash("sha256").update(sql).digest("hex");

async function ensureLedger(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename    VARCHAR(200) PRIMARY KEY,
       checksum    CHAR(64)     NOT NULL,
       optional    BOOLEAN      NOT NULL DEFAULT FALSE,
       applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
       duration_ms INTEGER      NOT NULL DEFAULT 0
     )`
  );
}

/** Every migration file on disk, in apply order. */
async function listMigrations(directory = MIGRATIONS_DIR) {
  const entries = await fs.readdir(directory);
  return entries
    .filter(name => name.toLowerCase().endsWith(".sql"))
    .sort()
    .map(name => ({
      filename: name,
      optional: name.toLowerCase().endsWith(OPTIONAL_SUFFIX),
      path: path.join(directory, name)
    }));
}

async function appliedMigrations(pool) {
  const { rows } = await pool.query("SELECT filename, checksum, applied_at FROM schema_migrations");
  return new Map(rows.map(row => [row.filename, row]));
}

/**
 * Applies every pending migration. Returns a report the caller can log or test
 * against without parsing console output.
 */
async function runMigrations(pool, { directory = MIGRATIONS_DIR, log = console, force = false } = {}) {
  await ensureLedger(pool);

  const files = await listMigrations(directory);
  const applied = await appliedMigrations(pool);

  const report = { applied: [], skipped: [], unchanged: [], drifted: [] };

  for (const migration of files) {
    const sql = await fs.readFile(migration.path, "utf8");
    const digest = checksum(sql);
    const previous = applied.get(migration.filename);

    if (previous && previous.checksum === digest && !force) {
      report.unchanged.push(migration.filename);
      continue;
    }
    if (previous && previous.checksum !== digest) {
      report.drifted.push(migration.filename);
      log.warn?.(`[migrate] ${migration.filename} changed after it was applied — re-applying (statements are idempotent)`);
    }

    const startedAt = Date.now();
    try {
      await pool.query("BEGIN");
      await pool.query(sql);
      await pool.query(
        `INSERT INTO schema_migrations (filename, checksum, optional, duration_ms)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (filename) DO UPDATE
           SET checksum = EXCLUDED.checksum,
               applied_at = now(),
               duration_ms = EXCLUDED.duration_ms`,
        [migration.filename, digest, migration.optional, Date.now() - startedAt]
      );
      await pool.query("COMMIT");
      report.applied.push(migration.filename);
      log.log?.(`[migrate] applied ${migration.filename} (${Date.now() - startedAt} ms)`);
    } catch (error) {
      try { await pool.query("ROLLBACK"); } catch { /* the transaction is already gone */ }
      if (migration.optional) {
        report.skipped.push({ filename: migration.filename, reason: error.message });
        log.warn?.(`[migrate] skipped optional ${migration.filename}: ${error.message}`);
        continue;
      }
      error.message = `Migration ${migration.filename} failed: ${error.message}`;
      throw error;
    }
  }

  return report;
}

async function main() {
  const { config } = require("../config/env");
  const { createPgPool, describePgTarget } = require("../store/pgPool");

  const log = console;
  const listOnly = process.argv.includes("--list");
  const force = process.argv.includes("--force");

  const pool = createPgPool(config);
  try {
    log.log(`[migrate] target ${describePgTarget(config)}`);
    if (listOnly) {
      await ensureLedger(pool);
      const applied = await appliedMigrations(pool);
      for (const migration of await listMigrations()) {
        const record = applied.get(migration.filename);
        const mark = record ? `applied ${new Date(record.applied_at).toISOString()}` : "pending";
        log.log(`  ${migration.optional ? "[optional] " : "           "}${migration.filename.padEnd(34)} ${mark}`);
      }
      return;
    }

    const report = await runMigrations(pool, { log, force });
    log.log(
      `[migrate] done — ${report.applied.length} applied, ${report.unchanged.length} already current, ` +
      `${report.skipped.length} optional skipped`
    );
    for (const item of report.skipped) log.warn?.(`[migrate]   skipped ${item.filename}: ${item.reason}`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[migrate] failed: ${error.message}`);
    if (error.code === "ECONNREFUSED") {
      console.error("Check PG_HOST / PG_PORT / DATABASE_URL, or set STORAGE_DRIVER=memory to run without a database.");
    }
    if (error.code === "28P01" || error.code === "28000") console.error("Check PG_USER / PG_PASSWORD.");
    if (error.code === "3D000") console.error("Create the database first, or fix PG_DATABASE.");
    process.exit(1);
  });
}

module.exports = { MIGRATIONS_DIR, OPTIONAL_SUFFIX, listMigrations, appliedMigrations, runMigrations, ensureLedger, checksum };