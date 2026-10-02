-- Vinyl Value Vault: initial schema.
-- Money is stored in minor units (pence) as integers. Times are ISO-8601 UTC strings.

-- One row per physical record in the collection.
CREATE TABLE records (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  discogs_release_id    INTEGER,                      -- the pressing on Discogs; needed for automatic valuation
  artist                TEXT    NOT NULL,
  title                 TEXT    NOT NULL,
  label                 TEXT,
  catalogue_number      TEXT,
  year                  INTEGER,
  country               TEXT,
  format                TEXT,                         -- e.g. "LP, Album", "2xLP", "7\", Single"
  media_condition       TEXT    NOT NULL DEFAULT 'VG+',  -- Goldmine grade: M, NM, VG+, VG, G+, G, F, P
  sleeve_condition      TEXT    NOT NULL DEFAULT 'VG+',
  purchase_price_minor  INTEGER,                      -- what was paid, in minor units
  purchase_currency     TEXT,
  purchased_on          TEXT,                         -- YYYY-MM-DD
  notes                 TEXT,
  current_value_minor   INTEGER,                      -- denormalised from the latest valuation
  current_currency      TEXT,
  last_valued_at        TEXT,                         -- when the valuation job last looked at this record
  last_valuation_error  TEXT,                         -- why the last look produced no value, if it didn't
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX records_last_valued_at ON records (last_valued_at);
CREATE INDEX records_discogs_release_id ON records (discogs_release_id);

-- Append-only history of what each record was worth and when.
CREATE TABLE valuations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id             INTEGER NOT NULL REFERENCES records (id) ON DELETE CASCADE,
  valued_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source                TEXT    NOT NULL DEFAULT 'discogs',
  method                TEXT    NOT NULL,             -- 'price_suggestion' (for this record's grade) or 'lowest_listing'
  currency              TEXT    NOT NULL,
  value_minor           INTEGER NOT NULL,             -- the headline value
  lowest_listing_minor  INTEGER,                      -- cheapest copy for sale at the time, any grade
  num_for_sale          INTEGER,
  raw                   TEXT                          -- upstream payload, kept so values can be re-derived later
);

CREATE INDEX valuations_record_valued ON valuations (record_id, valued_at DESC);

-- The collection total after each valuation run, so the trend can be charted.
CREATE TABLE collection_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  currency      TEXT    NOT NULL,
  total_minor   INTEGER NOT NULL,
  record_count  INTEGER NOT NULL,
  valued_count  INTEGER NOT NULL
);

CREATE INDEX collection_snapshots_taken_at ON collection_snapshots (taken_at DESC);
