# LANCARA — prototipe demo (hackathon)

Live Event Recovery Engine: satu kabar perubahan → opsi jadwal yang lolos batas → persetujuan koordinator → brief ke kru terdampak → konfirmasi "Sudah dibaca" → riwayat keputusan.

> Data fiktif. Peran adalah **simulasi peran demo**, bukan autentikasi produksi.

## Status

| Bagian | Status |
|---|---|
| Skema DB + migration + seed 12 item | ✅ teruji (Postgres 17) |
| Engine deterministik (geser/tukar/pangkas, hard constraint, dampak per peran) | 🟡 17 tes fixture lulus; temuan integritas HIGH masih terbuka, release diblokir |
| Parser rule + gateway lokal OpenAI-compatible + Claude opsional | ✅ rule/gateway 20/20 benar dan 10/10 ambigu klarifikasi; Claude belum diuji live |
| API (21 endpoint) + transaksi approval + idempotensi + ack | ✅ 7 integration test + smoke HTTP |
| UI lima layar | ✅ login/rundown/setup/kabar/inbox/riwayat tersedia; 48 E2E rule dan 48 E2E model lokal lulus |
| Deploy Vercel + Supabase | ⛔ belum deploy; gate integritas diblokir sesuai keputusan pemilik |

## Jalankan lokal

```bash
npm install
cp .env.example .env.local        # isi SESSION_SECRET (≥32 karakter)
npm run db:local -- init          # atau: docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev
```

Tes: `npm run typecheck && npm run test:all && npm run build`.

### Model melalui API lokal

Adapter `openai-compatible` memakai Chat Completions, keluaran JSON terstruktur, dan validasi server. Simpan konfigurasi berikut di `.env.local` yang diabaikan Git; key hanya dipakai server.

```dotenv
AI_PROVIDER=openai-compatible
AI_MODEL=cx/gpt-6.1-sol
OPENAI_BASE_URL=http://localhost:20129/v1
OPENAI_API_KEY=<isi-key-lokal>
```

Mulai ulang server Next.js setelah mengganti env. Konfirmasi tafsiran tetap wajib; provider tidak menentukan batas/penerima dan tidak menyetujui jadwal. Timeout gateway total 12 detik termasuk satu retry sementara, di bawah timeout klien 15 detik. Jika gateway gagal, draft tetap dapat dilanjutkan melalui form manual. `npm run eval:parser` menguji rule dan provider lokal yang dikonfigurasi pada 30 kalimat berlabel.

Konteks AI dibangun dari snapshot rundown aktif milik event session di server: identitas acara/panggung, ID dan judul item, jadwal/status, serta waktu acuan. Prompt berisi batas cakupan dan item yang disebut dalam kabar; JSON schema membatasi ID ke item dalam rundown tersebut. Input lintas acara, penggantian konfigurasi/secret, perubahan setup/batas/PIC, approval, dan pengiriman brief tidak diproses sebagai tafsiran. Keluaran dengan field di luar kontrak ditolak; target item asing/berbeda meminta klarifikasi. Tidak ada tool atau akses file/dokumen lain dalam adapter AI.

## Deploy ke Vercel + Supabase Postgres

Aplikasi memakai koneksi Postgres langsung (transaksi + `SELECT … FOR UPDATE`), **bukan** Supabase REST/anon key.

Status verifikasi 9 Oktober 2026: `PROGRESS.md` melaporkan migration/seed Supabase sudah dijalankan oleh sesi lain, tetapi credential yang tersedia untuk OPS-01 saat pemeriksaan ulang masih menunjuk PostgreSQL lokal. Bukti remote belum diverifikasi independen. Akses Vercel, deployment, smoke publik, cold start, dan latensi belum tersedia/diuji. Bukti persiapan: `../docs/ripple/evidence/deploy.md`.

1. **Supabase** → Project → **Connect** → salin connection string **Transaction pooler** (port `6543`), contoh:
   `postgres://postgres.<project-ref>:<DB_PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require`
   Salin juga URL **Session pooler** (port `5432`) atau **Direct connection** untuk migration. Host harus berasal dari panel Connect; jangan menebak host dari region. `scripts/migrate.ts` memakai session advisory lock, sehingga migration memerlukan koneksi yang mempertahankan session; transaction pooler hanya dipakai runtime. Lihat [koneksi dan batas transaction mode Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres#transaction-mode-limitations).
2. **Vercel** → New Project → import repo ini (Root Directory = folder `ripple-app` bila repo berisi folder lain). Framework: Next.js. Build command dibaca dari `vercel.json`: migration memakai `DATABASE_URL_MIGRATIONS`, lalu `npm run build`; runtime tetap memakai `DATABASE_URL`. Region dikonfigurasi `sin1`. Pemilik repo melakukan commit dan menghubungkan Git secara manual; agent tidak commit/push.
3. **Environment Variables** (Production + Preview):

   | Nama | Nilai |
   |---|---|
   | `DATABASE_URL` | connection string pooler di atas |
   | `DATABASE_URL_MIGRATIONS` | URL Session pooler/Direct dengan `sslmode=require` (database yang sama) |
   | `SESSION_SECRET` | 64 karakter acak (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
   | `DEMO_MODE` | `true` |
   | `DEMO_CLOCK_ISO` | `2026-10-09T11:40:00Z` (jam simulasi 18.40 WIB) |
   | `AI_PROVIDER` | `rule` (atau `anthropic` + `ANTHROPIC_API_KEY`, `AI_MODEL`) |
   | `APP_BASE_URL` | `https://<nama-app>.vercel.app` |
   | `DB_POOL_MAX` | `2` |

   Set kedua lingkungan melalui [Vercel Environment Variables](https://vercel.com/docs/environment-variables). Semua credential server-side, tanpa prefix `NEXT_PUBLIC_`. Gunakan `APP_BASE_URL` sesuai domain lingkungan; same-origin preview juga diperiksa dari host request oleh server.
4. Dari laptop, verifikasi migration lalu seed **sekali** di Supabase sebelum deployment. Simpan URL asli dalam variabel environment proses atau file lokal yang di-gitignore. Untuk PowerShell, dengan `DATABASE_URL_MIGRATIONS` dan `DATABASE_URL_SUPABASE` sudah diisi secara privat:
   ```powershell
   $rippleOriginalDatabaseUrl = $env:DATABASE_URL
   try {
     $env:DATABASE_URL = $env:DATABASE_URL_MIGRATIONS
     npm run db:migrate
     if ($LASTEXITCODE -ne 0) { throw "Migration gagal; seed dibatalkan." }
     $env:DATABASE_URL = $env:DATABASE_URL_SUPABASE
     npm run db:seed
     if ($LASTEXITCODE -ne 0) { throw "Seed gagal." }
   } finally {
     $env:DATABASE_URL = $rippleOriginalDatabaseUrl
   }
   ```
   Seed tidak pernah otomatis dan tidak menghapus event yang sudah ada tanpa `--reset`.
5. Deploy melalui dashboard atau CLI yang sudah login (`npx vercel --prod`). Build berhenti bila `DATABASE_URL_MIGRATIONS` belum diisi; log yang diharapkan: `schema up to date (2 file)` untuk schema saat ini (`001_init.sql`, `002_rls.sql`). Advisory lock berlaku pada session migration, bukan connection transaction pooler.
6. Smoke publik: `/health/live` harus HTTP 200; `/health/ready` harus HTTP 200 dengan `status: "ready"`, `db: "ok"`, `seeded: true`. Login Rina → kabar "Talent B baru bisa mulai jam 20.05" → konfirmasi → 1 opsi tukar Panel/Talent B → approve → v2. Login Bayu → 1 brief ACTION → "Sudah dibaca" → reload tetap tercatat. POST `/api/session` dengan JSON tetapi tanpa header `Origin` harus 403.
7. Catat URL, tanggal WIB, SHA commit pemilik yang benar-benar terdeploy, Node/region/schema aktual, provider AI, output smoke, serta lima sampel respons rundown/approve di evidence deploy. Request pertama setelah instance idle dicatat terpisah; jangan mengklaim cold start hanya dari request biasa.
8. Reset sebelum presentasi: login koordinator → tombol reset demo. CLI `npm run db:reset` hanya setelah operator memastikan `DATABASE_URL` menunjuk database demo yang dimaksud.

Catatan TLS: `sslmode=require` → TLS aktif tanpa verifikasi CA (CA pooler tidak ada di trust store Node). Set `DB_SSL_REJECT_UNAUTHORIZED=true` bila CA sudah dipasang.

## Struktur & aturan

Lihat `AGENTS.md` (struktur, perintah, aturan untuk agent) dan `docs/API.md` (kontrak endpoint).
