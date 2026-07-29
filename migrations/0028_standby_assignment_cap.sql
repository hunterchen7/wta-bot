-- A standby opt-in means at most one extra session in a round. Keep the claim
-- separate from sessions so concurrent repair scans cannot reuse a volunteer.
CREATE TABLE standby_assignments (
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  session_id INTEGER REFERENCES sessions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (week_id, participant_id)
);

CREATE INDEX idx_standby_assignments_session
  ON standby_assignments(session_id);

-- Preserve the earliest existing re-pair as each current volunteer's one
-- standby assignment. Later existing sessions are left untouched, but the
-- volunteer cannot be selected again.
INSERT OR IGNORE INTO standby_assignments (week_id, participant_id, session_id)
SELECT
  o.week_id,
  o.participant_id,
  min(s.id)
FROM optins o
JOIN sessions s
  ON s.week_id = o.week_id
 AND s.origin = 'repair'
 AND s.state != 'cancelled'
 AND (s.interviewer_id = o.participant_id OR s.interviewee_id = o.participant_id)
WHERE o.standby = 1
GROUP BY o.week_id, o.participant_id;
