CREATE TABLE enrollment_events (
  id INTEGER PRIMARY KEY,
  discord_id TEXT NOT NULL,
  discord_username TEXT,
  guild_id TEXT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('link_generated', 'form_opened', 'enrollment_completed')),
  source TEXT NOT NULL
    CHECK (source IN ('join_button', 'join_command', 'web')),
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_enrollment_events_person
  ON enrollment_events(discord_id, created_at DESC);

CREATE INDEX idx_enrollment_events_type
  ON enrollment_events(event_type, created_at DESC);

CREATE UNIQUE INDEX idx_enrollment_events_interaction
  ON enrollment_events(event_type, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX idx_enrollment_events_completed_once
  ON enrollment_events(discord_id)
  WHERE event_type = 'enrollment_completed';
