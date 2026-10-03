/**
 * Account use cases: registration, sign-in and first-boot administrator seed.
 *
 * Two rules the previous implementation got wrong are enforced here:
 *  - the public registration endpoint can only create `client` accounts;
 *    operator and crew accounts are created by an authenticated admin;
 *  - credentials come from configuration, never from source code.
 */

const { hashPassword, verifyPassword, passwordPolicyError } = require("../domain/passwords");
const { badRequest, unauthorized, conflict, notFound, forbidden } = require("../http/errors");

const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;
const SELF_SERVICE_ROLES = ["client"];
const STAFF_ROLES = ["subcontractor", "socadel"];

const sanitizeUsername = value => String(value || "").trim().toLowerCase();
const normalizeText = (value, max = 200) => String(value || "").trim().slice(0, max);

function createAuthService({ store, auth, config, log = console }) {
  const publicSession = async user => ({ token: auth.issueToken(user), user: auth.publicUser(user) });

  async function register(input, { allowedRoles = SELF_SERVICE_ROLES } = {}) {
    const username = sanitizeUsername(input.username);
    const fullName = normalizeText(input.fullName || input.full_name, 120);
    const role = String(input.role || "client").trim().toLowerCase();
    const password = String(input.password || "");

    if (!USERNAME_PATTERN.test(username)) {
      throw badRequest("Username must be 3-40 characters using lowercase letters, numbers, dot, dash or underscore.");
    }
    if (fullName.length < 2) throw badRequest("A full name is required.");
    if (!SELF_SERVICE_ROLES.includes(role) && !allowedRoles.includes(role)) {
      throw forbidden("Public sign-up can only create citizen accounts. Ask an administrator to create staff accounts.");
    }
    const policyError = passwordPolicyError(password);
    if (policyError) throw badRequest(policyError);

    const { salt, hash } = hashPassword(password);
    let user;
    try {
      user = await store.transaction(async tx => tx.createUser({
        username,
        full_name: fullName,
        user_role: role,
        password_salt: salt,
        password_hash: hash,
        email: normalizeText(input.email, 160) || null,
        phone: normalizeText(input.phone, 40) || null
      }));
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") throw conflict("That username is already taken.");
      throw error;
    }

    await store.addAudit({ actor: username, action: "account.created", details: { role } });
    return publicSession(user);
  }

  async function login({ username, password, role } = {}) {
    const cleanUsername = sanitizeUsername(username);
    if (!cleanUsername || !password) throw badRequest("Username and password are required.");

    const user = await store.findUser({ username: cleanUsername });
    // Always run the hash comparison so a missing account and a wrong password
    // take the same time and cannot be told apart.
    const passwordMatches = user
      ? verifyPassword(password, user.password_salt, user.password_hash)
      : verifyPassword(password, "00", "00");
    if (!user || !passwordMatches) throw unauthorized("Username or password is incorrect.");
    if (!Number(user.is_active)) throw forbidden("This account has been deactivated. Contact an administrator.");
    if (role && user.user_role !== role) throw forbidden(`This account is registered as ${user.user_role}.`);

    await store.addAudit({ actor: cleanUsername, action: "auth.login", details: { role: user.user_role } });
    return publicSession(user);
  }

  /** Creates the configured SOCADEL administrator once, on first boot. */
  async function bootstrapAdministrator() {
    const { username, password, name } = config.seedAdmin;
    if (!username || !password) return { created: false, reason: "ADMIN_USERNAME/ADMIN_PASSWORD not configured" };

    const existing = await store.findUser({ username });
    if (existing) return { created: false, reason: "administrator already exists", user: auth.publicUser(existing) };

    const policyError = passwordPolicyError(password);
    if (policyError) return { created: false, reason: policyError };

    const { salt, hash } = hashPassword(password);
    const user = await store.createUser({
      username, full_name: name, user_role: "socadel", password_salt: salt, password_hash: hash, email: null, phone: null
    });
    await store.addAudit({ actor: username, action: "account.seeded", details: { role: "socadel" } });
    log.log?.(`[auth] seeded SOCADEL administrator "${username}"`);
    return { created: true, user: auth.publicUser(user) };
  }

  async function changePassword(actor, { currentPassword, newPassword } = {}) {
    const user = await store.findUser({ id: actor.id });
    if (!user) throw notFound("Account not found.");
    if (!verifyPassword(String(currentPassword || ""), user.password_salt, user.password_hash)) {
      throw unauthorized("Current password is incorrect.");
    }
    const policyError = passwordPolicyError(String(newPassword || ""));
    if (policyError) throw badRequest(policyError);

    const { salt, hash } = hashPassword(String(newPassword));
    await store.updateUserPassword(user.id, { password_salt: salt, password_hash: hash });
    await store.addAudit({ actor: user.username, action: "auth.password_changed" });
    return { ok: true };
  }

  /** Admin-only: staff accounts (crews, operators) are never self-served. */
  async function createStaff(input, actor) {
    const created = await register(input, { allowedRoles: [...STAFF_ROLES, "client"] });
    await store.addAudit({
      actor: actor.username,
      action: "account.created_by_admin",
      details: { role: created.user.user_role, username: created.user.username }
    });
    return created;
  }

  return { register, login, bootstrapAdministrator, changePassword, createStaff, STAFF_ROLES, SELF_SERVICE_ROLES };
}

module.exports = { createAuthService, USERNAME_PATTERN };

