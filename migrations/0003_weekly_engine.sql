-- Weekly engine + web auth support

-- Per-side completion credit (your side counts when YOUR report is in)
ALTER TABLE sessions ADD COLUMN interviewer_credited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN interviewee_credited INTEGER NOT NULL DEFAULT 0;

-- W3 recording review state (organizer verify/flag; M6/M7)
ALTER TABLE sessions ADD COLUMN review_state TEXT NOT NULL DEFAULT 'none'
  CHECK (review_state IN ('none', 'pending', 'verified', 'flagged'));

-- Durable side-effect queue: Discord/email sends are enqueued and drained by
-- the cron with a per-tick subrequest budget (Workers limits), with retries.
CREATE TABLE outbox (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL, -- JSON
  run_after TEXT NOT NULL DEFAULT (datetime('now')),
  attempts INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_outbox_pending ON outbox(done_at, run_after);

-- Email OTP login codes for the web dashboard
CREATE TABLE login_codes (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_codes_participant ON login_codes(participant_id, expires_at);
