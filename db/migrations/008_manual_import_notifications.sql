-- Figma "Siapkan Data" (isi manual) dan halaman "Notifikasi".
-- 1) Isian manual memakai alur draft → tinjau → aktifkan yang sama dengan impor PDF.
ALTER TABLE rundown_imports DROP CONSTRAINT IF EXISTS rundown_imports_kind_check;
ALTER TABLE rundown_imports ADD CONSTRAINT rundown_imports_kind_check CHECK (kind IN ('pdf', 'manual'));
ALTER TABLE rundown_imports DROP CONSTRAINT IF EXISTS rundown_imports_parser_check;
ALTER TABLE rundown_imports ADD CONSTRAINT rundown_imports_parser_check CHECK (parser IN ('rule', 'ai', 'manual'));

-- 2) Status baca notifikasi per aktor: satu baris per kunci; "Tandai semua dibaca" menulis semua kunci feed.
--    Feed sendiri diturunkan dari tabel yang ada (changes, decisions, acknowledgements, versions, event_members, users).
CREATE TABLE IF NOT EXISTS notification_reads (
  event_id          text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  actor_id          text NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  notification_key  text NOT NULL CHECK (length(notification_key) BETWEEN 3 AND 120),
  read_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, actor_id, notification_key)
);

ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON notification_reads FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON notification_reads FROM authenticated;
  END IF;
END
$$;
