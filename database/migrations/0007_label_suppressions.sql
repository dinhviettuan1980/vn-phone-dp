-- User-configured "don't label this number" list -- Truecaller-style: only
-- numbers with a known identity or enough spam reports get a label/warning
-- on the native call screen (unknown numbers stay completely silent, no
-- popup, by construction of the CallKit Call Directory Extension: it can
-- only label numbers present in its data set, see
-- services/callDirectoryExport.ts). This table lets the phone's owner
-- additionally silence a KNOWN number they don't want announced (e.g. a
-- bank they don't want flagged every time, or a false-positive spam label)
-- without deleting the underlying identity/report data.
--
-- Single-user personal deployment (this whole platform serves one phone
-- owner via their own iPhone, not a multi-tenant product -- see
-- docs/architecture.md), so this is one global list, not scoped per account.

CREATE TABLE label_suppressions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_normalized  TEXT NOT NULL UNIQUE,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
