-- Splits a model profile into a Claude side and a Codex side.
--
-- One provider serves both agents from different endpoints (DeepSeek answers Claude on
-- /anthropic and Codex on /v1), so a profile now carries a model and base URL for each, plus a
-- switch saying which agents may use it. The pre-split columns stay: model is NOT NULL with no
-- default, and there is no rollback path, so dropping them would strand any older build.
ALTER TABLE model_profiles ADD COLUMN claude_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE model_profiles ADD COLUMN claude_model TEXT NOT NULL DEFAULT '';
ALTER TABLE model_profiles ADD COLUMN claude_base_url TEXT;
ALTER TABLE model_profiles ADD COLUMN codex_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE model_profiles ADD COLUMN codex_model TEXT NOT NULL DEFAULT '';
ALTER TABLE model_profiles ADD COLUMN codex_base_url TEXT;
