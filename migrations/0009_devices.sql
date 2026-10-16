-- Screens linked to the vault with a device code (RFC 8628 style), through the public gateway.
--
-- A screen asks for a code, I approve its user_code on /link, and the screen swaps its
-- device_code for a token once. Only SHA-256 hashes of the device code and the token are kept.
-- A row with a token is a linked screen; revoking it deletes the row.
CREATE TABLE devices (
  id INTEGER PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,            -- XXXX-XXXX, what I type in to approve
  device_code_hash TEXT NOT NULL UNIQUE,     -- SHA-256 hex of the code the screen polls with
  token_hash TEXT UNIQUE,                    -- SHA-256 hex of the screen's token; NULL until it is minted
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,                  -- when the code stops working, not the token
  approved_at TEXT
);
