-- WTA bot schema v1 — see DESIGN.md §9

CREATE TABLE participants (
  id INTEGER PRIMARY KEY,
  discord_id TEXT NOT NULL UNIQUE,
  name TEXT,
  preferred_email TEXT,
  western_email TEXT,
  year TEXT,
  program TEXT,
  opportunities TEXT,
  prior_wta INTEGER NOT NULL DEFAULT 0,
  experience_band TEXT,
  topics TEXT, -- JSON array
  blurb TEXT,
  email_ok INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'held', 'removed', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cohorts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT,
  weeks_count INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'done'))
);

CREATE TABLE weeks (
  id INTEGER PRIMARY KEY,
  cohort_id INTEGER NOT NULL REFERENCES cohorts(id),
  idx INTEGER NOT NULL,
  optin_opens_at TEXT,
  optin_closes_at TEXT,
  match_at TEXT,
  reports_due_at TEXT,
  grace_until TEXT,
  UNIQUE (cohort_id, idx)
);

CREATE TABLE optins (
  id INTEGER PRIMARY KEY,
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  standby INTEGER NOT NULL DEFAULT 0,
  wants_double INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (week_id, participant_id)
);

CREATE TABLE problems (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'leetcode',
  number INTEGER,
  title TEXT NOT NULL,
  url TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  difficulty_rank REAL, -- finer grading, e.g. 2.7 = harder medium (week rule: W1 easy, W2 medium, W3 harder-med/easier-hard)
  statement_md TEXT,
  solution_md TEXT,
  hints_md TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  interviewer_id INTEGER NOT NULL REFERENCES participants(id),
  interviewee_id INTEGER NOT NULL REFERENCES participants(id),
  thread_id TEXT,
  state TEXT NOT NULL DEFAULT 'pending_schedule'
    CHECK (state IN ('pending_schedule', 'scheduled', 'completed', 'broken', 'cancelled')),
  scheduled_at TEXT,
  problem_id INTEGER REFERENCES problems(id),
  origin TEXT NOT NULL DEFAULT 'match' CHECK (origin IN ('match', 'repair', 'manual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (interviewer_id <> interviewee_id)
);
CREATE INDEX idx_sessions_week ON sessions(week_id);
CREATE INDEX idx_sessions_people ON sessions(interviewer_id, interviewee_id);

CREATE TABLE form_instances (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL, -- 'interviewee_report' | 'interviewer_report' | future kinds
  session_id INTEGER REFERENCES sessions(id),
  assignee_id INTEGER NOT NULL REFERENCES participants(id),
  token_hash TEXT NOT NULL UNIQUE,
  deadline_at TEXT,
  submitted_at TEXT,
  payload TEXT, -- JSON of submitted answers
  reminder_state TEXT NOT NULL DEFAULT 'issued'
    CHECK (reminder_state IN ('issued', 'nudged', 'overdue')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_form_instances_assignee ON form_instances(assignee_id, submitted_at);

CREATE TABLE incidents (
  id INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  accused_id INTEGER REFERENCES participants(id),
  reporter_id INTEGER REFERENCES participants(id),
  kind TEXT NOT NULL CHECK (kind IN ('ghost', 'unresponsive', 'late_cancel', 'issue')),
  state TEXT NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'confirmed', 'excused', 'resolved')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE repair_queue (
  id INTEGER PRIMARY KEY,
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  need TEXT NOT NULL CHECK (need IN ('interviewer', 'interviewee')),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'matched', 'expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE week_problem_sets (
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  problem_id INTEGER NOT NULL REFERENCES problems(id),
  PRIMARY KEY (week_id, problem_id)
);

CREATE TABLE exposures (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  problem_id INTEGER NOT NULL REFERENCES problems(id),
  role TEXT NOT NULL CHECK (role IN ('interviewer', 'interviewee')),
  session_id INTEGER REFERENCES sessions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_exposures_participant ON exposures(participant_id, problem_id);

CREATE TABLE notify_log (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER REFERENCES participants(id),
  channel TEXT NOT NULL CHECK (channel IN ('dm', 'email', 'thread', 'channel')),
  kind TEXT NOT NULL,
  ref TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Idempotency ledger for the cron tick (DESIGN.md §10)
CREATE TABLE job_runs (
  id INTEGER PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  ran_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
