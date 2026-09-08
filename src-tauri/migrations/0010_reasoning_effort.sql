-- Reasoning depth and context window: both CLIs take these at launch and cannot change them after.
--
-- Claude Code selects the 1M-token window through a `[1m]` suffix on the model id rather than a
-- flag, so this column records the intent and the launch path appends the suffix. Codex takes its
-- level as a `-c model_reasoning_effort` override. An empty level leaves the CLI's own default
-- alone, which is why these default to empty rather than to a middle setting.
ALTER TABLE model_profiles ADD COLUMN claude_context_1m INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_profiles ADD COLUMN claude_effort TEXT NOT NULL DEFAULT '';
ALTER TABLE model_profiles ADD COLUMN codex_reasoning_effort TEXT NOT NULL DEFAULT '';
