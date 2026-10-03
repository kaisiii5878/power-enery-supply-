/**
 * Unit tests for the incident state machine.
 *
 * The lifecycle module is the single source of truth for legal status changes,
 * so an invalid transition must be rejected here — long before it reaches SQL.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  INCIDENT_STATUSES,
  ACTIVE_STATUSES,
  AGENT_STATUSES,
  CLUSTERABLE_STATUSES,
  isIncidentStatus,
  allowedTransitions,
  canTransition,
  assertTransition,
  assertAssignable,
  assertClosable
} = require("../domain/incidentLifecycle");

test("the documented status vocabulary is complete and unique", () => {
  assert.deepEqual(INCIDENT_STATUSES, [
    "pending", "pending_validation", "validated", "assigned", "on_the_way",
    "under_intervention", "completed", "verification_pending", "closed", "rejected"
  ]);
  assert.equal(new Set(INCIDENT_STATUSES).size, INCIDENT_STATUSES.length);
});

test("isIncidentStatus only accepts known statuses", () => {
  assert.equal(isIncidentStatus("pending"), true);
  assert.equal(isIncidentStatus("active"), false);
  assert.equal(isIncidentStatus("RESTORED"), false);
  assert.equal(isIncidentStatus(undefined), false);
});

test("the happy path transitions are allowed in order", () => {
  assert.equal(canTransition("pending", "pending_validation"), true);
  assert.equal(canTransition("pending_validation", "validated"), true);
  assert.equal(canTransition("validated", "assigned"), true);
  assert.equal(canTransition("assigned", "on_the_way"), true);
  assert.equal(canTransition("on_the_way", "under_intervention"), true);
  assert.equal(canTransition("under_intervention", "completed"), true);
  assert.equal(canTransition("completed", "verification_pending"), true);
  assert.equal(canTransition("verification_pending", "closed"), true);
});

test("arbitrary jumps are rejected", () => {
  assert.equal(canTransition("pending", "closed"), false);
  assert.equal(canTransition("pending", "under_intervention"), false);
  assert.equal(canTransition("validated", "closed"), false);
  assert.equal(canTransition("closed", "pending"), false);
});

test("terminal statuses have no outgoing transitions", () => {
  assert.deepEqual(allowedTransitions("closed"), []);
  assert.deepEqual(allowedTransitions("rejected"), []);
});

test("a pending cluster can be rejected without ever being validated", () => {
  assert.equal(canTransition("pending", "rejected"), true);
  assert.equal(canTransition("pending_validation", "rejected"), true);
});

test("assertTransition throws a 409 INVALID_TRANSITION with the allowed moves", () => {
  let error;
  try {
    assertTransition("pending", "closed");
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "an invalid transition must throw");
  assert.equal(error.status, 409);
  assert.equal(error.code, "INVALID_TRANSITION");
  assert.deepEqual(error.allowed, allowedTransitions("pending"));
});

test("assertTransition is silent for a legal move", () => {
  assert.doesNotThrow(() => assertTransition("validated", "assigned"));
});

test("only a validated incident may be assigned to a crew", () => {
  assert.doesNotThrow(() => assertAssignable("validated"));
  for (const status of ["pending", "pending_validation", "assigned", "closed"]) {
    assert.throws(() => assertAssignable(status), (error) => error.code === "ASSIGNMENT_NOT_ALLOWED");
  }
});

test("an incident can only be closed from the verification stage", () => {
  assert.throws(
    () => assertClosable({ status: "under_intervention" }, { restoredConfirmations: 3 }),
    (error) => error.code === "CLOSURE_NOT_ALLOWED"
  );
});

test("closure normally requires at least one citizen restoration confirmation", () => {
  assert.throws(
    () => assertClosable({ status: "verification_pending" }, { restoredConfirmations: 0 }),
    (error) => error.code === "RESTORATION_UNVERIFIED"
  );
  assert.doesNotThrow(() => assertClosable({ status: "verification_pending" }, { restoredConfirmations: 1 }));
});

test("an administrator can force closure but that is an explicit override", () => {
  assert.doesNotThrow(() => assertClosable({ status: "verification_pending" }, { restoredConfirmations: 0, override: true }));
});

test("active statuses exclude the two terminal states", () => {
  assert.ok(!ACTIVE_STATUSES.includes("closed"));
  assert.ok(!ACTIVE_STATUSES.includes("rejected"));
  assert.ok(ACTIVE_STATUSES.includes("verification_pending"));
  assert.equal(ACTIVE_STATUSES.length, INCIDENT_STATUSES.length - 2);
});

test("only open clusters absorb incoming reports", () => {
  assert.deepEqual(CLUSTERABLE_STATUSES, ["pending", "pending_validation"]);
});

test("field crews may only drive the three field statuses", () => {
  assert.deepEqual(AGENT_STATUSES, ["on_the_way", "under_intervention", "completed"]);
});
