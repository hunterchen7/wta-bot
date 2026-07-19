-- Consolidated inbox: capture DMs students send to the bot by polling their DM
-- channels from the cron (a webhook bot can't receive DM events, but DMs are
-- exempt from the Message Content intent, so REST fetches return full content).

-- Per-participant DM channel bookkeeping (channel id captured when the bot DMs
-- them; last_seen advances past every fetched message; last_polled rotates work).
ALTER TABLE participants ADD COLUMN dm_channel_id TEXT;
ALTER TABLE participants ADD COLUMN dm_last_seen_id TEXT;
ALTER TABLE participants ADD COLUMN dm_last_polled_at TEXT;

CREATE TABLE inbox_messages (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  discord_message_id TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,               -- Discord message timestamp
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);
CREATE INDEX idx_inbox_unread ON inbox_messages(read_at, id DESC);

-- Round-robin cursor for polling: least-recently-polled channels first.
CREATE INDEX idx_participants_dm_poll ON participants(dm_last_polled_at)
  WHERE dm_channel_id IS NOT NULL;
