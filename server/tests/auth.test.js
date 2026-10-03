/**
 * Unit tests for password hashing and session tokens — the two primitives every
 * authentication decision rests on.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  hashPassword,
  verifyPassword,
  hashReporterKey,
  passwordPolicyError,
  MIN_PASSWORD_LENGTH
} = require("../domain/passwords");

const { sign, verify, bearer } = require("../http/tokens");

// ---- passwords ------------------------------------------------------------

test("hashPassword never stores the plaintext and is salted per call", () => {
  const first = hashPassword("Citizen!2026");
  const second = hashPassword("Citizen!2026");
  assert.notEqual(first.hash, "Citizen!2026");
  assert.notEqual(first.salt, second.salt, "each hash uses a fresh salt");
  assert.notEqual(first.hash, second.hash, "the same password must not produce the same digest");
  assert.equal(first.salt.length, 32);
  assert.equal(first.hash.length, 128);
});

test("verifyPassword accepts the right password and rejects the wrong one", () => {
  const { salt, hash } = hashPassword("Citizen!2026");
  assert.equal(verifyPassword("Citizen!2026", salt, hash), true);
  assert.equal(verifyPassword("citizen!2026", salt, hash), false);
  assert.equal(verifyPassword("", salt, hash), false);
});

test("verifyPassword fails closed when the stored material is missing", () => {
  assert.equal(verifyPassword("anything", null, null), false);
  assert.equal(verifyPassword("anything", "abc", ""), false);
});

test("verifyPassword tolerates a corrupted stored hash without throwing", () => {
  const { salt } = hashPassword("Citizen!2026");
  assert.equal(verifyPassword("Citizen!2026", salt, "not-hex"), false);
});

test("the password policy enforces a minimum length and caps the input", () => {
  assert.equal(passwordPolicyError("short"), `Choose a password between ${MIN_PASSWORD_LENGTH} and 128 characters.`);
  assert.equal(passwordPolicyError(undefined), `Choose a password between ${MIN_PASSWORD_LENGTH} and 128 characters.`);
  assert.equal(passwordPolicyError("a".repeat(129)), `Choose a password between ${MIN_PASSWORD_LENGTH} and 128 characters.`);
  assert.equal(passwordPolicyError("a".repeat(MIN_PASSWORD_LENGTH)), null);
});

test("hashReporterKey is stable, irreversible and distinct per identity", () => {
  const first = hashReporterKey("device:abc-123");
  const again = hashReporterKey("device:abc-123");
  const other = hashReporterKey("device:abc-124");
  assert.equal(first, again, "the same device must hash identically so duplicates are detected");
  assert.notEqual(first, other);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.ok(!first.includes("abc-123"), "the identity must not be recoverable from the hash");
});

// ---- session tokens -------------------------------------------------------

const AUDIENCE = { secret: "unit-test-secret-value", issuer: "powerwatch" };

test("a signed token verifies and carries its claims", () => {
  const token = sign({ sub: 42, role: "socadel", name: "Console Admin" }, AUDIENCE);
  const claims = verify(token, AUDIENCE);
  assert.equal(claims.sub, 42);
  assert.equal(claims.role, "socadel");
  assert.equal(claims.iss, "powerwatch");
  assert.ok(claims.exp > claims.iat);
});

test("an expired token is rejected", () => {
  const token = sign({ sub: 1 }, { ...AUDIENCE, ttlMs: -1000 });
  assert.throws(() => verify(token, AUDIENCE), (error) => error.status === 401 && /expired/i.test(error.message));
});

test("a tampered payload is rejected", () => {
  const token = sign({ sub: 1, role: "client" }, AUDIENCE);
  const [header, payload, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: 1, role: "socadel", iss: "powerwatch", exp: 9_999_999_999 }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assert.throws(() => verify(`${header}.${forged}.${signature}`, AUDIENCE), (error) => error.status === 401);
});

test("a token signed with a different secret is rejected", () => {
  const token = sign({ sub: 1 }, { secret: "a-different-secret", issuer: "powerwatch" });
  assert.throws(() => verify(token, AUDIENCE), (error) => error.status === 401);
});

test("a token from another issuer is rejected", () => {
  const token = sign({ sub: 1 }, { secret: AUDIENCE.secret, issuer: "some-other-service" });
  assert.throws(() => verify(token, AUDIENCE), (error) => /another service/i.test(error.message));
});

test("structurally invalid tokens are rejected without throwing a parser error", () => {
  for (const bad of ["", "not-a-token", "a.b", "a.b.c.d"]) {
    assert.throws(() => verify(bad, AUDIENCE), (error) => error.status === 401);
  }
});

test("signing without a secret is a programming error, not a silent success", () => {
  assert.throws(() => sign({ sub: 1 }, { secret: "" }), /JWT_SECRET is required/);
});

test("bearer parsing extracts the token and ignores anything else", () => {
  assert.equal(bearer("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(bearer("bearer lower-case"), "lower-case");
  assert.equal(bearer("Token abc"), null);
  assert.equal(bearer(""), null);
  assert.equal(bearer(undefined), null);
});
