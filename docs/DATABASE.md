# PowerWatch Cameroon — database design

PostgreSQL 15+ with PostGIS 3 is the **authoritative** MVP database. MySQL 8 is
supported as a compatible engine behind the same repository interface; the two are
never used at the same time and production data is never duplicated between them.

* Baseline schema: `server/database/migrations/0001_init.sql`
* Spatial layer: `server/database/migrations/0002_postgis.optional.sql`
* MySQL equivalent (compatible engine): `server/schema.sql`

---

## Entity overview

```
app_users ──┬──< reports >──── incidents ──┬──< incident_messages
            │                              ├──< incident_confirmations
            │                              ├──< work_requests
            └──< agency_notifications ─────┘
                                           └──< audit_log

zones ──────< incidents                     announcements   (standalone)
system_settings  (key/value rules)          schema_migrations (runner bookkeeping)
```

| Table | Purpose |
|---|---|
| `app_users` | every account: citizens, field crews, administrators |
| `zones` | operational circles that group incidents geographically |
| `incidents` | a clustered outage — the "outage event". Holds the derived centroid, radius, counts and severity |
| `reports` | one row per citizen report — the raw signal |
| `incident_messages` | the per-incident conversation |
| `incident_confirmations` | "me too" / "power is back", deduplicated per person |
| `work_requests` | the work order handed to a contractor, and its field timeline |
| `agency_notifications` | in-app notifications, targeted at a user or a role queue |
| `system_settings` | runtime-tunable thresholds (the clustering rules) |
| `audit_log` | append-only trail of privileged actions |
| `announcements` | public service announcements shown on the citizen map |
| `schema_migrations` | which migration files have been applied, and their checksums |

A report belongs to **at most one** incident (`reports.incident_id`), and an
incident contains **one or many** reports. That is the whole point of the system:
individual reports become one structured outage.

---

## `app_users`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGSERIAL` / `BIGINT UNSIGNED` | primary key |
| `username` | `VARCHAR(40)` | **unique**, lower-cased, `^[a-z0-9._-]{3,40}$` |
| `full_name` | `VARCHAR(120)` | for crews this doubles as the company name |
| `user_role` | `VARCHAR(20)` | `client` \| `subcontractor` \| `socadel` (CHECK) |
| `password_salt` | `CHAR(32)` | per-password salt |
| `password_hash` | `CHAR(128)` | `scrypt` digest |
| `email` | `VARCHAR(160)` | optional |
| `phone` | `VARCHAR(40)` | optional |
| `is_active` | `BOOLEAN` | deactivation takes effect on the next request |
| `latitude` `longitude` `neighborhood` | numeric / text | **optional home location**, added by the PostGIS migration |
| `location` | `geometry(Point,4326)` | generated, GIST-indexed |
| `created_at` `updated_at` | `TIMESTAMPTZ` | |

Indexes: `(user_role, full_name)`, `(is_active)`, GIST on `location`.

Password columns are **never** selected into a response: `findUser` (used only by
authentication) reads them, `listUsers` strips them.

## `zones`

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `name` | `VARCHAR(120)` | **unique** — a duplicate raises `ER_DUP_ENTRY` (409) |
| `description`, `region` | text | |
| `latitude`, `longitude` | `NUMERIC(10,7)` | circle centre |
| `radius_m` | `INTEGER` | CHECK `> 0` |
| `location` | `geometry(Point,4326)` | generated, GIST-indexed |

## `incidents` — the outage event

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `reference` | `VARCHAR(40)` | **unique** public code, e.g. `INC-2026-0047` |
| `title` | `VARCHAR(180)` | e.g. "Total outage reported in Bastos, Yaounde" |
| `district` | `VARCHAR(180)` | the neighbourhood string citizens see |
| `zone_id` | FK → `zones.id` | `ON DELETE SET NULL` |
| `latitude`, `longitude` | `NUMERIC(10,7)` | **cluster centroid**, recomputed, never trusted from input |
| `radius_m` | `INTEGER` | maximum member distance from the centroid (floor 50 m) |
| `estimated_area_m2` | `BIGINT` | π r², an estimate |
| `reports_count` | `INTEGER` | member reports |
| `severity_score` | `NUMERIC(6,2)` | the raw heuristic score (0–100) |
| `severity` | `VARCHAR(10)` | `low` \| `medium` \| `high` \| `critical` (CHECK) |
| `status` | `VARCHAR(30)` | the ten-value state machine (CHECK) |
| `assignee` | `VARCHAR(140)` | the contractor name |
| `root_cause`, `resolution`, `agency_report`, `rejection_reason` | text | operator/crew narrative |
| `first_report_at`, `last_report_at` | `TIMESTAMPTZ` | drive the clustering window |
| `validated_by`, `validated_at` | | |
| `completed_at`, `restored_at`, `closed_at` | `TIMESTAMPTZ` | the restoration timeline |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | |
| `location` | `geometry(Point,4326)` | generated from the centroid, GIST-indexed |

Indexes: `(status, updated_at DESC)`, `(last_report_at DESC, latitude, longitude)`,
`(zone_id)`, GIST on `location`.

**Everything derived is recomputed, never accepted from the client.** The
centroid, radius, count, score and severity are written by
`domain/clustering.js` after each report.

## `reports`

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `incident_id` | FK → `incidents.id` | `ON DELETE SET NULL` |
| `user_id` | FK → `app_users.id` | `ON DELETE SET NULL`; nullable for guest reports |
| `reporter_name` | `VARCHAR(120)` | |
| `phone` | `VARCHAR(40)` | optional |
| `category` | `VARCHAR(80)` | one of the published categories |
| `description` | `TEXT` | |
| `district` | `VARCHAR(180)` | |
| `latitude`, `longitude` | `NUMERIC(10,7)` | the reported point |
| `status` | `VARCHAR(20)` | `clustered` \| `attached` \| `duplicate` \| `reviewed` (CHECK) |
| `severity` | `VARCHAR(10)` | kept in step with the parent incident |
| `photo_url` | `VARCHAR(500)` | optional |
| `created_at` | `TIMESTAMPTZ` | **server-stamped** |
| `location` | `geometry(Point,4326)` | generated, GIST-indexed |

Indexes: `(incident_id)`, `(created_at DESC)`, `(user_id)`, GIST on `location`.

## `incident_confirmations`

| Column | Type | Notes |
|---|---|---|
| `incident_id` | FK → `incidents.id` | `ON DELETE CASCADE` |
| `user_id` | FK → `app_users.id` | nullable for guests |
| `reporter_key` | `CHAR(64)` | **irreversible `sha256`** of the identity — never a raw id |
| `confirmation_type` | `VARCHAR(20)` | `also_affected` \| `restored` (CHECK) |
| `comment` | `VARCHAR(500)` | |
| `created_at` | `TIMESTAMPTZ` | |

`UNIQUE (incident_id, reporter_key, confirmation_type)` — this is what lets the
API answer `409 "You have already recorded this confirmation."` instead of
double-counting, on both engines.

## `work_requests`

The work order and the field timeline. `status` is
`assigned → departed → on_site → completed → verified`, plus `cancelled`.
`assigned_at`, `departed_at`, `arrival_time` and `completion_time` are the
timestamps the analytics service uses to derive average travel and repair times.
`root_cause`, `diagnosis`, `equipment`, `replaced_components`,
`technical_comments` and `photo_url` carry the completion report.

## `agency_notifications`

| Column | Type | Notes |
|---|---|---|
| `user_id` | FK → `app_users.id` | targets one account |
| `agency` | `VARCHAR(20)` | or targets a role queue: `socadel` \| `subcontractor` \| `client` |
| `incident_id` | FK → `incidents.id` | both cascade on delete |
| `event_type` | `VARCHAR(60)` | e.g. `incident.awaiting_validation` |
| `title`, `message` | text | |
| `is_read` | `BOOLEAN` | |
| `created_at` | `TIMESTAMPTZ` | |

Indexes: `(user_id, is_read)`, `(agency, is_read)`.

## `system_settings`

A key/value table so operators can retune the detection heuristic without a
deploy. Seeded by migration `0001` with `cluster_distance_m`,
`cluster_window_minutes` and `min_reports_to_qualify`. A value here overrides the
environment default.

## `audit_log`

`actor` (the username, **not** a foreign key — the trail must survive account
deletion), `action`, `incident_id` (`ON DELETE SET NULL`), `details JSONB`,
`created_at`. Indexed on `(incident_id, created_at DESC)` and
`(actor, created_at DESC)`.

## `announcements`

`title`, `body`, `audience`, `published`, `created_by`, timestamps. Indexed on
`(published, created_at DESC)`.

---

## Spatial design

### Generated geometry columns

Migration `0002` adds a point column to four tables:

```sql
ALTER TABLE reports ADD COLUMN IF NOT EXISTS location geometry(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)
  ) STORED;
```

A **generated** column cannot drift from `latitude`/`longitude`, and no insert or
update statement has to remember to maintain it — the shape of the data is
enforced by the database rather than by discipline.

> `ST_MakePoint(x, y)` takes **longitude first**. That ordering is the single
> easiest thing to get wrong here, so it is asserted by a test
> (`postgresStore.test.js`) and by a migration test.

### Indexes

```sql
CREATE INDEX idx_reports_location   ON reports   USING GIST (location);
CREATE INDEX idx_incidents_location ON incidents USING GIST (location);
CREATE INDEX idx_zones_location     ON zones     USING GIST (location);
CREATE INDEX idx_app_users_location ON app_users USING GIST (location);
```

### Queries the application actually issues

| Query | Where | SQL |
|---|---|---|
| Cluster candidates near a new report | `PostgresStore.findClusterCandidates` | `WHERE last_report_at >= $1 AND ST_DWithin(location::geography, ST_MakePoint($3, $2)::geography, $4)` |
| Which zone contains this report | `PostgresStore.findZoneForPoint` | `WHERE ST_DWithin(location::geography, ST_MakePoint($2, $1)::geography, radius_m) ORDER BY ST_Distance(...) LIMIT 1` |
| Reports within a radius | `PostgresStore.reportsWithinRadius` | `ST_DWithin`, ordered by `ST_Distance` |
| Citizens inside a radius | `PostgresStore.usersNearEvent` | `ST_DWithin`, returning **ids only**; the caller aggregates |
| Centroid + affected area of an incident | `PostgresStore.incidentSpatialSummary` | `ST_Centroid(ST_Collect(location))`, `ST_Area(ST_ConvexHull(ST_Collect(location))::geography)` |

Distance is measured on `geography`, so the units are metres on the ellipsoid
rather than degrees on a plane — no manual great-circle arithmetic in JavaScript.

### Graceful degradation

On connect, `PostgresStore.init()` asks the database two questions:

```sql
SELECT COUNT(*) FROM pg_extension WHERE extname = 'postgis';
SELECT COUNT(*) FROM information_schema.columns
 WHERE table_name = 'incidents' AND column_name = 'location';
```

The answers are cached in `store.spatial`. Every spatial path checks that flag
first, so on a PostgreSQL without PostGIS the application falls back to the
latitude/longitude arithmetic in `domain/geo.js` and stays correct, only slower.
That is also why `0002` is marked optional — a role without `CREATE EXTENSION`
rights must not block installation.

---

## Engine mapping (PostgreSQL ↔ MySQL)

The two engines store the same domain in their own idiom. This is the mapping the
repository layer absorbs, so no service sees a difference.

| Concept | PostgreSQL | MySQL |
|---|---|---|
| auto-increment key | `BIGSERIAL` | `BIGINT UNSIGNED AUTO_INCREMENT` |
| timestamp | `TIMESTAMPTZ` | `DATETIME` |
| JSON | `JSONB` | `JSON` |
| enumerated values | `VARCHAR` + `CHECK (… IN …)` | `ENUM(…)` |
| boolean | native `BOOLEAN` | `BOOLEAN` (tinyint) |
| case-insensitive search | `ILIKE` | `LIKE` on a `utf8mb4_unicode_ci` column |
| upsert | `ON CONFLICT (k) DO UPDATE` | `ON DUPLICATE KEY UPDATE` |
| placeholders | `$1 … $n` | `?` |
| unique violation | SQLSTATE `23505` | `ER_DUP_ENTRY` |
| point | `geometry(Point,4326)` + GIST | `DECIMAL` lat/lon + a bounding-box index |

### Why PostgreSQL + PostGIS is authoritative

The MySQL schema keeps `latitude`/`longitude` and can only narrow a radius query
with a bounding box before the exact great-circle check runs in JavaScript. With
PostGIS the same question is answered by one indexed `ST_DWithin` on geography,
and coverage and centroid are computed by the database from the real point set.
When both are available, PostgreSQL is chosen.

### Keeping the two engines honest

`npm run audit:store` compares the public surface of the storage adapters, so the
MySQL path cannot silently drift behind the in-memory and PostgreSQL ones. The
PostgreSQL adapter also translates `23505 → ER_DUP_ENTRY` (and `23503`, `23514`)
so the services' existing `catch (error.code === "ER_DUP_ENTRY")` branches keep
working unchanged.

---

## Repository layer

`server/store/` is the only place that knows SQL. Everything else talks to one
interface, implemented by three engines:

```
store/
├── index.js            the factory: chooses an engine, exposes one interface
├── postgresStore.js    PostgreSQL + PostGIS   (authoritative)
├── mysqlStore.js       MySQL                  (compatible)
├── memoryStore.js      in-memory              (tests, offline demo)
├── pgQuery.js          pg builders / row normalisation / error mapping
├── pgPool.js           pg connection pool
└── normalize.js        row-shape helpers shared by the engines
```

Splitting the PostgreSQL concerns across four small modules is deliberate:
`pgQuery.js` holds the parameter-numbering and row-shape logic worth testing on
its own (and is tested with no server at all), `pgPool.js` lets the migration
runner build a pool without importing the store factory back — which would be
circular, since the factory bootstraps migrations — and `postgresStore.js` stays
a readable list of queries.

Adding an engine means implementing the same methods and registering it in the
factory. Nothing in `services/`, `routes/` or `domain/` changes. That is the
MySQL (and any future engine) compatibility guarantee, made structural rather
than aspirational.

---

## Migration strategy

Numbered, idempotent SQL files, applied in filename order and recorded in
`schema_migrations` with a content checksum:

```
0001_init.sql               required    baseline schema
0002_postgis.optional.sql   optional    spatial columns + GIST indexes
```

* Every statement is `IF NOT EXISTS` / idempotent, so a re-run changes nothing.
* Each file is applied **inside one transaction**: a failed migration rolls back
  completely rather than leaving a half-built schema.
* A `.optional.sql` file that fails is recorded as skipped and the run continues
  — that is how the PostGIS layer degrades on a locked-down database.
* If a file changes after it was applied, the runner reports the checksum drift
  and re-applies it (safe, because the statements are idempotent).
* `npm run migrate:list` shows applied vs pending without touching anything.

---

## Seed data, performance and privacy

### Seed

`npm run seed` writes the simulated dataset in a single transaction, so a failure
leaves the database exactly as it was. It reuses the same incident and report
fixtures as the in-memory store (`store/seedIncidents.js`, `store/seedReports.js`),
so the demo is identical whichever engine is attached. Because it writes
historical timestamps the live API would never accept, it uses SQL directly — this
is a database script, exactly like the migrations beside it.

### Keeping it fast

* **Indexes on the real query paths.** `(status, updated_at DESC)` for the console
  queue, `(last_report_at DESC, latitude, longitude)` for the clustering window,
  `(created_at DESC)` for report listing, `(user_id, is_read)` for the inbox.
* **GIST indexes** on every point column, so a radius query is an index scan.
* **Spatial pre-filtering.** `findClusterCandidates` narrows to the radius in the
  database before the authoritative time-window and haversine check runs on the
  much smaller candidate set.
* **Bounded reads.** Every list method has a `LIMIT` (500 incidents and reports,
  200 work orders, 60 notifications, 100 announcements), and `listReports`
  returns a `total` alongside a page of rows.
* **Aggregation in the service, not per row.** Analytics is computed once per
  request from a bounded row set, so the numbers are identical on every engine and
  are directly unit testable.

### Privacy in the schema

* `latitude`/`longitude` are stored at full precision but only ever **served**
  rounded (`LOCATION_PRECISION_DP`), and only the public endpoints round them.
* `incident_confirmations.reporter_key` is a hash, so the table cannot be reversed
  into a list of who said what.
* `app_users.location` is optional and empty by default; the proximity query
  returns a count, not a list of people.
* Password columns are read by `findUser` only, which is called from the
  authentication path alone.