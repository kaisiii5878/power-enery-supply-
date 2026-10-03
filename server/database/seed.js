/**
 * PostgreSQL demo seed runner.
 *
 * Writes the simulated dataset described in `seedData.js`. Deliberately raw SQL
 * rather than the store interface: this is a database-script concern, exactly
 * like the migrations beside it, and it must be able to write historical
 * timestamps that the live API would never accept from a client.
 *
 * Run with:  npm run seed            (skips when data already exists)
 *            npm run seed -- --reset (truncates the demo tables first)
 */

const crypto = require("crypto");

const { config } = require("../config/env");
const { createPgPool, describePgTarget } = require("../store/pgPool");
const { hashPassword } = require("../domain/passwords");
const { runMigrations } = require("./migrate");
const { ZONES, CREWS, CITIZENS, AUDIT } = require("./seedData");
const seedIncidents = require("../store/seedIncidents");
const seedReports = require("../store/seedReports");

const DEMO_TABLES = [
  "agency_notifications", "audit_log", "announcements", "incident_confirmations",
  "incident_messages", "work_requests", "reports", "incidents", "zones", "app_users"
];

const INCIDENT_COLUMNS = [
  "id", "reference", "title", "district", "zone_id", "latitude", "longitude", "radius_m",
  "estimated_area_m2", "reports_count", "severity_score", "severity", "status", "assignee",
  "root_cause", "resolution", "agency_report", "rejection_reason", "first_report_at",
  "last_report_at", "validated_by", "validated_at", "completed_at", "restored_at", "closed_at",
  "created_at", "updated_at"
];

const REPORT_COLUMNS = [
  "id", "incident_id", "user_id", "reporter_name", "phone", "category", "description",
  "district", "latitude", "longitude", "status", "severity", "photo_url", "created_at"
];

/** A password that satisfies the policy without ever being hard-coded. */
function generatePassword() {
  return `${crypto.randomBytes(9).toString("base64url")}9`;
}

async function tableHasColumn(client, table, column) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS total FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return Number(rows[0].total) > 0;
}

async function countRows(client, table) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS total FROM ${table}`);
  return Number(rows[0].total);
}

/** Re-syncs a BIGSERIAL sequence after rows were inserted with explicit ids. */
async function resyncSequence(client, table) {
  await client.query(
    `SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${table}))`,
    [table]
  );
}

/** Inserts one account and returns its id. */
async function insertUser(client, user, password, role, hasLocation) {
  const { salt, hash } = hashPassword(password);
  const { rows } = await client.query(
    `INSERT INTO app_users (username, full_name, user_role, password_salt, password_hash, email, phone, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE) RETURNING id`,
    [user.username, user.full_name, role, salt, hash, user.email || null, user.phone || null]
  );
  const id = Number(rows[0].id);

  if (hasLocation && Number.isFinite(Number(user.latitude)) && Number.isFinite(Number(user.longitude))) {
    await client.query(
      "UPDATE app_users SET latitude = $1, longitude = $2, neighborhood = $3 WHERE id = $4",
      [user.latitude, user.longitude, user.neighborhood || null, id]
    );
  }
  return id;
}

/** Citizens mapped to the district their seeded reports belong to. */
const DISTRICT_CITIZENS = {
  "Bastos, Yaounde": ["aida.ngombe", "franck.ondoa"],
  "Akwa, Douala": ["bruno.ayissi", "estelle.fotso"],
  "Bonamoussadi, Douala": ["clarisse.mbala"],
  "Melen, Yaounde": ["didier.eto"]
};

async function insertZones(client) {
  for (const zone of ZONES) {
    await client.query(
      `INSERT INTO zones (id, name, description, region, latitude, longitude, radius_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [zone.id, zone.name, zone.description, zone.region, zone.latitude, zone.longitude, zone.radius_m]
    );
  }
  await resyncSequence(client, "zones");
}

async function insertIncidents(client) {
  const placeholders = INCIDENT_COLUMNS.map((_, index) => `$${index + 1}`).join(", ");
  for (const incident of seedIncidents) {
    await client.query(
      `INSERT INTO incidents (${INCIDENT_COLUMNS.join(", ")}) VALUES (${placeholders})`,
      INCIDENT_COLUMNS.map(column => incident[column] ?? null)
    );
  }
  await resyncSequence(client, "incidents");
}

/**
 * Reports keep the severity of the incident they belong to, exactly as
 * `setClusterSeverity` leaves them after a real clustering run.
 */
async function insertReports(client, userIds) {
  const severityByIncident = new Map(seedIncidents.map(row => [row.id, row.severity]));
  const rotating = new Map();
  const placeholders = REPORT_COLUMNS.map((_, index) => `$${index + 1}`).join(", ");

  for (const report of seedReports) {
    const candidates = DISTRICT_CITIZENS[report.district] || [];
    let assignedUserId = null;
    if (candidates.length) {
      const offset = rotating.get(report.district) || 0;
      rotating.set(report.district, offset + 1);
      assignedUserId = userIds.get(candidates[offset % candidates.length]) || null;
    }
    const row = {
      ...report,
      user_id: assignedUserId,
      severity: severityByIncident.get(report.incident_id) || report.severity
    };
    await client.query(
      `INSERT INTO reports (${REPORT_COLUMNS.join(", ")}) VALUES (${placeholders})`,
      REPORT_COLUMNS.map(column => row[column] ?? null)
    );
  }
  await resyncSequence(client, "reports");
}

async function insertWorkAndConfirmations(client) {
  await client.query(
    `INSERT INTO work_requests
       (incident_id, contractor, assigned_by, status, assigned_at, departed_at, arrival_time,
        root_cause, diagnosis, equipment, replaced_components, technical_comments)
     VALUES (2, 'VoltCare Contractors', 'SOCADEL operator', 'on_site',
             '2026-09-22T17:30:00Z', '2026-09-22T18:00:00Z', '2026-09-22T18:30:00Z',
             'Low-voltage fuse link failure', 'Transformer overload on the Akwa branch.',
             'Insulation tester, LV fuse kit', '2 x LV fuse links',
             'Branch isolated, fuses being replaced.')`
  );

  await client.query(
    `INSERT INTO incident_confirmations (incident_id, reporter_key, confirmation_type, comment, created_at)
     VALUES (4, 'seed-restored-1', 'restored', 'Power back since noon.', '2026-09-21T12:55:00Z'),
            (4, 'seed-affected-1', 'also_affected', NULL, '2026-09-21T09:15:00Z')`
  );
}

async function insertNotifications(client, userIds) {
  const rows = [
    { agency: "socadel", user_id: null, incident_id: 1, event_type: "incident.awaiting_validation",
      title: "HIGH cluster in Bastos, Yaounde",
      message: "37 reports within 500 m need validation.", is_read: false },
    { agency: "socadel", user_id: null, incident_id: 2, event_type: "incident.under_intervention",
      title: "Crew on site in Akwa, Douala", message: "VoltCare Contractors began the intervention.", is_read: false },
    { agency: "socadel", user_id: null, incident_id: 3, event_type: "incident.validated",
      title: "Voltage instability validated", message: "Bonamoussadi is queued for field assignment.", is_read: true },
    { agency: null, user_id: userIds.get("aida.ngombe") || null, incident_id: 1,
      event_type: "incident.nearby", title: "Outage reported near you",
      message: "Neighbours in Bastos are reporting an outage within 500 m of your area.", is_read: false },
    { agency: null, user_id: userIds.get("bruno.ayissi") || null, incident_id: 2,
      event_type: "restoration.confirmed", title: "Supply restored in Akwa",
      message: "The incident near you has been closed after citizens confirmed restoration.", is_read: false }
  ];
  for (const row of rows) {
    await client.query(
      `INSERT INTO agency_notifications (user_id, agency, incident_id, event_type, title, message, is_read)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.user_id, row.agency, row.incident_id, row.event_type, row.title, row.message, row.is_read]
    );
  }
}

async function insertAudit(client) {
  for (const entry of AUDIT) {
    await client.query(
      "INSERT INTO audit_log (actor, action, incident_id, details) VALUES ($1, $2, $3, $4)",
      [entry.actor, entry.action, entry.incident_id, entry.details === null ? null : JSON.stringify(entry.details)]
    );
  }
}

/**
 * Seeds the demo dataset in one transaction, so a failure leaves the database
 * exactly as it was.
 */
async function runSeed(pool, { log = console, reset = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await countRows(client, "incidents");
    if (!reset && existing > 0) {
      await client.query("ROLLBACK");
      return { skipped: true, reason: `incidents already holds ${existing} row(s) — re-run with --reset to reseed` };
    }

    if (reset) {
      await client.query(`TRUNCATE ${DEMO_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
      log.log?.(`[seed] cleared ${DEMO_TABLES.length} demo tables`);
    }

    const hasLocation = await tableHasColumn(client, "app_users", "latitude");

    // The demo password is never stored in source: it comes from the environment
    // or is generated and printed once so the demonstration can sign in.
    const demoPassword = String(process.env.SEED_DEMO_PASSWORD || "").trim() || generatePassword();
    const generatedDemoPassword = !String(process.env.SEED_DEMO_PASSWORD || "").trim();

    const adminPassword = String(config.seedAdmin.password || "").trim() || generatePassword();
    const generatedAdminPassword = !String(config.seedAdmin.password || "").trim();

    const userIds = new Map();

    const administratorId = await insertUser(
      client,
      {
        username: config.seedAdmin.username,
        full_name: config.seedAdmin.name,
        email: process.env.ADMIN_EMAIL || "console@powerwatch.example",
        phone: null
      },
      adminPassword,
      "socadel",
      false
    );
    userIds.set(config.seedAdmin.username, administratorId);

    for (const crew of CREWS) userIds.set(crew.username, await insertUser(client, crew, demoPassword, "subcontractor", hasLocation));
    for (const citizen of CITIZENS) userIds.set(citizen.username, await insertUser(client, citizen, demoPassword, "client", hasLocation));
    await resyncSequence(client, "app_users");

    await insertZones(client);
    await insertIncidents(client);
    await insertReports(client, userIds);
    await insertWorkAndConfirmations(client);
    await insertNotifications(client, userIds);
    await insertAudit(client);
    await insertAnnouncements(client);

    await client.query("COMMIT");

    const summary = {
      skipped: false,
      postgis: await tableHasColumn(client, "reports", "location"),
      accounts: 1 + CREWS.length + CITIZENS.length,
      zones: ZONES.length,
      incidents: seedIncidents.length,
      reports: seedReports.length,
      credentials: [
        { role: "Administrator", username: config.seedAdmin.username, password: adminPassword, generated: generatedAdminPassword },
        { role: "Field crew", username: CREWS.map(crew => crew.username).join(", "), password: demoPassword, generated: generatedDemoPassword },
        { role: "Citizen", username: CITIZENS.map(citizen => citizen.username).join(", "), password: demoPassword, generated: generatedDemoPassword }
      ]
    };

    log.log?.(`[seed] inserted ${summary.accounts} accounts, ${summary.zones} zones, ` +
      `${summary.incidents} incidents and ${summary.reports} reports ` +
      `(geometry=${summary.postgis ? "on" : "off"})`);

    return summary;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* the transaction is already gone */ }
    throw error;
  } finally {
    client.release();
  }
}

/** Prints the sign-in details once, so the demonstration can start immediately. */
function reportCredentials(summary, log = console) {
  if (!summary || summary.skipped) return;
  log.log("");
  log.log("  Simulated demo accounts (development data — not real customers)");
  log.log("  ------------------------------------------------------------------");
  for (const entry of summary.credentials) {
    const note = entry.generated ? "  (generated — set the env var to choose your own)" : "";
    log.log(`  ${entry.role.padEnd(14)} ${entry.username}`);
    log.log(`  ${"".padEnd(14)} password: ${entry.password}${note}`);
  }
  log.log("");
}

async function main() {
  const log = console;
  const reset = process.argv.includes("--reset");

  const pool = createPgPool(config);
  try {
    log.log(`[seed] target ${describePgTarget(config)}`);
    await runMigrations(pool, { log });

    const summary = await runSeed(pool, { log, reset });
    if (summary.skipped) {
      log.warn?.(`[seed] nothing to do: ${summary.reason}`);
      return;
    }
    reportCredentials(summary, log);
    log.log("[seed] Tip: sign in as the administrator to see the SOCADEL console, or as a citizen to report an outage.");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[seed] failed: ${error.message}`);
    if (error.code === "ECONNREFUSED") console.error("Check PG_HOST / PG_PORT / DATABASE_URL.");
    if (error.code === "3D000") console.error("The database does not exist — run `npm run migrate` first.");
    process.exit(1);
  });
}

module.exports = {
  DEMO_TABLES,
  INCIDENT_COLUMNS,
  REPORT_COLUMNS,
  DISTRICT_CITIZENS,
  generatePassword,
  tableHasColumn,
  countRows,
  resyncSequence,
  insertUser,
  insertZones,
  insertIncidents,
  insertReports,
  insertWorkAndConfirmations,
  insertNotifications,
  insertAudit,
  insertAnnouncements,
  runSeed,
  reportCredentials,
  main
};