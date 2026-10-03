-- PowerWatch Cameroon — PostGIS spatial layer (migration 0002, OPTIONAL)
--
-- The filename ends in `.optional.sql`, which tells the migration runner to
-- skip this file with a warning when PostGIS cannot be installed (a managed
-- PostgreSQL without the extension, or a role without CREATE EXTENSION rights).
-- The application keeps working in that case: the store detects the missing
-- geometry columns and falls back to latitude/longitude arithmetic.
--
-- `location` is a GENERATED column, so it can never drift from latitude and
-- longitude and no insert/update statement has to remember to maintain it.
-- ST_MakePoint(x, y) takes longitude first.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Reports: one point per citizen report. This is the table the clustering
-- engine and the coverage queries read.
-- ---------------------------------------------------------------------------
ALTER TABLE reports ADD COLUMN IF NOT EXISTS location geometry(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_report_location ON reports USING GIST (location);

-- ---------------------------------------------------------------------------
-- Incidents: the cluster centre. Indexed so "which events are near this point"
-- is answered by the database rather than by scanning every open incident.
-- ---------------------------------------------------------------------------
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS location geometry(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_incident_location ON incidents USING GIST (location);

-- ---------------------------------------------------------------------------
-- Zones: containment is the natural operation ("is this report inside the
-- operational area of a zone?").
-- ---------------------------------------------------------------------------
ALTER TABLE zones ADD COLUMN IF NOT EXISTS location geometry(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_zone_location ON zones USING GIST (location);

-- ---------------------------------------------------------------------------
-- Citizen accounts gain an optional home location, as the project's USER entity
-- specifies. It stays NULL until a citizen chooses to share one, and it is only
-- ever read as an aggregate (how many neighbours are affected), never exposed as
-- a list of positions.
-- ---------------------------------------------------------------------------
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS latitude     NUMERIC(10, 7);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS longitude    NUMERIC(10, 7);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(180);

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS location geometry(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_app_users_location ON app_users USING GIST (location);