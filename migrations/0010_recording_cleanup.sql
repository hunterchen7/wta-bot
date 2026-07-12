ALTER TABLE recording_assets ADD COLUMN cleanup_started_at TEXT;

CREATE INDEX idx_recording_assets_cleanup
  ON recording_assets(status, cleanup_started_at, completed_at);
