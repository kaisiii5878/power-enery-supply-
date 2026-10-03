/**
 * Incident lifecycle — the single source of truth for legal status changes.
 *
 * Mirrors the UML incident state machine. Kept free of Express/MySQL so it can
 * be unit tested and reused by every use case.
 */

const INCIDENT_STATUSES = [
  "pending",
  "pending_validation",
  "validated",
  "assigned",
  "on_the_way",
  "under_intervention",
  "completed",
  "verification_pending",
  "closed",
  "rejected"
];

const TRANSITIONS = {
  pending: ["pending_validation", "rejected"],
  pending_validation: ["validated", "rejected", "pending"],
  validated: ["assigned", "rejected"],
  assigned: ["on_the_way"],
  on_the_way: ["under_intervention"],
  under_intervention: ["completed"],
  completed: ["verification_pending"],
  verification_pending: ["closed", "under_intervention"],
  closed: [],
  rejected: []
};

/** Statuses where an incident is still an open problem for citizens. */
const ACTIVE_STATUSES = [
  "pending",
  "pending_validation",
  "validated",
  "assigned",
  "on_the_way",
  "under_intervention",
  "completed",
  "verification_pending"
];

/** Statuses an agent is allowed to move an incident into from the field. */
const AGENT_STATUSES = ["on_the_way", "under_intervention", "completed"];

/** Statuses still open to clustering by incoming citizen reports. */
const CLUSTERABLE_STATUSES = ["pending", "pending_validation"];

function isIncidentStatus(status) {
  return INCIDENT_STATUSES.includes(status);
}

function allowedTransitions(from) {
  return TRANSITIONS[from] || [];
}

function canTransition(from, to) {
  if (!isIncidentStatus(from) || !isIncidentStatus(to)) return false;
  return allowedTransitions(from).includes(to);
}

function assertTransition(from, to) {
  if (canTransition(from, to)) return;
  const error = new Error(`Invalid status transition: ${from} \u2192 ${to}.`);
  error.status = 409;
  error.code = "INVALID_TRANSITION";
  error.allowed = allowedTransitions(from);
  throw error;
}

/** Only a validated incident may ever reach a field agent. */
function assertAssignable(status) {
  if (status === "validated") return;
  const error = new Error("SOCADEL must validate the incident and choose a contractor before assignment.");
  error.status = 409;
  error.code = "ASSIGNMENT_NOT_ALLOWED";
  throw error;
}

/** Closing requires the restoration-verification phase to be satisfied. */
function assertClosable(incident, { restoredConfirmations = 0, override = false } = {}) {
  if (incident.status !== "verification_pending") {
    const error = new Error("An incident can only be closed from the restoration-verification stage.");
    error.status = 409;
    error.code = "CLOSURE_NOT_ALLOWED";
    throw error;
  }
  if (!override && Number(restoredConfirmations) < 1) {
    const error = new Error("At least one citizen must confirm that power is restored before closing.");
    error.status = 409;
    error.code = "RESTORATION_UNVERIFIED";
    throw error;
  }
}

module.exports = {
  INCIDENT_STATUSES,
  TRANSITIONS,
  ACTIVE_STATUSES,
  AGENT_STATUSES,
  CLUSTERABLE_STATUSES,
  isIncidentStatus,
  allowedTransitions,
  canTransition,
  assertTransition,
  assertAssignable,
  assertClosable
};
