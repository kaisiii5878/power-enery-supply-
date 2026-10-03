/**
 * In-memory store.
 *
 * Keeps PowerWatch runnable and demoable when MySQL is not installed, and acts
 * as the deterministic backing store for the automated test suite. It
 * implements exactly the same interface as the MySQL adapter, so use cases and
 * routes never branch on the active storage engine.
 *
 * Writes happen inside `transaction()`, which snapshots state and restores it
 * on failure — the in-memory equivalent of a MySQL rollback.
 */

const { recalcCluster } = require("../domain/clustering");
const { distanceMeters } = require("../domain/geo");

const clone = value => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const nowIso = () => new Date().toISOString();

class MemoryStore {
  constructor({ clusterConfig = { cluster_distance_m: 500, cluster_window_minutes: 30, min_reports_to_qualify: 1 }, seed = true } = {}) {
    this.settings = { ...clusterConfig };
    this.state = {
      users: [], incidents: [], reports: [], messages: [], confirmations: [],
      workRequests: [], notifications: [], audit: [], zones: [], announcements: [],
      sequences: { user: 0, incident: 90, report: 200, message: 0, confirmation: 0, workRequest: 0, notification: 0, audit: 0, zone: 0, announcement: 0 }
    };
    if (seed) this.seed();
  }

  get db() { return "memory"; }
  async close() {}

  seed() {
    this.state.incidents = clone(require("./seedIncidents"));
    this.state.reports = clone(require("./seedReports"));
    // Incident aggregates are derived, never trusted: recompute them from the
    // seeded reports with the same domain function the live workflow uses.
    for (const incident of this.state.incidents) {
      const members = this.state.reports.filter(report => report.incident_id === incident.id);
      const { qualified, ...aggregates } = recalcCluster(members, this.settings);
      Object.assign(incident, aggregates);
      incident.first_report_at = members.length ? members[members.length - 1].created_at : incident.first_report_at;
      incident.last_report_at = members.length ? members[0].created_at : incident.last_report_at;
      incident.updated_at = nowIso();
    }
    this.state.workRequests = [{
      id: 1, incident_id: 2, contractor: "VoltCare Contractors", assigned_by: "SOCADEL operator", status: "under_intervention",
      assigned_at: "2026-09-22T10:00:00.000Z", departed_at: "2026-09-22T10:30:00.000Z", arrival_time: "2026-09-22T11:00:00.000Z",
      completion_time: null, root_cause: "Low-voltage fuse link failure", diagnosis: "Transformer overload on the Akwa branch.",
      equipment: "Insulation tester, LV fuse kit", replaced_components: "2 x LV fuse links",
      technical_comments: "Branch isolated, fuses being replaced.", photo_url: null
    }];
    this.state.confirmations = [
      { id: 1, incident_id: 4, reporter_key: "seed-restored-1", confirmation_type: "restored", comment: "Power back since noon.", user_id: null, created_at: "2026-09-21T12:55:00.000Z" },
      { id: 2, incident_id: 4, reporter_key: "seed-affected-1", confirmation_type: "also_affected", comment: null, user_id: null, created_at: "2026-09-21T09:15:00.000Z" }
    ];
    this.state.sequences.confirmation = 2;
    this.state.zones = [
      { id: 1, name: "Yaounde Central", description: "Bastos, Centre-ville, Melen and Odza feeders.", region: "Centre", latitude: 3.8667, longitude: 11.5, radius_m: 6000, created_at: nowIso(), updated_at: nowIso() },
      { id: 2, name: "Douala Wouri", description: "Akwa, Bonamoussadi, Deido and Bonapriso feeders.", region: "Littoral", latitude: 4.0511, longitude: 9.7679, radius_m: 7000, created_at: nowIso(), updated_at: nowIso() }
    ];
    this.state.announcements = [{
      id: 1, title: "Planned maintenance — Bastos", body: "Scheduled works on 28 September 2026 from 08:00 to 14:00.",
      audience: "all", published: 1, created_by: "SOCADEL operator", created_at: nowIso(), updated_at: nowIso()
    }];
  }

  nextId(table) {
    this.state.sequences[table] = (this.state.sequences[table] || 0) + 1;
    return this.state.sequences[table];
  }

  async transaction(worker) {
    const snapshot = clone(this.state);
    try {
      return await worker(this);
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  async getSettings(keys) {
    if (!keys) return { ...this.settings };
    return Object.fromEntries(keys.filter(key => key in this.settings).map(key => [key, this.settings[key]]));
  }

  async setSetting(key, value) { this.settings[key] = value; }

  // ---- users --------------------------------------------------------------
  async findUser({ id, username, role }) {
    const match = this.state.users.find(user =>
      (id !== undefined && id !== null && user.id === Number(id)) ||
      (username !== undefined && user.username === username && (!role || user.user_role === role)));
    return clone(match || null);
  }

  async createUser({ username, full_name, user_role, password_salt, password_hash, email = null, phone = null }) {
    if (this.state.users.some(user => user.username === username)) {
      const error = new Error("Duplicate username");
      error.code = "ER_DUP_ENTRY";
      throw error;
    }
    const user = {
      id: this.nextId("user"), username, full_name, user_role, password_salt, password_hash,
      email, phone, is_active: 1, created_at: nowIso(), updated_at: nowIso()
    };
    this.state.users.push(user);
    return clone(user);
  }

  async listUsers({ role, search } = {}) {
    const term = String(search || "").trim().toLowerCase();
    const matches = this.state.users.filter(user =>
      (!role || user.user_role === role) &&
      (!term || user.username.includes(term) || String(user.full_name).toLowerCase().includes(term)));
    // Password material never leaves a store, on either engine.
    return matches.map(user => {
      const { password_salt, password_hash, ...safe } = user;
      return clone(safe);
    });
  }

  async setUserActive(id, isActive) {
    const user = this.state.users.find(item => item.id === Number(id));
    if (!user) return null;
    user.is_active = isActive ? 1 : 0;
    user.updated_at = nowIso();
    return clone(user);
  }

  async updateUserPassword(id, { password_salt, password_hash }) {
    const user = this.state.users.find(item => item.id === Number(id));
    if (!user) return null;
    Object.assign(user, { password_salt, password_hash, updated_at: nowIso() });
    return clone(user);
  }

  async countUsers() {
    const counts = { client: 0, subcontractor: 0, socadel: 0 };
    for (const user of this.state.users) if (counts[user.user_role] !== undefined) counts[user.user_role] += 1;
    return counts;
  }

  // ---- incidents ----------------------------------------------------------
  async listIncidents() { return clone(this.state.incidents); }

  async getIncident(id) {
    return clone(this.state.incidents.find(incident => incident.id === Number(id)) || null);
  }

  async createIncident(data) {
    const incident = {
      id: this.nextId("incident"), reference: data.reference, title: data.title, district: data.district,
      zone_id: data.zone_id ?? null, latitude: data.latitude, longitude: data.longitude,
      radius_m: data.radius_m ?? 500, estimated_area_m2: 0, reports_count: 0, severity_score: 0,
      severity: "low", status: "pending", assignee: null, root_cause: data.root_cause ?? null,
      resolution: data.resolution ?? null, agency_report: null, rejection_reason: null,
      first_report_at: nowIso(), last_report_at: nowIso(), validated_by: null, validated_at: null,
      completed_at: null, restored_at: null, closed_at: null, created_at: nowIso(), updated_at: nowIso()
    };
    this.state.incidents.unshift(incident);
    return clone(incident);
  }

  async updateIncident(id, fields) {
    const incident = this.state.incidents.find(item => item.id === Number(id));
    if (!incident) return null;
    Object.assign(incident, fields, { updated_at: nowIso() });
    return clone(incident);
  }

  async findClusterCandidates({ sinceIso, limit = 80 }) {
    const since = new Date(sinceIso).getTime();
    return clone(this.state.incidents
      .filter(incident => new Date(incident.last_report_at || incident.created_at || 0).getTime() >= since)
      .sort((a, b) => String(b.last_report_at).localeCompare(String(a.last_report_at)))
      .slice(0, limit));
  }

  async promoteQualifiedIncidents(minimumReports) {
    for (const incident of this.state.incidents) {
      if (incident.status === "pending" && Number(incident.reports_count || 0) >= Number(minimumReports)) {
        incident.status = "pending_validation";
        incident.updated_at = nowIso();
      }
    }
  }

  async incidentStats() {
    const counts = { total: 0, active: 0, pending: 0, pending_validation: 0, validated: 0, assigned: 0,
      on_the_way: 0, under_intervention: 0, completed: 0, verification_pending: 0, closed: 0, rejected: 0, reports: 0 };
    for (const incident of this.state.incidents) {
      counts.total += 1;
      if (counts[incident.status] !== undefined) counts[incident.status] += 1;
      if (!["closed", "rejected"].includes(incident.status)) counts.active += 1;
    }
    counts.reports = this.state.reports.length;
    return counts;
  }

  // ---- reports ------------------------------------------------------------
  async createReport(data) {
    const report = {
      id: this.nextId("report"), incident_id: data.incident_id ?? null, user_id: data.user_id ?? null,
      reporter_name: data.reporter_name, phone: data.phone ?? null, category: data.category,
      description: data.description ?? null, district: data.district, latitude: data.latitude,
      longitude: data.longitude, status: "clustered", severity: "low", photo_url: data.photo_url ?? null,
      created_at: nowIso()
    };
    this.state.reports.unshift(report);
    return clone(report);
  }

  async listReports({ incidentId, userId, limit = 100, offset = 0 } = {}) {
    const rows = this.state.reports
      .filter(report =>
        (incidentId === undefined || report.incident_id === Number(incidentId)) &&
        (userId === undefined || Number(report.user_id) === Number(userId)))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { rows: clone(rows.slice(offset, offset + limit)), total: rows.length };
  }

  async clusterMembers(incidentId) {
    return clone(this.state.reports
      .filter(report => report.incident_id === Number(incidentId))
      .map(report => ({ latitude: report.latitude, longitude: report.longitude })));
  }

  async setClusterSeverity(incidentId, severity) {
    for (const report of this.state.reports) if (report.incident_id === Number(incidentId)) report.severity = severity;
  }

  // ---- messages -----------------------------------------------------------
  async listMessages(incidentId) {
    return clone(this.state.messages
      .filter(message => message.incident_id === Number(incidentId))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
  }

  async createMessage({ incident_id, author_role, author_name, author_user_id = null, body }) {
    const message = {
      id: this.nextId("message"), incident_id: Number(incident_id), author_role, author_name,
      author_user_id, body, created_at: nowIso()
    };
    this.state.messages.push(message);
    return clone(message);
  }

  // ---- confirmations ------------------------------------------------------
  async addConfirmation({ incident_id, reporter_key, confirmation_type, comment = null, user_id = null }) {
    const duplicate = this.state.confirmations.some(item =>
      item.incident_id === Number(incident_id) &&
      item.reporter_key === reporter_key &&
      item.confirmation_type === confirmation_type);
    if (duplicate) {
      const error = new Error("Already confirmed");
      error.code = "ER_DUP_ENTRY";
      throw error;
    }
    const confirmation = {
      id: this.nextId("confirmation"), incident_id: Number(incident_id), reporter_key,
      confirmation_type, comment, user_id, created_at: nowIso()
    };
    this.state.confirmations.push(confirmation);
    return clone(confirmation);
  }

  async confirmationCounts(incidentId) {
    const rows = this.state.confirmations.filter(item => item.incident_id === Number(incidentId));
    return {
      also_affected: rows.filter(item => item.confirmation_type === "also_affected").length,
      restored: rows.filter(item => item.confirmation_type === "restored").length
    };
  }

  // ---- work requests ------------------------------------------------------
  async createWorkRequest({ incident_id, contractor, assigned_by }) {
    const work = {
      id: this.nextId("workRequest"), incident_id: Number(incident_id), contractor, assigned_by, status: "assigned",
      assigned_at: nowIso(), departed_at: null, arrival_time: null, completion_time: null, root_cause: null,
      diagnosis: null, equipment: null, replaced_components: null, technical_comments: null, photo_url: null
    };
    this.state.workRequests.push(work);
    return clone(work);
  }

  async latestWorkRequest(incidentId) {
    const rows = this.state.workRequests.filter(work => work.incident_id === Number(incidentId));
    return clone(rows[rows.length - 1] || null);
  }

  async updateWorkRequest(id, fields) {
    const work = this.state.workRequests.find(item => item.id === Number(id));
    if (!work) return null;
    Object.assign(work, fields);
    return clone(work);
  }

  async listWorkRequests({ contractor } = {}) {
    return clone(this.state.workRequests
      .filter(work => !contractor || work.contractor === contractor)
      .sort((a, b) => String(b.assigned_at).localeCompare(String(a.assigned_at))));
  }

  // ---- notifications ------------------------------------------------------
  async addNotification({ user_id = null, agency = null, incident_id = null, event_type, title, message }) {
    const notification = {
      id: this.nextId("notification"), user_id, agency, incident_id, event_type, title, message, is_read: 0, created_at: nowIso()
    };
    this.state.notifications.unshift(notification);
    return clone(notification);
  }

  async listNotifications({ userId, agency, limit = 60 } = {}) {
    return clone(this.state.notifications
      .filter(item =>
        (userId !== undefined && userId !== null && item.user_id === Number(userId)) ||
        (agency && item.agency === agency))
      .slice(0, limit));
  }

  async markNotificationsRead({ userId, agency }) {
    for (const item of this.state.notifications) {
      if ((userId !== undefined && userId !== null && item.user_id === Number(userId)) || (agency && item.agency === agency)) {
        item.is_read = 1;
      }
    }
  }

  // ---- audit trail --------------------------------------------------------
  async addAudit({ actor, action, incident_id = null, details = null }) {
    const entry = { id: this.nextId("audit"), actor, action, incident_id, details, created_at: nowIso() };
    this.state.audit.unshift(entry);
    return clone(entry);
  }

  async listAudit({ incidentId, limit = 100 } = {}) {
    return clone(this.state.audit
      .filter(entry => incidentId === undefined || Number(entry.incident_id) === Number(incidentId))
      .slice(0, limit));
  }

  // ---- zones --------------------------------------------------------------
  async listZones() { return clone(this.state.zones); }

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
    let best = null;
    for (const zone of this.state.zones) {
      const distance = distanceMeters(latitude, longitude, Number(zone.latitude), Number(zone.longitude));
      if (distance <= Number(zone.radius_m) && (!best || distance < best.distance)) best = { zone, distance };
    }
    return best ? clone(best.zone) : null;
  }

  async createZone(data) {
    this.assertZoneNameFree(data.name);
    const zone = { id: this.nextId("zone"), ...data, created_at: nowIso(), updated_at: nowIso() };
    this.state.zones.push(zone);
    return clone(zone);
  }

  /** Keeps in-memory behaviour identical to the UNIQUE index on zones.name. */
  assertZoneNameFree(name, exceptId = null) {
    const clash = this.state.zones.some(zone => zone.name === name && zone.id !== Number(exceptId));
    if (!clash) return;
    const error = new Error(`A zone named "${name}" already exists.`);
    error.code = "ER_DUP_ENTRY";
    throw error;
  }

  async updateZone(id, data) {
    const zone = this.state.zones.find(item => item.id === Number(id));
    if (!zone) return null;
    if (data.name !== undefined) this.assertZoneNameFree(data.name, zone.id);
    Object.assign(zone, data, { updated_at: nowIso() });
    return clone(zone);
  }

  async deleteZone(id) {
    const index = this.state.zones.findIndex(item => item.id === Number(id));
    if (index === -1) return false;
    this.state.zones.splice(index, 1);
    for (const incident of this.state.incidents) if (Number(incident.zone_id) === Number(id)) incident.zone_id = null;
    return true;
  }

  // ---- announcements ------------------------------------------------------
  async listAnnouncements({ publishedOnly = false } = {}) {
    return clone(this.state.announcements
      .filter(item => !publishedOnly || Number(item.published) === 1)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
  }

  async createAnnouncement(data) {
    const announcement = { id: this.nextId("announcement"), ...data, created_at: nowIso(), updated_at: nowIso() };
    this.state.announcements.unshift(announcement);
    return clone(announcement);
  }

  async updateAnnouncement(id, data) {
    const announcement = this.state.announcements.find(item => item.id === Number(id));
    if (!announcement) return null;
    Object.assign(announcement, data, { updated_at: nowIso() });
    return clone(announcement);
  }

  async deleteAnnouncement(id) {
    const index = this.state.announcements.findIndex(item => item.id === Number(id));
    if (index === -1) return false;
    this.state.announcements.splice(index, 1);
    return true;
  }

  // ---- analytics ----------------------------------------------------------
  /** Raw rows the analytics service aggregates into KPIs and chart series. */
  async analyticsRows() {
    return {
      incidents: clone(this.state.incidents),
      reports: clone(this.state.reports.map(report => ({
        id: report.id, district: report.district, severity: report.severity,
        status: report.status, created_at: report.created_at, incident_id: report.incident_id
      })))
    };
  }
}

module.exports = MemoryStore;




