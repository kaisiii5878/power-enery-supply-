/**
 * Operational analytics for the SOCADEL console.
 *
 * Aggregation is done here rather than in SQL so the numbers are identical on
 * MySQL and on the in-memory store, and so the arithmetic stays unit testable.
 */

const { SEVERITY_ORDER } = require("../domain/geo");
const { ACTIVE_STATUSES } = require("../domain/incidentLifecycle");

const DAY_MS = 24 * 60 * 60 * 1000;

const hours = (from, to) => {
  if (!from || !to) return null;
  const delta = (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
  return delta >= 0 ? Math.round(delta * 10) / 10 : null;
};

const average = values => {
  const clean = values.filter(value => Number.isFinite(value));
  return clean.length ? Math.round((clean.reduce((sum, value) => sum + value, 0) / clean.length) * 10) / 10 : null;
};

const dateKey = value => String(value || "").slice(0, 10);

function countBy(rows, keyOf) {
  const counts = new Map();
  for (const row of rows || []) {
    const key = keyOf(row);
    if (key === null || key === undefined) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function createAnalyticsService({ store }) {
  async function overview({ days = 14 } = {}) {
    const [{ incidents, reports }, workRequests, users] = await Promise.all([
      store.analyticsRows(),
      store.listWorkRequests({}),
      store.countUsers()
    ]);

    const now = Date.now();
    const windowStart = now - days * DAY_MS;
    const inWindow = row => new Date(row.created_at || 0).getTime() >= windowStart;

    const active = incidents.filter(incident => ACTIVE_STATUSES.includes(incident.status));
    const closedRestored = incidents.filter(incident => incident.validated_at && incident.restored_at);

    // 14-day trend: every day gets an entry, including zero days, so charts do
    // not silently skip gaps in the data.
    const trend = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const key = dateKey(new Date(now - offset * DAY_MS).toISOString());
      trend.push({
        date: key,
        reports: reports.filter(report => dateKey(report.created_at) === key).length,
        incidents: incidents.filter(incident => dateKey(incident.created_at) === key).length
      });
    }

    const districtMap = countBy(reports, report => report.district);
    const districts = [...districtMap.entries()]
      .map(([district, reportCount]) => {
        const districtIncidents = incidents.filter(incident => incident.district === district);
        const worst = SEVERITY_ORDER[Math.max(
          -1,
          ...districtIncidents.map(incident => SEVERITY_ORDER.indexOf(incident.severity))
        )] || "low";
        return { district, reports: reportCount, incidents: districtIncidents.length, worst_severity: worst };
      })
      .sort((a, b) => b.reports - a.reports);

    const contractorMap = countBy(workRequests, work => work.contractor);
    const contractors = [...contractorMap.entries()].map(([contractor, jobs]) => {
      const jobsForContractor = workRequests.filter(work => work.contractor === contractor);
      return {
        contractor,
        jobs,
        in_progress: jobsForContractor.filter(work => !["completed", "verified", "cancelled"].includes(work.status)).length,
        avg_travel_hours: average(jobsForContractor.map(work => hours(work.assigned_at, work.arrival_time || work.departed_at))),
        avg_repair_hours: average(jobsForContractor.map(work => hours(work.arrival_time, work.completion_time)))
      };
    }).sort((a, b) => b.jobs - a.jobs);

    return {
      generated_at: new Date().toISOString(),
      window_days: days,
      kpis: {
        active_incidents: active.length,
        awaiting_validation: incidents.filter(incident => incident.status === "pending_validation").length,
        in_intervention: incidents.filter(incident => ["assigned", "on_the_way", "under_intervention"].includes(incident.status)).length,
        awaiting_verification: incidents.filter(incident => incident.status === "verification_pending").length,
        closed_total: incidents.filter(incident => incident.status === "closed").length,
        rejected_total: incidents.filter(incident => incident.status === "rejected").length,
        reports_total: reports.length,
        reports_in_window: reports.filter(inWindow).length,
        incidents_in_window: incidents.filter(inWindow).length,
        avg_validation_hours: average(incidents.map(incident => hours(incident.first_report_at, incident.validated_at))),
        avg_restoration_hours: average(closedRestored.map(incident => hours(incident.validated_at, incident.restored_at))),
        // A total plus the per-role breakdown: the console tile shows the number,
        // the accounts screen shows the split.
        accounts: { total: Object.values(users).reduce((sum, value) => sum + Number(value), 0), ...users }
      },
      severity_distribution: SEVERITY_ORDER.map(severity => ({
        severity,
        incidents: incidents.filter(incident => incident.severity === severity).length
      })),
      status_distribution: [...countBy(incidents, incident => incident.status).entries()]
        .map(([status, total]) => ({ status, total }))
        .sort((a, b) => b.total - a.total),
      districts: districts.slice(0, 10),
      trend,
      contractors
    };
  }

  return { overview };
}

module.exports = { createAnalyticsService, hours, average };
