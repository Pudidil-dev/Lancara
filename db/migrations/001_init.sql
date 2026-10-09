-- Ripple MVP schema (04-data-api.md). Idempotent-safe: dijalankan sekali oleh scripts/migrate.ts.
-- Prinsip: versi, patch, keputusan, brief, dan ack tidak pernah di-UPDATE/DELETE (riwayat utuh).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Satu baris event = kunci approval (SELECT ... FOR UPDATE).
CREATE TABLE events (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  timezone        text NOT NULL DEFAULT 'Asia/Jakarta',
  active_version  integer NOT NULL DEFAULT 0 CHECK (active_version >= 0),
  sim_clock_at    timestamptz,               -- jam simulasi demo (override DEMO_CLOCK_ISO)
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Peran penerima brief + capability. Session actor terpisah dari role recipient.
CREATE TABLE roles (
  event_id    text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  id          text NOT NULL,
  label       text NOT NULL,
  capability  text NOT NULL CHECK (capability IN ('coordinator', 'crew')),
  PRIMARY KEY (event_id, id)
);

-- Akun demo fiktif ("Simulasi peran demo").
CREATE TABLE actors (
  id            text PRIMARY KEY,
  event_id      text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role_id       text NOT NULL,
  display_name  text NOT NULL,
  FOREIGN KEY (event_id, role_id) REFERENCES roles(event_id, id) ON DELETE CASCADE
);

-- Session server-side. Cookie berisi id + HMAC(SESSION_SECRET); role/capability dibaca dari DB per request.
CREATE TABLE demo_sessions (
  id          text PRIMARY KEY,
  actor_id    text NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX demo_sessions_expires_idx ON demo_sessions (expires_at);

-- Snapshot immutable per versi.
CREATE TABLE versions (
  event_id       text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  number         integer NOT NULL CHECK (number >= 1),
  parent_number  integer,
  snapshot       jsonb NOT NULL,
  source         text NOT NULL CHECK (source IN ('seed', 'setup', 'item_status', 'decision')),
  actor_id       text REFERENCES actors(id),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, number)
);

CREATE TABLE changes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                      bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  event_id                 text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  actor_id                 text NOT NULL REFERENCES actors(id),
  kind                     text NOT NULL DEFAULT 'report' CHECK (kind IN ('report', 'correction', 'compensation')),
  original_text            text,
  reference_at             timestamptz,
  draft                    jsonb,              -- interpretasi belum dikonfirmasi (parser/manual)
  parse_provider           text,
  parse_ms                 integer,
  confirmed_delta          jsonb,
  is_estimate              boolean NOT NULL DEFAULT false,
  analysis_now             timestamptz,
  base_version             integer,
  status                   text NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'needs_clarification', 'preview_ready', 'approved', 'rejected')),
  corrects_decision_id     uuid,
  compensates_decision_id  uuid,
  rejected_by              text REFERENCES actors(id),
  reject_reason            text,
  rejected_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX changes_event_idx ON changes (event_id, created_at DESC);

-- Satu analisis = satu kali confirm/reanalyse (nol patch adalah hasil sah).
CREATE TABLE analyses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_id       uuid NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  event_id        text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  base_version    integer NOT NULL,
  analysis_now    timestamptz NOT NULL,
  delta           jsonb NOT NULL,
  engine_version  text NOT NULL,
  blockers        jsonb NOT NULL DEFAULT '[]',
  rejected        jsonb NOT NULL DEFAULT '[]',
  search_meta     jsonb NOT NULL,
  engine_ms       integer NOT NULL,
  actor_id        text NOT NULL REFERENCES actors(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analyses_change_idx ON analyses (change_id, created_at DESC);

CREATE TABLE patches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id        uuid NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  change_id          uuid NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  candidate_id       text NOT NULL,
  rank               integer NOT NULL CHECK (rank BETWEEN 1 AND 3),
  strategy           text NOT NULL,
  label              text NOT NULL,
  engine_version     text NOT NULL,
  base_version       integer NOT NULL,
  proposed_snapshot  jsonb NOT NULL,
  diff               jsonb NOT NULL,
  violations         jsonb NOT NULL DEFAULT '[]',
  impact             jsonb NOT NULL,
  items_changed      integer NOT NULL,
  total_shift_seconds integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, candidate_id),
  UNIQUE (analysis_id, rank)
);

CREATE TABLE decisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  change_id     uuid NOT NULL UNIQUE REFERENCES changes(id) ON DELETE CASCADE,
  patch_id      uuid NOT NULL UNIQUE REFERENCES patches(id) ON DELETE CASCADE,
  actor_id      text NOT NULL REFERENCES actors(id),
  reason        text NOT NULL,
  base_version  integer NOT NULL,
  new_version   integer NOT NULL,
  approved_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, new_version),
  FOREIGN KEY (event_id, new_version) REFERENCES versions(event_id, number) ON DELETE CASCADE
);

ALTER TABLE changes
  ADD CONSTRAINT changes_corrects_fk FOREIGN KEY (corrects_decision_id) REFERENCES decisions(id) ON DELETE CASCADE,
  ADD CONSTRAINT changes_compensates_fk FOREIGN KEY (compensates_decision_id) REFERENCES decisions(id) ON DELETE CASCADE;

CREATE TABLE briefs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id        uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  change_id          uuid NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
  event_id           text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  version            integer NOT NULL,
  recipient_role_id  text NOT NULL,
  level              text NOT NULL CHECK (level IN ('ACTION_REQUIRED', 'FYI')),
  payload            jsonb NOT NULL,
  rendered           text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id, recipient_role_id),
  FOREIGN KEY (event_id, recipient_role_id) REFERENCES roles(event_id, id) ON DELETE CASCADE
);
CREATE INDEX briefs_inbox_idx ON briefs (event_id, recipient_role_id, version DESC);

CREATE TABLE acknowledgements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id         uuid NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  role_id          text NOT NULL,
  actor_id         text NOT NULL REFERENCES actors(id),
  acknowledged_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brief_id, role_id)
);

-- Idempotency + status permintaan (GET /api/requests/:id).
CREATE TABLE requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  actor_id         text NOT NULL REFERENCES actors(id),
  operation        text NOT NULL,
  idempotency_key  text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  payload_hash     text NOT NULL,
  status           text NOT NULL CHECK (status IN ('pending', 'committed', 'failed')),
  result           jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  UNIQUE (event_id, actor_id, operation, idempotency_key)
);

-- Rate limit parser per session (serverless-safe: disimpan di DB, bukan memori instance).
CREATE TABLE parse_usage (
  session_id  text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parse_usage_idx ON parse_usage (session_id, at);

-- Riwayat append-only: tolak UPDATE/DELETE langsung (reset demo memakai TRUNCATE ... CASCADE).
CREATE FUNCTION ripple_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabel % bersifat append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER versions_append_only BEFORE UPDATE OR DELETE ON versions
  FOR EACH ROW EXECUTE FUNCTION ripple_forbid_mutation();
CREATE TRIGGER patches_append_only BEFORE UPDATE OR DELETE ON patches
  FOR EACH ROW EXECUTE FUNCTION ripple_forbid_mutation();
CREATE TRIGGER decisions_append_only BEFORE UPDATE OR DELETE ON decisions
  FOR EACH ROW EXECUTE FUNCTION ripple_forbid_mutation();
CREATE TRIGGER briefs_append_only BEFORE UPDATE OR DELETE ON briefs
  FOR EACH ROW EXECUTE FUNCTION ripple_forbid_mutation();
CREATE TRIGGER acknowledgements_append_only BEFORE UPDATE OR DELETE ON acknowledgements
  FOR EACH ROW EXECUTE FUNCTION ripple_forbid_mutation();
