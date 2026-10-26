ALTER TABLE account_profiles ADD COLUMN login_method TEXT NOT NULL DEFAULT 'browser'
    CHECK (login_method IN ('browser', 'console', 'sso', 'device-code'));
