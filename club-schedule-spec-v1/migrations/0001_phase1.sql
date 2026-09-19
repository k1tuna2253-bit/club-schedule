PRAGMA foreign_keys = ON;

CREATE TABLE campuses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
INSERT INTO campuses (id, name) VALUES ('omiya', '大宮'), ('hirakata', '枚方');

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade >= 1),
  registration_year INTEGER NOT NULL CHECK (registration_year BETWEEN 1900 AND 2200),
  primary_campus_id TEXT NOT NULL REFERENCES campuses(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'deleted')),
  terms_version_accepted TEXT,
  terms_accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((terms_version_accepted IS NULL) = (terms_accepted_at IS NULL))
);
CREATE INDEX users_campus_status_idx ON users(primary_campus_id, status);

CREATE TABLE club_positions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE user_club_positions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id TEXT NOT NULL REFERENCES club_positions(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, position_id)
);
CREATE INDEX user_club_positions_position_idx ON user_club_positions(position_id, user_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX sessions_user_active_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE login_attempts (
  identifier_hash TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE permissions (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL
);
CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX role_permissions_permission_idx ON role_permissions(permission_key, role_id);
CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON user_roles(role_id, user_id);

CREATE TABLE terms_versions (
  version TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  requires_reconsent INTEGER NOT NULL CHECK (requires_reconsent IN (0, 1)),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX one_current_terms_idx ON terms_versions(is_current) WHERE is_current = 1;

INSERT INTO permissions (key, description) VALUES
('SCHEDULE_VIEW', 'View schedules'),
('SCHEDULE_CREATE_SELF', 'Create own schedules'),
('SCHEDULE_EDIT_SELF', 'Edit own schedules'),
('SCHEDULE_DELETE_SELF', 'Delete own schedules'),
('SCHEDULE_CREATE_OTHERS', 'Create schedules for others'),
('SCHEDULE_EDIT_OTHERS', 'Edit schedules for others'),
('SCHEDULE_DELETE_OTHERS', 'Delete schedules for others'),
('EVENT_VIEW', 'View events'),
('EVENT_CREATE', 'Create events'),
('EVENT_EDIT', 'Edit events'),
('EVENT_DELETE', 'Delete events'),
('EVENT_RESPONSE_MANAGE', 'Manage event responses'),
('EVENT_COMMENT_VIEW', 'View event response comments'),
('USER_MANAGE', 'Manage users'),
('USER_PASSWORD_RESET', 'Reset user passwords'),
('LOCATION_MANAGE', 'Manage locations'),
('CALENDAR_MANAGE', 'Manage calendar'),
('RESTRICTION_MANAGE', 'Manage restrictions'),
('ROLE_MANAGE', 'Manage roles'),
('ANALYTICS_VIEW', 'View aggregate analytics'),
('SEARCH_USE', 'Search'),
('AUDIT_LOG_VIEW', 'View audit log'),
('NOTIFICATION_MANAGE', 'Manage notifications'),
('BACKUP_RESTORE', 'Restore backups');
