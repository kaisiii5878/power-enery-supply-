/**
 * Sign-in and registration logic.
 *
 * Kept out of the view so the rules that matter — what a registration request may
 * contain, which roles may self-register, and how the server's message is turned
 * into something a person can act on — can be tested without a browser.
 *
 * The client checks below mirror the server so the user is told what to fix
 * before paying for a round trip. The server still has the final say.
 */

import { authApi } from "../../lib/api.js";
import { ROLES } from "../../lib/session.js";

export const SIGN_IN = "signin";
export const REGISTER = "register";

/** Where each workspace lives. The role is part of the URL, not of the request. */
export const ROLE_HOME = {
  [ROLES.CITIZEN]: "/client",
  [ROLES.AGENT]: "/agency",
  [ROLES.OPERATOR]: "/admin"
};

export const ROLE_INTRO = {
  [ROLES.CITIZEN]: "Report outages, follow your cases and see what is happening near you.",
  [ROLES.AGENT]: "Open your assigned work orders and report progress from the field.",
  [ROLES.OPERATOR]: "Validate clusters, dispatch crews and monitor the network."
};

/** The server's own username rule, so the two cannot drift apart. */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Public sign-up can only ever create citizen accounts. Crew and operator
 * accounts are provisioned by an administrator.
 */
export function canSelfRegister(role) {
  return role === ROLES.CITIZEN;
}

/** The other mode, for the "create an account / sign in instead" switch. */
export function toggleMode(mode) {
  return mode === REGISTER ? SIGN_IN : REGISTER;
}

/** Page heading, phrased for the workspace the user actually landed on. */
export function headingFor(mode, roleLabel) {
  return mode === REGISTER ? "Create your citizen account" : `Sign in as ${String(roleLabel).toLowerCase()}`;
}

/**
 * Field-level validation. Every message says what is wrong *and* how to fix it.
 * Returns an object keyed by field, so the message can be attached to the input
 * it belongs to rather than floating above the form.
 */
export function validateCredentials({ mode, username, password, fullName } = {}) {
  const errors = {};

  const cleanUsername = String(username ?? "").trim();
  if (!cleanUsername) {
    errors.username = "Enter your username.";
  } else if (!USERNAME_PATTERN.test(cleanUsername.toLowerCase())) {
    errors.username =
      "Usernames are 3–40 characters: lowercase letters, numbers, dot, dash or underscore.";
  }

  const cleanPassword = String(password ?? "");
  if (!cleanPassword) {
    errors.password = "Enter your password.";
  } else if (mode === REGISTER && cleanPassword.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (mode === REGISTER && String(fullName ?? "").trim().length < 2) {
    errors.fullName = "Enter your full name so responders know who reported the outage.";
  }

  return errors;
}

/** True when nothing is wrong with the values for this mode. */
export function isSubmittable(input) {
  return Object.keys(validateCredentials(input)).length === 0;
}

/**
 * The request body for the chosen mode.
 *
 * Registration deliberately sends **no role**: the endpoint can only create
 * citizen accounts, and claiming a role is a rejected request. Signing in *does*
 * send the expected role so the server can answer "this account is registered as
 * socadel" instead of silently signing the wrong workspace.
 */
export function buildCredentials({ mode, role, username, password, fullName, phone } = {}) {
  const cleanUsername = String(username ?? "").trim().toLowerCase();
  const cleanPassword = String(password ?? "");

  if (mode === REGISTER) {
    const cleanPhone = String(phone ?? "").trim();
    return {
      username: cleanUsername,
      password: cleanPassword,
      fullName: String(fullName ?? "").trim(),
      ...(cleanPhone ? { phone: cleanPhone } : {})
    };
  }

  return { username: cleanUsername, password: cleanPassword, role };
}

/** Validates, then sends. Rejects the same way the API does. */
export function submitCredentials(input = {}) {
  const errors = validateCredentials(input);
  const firstError = Object.values(errors)[0];
  if (firstError) return Promise.reject(new Error(firstError));

  const credentials = buildCredentials(input);
  return input.mode === REGISTER ? authApi.register(credentials) : authApi.login(credentials);
}
