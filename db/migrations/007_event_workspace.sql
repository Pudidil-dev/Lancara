-- Pemilih event: akses tambahan per akun dan event aktif per sesi.
-- Event asal actors tetap menjadi akses bawaan (termasuk akun yang baru register).
CREATE TABLE event_members (
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, actor_id)
);
CREATE INDEX event_members_actor_idx ON event_members (actor_id);
ALTER TABLE event_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE demo_sessions ADD COLUMN selected_event_id text REFERENCES events(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON event_members FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON event_members FROM authenticated;
  END IF;
END
$$;
