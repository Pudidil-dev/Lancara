import type { Interpretation } from '@/modules/ai/extraction'
import type { Delta, ItemDiff, ItemStatus, RejectedCandidate, RoleImpact, SearchMeta, Violation } from '@/modules/engine/types'

export interface ChangeItem {
  id: string; title: string; start_at: string; status: ItemStatus
  duration_seconds: number; estimated_end_at: string | null
}
export interface Patch {
  id: string; candidate_id: string; rank: number; label: string; base_version: number
  diff: ItemDiff[]; impact: RoleImpact[]; items_changed: number; total_shift_seconds: number; violations: Violation[]
  configuration_diff?: Array<{ field: string; old: string; new: string }>
}
export interface ChangeDetail {
  change: {
    id: string; seq: number; actor_id: string; actor_name: string
    kind: 'report' | 'correction' | 'compensation'
    status: 'draft' | 'needs_clarification' | 'preview_ready' | 'approved' | 'rejected'
    original_text: string | null; reference_at: string | null
    draft: Interpretation | { manual: boolean } | null
    confirmed_delta: Delta | null; base_version: number | null; parse_provider: string | null; parse_ms: number | null
    reject_reason: string | null
  }
  event: { id: string; name: string; timezone: string; active_version: number }
  stale: boolean; can_approve: boolean; server_now: string; items: ChangeItem[]; analysis_count: number
  analysis: {
    id: string; base_version: number; analysis_now: string; delta: Delta; engine_ms: number
    blockers: Violation[]; rejected: RejectedCandidate[]; search_meta: SearchMeta
  } | null
  patches: Patch[]
  decision: { id: string; patch_id: string; reason: string; base_version: number; new_version: number; approved_by: string; approved_at: string } | null
}
export interface ApprovalResult {
  decision_id: string; change_id: string; new_version: number; base_version: number; briefs: number; replayed?: boolean
}
export type ManualDelta = Extract<Delta, { type: 'earliest_start' | 'active_end_estimate' | 'cancel_item' }>
export const CHANGE_TYPE_LABELS = {
  earliest_start: 'Mulai paling awal', active_end_estimate: 'Estimasi selesai sesi aktif', cancel_item: 'Pembatalan item', revert_decision: 'Kompensasi keputusan', revise_rundown: 'Penjadwalan ulang rundown',
  configure_event: 'Konfigurasi dan format acara',
}
export function interpretationOf(detail: ChangeDetail): Interpretation | null {
  return detail.change.draft && 'questions' in detail.change.draft ? detail.change.draft : null
}
