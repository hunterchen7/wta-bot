ALTER TABLE sessions ADD COLUMN packet_sent_at TEXT;

-- Existing assignments may already have produced packets under the old flow.
-- Mark them delivered so deployment cannot resend historical packets.
UPDATE sessions SET packet_sent_at = created_at WHERE problem_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_packet_delivery
  ON sessions(state, packet_sent_at, scheduled_at);
