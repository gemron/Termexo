-- One task board document per workspace. Keep the document intact so new task fields
-- can round-trip through older database versions without a column migration.
CREATE TABLE IF NOT EXISTS todo_snapshots (
    workspace_id TEXT PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
