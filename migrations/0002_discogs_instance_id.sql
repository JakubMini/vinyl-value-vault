-- Which item in the owner's Discogs collection a record was imported from.
-- A collection can hold two copies of the same release; each has its own instance id.
-- Unique, so re-running the import never duplicates a record.
ALTER TABLE records ADD COLUMN discogs_instance_id INTEGER;
CREATE UNIQUE INDEX records_discogs_instance_id ON records (discogs_instance_id) WHERE discogs_instance_id IS NOT NULL;
