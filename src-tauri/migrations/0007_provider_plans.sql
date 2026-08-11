-- Threshold at which a provider-reported allowance is considered low enough to warn about.
--
-- The allowance itself is not stored: it is read live from the provider (see `quota.rs`), because
-- every provider defines its own unit and its own reset window. A locally entered limit combined
-- with locally counted tokens could only ever be a guess, and a wrong guess here blocks the user
-- from switching models.
ALTER TABLE model_profiles ADD COLUMN plan_alert_threshold INTEGER NOT NULL DEFAULT 80;
