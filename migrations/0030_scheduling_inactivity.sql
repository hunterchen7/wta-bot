ALTER TABLE sessions ADD COLUMN activity_nudged_at TEXT;
ALTER TABLE sessions ADD COLUMN activity_checked_at TEXT;

CREATE INDEX idx_sessions_scheduling_activity
  ON sessions(state, activity_nudged_at, activity_checked_at, created_at);

-- A participant removed for scheduling inactivity cannot immediately opt back
-- into the same round. This is round-scoped and does not affect program status.
CREATE TABLE round_exclusions (
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (week_id, participant_id)
);

CREATE INDEX idx_round_exclusions_participant
  ON round_exclusions(participant_id, week_id);
