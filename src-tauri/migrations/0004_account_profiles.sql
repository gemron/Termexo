CREATE TABLE IF NOT EXISTS account_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent_type TEXT NOT NULL CHECK (agent_type IN ('claude', 'codex')),
    config_dir TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_profiles_agent
    ON account_profiles(agent_type, is_default DESC, name);

INSERT OR IGNORE INTO account_profiles (
    id, name, agent_type, config_dir, is_default, is_system, created_at, updated_at
) VALUES (
    'claude-system', '系统 Claude 账号', 'claude', NULL, 1, 1,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
);

INSERT OR IGNORE INTO account_profiles (
    id, name, agent_type, config_dir, is_default, is_system, created_at, updated_at
) VALUES (
    'codex-system', '系统 ChatGPT 账号', 'codex', NULL, 1, 1,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
);
