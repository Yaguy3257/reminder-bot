CREATE TABLE IF NOT EXISTS reminders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id        INTEGER NOT NULL,
  text           TEXT    NOT NULL,
  event_at       INTEGER NOT NULL,                -- UTC milliseconds
  alerts         TEXT    NOT NULL DEFAULT '7,1',  -- days before the event, comma-separated
  notified_until INTEGER NOT NULL DEFAULT 0,
  next_at        INTEGER NOT NULL DEFAULT 0,      -- next time the cron should look at it
  shared         INTEGER NOT NULL DEFAULT 0       -- 1 = visible to every ALLOWED_IDS member
);
CREATE INDEX IF NOT EXISTS idx_reminders_chat   ON reminders(chat_id);
CREATE INDEX IF NOT EXISTS idx_reminders_next   ON reminders(next_at);
CREATE INDEX IF NOT EXISTS idx_reminders_shared ON reminders(shared);

-- per-chat dialog state (text being created / reminder being edited)
CREATE TABLE IF NOT EXISTS pending (
  chat_id INTEGER PRIMARY KEY,
  text    TEXT NOT NULL,
  edit_id INTEGER,
  mode    TEXT,
  shared  INTEGER NOT NULL DEFAULT 0
);
