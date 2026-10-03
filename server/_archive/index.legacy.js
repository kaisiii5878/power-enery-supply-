require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const port = process.env.PORT || 4000;
const clusterDistanceM = Number(process.env.CLUSTER_DISTANCE_M || 500);
const clusterWindowMinutes = Number(process.env.CLUSTER_WINDOW_MINUTES || 30);
const minReportsToQualifyDefault = Number(process.env.MIN_REPORTS_TO_QUALIFY || 1);
const adminAccount = { username: "admin", password: "admin", role: "socadel", name: "System Administrator" };
const defaultSubcontractorName = process.env.SUBCONTRACTOR_NAME || "SOCADEL Field Agent";
const activeSessions = new Map();
const accountStorePath = path.join(__dirname, "data", "accounts.json");
const localAccounts = new Map();
const placeSearchCache = new Map();
let photonQueue = Promise.resolve();
let photonLastRequestAt = 0;

function makePasswordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function persistLocalAccounts() {
  await fs.mkdir(path.dirname(accountStorePath), { recursive: true });
  await fs.writeFile(accountStorePath, JSON.stringify([...localAccounts.values()], null, 2), { encoding: "utf8", mode: 0o600 });
}

async function loadLocalAccounts() {
  try {
    const rows = JSON.parse(await fs.readFile(accountStorePath, "utf8"));
    for (const row of rows) localAccounts.set(row.username, row);
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("Local account store could not be loaded:", error.message);
  }
}
const accountStoreReady = loadLocalAccounts();

function photonRequest(url) {
  const request = photonQueue.then(async () => {
    const waitMs = Math.max(0, 1100 - (Date.now() - photonLastRequestAt));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    photonLastRequestAt = Date.now();
    const response = await fetch(url, { headers: { "User-Agent": "PowerWatchCameroon/1.0 (community electricity incident reporting)" } });
    if (!response.ok) throw new Error(`Place search returned HTTP ${response.status}.`);
    return response.json();
  });
  photonQueue = request.catch(() => {});
  return request;
}

app.use(cors());
app.use(express.json());

function requireRole(role) {
  return (req, res, next) => {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const session = activeSessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
      activeSessions.delete(token);
      return res.status(401).json({ error: "Sign in required." });
    }
    if (session.role !== role) return res.status(403).json({ error: "Your account cannot perform this action." });
    req.user = session;
    next();
  };
}

function issueSession(account, requestedRole, res, status = 200) {
  const token = crypto.randomBytes(32).toString("base64url");
  const session = { id: account.id || null, role: account.role, name: account.name, expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
  activeSessions.set(token, session);
  res.status(status).json({ token, user: { id: session.id, role: requestedRole, name: account.name }, expires_in: 28800 });
}

app.post("/api/auth/register", async (req, res) => {
  await accountStoreReady;
  const requestedRole = String(req.body.role || "");
  const role = requestedRole === "agency" || requestedRole === "agent" ? "subcontractor" : requestedRole;
  if (!["client", "subcontractor"].includes(role)) return res.status(400).json({ error: "Choose a client or agent account." });
  const username = String(req.body.username || "").trim().toLowerCase();
  const name = String(req.body.name || "").trim().slice(0, 120);
  const password = String(req.body.password || "");
  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) return res.status(400).json({ error: "Username must be 3–40 characters using letters, numbers, dots, dashes, or underscores." });
  if (name.length < 2) return res.status(400).json({ error: "Enter your name." });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Choose a password between 8 and 128 characters." });
  const credentials = makePasswordHash(password);
  const account = { username, name, role, password_salt: credentials.salt, password_hash: credentials.hash };
  const pool = await poolPromise;
  if (pool) {
    try {
      const [result] = await pool.query("INSERT INTO app_users (username, full_name, user_role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)", [username, name, role, credentials.salt, credentials.hash]);
      return issueSession({ id: result.insertId, name, role }, requestedRole, res, 201);
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "That username is already taken." });
      console.error("Account registration failed:", error.message);
      return res.status(500).json({ error: "Could not create your account." });
    }
  }
  if (localAccounts.has(username)) return res.status(409).json({ error: "That username is already taken." });
  localAccounts.set(username, account);
  try { await persistLocalAccounts(); }
  catch (error) { localAccounts.delete(username); console.error("Could not persist local account:", error.message); return res.status(500).json({ error: "Could not save your account." }); }
  issueSession({ name, role }, requestedRole, res, 201);
});

app.post("/api/auth/login", async (req, res) => {
  await accountStoreReady;
  const requestedRole = String(req.body.role || "");
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (requestedRole === "admin") {
    if (username !== adminAccount.username || password !== adminAccount.password) return res.status(401).json({ error: "Invalid username or password." });
    return issueSession(adminAccount, "admin", res);
  }
  const role = requestedRole === "agency" || requestedRole === "agent" ? "subcontractor" : requestedRole;
  if (!["client", "subcontractor"].includes(role)) return res.status(400).json({ error: "Invalid account type." });
  let account;
  const pool = await poolPromise;
  if (pool) {
    const [rows] = await pool.query("SELECT id, username, full_name AS name, user_role AS role, password_salt, password_hash FROM app_users WHERE username=? AND user_role=? LIMIT 1", [username, role]);
    account = rows[0];
  } else account = localAccounts.get(username);
  if (!account || account.role !== role || !verifyPassword(password, account.password_salt, account.password_hash)) return res.status(401).json({ error: "Invalid username or password." });
  issueSession(account, requestedRole, res);
});

app.post("/api/auth/logout", (req, res) => {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  activeSessions.delete(token);
  res.status(204).end();
});

app.get("/api/config", async (_req, res) => {
  const cluster = await getClusterConfig();
  res.json({ ...cluster, subcontractor_name: defaultSubcontractorName });
});

app.get("/api/geocode/quarters", async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, 180);
  if (query.length < 3) return res.status(400).json({ error: "Enter at least 3 characters to search for a place." });
  const cacheKey = query.toLocaleLowerCase();
  const cached = placeSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return res.json({ places: cached.places, cached: true });
  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", `${query}, Cameroon`);
    url.searchParams.set("limit", "10");
    url.searchParams.set("lang", "en");
    url.searchParams.append("layer", "locality");
    url.searchParams.append("layer", "district");
    const result = await photonRequest(url);
    const places = (result.features || []).filter(feature => {
      const countryCode = String(feature.properties?.countrycode || "").toUpperCase();
      const countryName = String(feature.properties?.country || "").toLowerCase();
      return countryCode === "CM" || countryName === "cameroon";
    }).map(feature => {
      const properties = feature.properties || {};
      const [longitude, latitude] = feature.geometry?.coordinates || [];
      const placeName = properties.name || properties.district || properties.city || "Unnamed place";
      return {
        name: placeName,
        district: properties.district || properties.locality || "",
        city: properties.city || properties.county || "",
        region: properties.state || "",
        displayName: [placeName, properties.district, properties.city, properties.state].filter((part, index, all) => part && all.indexOf(part) === index).join(", "),
        latitude: Number(latitude),
        longitude: Number(longitude)
      };
    }).filter(place => Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
    placeSearchCache.set(cacheKey, { places, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    res.json({ places, cached: false });
  } catch (error) {
    console.warn("Quarter lookup unavailable:", error.message);
    res.status(502).json({ error: "Place lookup is temporarily unavailable. You can still enter a quarter and pin it on the map." });
  }
});

app.get("/api/admin/agents", requireRole("socadel"), async (_req, res) => {
  const pool = await poolPromise;
  if (pool) {
    const [rows] = await pool.query("SELECT id, username, full_name AS name FROM app_users WHERE user_role='subcontractor' ORDER BY full_name");
    return res.json(rows);
  }
  await accountStoreReady;
  res.json([...localAccounts.values()].filter(account => account.role === "subcontractor").map(({ username, name }) => ({ username, name })));
});

app.get("/api/admin/clustering-config", requireRole("socadel"), async (_req, res) => {
  const defaults = memory.clusteringConfig || { cluster_distance_m: clusterDistanceM, cluster_window_minutes: clusterWindowMinutes, min_reports_to_qualify: minReportsToQualifyDefault };
  const pool = await poolPromise;
  if (!pool) return res.json(defaults);
  const [rows] = await pool.query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('cluster_distance_m','cluster_window_minutes','min_reports_to_qualify')");
  const config = { ...defaults };
  for (const row of rows) {
    const key = { cluster_distance_m: "cluster_distance_m", cluster_window_minutes: "cluster_window_minutes", min_reports_to_qualify: "min_reports_to_qualify" }[row.setting_key];
    if (key) config[key] = Number(row.setting_value);
  }
  res.json(config);
});

app.put("/api/admin/clustering-config", requireRole("socadel"), async (req, res) => {
  const config = {
    cluster_distance_m: Number(req.body.cluster_distance_m),
    cluster_window_minutes: Number(req.body.cluster_window_minutes),
    min_reports_to_qualify: Number(req.body.min_reports_to_qualify)
  };
  if (!Number.isInteger(config.cluster_distance_m) || config.cluster_distance_m < 50 || config.cluster_distance_m > 10000 ||
      !Number.isInteger(config.cluster_window_minutes) || config.cluster_window_minutes < 5 || config.cluster_window_minutes > 1440 ||
      !Number.isInteger(config.min_reports_to_qualify) || config.min_reports_to_qualify < 1 || config.min_reports_to_qualify > 100) {
    return res.status(400).json({ error: "Distance must be 50–10000 m, time window 5–1440 minutes, and qualification threshold 1–100 reports." });
  }
  const pool = await poolPromise;
  if (pool) {
    for (const [key, value] of Object.entries(config)) {
      await pool.query("INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)", [key, String(value)]);
    }
    await pool.query("UPDATE incidents SET status='pending_validation' WHERE status='pending' AND reports_count >= ?", [config.min_reports_to_qualify]);
    await pool.query("INSERT INTO audit_log (actor, action, details) VALUES (?, 'clustering_config_updated', ?)", [req.user.name, JSON.stringify(config)]);
  } else {
    memory.clusteringConfig = config;
    for (const incident of memory.incidents) if (incident.status === "pending" && Number(incident.reports_count || 0) >= config.min_reports_to_qualify) incident.status = "pending_validation";
    memory.audit.push({ actor: req.user.name, action: "clustering_config_updated", details: config, created_at: new Date().toISOString() });
  }
  res.json(config);
});

const seedIncidents = [
  {
    id: 1,
    reference: "INC-2026-0047",
    title: "Clustered outage near Bastos feeder",
    district: "Bastos, Yaounde",
    latitude: 3.8841,
    longitude: 11.5168,
    radius_m: 500,
    reports_count: 37,
    severity: "high",
    status: "pending_validation",
    assignee: null,
    root_cause: "Awaiting SOCADEL validation",
    resolution: "Reports are being correlated before dispatch."
  },
  {
    id: 2,
    reference: "INC-2026-0051",
    title: "Transformer overload around Akwa",
    district: "Akwa, Douala",
    latitude: 4.0527,
    longitude: 9.7043,
    radius_m: 700,
    reports_count: 58,
    severity: "critical",
    status: "under_intervention",
    assignee: "VoltCare Contractors",
    root_cause: "Suspected low-voltage transformer overload",
    resolution: "Crew is isolating the affected branch and replacing fuses."
  },
  {
    id: 3,
    reference: "INC-2026-0053",
    title: "Voltage instability reports in Bonamoussadi",
    district: "Bonamoussadi, Douala",
    latitude: 4.0908,
    longitude: 9.7434,
    radius_m: 350,
    reports_count: 12,
    severity: "medium",
    status: "validated",
    assignee: "SOCADEL Network Team",
    validated_at: "2026-09-22T10:00:00.000Z",
    root_cause: "Probable feeder phase imbalance",
    resolution: "Validated and queued for field assignment."
  },
  {
    id: 4,
    reference: "INC-2026-0056",
    title: "Localized outage near Melen",
    district: "Melen, Yaounde",
    latitude: 3.8665,
    longitude: 11.4964,
    radius_m: 250,
    reports_count: 5,
    severity: "low",
    status: "completed",
    assignee: "GridFix CM",
    root_cause: "Service drop cable fault",
    resolution: "Cable repaired. Power restored and verified by customer confirmations."
  }
];

const seedReports = [
  {
    id: 101,
    reporter_name: "M. Njoya",
    phone: "+237 699 000 001",
    category: "Total outage",
    description: "No electricity since evening.",
    district: "Bastos, Yaounde",
    latitude: 3.8844,
    longitude: 11.5172,
    status: "clustered",
    severity: "high",
    created_at: "2026-09-22T18:42:00.000Z"
  },
  {
    id: 102,
    reporter_name: "A. Mbarga",
    phone: "+237 677 000 002",
    category: "Low voltage",
    description: "Lights are weak and appliances stop.",
    district: "Bonamoussadi, Douala",
    latitude: 4.0911,
    longitude: 9.7441,
    status: "validated",
    severity: "medium",
    created_at: "2026-09-22T19:05:00.000Z"
  }
];

let memory = {
  incidents: [...seedIncidents],
  reports: [...seedReports],
  messages: [],
  notifications: [],
  confirmations: [],
  audit: [],
  workRequests: [{ id: 1, incident_id: 2, contractor: "VoltCare Contractors", assigned_by: "SOCADEL operator", status: "under_intervention", assigned_at: "2026-09-22T10:00:00.000Z", arrival_time: "2026-09-22T11:00:00.000Z" }]
};
const chatStreams = new Map();

async function getPool() {
  try {
    const pool = mysql.createPool({
      host: process.env.MYSQL_HOST || "localhost",
      port: process.env.MYSQL_PORT || 3306,
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "eneo_outage",
      waitForConnections: true,
      connectionLimit: 5
    });
    await pool.query("SELECT 1");
    await accountStoreReady;
    for (const account of localAccounts.values()) {
      await pool.query("INSERT IGNORE INTO app_users (username, full_name, user_role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)", [account.username, account.name, account.role, account.password_salt, account.password_hash]);
    }
    console.log(`MySQL connected to ${process.env.MYSQL_DATABASE || "eneo_outage"}.`);
    return pool;
  } catch (error) {
    console.warn("MySQL unavailable, using in-memory demo data:", error.message);
    return null;
  }
}

let poolPromise = getPool();

async function getClusterConfig(pool) {
  if (pool === undefined) pool = await poolPromise;
  const fallback = memory.clusteringConfig || {
    cluster_distance_m: clusterDistanceM,
    cluster_window_minutes: clusterWindowMinutes,
    min_reports_to_qualify: minReportsToQualifyDefault
  };
  if (!pool) return fallback;
  const [rows] = await pool.query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('cluster_distance_m','cluster_window_minutes','min_reports_to_qualify')");
  const config = { ...fallback };
  for (const row of rows) if (Object.hasOwn(config, row.setting_key)) config[row.setting_key] = Number(row.setting_value);
  return config;
}

function nextReference() {
  const next = memory.incidents.length + 57;
  return `INC-${new Date().getFullYear()}-${String(next).padStart(4, "0")}`;
}

function distanceM(aLat, aLon, bLat, bLon) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function severityForCluster(count, radiusM) {
  const areaM2 = Math.round(Math.PI * radiusM * radiusM);
  const score = Math.min(100, count * 2 + (areaM2 / 1000000) * 10);
  if (score >= 75) return { severity: "critical", areaM2, score };
  if (score >= 45) return { severity: "high", areaM2, score };
  if (score >= 20) return { severity: "medium", areaM2, score };
  return { severity: "low", areaM2, score };
}

const transitions = {
  pending_validation: ["validated", "rejected", "pending"],
  pending: ["pending_validation", "rejected"],
  validated: ["assigned", "rejected"],
  assigned: ["on_the_way"],
  on_the_way: ["under_intervention"],
  under_intervention: ["completed"],
  completed: ["verification_pending"],
  verification_pending: ["closed", "under_intervention"],
  closed: [], rejected: []
};

function publicIncident(incident) {
  const { latitude, longitude, ...safe } = incident;
  // Round displayed location to roughly 100 m; retain exact coordinates only for qualification.
  return { ...safe, latitude: Math.round(Number(latitude) * 1000) / 1000, longitude: Math.round(Number(longitude) * 1000) / 1000 };
}

app.get("/api/health", async (_req, res) => {
  const pool = await poolPromise;
  res.json({ ok: true, database: pool ? "mysql" : "memory" });
});

app.get("/api/incidents", async (_req, res) => {
  const pool = await poolPromise;
  if (pool) {
    const [rows] = await pool.query("SELECT * FROM incidents ORDER BY updated_at DESC");
    return res.json(rows.map(publicIncident));
  }
  res.json(memory.incidents.map(publicIncident));
});

app.get("/api/reports", async (_req, res) => {
  const pool = await poolPromise;
  if (pool) {
    const [rows] = await pool.query("SELECT id, incident_id, category, district, ROUND(latitude,3) AS latitude, ROUND(longitude,3) AS longitude, status, severity, created_at FROM reports ORDER BY created_at DESC");
    return res.json(rows);
  }
  res.json(memory.reports.map(({ reporter_name, phone, description, ...report }) => ({ ...report, latitude: Math.round(Number(report.latitude) * 1000) / 1000, longitude: Math.round(Number(report.longitude) * 1000) / 1000 })));
});

app.get("/api/incidents/:id/messages", async (req, res) => {
  const pool = await poolPromise;
  if (pool) {
    const [rows] = await pool.query("SELECT * FROM incident_messages WHERE incident_id = ? ORDER BY created_at", [req.params.id]);
    return res.json(rows);
  }
  res.json(memory.messages.filter(message => message.incident_id === Number(req.params.id)));
});

app.get("/api/incidents/:id/messages/stream", (req, res) => {
  const incidentId = Number(req.params.id);
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
  res.flushHeaders();
  res.write("event: connected\ndata: {}\n\n");
  if (!chatStreams.has(incidentId)) chatStreams.set(incidentId, new Set());
  chatStreams.get(incidentId).add(res);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 20000);
  res.on("close", () => {
    clearInterval(heartbeat);
    chatStreams.get(incidentId)?.delete(res);
    if (chatStreams.get(incidentId)?.size === 0) chatStreams.delete(incidentId);
  });
});

function broadcastCaseMessage(incidentId, message) {
  for (const client of chatStreams.get(Number(incidentId)) || []) client.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

app.post("/api/incidents/:id/messages", async (req, res) => {
  const message = { incident_id: Number(req.params.id), author_role: req.body.author_role === "agency" ? "agency" : "client", author_name: String(req.body.author_name || "Client").slice(0, 120), body: String(req.body.body || "").trim().slice(0, 3000) };
  if (!message.body) return res.status(400).json({ error: "Message cannot be empty" });
  const pool = await poolPromise;
  if (pool) {
    const [result] = await pool.query("INSERT INTO incident_messages (incident_id, author_role, author_name, body) VALUES (?, ?, ?, ?)", [message.incident_id, message.author_role, message.author_name, message.body]);
    const [rows] = await pool.query("SELECT * FROM incident_messages WHERE id = ?", [result.insertId]);
    broadcastCaseMessage(message.incident_id, rows[0]);
    if (message.author_role === "client") await pool.query("INSERT INTO agency_notifications (incident_id, agency, event_type, message) SELECT id, assignee, 'client_message', CONCAT('New client message for ', reference, ' · ', district) FROM incidents WHERE id = ? AND assignee IS NOT NULL", [message.incident_id]);
    return res.status(201).json(rows[0]);
  }
  const saved = { id: Date.now(), ...message, created_at: new Date().toISOString() };
  memory.messages.push(saved);
  broadcastCaseMessage(message.incident_id, saved);
  if (message.author_role === "client") {
    const incident = memory.incidents.find(item => item.id === message.incident_id);
    if (incident?.assignee) memory.notifications.unshift({ id: Date.now() + 1, incident_id: incident.id, agency: incident.assignee, event_type: "client_message", message: `New client message for ${incident.reference} · ${incident.district}`, created_at: new Date().toISOString() });
  }
  res.status(201).json(saved);
});

app.get("/api/notifications", requireRole("subcontractor"), async (req, res) => {
  const agency = String(req.query.agency || "");
  if (agency !== req.user.name) return res.status(403).json({ error: "You cannot view another contractor's notifications." });
  const pool = await poolPromise;
  if (pool) {
    const [rows] = await pool.query("SELECT * FROM agency_notifications WHERE agency = ? ORDER BY created_at DESC LIMIT 100", [agency]);
    return res.json(rows);
  }
  res.json(memory.notifications.filter(item => item.agency === agency).sort((a, b) => b.created_at.localeCompare(a.created_at)));
});

app.get("/api/agency/incidents/:id/reports", requireRole("subcontractor"), async (req, res) => {
  const incidentId = Number(req.params.id);
  if (!Number.isSafeInteger(incidentId)) return res.status(400).json({ error: "Invalid incident id." });
  const pool = await poolPromise;
  if (pool) {
    const [[incident]] = await pool.query("SELECT id FROM incidents WHERE id=? AND assignee=?", [incidentId, req.user.name]);
    if (!incident) return res.status(403).json({ error: "Client reports are visible only to the agent assigned to this incident." });
    const [rows] = await pool.query("SELECT id,category,description,district,photo_url,created_at FROM reports WHERE incident_id=? ORDER BY created_at", [incidentId]);
    return res.json(rows);
  }
  const incident = memory.incidents.find(item => item.id === incidentId && item.assignee === req.user.name);
  if (!incident) return res.status(403).json({ error: "Client reports are visible only to the agent assigned to this incident." });
  return res.json(memory.reports.filter(item => item.incident_id === incidentId).map(({ id, category, description, district, photo_url, created_at }) => ({ id, category, description, district, photo_url, created_at })));
});

app.post("/api/incidents/:id/confirmations", async (req, res) => {
  const incidentId = Number(req.params.id);
  const type = req.body.type === "restored" ? "restored" : "also_affected";
  const reporterKey = String(req.body.reporter_key || "").slice(0, 128);
  const comment = String(req.body.comment || "").trim().slice(0, 500);
  if (!Number.isSafeInteger(incidentId) || !reporterKey) return res.status(400).json({ error: "Incident and anonymous reporter key are required." });
  const crypto = require("crypto");
  const hashedKey = crypto.createHash("sha256").update(reporterKey).digest("hex");
  const pool = await poolPromise;
  if (pool) {
    try {
      await pool.query("INSERT INTO incident_confirmations (incident_id,reporter_key,confirmation_type,comment) VALUES (?,?,?,?)", [incidentId, hashedKey, type, comment || null]);
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "You have already sent this confirmation." });
      if (error.code === "ER_NO_REFERENCED_ROW_2") return res.status(404).json({ error: "Incident not found." });
      throw error;
    }
    const [[counts]] = await pool.query("SELECT SUM(confirmation_type='also_affected') AS also_affected, SUM(confirmation_type='restored') AS restored FROM incident_confirmations WHERE incident_id=?", [incidentId]);
    return res.status(201).json({ incident_id: incidentId, type, ...counts });
  }
  const incident = memory.incidents.find(item => item.id === incidentId);
  if (!incident) return res.status(404).json({ error: "Incident not found." });
  memory.confirmations ||= [];
  if (memory.confirmations.some(item => item.incident_id === incidentId && item.reporter_key === hashedKey && item.type === type)) return res.status(409).json({ error: "You have already sent this confirmation." });
  memory.confirmations.push({ incident_id: incidentId, reporter_key: hashedKey, type, comment, created_at: new Date().toISOString() });
  return res.status(201).json({ incident_id: incidentId, type, also_affected: memory.confirmations.filter(item => item.incident_id === incidentId && item.type === "also_affected").length, restored: memory.confirmations.filter(item => item.incident_id === incidentId && item.type === "restored").length });
});

app.get("/api/incidents/:id/confirmations", async (req, res) => {
  const incidentId = Number(req.params.id);
  const pool = await poolPromise;
  if (pool) {
    const [[counts]] = await pool.query("SELECT COALESCE(SUM(confirmation_type='also_affected'),0) AS also_affected, COALESCE(SUM(confirmation_type='restored'),0) AS restored FROM incident_confirmations WHERE incident_id=?", [incidentId]);
    return res.json({ incident_id: incidentId, ...counts });
  }
  const items = memory.confirmations || [];
  return res.json({ incident_id: incidentId, also_affected: items.filter(item => item.incident_id === incidentId && item.type === "also_affected").length, restored: items.filter(item => item.incident_id === incidentId && item.type === "restored").length });
});

app.patch("/api/incidents/:id/work-request", requireRole("subcontractor"), async (req, res) => {
  const id = Number(req.params.id);
  const allowedStatuses = ["on_the_way", "under_intervention", "completed"];
  const status = String(req.body.status || "");
  if (!allowedStatuses.includes(status)) return res.status(400).json({ error: "Work request status must be on_the_way, under_intervention, or completed." });
  const fields = {
    root_cause: String(req.body.root_cause || "").slice(0, 255) || null,
    diagnosis: String(req.body.diagnosis || "").slice(0, 3000) || null,
    equipment: String(req.body.equipment || "").slice(0, 160) || null,
    replaced_components: String(req.body.replaced_components || "").slice(0, 1000) || null,
    technical_comments: String(req.body.technical_comments || "").slice(0, 3000) || null,
    photo_url: req.body.photo_url ? String(req.body.photo_url).slice(0, 500) : null
  };
  const pool = await poolPromise;
  if (pool) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[incident]] = await connection.query("SELECT * FROM incidents WHERE id=? FOR UPDATE", [id]);
      if (!incident) { await connection.rollback(); return res.status(404).json({ error: "Incident not found." }); }
      if (!(transitions[incident.status] || []).includes(status)) { await connection.rollback(); return res.status(409).json({ error: `Invalid status transition: ${incident.status} → ${status}.`, allowed: transitions[incident.status] || [] }); }
      const [[work]] = await connection.query("SELECT * FROM work_requests WHERE incident_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE", [id]);
      if (!work) { await connection.rollback(); return res.status(409).json({ error: "No SOCADEL-issued Work Request exists for this incident." }); }
      if (work.contractor !== req.user.name) { await connection.rollback(); return res.status(403).json({ error: "This Work Request is assigned to another contractor." }); }
      await connection.query("UPDATE work_requests SET status=?,departed_at=IF(?='on_the_way',NOW(),departed_at),arrival_time=IF(?='under_intervention',NOW(),arrival_time),completion_time=IF(?='completed',NOW(),completion_time),root_cause=?,diagnosis=?,equipment=?,replaced_components=?,technical_comments=?,photo_url=? WHERE id=?", [status, status, status, status, fields.root_cause, fields.diagnosis, fields.equipment, fields.replaced_components, fields.technical_comments, fields.photo_url, work.id]);
      await connection.query("UPDATE incidents SET status=?,agency_report=?,root_cause=COALESCE(?,root_cause),resolution=? WHERE id=?", [status, fields.technical_comments || fields.diagnosis, fields.root_cause, status === "completed" ? "Field work completed; awaiting restoration verification." : `Field team status: ${status.replaceAll("_", " ")}.`, id]);
      await connection.query("INSERT INTO audit_log (actor,action,incident_id,details) VALUES (?,?,?,?)", [work.contractor, `work_request_${status}`, id, JSON.stringify(fields)]);
      await connection.commit();
      const [[updated]] = await pool.query("SELECT * FROM work_requests WHERE id=?", [work.id]);
      return res.json(updated);
    } catch (error) {
      await connection.rollback();
      console.error("Work request update failed:", error.message);
      return res.status(500).json({ error: "Could not update work request." });
    } finally { connection.release(); }
  }
  const incident = memory.incidents.find(item => item.id === id);
  if (!incident) return res.status(404).json({ error: "Incident not found." });
  if (!(transitions[incident.status] || []).includes(status)) return res.status(409).json({ error: `Invalid status transition: ${incident.status} → ${status}.`, allowed: transitions[incident.status] || [] });
  const work = (memory.workRequests || []).findLast(item => item.incident_id === id);
  if (!work) return res.status(409).json({ error: "No SOCADEL-issued Work Request exists for this incident." });
  if (work.contractor !== req.user.name) return res.status(403).json({ error: "This Work Request is assigned to another contractor." });
  Object.assign(work, fields, { status, updated_at: new Date().toISOString() });
  Object.assign(incident, { status, agency_report: fields.technical_comments || fields.diagnosis, root_cause: fields.root_cause || incident.root_cause, resolution: status === "completed" ? "Field work completed; awaiting restoration verification." : `Field team status: ${status.replaceAll("_", " ")}.` });
  return res.json(work);
});

app.post("/api/reports", async (req, res) => {
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: "Valid latitude and longitude are required." });
  }
  const pool = await poolPromise;
  const clusterConfig = await getClusterConfig(pool);
  const payload = {
    reporter_name: String(req.body.reporter_name || "Anonymous citizen").slice(0, 120),
    phone: String(req.body.phone || "").slice(0, 40),
    category: String(req.body.category || "Total outage").slice(0, 80),
    description: String(req.body.description || "").slice(0, 3000),
    district: String(req.body.district || "Unknown area").slice(0, 180),
    latitude,
    longitude,
    // Severity is computed from the cluster evidence, never trusted from a citizen.
    severity: "low",
    status: "new"
  };

  if (pool) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [candidates] = await connection.query(
        "SELECT * FROM incidents WHERE status IN ('pending_validation','pending') AND last_report_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE) AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? ORDER BY last_report_at DESC FOR UPDATE",
        [clusterConfig.cluster_window_minutes, latitude - clusterConfig.cluster_distance_m / 111000, latitude + clusterConfig.cluster_distance_m / 111000, longitude - clusterConfig.cluster_distance_m / (111000 * Math.max(0.2, Math.cos(latitude * Math.PI / 180))), longitude + clusterConfig.cluster_distance_m / (111000 * Math.max(0.2, Math.cos(latitude * Math.PI / 180)))]
      );
      let incident = candidates.find(item => distanceM(latitude, longitude, Number(item.latitude), Number(item.longitude)) <= clusterConfig.cluster_distance_m);
      const now = new Date();
      if (!incident) {
        const reference = `INC-${now.getFullYear()}-${now.getTime().toString().slice(-8)}`;
        const [created] = await connection.query(
          "INSERT INTO incidents (reference,title,district,latitude,longitude,radius_m,reports_count,severity,status,root_cause,resolution,first_report_at,last_report_at) VALUES (?,?,?,?,?,?,0,'low','pending_validation','Awaiting SOCADEL validation','Qualified by spatial and temporal report correlation',NOW(),NOW())",
          [reference, `${payload.category} in ${payload.district}`, payload.district, latitude, longitude, clusterConfig.cluster_distance_m]
        );
        incident = { id: created.insertId, reference, latitude, longitude, radius_m: clusterConfig.cluster_distance_m, reports_count: 0, status: "pending" };
      }
      const [inserted] = await connection.query(
        "INSERT INTO reports (incident_id,reporter_name,phone,category,description,district,latitude,longitude,severity,status,photo_url) VALUES (?,?,?,?,?,?,?,?,?,'clustered',?)",
        [incident.id, payload.reporter_name, payload.phone, payload.category, payload.description, payload.district, latitude, longitude, "low", req.body.photo_url ? String(req.body.photo_url).slice(0, 500) : null]
      );
      const [clusterReports] = await connection.query("SELECT latitude,longitude FROM reports WHERE incident_id = ?", [incident.id]);
      const count = clusterReports.length;
      const centerLat = clusterReports.reduce((sum, report) => sum + Number(report.latitude), 0) / count;
      const centerLon = clusterReports.reduce((sum, report) => sum + Number(report.longitude), 0) / count;
      const radius = Math.max(50, Math.ceil(Math.max(...clusterReports.map(report => distanceM(centerLat, centerLon, Number(report.latitude), Number(report.longitude))))));
      const severity = severityForCluster(count, radius);
      const qualifiedStatus = count >= clusterConfig.min_reports_to_qualify ? "pending_validation" : "pending";
      await connection.query("UPDATE incidents SET latitude=?,longitude=?,radius_m=?,estimated_area_m2=?,reports_count=?,severity_score=?,severity=?,status=?,last_report_at=NOW(),district=?,title=? WHERE id=?", [centerLat, centerLon, radius, severity.areaM2, count, severity.score, severity.severity, qualifiedStatus, payload.district, `${payload.category} in ${payload.district}`, incident.id]);
      await connection.query("UPDATE reports SET severity=? WHERE incident_id=?", [severity.severity, incident.id]);
      await connection.commit();
      const [[savedReport]] = await pool.query("SELECT id,incident_id,category,district,latitude,longitude,status,severity,created_at FROM reports WHERE id=?", [inserted.insertId]);
      const [[savedIncident]] = await pool.query("SELECT * FROM incidents WHERE id=?", [incident.id]);
      return res.status(201).json({ report: savedReport, incident: publicIncident(savedIncident), qualification: { matchedBy: "distance_and_time", distanceThresholdM: clusterConfig.cluster_distance_m, timeWindowMinutes: clusterConfig.cluster_window_minutes, minimumReports: clusterConfig.min_reports_to_qualify, qualified: count >= clusterConfig.min_reports_to_qualify, estimatedAreaM2: severity.areaM2, severityScore: severity.score } });
    } catch (error) {
      await connection.rollback();
      console.error("Unable to qualify report:", error.message);
      return res.status(500).json({ error: "Could not qualify report." });
    } finally {
      connection.release();
    }
  }

  let incident = memory.incidents.find(item => ["pending_validation", "pending"].includes(item.status) && distanceM(latitude, longitude, Number(item.latitude), Number(item.longitude)) <= clusterConfig.cluster_distance_m && memory.reports.some(report => report.incident_id === item.id && Date.now() - new Date(report.created_at).getTime() <= clusterConfig.cluster_window_minutes * 60000));
  if (!incident) {
    incident = {
    id: Date.now() + 1,
    reference: nextReference(),
    title: `${payload.category} in ${payload.district}`,
    district: payload.district,
    latitude: payload.latitude,
    longitude: payload.longitude,
    radius_m: clusterConfig.cluster_distance_m,
    reports_count: 0,
    estimated_area_m2: 0,
    severity: "low",
    status: "pending",
    assignee: null,
    root_cause: "Client report received; awaiting SOCADEL validation",
    resolution: "A client report has been received and is awaiting review."
    };
    memory.incidents.unshift(incident);
  }
  const report = {
    id: Date.now(), incident_id: incident.id,
    ...payload,
    severity: "low",
    created_at: new Date().toISOString()
  };
  memory.reports.unshift(report);
  const members = memory.reports.filter(item => item.incident_id === incident.id);
  incident.reports_count = members.length;
  incident.latitude = members.reduce((sum, item) => sum + Number(item.latitude), 0) / members.length;
  incident.longitude = members.reduce((sum, item) => sum + Number(item.longitude), 0) / members.length;
  incident.radius_m = Math.max(50, Math.ceil(Math.max(...members.map(item => distanceM(incident.latitude, incident.longitude, Number(item.latitude), Number(item.longitude))))));
  const clusterSeverity = severityForCluster(members.length, incident.radius_m);
  incident.severity = clusterSeverity.severity;
  incident.estimated_area_m2 = clusterSeverity.areaM2;
  incident.severity_score = clusterSeverity.score;
  incident.status = members.length >= clusterConfig.min_reports_to_qualify ? "pending_validation" : "pending";
  members.forEach(item => item.severity = clusterSeverity.severity);
  if (incident.assignee) memory.notifications.unshift({ id: Date.now() + 2, incident_id: incident.id, agency: incident.assignee, event_type: "client_report", message: `New client report for ${incident.reference} in ${incident.district}`, created_at: new Date().toISOString() });
  res.status(201).json({ report: { ...report, reporter_name: undefined, phone: undefined, description: undefined }, incident: publicIncident(incident), qualification: { matchedBy: "distance_and_time", distanceThresholdM: clusterConfig.cluster_distance_m, timeWindowMinutes: clusterConfig.cluster_window_minutes, minimumReports: clusterConfig.min_reports_to_qualify, qualified: members.length >= clusterConfig.min_reports_to_qualify, estimatedAreaM2: clusterSeverity.areaM2, severityScore: clusterSeverity.score } });
});

app.patch("/api/incidents/:id", requireRole("socadel"), async (req, res) => {
  const id = Number(req.params.id);
  const allowed = ["status", "severity", "assignee", "root_cause", "resolution", "agency_report"];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (!Number.isSafeInteger(id) || !Object.keys(updates).length) return res.status(400).json({ error: "Incident id and supported updates are required." });

  const pool = await poolPromise;
  if (pool) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[before]] = await connection.query("SELECT * FROM incidents WHERE id = ? FOR UPDATE", [id]);
      if (!before) { await connection.rollback(); return res.status(404).json({ error: "Incident not found." }); }
      if (updates.status && updates.status !== before.status && !(transitions[before.status] || []).includes(updates.status)) {
        await connection.rollback();
        return res.status(409).json({ error: `Invalid status transition: ${before.status} → ${updates.status}.`, allowed: transitions[before.status] || [] });
      }
      if (updates.status === "pending_validation" && before.status === "pending") {
        const config = await getClusterConfig(pool);
        if (Number(before.reports_count) < config.min_reports_to_qualify) {
          await connection.rollback();
          return res.status(409).json({ error: `This incident needs at least ${config.min_reports_to_qualify} reports before SOCADEL validation.` });
        }
      }
      if (updates.status === "validated" && before.status !== "pending_validation") {
        await connection.rollback();
        return res.status(409).json({ error: "Only a qualified incident awaiting validation can be validated." });
      }
      if (updates.status === "assigned" && (!before.validated_at || !(updates.assignee || before.assignee))) {
        await connection.rollback();
        return res.status(409).json({ error: "SOCADEL must validate the incident and choose a contractor before assignment." });
      }
      if (updates.severity && !["low", "medium", "high", "critical"].includes(updates.severity)) { await connection.rollback(); return res.status(400).json({ error: "Invalid severity." }); }
      const fields = Object.keys(updates);
      const values = fields.map(field => updates[field]);
      if (updates.status === "validated") { fields.push("validated_at", "validated_by"); values.push(new Date(), req.user.name); }
      if (updates.status === "closed") { fields.push("closed_at"); values.push(new Date()); }
      if (updates.status === "assigned" && updates.assignee) {
        await connection.query("INSERT INTO work_requests (incident_id,contractor,assigned_by) VALUES (?,?,?)", [id, updates.assignee, req.user.name]);
      }
      await connection.query(`UPDATE incidents SET ${fields.map(field => `${field} = ?`).join(", ")} WHERE id = ?`, [...values, id]);
      if (updates.assignee && before.assignee !== updates.assignee) await connection.query("INSERT INTO agency_notifications (incident_id, agency, event_type, message) VALUES (?,?,'assignment',?)", [id, updates.assignee, `New case assigned: ${before.reference} · ${before.district}`]);
      await connection.query("INSERT INTO audit_log (actor,action,incident_id,details) VALUES (?,?,?,?)", [req.user.name, updates.status || "incident_updated", id, JSON.stringify(updates)]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      console.error("Incident update failed:", error.message);
      return res.status(500).json({ error: "Could not update incident." });
    } finally { connection.release(); }
    const [rows] = await pool.query("SELECT * FROM incidents WHERE id = ?", [id]);
    return res.json(publicIncident(rows[0]));
  }

  const current = memory.incidents.find(incident => incident.id === id);
  if (!current) return res.status(404).json({ error: "Incident not found." });
  const previousAssignee = current.assignee;
  if (updates.status && updates.status !== current.status && !(transitions[current.status] || []).includes(updates.status)) return res.status(409).json({ error: `Invalid status transition: ${current.status} → ${updates.status}.`, allowed: transitions[current.status] || [] });
  const minimumReports = (memory.clusteringConfig || {}).min_reports_to_qualify || minReportsToQualifyDefault;
  if (updates.status === "pending_validation" && current.status === "pending" && Number(current.reports_count || 0) < minimumReports) return res.status(409).json({ error: `This incident needs at least ${minimumReports} reports before SOCADEL validation.` });
  if (updates.status === "validated" && current.status !== "pending_validation") return res.status(409).json({ error: "Only a qualified incident awaiting validation can be validated." });
  if (updates.status === "assigned" && (!current.validated_at || !(updates.assignee || current.assignee))) return res.status(409).json({ error: "SOCADEL must validate the incident and choose a contractor before assignment." });
  if (updates.status === "validated") { current.validated_at = new Date().toISOString(); current.validated_by = req.user.name; }
  Object.assign(current, updates);
  if (updates.status === "assigned" && updates.assignee) {
    memory.workRequests ||= [];
    memory.workRequests.push({ id: Date.now(), incident_id: id, contractor: updates.assignee, assigned_by: req.user.name, status: "assigned", assigned_at: new Date().toISOString() });
  }
  if (updates.status === "closed") current.closed_at = new Date().toISOString();
  memory.audit ||= [];
  memory.audit.push({ actor: req.user.name, action: updates.status || "incident_updated", incident_id: id, details: updates, created_at: new Date().toISOString() });
  if (updates.assignee && previousAssignee !== updates.assignee) {
    memory.notifications.unshift({ id: Date.now(), incident_id: id, agency: current.assignee, event_type: "assignment", message: `New case assigned: ${current.reference} · ${current.district}`, created_at: new Date().toISOString() });
  }
  res.json(publicIncident(current));
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

