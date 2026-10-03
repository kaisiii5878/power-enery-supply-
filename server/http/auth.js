/**
 * Authentication and authorization middleware.
 *
 * `authenticate` resolves the bearer token to a live user row (so a
 * deactivated account is locked out immediately) and never trusts the role
 * claim on its own. Route guards then decide what that role may do.
 */

const { bearer, verify, sign } = require("./tokens");
const { unauthorized, forbidden } = require("./errors");

function publicUser(user) {
  if (!user) return null;
  const { password_salt, password_hash, ...safe } = user;
  return safe;
}

function createAuth({ store, config }) {
  const audience = { secret: config.auth.secret, issuer: config.auth.issuer };

  async function resolveUser(token) {
    const claims = verify(token, audience);
    const user = await store.findUser({ id: claims.sub });
    if (!user) throw unauthorized("Account no longer exists.");
    if (!Number(user.is_active)) throw forbidden("This account has been deactivated.");
    // A crew account's full name doubles as its company name, which is what
    // work orders are addressed to.
    return {
      ...publicUser(user),
      role: user.user_role,
      name: user.full_name,
      company: user.user_role === "subcontractor" ? user.full_name : null
    };
  }

  /** Populates req.auth when a valid token is present; never rejects. */
  async function optionalAuth(req, res, next) {
    const token = bearer(req.headers.authorization);
    if (!token) return next();
    try {
      req.auth = await resolveUser(token);
    } catch (error) {
      req.authError = error;
    }
    return next();
  }

  /** Requires a valid token. */
  async function requireAuth(req, res, next) {
    const token = bearer(req.headers.authorization);
    if (!token) return next(unauthorized());
    try {
      req.auth = await resolveUser(token);
      return next();
    } catch (error) {
      return next(error);
    }
  }

  /** Requires one of the given roles (implies requireAuth). */
  function requireRole(...roles) {
    return [requireAuth, (req, res, next) =>
      (roles.includes(req.auth.role) ? next() : next(forbidden(`This action requires the ${roles.join(" or ")} role.`)))];
  }

  function issueToken(user) {
    return sign({ sub: user.id, role: user.user_role, name: user.full_name }, { ...audience, ttlMs: config.sessionTtlMs });
  }

  return { requireAuth, requireRole, optionalAuth, issueToken, publicUser, resolveUser };
}

module.exports = { createAuth, publicUser };
