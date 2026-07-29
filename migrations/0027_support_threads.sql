CREATE TABLE support_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  thread_id TEXT,
  visibility TEXT CHECK (visibility IN ('private', 'participant')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_support_threads_requester
  ON support_threads(discord_id, status, created_at DESC);
