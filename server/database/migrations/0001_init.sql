-- PowerWatch Cameroon — PostgreSQL baseline schema (migration 0001)
--
-- Functional equivalent of `server/schema.sql` (the MySQL schema) expressed in
-- PostgreSQL. The column names, value vocabularies and relationships are held
-- identical on purpose: the storage adapters must be interchangeable, so no
-- service can tell which engine is underneath.
--
-- MySQL ENUM columns become VARCHAR + CHECK constraints here, which is the same
-- guarantee without a bespoke type per column.
--
-- Every statement is idempotent, so re-running the migration set is safe.

-- ---------------------------------------------------------------------------
-- Accounts. `socadel` is the utility operator role that validates incidents and
-- manages the platform; `subcontractor` crews only ever see their own work.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_users (
  id             BIGSERIAL PRIMARY KEY,
  username       VARCHAR(40)  NOT NULL UNIQUE,
  full_name      VARCHAR(120) NOT NULL,
  user_role      VARCHAR(20)  NOT NULL CHECK (user_role IN ('client', 'subcontractor', 'socadel')),
  password_salt  CHAR(32)     NOT NULL,
  password_hash  CHAR(128)    NOT NULL,
  email          VARCHAR(160),
  phone          VARCHAR(40),
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_users_role_name ON app_users (user_role, full_name);
CREATE INDEX IF NOT EXISTS idx_app_users_active    ON app_users (is_active);

-- ---------------------------------------------------------------------------
-- Operational zones group incidents and scope what each operator manages.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zones (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL UNIQUE,
  description VARCHAR(255),
  region      VARCHAR(80),
  latitude    NUMERIC(10, 7) NOT NULL,
  longitude   NUMERIC(10, 7) NOT NULL,
  radius_m    INTEGER       NOT NULL DEFAULT 5000 CHECK (radius_m > 0),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zone_region ON zones (region);

-- ---------------------------------------------------------------------------
-- Incidents are clusters of citizen reports. Everything derived (centroid,
-- radius, counts, severity) is recomputed by the domain layer, never trusted
-- from client input.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
  id                  BIGSERIAL PRIMARY KEY,
  reference           VARCHAR(40)  NOT NULL UNIQUE,
  title               VARCHAR(180) NOT NULL,
  district            VARCHAR(180) NOT NULL,
  zone_id             BIGINT       REFERENCES zones (id) ON DELETE SET NULL,
  latitude            NUMERIC(10, 7) NOT NULL,
  longitude           NUMERIC(10, 7) NOT NULL,
  radius_m            INTEGER       NOT NULL DEFAULT 500,
  estimated_area_m2   BIGINT        NOT NULL DEFAULT 0,
  reports_count       INTEGER       NOT NULL DEFAULT 0,
  severity_score      NUMERIC(6, 2) NOT NULL DEFAULT 0,
  severity            VARCHAR(10)   NOT NULL DEFAULT 'low'
                        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status              VARCHAR(30)   NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'pending_validation', 'validated', 'assigned',
                                          'on_the_way', 'under_intervention', 'completed',
                                          'verification_pending', 'closed', 'rejected')),
  assignee            VARCHAR(140),
  root_cause          VARCHAR(180),
  resolution          TEXT,
  agency_report       TEXT,
  rejection_reason    VARCHAR(500),
  first_report_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_report_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  validated_by        VARCHAR(140),
  validated_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  restored_at         TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_status_updated ON incidents (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_cluster        ON incidents (last_report_at DESC, latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_incident_zone           ON incidents (zone_id);

-- ---------------------------------------------------------------------------
-- Citizen reports: the raw signal. `status` tracks the report itself, which is
-- distinct from the status of the incident it belongs to.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id            BIGSERIAL PRIMARY KEY,
  incident_id   BIGINT REFERENCES incidents (id) ON DELETE SET NULL,
  user_id       BIGINT REFERENCES app_users (id) ON DELETE SET NULL,
  reporter_name VARCHAR(120) NOT NULL,
  phone         VARCHAR(40),
  category      VARCHAR(80)  NOT NULL,
  description   TEXT,
  district      VARCHAR(180) NOT NULL,
  latitude      NUMERIC(10, 7) NOT NULL,
  longitude     NUMERIC(10, 7) NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'clustered'
                  CHECK (status IN ('clustered', 'attached', 'duplicate', 'reviewed')),
  severity      VARCHAR(10)  NOT NULL DEFAULT 'low'
                  CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  photo_url     VARCHAR(500),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_incident ON reports (incident_id);
CREATE INDEX IF NOT EXISTS idx_report_created  ON reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_user     ON reports (user_id);

-- ---------------------------------------------------------------------------
-- Incident chat. Every message is tied to an authenticated author, so the
-- conversation can never be posted to anonymously.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incident_messages (
  id             BIGSERIAL PRIMARY KEY,
  incident_id    BIGINT        NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  author_user_id BIGINT        REFERENCES app_users (id) ON DELETE SET NULL,
  author_role    VARCHAR(20)   NOT NULL CHECK (author_role IN ('client', 'subcontractor', 'socadel')),
  author_name    VARCHAR(120)  NOT NULL,
  body           VARCHAR(2000) NOT NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_incident_created ON incident_messages (incident_id, created_at);

-- ---------------------------------------------------------------------------
-- Two-way citizen verification: "I am affected too" and "power is back".
-- `reporter_key` is an anonymous per-device hash so unregistered citizens can
-- still confirm exactly once per incident and type.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incident_confirmations (
  id                BIGSERIAL PRIMARY KEY,
  incident_id       BIGINT      NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  user_id           BIGINT      REFERENCES app_users (id) ON DELETE SET NULL,
  reporter_key      CHAR(64)    NOT NULL,
  confirmation_type VARCHAR(20) NOT NULL DEFAULT 'also_affected'
                      CHECK (confirmation_type IN ('also_affected', 'restored')),
  comment           VARCHAR(500),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_confirmation_per_user UNIQUE (incident_id, reporter_key, confirmation_type)
);

CREATE INDEX IF NOT EXISTS idx_confirmation_incident_type ON incident_confirmations (incident_id, confirmation_type);

-- ---------------------------------------------------------------------------
-- Field work orders handed to subcontractors and their status timeline.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_requests (
  id                  BIGSERIAL PRIMARY KEY,
  incident_id         BIGINT       NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  contractor          VARCHAR(140) NOT NULL,
  assigned_by         VARCHAR(140) NOT NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'assigned'
                        CHECK (status IN ('assigned', 'departed', 'on_site', 'completed', 'verified', 'cancelled')),
  assigned_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  departed_at         TIMESTAMPTZ,
  arrival_time        TIMESTAMPTZ,
  completion_time     TIMESTAMPTZ,
  root_cause          VARCHAR(180),
  diagnosis           TEXT,
  equipment           VARCHAR(255),
  replaced_components VARCHAR(255),
  technical_comments  TEXT,
  photo_url           VARCHAR(500)
);

CREATE INDEX IF NOT EXISTS idx_work_contractor_status ON work_requests (contractor, status);
CREATE INDEX IF NOT EXISTS idx_work_incident          ON work_requests (incident_id);

-- ---------------------------------------------------------------------------
-- In-app notifications for operators and citizens. `agency` targets a role
-- queue (socadel / subcontractor / client), `user_id` targets one account.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agency_notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES app_users (id) ON DELETE CASCADE,
  agency      VARCHAR(20) CHECK (agency IN ('socadel', 'subcontractor', 'client')),
  incident_id BIGINT REFERENCES incidents (id) ON DELETE CASCADE,
  event_type  VARCHAR(60)  NOT NULL,
  title       VARCHAR(160),
  message     VARCHAR(500) NOT NULL,
  is_read     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_user   ON agency_notifications (user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notification_agency ON agency_notifications (agency, is_read);

-- ---------------------------------------------------------------------------
-- Tunable rules. Clustering thresholds live here so operators can retune the
-- detection heuristic without a deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key   VARCHAR(80) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('cluster_distance_m', '500'),
  ('cluster_window_minutes', '30'),
  ('min_reports_to_qualify', '1')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Append-only trail of every privileged action.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor       VARCHAR(140) NOT NULL,
  action      VARCHAR(80)  NOT NULL,
  incident_id BIGINT REFERENCES incidents (id) ON DELETE SET NULL,
  details     JSONB,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_incident ON audit_log (incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor    ON audit_log (actor, created_at DESC);

-- ---------------------------------------------------------------------------
-- Public service announcements shown on the citizen map.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id         BIGSERIAL PRIMARY KEY,
  title      VARCHAR(180) NOT NULL,
  body       TEXT         NOT NULL,
  audience   VARCHAR(20)  NOT NULL DEFAULT 'all'
               CHECK (audience IN ('all', 'client', 'subcontractor')),
  published  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by VARCHAR(140) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcement_published ON announcements (published, created_at DESC);