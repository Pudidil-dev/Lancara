-- Impor rundown dari PDF (alur Figma "Tambah Rundown": Pilih cara → Unggah PDF → Tinjau & lengkapi → Aktifkan).
-- Berkas tidak disimpan; hanya hash, metadata, dan draft baris hasil ekstraksi (AI atau aturan) yang ditinjau koordinator.
-- Draft boleh diedit selama status 'draft'. Aktivasi membuat versi rundown baru lewat jalur setup yang sama.

CREATE TABLE IF NOT EXISTS rundown_imports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  actor_id         text NOT NULL REFERENCES actors(id),
  filename         text NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  kind             text NOT NULL CHECK (kind IN ('pdf')),
  sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes       integer NOT NULL CHECK (size_bytes > 0),
  page_count       integer NOT NULL CHECK (page_count > 0),
  pages_read       text,
  row_count        integer NOT NULL CHECK (row_count >= 0),
  parser           text NOT NULL CHECK (parser IN ('rule', 'ai')),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'discarded')),
  settings         jsonb NOT NULL,
  draft            jsonb NOT NULL,
  applied_version  integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'applied') = (applied_version IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS rundown_imports_event_idx ON rundown_imports (event_id, created_at DESC);

-- Sama seperti 002: RLS aktif tanpa policy, akses Data API Supabase dicabut.
ALTER TABLE rundown_imports ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON rundown_imports FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON rundown_imports FROM authenticated;
  END IF;
END
$$;
