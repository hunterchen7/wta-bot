-- Consequential organizer actions taken from the web dashboard.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  actor_participant_id INTEGER REFERENCES participants(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_target ON audit_log(target_type, target_id);
