# PowerWatch Cameroon — API reference

Base URL `http://localhost:4000/api` (production: the host you deploy to).
All request and response bodies are JSON. Authenticated requests carry:

```
Authorization: Bearer <token>
```

The token comes from `POST /api/auth/register` or `POST /api/auth/login`.

## Conventions

### Success

The endpoint's payload object, returned directly:

```json
{ "incidents": [ /* … */ ] }
```

### Failure

```json
{ "error": "Human readable message." }
```

Where the failure has a machine-readable cause, the envelope adds fields:

```json
{
  "error": "Invalid status transition: rejected → validated.",
  "code": "INVALID_TRANSITION",
  "allowed": []
}
```

| Status | Meaning |
|---|---|
| `400` | The request was understood but rejected (missing field, bad coordinates, illegal value, malformed JSON) |
| `401` | No token, an invalid token, an expired token, or a signed-in account that no longer exists |
| `403` | Authenticated, but the role may not do this; or the account is deactivated |
| `404` | The resource does not exist |
| `409` | The change conflicts with the current state (duplicate username, duplicate confirmation, invalid transition) |
| `500` | An unexpected server failure — the detail is logged server-side only |

Internal errors never leak a stack trace or a database message.

### Roles

| Role value | Who |
|---|---|
| *(none)* | public — no token required |
| `client` | citizen |
| `subcontractor` | field crew (sees only its own work orders) |
| `socadel` | administrator / utility operator |

---

## Health

### `GET /api/health` — public

```json
{
  "ok": true,
  "database": "postgres",
  "environment": "development",
  "uptime_seconds": 42
}
```

`database` is the live storage engine: `postgres`, `mysql` or `memory`.

---

## Authentication — `/api/auth`

### `POST /api/auth/register` — public

Creates a **citizen** account. Attempting to claim a role is rejected.

Request:

```json
{
  "username": "aida.ngombe",
  "password": "Citizen!2026",
  "fullName": "Aida Ngombe",
  "phone": "+237600000001",
  "email": "aida@example.cm"
}
```

Rules: `username` matches `^[a-z0-9._-]{3,40}$` (lower-cased server-side),
`password` is 8–128 characters, `fullName` is required. `phone` and `email` are
optional.

`201` response:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs…",
  "user": { "id": 7, "username": "aida.ngombe", "full_name": "Aida Ngombe", "user_role": "client", "is_active": 1 }
}
```

Errors: `400` invalid username / weak password / missing name, `403` a role was
claimed, `409` username already taken.

### `POST /api/auth/login` — public

```json
{ "username": "aida.ngombe", "password": "Citizen!2026", "role": "client" }
```

`role` is optional; when present the account must have it, otherwise the response
is `403` with a message naming the actual role. `200` otherwise, same shape as
register.

A wrong password and an unknown account both return the identical `401`, so the
endpoint cannot be used to enumerate accounts.

### `POST /api/auth/logout` — public

Tokens are stateless; the client discards its copy. `200 { "ok": true }`.

### `GET /api/auth/me` — authenticated

```json
{ "user": { "id": 7, "username": "aida.ngombe", "role": "client", "name": "Aida Ngombe" } }
```

This is the endpoint to call to confirm a stored token is still valid. It re-reads
the account, so a deactivated account returns `403`.

### `POST /api/auth/password` — authenticated

```json
{ "currentPassword": "Citizen!2026", "newPassword": "Citizen!2027" }
```

`200 { "ok": true }`. Errors: `400` policy, `401` wrong current password.

---

## Public map and reporting — `/api/public`

No token required. Everything here is deliberately coarse so the public map
cannot be used to locate a household.

### `GET /api/public/config` — public

```json
{
  "report_categories": ["Total outage", "Low voltage", "Flickering", "Sparking / unsafe line", "Meter problem", "Other"],
  "incident_statuses": ["pending", "pending_validation", "…", "rejected"],
  "clustering": { "cluster_distance_m": 500, "cluster_window_minutes": 30, "min_reports_to_qualify": 1 },
  "subcontractor_name": "SOCADEL Field Agent",
  "location_precision": 3
}
```

The client reads its category list and its clustering explanation from here, so
the two can never drift.

### `GET /api/public/incidents` — public

The map feed. Coordinates are rounded to `location_precision` decimals; reporter
names, phone numbers and report-level positions are **not** included.

```json
{ "incidents": [ { "id": 1, "reference": "INC-2026-0047", "title": "Clustered outage near Bastos feeder", "district": "Bastos, Yaounde", "latitude": 3.884, "longitude": 11.517, "radius_m": 500, "reports_count": 37, "severity": "high", "status": "pending_validation", "…": "…" } ] }
```

Returns `{ "incidents": [] }` when there is nothing — a valid empty state, not an
error.

### `GET /api/public/incidents/:id` — public

One incident, same coarse projection, plus whatever public detail the service
attaches. `404` if it does not exist.

### `POST /api/public/reports` — public *(works signed in too)*

The core citizen action. This is where clustering happens.

```json
{
  "latitude": 3.8841,
  "longitude": 11.5168,
  "district": "Bastos, Yaounde",
  "category": "Total outage",
  "description": "The whole block is dark since about 18:40.",
  "reporterName": "Aida Ngombe",
  "phone": "+237600000001",
  "photoUrl": null
}
```

* `latitude` / `longitude` must be finite numbers **inside Cameroon**.
* `district` is required (the neighbourhood/city the citizen sees).
* `category` must be one of the published categories, otherwise it becomes
  `Other`.
* `reporterName` defaults to the signed-in name, or `Anonymous citizen`.
* The server stamps `created_at`. A client timestamp is never trusted.

The server then: validates → saves the report → searches nearby recent reports
and open clusters → attaches the report to a cluster or opens a new one →
recomputes the cluster (centroid, radius, count, severity) → notifies the
operator queue when a cluster qualifies → writes the audit trail.

`201` when the report **opened a new cluster**:

```json
{
  "reference": "INC-2026-00048210",
  "incident_id": 12,
  "incident_status": "pending_validation",
  "reports_count": 1,
  "severity": "low",
  "matched_existing": false,
  "distance_m": null,
  "message": "Report received. Neighbours reporting the same area will be grouped automatically."
}
```

`200` when it **joined an existing cluster** (`matched_existing: true`, the same
`incident_id` as the cluster it joined, `reports_count` incremented, and the
message says it was added to an existing outage cluster).

Errors: `400` coordinates missing / not finite / outside Cameroon, or no
district.

### `POST /api/public/incidents/:id/confirmations` — public *(works signed in too)*

"Me too" and "power is back".

```json
{ "type": "also_affected", "deviceId": "3f1c…", "comment": "Still out here." }
```

`type` is `also_affected` or `restored`. A signed-in caller is identified by their
account; a guest must send a `deviceId`. Either way the server stores an
irreversible hash, so one person can confirm an incident at most once per type.

`201 { "ok": true, "confirmations": { "also_affected": 4, "restored": 1 } }`.

Errors: `400` bad type, a missing device id for a guest, or a confirmation that
does not fit the incident's current status; `409` already confirmed.

### `GET /api/public/announcements` — public

```json
{ "announcements": [ { "id": 1, "title": "Planned maintenance — Bastos", "body": "…", "audience": "all", "published": 1, "created_by": "SOCADEL operator" } ] }
```

Only published announcements are returned.

---

## Place lookup — `/api/geocode`

### `GET /api/geocode/quarters?q=<text>` — public

A thin proxy in front of the place search, so the citizen's typing is not sent
straight from the browser to a third-party service. Returns
`{ "places": [ … ] }`, where each place carries `name`, `city`, `region`,
`latitude`, `longitude` and `displayName`. An empty `places` array is normal and
the form tells the user to keep their own wording and place the pin manually.

---

## Incident workflow — `/api/incidents`

The workflow is a set of explicit transitions, so each step is its own endpoint
rather than one generic `PATCH`. The incident detail reports `next_statuses`, so
the console only ever offers a move the state machine will accept.

### `GET /api/incidents` — `socadel` or `subcontractor`

Query: `status`, `severity`, `search` (matches reference, title and district).

```json
{ "incidents": [ /* full incident rows */ ] }
```

### `GET /api/incidents/mine` — authenticated citizen

The reports the signed-in account submitted.

```json
{ "reports": [ { "id": 104, "incident_id": 2, "category": "Total outage", "district": "Akwa, Douala", "status": "clustered", "created_at": "2026-09-22T17:05:00.000Z" } ], "total": 18 }
```

### `GET /api/incidents/:id` — `socadel` or `subcontractor`

Full detail, including reporter names and phone numbers, the member reports, the
work order, the chat thread, the confirmations, the audit trail and the legal next
statuses.

```json
{
  "incident": { "…": "…" },
  "reports": [ /* … */ ],
  "reports_total": 37,
  "messages": [ /* … */ ],
  "work_request": { "…": "…" },
  "confirmations": { "also_affected": 4, "restored": 0 },
  "audit": [ /* … */ ],
  "next_statuses": ["validated", "rejected", "pending"]
}
```

### `POST /api/incidents/:id/messages` — authenticated

```json
{ "body": "Crew is 10 minutes away." }
```

`201` with the created message. Authorship always comes from the token, never
from the body.

### `POST /api/incidents/:id/validate` — `socadel`

```json
{ "agencyReport": "Confirmed on the Bastos feeder.", "rootCause": "Feeder trip" }
```

Moves `pending_validation → validated`. Legal only from a status the state machine
allows; otherwise `409 INVALID_TRANSITION` with the `allowed` array. `404` if the
incident does not exist. `200` with the updated incident.

### `POST /api/incidents/:id/reject` — `socadel`

```json
{ "reason": "Duplicate of a known planned maintenance window." }
```

→ `rejected`, recording the reason and the audit entry.

### `POST /api/incidents/:id/assign` — `socadel`

```json
{ "contractor": "VoltCare Contractors" }
```

Legal only from `validated` (`409 ASSIGNMENT_NOT_ALLOWED` otherwise). Creates the
work order, notifies the crew, and moves the incident to `assigned`.

### `POST /api/incidents/:id/field-status` — `subcontractor` or `socadel`

The crew does not choose a status — the current status decides the next step.

```json
{ "status": "on_the_way" }
```

Accepted steps: `on_the_way` → `under_intervention` → `completed`, with the
requested `status` checked against the legal step for the current state.
Completing the work automatically opens the restoration-verification phase
(`verification_pending`) and notifies both the operator queue and the citizens.

An optional completion payload is accepted alongside: `rootCause`, `diagnosis`,
`equipment`, `replacedComponents`, `comments`.

### `POST /api/incidents/:id/close` — `socadel`

```json
{ "summary": "Cable repaired and the span re-energised.", "override": false }
```

→ `closed`, stamping `restored_at` and `closed_at`. Closure normally requires at
least one citizen restoration confirmation; without one the response is
`409 RESTORATION_UNVERIFIED`. An administrator may pass `"override": true` to
close anyway — an explicit, audited decision.

### `POST /api/incidents/:id/reopen` — `subcontractor` or `socadel`

```json
{ "reason": "Supply dropped again after the repair." }
```

Returns an incident to the intervention stage when a restoration did not hold.

---

## Per-account — `/api/notifications`, `/api/work`

### `GET /api/notifications` — authenticated

The signed-in inbox: notifications addressed to the account directly, plus those
addressed to its role queue.

```json
{ "notifications": [ { "id": 12, "incident_id": 1, "event_type": "incident.awaiting_validation", "title": "HIGH cluster in Bastos, Yaounde", "message": "37 reports within 500 m need validation.", "is_read": 0, "created_at": "2026-09-22T19:58:00.000Z" } ] }
```

### `POST /api/notifications/read` — authenticated

Marks the caller's notifications as read. `200`.

### `GET /api/work/queue` — `subcontractor`

The work orders belonging to the caller's company, so a crew only ever sees its
own work.

```json
{ "work": [ { "id": 1, "incident_id": 2, "contractor": "VoltCare Contractors", "status": "on_site", "assigned_at": "…" } ] }
```

---

## Administration — `/api/admin`

Every route in this section requires the `socadel` role; a citizen or crew token
receives `403`.

### `GET /api/admin/analytics?days=14` — `socadel`

`days` is clamped to 3–90. Every figure is computed from the database.

```json
{
  "generated_at": "2026-09-22T20:00:00.000Z",
  "window_days": 14,
  "kpis": {
    "active_incidents": 8,
    "awaiting_validation": 2,
    "in_intervention": 3,
    "awaiting_verification": 1,
    "closed_total": 14,
    "rejected_total": 2,
    "reports_total": 421,
    "reports_in_window": 96,
    "incidents_in_window": 11,
    "avg_validation_hours": 0.4,
    "avg_restoration_hours": 5.2,
    "accounts": { "total": 34, "client": 30, "subcontractor": 2, "socadel": 2 }
  },
  "severity_distribution": [ { "severity": "low", "incidents": 4 } ],
  "status_distribution": [ { "status": "closed", "total": 14 } ],
  "districts": [ { "district": "Akwa, Douala", "reports": 54, "incidents": 1, "worst_severity": "critical" } ],
  "trend": [ { "date": "2026-09-09", "reports": 6, "incidents": 2 } ],
  "contractors": [ { "contractor": "VoltCare Contractors", "jobs": 4, "in_progress": 1, "avg_travel_hours": 0.5, "avg_repair_hours": 2.1 } ]
}
```

`trend` always contains one entry per day in the window, including zero days, so
charts do not silently skip a gap. On an empty database every figure is `0` and
every list is `[]` — never an error.

### `GET /api/admin/stats` — `socadel`

Raw counts by status, used by the console tiles.

```json
{ "total": 24, "active": 8, "pending": 1, "pending_validation": 2, "validated": 1, "assigned": 2, "on_the_way": 1, "under_intervention": 1, "completed": 0, "verification_pending": 1, "closed": 14, "rejected": 2, "reports": 421 }
```

### `GET /api/admin/users?role=&search=` — `socadel`

Account list. **Never** includes password material.

```json
{ "users": [ { "id": 7, "username": "aida.ngombe", "full_name": "Aida Ngombe", "user_role": "client", "email": "aida@example.cm", "phone": "+237600000001", "is_active": 1 } ] }
```

### `POST /api/admin/users` — `socadel`

Creates a staff account. Same body as registration, but `role` may be `socadel`,
`subcontractor` or `client`. `201` with the created account.

### `PATCH /api/admin/users/:id/active` — `socadel`

```json
{ "is_active": false }
```

Deactivating takes effect immediately: an existing token for that account stops
working on the next request. An administrator cannot deactivate their own account
(`400`).

### `GET /api/admin/contractors` — `socadel`

Contractor names for the assignment dropdown.

```json
{ "contractors": [ { "id": 3, "username": "voltcare.crew", "name": "VoltCare Contractors", "is_active": 1 } ] }
```

### Operational zones — `socadel`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/zones` | list zones |
| `POST` | `/api/admin/zones` | create: `name`, `description`, `region`, `latitude`, `longitude`, `radius_m` |
| `PATCH` | `/api/admin/zones/:id` | update any subset |
| `DELETE` | `/api/admin/zones/:id` | remove; incidents in that zone fall back to no zone |

Zone names are unique — a duplicate is `409`.

A zone is a circle: any report inside it is attached to that zone, which is how
incidents are grouped operationally. With PostGIS the containment test is a single
indexed `ST_DWithin`; without it the same arithmetic runs over the small zone
table, so the result is identical.

### Announcements — `socadel`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/announcements` | list, published or not |
| `POST` | `/api/admin/announcements` | create: `title`, `body`, `audience`, `published` |
| `PATCH` | `/api/admin/announcements/:id` | update |
| `DELETE` | `/api/admin/announcements/:id` | delete |

`audience` is `all`, `client` or `subcontractor`. Only published announcements are
served to the public endpoint.

### `GET` / `PUT /api/admin/clustering-config` — `socadel`

The detection rules, editable at runtime without a redeploy.

```json
{ "cluster_distance_m": 500, "cluster_window_minutes": 30, "min_reports_to_qualify": 1 }
```

`PUT` accepts any subset; every value must be a positive number (`400` otherwise).
The change is written to `system_settings`, published immediately through
`GET /api/public/config`, and recorded in the audit trail as
`settings.clustering_updated`.

### `GET /api/admin/audit?incident_id=&limit=` — `socadel`

The append-only trail of privileged actions. `limit` defaults to 100.

```json
{ "audit": [ { "id": 88, "actor": "console.admin", "action": "incident.validated", "incident_id": 2, "details": { "from": "pending_validation" }, "created_at": "2026-09-22T19:05:00.000Z" } ] }
```

Logged actions include `auth.login`, `account.created`, `account.seeded`,
`account.created_by_admin`, `auth.password_changed`,
`incident.created_from_report`, `report.attached`, `incident.validated`,
`incident.rejected`, `work.assigned`, `incident.on_the_way`,
`incident.under_intervention`, `incident.completed`, `incident.closed`,
`confirmation.also_affected`, `confirmation.restored`,
`settings.clustering_updated`, and the `zone.*` / `announcement.*` family.

---

## Endpoint summary

| Method | Path | Role |
|---|---|---|
| GET | `/api/health` | public |
| POST | `/api/auth/register` | public |
| POST | `/api/auth/login` | public |
| POST | `/api/auth/logout` | public |
| GET | `/api/auth/me` | any signed in |
| POST | `/api/auth/password` | any signed in |
| GET | `/api/public/config` | public |
| GET | `/api/public/incidents` | public |
| GET | `/api/public/incidents/:id` | public |
| POST | `/api/public/reports` | public / citizen |
| POST | `/api/public/incidents/:id/confirmations` | public / citizen |
| GET | `/api/public/announcements` | public |
| GET | `/api/geocode/quarters` | public |
| GET | `/api/incidents` | `socadel`, `subcontractor` |
| GET | `/api/incidents/mine` | any signed in |
| GET | `/api/incidents/:id` | `socadel`, `subcontractor` |
| POST | `/api/incidents/:id/messages` | any signed in |
| POST | `/api/incidents/:id/validate` | `socadel` |
| POST | `/api/incidents/:id/reject` | `socadel` |
| POST | `/api/incidents/:id/assign` | `socadel` |
| POST | `/api/incidents/:id/field-status` | `subcontractor`, `socadel` |
| POST | `/api/incidents/:id/close` | `socadel` |
| POST | `/api/incidents/:id/reopen` | `subcontractor`, `socadel` |
| GET | `/api/notifications` | any signed in |
| POST | `/api/notifications/read` | any signed in |
| GET | `/api/work/queue` | `subcontractor` |
| GET | `/api/admin/analytics` | `socadel` |
| GET | `/api/admin/stats` | `socadel` |
| GET | `/api/admin/users` | `socadel` |
| POST | `/api/admin/users` | `socadel` |
| PATCH | `/api/admin/users/:id/active` | `socadel` |
| GET | `/api/admin/contractors` | `socadel` |
| GET/POST | `/api/admin/zones` | `socadel` |
| PATCH/DELETE | `/api/admin/zones/:id` | `socadel` |
| GET/POST | `/api/admin/announcements` | `socadel` |
| PATCH/DELETE | `/api/admin/announcements/:id` | `socadel` |
| GET/PUT | `/api/admin/clustering-config` | `socadel` |
| GET | `/api/admin/audit` | `socadel` |

Unknown paths under `/api` return `404` with the standard error envelope.

