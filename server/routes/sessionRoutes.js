/**
 * Per-account endpoints: the notification inbox and the contractor work queue.
 */

const express = require("express");
const { asyncHandler } = require("../http/errors");

module.exports = function createSessionRoutes({ auth, admin }) {
  const router = express.Router();

  router.get("/notifications", auth.requireAuth, asyncHandler(async (req, res) => {
    res.json({ notifications: await admin.notificationsFor({ principal: req.auth }) });
  }));

  router.post("/notifications/read", auth.requireAuth, asyncHandler(async (req, res) => {
    res.json(await admin.markRead({ principal: req.auth }));
  }));

  router.get("/work/queue", auth.requireRole("subcontractor"), asyncHandler(async (req, res) => {
    res.json({ work: await admin.contractorQueue({ actor: req.auth }) });
  }));

  return router;
};
