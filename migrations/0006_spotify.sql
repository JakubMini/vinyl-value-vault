-- The Spotify album a record is pinned to, as its 22-character id. Set by hand from the
-- dashboard (pasting the album's link); the vault never calls Spotify's API. A sync never
-- touches it.
ALTER TABLE records ADD COLUMN spotify_album_id TEXT;
