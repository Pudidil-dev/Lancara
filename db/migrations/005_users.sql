-- Akun login sederhana (halaman Login/Register Figma). Setiap akun terhubung ke satu aktor koordinator pada event demo.
-- Aktor operasional (PIC) lain tetap tidak punya akun dan tidak bisa login. Password disimpan sebagai hash scrypt.

CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username       text NOT NULL CHECK (length(username) BETWEEN 1 AND 80),
  password_hash  text NOT NULL,
  actor_id       text NOT NULL UNIQUE REFERENCES actors(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON users FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON users FROM authenticated;
  END IF;
END
$$;
