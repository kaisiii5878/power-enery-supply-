/**
 * Unit tests for the sign-in / registration form logic.
 *
 * The point of these is that the browser tells the user what to fix *before*
 * spending a network round trip, and that registration can never claim a role.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { loadModule, removeBundles } from "./helpers/loadModule.mjs";

const auth = await loadModule(fileURLToPath(new URL("../src/features/auth/authForm.js", import.meta.url)));

after(removeBundles);

test("only citizens may self-register", () => {
  assert.equal(auth.canSelfRegister("client"), true);
  assert.equal(auth.canSelfRegister("socadel"), false);
  assert.equal(auth.canSelfRegister("subcontractor"), false);
});

test("each workspace has a home route", () => {
  assert.equal(auth.ROLE_HOME.client, "/client");
  assert.equal(auth.ROLE_HOME.socadel, "/admin");
  assert.equal(auth.ROLE_HOME.subcontractor, "/agency");
});

test("sign-in requires a username and a password", () => {
  const errors = auth.validateCredentials({ mode: auth.SIGN_IN, username: "", password: "" });
  assert.ok(errors.username);
  assert.ok(errors.password);
  assert.equal(errors.fullName, undefined, "signing in must not ask for a full name");
});

test("sign-in accepts a short password it cannot validate locally", () => {
  const errors = auth.validateCredentials({ mode: auth.SIGN_IN, username: "aida.ngombe", password: "old" });
  assert.deepEqual(errors, {}, "the server owns the real credential check");
});

test("registration enforces the minimum password length", () => {
  const errors = auth.validateCredentials({
    mode: auth.REGISTER,
    username: "aida.ngombe",
    password: "short",
    fullName: "Aida Ngombe"
  });
  assert.match(errors.password, /at least 8 characters/);
});

test("registration explains a malformed username", () => {
  const errors = auth.validateCredentials({
    mode: auth.REGISTER,
    username: "Aida Ngombe!",
    password: "Citizen!2026",
    fullName: "Aida Ngombe"
  });
  assert.match(errors.username, /lowercase letters/);
});

test("registration requires a full name so responders know who reported", () => {
  const errors = auth.validateCredentials({
    mode: auth.REGISTER,
    username: "aida.ngombe",
    password: "Citizen!2026",
    fullName: " "
  });
  assert.ok(errors.fullName);
});

test("a complete registration produces no errors", () => {
  const input = { mode: auth.REGISTER, username: "aida.ngombe", password: "Citizen!2026", fullName: "Aida Ngombe" };
  assert.deepEqual(auth.validateCredentials(input), {});
  assert.equal(auth.isSubmittable(input), true);
});

test("isSubmittable mirrors validateCredentials", () => {
  assert.equal(auth.isSubmittable({ mode: auth.SIGN_IN, username: "abc", password: "" }), false);
  assert.equal(auth.isSubmittable({ mode: auth.SIGN_IN, username: "abc", password: "y" }), true);
  assert.equal(auth.isSubmittable({ mode: auth.SIGN_IN, username: "x", password: "y" }), false,
    "a one-character username is rejected before the request is sent");
});

test("a registration body never claims a role", () => {
  const body = auth.buildCredentials({
    mode: auth.REGISTER,
    role: "socadel",
    username: "  Aida.Ngombe ",
    password: "Citizen!2026",
    fullName: " Aida Ngombe ",
    phone: " +237600000001 "
  });
  assert.deepEqual(body, {
    username: "aida.ngombe",
    password: "Citizen!2026",
    fullName: "Aida Ngombe",
    phone: "+237600000001"
  });
  assert.equal("role" in body, false, "public sign-up must not send a role");
});

test("an empty phone is omitted rather than sent blank", () => {
  const body = auth.buildCredentials({
    mode: auth.REGISTER,
    username: "aida.ngombe",
    password: "Citizen!2026",
    fullName: "Aida Ngombe",
    phone: "   "
  });
  assert.equal("phone" in body, false);
});

test("a sign-in body sends the expected role so a mismatch is explained", () => {
  const body = auth.buildCredentials({
    mode: auth.SIGN_IN,
    role: "socadel",
    username: "Console.Admin",
    password: "Console!2026"
  });
  assert.deepEqual(body, { username: "console.admin", password: "Console!2026", role: "socadel" });
});

test("toggleMode switches between the two modes", () => {
  assert.equal(auth.toggleMode(auth.REGISTER), auth.SIGN_IN);
  assert.equal(auth.toggleMode(auth.SIGN_IN), auth.REGISTER);
});

test("headings are phrased for the workspace", () => {
  assert.match(auth.headingFor(auth.REGISTER, null), /citizen account/i);
  assert.equal(auth.headingFor(auth.SIGN_IN, "Administrator"), "Sign in as administrator");
});

test("submitCredentials rejects locally before touching the network", async () => {
  await assert.rejects(
    () => auth.submitCredentials({ mode: auth.SIGN_IN, username: "", password: "" }),
    /Enter your username/
  );
});