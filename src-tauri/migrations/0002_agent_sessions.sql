CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    agent_type TEXT NOT NULL,
    native_session_id TEXT NOT NULL,
    project_path TEXT,
    model_name TEXT,
    title TEXT NOT NULL,
    summary TEXT,
    branch TEXT,
    status TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    transcript_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    UNIQUE(agent_type, native_session_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_last_used
    ON agent_sessions(last_used_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_project
    ON agent_sessions(project_path);

CREATE TABLE IF NOT EXISTS model_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    base_url TEXT,
    credential_target TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key TEXT NOT NULL UNIQUE,
    agent_type TEXT NOT NULL,
    native_session_id TEXT,
    terminal_id TEXT,
    event_type TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_events_session
    ON agent_events(agent_type, native_session_id, created_at DESC);
