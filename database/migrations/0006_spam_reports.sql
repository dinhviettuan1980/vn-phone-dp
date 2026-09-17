-- Crowdsourced spam/scam reports -- any user can report a phone number that
-- called them, independent of whether that number already has a crawled
-- identity. Deliberately NOT part of the raw_documents/phone_observations
-- provenance chain, same reasoning as personal_call_logs (0002): this is
-- user-submitted personal usage data (someone reporting a call they
-- received), not public evidence found on a webpage. See README.md /
-- docs/architecture.md "Spam reporting" for the product rationale.
--
-- reporter_ref is an OPTIONAL opaque client-supplied string (e.g. a
-- per-install UUID the app generates and stores locally) used only to count
-- DISTINCT reporters for a number instead of raw row count, so one person
-- mashing "report" repeatedly can't inflate a number's risk level. It is
-- never a real identity -- no accounts exist in this system.

CREATE TYPE spam_report_category AS ENUM (
  'SPAM', 'SCAM', 'TELEMARKETING', 'HARASSMENT', 'OTHER'
);

CREATE TABLE spam_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_raw         TEXT NOT NULL,
  phone_normalized  TEXT,
  category          spam_report_category NOT NULL DEFAULT 'SPAM',
  note              TEXT,
  reporter_ref      TEXT,
  reported_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX spam_reports_phone_idx ON spam_reports(phone_normalized);
CREATE INDEX spam_reports_reported_at_idx ON spam_reports(reported_at);
