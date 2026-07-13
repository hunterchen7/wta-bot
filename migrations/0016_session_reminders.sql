ALTER TABLE sessions ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE sessions ADD COLUMN forms_released_at TEXT;

CREATE INDEX idx_sessions_upcoming_reminders
  ON sessions(state, reminder_sent_at, scheduled_at);

CREATE INDEX idx_sessions_form_release
  ON sessions(state, forms_released_at, scheduled_at);
