/**
 * Unit tests for the presentation helpers (`client/src/lib/format.js`).
 *
 * Timezone-independent: the assertions here never depend on the machine's local
 * time, so the suite behaves the same in Douala, London or CI.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { loadModule, removeBundles } from "./helpers/loadModule.mjs";

const format = await loadModule(fileURLToPath(new URL("../src/lib/format.js", import.meta.url)));

after(removeBundles);

test("formatDateTime renders a timestamp and falls back to a dash", () => {
  const rendered = format.formatDateTime("2026-09-24T14:05:00Z");
  assert.match(rendered, /2026/);
  assert.match(rendered, /:/);
  assert.equal(format.formatDateTime(null), "—");
  assert.equal(format.formatDateTime("not a date"), "—");
});

test("formatDate and formatTime handle values and gaps", () => {
  assert.match(format.formatDate("2026-09-24T14:05:00Z"), /2026/);
  assert.equal(format.formatDate(undefined), "—");
  assert.equal(format.formatTime("2026-09-24T14:05:00Z").length > 0, true);
  assert.equal(format.formatTime(""), "—");
});

test("formatRelative describes recent moments in words", () => {
  const now = Date.now();
  assert.equal(format.formatRelative(new Date(now - 5_000).toISOString()), "just now");
  assert.equal(format.formatRelative(new Date(now - 5 * 60_000).toISOString()), "5 min ago");
  assert.equal(format.formatRelative(new Date(now - 3 * 3_600_000).toISOString()), "3 h ago");
  assert.equal(format.formatRelative(new Date(now - 2 * 86_400_000).toISOString()), "2 d ago");
  assert.equal(format.formatRelative(null), "—");
});

test("formatRelative falls back to a plain date for older timestamps", () => {
  const rendered = format.formatRelative("2020-01-02T03:04:00Z");
  assert.match(rendered, /2020/);
});

test("formatHours explains sub-hour and multi-day durations", () => {
  assert.equal(format.formatHours(0.5), "30 min");
  assert.equal(format.formatHours(2), "2.0 h");
  assert.equal(format.formatHours(24), "1 d");
  assert.equal(format.formatHours(26), "1 d 2 h");
  assert.equal(format.formatHours(null), "—");
  assert.equal(format.formatHours("nonsense"), "—");
});

test("formatDistance switches to kilometres above a kilometre", () => {
  assert.equal(format.formatDistance(250), "250 m");
  assert.equal(format.formatDistance(1500), "1.5 km");
  assert.equal(format.formatDistance(0), "0 m");
  assert.equal(format.formatDistance(undefined), "—");
});

test("formatNumber groups thousands and never renders NaN", () => {
  assert.equal(format.formatNumber(1234), "1,234");
  assert.equal(format.formatNumber(0), "0");
  assert.equal(format.formatNumber(null), "0");
  assert.equal(format.formatNumber("abc"), "0");
});

test("pluralise agrees with its count", () => {
  assert.equal(format.pluralise(1, "report"), "1 report");
  assert.equal(format.pluralise(4, "report"), "4 reports");
  assert.equal(format.pluralise(0, "report"), "0 reports");
});

test("initials produce a compact avatar label", () => {
  assert.equal(format.initials("Aida Ngombe"), "AN");
  assert.equal(format.initials("Madonna"), "MA");
  assert.equal(format.initials("aida ngombe fotso"), "AF");
  assert.equal(format.initials(""), "?");
  assert.equal(format.initials(null), "?");
});

test("humanise turns machine values into sentences", () => {
  assert.equal(format.humanise("under_intervention"), "Under intervention");
  assert.equal(format.humanise("pending_validation"), "Pending validation");
  assert.equal(format.humanise(""), "");
});

test("formatApproximate never presents a precise address", () => {
  assert.equal(format.formatApproximate(3.8841, 11.5168), "≈ 3.884°, 11.517°");
  assert.equal(format.formatApproximate("x", 11.5), "Location unavailable");
});

test("toInputDate matches the datetime-local control's format", () => {
  assert.match(format.toInputDate("2026-09-24T14:05:00Z"), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.match(format.toInputDate(null), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test("isToday only accepts today's calendar day", () => {
  assert.equal(format.isToday(new Date().toISOString()), true);
  assert.equal(format.isToday("2020-01-01T00:00:00Z"), false);
  assert.equal(format.isToday(null), false);
});
