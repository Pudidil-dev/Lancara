// Kontrak data engine. Semua waktu = ISO-8601 UTC; durasi = detik (02-technical-design.md).

export const ENGINE_VERSION = 'ripple-engine/1.0.0'

export type ItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface Item {
  id: string
  title: string
  start_at: string
  duration_seconds: number
  min_duration_seconds: number
  /** Estimasi selesai sesi aktif (active_end_estimate); terpisah dari durasi rencana. */
  estimated_end_at: string | null
  status: ItemStatus
  pic_role_ids: string[]
  resource_ids: string[]
  /** Boleh dipindah posisinya lewat kandidat tukar. */
  swappable: boolean
  /** Info operasional dari impor PDF (tidak dipakai engine): tipe/lokasi segmen, perlengkapan, catatan teknis. */
  segment?: string | null
  /** Pihak yang terlibat (Figma kolom "PIHAK YANG TERLIBAT"). */
  involved?: string[]
  equipment?: string[]
  notes?: string[]
}

export interface Dependency {
  id: string
  predecessor_id: string
  successor_id: string
  type: 'finish_before_start'
}

export type ConstraintType = 'fixed_start' | 'earliest_start'

export interface Constraint {
  id: string
  type: ConstraintType
  item_id: string
  at: string
  hard: true
  note?: string
}

export interface Resource {
  id: string
  label: string
  role_ids: string[]
}

export interface RoleRef {
  id: string
  label: string
}

export interface Snapshot {
  event: { id: string; name: string; timezone: string; curfew_at: string; stage: string }
  roles: RoleRef[]
  items: Item[]
  dependencies: Dependency[]
  constraints: Constraint[]
  resources: Resource[]
}

export type Delta =
  | { type: 'earliest_start'; item_id: string; value: string; is_estimate: boolean; reference_at: string | null }
  | { type: 'active_end_estimate'; item_id: string; value: string; is_estimate: boolean; reference_at: string | null }
  | { type: 'cancel_item'; item_id: string; is_estimate: false; reference_at: string | null }
  /** Disusun server dari operasi CRUD, lalu dipratinjau dan disetujui lewat transaksi keputusan. */
  | { type: 'revise_rundown'; snapshot: Snapshot; is_estimate: false; reference_at: string | null }
  /** Konfigurasi event dibangun server; item tidak berubah sebelum pratinjau disetujui. */
  | { type: 'configure_event'; snapshot: Snapshot; is_estimate: false; reference_at: string | null }
  | { type: 'revert_decision'; decision_id: string; before: Snapshot; after: Snapshot; is_estimate: false; reference_at: null }

export type ViolationRule =
  | 'BREAK_LOCKED'
  | 'MISSING_DATA'
  | 'INVALID_REFERENCE'
  | 'INVALID_DURATION'
  | 'DEPENDENCY_CYCLE'
  | 'FIXED_START'
  | 'EARLIEST_START'
  | 'CURFEW'
  | 'MIN_DURATION'
  | 'DEPENDENCY'
  | 'DEPENDENCY_CANCELLED'
  | 'STAGE_OVERLAP'
  | 'RESOURCE_OVERLAP'
  | 'LOCKED_ITEM'
  | 'PAST_START'
  | 'INVALID_DELTA'

export interface Violation {
  rule: ViolationRule
  constraint_id: string
  item_id: string | null
  field?: string
  message: string
  actual?: string
  limit?: string
}

interface ItemDiffBase {
  item_id: string
  title: string
  new: { start_at: string; end_at: string; duration_seconds: number; status: ItemStatus }
  start_shift_seconds: number
  details?: Array<{ field: string; old: string; new: string }>
}

export type ItemDiff = ItemDiffBase & (
  | {
    kind?: 'changed'
    old: { start_at: string; end_at: string; duration_seconds: number; status: ItemStatus }
    changes: Array<'start' | 'duration' | 'status' | 'end_estimate' | 'title' | 'pic' | 'resources' | 'swappable'>
  }
  | { kind: 'added'; old: null; changes: Array<'added'> }
)

export type ImpactLevel = 'BLOCKER' | 'ACTION_REQUIRED' | 'FYI' | 'UNCHANGED'

export interface RoleImpactEntry {
  item_id: string
  title: string
  reason: string
  dependency_id?: string
  old?: { start_at: string; end_at: string }
  new?: { start_at: string; end_at: string }
  status?: ItemStatus
}

export interface RoleImpact {
  role_id: string
  role_label: string
  level: ImpactLevel
  entries: RoleImpactEntry[]
}

export type Strategy = 'keep' | 'shift' | 'swap' | 'trim' | 'swap_trim' | 'revert'

export interface ConfigurationDiff {
  field: string
  old: string
  new: string
}

export interface Candidate {
  candidate_id: string
  rank: number
  strategy: Strategy
  label: string
  items_changed: number
  total_start_shift_seconds: number
  diff: ItemDiff[]
  configuration_diff?: ConfigurationDiff[]
  proposed: Snapshot
  violations: Violation[]
  impact: RoleImpact[]
}

export interface RejectedCandidate {
  candidate_id: string
  strategy: Strategy
  label: string
  violations: Violation[]
}

export interface SearchMeta {
  strategies: Strategy[]
  generated: number
  evaluated: number
  valid: number
  limit_candidates: number
  limit_items: number
  truncated: boolean
  note: string
}

export interface AnalysisResult {
  engine_version: string
  analysis_now: string
  blockers: Violation[]
  candidates: Candidate[]
  rejected: RejectedCandidate[]
  search: SearchMeta
}
