CREATE TABLE review_analysis_jobs (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  recording_asset_id INTEGER NOT NULL REFERENCES recording_assets(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'transcribing', 'evaluating', 'ready', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  lease_expires_at TEXT,
  transcript_object_key TEXT,
  captions_object_key TEXT,
  evaluation_object_key TEXT,
  transcription_model TEXT,
  diarization_model TEXT,
  evaluator_model TEXT,
  rubric_version TEXT NOT NULL DEFAULT 'round3-review-v1',
  transcript_confidence REAL,
  speaker_confidence REAL,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  transcribed_at TEXT,
  evaluated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (recording_asset_id)
);

CREATE INDEX idx_review_analysis_claim
  ON review_analysis_jobs(status, lease_expires_at, created_at);
CREATE INDEX idx_review_analysis_session
  ON review_analysis_jobs(session_id, created_at DESC);

-- Pick up recordings that were submitted before this pipeline was deployed.
INSERT INTO review_analysis_jobs (session_id, recording_asset_id)
SELECT ra.session_id, ra.id
FROM recording_assets ra
JOIN sessions s ON s.id = ra.session_id
JOIN weeks w ON w.id = s.week_id
WHERE ra.status = 'uploaded'
  AND ra.cleanup_started_at IS NULL
  AND w.idx = 3
  AND s.review_state != 'none'
  AND NOT EXISTS (
    SELECT 1 FROM review_analysis_jobs existing
    WHERE existing.recording_asset_id = ra.id
  );
