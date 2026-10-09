-- Tautan publik rundown (tombol "Bagikan" di Dashboard). Siapa pun yang memegang tautan dapat MELIHAT rundown aktif
-- tanpa login atau peran; tidak ada operasi tulis lewat tautan. Token acak 192-bit (base64url, 32 karakter).
-- Satu tautan aktif per acara; menonaktifkan tautan langsung memutus akses.

CREATE TABLE IF NOT EXISTS rundown_shares (
  token       text PRIMARY KEY CHECK (token ~ '^[A-Za-z0-9_-]{32}$'),
  event_id    text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by  text NOT NULL REFERENCES actors(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS rundown_shares_one_active ON rundown_shares (event_id) WHERE revoked_at IS NULL;

ALTER TABLE rundown_shares ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON rundown_shares FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON rundown_shares FROM authenticated;
  END IF;
END
$$;
