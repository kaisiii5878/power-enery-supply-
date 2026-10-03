/**
 * Incident use cases — the workflow described in the project brief:
 *
 *   citizen report -> rule-based clustering -> SOCADEL validation ->
 *   subcontractor assignment -> field intervention -> citizen restoration
 *   verification -> closure, with notifications and an audit trail throughout.
 *
 * Every state change goes through `domain/incidentLifecycle`, and every write
 * runs inside one store transaction so a report can never be attached to an
 * incident that failed to aggregate.
 */

const { matchIncident, recalcCluster, nextReference, normalizeConfig } = require("../domain/clustering");
const { isInsideCameroon } = require("../domain/geo");
const { hashReporterKey } = require("../domain/passwords");
const lifecycle = require("../domain/incidentLifecycle");
const { badRequest, notFound, conflict } = require("../http/errors");

const CLUSTER_SETTINGS = ["cluster_distance_m", "cluster_window_minutes", "min_reports_to_qualify"];
const REPORT_CATEGORIES = ["Total outage", "Low voltage", "Flickering", "Sparking / unsafe line", "Meter problem", "Other"];

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

function readCoordinates(input = {}) {
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw badRequest("Coordinates are required to locate the outage.");
  if (!isInsideCameroon(latitude, longitude)) throw badRequest("Coordinates must be inside Cameroon.");
  return { latitude, longitude };
}

/** Rounds coordinates for public responses: citizens see an area, not an address. */
function coarseCoordinates(incident, precision = 3) {
  if (!incident) return incident;
  const factor = 10 ** precision;
  return {
    ...incident,
    latitude: Math.round(Number(incident.latitude) * factor) / factor,
    longitude: Math.round(Number(incident.longitude) * factor) / factor
  };
}

function createIncidentService({ store, config }) {
  async function clusterConfig() {
    const stored = await store.getSettings(CLUSTER_SETTINGS);
    const parsed = {};
    for (const key of CLUSTER_SETTINGS) if (stored[key] !== undefined) parsed[key] = Number(stored[key]);
    return normalizeConfig(parsed, normalizeConfig(config.cluster));
  }

  /**
   * Attaches a report to the zone whose circle contains it, when configured.
   *
   * The store owns the spatial lookup: PostgreSQL answers it with an indexed
   * PostGIS `ST_DWithin`, the other engines apply the same arithmetic in JS, so
   * the result is identical whichever database is attached.
   */
  async function zoneForPoint(executor, point) {
    return executor.findZoneForPoint(point);
  }

  async function requireIncident(executor, id) {
    const incident = await executor.getIncident(id);
    if (!incident) throw notFound(`Incident ${id} does not exist.`);
    return incident;
  }

  /** Workflow A — SOCADEL confirms a cluster is a real outage. */
  async function validateIncident(id, { actor, agencyReport, rootCause } = {}) {
    return store.transaction(async tx => {
      const incident = await requireIncident(tx, id);
      lifecycle.assertTransition(incident.status, "validated");
      const updated = await tx.updateIncident(id, {
        status: "validated",
        validated_by: actor.name,
        validated_at: new Date().toISOString(),
        agency_report: text(agencyReport, 1000) || incident.agency_report,
        root_cause: text(rootCause, 180) || incident.root_cause,
        rejection_reason: null
      });
      await tx.addAudit({ actor: actor.name, action: "incident.validated", incident_id: Number(id), details: { from: incident.status } });
      return updated;
    });
  }

  /** A cluster that is not a real outage is rejected with a public reason. */
  async function rejectIncident(id, { actor, reason } = {}) {
    const note = text(reason, 500);
    if (note.length < 5) throw badRequest("A short reason is required when rejecting a cluster.");
    return store.transaction(async tx => {
      const incident = await requireIncident(tx, id);
      lifecycle.assertTransition(incident.status, "rejected");
      const updated = await tx.updateIncident(id, { status: "rejected", rejection_reason: note, closed_at: new Date().toISOString() });
      await tx.addNotification({
        agency: "client", incident_id: updated.id, event_type: "incident.rejected",
        title: "Report closed without dispatch", message: note
      });
      await tx.addAudit({ actor: actor.name, action: "incident.rejected", incident_id: Number(id), details: { reason: note } });
      return updated;
    });
  }

  /** Only a validated incident can be handed to a subcontractor. */
  async function assignIncident(id, { actor, contractor } = {}) {
    const crew = text(contractor, 140);
    if (crew.length < 2) throw badRequest("Choose the subcontractor that will handle this incident.");
    return store.transaction(async tx => {
      const incident = await requireIncident(tx, id);
      lifecycle.assertAssignable(incident.status);
      lifecycle.assertTransition(incident.status, "assigned");
      const updated = await tx.updateIncident(id, { status: "assigned", assignee: crew });
      await tx.createWorkRequest({ incident_id: updated.id, contractor: crew, assigned_by: actor.name });
      await tx.addNotification({
        agency: "subcontractor", incident_id: updated.id, event_type: "work.assigned",
        title: `New work order for ${updated.district}`,
        message: `${updated.reference} (${updated.severity}) — ${updated.reports_count} reports.`
      });
      await tx.addAudit({ actor: actor.name, action: "incident.assigned", incident_id: updated.id, details: { contractor: crew } });
      return { incident: updated, workRequest: await tx.latestWorkRequest(updated.id) };
    });
  }

  const AGENT_STEPS = {
    on_the_way: { work: { status: "departed", departed_at: "timestamp" } },
    under_intervention: { work: { status: "on_site", arrival_time: "timestamp" } },
    completed: { work: { status: "completed", completion_time: "timestamp" } }
  };

  /** Workflow B — the crew advances the job from the field. */
  async function updateFromField(id, { actor, status, notes } = {}) {
    const step = AGENT_STEPS[status];
    if (!step) throw badRequest(`Field status must be one of: ${Object.keys(AGENT_STEPS).join(", ")}.`);
    return store.transaction(async tx => {
      const incident = await requireIncident(tx, id);
      lifecycle.assertTransition(incident.status, status);
      const work = await tx.latestWorkRequest(id);
      if (!work) throw notFound("This incident has no work order yet — SOCADEL must assign it first.");
      if (actor.role === "subcontractor" && work.contractor !== actor.company) {
        throw badRequest("This work order belongs to another contractor.");
      }

      const workFields = {};
      for (const [field, kind] of Object.entries(step.work)) {
        workFields[field] = kind === "timestamp" ? new Date().toISOString() : kind;
      }
      if (status === "completed") {
        workFields.root_cause = text(notes && notes.rootCause, 180) || null;
        workFields.diagnosis = text(notes && notes.diagnosis, 1000) || null;
        workFields.equipment = text(notes && notes.equipment, 255) || null;
        workFields.replaced_components = text(notes && notes.replacedComponents, 255) || null;
        workFields.technical_comments = text(notes && notes.comments, 1000) || null;
      }
      await tx.updateWorkRequest(work.id, workFields);

      // Completion immediately opens the citizen verification phase.
      let nextStatus = status;
      if (status === "completed") {
        lifecycle.assertTransition("completed", "verification_pending");
        nextStatus = "verification_pending";
      }
      const updated = await tx.updateIncident(id, {
        status: nextStatus,
        assignee: work.contractor,
        completed_at: status === "completed" ? new Date().toISOString() : incident.completed_at,
        root_cause: status === "completed" ? (workFields.root_cause || incident.root_cause) : incident.root_cause,
        resolution: status === "completed" ? (workFields.technical_comments || incident.resolution) : incident.resolution
      });

      if (nextStatus === "verification_pending") {
        await tx.addNotification({
          agency: "socadel", incident_id: updated.id, event_type: "incident.awaiting_verification",
          title: `Crew finished at ${updated.district}`,
          message: "Waiting for citizens to confirm restoration before closure."
        });
        await tx.addNotification({
          agency: "client", incident_id: updated.id, event_type: "restoration.verification",
          title: "Is your power back?", message: `Confirm restoration for ${updated.district}.`
        });
      }

      await tx.addAudit({
        actor: actor.name, action: `incident.${status}`, incident_id: updated.id,
        details: { from: incident.status, contractor: work.contractor }
      });
      return { incident: updated, workRequest: await tx.latestWorkRequest(id) };
    });
  }

  /** Closing is gated on at least one citizen confirming restoration. */
  async function closeIncident(id, { actor, override = false, summary } = {}) {
    return store.transaction(async tx => {
      const incident = await requireIncident(tx, id);
      const counts = await tx.confirmationCounts(id);
      lifecycle.assertClosable(incident, { restoredConfirmations: counts.restored, override: Boolean(override) });
      const updated = await tx.updateIncident(id, {
        status: "closed",
        closed_at: new Date().toISOString(),
        restored_at: incident.restored_at || new Date().toISOString(),
        resolution: text(summary, 1000) || incident.resolution
      });
      const work = await tx.latestWorkRequest(id);
      if (work) await tx.updateWorkRequest(work.id, { status: "verified" });
      await tx.addNotification({
        agency: "client", incident_id: updated.id, event_type: "incident.closed",
        title: `Outage resolved in ${updated.district}`,
        message: `${updated.reference} is closed. Thank you for confirming.`
      });
      await tx.addAudit({
        actor: actor.name, action: "incident.closed", incident_id: updated.id,
        details: { restored_confirmations: counts.restored, override: Boolean(override) }
      });
      return updated;
    });
  }

  /** Verification failed: operators or the crew reopen the job. */
  async function reopenIncident(id, { actor, reason } = {}) {
    return store.transaction(async tx => {
      const incident = await requireIncident(tx, id);
      lifecycle.assertTransition(incident.status, "under_intervention");
      const updated = await tx.updateIncident(id, { status: "under_intervention", restored_at: null });
      const work = await tx.latestWorkRequest(id);
      if (work) await tx.updateWorkRequest(work.id, { status: "on_site", completion_time: null });
      await tx.addNotification({
        agency: "subcontractor", incident_id: updated.id, event_type: "work.reopened",
        title: `Reopened: ${updated.district}`, message: text(reason, 300) || "Citizens report the outage is still active."
      });
      await tx.addAudit({ actor: actor.name, action: "incident.reopened", incident_id: updated.id, details: { reason: text(reason, 300) } });
      return updated;
    });
  }

  /**
   * Two-way citizen verification. `reporter_key` is an irreversible hash of the
   * signed-in user id or the anonymous device id, so one person can confirm a
   * given incident at most once per type without being identified.
   */
  async function confirmIncident(id, { type, deviceId, comment, auth } = {}) {
    if (!["also_affected", "restored"].includes(type)) throw badRequest("Confirmation type must be also_affected or restored.");
    const identity = auth ? `user:${auth.id}` : `device:${text(deviceId, 120)}`;
    if (!auth && identity === "device:") throw badRequest("A device identifier is required to confirm as a guest.");
    return store.transaction(async tx => {
      const incident = await requireIncident(tx, id);
      if (type === "also_affected" && !lifecycle.ACTIVE_STATUSES.includes(incident.status)) {
        throw badRequest("This incident is no longer active, so it cannot be confirmed as affected.");
      }
      if (type === "restored" && !["verification_pending", "closed"].includes(incident.status)) {
        throw badRequest("Restoration can only be confirmed once the crew has reported completion.");
      }
      let confirmation;
      try {
        confirmation = await tx.addConfirmation({
          incident_id: Number(id),
          user_id: auth ? auth.id : null,
          reporter_key: hashReporterKey(identity),
          confirmation_type: type,
          comment: text(comment, 500) || null
        });
      } catch (error) {
        if (error.code === "ER_DUP_ENTRY") throw conflict("You have already recorded this confirmation.");
        throw error;
      }

      const counts = await tx.confirmationCounts(id);
      if (type === "restored" && incident.status === "verification_pending") {
        await tx.addNotification({
          agency: "socadel", incident_id: Number(id), event_type: "restoration.confirmed",
          title: `Restoration confirmed in ${incident.district}`,
          message: `${counts.restored} citizen(s) confirmed power is back. The incident can now be closed.`
        });
      }
      await tx.addAudit({
        actor: auth ? auth.name : "anonymous-citizen", action: `confirmation.${type}`,
        incident_id: Number(id), details: { also_affected: counts.also_affected, restored: counts.restored }
      });
      return { confirmation, counts };
    });
  }

  /** Incident chat. Authorship always comes from the authenticated principal. */
  async function addMessage(id, { actor, body } = {}) {
    const message = text(body, 2000);
    if (message.length < 2) throw badRequest("Write a message before sending.");
    return store.transaction(async tx => {
      await requireIncident(tx, id);
      return tx.createMessage({
        incident_id: Number(id),
        author_user_id: actor.id,
        author_role: actor.role,
        author_name: actor.name,
        body: message
      });
    });
  }

  /** Full incident view for the console: aggregates, reports, work order, chat. */
  async function incidentDetail(id, { precision = config.locationPrecision } = {}) {
    const incident = await store.getIncident(id);
    if (!incident) throw notFound(`Incident ${id} does not exist.`);
    const [reports, messages, workRequest, confirmations, audit] = await Promise.all([
      store.listReports({ incidentId: incident.id, limit: 50 }),
      store.listMessages(incident.id),
      store.latestWorkRequest(incident.id),
      store.confirmationCounts(incident.id),
      store.listAudit({ incidentId: incident.id, limit: 40 })
    ]);
    return {
      incident: coarseCoordinates(incident, precision),
      reports: reports.rows,
      reports_total: reports.total,
      messages,
      work_request: workRequest,
      confirmations,
      audit,
      next_statuses: lifecycle.allowedTransitions(incident.status)
    };
  }

  async function listIncidents({ status, severity, search } = {}) {
    const incidents = await store.listIncidents();
    const term = text(search, 80).toLowerCase();
    return incidents.filter(incident =>
      (!status || incident.status === status) &&
      (!severity || incident.severity === severity) &&
      (!term || `${incident.reference} ${incident.title} ${incident.district}`.toLowerCase().includes(term)));
  }

  /** Public map feed: coarse coordinates only, no reporter data. */
  async function publicIncidents() {
    const incidents = await store.listIncidents();
    return incidents
      .filter(incident => incident.status !== "rejected")
      .map(incident => coarseCoordinates({
        id: incident.id,
        reference: incident.reference,
        title: incident.title,
        district: incident.district,
        latitude: incident.latitude,
        longitude: incident.longitude,
        radius_m: incident.radius_m,
        reports_count: incident.reports_count,
        severity: incident.severity,
        status: incident.status,
        root_cause: incident.root_cause,
        assignee: incident.status === "closed" ? incident.assignee : null,
        last_report_at: incident.last_report_at,
        restored_at: incident.restored_at,
        closed_at: incident.closed_at
      }, config.locationPrecision));
  }

  /** Public incident page: aggregates and chat only — never reporter details. */
  async function publicIncidentDetail(id) {
    const detail = await incidentDetail(id, { precision: config.locationPrecision });
    return {
      incident: detail.incident,
      reports_count: detail.reports_total,
      confirmations: detail.confirmations,
      messages: detail.messages,
      status: detail.incident.status,
      is_closed: detail.incident.status === "closed",
      can_confirm_affected: lifecycle.ACTIVE_STATUSES.includes(detail.incident.status),
      can_confirm_restored: ["verification_pending", "closed"].includes(detail.incident.status)
    };
  }

  async function updateClusteringSettings({ actor, settings }) {
    const next = normalizeConfig({ ...(await clusterConfig()), ...settings });
    for (const [key, value] of Object.entries(next)) {
      if (!Number.isFinite(value) || value <= 0) throw badRequest(`${key} must be a positive number.`);
      await store.setSetting(key, String(value));
    }
    await store.addAudit({ actor: actor.name, action: "settings.clustering_updated", details: next });
    return next;
  }

  /**
   * Workflow A — clustering. A report either joins the most recently active
   * incident within the radius/window, or opens a new one.
   */
  async function submitReport(input = {}, { auth } = {}) {
    const point = readCoordinates(input);
    const category = REPORT_CATEGORIES.includes(input.category) ? input.category : "Other";
    const district = text(input.district, 180);
    if (!district) throw badRequest("A district or neighbourhood is required.");
    const reporterName = text((auth && auth.name) || input.reporterName || "Anonymous citizen", 120);
    const description = text(input.description, 1000);
    const settings = await clusterConfig();
    const now = Date.now();

    return store.transaction(async tx => {
      const candidates = await tx.findClusterCandidates({
        sinceIso: new Date(now - settings.cluster_window_minutes * 60_000).toISOString(),
        // PostgreSQL narrows these candidates with an indexed PostGIS radius
        // query; the other engines ignore the extra hints and filter in memory.
        point,
        radiusMeters: settings.cluster_distance_m
      });
      const match = matchIncident(candidates, point, settings, now);

      let incident = match ? match.incident : null;
      const isNew = !incident;
      if (!incident) {
        const zone = await zoneForPoint(tx, point);
        incident = await tx.createIncident({
          reference: nextReference(),
          title: `${category} reported in ${district}`,
          district,
          zone_id: zone ? zone.id : null,
          latitude: point.latitude,
          longitude: point.longitude,
          radius_m: Math.max(50, Math.round(settings.cluster_distance_m / 2))
        });
      }

      const report = await tx.createReport({
        incident_id: incident.id,
        user_id: auth ? auth.id : null,
        reporter_name: reporterName,
        phone: text(input.phone, 40) || null,
        category,
        description: description || null,
        district,
        latitude: point.latitude,
        longitude: point.longitude,
        photo_url: text(input.photoUrl, 500) || null
      });

      const members = await tx.clusterMembers(incident.id);
      const { qualified, ...aggregates } = recalcCluster(members, settings);
      const promoted = qualified && incident.status === "pending" ? "pending_validation" : incident.status;
      const updated = await tx.updateIncident(incident.id, {
        ...aggregates,
        status: promoted,
        last_report_at: report.created_at,
        first_report_at: isNew ? report.created_at : incident.first_report_at
      });
      await tx.setClusterSeverity(incident.id, aggregates.severity);

      if (promoted === "pending_validation" && incident.status !== "pending_validation") {
        await tx.addNotification({
          agency: "socadel",
          incident_id: updated.id,
          event_type: "incident.awaiting_validation",
          title: `${String(updated.severity).toUpperCase()} cluster in ${updated.district}`,
          message: `${updated.reports_count} reports within ${updated.radius_m} m need validation.`
        });
      }

      await tx.addAudit({
        actor: reporterName,
        action: isNew ? "incident.created_from_report" : "report.attached",
        incident_id: updated.id,
        details: { category, district, distance_m: match ? match.distanceM : null, reports_count: updated.reports_count }
      });

      return { incident: updated, report, isNew, matchedDistanceM: match ? match.distanceM : null };
    });
  }

  return {
    REPORT_CATEGORIES,
    submitReport,
    validateIncident,
    rejectIncident,
    assignIncident,
    updateFromField,
    closeIncident,
    reopenIncident,
    confirmIncident,
    addMessage,
    incidentDetail,
    publicIncidentDetail,
    listIncidents,
    publicIncidents,
    updateClusteringSettings,
    clusterConfig
  };
}

module.exports = { createIncidentService, REPORT_CATEGORIES, coarseCoordinates };
