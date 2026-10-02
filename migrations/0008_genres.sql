-- Discogs' genres and styles for the pressing, as JSON arrays of strings ('["Rock","Pop"]').
-- Discogs owns them: set when a record is created from a release, refreshed by every sync,
-- never edited by hand. Nothing to backfill from here: the next collection sync fills them in
-- for every record it finds on Discogs. Records added by hand stay NULL, which the API reads
-- as an empty list.
ALTER TABLE records ADD COLUMN genres TEXT;
ALTER TABLE records ADD COLUMN styles TEXT;
