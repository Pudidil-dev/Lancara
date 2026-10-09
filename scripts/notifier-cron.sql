-- Jalankan di SQL Editor Supabase setelah pg_cron, pg_net dan Vault tersedia.
-- Buat secret Vault notifier_app_base_url dan notifier_cron_secret lewat UI Vault.
-- URL dan bearer tidak ditanam di definisi job ataupun source control.
-- Menjadwalkan ulang aman: nama job tetap sama.
SELECT cron.schedule(
  'lancara-notifier-drain',
  '* * * * *',
  $job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notifier_app_base_url') || '/api/internal/notifications/drain',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notifier_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $job$
);
