/**
 * PostgreSQL + PostGIS store.
 *
 * Implements exactly the interface the in-memory and MySQL stores expose, so no
 * service, route or controller branches on the active engine. Parameterised
 * queries only (see `pgQuery.js`), and `transaction()` hands the worker a
 * connection-bound store so a whole use case — insert report, cluster,
 * aggregate, notify, audit — commits or rolls back as one unit.
 *
 * PostGIS is used where the database is the right place to do the work:
 *   - finding cluster candidates within a radius (ST_DWithin on geography)
 *   - resolving which operational zone contains a report
 *   - deriving an incident's centre and affected area from its member reports
 * It degrades gracefully to plain latitude/longitude columns when the PostGIS
 * extension is not installed, so the API keeps working on a vanilla PostgreSQL.
 */

const {
  insertSql,
  updateSql,
  translateError,
  normalizePgRow,
  normalizePgRows,
  toPg
} = require("./pgQuery");
const { distanceMeters } = require("../domain/geo");

const EMPTY_USER_COUNTS = { client: 0, subcontractor: 0, socadel: 0 };

const INCIDENT_STATUSES = [
  "pending", "pending_validation", "validated", "assigned", "on_the_way",
  "under_intervention", "completed", "verification_pending", "closed", "rejected"
];

/** Statuses that still represent an open problem for citizens. */
const INACTIVE_STATUSES = ["closed", "rejected"];

class PostgresStore {
  constructor(pool, connection = null) {
    this.pool = pool;
    this.connection = connection;
    /** Filled by `init()`: which PostGIS capabilities this database offers. */
    this.spatial = { postgis: false, geometry: false };
  }

  get db() { return "postgres"; }
  get executor() { return this.connection || this.pool; }

  /**
   * Detects PostGIS and the generated geometry columns. Called once by the
   * store factory; every spatial path checks `this.spatial` before using it.
   */
  async init() {
    try {
      const extension = await this.one("SELECT COUNT(*)::int AS total FROM pg_extension WHERE extname = 'postgis'");
      this.spatial.postgis = Number(extension?.total || 0) > 0;
      if (this.spatial.postgis) {
        const column = await this.one(
          `SELECT COUNT(*)::int AS total FROM information_schema.columns
            WHERE table_name = 'incidents' AND column_name = 'location'`
        );
        this.spatial.geometry = Number(column?.total || 0) > 0;
      }
    } catch (error) {
      // A permission-limited role may not read pg_extension; assume no PostGIS.
      this.spatial = { postgis: false, geometry: false };
    }
    return this.spatial;
  }

  async query(sql, params = []) {
    try {
      const result = await this.executor.query(sql, params);
      return result.rows;
    } catch (error) {
      throw translateError(error);
    }
  }

  async one(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows.length ? normalizePgRow(rows[0]) : null;
  }

  async transaction(worker) {
    if (this.connection) return worker(this); // already inside a transaction
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      const store = new PostgresStore(this.pool, connection);
      store.spatial = this.spatial;
      const result = await worker(store);
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      try { await connection.query("ROLLBACK"); } catch { /* connection is being discarded */ }
      throw translateError(error);
    } finally {
      connection.release();
    }
  }

  async close() {
    if (this.pool && typeof this.pool.end === "function") await this.pool.end();
  }

  // ---- settings -----------------------------------------------------------

  async getSettings(keys) {
    const rows = keys
      ? await this.query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key = ANY($1)", [keys])
      : await this.query("SELECT setting_key, setting_value FROM system_settings");
    const settings = {};
    for (const row of rows) settings[row.setting_key] = row.setting_value;
    return settings;
  }

  async setSetting(key, value) {
    await this.query(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [key, String(toPg(value))]
    );
  }

  // ---- users --------------------------------------------------------------

  async findUser({ id, username, role }) {
    const filters = [];
    const params = [];
    if (id !== undefined && id !== null) { params.push(id); filters.push(`id = $${params.length}`); }
    if (username !== undefined) { params.push(username); filters.push(`username = $${params.length}`); }
    if (role) { params.push(role); filters.push(`user_role = $${params.length}`); }
    if (!filters.length) return null;
    return this.one(`SELECT * FROM app_users WHERE ${filters.join(" AND ")} LIMIT 1`, params);
  }

  async createUser(data) {
    const { sql, params } = insertSql("app_users", data);
    const row = await this.one(sql, params);
    return row ? this.findUser({ id: row.id }) : null;
  }

  async listUsers({ role, search } = {}) {
    const filters = [];
    const params = [];
    if (role) { params.push(role); filters.push(`user_role = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      const index = params.length;
      filters.push(`(username ILIKE $${index} OR full_name ILIKE $${index} OR email ILIKE $${index})`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = await this.query(`SELECT * FROM app_users ${where} ORDER BY created_at DESC LIMIT 500`, params);
    // Password material never leaves a store, on any engine.
    return normalizePgRows(rows).map(row => {
      delete row.password_salt;
      delete row.password_hash;
      return row;
    });
  }

  async setUserActive(id, isActive) {
    await this.query("UPDATE app_users SET is_active = $1, updated_at = now() WHERE id = $2", [Boolean(isActive), id]);
    return this.findUser({ id });
  }

  async updateUserPassword(id, { password_salt, password_hash }) {
    await this.query(
      "UPDATE app_users SET password_salt = $1, password_hash = $2, updated_at = now() WHERE id = $3",
      [password_salt, password_hash, id]
    );
    return this.findUser({ id });
  }

  async countUsers() {
    const rows = await this.query("SELECT user_role, COUNT(*)::int AS total FROM app_users GROUP BY user_role");
    const counts = { ...EMPTY_USER_COUNTS };
    for (const row of rows) if (counts[row.user_role] !== undefined) counts[row.user_role] = Number(row.total);
    return counts;
  }

  // ---- incidents ----------------------------------------------------------

  async listIncidents() {
    const rows = await this.query("SELECT * FROM incidents ORDER BY last_report_at DESC LIMIT 500");
    return normalizePgRows(rows);
  }

  async getIncident(id) {
    return this.one("SELECT * FROM incidents WHERE id = $1 LIMIT 1", [id]);
  }

  async createIncident(data) {
    const { sql, params } = insertSql("incidents", data);
    const row = await this.one(sql, params);
    return row ? this.getIncident(row.id) : null;
  }

  async updateIncident(id, data) {
    const statement = updateSql("incidents", id, data);
    if (statement) await this.query(statement.sql, statement.params);
    return this.getIncident(id);
  }

  /**
   * Cluster candidates for a new report.
   *
   * When PostGIS is present and a point is supplied, `ST_DWithin` on geography
   * does the radius filtering in the database against a GIST index instead of
   * pulling every recent incident into JavaScript. The service still applies the
   * authoritative time-window + haversine rule to the (now small) candidate set.
   */
  async findClusterCandidates({ sinceIso, limit = 80, point = null, radiusMeters = null } = {}) {
    const latitude = Number(point && point.latitude);
    const longitude = Number(point && point.longitude);
    const radius = Number(radiusMeters);
    const useSpatial =
      this.spatial.geometry && point &&
      Number.isFinite(latitude) && Number.isFinite(longitude) &&
      Number.isFinite(radius) && radius > 0;

    if (useSpatial) {
      const rows = await this.query(
        `SELECT * FROM incidents
          WHERE last_report_at >= $1
            AND ST_DWithin(location::geography, ST_MakePoint($3, $2)::geography, $4)
          ORDER BY last_report_at DESC
          LIMIT $5`,
        [toPg(sinceIso), latitude, longitude, radius, Number(limit)]
      );
      return normalizePgRows(rows);
    }

    const rows = await this.query(
      "SELECT * FROM incidents WHERE last_report_at >= $1 ORDER BY last_report_at DESC LIMIT $2",
      [toPg(sinceIso), Number(limit)]
    );
    return normalizePgRows(rows);
  }

  async promoteQualifiedIncidents(minimumReports) {
    await this.query(
      "UPDATE incidents SET status = 'pending_validation', updated_at = now() WHERE status = 'pending' AND reports_count >= $1",
      [Number(minimumReports)]
    );
  }

  async incidentStats() {
    const [statusRows, reportRows] = await Promise.all([
      this.query("SELECT status, COUNT(*)::int AS total FROM incidents GROUP BY status"),
      this.query("SELECT COUNT(*)::int AS total FROM reports")
    ]);
    const counts = { total: 0, active: 0, reports: Number(reportRows[0]?.total || 0) };
    for (const status of INCIDENT_STATUSES) counts[status] = 0;
    for (const row of statusRows) {
      const total = Number(row.total);
      counts.total += total;
      if (counts[row.status] !== undefined) counts[row.status] = total;
      if (!INACTIVE_STATUSES.includes(row.status)) counts.active += total;
    }
    return counts;
  }

  // ---- reports ------------------------------------------------------------

  async createReport(data) {
    const { sql, params } = insertSql("reports", data);
    return this.one(sql, params);
  }

  async listReports({ incidentId, userId, limit = 100, offset = 0 } = {}) {
    const filters = [];
    const params = [];
    if (incidentId !== undefined && incidentId !== null) { params.push(Number(incidentId)); filters.push(`incident_id = $${params.length}`); }
    if (userId !== undefined && userId !== null) { params.push(Number(userId)); filters.push(`user_id = $${params.length}`); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const [rows, totals] = await Promise.all([
      this.query(
        `SELECT * FROM reports ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, Number(limit), Number(offset)]
      ),
      this.query(`SELECT COUNT(*)::int AS total FROM reports ${where}`, params)
    ]);
    return { rows: normalizePgRows(rows), total: Number(totals[0]?.total || 0) };
  }

  /** Member coordinates used by the clustering engine to recompute aggregates. */
  async clusterMembers(incidentId) {
    const rows = await this.query(
      "SELECT latitude, longitude FROM reports WHERE incident_id = $1",
      [Number(incidentId)]
    );
    return normalizePgRows(rows).map(row => ({ latitude: row.latitude, longitude: row.longitude }));
  }

  async setClusterSeverity(incidentId, severity) {
    await this.query("UPDATE reports SET severity = $1 WHERE incident_id = $2", [severity, Number(incidentId)]);
  }

  // ---- messages -----------------------------------------------------------

  async listMessages(incidentId) {
    const rows = await this.query(
      "SELECT * FROM incident_messages WHERE incident_id = $1 ORDER BY created_at ASC",
      [Number(incidentId)]
    );
    return normalizePgRows(rows);
  }

  async createMessage(data) {
    const { sql, params } = insertSql("incident_messages", data);
    return this.one(sql, params);
  }

  // ---- confirmations ------------------------------------------------------

  async addConfirmation(data) {
    const { sql, params } = insertSql("incident_confirmations", data);
    return this.one(sql, params);
  }

  async confirmationCounts(incidentId) {
    const rows = await this.query(
      "SELECT confirmation_type, COUNT(*)::int AS total FROM incident_confirmations WHERE incident_id = $1 GROUP BY confirmation_type",
      [Number(incidentId)]
    );
    const counts = { also_affected: 0, restored: 0 };
    for (const row of rows) if (counts[row.confirmation_type] !== undefined) counts[row.confirmation_type] = Number(row.total);
    return counts;
  }

  // ---- work requests ------------------------------------------------------

  async createWorkRequest(data) {
    const { sql, params } = insertSql("work_requests", data);
    return this.one(sql, params);
  }

  async latestWorkRequest(incidentId) {
    return this.one(
      "SELECT * FROM work_requests WHERE incident_id = $1 ORDER BY assigned_at DESC, id DESC LIMIT 1",
      [Number(incidentId)]
    );
  }

  async updateWorkRequest(id, data) {
    const statement = updateSql("work_requests", id, data);
    if (statement) await this.query(statement.sql, statement.params);
    return this.one("SELECT * FROM work_requests WHERE id = $1 LIMIT 1", [id]);
  }

  async listWorkRequests({ contractor } = {}) {
    const params = [];
    let where = "";
    if (contractor) { params.push(contractor); where = `WHERE contractor = $${params.length}`; }
    const rows = await this.query(`SELECT * FROM work_requests ${where} ORDER BY assigned_at DESC LIMIT 200`, params);
    return normalizePgRows(rows);
  }

  // ---- notifications ------------------------------------------------------

  async addNotification(data) {
    const { sql, params } = insertSql("agency_notifications", data);
    return this.one(sql, params);
  }

  async listNotifications({ userId, agency, limit = 60 } = {}) {
    const filters = [];
    const params = [];
    if (userId !== undefined && userId !== null) { params.push(Number(userId)); filters.push(`user_id = $${params.length}`); }
    if (agency) { params.push(agency); filters.push(`agency = $${params.length}`); }
    if (!filters.length) return [];
    const rows = await this.query(
      `SELECT * FROM agency_notifications WHERE ${filters.join(" OR ")} ORDER BY created_at DESC LIMIT $${params.length + 1}`,
      [...params, Number(limit)]
    );
    return normalizePgRows(rows);
  }

  async markNotificationsRead({ userId, agency }) {
    const filters = [];
    const params = [];
    if (userId !== undefined && userId !== null) { params.push(Number(userId)); filters.push(`user_id = $${params.length}`); }
    if (agency) { params.push(agency); filters.push(`agency = $${params.length}`); }
    if (!filters.length) return;
    await this.query(`UPDATE agency_notifications SET is_read = TRUE WHERE ${filters.join(" OR ")}`, params);
  }

  // ---- audit trail --------------------------------------------------------

  async addAudit({ actor, action, incident_id = null, details = null }) {
    return this.one(
      "INSERT INTO audit_log (actor, action, incident_id, details) VALUES ($1, $2, $3, $4) RETURNING *",
      [actor, action, incident_id, details === null || details === undefined ? null : JSON.stringify(details)]
    );
  }

  async listAudit({ incidentId, limit = 100 } = {}) {
    const params = [];
    let where = "";
    if (incidentId !== undefined) { params.push(Number(incidentId)); where = `WHERE incident_id = $${params.length}`; }
    const rows = await this.query(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1}`,
      [...params, Number(limit)]
    );
    return normalizePgRows(rows).map(row => {
      // jsonb arrives as an object, but a text column (older installs) would not.
      if (typeof row.details === "string") {
        try { row.details = JSON.parse(row.details); } catch { /* keep the raw text */ }
      }
      return row;
    });
  }

  // ---- zones --------------------------------------------------------------

  async listZones() {
    const rows = await this.query("SELECT * FROM zones ORDER BY name ASC");
    return normalizePgRows(rows);
  }

  async createZone(data) {
    const { sql, params } = insertSql("zones", data);
    return this.one(sql, params);
  }

  async updateZone(id, data) {
    const statement = updateSql("zones", id, data);
    if (statement) await this.query(statement.sql, statement.params);
    return this.one("SELECT * FROM zones WHERE id = $1 LIMIT 1", [id]);
  }

  async deleteZone(id) {
    const rows = await this.query("DELETE FROM zones WHERE id = $1 RETURNING id", [Number(id)]);
    return rows.length > 0;
  }

  /**
   * The operational zone whose circle contains a point.
   *
   * With PostGIS this is one indexed `ST_DWithin` query; without it the same
   * arithmetic the service used to do in JavaScript is applied to the (small)
   * zone table, so behaviour is identical on every engine.
   */
  async findZoneForPoint(point) {
    const latitude = Number(point && point.latitude);
    const longitude = Number(point && point.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    if (this.spatial.geometry) {
      return this.one(
        `SELECT * FROM zones
          WHERE location IS NOT NULL
            AND ST_DWithin(location::geography, ST_MakePoint($2, $1)::geography, radius_m)
          ORDER BY ST_Distance(location::geography, ST_MakePoint($2, $1)::geography) ASC
          LIMIT 1`,
        [latitude, longitude]
      );
    }

    const zones = await this.listZones();
    let best = null;
    for (const zone of zones) {
      const distance = distanceMeters(latitude, longitude, Number(zone.latitude), Number(zone.longitude));
      if (distance <= Number(zone.radius_m) && (!best || distance < best.distance)) best = { zone, distance };
    }
    return best ? best.zone : null;
  }

  // ---- announcements ------------------------------------------------------

  async listAnnouncements({ publishedOnly = false } = {}) {
    const where = publishedOnly ? "WHERE published = TRUE" : "";
    const rows = await this.query(`SELECT * FROM announcements ${where} ORDER BY created_at DESC LIMIT 100`);
    return normalizePgRows(rows);
  }

  async createAnnouncement(data) {
    const { sql, params } = insertSql("announcements", data);
    return this.one(sql, params);
  }

  async updateAnnouncement(id, data) {
    const statement = updateSql("announcements", id, data);
    if (statement) await this.query(statement.sql, statement.params);
    return this.one("SELECT * FROM announcements WHERE id = $1 LIMIT 1", [id]);
  }

  async deleteAnnouncement(id) {
    const rows = await this.query("DELETE FROM announcements WHERE id = $1 RETURNING id", [Number(id)]);
    return rows.length > 0;
  }

  // ---- analytics ----------------------------------------------------------

  /** Raw rows the analytics service aggregates into KPIs and chart series. */
  async analyticsRows() {
    const [incidentRows, reportRows] = await Promise.all([
      this.query("SELECT id, status, severity, severity_score, district, reports_count, created_at, first_report_at, validated_at, restored_at, closed_at FROM incidents"),
      this.query("SELECT id, district, severity, status, created_at, incident_id FROM reports")
    ]);
    return { incidents: normalizePgRows(incidentRows), reports: normalizePgRows(reportRows) };
  }

  // ---- geospatial queries -------------------------------------------------
  /**
   * PostGIS-backed spatial reads.
   *
   * These exist so distance, coverage and containment are answered by the
   * database (indexed) rather than by pulling rows into Node. Each returns an
   * empty/neutral result when the extension is unavailable, so callers never
   * have to special-case the engine.
   */

  /** Centroid + convex-hull coverage of an incident's member reports. */
  async incidentSpatialSummary(incidentId) {
    if (!this.spatial.geometry) return null;
    const summary = await this.one(
      `SELECT
         ST_Y(ST_Centroid(ST_Collect(location)))                      AS centroid_latitude,
         ST_X(ST_Centroid(ST_Collect(location)))                      AS centroid_longitude,
         ST_Area(ST_ConvexHull(ST_Collect(location))::geography)      AS coverage_area_m2,
         COUNT(*)::int                                                AS member_reports
       FROM reports
       WHERE incident_id = $1 AND location IS NOT NULL`,
      [Number(incidentId)]
    );
    if (!summary || !Number(summary.member_reports)) return null;
    return {
      centroid: { latitude: summary.centroid_latitude, longitude: summary.centroid_longitude },
      coverage_area_m2: Math.round(Number(summary.coverage_area_m2 || 0)),
      member_reports: Number(summary.member_reports)
    };
  }

  /** Reports inside a radius — the "reports within radius" spatial query. */
  async reportsWithinRadius(point, radiusMeters) {
    const latitude = Number(point && point.latitude);
    const longitude = Number(point && point.longitude);
    const radius = Number(radiusMeters);
    if (!this.spatial.geometry || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !(radius > 0)) {
      return { total: 0, reports: [] };
    }
    const rows = await this.query(
      `SELECT id, incident_id, district, category, severity, created_at,
              ST_Distance(location::geography, ST_MakePoint($2, $1)::geography) AS distance_m
         FROM reports
        WHERE location IS NOT NULL
          AND ST_DWithin(location::geography, ST_MakePoint($2, $1)::geography, $3)
        ORDER BY distance_m ASC
        LIMIT 200`,
      [latitude, longitude, radius]
    );
    const reports = normalizePgRows(rows);
    return { total: reports.length, reports };
  }

  /** Active citizen accounts inside a radius — an aggregate, never a location list. */
  async usersNearEvent(point, radiusMeters) {
    const latitude = Number(point && point.latitude);
    const longitude = Number(point && point.longitude);
    const radius = Number(radiusMeters);
    if (!this.spatial.geometry || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !(radius > 0)) {
      return { total: 0, user_ids: [] };
    }
    const rows = await this.query(
      `SELECT id FROM app_users
        WHERE is_active = TRUE
          AND user_role = 'client'
          AND location IS NOT NULL
          AND ST_DWithin(location::geography, ST_MakePoint($2, $1)::geography, $3)
        LIMIT 500`,
      [latitude, longitude, radius]
    );
    const user_ids = rows.map(row => Number(row.id));
    return { total: user_ids.length, user_ids };
  }
}

module.exports = PostgresStore;
module.exports.INCIDENT_STATUSES = INCIDENT_STATUSES;
module.exports.INACTIVE_STATUSES = INACTIVE_STATUSES;