-- Application-wide settings that are not tied to a workspace, a profile or an account.
--
-- Remote access is the first of them: a single JSON document per key keeps the table stable when
-- a feature grows a new option, which matters because migrations here run unconditionally on every
-- startup and there is no version table to branch on.
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
