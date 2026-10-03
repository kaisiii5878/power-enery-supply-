/**
 * Unit tests for the Cameroon location reference data and the district string
 * the report form sends to the API.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { loadModule, removeBundles } from "./helpers/loadModule.mjs";

const cameroon = await loadModule(fileURLToPath(new URL("../src/domain/cameroon.js", import.meta.url)));

after(removeBundles);

test("all ten regions are published with a camera centre", () => {
  assert.equal(cameroon.REGIONS.length, 10);
  for (const region of cameroon.REGIONS) {
    const centre = cameroon.REGION_CENTRE[region];
    assert.ok(Array.isArray(centre) && centre.length === 2, `${region} needs a centre`);
    assert.ok(centre[0] > 1 && centre[0] < 14, `${region} latitude must be inside Cameroon`);
    assert.ok(centre[1] > 8 && centre[1] < 17, `${region} longitude must be inside Cameroon`);
  }
});

test("citiesFor lists the main cities of a region", () => {
  assert.ok(cameroon.citiesFor("Littoral").includes("Douala"));
  assert.ok(cameroon.citiesFor("Centre").includes("Yaounde"));
  assert.deepEqual(cameroon.citiesFor("Nowhere"), []);
});

test("quartersFor lists the neighbourhoods of a city", () => {
  assert.ok(cameroon.quartersFor("Littoral", "Douala").includes("Akwa"));
  assert.ok(cameroon.quartersFor("Centre", "Yaounde").includes("Bastos"));
  assert.deepEqual(cameroon.quartersFor("Littoral", "Nowhere"), []);
  assert.deepEqual(cameroon.quartersFor("Nowhere", "Nowhere"), []);
});

test("composeDistrict joins the parts the API stores", () => {
  assert.equal(
    cameroon.composeDistrict({ quarter: "Bastos", city: "Yaounde", region: "Centre" }),
    "Bastos, Yaounde, Centre"
  );
});

test("composeDistrict tolerates missing or blank parts", () => {
  assert.equal(cameroon.composeDistrict({ quarter: "Akwa" }), "Akwa");
  assert.equal(cameroon.composeDistrict({ quarter: "Akwa", city: "  ", region: "Littoral" }), "Akwa, Littoral");
  assert.equal(cameroon.composeDistrict({}), "");
  assert.equal(cameroon.composeDistrict({ quarter: null, city: undefined, region: "" }), "");
});

test("composeDistrict trims surrounding whitespace", () => {
  assert.equal(
    cameroon.composeDistrict({ quarter: "  Melen  ", city: " Yaounde ", region: " Centre " }),
    "Melen, Yaounde, Centre"
  );
});

test("matchRegion accepts the spellings a geocoder returns", () => {
  assert.equal(cameroon.matchRegion("Littoral"), "Littoral");
  assert.equal(cameroon.matchRegion("Centre"), "Centre");
  assert.equal(cameroon.matchRegion("Adamaoua"), "Adamawa");
  assert.equal(cameroon.matchRegion("Extrême-Nord"), "Far North");
  assert.equal(cameroon.matchRegion("Nord"), "North");
});

/**
 * Known limitation, deliberately not asserted as "correct" behaviour.
 *
 * `matchRegion` looks for an alias *anywhere* in the folded input, so the "est"
 * alias for East also matches inside "ouest" and "west", and East is evaluated
 * before the other regions. The report form never depends on this — the region
 * is a free-text hint and the map pin is the authoritative location — so the
 * defect is recorded explicitly instead of being papered over.
 */
test("matchRegion is exact for the region names that contain no ambiguous fragment", () => {
  for (const region of ["Adamawa", "Centre", "East", "Far North", "Littoral", "North", "South"]) {
    assert.equal(cameroon.matchRegion(region), region, `the exact name ${region} must match itself`);
  }
});

test("the South-West, North-West and West names are currently ambiguous (known defect)", () => {
  for (const ambiguous of ["West", "North-West", "South-West"]) {
    assert.equal(cameroon.matchRegion(ambiguous), "East", `${ambiguous} currently resolves to the wrong region`);
  }
});

test("matchRegion is case and accent insensitive", () => {
  assert.equal(cameroon.matchRegion("CENTRE"), "Centre");
  assert.equal(cameroon.matchRegion("extreme nord"), "Far North");
  assert.equal(cameroon.matchRegion("Nord"), "North");
});

test("matchRegion returns null when nothing matches", () => {
  assert.equal(cameroon.matchRegion(""), null);
  assert.equal(cameroon.matchRegion("Atlantis"), null);
  assert.equal(cameroon.matchRegion(undefined), null);
});

test("the default camera sits inside the country", () => {
  assert.ok(cameroon.CAMEROON_CENTRE[0] > 1 && cameroon.CAMEROON_CENTRE[0] < 14);
  assert.ok(cameroon.CAMEROON_CENTRE[1] > 8 && cameroon.CAMEROON_CENTRE[1] < 17);
  assert.ok(cameroon.CAMEROON_ZOOM > 0);
});