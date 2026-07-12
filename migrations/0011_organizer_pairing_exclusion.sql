-- Organizers may enroll for dashboard access, but never belong to the matching pool.
ALTER TABLE participants ADD COLUMN pairing_excluded INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_participants_matching
  ON participants(status, pairing_excluded);
