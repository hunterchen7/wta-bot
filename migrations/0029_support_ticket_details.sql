ALTER TABLE support_threads ADD COLUMN title TEXT;
ALTER TABLE support_threads ADD COLUMN issue TEXT;
ALTER TABLE support_threads ADD COLUMN closed_at TEXT;

CREATE UNIQUE INDEX idx_support_threads_one_active
  ON support_threads(discord_id)
  WHERE status IN ('pending', 'open');
