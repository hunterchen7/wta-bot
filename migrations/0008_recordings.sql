CREATE TABLE recording_assets (
  id INTEGER PRIMARY KEY,
  form_instance_id INTEGER NOT NULL REFERENCES form_instances(id),
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  object_key TEXT NOT NULL UNIQUE,
  upload_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'aborted', 'failed')),
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  original_bytes INTEGER NOT NULL,
  stored_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX idx_recording_assets_form ON recording_assets(form_instance_id, status);
CREATE INDEX idx_recording_assets_session ON recording_assets(session_id, status);
