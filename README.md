# LANCARA — prototipe demo (hackathon)

Live Event Recovery Engine: satu kabar perubahan → opsi jadwal yang lolos batas → persetujuan koordinator → brief ke kru terdampak → konfirmasi "Sudah dibaca" → riwayat keputusan.

> Data fiktif. Satu akun utama mendapat akses penuh koordinator. Perubahan AI Agent disimpan setelah konfirmasi.

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

`npm run dev` menjalankan migrasi yang belum diterapkan sebelum membuka server (melalui `predev`). Jika migrasi gagal, server tidak dimulai. Migrasi tidak menjalankan seed/reset dan tidak mengganti rundown aktif. Setelah mengambil perubahan kode, hentikan server development lama lalu jalankan kembali perintah ini agar kode dan skema database sesuai. Jalankan hanya satu server development per folder build; gunakan `NEXT_DIST_DIR` berbeda untuk server QA terpisah.

Jika log menampilkan `relation "notification_reads" does not exist`, database runtime belum mendapat migrasi `008_manual_import_notifications.sql`. Jalankan `npm run db:migrate` dengan konfigurasi database yang sama seperti server, kemudian muat ulang halaman Notifikasi. Jangan menjalankan `db:reset` untuk memperbaiki skema.

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
5. Deploy melalui dashboard atau CLI yang sudah login (`npx vercel --prod`). Build berhenti bila `DATABASE_URL_MIGRATIONS` belum diisi; log yang diharapkan: `schema up to date (6 file)` untuk schema saat ini (`001_init.sql` sampai `006_telegram_notifier.sql`). Advisory lock berlaku pada session migration, bukan connection transaction pooler.
6. Smoke publik: `/health/live` harus HTTP 200; `/health/ready` harus HTTP 200 dengan `status: "ready"`, `db: "ok"`, `seeded: true`. Login Rina → kabar "Talent B baru bisa mulai jam 20.05" → konfirmasi → 1 opsi tukar Panel/Talent B → approve → v2. Login Bayu → 1 brief ACTION → "Sudah dibaca" → reload tetap tercatat. POST `/api/session` dengan JSON tetapi tanpa header `Origin` harus 403.
7. Catat URL, tanggal WIB, SHA commit pemilik yang benar-benar terdeploy, Node/region/schema aktual, provider AI, output smoke, serta lima sampel respons rundown/approve di evidence deploy. Request pertama setelah instance idle dicatat terpisah; jangan mengklaim cold start hanya dari request biasa.
8. Reset sebelum presentasi: login koordinator → tombol reset demo. CLI `npm run db:reset` hanya setelah operator memastikan `DATABASE_URL` menunjuk database demo yang dimaksud.

Catatan TLS: `sslmode=require` → TLS aktif tanpa verifikasi CA (CA pooler tidak ada di trust store Node). Set `DB_SSL_REJECT_UNAUTHORIZED=true` bila CA sudah dipasang.

## Struktur & aturan

Lihat `AGENTS.md` (struktur, perintah, aturan untuk agent) dan `docs/API.md` (kontrak endpoint).

## Komponen UI dan penanganan error

Gunakan `Button`, `Input`, `Textarea`, `NativeSelect`, `NativeSelectOption`, `Label` dan `Dialog` dari `@/components/ui`. Komponen memakai pola shadcn/ui (Slot/CVA, Radix Dialog, Sonner) dengan token Figma dalam `src/app/ui-components.css`; styling tetap CSS biasa. Tombol utama memakai gradasi ungu dan radius 16px. Pilih `variant="outline"` untuk aksi sekunder, `variant="destructive"` untuk hapus, `loading` saat menunggu, dan `asChild` dengan tepat satu `Link` untuk navigasi.

`WorkspaceLoading` dipakai saat membuka beranda, menunggu sesi AppShell dan memuat route. Tampilan memakai `Skeleton` noninteraktif, identitas Lancara dan layout responsif sesuai shell; status diumumkan melalui `aria-live` dan `aria-busy`, tanpa persentase kemajuan buatan. Animasi skeleton/spinner berhenti jika pengguna mengaktifkan reduced motion. Loading ulang data yang sudah tersedia tetap mempertahankan konten dan draft.

Tampilkan kegagalan lewat `ErrorState` atau `userErrorMessage()` dari `src/lib/error-feedback.ts`; jangan render pesan exception/JSON server. Server mencoba ulang GET satu kali untuk kegagalan storage sementara, dengan log internal; mutation tidak diulang otomatis. Polling memulihkan gangguan jaringan sementara maksimal dua retry sambil mempertahankan data sebelumnya. Kegagalan pembaruan yang berlanjut memakai status kecil tanpa banner teknis. `useMutation` memeriksa `/api/requests/:key` otomatis saat respons hilang/tidak lengkap sebelum menampilkan error atau berhasil; key dipertahankan saat retry. Toast kegagalan tidak ganda untuk satu permintaan, dan data disegarkan setelah server mengonfirmasi sukses. `error.tsx`, `global-error.tsx` dan boundary workspace menyediakan tampilan pemulihan saat render gagal.

Regresi UI: jalankan server lokal, lalu `npx playwright test --config playwright.ui.config.ts`. Suite ini memakai mock API, tanpa reset database atau pengiriman Telegram. Hasil/screenshot ada di `../docs/ripple/evidence/frontend-ux.json` dan `../docs/ripple/evidence/screenshots/*-frontend-*.png`.

## Notifikasi Telegram satu arah

Versi yang disimpan melalui persetujuan, editor, urut ulang, pengaturan atau impor mencatat outbox dalam transaksi yang sama. Status item, preview, draft dan penolakan tidak memicu blast. Telegram hanya menerima registrasi akun/grup dan status bot; chat lain diabaikan. “Terkirim” berarti Bot API menerima pesan, sedangkan “Sudah dibaca” tetap melalui brief aplikasi. Pengiriman ambigu dapat menghasilkan duplikat setelah satu retry; nomor versi membantu mengenalinya.

1. Buat bot uji melalui BotFather `/newbot`. Aktifkan `/setjoingroups`, pertahankan privacy mode, dan gunakan command `start - Hubungkan dari aplikasi`. Bot tidak perlu menjadi admin grup.
2. Isi variabel Telegram dan `NOTIFIER_CRON_SECRET` di `.env.local` atau environment **Production**. Lihat `.env.example`. Secret webhook dan cron berbeda dari token bot; jangan memakai prefix `NEXT_PUBLIC_`. Set `TELEGRAM_ENABLED=false` di Preview.
3. Jalankan migration 006 (`npm run db:migrate`) melalui koneksi session/direct saat deployment. Runtime mendukung transaction pooler: koordinasi worker menggunakan advisory lock transaksi dan lease database.
4. Lokal: `npm run telegram:webhook -- delete`, lalu `npm run telegram:poll`. Polling menolak berjalan saat webhook aktif atau di production. Pakai bot uji terpisah dari production.
5. Production: isi `APP_BASE_URL` HTTPS, deploy, lalu `npm run telegram:webhook -- set` dan `npm run telegram:webhook -- info`. Skrip `set` memeriksa username bot. Jangan menjalankan polling bersamaan.
6. Pasang pemulihan tiap menit melalui [scripts/notifier-cron.sql](scripts/notifier-cron.sql) di SQL Editor Supabase. Aktifkan pg_cron, pg_net dan Vault; simpan `notifier_app_base_url` serta `notifier_cron_secret` dalam Vault. Endpoint drain dapat berjalan hingga 30 detik; timeout HTTP cron disediakan 55 detik. Jalur cepat menggunakan Next.js `after()` setelah respons penyimpanan.
7. Pengaturan → Notifikasi Telegram → Hubungkan grup. Buka tautan, pilih grup, lalu **Setujui** grup yang muncul di aplikasi. Pilih topik opsional dan tautan rundown publik yang masih aktif.
8. Melalui akun terdaftar, pilih peran PIC dan hubungkan Telegram pribadi. Akun demo tidak membuat profil pengguna fiktif. Mention memakai ID Telegram tertaut, maksimal 20 orang; peran tanpa tautan tetap disebut sebagai teks.
9. Simpan perubahan dan periksa pesan serta log. Untuk fallback, gunakan `AI_PROVIDER=rule`; provider Anthropic memakai `NOTIFIER_SUMMARY_MODEL`, gateway memakai `AI_MODEL`. Ringkasan gagal/berisi fakta tidak valid selalu memakai template.

Pemulihan lokal: `npm run notifier:drain`. Health internal memerlukan bearer cron dan melaporkan antrean, pesan ambigu, gagal serta umur antrean. Periksa antrean bila `oldest_pending_seconds > 300`. Delivery `sending` yang terputus dipulihkan setelah dua menit; retry jaringan dibatasi lima percobaan, hasil ambigu satu retry. Entri yang baru diproses setelah `NOTIFIER_MAX_AGE_MIN` (default 120 menit) kedaluwarsa. Retensi dijalankan drain sekali sehari: update tujuh hari, outbox/delivery terminal 90 hari, audit 180 hari.

Untuk delivery ambigu, periksa grup dulu: **Sudah terkirim** mencatat konfirmasi manual, atau **Belum ada, kirim ulang** memakai pesan tersimpan untuk versi aktif. Dispatcher melewati antrean/retry versi lama ketika rundown sudah berganti; riwayat tetap tersedia. Ringkasan AI memakai selisih versi terbaru dari server dan hanya pertukaran chat terakhir sebagai rujukan, sehingga pembatalan lama tidak dilaporkan ulang sebagai perubahan baru. Key permintaan tetap sama ketika respons hilang. Cabut grup untuk menghentikan antrean berikutnya. Untuk menonaktifkan pengiriman, set `TELEGRAM_ENABLED=false` lalu redeploy; pencatatan outbox tetap berjalan. Bila token bocor, rotasi melalui BotFather `/token`, ganti secret webhook, lalu pasang webhook ulang. Skrip dan log tidak mencetak token, URL Bot API, atau respons error mentah.

Acuan protokol: [Telegram Bot API](https://core.telegram.org/bots/api), [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after), [Supabase Cron](https://supabase.com/docs/guides/cron).
