CREATE TABLE IF NOT EXISTS network_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('global', 'workspace')),
    workspace_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    http_proxy TEXT,
    https_proxy TEXT,
    all_proxy TEXT,
    no_proxy TEXT,
    npm_registry TEXT,
    npm_proxy TEXT,
    npm_https_proxy TEXT,
    npm_strict_ssl INTEGER NOT NULL DEFAULT 1,
    npm_ca_path TEXT,
    proxy_username TEXT,
    credential_target TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK(
        (scope = 'global' AND workspace_id IS NULL)
        OR (scope = 'workspace' AND workspace_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_network_profiles_scope
    ON network_profiles(scope, workspace_id, enabled, is_default);
