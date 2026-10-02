-- The collection total once a day, for the overview's chart.
--
-- collection_snapshots gets a row after every valuation run that priced something: about one a
-- minute while a day's prices are being refreshed. Charting months of those would read tens of
-- thousands of rows on every page load, against D1's free daily read allowance. This table keeps
-- one row per UTC day, the last total of that day, and the job keeps it current.
CREATE TABLE collection_daily (
  day TEXT PRIMARY KEY,              -- YYYY-MM-DD, UTC
  taken_at TEXT NOT NULL,            -- the snapshot it came from
  currency TEXT NOT NULL,
  total_minor INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  valued_count INTEGER NOT NULL
);

-- Every day already snapshotted, from its last snapshot.
INSERT INTO collection_daily (day, taken_at, currency, total_minor, record_count, valued_count)
SELECT substr(s.taken_at, 1, 10), s.taken_at, s.currency, s.total_minor, s.record_count, s.valued_count
FROM collection_snapshots s
WHERE s.id IN (SELECT MAX(id) FROM collection_snapshots GROUP BY substr(taken_at, 1, 10));
