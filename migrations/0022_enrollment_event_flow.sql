ALTER TABLE enrollment_events ADD COLUMN flow TEXT NOT NULL DEFAULT 'enrollment'
  CHECK (flow IN ('enrollment', 'profile_edit'));
