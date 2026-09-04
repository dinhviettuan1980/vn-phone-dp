-- Personal call log entries -- manually reported by the phone owner (from
-- Recents screenshots, since iOS has no API for a third-party app to read
-- call history). Deliberately NOT part of the raw_documents/phone_observations
-- provenance chain: this is the user's own personal usage data, not public
-- evidence about a phone number found on a webpage. See README.md "Tính năng
-- tổng kết cuộc gọi cá nhân" for the product rationale.

CREATE TABLE personal_call_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_raw         TEXT NOT NULL,
  phone_normalized  TEXT,
  call_date         DATE NOT NULL,
  call_count        INTEGER NOT NULL DEFAULT 1,
  notes             TEXT,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX personal_call_logs_phone_idx ON personal_call_logs(phone_normalized);
CREATE INDEX personal_call_logs_date_idx ON personal_call_logs(call_date);
