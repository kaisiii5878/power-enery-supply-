/**
 * Password hashing.
 *
 * scrypt (memory-hard, in Node core) with a per-password salt and a
 * constant-time comparison, matching the scheme already stored in
 * app_users.password_salt / password_hash so no data migration is required.
 */

const crypto = require("crypto");

const KEY_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(String(password), salt, KEY_LENGTH).toString("hex") };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = crypto.scryptSync(String(password), String(salt), KEY_LENGTH);
  const expected = Buffer.from(String(expectedHash), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Anonymous, non-reversible key used to de-duplicate citizen confirmations. */
function hashReporterKey(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function passwordPolicyError(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return `Choose a password between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

module.exports = { hashPassword, verifyPassword, hashReporterKey, passwordPolicyError, MIN_PASSWORD_LENGTH };
