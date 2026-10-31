-- NFC stickers in record sleeves. A screen reads a tag's UID and opens the record it points to.
-- A record may have several tags (a worn sticker is replaced, not moved); a tag points at one
-- record. Deleting the record deletes its tags.
CREATE TABLE nfc_tags (
  uid TEXT PRIMARY KEY,                      -- the tag's UID as upper-case hex, e.g. 04C67BA5892681
  record_id INTEGER NOT NULL REFERENCES records (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL                   -- when it was last assigned
);
CREATE INDEX nfc_tags_record_id ON nfc_tags (record_id);
