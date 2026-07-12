ALTER TABLE participants ADD COLUMN discord_username TEXT;

CREATE INDEX IF NOT EXISTS idx_participants_discord_username
  ON participants(discord_username);
