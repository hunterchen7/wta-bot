-- Standby availability is role-specific and may cover more than one repair.
-- Assignment slots make each capacity claim atomic while preserving a durable
-- audit trail of which extra session consumed which slot.
ALTER TABLE optins ADD COLUMN standby_interviewer_limit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE optins ADD COLUMN standby_interviewee_limit INTEGER NOT NULL DEFAULT 0;

-- Preserve the old one-extra preference as one available slot in each role.
-- Participants can refine this the next time they open the standby modal.
UPDATE optins
SET standby_interviewer_limit = 1,
    standby_interviewee_limit = 1
WHERE standby = 1;

CREATE TABLE standby_assignment_slots (
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  role TEXT NOT NULL CHECK (role IN ('interviewer', 'interviewee')),
  slot INTEGER NOT NULL CHECK (slot > 0),
  session_id INTEGER REFERENCES sessions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (week_id, participant_id, role, slot)
);

INSERT INTO standby_assignment_slots (week_id, participant_id, role, slot, session_id, created_at)
SELECT sa.week_id,
       sa.participant_id,
       CASE
         WHEN s.interviewee_id = sa.participant_id THEN 'interviewee'
         ELSE 'interviewer'
       END,
       1,
       sa.session_id,
       sa.created_at
FROM standby_assignments sa
LEFT JOIN sessions s ON s.id = sa.session_id;

DROP TABLE standby_assignments;
ALTER TABLE standby_assignment_slots RENAME TO standby_assignments;

CREATE INDEX idx_standby_assignments_session
  ON standby_assignments(session_id);
