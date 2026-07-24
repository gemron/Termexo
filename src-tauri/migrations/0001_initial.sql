CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project_path TEXT NOT NULL,
    project_type TEXT,
    git_repository TEXT,
    active_branch TEXT,
    layout_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_opened_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_workspaces_last_opened
    ON workspaces(last_opened_at DESC);
