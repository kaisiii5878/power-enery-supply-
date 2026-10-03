-- PowerWatch Cameroon — canonical schema (v2)
--
-- Fresh installs: run this file end to end (the server does it automatically
-- when DB_BOOTSTRAP is not "false"). Statements are idempotent so an existing
-- v1 database can be upgraded in place — see the upgrade block at the bottom.
-- Requires MySQL 8 or MariaDB 10.2+.

CREATE DATABASE IF NOT EXISTS eneo_outage CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE eneo_outage;

-- Accounts. `socadel` is the utility operator role that validates incidents and
-- manages the platform; `subcontractor` crews only ever see their own work.
CREATE TABLE IF NOT EXISTS app_users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(40) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  user_role ENUM('client','subcontractor','socadel') NOT NULL,
  password_salt CHAR(32) NOT NULL,
  password_hash CHAR(128) NOT NULL,
  email VARCHAR(160) NULL,
  phone VARCHAR(40) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app_users_role_name (user_role, full_name),
  INDEX idx_app_users_active (is_active)
) ENGINE=InnoDB;

show tables;


-- Operational zones group incidents and scope what each operator manages.
CREATE TABLE IF NOT EXISTS zones (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  region VARCHAR(80) NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  radius_m INT UNSIGNED NOT NULL DEFAULT 5000,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_zone_region (region)
) ENGINE=InnoDB;

-- Incidents are clusters of citizen reports. Everything derived (centroid,
-- radius, counts, severity) is recomputed by the domain layer, never trusted
-- from client input.
CREATE TABLE IF NOT EXISTS incidents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(40) NOT NULL UNIQUE,
  title VARCHAR(180) NOT NULL,
  district VARCHAR(180) NOT NULL,
  zone_id BIGINT UNSIGNED NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  radius_m INT UNSIGNED NOT NULL DEFAULT 500,
  estimated_area_m2 BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reports_count INT UNSIGNED NOT NULL DEFAULT 0,
  severity_score DECIMAL(6,2) NOT NULL DEFAULT 0,
  severity ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
  status ENUM('pending','pending_validation','validated','assigned','on_the_way','under_intervention','completed','verification_pending','closed','rejected') NOT NULL DEFAULT 'pending',
  assignee VARCHAR(140) NULL,
  root_cause VARCHAR(180) NULL,
  resolution TEXT NULL,
  agency_report TEXT NULL,
  rejection_reason VARCHAR(500) NULL,
  first_report_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_report_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  validated_by VARCHAR(140) NULL,
  validated_at DATETIME NULL,
  completed_at DATETIME NULL,
  restored_at DATETIME NULL,
  closed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_incident_zone FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL,
  INDEX idx_incident_status_updated (status, updated_at),
  INDEX idx_incident_cluster (last_report_at, latitude, longitude),
  INDEX idx_incident_zone (zone_id)
) ENGINE=InnoDB;

-- Citizen reports: the raw signal. `status` tracks the report itself, which is
-- distinct from the status of the incident it belongs to.
CREATE TABLE IF NOT EXISTS reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  incident_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  reporter_name VARCHAR(120) NOT NULL,
  phone VARCHAR(40) NULL,
  category VARCHAR(80) NOT NULL,
  description TEXT NULL,
  district VARCHAR(180) NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  status ENUM('clustered','attached','duplicate','reviewed') NOT NULL DEFAULT 'clustered',
  severity ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
  photo_url VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL,
  CONSTRAINT fk_report_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  INDEX idx_report_incident (incident_id),
  INDEX idx_report_created (created_at),
  INDEX idx_report_user (user_id)
) ENGINE=InnoDB;

-- Incident chat. Every message is tied to an authenticated author, so the
-- conversation can never be posted to anonymously.
CREATE TABLE IF NOT EXISTS incident_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  incident_id BIGINT UNSIGNED NOT NULL,
  author_user_id BIGINT UNSIGNED NULL,
  author_role ENUM('client','subcontractor','socadel') NOT NULL,
  author_name VARCHAR(120) NOT NULL,
  body VARCHAR(2000) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_message_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  CONSTRAINT fk_message_author FOREIGN KEY (author_user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  INDEX idx_message_incident_created (incident_id, created_at)
) ENGINE=InnoDB;

-- Two-way citizen verification: "I am affected too" and "power is back".
-- `reporter_key` is an anonymous per-device hash so unregistered citizens can
-- still confirm exactly once per incident and type.
CREATE TABLE IF NOT EXISTS incident_confirmations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  incident_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  reporter_key CHAR(64) NOT NULL,
  confirmation_type ENUM('also_affected','restored') NOT NULL DEFAULT 'also_affected',
  comment VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_confirmation_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  CONSTRAINT fk_confirmation_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_confirmation_per_user (incident_id, reporter_key, confirmation_type),
  INDEX idx_confirmation_incident_type (incident_id, confirmation_type)
) ENGINE=InnoDB;

-- Field work orders handed to subcontractors and their status timeline.
CREATE TABLE IF NOT EXISTS work_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  incident_id BIGINT UNSIGNED NOT NULL,
  contractor VARCHAR(140) NOT NULL,
  assigned_by VARCHAR(140) NOT NULL,
  status ENUM('assigned','departed','on_site','completed','verified','cancelled') NOT NULL DEFAULT 'assigned',
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  departed_at DATETIME NULL,
  arrival_time DATETIME NULL,
  completion_time DATETIME NULL,
  root_cause VARCHAR(180) NULL,
  diagnosis TEXT NULL,
  equipment VARCHAR(255) NULL,
  replaced_components VARCHAR(255) NULL,
  technical_comments TEXT NULL,
  photo_url VARCHAR(500) NULL,
  CONSTRAINT fk_work_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  INDEX idx_work_contractor_status (contractor, status),
  INDEX idx_work_incident (incident_id)
) ENGINE=InnoDB;

-- In-app notifications for operators and citizens. `agency` targets a role
-- queue (socadel / subcontractor), `user_id` targets one account.
CREATE TABLE IF NOT EXISTS agency_notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  agency ENUM('socadel','subcontractor','client') NULL,
  incident_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(60) NOT NULL,
  title VARCHAR(160) NULL,
  message VARCHAR(500) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  INDEX idx_notification_user (user_id, is_read),
  INDEX idx_notification_agency (agency, is_read)
) ENGINE=InnoDB;

-- Tunable rules. Clustering thresholds live here so operators can retune the
-- detection heuristic without a deploy.
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES
  ('cluster_distance_m', '500'),
  ('cluster_window_minutes', '30'),
  ('min_reports_to_qualify', '1');

-- Append-only trail of every privileged action.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor VARCHAR(140) NOT NULL,
  action VARCHAR(80) NOT NULL,
  incident_id BIGINT UNSIGNED NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_incident (incident_id, created_at),
  INDEX idx_audit_actor (actor, created_at)
) ENGINE=InnoDB;

-- Public service announcements shown on the citizen map.
CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  audience ENUM('all','client','subcontractor') NOT NULL DEFAULT 'all',
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_by VARCHAR(140) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_announcement_published (published, created_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Upgrade path from the v1 schema. Safe to re-run on MariaDB 10.2+ / MySQL 8
-- (unknown-column errors are simply raised per statement and can be ignored).
-- ---------------------------------------------------------------------------
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email VARCHAR(160) NULL AFTER password_hash;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone VARCHAR(40) NULL AFTER email;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER phone;
ALTER TABLE app_users MODIFY COLUMN user_role ENUM('client','subcontractor','socadel') NOT NULL;

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS zone_id BIGINT UNSIGNED NULL AFTER district;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500) NULL AFTER agency_report;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL AFTER validated_at;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS restored_at DATETIME NULL AFTER completed_at;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS severity_score DECIMAL(6,2) NOT NULL DEFAULT 0 AFTER reports_count;
ALTER TABLE incidents MODIFY COLUMN status ENUM('pending','pending_validation','validated','assigned','on_the_way','under_intervention','completed','verification_pending','closed','rejected') NOT NULL DEFAULT 'pending';

ALTER TABLE reports ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL AFTER incident_id;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS photo_url VARCHAR(500) NULL AFTER severity;

ALTER TABLE incident_messages ADD COLUMN IF NOT EXISTS author_user_id BIGINT UNSIGNED NULL AFTER incident_id;

ALTER TABLE incident_confirmations ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL AFTER incident_id;

ALTER TABLE agency_notifications ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE agency_notifications ADD COLUMN IF NOT EXISTS title VARCHAR(160) NULL AFTER event_type;
ALTER TABLE agency_notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE AFTER message;


