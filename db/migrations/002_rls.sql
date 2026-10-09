-- Aktifkan Row Level Security pada seluruh tabel aplikasi.
-- Supabase mengekspos schema public lewat Data API (anon / authenticated). Tanpa RLS, siapa pun
-- yang memegang anon key bisa membaca/mengubah tabel. Tanpa policy, anon & authenticated tidak
-- mendapat baris sama sekali. Aplikasi terhubung langsung ke Postgres dengan role pemilik tabel
-- sehingga tidak terdampak; verifikasi lewat /health/ready setelah migrasi.

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE patches ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE parse_usage ENABLE ROW LEVEL SECURITY;

-- Cabut akses default untuk peran API Supabase (defensif; RLS saja sudah menutup akses).
-- Peran anon/authenticated hanya ada di Supabase; lewati bila tidak ada (Postgres lokal).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
  END IF;
END
$$;
