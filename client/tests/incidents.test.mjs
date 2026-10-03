/**
 * Unit tests for the client incident domain model.
 *
 * These mirror the server's state machine, so the UI is proven never to offer a
 * status or severity the API does not recognise.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { loadModule, removeBundles } from "./helpers/loadModule.mjs";

const domain = await loadModule(fileURLToPath(new URL("../src/domain/incidents.js", import.meta.url)));

after(removeBundles);

test("every server status has a label, a tone and an explanation", () => {
  const expected = [
    "pending", "pending_validation", "validated", "assigned", "on_the_way",
    "under_intervention", "completed", "verification_pending", "closed", "rejected"
  ];
  for (const status of expected) {
    const meta = domain.STATUS_META[status];
    assert.ok(meta, `${status} must be described in the UI`);
    assert.ok(meta.label && meta.short && meta.tone, `${status} is missing display metadata`);
    assert.ok(meta.description, `${status} must explain itself to the user`);
  }
  assert.equal(Object.keys(domain.STATUS_META).length, expected.length, "the UI must not invent statuses");
});

test("statusLabel falls back to a humanised value for anything unexpected", () => {
  assert.equal(domain.statusLabel("pending"), "Collecting reports");
  assert.equal(domain.statusLabel("closed"), "Closed");
  assert.equal(domain.statusLabel("some_new_status"), "some new status");
  assert.equal(domain.statusTone("unknown_status"), "neutral");
});

test("isActive matches the server's definition of an open incident", () => {
  assert.equal(domain.isActive("pending"), true);
  assert.equal(domain.isActive("verification_pending"), true);
  assert.equal(domain.isActive("closed"), false);
  assert.equal(domain.isActive("rejected"), false);
});

test("progressRatio runs from just-started to complete", () => {
  const started = domain.progressRatio("pending");
  assert.ok(started > 0 && started < 1);
  assert.equal(domain.progressRatio("closed"), 1);
  assert.equal(domain.progressRatio("rejected"), 1);
  assert.equal(domain.progressRatio("not_a_status"), 0);
});

test("the happy path is ordered and ends at closure", () => {
  const path = domain.HAPPY_PATH;
  assert.equal(path[0], "pending");
  assert.equal(path[path.length - 1], "closed");
  assert.equal(domain.progressRatio(path[3]), 4 / path.length);
});

test("severity metadata escalates in the documented order", () => {
  assert.deepEqual(domain.SEVERITY_ORDER, ["low", "medium", "high", "critical"]);
  assert.equal(domain.severityLabel("low"), "Low");
  assert.equal(domain.severityLabel("critical"), "Critical");
  assert.ok(domain.severityLevel("critical") > domain.severityLevel("low"));
  assert.equal(domain.severityTone("critical"), "danger");
  assert.equal(domain.severityTone("unknown"), "neutral");
});

test("map colours exist for every status and severity", () => {
  for (const status of Object.keys(domain.STATUS_META)) {
    assert.match(domain.STATUS_COLOR[status], /^#[0-9a-f]{6}$/, `${status} needs a map colour`);
  }
  for (const severity of domain.SEVERITY_ORDER) {
    assert.match(domain.SEVERITY_COLOR[severity], /^#[0-9a-f]{6}$/, `${severity} needs a map colour`);
  }
});

test("a rejected incident shows a review outcome instead of fake progress", () => {
  const timeline = domain.buildTimeline({ status: "rejected", created_at: "2026-09-22T18:42:00Z" });
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].state, "done");
  assert.equal(timeline[1].key, "rejected");
  assert.equal(timeline[1].state, "rejected");
});

test("an in-flight incident marks completed stages done and the rest upcoming", () => {
  const timeline = domain.buildTimeline({
    status: "under_intervention",
    created_at: "2026-09-22T18:42:00Z",
    validated_at: "2026-09-22T19:05:00Z"
  });
  const states = Object.fromEntries(timeline.map(step => [step.key, step.state]));
  assert.equal(states.reported, "done");
  assert.equal(states.validation, "done");
  assert.equal(states.intervention, "current");
  assert.equal(states.closed, "upcoming");
  assert.equal(timeline.find(step => step.key === "reported").at, "2026-09-22T18:42:00Z");
});

test("a closed incident renders as fully complete", () => {
  const timeline = domain.buildTimeline({ status: "closed", created_at: "2026-09-22T18:42:00Z" });
  assert.ok(timeline.every(step => step.state === "done"));
});

test("buildTimeline tolerates a missing incident", () => {
  assert.deepEqual(domain.buildTimeline(null), []);
  assert.deepEqual(domain.timelineDates(null), {});
});

test("notification kinds are labelled, with a safe fallback", () => {
  assert.equal(domain.notificationKind("incident.awaiting_validation").label, "Validation");
  assert.equal(domain.notificationKind("incident.awaiting_validation").tone, "warning");
  assert.equal(domain.notificationKind("something.else").label, "Update");
  assert.equal(domain.notificationKind(undefined).tone, "neutral");
});

test("reportsToQualify counts what a pending cluster still needs", () => {
  assert.equal(domain.reportsToQualify({ status: "pending", reports_count: 1 }, 3), 2);
  assert.equal(domain.reportsToQualify({ status: "pending", reports_count: 5 }, 3), 0);
  assert.equal(domain.reportsToQualify({ status: "validated", reports_count: 1 }, 3), 0);
  assert.equal(domain.reportsToQualify(null, 3), 0);
});

test("operational priority sorts active, then worst, then most recent", () => {
  const rows = [
    { status: "closed", severity: "low", last_report_at: "2026-09-22T10:00:00Z" },
    { status: "pending_validation", severity: "low", last_report_at: "2026-09-22T12:00:00Z" },
    { status: "pending_validation", severity: "critical", last_report_at: "2026-09-22T11:00:00Z" }
  ];
  const sorted = [...rows].sort(domain.byOperationalPriority);
  assert.equal(sorted[0].severity, "critical", "the worst open incident comes first");
  assert.equal(sorted[1].severity, "low");
  assert.equal(sorted[2].status, "closed", "the closed incident sinks to the bottom");
});

test("the transition actions cover the workflow buttons", () => {
  assert.equal(domain.TRANSITION_ACTIONS.validated.intent, "validate");
  assert.equal(domain.TRANSITION_ACTIONS.rejected.variant, "danger-ghost");
  assert.equal(domain.TRANSITION_ACTIONS.closed.intent, "close");
});

test("field steps drive the crew app one legal status at a time", () => {
  assert.equal(domain.fieldStepFor("assigned").status, "on_the_way");
  assert.equal(domain.fieldStepFor("under_intervention").status, "completed");
  assert.equal(domain.fieldStepFor("closed"), null);
});