CREATE TABLE admin_api_tokens (
  id INTEGER PRIMARY KEY,
  actor_participant_id INTEGER NOT NULL REFERENCES participants(id),
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'general',
  token_hash TEXT NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_admin_api_tokens_actor
  ON admin_api_tokens(actor_participant_id, revoked_at, created_at);

CREATE INDEX idx_admin_api_tokens_purpose
  ON admin_api_tokens(actor_participant_id, purpose, revoked_at, created_at);
