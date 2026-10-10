# LANCARA

Aplikasi koordinasi acara untuk menangani perubahan rundown secara langsung. Koordinator meninjau dampak, menyetujui jadwal baru, lalu membagikan brief kepada kru. Tersedia impor rundown, riwayat keputusan, asisten AI, dan notifikasi Telegram.

Dibangun dengan Next.js 15, React 19, TypeScript, dan PostgreSQL.

## Jalankan lokal

Butuh Node.js ≥20.11 dan PostgreSQL.

```powershell
npm ci
Copy-Item .env.example .env.local
```

Isi `.env.local` dengan konfigurasi berikut. Gunakan credential milik Anda sendiri.

```dotenv
DATABASE_URL=<url-postgres>
SESSION_SECRET=<string-acak-minimal-32-karakter>
APP_BASE_URL=http://localhost:3000
AI_PROVIDER=rule
TELEGRAM_ENABLED=false
DEMO_MODE=true
```

Untuk PostgreSQL lokal, jalankan `npm run db:local -- init`. Setelah database siap:

```powershell
npm run db:migrate
npm run db:seed
npm run dev
```

Buka http://localhost:3000. Seed mengisi data demo; `npm run dev` memeriksa migrasi otomatis sebelum server berjalan. `db:reset` menghapus data aplikasi dan hanya digunakan untuk mengulang demo.

## Deploy ke Vercel

1. Siapkan database Supabase. Gunakan **Transaction pooler** untuk `DATABASE_URL`, dengan `sslmode=require`.
2. Jalankan migrasi manual pada database tujuan memakai **Session pooler** atau koneksi direct. Script migrasi membaca `DATABASE_URL`; arahkan variabel itu ke koneksi migrasi saat menjalankan `npm run db:migrate`. Jalankan seed sekali jika membutuhkan data demo.
3. Import repository ke Vercel. Pilih **Next.js**, root folder yang berisi `package.json`, Install Command `npm ci`, dan Build Command `npm run build`.
4. Isi Environment Variables, lalu deploy. Setelah mengganti env, lakukan redeploy.

| Variabel | Nilai di Vercel |
| --- | --- |
| `DATABASE_URL` | URL Transaction pooler Supabase |
| `SESSION_SECRET` | String acak minimal 32 karakter |
| `APP_BASE_URL` | Domain aplikasi, misalnya `https://nama-app.vercel.app` |
| `DB_POOL_MAX` | `2` |
| `AI_PROVIDER` | `rule`, atau provider AI di bawah |
| `TELEGRAM_ENABLED` | `false` sampai bot siap |
| `DEMO_MODE` | `true` untuk demo |

Build Vercel tidak menjalankan migrasi atau seed. `DATABASE_URL_MIGRATIONS` tidak wajib di Vercel. Gunakan database terpisah untuk Preview dan nonaktifkan Telegram di lingkungan tersebut.

Buat secret dengan:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Periksa `/health/live` dan `/health/ready` setelah deploy. Database siap ditandai `status: "ready"` dan `db: "ok"`; `seeded: true` berarti sudah ada event.

## AI opsional

Pilih salah satu konfigurasi:

- **Anthropic:** `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, dan `AI_MODEL`.
- **OpenAI-compatible:** `AI_PROVIDER=openai-compatible`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, dan `AI_MODEL`.

Gunakan model yang tersedia di provider Anda. Gateway untuk Vercel harus dapat dijangkau dari internet; alamat localhost hanya berlaku di laptop. Perubahan yang dibuat asisten tetap menunggu konfirmasi koordinator.

## Telegram opsional

1. Buat bot melalui **@BotFather**, izinkan bot bergabung ke grup, dan pertahankan privacy mode.
2. Isi env berikut di Vercel Production:

   ```dotenv
   TELEGRAM_ENABLED=true
   TELEGRAM_BOT_TOKEN=<token-bot>
   TELEGRAM_BOT_USERNAME=<username-tanpa-@>
   TELEGRAM_WEBHOOK_SECRET=<secret-acak>
   NOTIFIER_CRON_SECRET=<secret-acak-berbeda>
   ```

3. Deploy, lalu jalankan dari laptop dengan env yang menunjuk bot, database, dan domain production yang sama:

   ```powershell
   npm run telegram:webhook -- set
   npm run telegram:webhook -- info
   ```

4. Di Supabase, siapkan **pg_cron**, **pg_net**, dan **Vault**. Simpan `notifier_app_base_url` (domain tanpa `/` terakhir) serta `notifier_cron_secret` (sama dengan env Vercel), lalu jalankan [scripts/notifier-cron.sql](scripts/notifier-cron.sql) untuk pemulihan antrean setiap menit.
5. Di aplikasi, buka **Pengaturan → Notifikasi Telegram → Hubungkan grup**, lalu setujui grup tujuan. Simpan perubahan rundown untuk menguji pengiriman.

Endpoint production harus dapat diakses Telegram dan cron tanpa login perlindungan deployment. Untuk pengujian lokal, gunakan bot terpisah dan `npm run telegram:poll` setelah webhook bot uji dihapus. Polling dan webhook tidak berjalan bersamaan.

Telegram mengirim notifikasi perubahan rundown; konfirmasi **Sudah dibaca** dilakukan melalui aplikasi.

## Pemeriksaan

```powershell
npm run typecheck
npm run test:all
npm run build
```

Tes integrasi membutuhkan `DATABASE_URL_TEST` yang menunjuk database khusus tes, karena datanya di-reset oleh suite.

Kontrak endpoint: [docs/API.md](docs/API.md). Aturan pengembangan: [AGENTS.md](AGENTS.md). Simpan credential di `.env.local` atau env Vercel, tanpa prefix `NEXT_PUBLIC_`.
