-- Dashboard read paths grow with cohorts and participant history. These
-- indexes cover the non-leading foreign keys and correlated admin queries.
CREATE INDEX IF NOT EXISTS idx_sessions_interviewee ON sessions(interviewee_id);
CREATE INDEX IF NOT EXISTS idx_sessions_problem ON sessions(problem_id);
CREATE INDEX IF NOT EXISTS idx_form_instances_session_kind ON form_instances(session_id, kind, submitted_at);
CREATE INDEX IF NOT EXISTS idx_incidents_accused_state ON incidents(accused_id, state, kind);
CREATE INDEX IF NOT EXISTS idx_repair_queue_week_state ON repair_queue(week_id, state);
