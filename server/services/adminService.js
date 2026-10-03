/**
 * Administrative use cases: accounts, operational zones, announcements,
 * notification queues and the audit trail. Everything here is gated by role at
 * the route layer; the service still records who did what.
 */

const { badRequest, notFound, conflict, forbidden } = require("../http/errors");
const { ACTIVE_STATUSES } = require("../domain/incidentLifecycle");

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

function createAdminService({ store, auth }) {
  // ---- accounts -----------------------------------------------------------
  async function listUsers(query) {
    return store.listUsers({ role: query.role, search: query.search });
  }

  async function setUserActive(id, { actor, isActive }) {
    if (Number(id) === Number(actor.id)) throw badRequest("You cannot deactivate your own account.");
    const user = await store.setUserActive(id, isActive);
    if (!user) throw notFound("Account not found.");
    await store.addAudit({ actor: actor.name, action: isActive ? "account.activated" : "account.deactivated", details: { username: user.username } });
    return auth.publicUser(user);
  }

  // ---- zones --------------------------------------------------------------
  function zoneInput(input = {}) {
    const name = text(input.name, 120);
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    const radius = Number(input.radius_m ?? 5000);
    if (name.length < 2) throw badRequest("A zone name is required.");
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw badRequest("Zone centre coordinates are required.");
    if (!Number.isFinite(radius) || radius < 100) throw badRequest("Zone radius must be at least 100 metres.");
    return {
      name,
      description: text(input.description, 255) || null,
      region: text(input.region, 80) || null,
      latitude,
      longitude,
      radius_m: Math.round(radius)
    };
  }

  async function createZone(input, { actor }) {
    try {
      const zone = await store.createZone(zoneInput(input));
      await store.addAudit({ actor: actor.name, action: "zone.created", details: { name: zone.name } });
      return zone;
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") throw conflict("A zone with that name already exists.");
      throw error;
    }
  }

  async function updateZone(id, input, { actor }) {
    const zone = await store.updateZone(id, zoneInput({ ...input, name: input.name }));
    if (!zone) throw notFound("Zone not found.");
    await store.addAudit({ actor: actor.name, action: "zone.updated", details: { zone_id: zone.id } });
    return zone;
  }

  async function deleteZone(id, { actor }) {
    const removed = await store.deleteZone(id);
    if (!removed) throw notFound("Zone not found.");
    await store.addAudit({ actor: actor.name, action: "zone.deleted", details: { zone_id: Number(id) } });
    return { ok: true };
  }

  // ---- announcements ------------------------------------------------------
  async function saveAnnouncement(input, { actor, id }) {
    const title = text(input.title, 180);
    const body = text(input.body, 4000);
    if (title.length < 3 || body.length < 5) throw badRequest("An announcement needs a title and a body.");
    const audience = ["all", "client", "subcontractor"].includes(input.audience) ? input.audience : "all";
    const payload = { title, body, audience, published: input.published === undefined ? 1 : (input.published ? 1 : 0) };
    const announcement = id ? await store.updateAnnouncement(id, payload) : await store.createAnnouncement({ ...payload, created_by: actor.name });
    if (!announcement) throw notFound("Announcement not found.");
    await store.addAudit({ actor: actor.name, action: id ? "announcement.updated" : "announcement.created", details: { title } });
    return announcement;
  }

  async function deleteAnnouncement(id, { actor }) {
    const removed = await store.deleteAnnouncement(id);
    if (!removed) throw notFound("Announcement not found.");
    await store.addAudit({ actor: actor.name, action: "announcement.deleted", details: { announcement_id: Number(id) } });
    return { ok: true };
  }

  // ---- queues -------------------------------------------------------------
  /**
   * The contractor queue. Crews only ever see work addressed to their own
   * company, plus the incidents that are still open.
   */
  async function contractorQueue({ actor }) {
    if (actor.role !== "subcontractor") throw forbidden("Only subcontractor accounts have a work queue.");
    const [workRequests, incidents] = await Promise.all([
      store.listWorkRequests({ contractor: actor.company }),
      store.listIncidents()
    ]);
    const byId = new Map(incidents.map(incident => [incident.id, incident]));
    return workRequests
      .filter(work => ACTIVE_STATUSES.includes((byId.get(work.incident_id) || {}).status))
      .map(work => ({ ...work, incident: byId.get(work.incident_id) || null }));
  }

  async function notificationsFor({ principal, limit = 60 }) {
    return store.listNotifications({ userId: principal.id, agency: principal.role, limit });
  }

  async function markRead({ principal }) {
    await store.markNotificationsRead({ userId: principal.id, agency: principal.role });
    return { ok: true };
  }


  return {
    listUsers,
    setUserActive,
    createZone,
    updateZone,
    deleteZone,
    saveAnnouncement,
    deleteAnnouncement,
    contractorQueue,
    notificationsFor,
    markRead,
    listAudit: query => store.listAudit({ incidentId: query.incidentId ? Number(query.incidentId) : undefined, limit: Number(query.limit || 100) })
  };
}

module.exports = { createAdminService };
