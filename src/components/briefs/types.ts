import type { BriefPayload } from '@/modules/briefs/render'
import type { ItemDiff } from '@/modules/engine/types'

export interface Brief {
  id: string
  decision_id: string
  change_id: string
  version: number
  level: 'ACTION_REQUIRED' | 'FYI'
  payload: BriefPayload
  acknowledged_at: string | null
  ack_by: string | null
  superseded_by: { id: string; version: number; change_seq: number } | null
}
export interface AckResult {
  brief_id: string
  change_id: string
  change_seq: number
  version: number
  acknowledged_at: string
}
export interface InboxResponse {
  role: { id: string; label: string }
  active_version: number
  server_now: string
  unread: number
  briefs: Brief[]
}
export interface Acknowledgement {
  brief_id: string
  role_id: string
  role_label: string
  level: 'ACTION_REQUIRED' | 'FYI'
  version: number
  acknowledged_at: string | null
  ack_by: string | null
}
export interface HistoryDecision {
  id: string
  change_id: string
  seq: number
  kind: 'report' | 'correction' | 'compensation'
  original_text: string | null
  reported_by: string
  patch_label: string
  diff: ItemDiff[]
  reason: string
  base_version: number
  new_version: number
  approved_by: string
  approved_at: string
  corrects_decision_id: string | null
  compensates_decision_id: string | null
  acks: Acknowledgement[]
}
export interface HistoryResponse {
  event: { id: string; name: string; timezone: string; active_version: number }
  decisions: HistoryDecision[]
  versions: {
    number: number
    parent_number: number | null
    source: string
    note: string | null
    created_at: string
    actor_name: string | null
  }[]
  pending_acks: number
}
