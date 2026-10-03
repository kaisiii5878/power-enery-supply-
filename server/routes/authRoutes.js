/**
 * Authentication endpoints.
 *
 * POST http://localhost:4000/api/auth/register   public   — creates a citizen account only
 * POST /api/auth/login      public
 * POST /api/auth/logout     auth     — stateless: the client drops the token
 * GET  /api/auth/me         auth     — re-reads the account behind the token
 * POST /api/auth/password   auth     — change own password
 */

const express = require("express");
const { asyncHandler } = require("../http/errors");

module.exports = function createAuthRoutes({ auth, accounts }) {
  const router = express.Router();

  router.post("/register", asyncHandler(async (req, res) => {
    res.status(201).json(await accounts.register(req.body || {}));
  }));

  router.post("/login", asyncHandler(async (req, res) => {
    res.json(await accounts.login(req.body || {}));
  }));

  router.post("/logout", (_req, res) => {
    // Tokens are short-lived and stateless; logging out means forgetting it.
    res.json({ ok: true });
  });

  router.get("/me", auth.requireAuth, (req, res) => {
    res.json({ user: req.auth });
  });

  router.post("/password", auth.requireAuth, asyncHandler(async (req, res) => {
    res.json(await accounts.changePassword(req.auth, req.body || {}));
  }));

  return router;
};
