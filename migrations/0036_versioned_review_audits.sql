-- Keep transcription jobs and their historical evaluation pointers unchanged.
-- A batch freezes the exact job inventory; only a verified batch can be selected.
CREATE TABLE review_audit_batches (
  id TEXT PRIMARY KEY,
  cohort_id INTEGER NOT NULL REFERENCES cohorts(id),
  round INTEGER NOT NULL CHECK (round = 3),
  rubric_version TEXT NOT NULL,
  input_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  evaluator_model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  service_tier TEXT NOT NULL CHECK (service_tier = 'default'),
  job_ids_json TEXT NOT NULL CHECK (json_valid(job_ids_json) AND json_type(job_ids_json) = 'array' AND json_array_length(job_ids_json) > 0),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'verified')),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  activated_at TEXT,
  CHECK (is_active = 0 OR status = 'verified')
);
CREATE UNIQUE INDEX idx_review_audit_active ON review_audit_batches(cohort_id, round) WHERE is_active = 1;

CREATE TABLE review_evaluation_runs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES review_audit_batches(id),
  job_id INTEGER NOT NULL REFERENCES review_analysis_jobs(id),
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  input_sha256 TEXT NOT NULL CHECK (length(input_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'reviewing', 'verifying', 'ready', 'failed')),
  primary_object_key TEXT,
  verification_object_key TEXT,
  evaluation_object_key TEXT,
  transcript_object_key TEXT,
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  candidate_score REAL CHECK (candidate_score BETWEEN 0 AND 100),
  candidate_raw_score REAL CHECK (candidate_raw_score BETWEEN 0 AND 100),
  technical_score REAL CHECK (technical_score BETWEEN 0 AND 100),
  requires_manual_review INTEGER CHECK (requires_manual_review IN (0, 1)),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE (batch_id, job_id, attempt),
  CHECK (status != 'ready' OR (primary_object_key IS NOT NULL AND verification_object_key IS NOT NULL AND evaluation_object_key IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX idx_review_evaluation_batch ON review_evaluation_runs(batch_id, session_id, attempt DESC);

CREATE TRIGGER review_audit_membership_frozen BEFORE UPDATE OF id, cohort_id, round, rubric_version, input_version, prompt_version, evaluator_model, reasoning_effort, service_tier, job_ids_json ON review_audit_batches
BEGIN SELECT RAISE(ABORT, 'Audit batch configuration and membership are immutable'); END;

CREATE TRIGGER review_run_membership BEFORE INSERT ON review_evaluation_runs
WHEN NOT EXISTS (
  SELECT 1 FROM review_audit_batches b
  JOIN json_each(b.job_ids_json) member ON member.value = NEW.job_id
  JOIN review_analysis_jobs j ON j.id = NEW.job_id AND j.session_id = NEW.session_id
  JOIN sessions s ON s.id = j.session_id
  JOIN weeks w ON w.id = s.week_id AND w.cohort_id = b.cohort_id AND w.idx = b.round
  WHERE b.id = NEW.batch_id AND b.status = 'running'
)
BEGIN SELECT RAISE(ABORT, 'Run is outside the frozen batch or batch is sealed'); END;

CREATE TRIGGER review_run_identity_frozen BEFORE UPDATE OF id, batch_id, job_id, session_id, attempt, input_sha256 ON review_evaluation_runs
BEGIN SELECT RAISE(ABORT, 'Evaluation run identity is immutable'); END;

CREATE TRIGGER review_run_completed_immutable BEFORE UPDATE ON review_evaluation_runs
WHEN OLD.status IN ('ready', 'failed')
BEGIN SELECT RAISE(ABORT, 'Completed evaluation runs are immutable; create a new attempt'); END;

CREATE TRIGGER review_run_retained BEFORE DELETE ON review_evaluation_runs
BEGIN SELECT RAISE(ABORT, 'Evaluation history must be retained'); END;

CREATE TRIGGER review_batch_verify_complete BEFORE UPDATE OF status ON review_audit_batches
WHEN NEW.status = 'verified' AND EXISTS (
  SELECT 1 FROM json_each(NEW.job_ids_json) member
  WHERE NOT EXISTS (
    SELECT 1 FROM review_evaluation_runs r WHERE r.batch_id = NEW.id AND r.job_id = member.value AND r.status = 'ready'
      AND r.attempt = (SELECT max(latest.attempt) FROM review_evaluation_runs latest WHERE latest.batch_id = NEW.id AND latest.job_id = r.job_id)
  )
)
BEGIN SELECT RAISE(ABORT, 'Every batch member needs a completed verified evaluation'); END;

CREATE TRIGGER review_batch_sealed BEFORE UPDATE OF status ON review_audit_batches
WHEN OLD.status = 'verified' AND NEW.status != 'verified'
BEGIN SELECT RAISE(ABORT, 'Verified batches remain sealed; create another batch'); END;

CREATE TRIGGER review_batch_initial_state BEFORE INSERT ON review_audit_batches
WHEN NEW.status != 'running' OR NEW.is_active != 0 OR NEW.verified_at IS NOT NULL OR NEW.activated_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'New audit batches must start running and inactive'); END;

CREATE TRIGGER review_batch_valid_inventory BEFORE INSERT ON review_audit_batches
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.job_ids_json) member
  WHERE member.type != 'integer' OR NOT EXISTS (
    SELECT 1 FROM review_analysis_jobs j JOIN sessions s ON s.id = j.session_id
    JOIN weeks w ON w.id = s.week_id
    WHERE j.id = member.value AND w.cohort_id = NEW.cohort_id AND w.idx = NEW.round
  )
) OR (SELECT count(*) FROM json_each(NEW.job_ids_json)) != (SELECT count(DISTINCT value) FROM json_each(NEW.job_ids_json))
BEGIN SELECT RAISE(ABORT, 'Batch inventory must contain unique jobs from the specified cohort and round'); END;

CREATE TRIGGER review_batch_retained BEFORE DELETE ON review_audit_batches
BEGIN SELECT RAISE(ABORT, 'Audit batch history must be retained'); END;
