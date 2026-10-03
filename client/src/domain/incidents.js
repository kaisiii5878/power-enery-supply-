/**
 * Incident domain model for the UI.
 *
 * Mirrors `server/domain/incidentLifecycle.js` — the same statuses, the same
 * order, the same terminal states — so the interface never offers an action
 * the API will reject with INVALID_TRANSITION.
 */

export const STATUS_META = {
  pending: {
    label: "Collecting reports",
    short: "Collecting",
    tone: "neutral",
    description: "Neighbours are still reporting this area. It has not been sent for validation yet."
  },
  pending_validation: {
    label: "Awaiting validation",
    short: "Awaiting validation",
    tone: "warning",
    description: "SOCADEL must confirm this is a real outage before any crew is dispatched."
  },
  validated: {
    label: "Validated",
    short: "Validated",
    tone: "info",
    description: "Confirmed as a real outage and waiting for a field crew to be assigned."
  },
  assigned: {
    label: "Agent assigned",
    short: "Assigned",
    tone: "info",
    description: "A work order was issued to the field crew."
  },
  on_the_way: {
    label: "Agent on the way",
    short: "En route",
    tone: "info",
    description: "The crew has left for the site."
  },
  under_intervention: {
    label: "Under intervention",
    short: "Intervention",
    tone: "brand",
    description: "The crew is on site working on the fault."
  },
  completed: {
    label: "Work completed",
    short: "Completed",
    tone: "success",
    description: "The crew has finished the repair."
  },
  verification_pending: {
    label: "Restoration verification",
    short: "Verifying",
    tone: "warning",
    description: "Waiting for citizens to confirm that power is back."
  },
  closed: {
    label: "Closed",
    short: "Closed",
    tone: "success",
    description: "Supply restored and the case closed."
  },
  rejected: {
    label: "Rejected",
    short: "Rejected",
    tone: "neutral",
    description: "Reviewed and closed without dispatch."
  }
};

export const statusLabel = (status) => STATUS_META[status]?.label || String(status || "").replace(/_/g, " ");
export const statusTone = (status) => STATUS_META[status]?.tone || "neutral";
export const statusDescription = (status) => STATUS_META[status]?.description || "";

/** Statuses that still represent an open problem for citizens. */
export const ACTIVE_STATUSES = [
  "pending",
  "pending_validation",
  "validated",
  "assigned",
  "on_the_way",
  "under_intervention",
  "completed",
  "verification_pending"
];

export const isActive = (status) => ACTIVE_STATUSES.includes(status);

/** The happy path, in order — used for progress indicators. */
export const HAPPY_PATH = [
  "pending",
  "pending_validation",
  "validated",
  "assigned",
  "on_the_way",
  "under_intervention",
  "verification_pending",
  "closed"
];

export function progressRatio(status) {
  if (status === "rejected") return 1;
  const index = HAPPY_PATH.indexOf(status);
  return index === -1 ? 0 : (index + 1) / HAPPY_PATH.length;
}

/* ---- severity ---------------------------------------------------------- */

export const SEVERITY_ORDER = ["low", "medium", "high", "critical"];

export const SEVERITY_META = {
  low: { label: "Low", level: 1, tone: "info" },
  medium: { label: "Medium", level: 2, tone: "warning" },
  high: { label: "High", level: 3, tone: "warning" },
  critical: { label: "Critical", level: 4, tone: "danger" }
};

export const severityLabel = (severity) => SEVERITY_META[severity]?.label || String(severity || "").toUpperCase();
export const severityLevel = (severity) => SEVERITY_META[severity]?.level || 0;
export const severityTone = (severity) => SEVERITY_META[severity]?.tone || "neutral";

/**
 * Map colours, read directly by Leaflet, so they cannot be CSS variables.
 * They are the single JS mirror of the severity design tokens.
 */
export const SEVERITY_COLOR = {
  low: "#0e7490",
  medium: "#b45309",
  high: "#c2410c",
  critical: "#b91c1c"
};

export const STATUS_COLOR = {
  pending: "#64748b",
  pending_validation: "#b45309",
  validated: "#0e7490",
  assigned: "#0e7490",
  on_the_way: "#0891b2",
  under_intervention: "#155e75",
  completed: "#15803d",
  verification_pending: "#b45309",
  closed: "#15803d",
  rejected: "#94a3b8"
};

/* ---- timeline ---------------------------------------------------------- */

/**
 * The seven public stages. Each stage lists the machine statuses it covers, so
 * a stage can only be marked done when the API actually reached one of them.
 */
export const TIMELINE_STEPS = [
  { key: "reported", label: "Report received", statuses: ["pending"] },
  { key: "validation", label: "Validated by SOCADEL", statuses: ["pending_validation"] },
  { key: "assigned", label: "Agent assigned", statuses: ["validated", "assigned"] },
  { key: "travelling", label: "Agent on the way", statuses: ["on_the_way"] },
  { key: "intervention", label: "Intervention on site", statuses: ["under_intervention"] },
  { key: "verification", label: "Restoration verification", statuses: ["completed", "verification_pending"] },
  { key: "closed", label: "Closed", statuses: ["closed"] }
];

const stageOf = (status) => TIMELINE_STEPS.findIndex((step) => step.statuses.includes(status));

/** Timestamps the API gives us, keyed by the stage they complete. */
export function timelineDates(incident) {
  if (!incident) return {};
  return {
    reported: incident.created_at || incident.first_report_at,
    validation: incident.validated_at,
    verification: incident.completed_at,
    closed: incident.closed_at,
    rejected: incident.closed_at
  };
}

/**
 * Builds the timeline for an incident. Upcoming stages stay visibly unfinished;
 * a rejected incident shows the review outcome instead of a fake progress bar.
 */
export function buildTimeline(incident) {
  if (!incident) return [];
  const dates = timelineDates(incident);

  if (incident.status === "rejected") {
    return [
      { key: "reported", label: "Report received", state: "done", at: dates.reported },
      {
        key: "rejected",
        label: "Reviewed and rejected",
        state: "rejected",
        at: dates.rejected,
        note: incident.rejection_reason || undefined
      }
    ];
  }

  const current = stageOf(incident.status);
  return TIMELINE_STEPS.map((step, index) => {
    let state = "upcoming";
    if (current !== -1 && index < current) state = "done";
    else if (current !== -1 && index === current) state = incident.status === "closed" ? "done" : "current";
    return { key: step.key, label: step.label, state, at: dates[step.key] };
  });
}

/* ---- workflow actions -------------------------------------------------- */

/**
 * Labels for the transition buttons. The API returns `next_statuses` on the
 * incident detail, so the console only ever offers legal moves; this maps each
 * status to the action name and button treatment that performs it.
 */
export const TRANSITION_ACTIONS = {
  validated: { label: "Validate incident", intent: "validate", variant: "primary" },
  rejected: { label: "Reject cluster", intent: "reject", variant: "danger-ghost" },
  assigned: { label: "Assign crew", intent: "assign", variant: "primary" },
  on_the_way: { label: "Start travel", intent: "on_the_way", variant: "primary" },
  under_intervention: { label: "Begin intervention", intent: "under_intervention", variant: "primary" },
  completed: { label: "Complete work", intent: "completed", variant: "primary" },
  closed: { label: "Close incident", intent: "close", variant: "primary" }
};

/**
 * The payload shapes the field-status endpoint accepts. The crew does not pick
 * a status: the current incident status decides the next step, which keeps an
 * invalid transition impossible from the field app.
 */
export const FIELD_STEPS = {
  assigned: { status: "on_the_way", label: "Start travel", hint: "Tell SOCADEL you are on your way." },
  on_the_way: { status: "under_intervention", label: "Arrived — begin intervention", hint: "The arrival time is recorded automatically." },
  under_intervention: { status: "completed", label: "Complete work and submit report", hint: "Completion opens the citizen verification step." }
};

export const fieldStepFor = (status) => FIELD_STEPS[status] || null;

/* ---- notifications ----------------------------------------------------- */

export const NOTIFICATION_KINDS = {
  "incident.awaiting_validation": { tone: "warning", label: "Validation" },
  "work.assigned": { tone: "info", label: "Assignment" },
  "incident.awaiting_verification": { tone: "warning", label: "Verification" },
  "restoration.verification": { tone: "info", label: "Verification" },
  "restoration.confirmed": { tone: "success", label: "Restoration" },
  "incident.closed": { tone: "success", label: "Closure" },
  "incident.rejected": { tone: "neutral", label: "Closed without dispatch" }
};

export const notificationKind = (eventType) =>
  NOTIFICATION_KINDS[eventType] || { tone: "neutral", label: "Update" };

/* ---- derived helpers --------------------------------------------------- */

/** Number of reports still needed before a cluster is sent for validation. */
export function reportsToQualify(incident, minimumReports) {
  if (!incident || incident.status !== "pending") return 0;
  const minimum = Number(minimumReports ?? 0);
  const have = Number(incident.reports_count || 0);
  return Math.max(0, minimum - have);
}

/** Sorts incidents the way operators scan them: active worst-first, then rest. */
export function byOperationalPriority(a, b) {
  const activeDiff = Number(isActive(b.status)) - Number(isActive(a.status));
  if (activeDiff) return activeDiff;
  const severityDiff = severityLevel(b.severity) - severityLevel(a.severity);
  if (severityDiff) return severityDiff;
  // `last_report_at` is present on both the public and the console projection,
  // so it is the reliable recency tiebreaker regardless of which feed is in use.
  const stamp = (row) => new Date(row.last_report_at || row.updated_at || row.created_at || 0).getTime();
  return stamp(b) - stamp(a);
}

