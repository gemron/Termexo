CREATE TABLE IF NOT EXISTS prompt_assets (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    terminal_id TEXT,
    terminal_name TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('draft', 'history')),
    content TEXT NOT NULL,
    redacted INTEGER NOT NULL DEFAULT 0,
    favorite INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS prompt_assets_terminal_draft
    ON prompt_assets(workspace_id, terminal_id, kind)
    WHERE kind = 'draft' AND terminal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS prompt_assets_workspace_order
    ON prompt_assets(workspace_id, pinned DESC, favorite DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS handoff_packages (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    source_terminal_id TEXT,
    title TEXT NOT NULL,
    package_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS handoff_packages_workspace_order
    ON handoff_packages(workspace_id, updated_at DESC);
