-- Every time a record goes on the stand: a screen reads the NFC tag in its sleeve and logs a play.
-- Kept raw, one row per play, so a yearly "wrapped" can count them any way it likes later.
CREATE TABLE plays (
  id INTEGER PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES records (id) ON DELETE CASCADE,
  played_at TEXT NOT NULL,                   -- when the tag was read, by the screen's clock (UTC)
  tag_uid TEXT,                              -- the tag that was read, if any
  device_id INTEGER,                         -- the screen that logged it; NULL from a script
  UNIQUE (record_id, played_at)              -- a screen resending a batch doesn't count twice
);
CREATE INDEX plays_played_at ON plays (played_at);
