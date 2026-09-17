-- Small global key-value settings table -- single-user personal deployment
-- (see 0007_label_suppressions.sql), so one row per setting is enough, no
-- per-account scoping. First use: an opt-in toggle for auto-blocking
-- (not just labeling) numbers with enough SCAM reports -- see
-- services/appSettings.ts and services/callDirectoryExport.ts.

CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES ('auto_block_high_risk', 'false'::jsonb);
