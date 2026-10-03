/**
 * Session tokens — HS256 JWTs implemented on Node's crypto module, so the app
 * has no extra dependency and no third-party library in the trust path.
 *
 * Tokens are deliberately short-lived and carry only an identity: the user row
 * is re-read on every request so deactivating an account takes effect at once.
 */

const crypto = require("crypto");
const { unauthorized } = require("./errors");

const base64url = input => Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unbase64url = input => Buffer.from(String(input).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function signature(payload, secret) {
  return base64url(crypto.createHmac("sha256", secret).update(payload).digest());
}

function sign(claims, { secret, ttlMs = 8 * 60 * 60 * 1000, issuer = "powerwatch", now = Date.now() } = {}) {
  if (!secret) throw new Error("A JWT_SECRET is required to sign sessions.");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify({
    ...claims,
    iss: issuer,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + ttlMs) / 1000)
  }));
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${signature(unsigned, secret)}`;
}

function verify(token, { secret, issuer = "powerwatch", now = Date.now() } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw unauthorized("Sign in required.");
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(signature(unsigned, secret));
  const received = Buffer.from(parts[2] || "");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    throw unauthorized("Session token is not valid.");
  }
  let payload;
  try {
    payload = JSON.parse(unbase64url(parts[1]));
  } catch {
    throw unauthorized("Session token is not valid.");
  }
  if (payload.iss !== issuer) throw unauthorized("Session token was issued by another service.");
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= now) throw unauthorized("Session expired, sign in again.");
  return payload;
}

/** Reads the bearer token from the Authorization header. */
function bearer(headerValue) {
  const match = /^Bearer\s+(.+)$/i.exec(String(headerValue || "").trim());
  return match ? match[1].trim() : null;
}

module.exports = { sign, verify, bearer };
