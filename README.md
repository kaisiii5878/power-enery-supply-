# PowerWatch Cameroon

**Report. Detect. Monitor. Restore.**

A geolocation-based platform for reporting, monitoring and analysing electricity
outages in urban Cameroon. Citizens report an outage from their browser; the
system clusters nearby reports into a single **potential common outage**, estimates
its severity, puts it on a live map, keeps citizens and operators informed, and
records the whole lifecycle through to restoration and historical analytics.

This is the web platform for the Software Engineering project proposal
*"Design and Development of a Geolocation-Based Intelligent System for Reporting,
Monitoring and Analyzing Electricity Outages in Cameroon."*

> **Intelligence in the MVP is rule-based.** Geographic + temporal clustering and a
> transparent severity heuristic — not machine learning. Section
> [Future work](#future-work) describes how predictive services would slot in.

---

## Table of contents

1. [Overview](#overview)
2. [Problem statement](#problem-statement)
3. [Objectives](#objectives)
4. [Features](#features)
5. [Architecture](#architecture)
6. [Technologies](#technologies)
7. [Project structure](#project-structure)
8. [Quick start (no database)](#quick-start-no-database)
9. [PostgreSQL + PostGIS setup](#postgresql--postgis-setup)
10. [Environment configuration](#environment-configuration)
11. [Database migrations](#database-migrations)
12. [Seed data](#seed-data)
13. [Development commands](#development-commands)
14. [Testing](#testing)
15. [API documentation](#api-documentation)
16. [Vocabulary](#vocabulary)
17. [Deployment](#deployment)
18. [Security and privacy](#security-and-privacy)
19. [Troubleshooting](#troubleshooting)
20. [Future work](#future-work)

---

## Overview

An outage in Cameroon is usually reported by phone call, if it is reported at
all. There is no shared picture of *how many* households are affected, *where*
the boundary of the fault is, or *how long* supply has been out. The utility and
its field crews work from scattered, informal information.

PowerWatch turns individual citizen reports into structured, geolocation-based
outage information:

```
CITIZEN REPORT
      ↓  browser Geolocation API (or a pin placed on the map)
GPS / GEOLOCATION
      ↓
REPORT VALIDATION
      ↓
GEOGRAPHIC + TEMPORAL ANALYSIS      ← rule-based clustering
      ↓
COMMON OUTAGE DETECTION
      ↓
SEVERITY ESTIMATION                 ← transparent heuristic with a stated reason
      ↓
LIVE MONITORING                     ← operations map + console
      ↓
USER NOTIFICATION
      ↓
RESTORATION
      ↓
HISTORICAL ANALYTICS
      ↓
DECISION SUPPORT
```

### Actors

| Actor | Role code | What they do |
|---|---|---|
| **Citizen** | `client` | Registers, reports outages, follows their cases, receives notifications, confirms restoration. |
| **Field crew** | `subcontractor` | Receives work orders for their own company, moves them through the field statuses, files the completion report. |
| **Administrator / utility operator** | `socadel` | Validates clusters, dispatches crews, monitors the network, manages accounts, tunes the detection rules, reads analytics and the audit trail. |

The two additional roles named in the proposal — *service operator* and
*business/institution* — are intentionally not implemented in the MVP. The role
column and the authorization middleware are built so that adding them is a
matter of extending the vocabulary, not restructuring the system.

---

## Problem statement

Electricity outages in Cameroon's urban areas are frequent, geographically
localised and poorly documented. The consequences:

* citizens cannot tell whether an outage is theirs alone or part of a wider
  fault, and cannot find out when it will be fixed;
* the utility has no aggregated, near-real-time view of where supply is out, so
  it cannot prioritise crews by impact;
* there is no historical record of duration, frequency or affected
  neighbourhoods to support investment and maintenance decisions;
* the absence of a shared map means neighbouring reports of the same fault are
  never recognised as evidence of one incident.

## Objectives

1. Give citizens a fast, low-friction way to report an outage from any browser,
   with the location captured automatically.
2. Convert many individual reports into a small number of geographically and
   temporally coherent **outage incidents**.
3. Estimate the severity of each incident with a rule that can be explained to a
   human, and show that explanation in the interface.
4. Give operators a live monitoring console: active outages, affected areas,
   durations, report volume, restoration.
5. Keep affected citizens informed through in-app notifications.
6. Preserve a trustworthy history of every incident for analytics and long-term
   decision support.
7. Do all of this with clear separation of concerns, server-side authorization
   and no exposure of citizen personal data.

---

## Features

### Citizen

* Register, sign in, sign out; edit profile and phone number; change password.
* Report an outage through a guided four-step form (Location → Outage details →
  Extra information → Review).
* Capture the position with the browser Geolocation API, see the accuracy, and
  adjust the pin on the map if the reading is poor.
* Manual neighbourhood entry with curated suggestions for all ten regions, plus
  optional place lookup.
* See nearby active outages on the map, grouped when many reports share an area.
* Open an incident to see its status, severity, affected area, timeline and
  estimated duration.
* Receive in-app notifications when something near them changes; mark them read.
* Review the reports they have submitted and the status of each.
* Confirm restoration ("power is back") or "I am affected too".

### Administrator / operator

* A monitoring-centre dashboard: KPIs, live outage summary, map, trends, recent
  reports and alerts — every number computed from the database.
* Live outage monitoring: active incidents, severity, report growth, affected
  neighbourhoods, start time, current duration.
* Validate a cluster as a real outage, or reject it with a reason.
* Assign a field crew; follow the intervention; close with restoration verified.
* Search, filter and sort incidents and reports; open an incident's full detail.
* Manage accounts: create staff accounts, activate/deactivate, filter by role.
* Tune the clustering thresholds at runtime without a redeploy.
* Read analytics: outages by neighbourhood, trends over time, duration,
  severity distribution, status distribution, contractor performance.
* Read the append-only audit trail of every privileged action.
* Publish service announcements to the citizen map.

### Cross-cutting

* Responsive from a 320 px phone to a wide desktop, with a different layout for
  each size rather than a shrunken desktop.
* Dark and light themes from a single token file.
* Loading skeletons, empty states and error states on every asynchronous screen.
* Consistent, human-readable error messages — never "Axios Error 500".

---

## Architecture

```
                    REACT WEB CLIENT
        (Vite · React Router · Leaflet/OpenStreetMap · design-token CSS)
                             │
                             │  HTTPS · JSON REST · Bearer JWT
                             ▼
                  NODE.JS + EXPRESS API  (/api)
   ┌───────────────────────────────────────────────────────────────┐
   │ routes/          transport: paths, verbs, role guards         │
   │ controllers*     (thin) — request in, service call, response  │
   │ services/        use cases and business rules                 │
   │   authService · incidentService · adminService · analytics     │
   │ domain/          pure rules, no framework, no database         │
   │   geo · clustering · incidentLifecycle · passwords             │
   │ http/            tokens · auth middleware · error envelope     │
   │ store/           repository layer (see below)                 │
   └───────────────────────────────────────────────────────────────┘
                             │
                             ▼
              POSTGRESQL + POSTGIS   (authoritative)
                             ┆
                             ┆  optional, interchangeable
                             ▼
                   MYSQL   ·   IN-MEMORY
```

\* This codebase keeps the HTTP handlers in `routes/` rather than a separate
`controllers/` folder — a deliberate simplification of the same layering: the
route file is the thin adapter, the service holds the rules, the store holds the
SQL.

### Separation of concerns

| Layer | Responsibility | Must not |
|---|---|---|
| `routes/` | Parse the request, enforce the role, call one service, shape the response | Contain business rules or SQL |
| `services/` | Use cases: validate input, apply rules, coordinate repositories, write the audit trail | Contain SQL strings |
| `domain/` | Pure functions: distance, clustering, severity, the status machine, password hashing | Touch Express, a database or the clock implicitly |
| `store/` | Persistence: parameterised queries behind one interface | Leak the active engine to callers |

### Database independence

Every engine implements **one interface** (`server/store/*.js`). The rest of the
application only ever sees that interface, so:

* PostgreSQL + PostGIS is the authoritative MVP database because the clustering
  and coverage queries are genuinely spatial;
* MySQL is retained as a compatible engine behind the same interface;
* the in-memory store keeps the API runnable with no database at all — which is
  what the test suite runs against, so `npm test` needs no fixtures.

The application's production data is **never duplicated** between engines: you
point `STORAGE_DRIVER` at one of them and it is the single source of truth.

---

## Technologies

| Area | Choice |
|---|---|
| Client | React 19, Vite 7, React Router 7 |
| Mapping | Leaflet + `react-leaflet`, OpenStreetMap tiles, MapLibre GL helper |
| Charts | Purpose-built responsive SVG chart components |
| Styling | Design-token CSS (custom properties) with light/dark themes |
| Icons | `lucide-react` |
| API | Node.js 20, Express 5, REST, JSON |
| Auth | JWT (HS256), `scrypt` password hashing, bearer tokens |
| Validation | Service-layer validation with a shared error envelope |
| Database | PostgreSQL 15+ with PostGIS 3 (authoritative); MySQL 8 (compatible) |
| Migrations | Numbered SQL files + a runner that tracks them in `schema_migrations` |
| Tests | `node:test` (built-in) for both the API and the client domain logic |
| Version control | Git / GitHub |

Node **20.19** or newer is required.

---

## Project structure

```
power-enery-supply-/
├── index.html                     Vite entry document
├── package.json                   scripts + dependencies
├── vite.config.js                 build + dev-server + /api proxy
├── .env.example                   every environment variable, documented
│
├── client/                        the React web client
│   ├── src/
│   │   ├── main.jsx               mount point
│   │   ├── App.jsx                routing + role-based workspace selection
│   │   ├── app/                   AppContext: session, config, incident feed
│   │   ├── components/
│   │   │   ├── ui/                Button, Badge, Field, Surface, Feedback, State…
│   │   │   ├── layout/            AppShell (sidebar / topbar / mobile nav)
│   │   │   └── map/               MapCanvas, LocationPicker, attribution
│   │   ├── domain/                cameroon.js, incidents.js  (pure client rules)
│   │   ├── features/
│   │   │   ├── auth/              sign-in & registration
│   │   │   ├── citizen/           Home, ReportFlow, Map, Reports, Profile, detail
│   │   │   ├── admin/             Overview, Monitor, Incidents, Reports, Agents,
│   │   │   │                      Zones, Analytics, Charts, Audit, Settings
│   │   │   ├── agency/            field-crew workspace
│   │   │   ├── incidents/         message thread
│   │   │   └── notifications/     in-app inbox
│   │   ├── lib/                   api.js, session.js, hooks.js, format.js
│   │   └── styles/                tokens.css + base/components/layouts/data…
│   └── tests/                     client unit tests + the esbuild JSX loader
│
├── server/                        the Node.js API
│   ├── index.js                   process entry: pick a store, listen, shut down
│   ├── app.js                     Express assembly, security headers, error handler
│   ├── config/env.js              every secret and tunable, nothing hard-coded
│   ├── domain/                    pure rules (geo, clustering, lifecycle, passwords)
│   ├── http/                      tokens, auth middleware, error envelope
│   ├── routes/                    auth · public · geocode · incidents · session · admin
│   ├── services/                  authService · incidentService · adminService · analytics
│   ├── store/                     repository layer
│   │   ├── index.js               store factory + engine selection
│   │   ├── postgresStore.js       PostgreSQL + PostGIS adapter
│   │   ├── mysqlStore.js          MySQL adapter
│   │   ├── memoryStore.js         in-memory adapter (tests, offline demo)
│   │   ├── pgQuery.js             pg SQL builders, row normalisation, error mapping
│   │   ├── pgPool.js              pg connection pool factory
│   │   └── normalize.js           shared row shaping
│   ├── database/
│   │   ├── migrate.js             migration runner (`npm run migrate`)
│   │   ├── seed.js                demo seed runner (`npm run seed`)
│   │   ├── seedData.js            simulated zones, crews, citizens, audit rows
│   │   └── migrations/
│   │       ├── 0001_init.sql      baseline schema (plain PostgreSQL)
│   │       └── 0002_postgis.optional.sql   spatial columns + GIST indexes
│   ├── schema.sql                 MySQL schema (compatible engine)
│   └── tests/                     API, domain, store and migration test suites
│
└── docs/
    ├── API.md                     every endpoint, role, payload and error
    └── DATABASE.md                schema, spatial design, engine mapping
```

---

## Quick start (no database)

The fastest way to see the system. Nothing is installed except Node dependencies.

```bash
npm install
cp .env.example .env      # then set ADMIN_PASSWORD and JWT_SECRET
npm run dev
```

* API → <http://localhost:4000/api/health>
* Client → <http://localhost:5173>

With `STORAGE_DRIVER=memory` (the default when no database is reachable) the API
boots against the in-memory store and the client works fully. The health endpoint
tells you which engine is live:

```json
{ "ok": true, "database": "memory", "environment": "development" }
```

An in-memory run starts empty: create the administrator from your `.env`
(`ADMIN_USERNAME` / `ADMIN_PASSWORD`) and sign in. For the realistic demo dataset
— clustered reports around Bastos and Akwa, active and restored incidents,
notifications — use PostgreSQL and `npm run seed`.

---

## PostgreSQL + PostGIS setup

PostGIS powers the spatial queries (radius search, zone containment, affected-area
estimation). The application still runs without it, but PostgreSQL **with**
PostGIS is the authoritative configuration.

### 1. Install

* **Windows** — PostgreSQL 15+ and PostGIS via Stack Builder, or
  `choco install postgresql15 postgis`
* **macOS** — `brew install postgresql@15 postgis`
* **Debian/Ubuntu** — `sudo apt install postgresql-15 postgresql-15-postgis-3`

Confirm the extension is available:

```sql
SELECT name, default_version FROM pg_available_extensions WHERE name = 'postgis';
```

### 2. Create the database and role

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE powerwatch;
CREATE USER powerwatch WITH ENCRYPTED PASSWORD 'change-me';
GRANT ALL PRIVILEGES ON DATABASE powerwatch TO powerwatch;
\c powerwatch
GRANT ALL ON SCHEMA public TO powerwatch;
CREATE EXTENSION IF NOT EXISTS postgis;
```

`CREATE EXTENSION` needs an elevated role **once**. If your hosting role cannot
run it, ask an administrator to run that single line. Migration `0002` is then
skipped automatically and the application runs without spatial indexes.

### 3. Point the application at it

```dotenv
STORAGE_DRIVER=postgres
PG_HOST=localhost
PG_PORT=5432
PG_USER=powerwatch
PG_PASSWORD=change-me
PG_DATABASE=powerwatch
```

or, on a managed host, just:

```dotenv
DATABASE_URL=postgres://user:password@host:5432/powerwatch
```

### 4. Migrate and seed

```bash
npm run migrate      # apply pending migrations
npm run seed         # insert the simulated demonstration dataset
npm run dev
```

`npm run seed` prints the demo sign-in details once. Passwords are generated
randomly unless you set `SEED_DEMO_PASSWORD` (and `ADMIN_PASSWORD` for the
administrator) — no password is ever hard-coded in the source.

Blast radius: `npm run seed` refuses to run when incidents already exist. Add
`--reset` (`npm run seed:reset`) to truncate the demo tables first.

---

## Environment configuration

Copy `.env.example` to `.env`. `.env` is git-ignored — never commit real
credentials, database passwords or API secrets.

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | `development` / `production` / `test` | `development` |
| `PORT` | API port | `4000` |
| `STORAGE_DRIVER` | `auto` \| `postgres` \| `mysql` \| `memory` | `auto` |
| `DB_BOOTSTRAP` | apply pending migrations on boot | `true` |
| `DATABASE_URL` | Postgres connection string (managed hosts) | — |
| `PG_HOST` `PG_PORT` `PG_USER` `PG_PASSWORD` `PG_DATABASE` | discrete Postgres settings | `localhost` `5432` `postgres` `""` `powerwatch` |
| `PGSSL` | require TLS to Postgres | `false` |
| `PG_POOL_MAX` | connection pool size | `10` |
| `MYSQL_*` | the optional compatible engine | local defaults |
| `CLUSTER_DISTANCE_M` | clustering radius, metres | `500` |
| `CLUSTER_WINDOW_MINUTES` | clustering time window, minutes | `30` |
| `MIN_REPORTS_TO_QUALIFY` | reports before a cluster is sent for validation | `1` |
| `LOCATION_PRECISION_DP` | decimals kept on public coordinates | `3` |
| `JWT_SECRET` | **required in production** — signs sessions | dev-only value |
| `JWT_ISSUER` | token issuer claim | `powerwatch` |
| `SESSION_TTL_MINUTES` | session lifetime | `480` |
| `ADMIN_USERNAME` `ADMIN_PASSWORD` `ADMIN_FULL_NAME` | administrator seeded on first boot | username `admin`, password empty |
| `SEED_DEMO_PASSWORD` | password for simulated demo accounts | generated if unset |
| `CORS_ORIGIN` | comma-separated allowed origins (or `*`) | localhost origins |
| `VITE_API_BASE` | API base URL used by the client bundle | `http://localhost:4000/api` |

The clustering thresholds are also editable at runtime from
**Admin → Clustering rules**, which writes them to `system_settings`; the database
value wins over the environment default.

`STORAGE_DRIVER=auto` (the default) tries PostgreSQL first, then MySQL, then the
in-memory store, logging which engine it settled on.

---

## Database migrations

Migrations are numbered SQL files in `server/database/migrations`, applied in
filename order and recorded in a `schema_migrations` table (filename, checksum,
timestamp). Re-running is a no-op.

```bash
npm run migrate          # apply everything pending
npm run migrate:list     # show applied / pending without changing anything
npm run migrate -- --force   # re-apply (statements are idempotent)
```

A filename ending in `.optional.sql` is allowed to fail: it is skipped with a
warning instead of aborting the run. `0002_postgis.optional.sql` uses this so a
PostgreSQL without PostGIS still installs the application.

| Migration | Contains |
|---|---|
| `0001_init.sql` | `app_users`, `zones`, `incidents`, `reports`, `incident_messages`, `incident_confirmations`, `work_requests`, `agency_notifications`, `system_settings`, `audit_log`, `announcements`; indexes; seeded clustering thresholds |
| `0002_postgis.optional.sql` | `CREATE EXTENSION postgis`; generated `location geometry(Point,4326)` columns on `reports`, `incidents`, `zones`, `app_users`; GIST indexes; optional home location on `app_users` |

The runner is also invoked automatically on boot when `DB_BOOTSTRAP` is not
`false`, so a fresh deployment starts working after `npm start`.

---

## Seed data

`npm run seed` writes a **simulated** dataset — clearly labelled as development
data, containing no real customer information. It exists so the university
demonstration works on a fresh install.

It creates:

* the configured administrator, plus two field crews (`VoltCare Contractors`,
  `GridFix CM`);
* six citizens real enough to sign in as, positioned inside the outage clusters;
* two operational zones (Yaoundé Central, Douala Wouri);
* four incidents covering the lifecycle: *awaiting validation* (Bastos, 37
  reports), *under intervention* (Akwa, 54 reports), *validated*
  (Bonamoussadi), and *restored + closed* (Melen);
* ~86 citizen reports, all generated deterministically so cluster arithmetic is
  reproducible, deliberately clustered so the detection engine can be
  demonstrated immediately;
* a work order, restoration confirmations, notifications for both operators and
  citizens, an announcement, and an audit trail.

Because the incidents and reports are the same fixtures the in-memory store uses,
the demo behaves identically whether the app runs on PostgreSQL or offline.

```bash
npm run seed           # skips if incidents already exist
npm run seed:reset     # truncates the demo tables, then seeds
```

---

## Development commands

| Command | What it does |
|---|---|
| `npm run dev` | API (`nodemon`) + client (`vite`) together |
| `npm run dev:server` | API only, with reload |
| `npm run dev:client` | client only, on `0.0.0.0` so a phone on the LAN can open it |
| `npm run build` | production client bundle into `dist/` |
| `npm run preview` | serve the built client |
| `npm start` | API only, serving `dist/` when it exists (production) |
| `npm run serve` | API + built client together |
| `npm run migrate` | apply pending database migrations |
| `npm run migrate:list` | show applied / pending migrations |
| `npm run seed` | insert the simulated demo dataset |
| `npm run seed:reset` | truncate the demo tables, then seed |
| `npm test` | backend test suite |
| `npm run test:client` | client unit tests |
| `npm run test:postgres` | PostgreSQL/PostGIS integration tests |
| `npm run audit:store` | compare the public surface of the storage engines |

To test the mobile layout without deploying, run `npm run dev:client` and open
`http://<your-laptop-ip>:5173` on a phone on the same network.

---

## Testing

The suite uses Node's built-in test runner — no extra framework, no fixtures, no
mocking of our own modules.

```bash
npm test                 # everything under server/tests
npm run test:client      # everything under client/tests
npm run test:postgres    # the live-database suite (skips when none is reachable)
```

### Backend

| Suite | Covers |
|---|---|
| `api.test.js` | the full HTTP surface end to end against the in-memory store |
| `apiEdgeCases.test.js` | registration and login boundaries, authorization (anonymous, citizen-vs-admin, forged and **expired** tokens), geolocation validation (missing, non-numeric, outside Cameroon), duplicate-report clustering, out-of-radius separation, invalid status transitions, empty analytics, malformed JSON, 404 envelope |
| `clustering.test.js` | radius, time window, status gating, candidate choice, centroid/radius/severity recalculation, reference generation |
| `geo.test.js` | great-circle distance, bounding boxes, the Cameroon bounds, the severity thresholds |
| `incidentLifecycle.test.js` | every legal and illegal transition, assignment gating, closure rules |
| `auth.test.js` | password hashing and policy, reporter-key hashing, JWT sign/verify, tamper, expiry, wrong secret, wrong issuer, bearer parsing |
| `pgQuery.test.js` | parameter numbering, insert/update builders, SQLSTATE→`ER_DUP_ENTRY` translation, row normalisation, geometry never leaking |
| `migrations.test.js` | file discovery and ordering, the optional marker, every required table, constrained vocabularies, GIST indexes, no destructive statements |
| `postgresStore.test.js` | live adapter: PostGIS detection, `ST_DWithin`, generated geometry, zone lookup, spatial candidate filtering, settings round-trip, pagination, no password leakage, status buckets |

The PostgreSQL suite **skips itself** when no database is reachable, so
`npm test` is green on a laptop with nothing installed while still proving the
spatial path on a machine that has one.

### Client

| Suite | Covers |
|---|---|
| `format.test.mjs` | every presentation helper, timezone-independent |
| `incidents.test.mjs` | the client status/severity model, map colours, the incident timeline, operational sorting, field steps |
| `cameroon.test.mjs` | region/city/quarter data, district composition, region matching |
| `authForm.test.mjs` | form validation, and that a registration body can never claim a role |

---

## API documentation

The full endpoint reference — every path, its role guard, its payload and the
errors it can return — is in **[`docs/API.md`](docs/API.md)**. The database design,
spatial queries and the MySQL↔PostgreSQL mapping are in
**[`docs/DATABASE.md`](docs/DATABASE.md)**.

Base URL: `http://localhost:4000/api`. All responses are JSON. Authenticated
requests carry `Authorization: Bearer <token>`.

A quick orienting tour:

```
GET    /api/health                        which storage engine is live
POST   /api/auth/register                 create a citizen account
POST   /api/auth/login                    obtain a session token
GET    /api/auth/me                       the account behind the token

GET    /api/public/config                 report categories + clustering rules
GET    /api/public/incidents              coarse public map feed
POST   /api/public/reports                submit an outage report (GPS + details)
POST   /api/public/incidents/:id/confirmations   "me too" / "power is back"

GET    /api/incidents                     operator/crew queue
GET    /api/incidents/mine                the citizen's own reports
GET    /api/incidents/:id                 full detail (staff only)
POST   /api/incidents/:id/validate        operator: confirm a real outage
POST   /api/incidents/:id/reject          operator: reject with a reason
POST   /api/incidents/:id/assign          operator: dispatch a crew
POST   /api/incidents/:id/field-status    crew: advance the intervention
POST   /api/incidents/:id/close           operator: close after restoration

GET    /api/notifications                 the signed-in inbox
POST   /api/notifications/read            mark everything read

GET    /api/admin/analytics               KPIs and chart series
GET    /api/admin/stats                   incident counts by status
GET    /api/admin/users                   account list (search + role filter)
PATCH  /api/admin/users/:id/active        activate / deactivate
GET    /api/admin/zones|announcements|contractors
PUT    /api/admin/clustering-config       retune the detection rules
GET    /api/admin/audit                   the audit trail
```

---

## Vocabulary

The proposal and the code use slightly different words for the same concepts.
This table is the translation, so the report and the running system can be
discussed in one language.

| Proposal term | Implemented as | Where |
|---|---|---|
| CITIZEN | `client` | `app_users.user_role` |
| ADMINISTRATOR | `socadel` (utility operator) | `app_users.user_role` |
| (field crew — operational detail) | `subcontractor` | `app_users.user_role` |
| SERVICE OPERATOR *(future)* | not implemented; extend the role vocabulary | — |
| BUSINESS / INSTITUTION *(future)* | not implemented; extend the role vocabulary | — |
| REPORTED | `pending` — "Collecting reports" | `incidents.status` |
| INVESTIGATING | `pending_validation`, then `validated` | `incidents.status` |
| ACTIVE | `assigned`, `on_the_way`, `under_intervention` | `incidents.status` |
| RESTORED | `completed`, `verification_pending`, `closed` | `incidents.status` |
| REJECTED | `rejected` | `incidents.status` |
| LOW / MODERATE / HIGH / CRITICAL | `low` / `medium` / `high` / `critical` | `incidents.severity` |
| "Potential Common Outage" | a cluster in `pending_validation`, explained as *"SOCADEL must confirm this is a real outage before any crew is dispatched."* | client status metadata |
| outage report | `reports` table | — |
| outage event | `incidents` table (an incident *is* the cluster) | — |

Two deliberate differences from the proposal's wording:

* **Response envelope.** The API returns the payload object directly on success
  and `{ "error": "..." }` (plus `code` and `allowed` where relevant) on failure,
  rather than a `{ success, message, data }` wrapper. One central error handler
  applies this consistently, and the client's single request wrapper turns it
  into typed, human-readable errors.
* **Entity naming.** The cluster is called an *incident* throughout, matching the
  UML state machine in the proposal document.

---

## Deployment

The client and the API deploy independently, or together as one Node process.

### Frontend — Netlify / Vercel

* Build command `npm run build`, publish directory `dist`.
* Set `VITE_API_BASE` to the deployed API URL, e.g.
  `https://powerwatch-api.onrender.com/api`.
* Single-page routing: rewrite unknown paths to `/index.html`
  (Netlify `_redirects` → `/*  /index.html  200`; the Vercel Vite preset handles
  this automatically).

### Backend — Render / Railway / any Node host

* Build `npm install`, start `npm start`, Node 20+.
* Environment: `NODE_ENV=production`, `DATABASE_URL` (managed PostgreSQL with
  PostGIS), `JWT_SECRET` (a long random value — the process refuses to start
  without it in production), `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
  `CORS_ORIGIN=https://your-client-domain`.
* Migrations run automatically on boot (`DB_BOOTSTRAP=true`, the default). To run
  them as an explicit release step instead, set `DB_BOOTSTRAP=false` and run
  `npm run migrate`.
* `npm start` also serves `dist/` when it exists, so a single host can serve both.

### Database — managed PostgreSQL with PostGIS

Render, Railway, Neon, Supabase and AWS RDS all provide PostgreSQL. Confirm
PostGIS is available on the plan you choose (Neon and Supabase include it; on RDS
it is an extension you enable). If it is not, the application still runs — it
simply loses the spatial indexes and answers radius queries in JavaScript.

### Deployment checklist

- [ ] `.env` is **not** committed (it is listed in `.gitignore`)
- [ ] `JWT_SECRET` is a fresh random value, unique per environment
- [ ] `ADMIN_PASSWORD` is strong and is not the example value
- [ ] `CORS_ORIGIN` lists only your real client origins
- [ ] `PGSSL=true` (or `sslmode=require` in `DATABASE_URL`) on a managed host
- [ ] `npm test` is green
- [ ] `npm run migrate` has been run against the target database

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Security and privacy

Implemented:

* **Password hashing** — `scrypt` (memory-hard, in Node core) with a per-password
  salt and a constant-time comparison. Plaintext passwords are never stored and
  are never returned by any endpoint.
* **Sessions** — HS256 JWTs, short-lived, carrying only an identity. The account
  row is re-read on every request, so deactivating an account locks it out
  immediately rather than when the token happens to expire.
* **Authorization** — role guards on every non-public route. Hiding a route in
  the client is never the control; the server decides.
* **Registration limits** — public sign-up can only create `client` accounts.
  Staff accounts are created by an authenticated administrator.
* **Input validation** — coordinates must be finite numbers inside Cameroon;
  statuses must come from the central vocabulary; status changes must be legal
  transitions; ids, dates and pagination are bounded.
* **Parameterised queries only** — never string-interpolated values, on any
  engine. `pgQuery.js` builds numbered placeholders (`$1 … $n`).
* **Safe error responses** — one handler turns every failure into a
  human-readable message; internal errors become a generic 500 while the detail
  is logged server-side only.
* **Audit logging** — every privileged action (login, validation, rejection,
  assignment, field status, closure, account activation, rule changes) is
  appended to `audit_log` with actor, action, entity and metadata.
* **Transport hardening** — `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy: geolocation=(self)`, `Cache-Control: no-store` on the API,
  and CORS restricted to the configured origins.
* **Secrets from the environment only** — no credential, key or password appears
  in source. `.env` is git-ignored.

### Privacy of location data

* Citizens' exact positions never appear on the **public** map: incident
  coordinates are rounded to three decimals (`LOCATION_PRECISION_DP`), and the
  public feed carries no reporter names, phone numbers or report-level positions.
* Full-precision coordinates and reporter details are visible only to
  authenticated staff, and only where the workflow needs them.
* A citizen confirmation is stored as an irreversible `sha256` of a per-device
  id, so one person can confirm an incident at most once without being
  identified.
* The optional `app_users.location` column added by the PostGIS migration is
  empty until a citizen chooses to share it. The proximity query returns an
  **aggregate** count, never a list of people.
* Future business analytics are expected to use aggregated, anonymised data.

### Not implemented (worth knowing before a real deployment)

* No refresh-token rotation, no server-side session revocation list, no
  multi-factor authentication, and no account lockout after repeated failures.
* No email or SMS verification of the phone number.
* **Rate limiting is not wired in yet.** For a public deployment it should be
  added before exposure — especially on `/api/auth/*` and
  `/api/public/reports`.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `[store] no database reachable — falling back to the in-memory store` | PostgreSQL and MySQL are both unreachable. Expected on a demo machine. Set `STORAGE_DRIVER=memory` to silence it, or start a database. |
| `[migrate] skipped optional 0002_postgis.optional.sql` | The role cannot create the extension. Ask an administrator to run `CREATE EXTENSION postgis;` once in the database, then `npm run migrate` again. The app runs without it meanwhile. |
| `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` | PostgreSQL is reachable but rejected the credentials. Set `PG_PASSWORD` (or `DATABASE_URL`) in `.env`. |
| `database "powerwatch" does not exist` | Create it, or point `PG_DATABASE` / `DATABASE_URL` at an existing database. |
| `JWT_SECRET must be set in production` | Set `JWT_SECRET` — production sessions cannot be signed without one. |
| Health says `"database": "memory"` but you expect Postgres | `STORAGE_DRIVER=auto` fell back. Check the startup log line for the reason. |
| `[seed] nothing to do: incidents already holds N row(s)` | Working as intended. Use `npm run seed:reset` to replace the demo data. |
| Citizen map is empty | A genuine empty state (no incidents). Seed the demo data, or submit a report. |
| Browser refuses to share a location | Expected in several conditions (permission denied, insecure origin, no GPS). The form falls back to placing the pin on the map — a location is never submitted silently. Geolocation requires `https://` or `localhost`. |
| `EADDRINUSE` on start | Port 4000 is busy. Change `PORT` in `.env`. |
| Client shows "We could not reach PowerWatch" | The API is not running, or `VITE_API_BASE` points somewhere wrong. |

---

## Future work

The architecture is deliberately shaped so the proposal's future ambitions are
additions, not rewrites.

**Machine learning.** The MVP's intelligence is rule-based and stays that way.
The natural next step is a `PredictionService`, an `AnomalyDetectionService`, an
`OutageForecastService` and a `RestorationPredictionService`, each consuming the
incident and report history this platform already records. They slot in beside
`domain/` as another decision source behind the same service boundary — no SQL
and no HTTP layer needs to change. Nothing in this repository claims a model
exists today.

**Additional roles.** `service_operator` and `business_institution` extend the
`user_role` vocabulary and the `requireRole` guards. The rehearsal for this is
already in the code: `subcontractor` was added exactly that way.

**Notifications.** In-app notifications are the MVP. Firebase Cloud Messaging
(web push) or an SMS gateway would deliver the same events off-screen; the
notification generation is already centralised in the incident service, so only
the delivery channel is new.

**Business features.** Reliability reports, aggregated neighbourhood analytics,
partnership dashboards and optional advertising are downstream consumers of the
analytics service, built on aggregated, anonymised data.

---

## Academic context

Built for the Software Engineering project *"Design and Development of a
Geolocation-Based Intelligent System for Reporting, Monitoring and Analyzing
Electricity Outages in Cameroon."*

The demonstration the system is designed to support:

1. Create several citizen accounts.
2. Submit multiple outage reports from nearby locations.
3. Watch each report appear on the map.
4. Watch the clustering engine group them.
5. See nearby reports become one **potential common outage**.
6. Watch the report count increase.
7. Watch the severity change.
8. See the affected geographic area.
9. See the nearby-user notification.
10. Sign in as the administrator and open the incident.
11. Move it through validation.
12. Assign a crew and move it to **under intervention**.
13. Confirm restoration from the citizen side.
14. Watch the incident become **closed**.
15. See the duration appear in history.
16. Watch the analytics update.
17. Watch the dashboard KPIs update.

Every step runs on real application logic against the real database.

### Known limitations

Recorded honestly, because they are the honest starting point for the next
iteration:

* `matchRegion` in `client/src/domain/cameroon.js` matches region aliases by
  naive substring, so "West", "North-West" and "South-West" resolve to "East"
  (the "est" alias matches inside "ouest"/"west"). It affects only the
  geocoder's suggested region hint; the map pin is authoritative. The behaviour
  is pinned by a test in `client/tests/cameroon.test.mjs` so it cannot regress
  silently.
* Server-side request validation is hand-written in the service layer rather
  than expressed as declarative schemas. It is centralised and tested, but a
  schema library would make it more uniform.




