ALTER TABLE outbox ADD COLUMN dismissed_at TEXT;

CREATE INDEX idx_outbox_actionable
  ON outbox(dismissed_at, done_at, attempts, run_after);
