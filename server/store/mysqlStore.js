/**
 * MySQL store.
 *
 * Same interface as the in-memory store, implemented with parameterised mysql2
 * queries. `transaction()` hands the worker a connection-bound store so a
 * whole use case (insert report -> cluster -> aggregate -> notify -> audit)
 * commits or rolls back as one unit.
 */

const { normalizeIncident, normalizeReport, normalizeRow } = require("./normalize");
const { distanceMeters } = require("../domain/geo");

const toMysql = value => {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object" && !(value instanceof Date)) return JSON.stringify(value);
  return value;
};

/** Build `INSERT INTO t (a, b) VALUES (?, ?)` from an object. */
function insertSql(table, data) {
  const keys = Object.keys(data).filter(key => data[key] !== undefined);
  const placeholders = keys.map(() => "?").join(", ");
  return {
    sql: `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`,
    params: keys.map(key => toMysql(data[key]))
  };
}

/** Build `UPDATE t SET a = ?, b = ? WHERE id = ?` from an object. */
function updateSql(table, id, data) {
  const keys = Object.keys(data).filter(key => data[key] !== undefined);
  if (!keys.length) return null;
  return {
    sql: `UPDATE ${table} SET ${keys.map(key => `${key} = ?`).join(", ")} WHERE id = ?`,
    params: [...keys.map(key => toMysql(data[key])), id]
  };
}

class MySqlStore {
  constructor(pool, connection = null) {
    this.pool = pool;
    this.connection = connection;
  }

  get db() { return "mysql"; }
  get executor() { return this.connection || this.pool; }

  async query(sql, params = []) {
    const [rows] = await this.executor.query(sql, params);
    return rows;
  }

  async one(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows.length ? normalizeRow(rows[0]) : null;
  }

  async transaction(worker) {
    if (this.connection) return worker(this); // already inside a transaction
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const store = new MySqlStore(this.pool, connection);
      const result = await worker(store);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
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
      ? await this.query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?)", [keys])
      : await this.query("SELECT setting_key, setting_value FROM system_settings");
    const settings = {};
    for (const row of rows) settings[row.setting_key] = row.setting_value;
    return settings;
  }

  async setSetting(key, value) {
    await this.query(
      "INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
      [key, String(toMysql(value))]
    );
  }

  // ---- users --------------------------------------------------------------
  async findUser({ id, username, role }) {
    const filters = [];
    const params = [];
    if (id !== undefined && id !== null) { filters.push("id = ?"); params.push(id); }
    if (username !== undefined) { filters.push("username = ?"); params.push(username); }
    if (role) { filters.push("user_role = ?"); params.push(role); }
    if (!filters.length) return null;
    return this.one(`SELECT * FROM app_users WHERE ${filters.join(" AND ")} LIMIT 1`, params);
  }

  async createUser(data) {
    const { sql, params } = insertSql("app_users", data);
    const result = await this.query(sql, params);
    return this.findUser({ id: result.insertId });
  }

  async listUsers({ role, search } = {}) {
    const filters = [];
    const params = [];
    if (role) { filters.push("user_role = ?"); params.push(role); }
    if (search) {
      filters.push("(username LIKE ? OR full_name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = await this.query(`SELECT * FROM app_users ${where} ORDER BY created_at DESC LIMIT 500`, params);
    return rows.map(row => normalizeRow({ ...row, password_salt: undefined, password_hash: undefined }));
  }

  async setUserActive(id, isActive) {
    await this.query("UPDATE app_users SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, id]);
    return this.findUser({ id });
  }

  async updateUserPassword(id, { password_salt, password_hash }) {
    await this.query("UPDATE app_users SET password_salt = ?, password_hash = ? WHERE id = ?", [password_salt, password_hash, id]);
    return this.findUser({ id });
  }

  async countUsers() {
    const rows = await this.query("SELECT user_role, COUNT(*) AS total FROM app_users GROUP BY user_role");
    const counts = { client: 0, subcontractor: 0, socadel: 0 };
    for (const row of rows) if (counts[row.user_role] !== undefined) counts[row.user_role] = Number(row.total);
    return counts;
  }

  // ---- incidents ----------------------------------------------------------
  async listIncidents() {
    const rows = await this.query("SELECT * FROM incidents ORDER BY last_report_at DESC LIMIT 500");
    return rows.map(row => normalizeIncident(row));
  }

  async getIncident(id) {
    const row = await this.one("SELECT * FROM incidents WHERE id = ? LIMIT 1", [id]);
    return row ? normalizeIncident(row) : null;
  }

  async createIncident(data) {
    const { sql, params } = insertSql("incidents", data);
    const result = await this.query(sql, params);
    return this.getIncident(result.insertId);
  }

  async updateIncident(id, data) {
    const statement = updateSql("incidents", id, data);
    if (statement) await this.query(statement.sql, statement.params);
    return this.getIncident(id);
  }

  async findClusterCandidates({ sinceIso, limit = 80 }) {
    const rows = await this.query(
      "SELECT * FROM incidents WHERE last_report_at >= ? ORDER BY last_report_at DESC LIMIT ?",
      [toMysql(sinceIso), Number(limit)]
    );
    return rows.map(row => normalizeIncident(row));
  }

  async promoteQualifiedIncidents(minimumReports) {
    await this.query("UPDATE incidents SET status = 'pending_validation' WHERE status = 'pending' AND reports_count >= ?", [Number(minimumReports)]);
  }

  async incidentStats() {
    const rows = await this.query("SELECT status, COUNT(*) AS total FROM incidents GROUP BY status");
    const counts = { total: 0, active: 0, pending: 0, pending_validation: 0, validated: 0, assigned: 0,
      on_the_way: 0, under_intervention: 0, completed: 0, verification_pending: 0, closed: 0, rejected: 0, reports: 0 };
    for (const row of rows) {
      const total = Number(row.total);
      counts.total += total;
      if (counts[row.status] !== undefined) counts[row.status] = total;
      if (!["closed", "rejected"].includes(row.status)) counts.active += total;
    }
    const reportRows = await this.query("SELECT COUNT(*) AS total FROM reports");
    counts.reports = Number(reportRows[0]?.total || 0);
    return counts;
  }

  // ---- reports ------------------------------------------------------------
  async createReport(data) {
    const { sql, params } = insertSql("reports", data);
    const result = await this.query(sql, params);
    const row = await this.one("SELECT * FROM reports WHERE id = ? LIMIT 1", [result.insertId]);
    return normalizeReport(row);
  }

  async listReports({ incidentId, userId, limit = 100, offset = 0 } = {}) {
    const filters = [];
    const params = [];
    if (incidentId !== undefined) { filters.push("incident_id = ?"); params.push(Number(incidentId)); }
    if (userId !== undefined) { filters.push("user_id = ?"); params.push(Number(userId)); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const totalRows = await this.query(`SELECT COUNT(*) AS total FROM reports ${where}`, params);
    const rows = await this.query(
      `SELECT * FROM reports ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );
    return { rows: rows.map(row => normalizeReport(row)), total: Number(totalRows[0]?.total || 0) };
  }

  async clusterMembers(incidentId) {
    const rows = await this.query("SELECT latitude, longitude FROM reports WHERE incident_id = ?", [Number(incidentId)]);
    return rows.map(row => ({ latitude: Number(row.latitude), longitude: Number(row.longitude) }));
  }

  async setClusterSeverity(incidentId, severity) {
    await this.query("UPDATE reports SET severity = ? WHERE incident_id = ?", [severity, Number(incidentId)]);
  }

  // ---- messages -----------------------------------------------------------
  async listMessages(incidentId) {
    const rows = await this.query("SELECT * FROM incident_messages WHERE incident_id = ? ORDER BY created_at ASC LIMIT 300", [Number(incidentId)]);
    return rows.map(row => normalizeRow(row));
  }

  async createMessage(data) {
    const { sql, params } = insertSql("incident_messages", data);
    const result = await this.query(sql, params);
    const row = await this.one("SELECT * FROM incident_messages WHERE id = ? LIMIT 1", [result.insertId]);
    return normalizeRow(row);
  }

  // ---- confirmations ------------------------------------------------------
  async addConfirmation(data) {
    const { sql, params } = insertSql("incident_confirmations", data);
    const result = await this.query(sql, params);
    const row = await this.one("SELECT * FROM incident_confirmations WHERE id = ? LIMIT 1", [result.insertId]);
    return normalizeRow(row);
  }

  async confirmationCounts(incidentId) {
    const rows = await this.query(
      "SELECT confirmation_type, COUNT(*) AS total FROM incident_confirmations WHERE incident_id = ? GROUP BY confirmation_type",
      [Number(incidentId)]
    );
    const counts = { also_affected: 0, restored: 0 };
    for (const row of rows) if (counts[row.confirmation_type] !== undefined) counts[row.confirmation_type] = Number(row.total);
    return counts;
  }

  // ---- work requests ------------------------------------------------------
  async createWorkRequest(data) {
    const { sql, params } = insertSql("work_requests", data);
    const result = await this.query(sql, params);
    const row = await this.one("SELECT * FROM work_requests WHERE id = ? LIMIT 1", [result.insertId]);
    return normalizeRow(row);
  }

  async latestWorkRequest(incidentId) {
    const row = await this.one("SELECT * FROM work_requests WHERE incident_id = ? ORDER BY assigned_at DESC, id DESC LIMIT 1", [Number(incidentId)]);
    return row;
  }

  async updateWorkRequest(id, data) {
    const statement = updateSql("work_requests", id, data);
    if (statement) await this.query(statement.sql, statement.params);
    return this.one("SELECT * FROM work_requests WHERE id = ? LIMIT 1", [id]);
  }

  async listWorkRequests({ contractor } = {}) {
    const filters = [];
    const params = [];
    if (contractor) { filters.push("contractor = ?"); params.push(contractor); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = await this.query(`SELECT * FROM work_requests ${where} ORDER BY assigned_at DESC LIMIT 200`, params);
    return rows.map(row => normalizeRow(row));
  }

  // ---- notifications ------------------------------------------------------
  async addNotification(data) {
    const { sql, params } = insertSql("agency_notifications", data);
    const result = await this.query(sql, params);
    return this.one("SELECT * FROM agency_notifications WHERE id = ? LIMIT 1", [result.insertId]);
  }

  async listNotifications({ userId, agency, limit = 60 } = {}) {
    const filters = [];
    const params = [];
    if (userId !== undefined && userId !== null) { filters.push("user_id = ?"); params.push(Number(userId)); }
    if (agency) { filters.push("agency = ?"); params.push(agency); }
    if (!filters.length) return [];
    const rows = await this.query(
      `SELECT * FROM agency_notifications WHERE ${filters.join(" OR ")} ORDER BY created_at DESC LIMIT ?`,
      [...params, Number(limit)]
    );
    return rows.map(row => normalizeRow(row));
  }

  async markNotificationsRead({ userId, agency }) {
    const filters = [];
    const params = [];
    if (userId !== undefined && userId !== null) { filters.push("user_id = ?"); params.push(Number(userId)); }
    if (agency) { filters.push("agency = ?"); params.push(agency); }
    if (!filters.length) return;
    await this.query(`UPDATE agency_notifications SET is_read = 1 WHERE ${filters.join(" OR ")}`, params);
  }

  // ---- audit trail --------------------------------------------------------
  async addAudit({ actor, action, incident_id = null, details = null }) {
    const result = await this.query(
      "INSERT INTO audit_log (actor, action, incident_id, details) VALUES (?, ?, ?, ?)",
      [actor, action, incident_id, details === null || details === undefined ? null : JSON.stringify(details)]
    );
    return this.one("SELECT * FROM audit_log WHERE id = ? LIMIT 1", [result.insertId]);
  }

  async listAudit({ incidentId, limit = 100 } = {}) {
    const filters = [];
    const params = [];
    if (incidentId !== undefined) { filters.push("incident_id = ?"); params.push(Number(incidentId)); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = await this.query(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC, id DESC LIMIT ?`, [...params, Number(limit)]);
    return rows.map(row => {
      const normalized = normalizeRow(row);
      if (typeof normalized.details === "string") {
        try { normalized.details = JSON.parse(normalized.details); } catch { /* keep the raw text */ }
      }
      return normalized;
    });
  }

  // ---- zones --------------------------------------------------------------
  async listZones() {
    const rows = await this.query("SELECT * FROM zones ORDER BY name ASC");
    return rows.map(row => normalizeRow(row));
  }

  async createZone(data) {
    const { sql, params } = insertSql("zones", data);
    const result = await this.query(sql, params);
    return this.one("SELECT * FROM zones WHERE id = ? LIMIT 1", [result.insertId]);
  }

  /**
   * The zone whose circle contains a point.
   *
   * The PostgreSQL store answers this with a PostGIS `ST_DWithin` query; here the
   * same arithmetic runs over the (small) zone table so both engines agree.
   */
  async findZoneForPoint(point) {
    const latitude = Number(point && point.latitude);
    const longitude = Number(point && point.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const zones = await this.listZones();
    let best = null;
    for (const zone of zones) {
      const distance = distanceMeters(latitude, longitude, Number(zone.latitude), Number(zone.longitude));
      if (distance <= Number(zone.radius_m) && (!best || distance < best.distance)) best = { zone, distance };
    }
    return best ? best.zone : null;
  }

  async updateZone(id, data) {
    const statement = updateSql("zones", id, data);
    if (statement) await this.query(statement.sql, statement.params);
    return this.one("SELECT * FROM zones WHERE id = ? LIMIT 1", [id]);
  }

  async deleteZone(id) {
    const result = await this.query("DELETE FROM zones WHERE id = ?", [Number(id)]);
    return result.affectedRows > 0;
  }

  // ---- announcements ------------------------------------------------------
  async listAnnouncements({ publishedOnly = false } = {}) {
    const where = publishedOnly ? "WHERE published = 1" : "";
    const rows = await this.query(`SELECT * FROM announcements ${where} ORDER BY created_at DESC LIMIT 100`);
    return rows.map(row => normalizeRow(row));
  }

  async createAnnouncement(data) {
    const { sql, params } = insertSql("announcements", data);
    const result = await this.query(sql, params);
    return this.one("SELECT * FROM announcements WHERE id = ? LIMIT 1", [result.insertId]);
  }

  async updateAnnouncement(id, data) {
    const statement = updateSql("announcements", id, data);
    if (statement) await this.query(statement.sql, statement.params);
    return this.one("SELECT * FROM announcements WHERE id = ? LIMIT 1", [id]);
  }

  async deleteAnnouncement(id) {
    const result = await this.query("DELETE FROM announcements WHERE id = ?", [Number(id)]);
    return result.affectedRows > 0;
  }

  // ---- analytics ----------------------------------------------------------
  /** Raw rows the analytics service aggregates into KPIs and chart series. */
  async analyticsRows() {
    const [incidents, reports] = await Promise.all([
      this.query("SELECT id, status, severity, severity_score, district, reports_count, created_at, restored_at, closed_at FROM incidents"),
      this.query("SELECT id, district, severity, status, created_at, incident_id FROM reports")
    ]);
    return { incidents: incidents.map(row => normalizeIncident(row)), reports: reports.map(row => normalizeReport(row)) };
  }
}

module.exports = MySqlStore;



