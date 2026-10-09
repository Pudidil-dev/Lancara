-- Notifier Telegram migration 006
-- Notifier Telegram satu arah: outbox transaksional, pengiriman per grup, tautan akun untuk mention.

CREATE TABLE IF NOT EXISTS telegram_accounts (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  telegram_user_id   bigint NOT NULL UNIQUE,
  username_snapshot  text,
  display_snapshot   text,
  private_status     text NOT NULL DEFAULT 'active' CHECK (private_status IN ('active', 'blocked')),
  linked_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz
);

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token_hash  text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

-- Peran PIC operasional yang dipegang pengguna pada event (untuk mention).
CREATE TABLE IF NOT EXISTS member_pic_roles (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id  text NOT NULL,
  role_id   text NOT NULL,
  PRIMARY KEY (user_id, event_id, role_id),
  FOREIGN KEY (event_id, role_id) REFERENCES roles(event_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS telegram_group_codes (
  code_hash     text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  event_id      text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by    text NOT NULL REFERENCES actors(id),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  used_chat_id  bigint
);

CREATE TABLE IF NOT EXISTS telegram_groups (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id             text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  chat_id              bigint NOT NULL,
  message_thread_id    bigint,
  title_snapshot       text,
  status               text NOT NULL CHECK (status IN ('pending', 'approved', 'revoked', 'bot_removed')),
  include_public_link  boolean NOT NULL DEFAULT false,
  added_by_tg_user_id  bigint,
  approved_by          text REFERENCES actors(id),
  approved_at          timestamptz,
  revoked_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, chat_id)
);
CREATE INDEX IF NOT EXISTS telegram_groups_chat_idx ON telegram_groups (chat_id);

-- Dedupe update webhook/polling (F4).
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id     bigint PRIMARY KEY,
  kind          text NOT NULL,
  status        text NOT NULL CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);

-- Outbox transaksional: ditulis di transaksi commit versi.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('schedule.version.committed')),
  schema_version  integer NOT NULL DEFAULT 1,
  payload         jsonb NOT NULL,
  correlation_id  uuid NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'done', 'expired', 'dead')),
  summary_text    text,
  summary_source  text CHECK (summary_source IN ('llm', 'template')),
  attempts        integer NOT NULL DEFAULT 0,
  available_at    timestamptz NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (event_id, version),
  FOREIGN KEY (event_id, version) REFERENCES versions(event_id, number) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS notification_outbox_due_idx ON notification_outbox (status, available_at);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id            uuid NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  group_id             uuid NOT NULL REFERENCES telegram_groups(id) ON DELETE CASCADE,
  chat_id              bigint NOT NULL,
  status               text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'retry', 'ambiguous', 'skipped', 'dead')),
  attempts             integer NOT NULL DEFAULT 0,
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  rendered_text        text NOT NULL,
  mentioned_tg_ids     bigint[] NOT NULL DEFAULT '{}',
  telegram_message_id  bigint,
  error_code           text,
  sent_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, group_id)
);
CREATE INDEX IF NOT EXISTS notification_deliveries_due_idx ON notification_deliveries (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS telegram_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at              timestamptz NOT NULL DEFAULT now(),
  event_id        text,
  actor_id        text,
  telegram_user_id bigint,
  action          text NOT NULL,   -- account_linked, account_unlinked, group_code_created, group_registered, group_approved, group_revoked, bot_removed, delivery_retried_manual, webhook_set
  target          text,
  correlation_id  uuid,
  detail          jsonb NOT NULL DEFAULT '{}'  -- tanpa token, tanpa teks pesan
);

ALTER TABLE telegram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_pic_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_group_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_audit ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON telegram_accounts, telegram_link_tokens, member_pic_roles, telegram_group_codes, telegram_groups,
      telegram_updates, notification_outbox, notification_deliveries, telegram_audit FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON telegram_accounts, telegram_link_tokens, member_pic_roles, telegram_group_codes, telegram_groups,
      telegram_updates, notification_outbox, notification_deliveries, telegram_audit FROM authenticated;
  END IF;
END
$$;

-- Pemulihan setelah respons webhook dan pencatatan retry yang tahan restart.
ALTER TABLE telegram_updates ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}';
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS sending_started_at timestamptz;
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS ambiguous_retries integer NOT NULL DEFAULT 0;
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS entities_fallback boolean NOT NULL DEFAULT false;

-- Lease worker persisten; advisory lock transaksi aman untuk transaction pooler.
CREATE TABLE IF NOT EXISTS notifier_worker_leases (
  name text PRIMARY KEY,
  token uuid NOT NULL,
  locked_until timestamptz NOT NULL
);
ALTER TABLE notifier_worker_leases ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON notifier_worker_leases FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON notifier_worker_leases FROM authenticated;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS telegram_audit_action_at_idx ON telegram_audit (action, at);
CREATE INDEX IF NOT EXISTS telegram_audit_target_at_idx ON telegram_audit (target, at);
