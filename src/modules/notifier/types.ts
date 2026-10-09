import type { ItemDiff, RoleImpact, RoleRef } from '@/modules/engine/types'

export type NotificationOrigin = 'decision' | 'manual_edit' | 'reorder' | 'import' | 'settings'

export interface NotificationPayload {
  schema_version: 1
  kind: 'schedule.version.committed'
  idempotency_key: string
  correlation_id: string
  event: { id: string; name: string; timezone: string; curfew_at: string }
  version: number
  base_version: number
  origin: NotificationOrigin
  committed_at: string
  actor: { actor_id: string; display_name: string }
  decision?: { decision_id: string; change_seq: number; kind: string; patch_label: string; reason: string }
  changes: Array<Omit<ItemDiff, 'start_shift_seconds' | 'details'> & { shift_minutes: number }>
  items_changed: number
  projected_finish_at: string
  impact: RoleImpact[]
  roles: RoleRef[]
  import_summary?: { item_count: number; first_start_at: string | null; last_end_at: string | null; filename: string }
  config_changes?: Array<{ field: string; old: string; new: string }>
}

export interface TelegramGroup {
  id: string
  event_id: string
  chat_id: string
  message_thread_id: string | null
  title_snapshot: string | null
  status: 'pending' | 'approved' | 'revoked' | 'bot_removed'
  include_public_link: boolean
  created_at: Date
}

export interface Mention {
  telegram_user_id: string
  display_name: string
  role_labels: string[]
}

export interface MentionRecipients {
  mentions: Mention[]
  unlinked_roles: string[]
  additional_count: number
}
