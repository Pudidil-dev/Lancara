import type { Session } from '@/lib/session'
import type { Snapshot, Violation } from '@/modules/engine/types'
export type { Session }
export interface Account { id: string; display_name: string; role_id: string; role_label: string; capability: 'coordinator'; event_id: string }
export interface SessionResponse { session: Session | null; accounts: Account[]; demo_mode: boolean }
export interface RundownResponse {
  event: { id: string; name: string; timezone: string; active_version: number; sim_clock_at: string | null }
  version: number; snapshot: Snapshot; validation: { errors: Violation[]; missing: Violation[] }; server_now: string; demo_mode: boolean
}
export const EVENT_ID = 'evt-ripple-demo'
export const RUNDOWN_PATH = `/api/events/${EVENT_ID}/rundown`
/** Baris GET /api/events/:id/changes untuk seluruh kabar acara. */
export interface ChangeSummary {
  id: string; seq: number; kind: 'report' | 'correction' | 'compensation'
  status: 'draft' | 'needs_clarification' | 'preview_ready' | 'approved' | 'rejected'
  original_text: string | null; base_version: number | null; created_at: string; actor_name: string
}
