/**
 * PowerWatch Cameroon — server entry point.
 *
 * All this file does is pick a storage engine, build the HTTP app and listen.
 * The behaviour lives in app.js (wiring), routes/ (transport), services/ (use
 * cases), domain/ (rules) and store/ (persistence).
 *
 * Boot sequence:
 *   1. read configuration from the environment (nothing is hard-coded)
 *   2. open the store — MySQL when configured and reachable, otherwise memory
 *   3. seed the configured SOCADEL administrator, if any
 *   4. listen, and shut down cleanly on Ctrl+C / container stop
 */

const { config } = require("./config/env");
const { createStore } = require("./store");
const { createApp } = require("./app");

async function start() {
  const store = await createStore(config);
  const { app, dependencies } = createApp({ store, serveClient: config.nodeEnv === "production" });

  const seeded = await dependencies.accounts.bootstrapAdministrator();
  if (seeded.created === false && config.nodeEnv !== "test") {
    console.warn(`[PowerWatch] administrator not seeded: ${seeded.reason}`);
  }

  const server = app.listen(config.port, () => {
    console.log(`[PowerWatch] API listening on http://localhost:${config.port} (${config.nodeEnv}, store=${store.db})`);
  });

  let closing = false;
  const shutdown = async signal => {
    if (closing) return;
    closing = true;
    console.log(`[PowerWatch] ${signal} received — shutting down`);
    server.close(async () => {
      try {
        await store.close?.();
      } catch (error) {
        console.warn(`[PowerWatch] error while closing the store: ${error.message}`);
      }
      process.exit(0);
    });
    // Never hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", reason => console.error("[PowerWatch] unhandled rejection:", reason));

  return server;
}

if (require.main === module) {
  start().catch(error => {
    console.error("[PowerWatch] failed to start:", error.message);
    if (error.code === "EADDRINUSE") console.error(`Port ${config.port} is busy — set PORT in .env.`);
    if (error.code && String(error.code).startsWith("ER_")) {
      console.error("Check MYSQL_* in .env, or set STORAGE_DRIVER=memory to run without a database.");
    }
    process.exit(1);
  });
}

module.exports = { start };
