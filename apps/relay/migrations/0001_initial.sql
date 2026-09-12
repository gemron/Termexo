-- Every migration runs unconditionally on each start, exactly like the desktop database, so every
-- statement here has to be safe to re-apply. There is no version table and no rollback.

CREATE TABLE IF NOT EXISTS relay_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id),
  secret_hash TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_seen_at INTEGER,
  last_ip TEXT,
  last_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_owner ON devices(owner_user_id);

CREATE TABLE IF NOT EXISTS enrollment_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  owner_user_id TEXT,
  created_by TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by_device_id TEXT,
  -- Not in the original design sketch: cancelling a code has to be distinguishable from letting it
  -- expire, otherwise the console cannot tell an administrator why a code stopped working.
  cancelled_at INTEGER
);

CREATE TABLE IF NOT EXISTS console_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_console_sessions_user ON console_sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  ip TEXT,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_events_at ON audit_events(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_id);
