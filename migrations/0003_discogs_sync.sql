-- Syncing the Discogs collection from inside the Worker.

-- Cover art and when the item joined the Discogs collection, refreshed by every sync.
ALTER TABLE records ADD COLUMN cover_image_url TEXT;
ALTER TABLE records ADD COLUMN thumb_url TEXT;
ALTER TABLE records ADD COLUMN discogs_added_at TEXT;

-- Set when a sync no longer finds the item in the Discogs collection (sold, given away).
-- The record keeps its history but leaves the collection total and the valuation queue.
-- Cleared again if the item comes back.
ALTER TABLE records ADD COLUMN discogs_removed_at TEXT;

-- One row per sync, for the dashboard's log and to decide when the next automatic one is due.
CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  source TEXT NOT NULL,                       -- 'cron' or 'api'
  dry_run INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',     -- 'running', 'ok', 'partial' or 'failed'
  items_seen INTEGER NOT NULL DEFAULT 0,      -- vinyl items found on Discogs
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  skipped_not_vinyl INTEGER NOT NULL DEFAULT 0,
  skipped_ignored INTEGER NOT NULL DEFAULT 0,
  note TEXT                                   -- why it stopped early, failed, or skipped removals
);

CREATE INDEX sync_runs_started_at ON sync_runs (started_at DESC);

-- Collection items deliberately deleted from the vault. A sync never brings them back.
CREATE TABLE sync_ignored (
  discogs_instance_id INTEGER PRIMARY KEY,
  ignored_at TEXT NOT NULL
);
