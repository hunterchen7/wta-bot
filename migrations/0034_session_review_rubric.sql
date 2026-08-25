CREATE TABLE session_reviews (
  session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL REFERENCES participants(id),
  completion_rating INTEGER CHECK (completion_rating BETWEEN 1 AND 4),
  communication_rating INTEGER CHECK (communication_rating BETWEEN 1 AND 4),
  problem_solving_rating INTEGER CHECK (problem_solving_rating BETWEEN 1 AND 4),
  implementation_rating INTEGER CHECK (implementation_rating BETWEEN 1 AND 4),
  testing_rating INTEGER CHECK (testing_rating BETWEEN 1 AND 4),
  recording_quality INTEGER CHECK (recording_quality BETWEEN 1 AND 4),
  notes TEXT NOT NULL DEFAULT '',
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_session_reviews_reviewer ON session_reviews(reviewer_id, updated_at DESC);
