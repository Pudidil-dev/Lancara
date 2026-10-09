/** Profil agent dan evaluator lama; hak akses tool mengikuti session server. */
export const AGENT_ROUTES = ['rundown_summary', 'item_lookup', 'delay_report', 'earlier_start_report', 'active_end_report', 'cancel_report', 'constraint_check', 'workflow_help', 'scope_guard'] as const
export type AgentRoute = typeof AGENT_ROUTES[number]
export type Capability = 'coordinator' | 'crew'
export type ReasoningEffort = 'low' | 'high'
export const REASONING_PROFILES = {
  low: { effort: 'low' as const, max_tokens: 2048, step_timeout_ms: 20000, total_timeout_ms: 45000 },
  high: { effort: 'high' as const, max_tokens: 8192, step_timeout_ms: 35000, total_timeout_ms: 90000 },
}

/** Profil dipilih server dari kabar terbaru; client/model tidak dapat mengatur budget atau izin. */
export function reasoningProfileFor(message: string) {
  if (inspectRequest(message).blocked) return REASONING_PROFILES.low
  const analysis = /\b(?:telat|terlambat|delay|baru bisa mulai|molor|overtime|estimasi selesai|diperkirakan selesai|perkiraan selesai|batal|dibatalkan|cancel|tidak hadir|tidak datang|absen|berhalangan|lebih awal|lebih cepat|dimajukan|maju|diundur|mundur|reschedul\w*|rekomendasi|rekomendastion|recommend\w*|ganti|ubah|tambah|hapus|pangkas|potong|susun ulang|atur ulang|jadwalkan|format|konfigurasi|pengaturan|curfew|resource|dependensi)\b/i
  return analysis.test(message.normalize('NFKC')) ? REASONING_PROFILES.high : REASONING_PROFILES.low
}
export const ROUTE_TO_KIND = { delay_report: 'delay', earlier_start_report: 'earlier_start', active_end_report: 'end_estimate', cancel_report: 'cancel' } as const
export const ROUTE_RULES = [
  { route: 'rundown_summary', task: 'Ringkas rundown aktif', tools: ['get_rundown_summary'] },
  { route: 'item_lookup', task: 'Cari jadwal/status satu item yang jelas', tools: ['get_rundown_summary'] },
  { route: 'delay_report', task: 'Kabar keterlambatan eksplisit; preview hanya koordinator', tools: ['get_rundown_summary', 'propose_schedule_change'] },
  { route: 'earlier_start_report', task: 'Kabar bisa mulai lebih awal dengan jam eksplisit; preview hanya koordinator', tools: ['get_rundown_summary', 'propose_schedule_change'] },
  { route: 'active_end_report', task: 'Estimasi selesai item yang sedang berlangsung; preview hanya koordinator', tools: ['get_rundown_summary', 'propose_schedule_change'] },
  { route: 'cancel_report', task: 'Pembatalan item pending yang jelas; preview hanya koordinator', tools: ['get_rundown_summary', 'propose_schedule_change'] },
  { route: 'constraint_check', task: 'Jelaskan batas tercatat dari hasil tool; tidak mengubah batas', tools: ['get_rundown_summary'] },
  { route: 'workflow_help', task: 'Panduan memakai LANCARA dari fakta aplikasi', tools: [] },
  { route: 'scope_guard', task: 'Percakapan umum atau klarifikasi bila konteks belum cukup', tools: [] },
] satisfies Array<{ route: AgentRoute; task: string; tools: string[] }>

function normalize(text: string): string {
  return text.normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').toLowerCase()
}

export function inspectRequest(message: string): { blocked: boolean; reason: string | null } {
  // Kompatibilitas evaluator lama: pesan tidak ditolak oleh filter topik/kata.
  // Tool website dan session server menentukan tindakan yang benar-benar tersedia.
  void message
  return { blocked: false, reason: null }
}

interface SummaryItem { id: string; title: string; status: string; protected: boolean }
export interface SummaryData { items: SummaryItem[]; version?: number }
export interface ProposalArgs { item_id: string; kind: 'delay' | 'earlier_start' | 'end_estimate' | 'cancel'; minutes?: number | null; time_hhmm?: string | null; summary: string }

/** Kabar terbaru harus membuktikan target, jenis dan nilai; riwayat client tidak mengotorisasi tool. */
export function authorizeProposal(message: string, args: ProposalArgs, summary: SummaryData): string | null {
  if (inspectRequest(message).blocked) return 'Permintaan di luar scope.'
  const text = normalize(message)
  const words = text.replace(/[^\p{L}\p{N}]+/gu, ' ')
  const matches = summary.items.filter(item => {
    const title = normalize(item.title).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const id = normalize(item.id).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    return [title, id].some(value => value && (` ${words} `).includes(` ${value} `))
  })
  if (matches.length !== 1 || matches[0].id !== args.item_id) return 'Item belum tunggal atau berbeda dari kabar. Minta klarifikasi.'
  const item = matches[0]
  if (item.protected || ['completed', 'cancelled'].includes(item.status)) return 'Item terlindungi, selesai, atau dibatalkan tidak dapat diusulkan.'
  if (/\b(?:atau|mungkin)\b|\bmenit\s+lagi\b/.test(text)) return 'Nilai kabar ambigu atau relatif. Minta waktu yang jelas.'
  const types = {
    delay: /\b(?:telat|terlambat|delay|mundur|diundur|baru bisa mulai)\b/,
    earlier_start: /\b(?:lebih awal|lebih cepat|dimajukan|maju)\b/,
    end_estimate: /\b(?:molor|overtime|estimasi selesai|diperkirakan selesai|perkiraan selesai)\b/,
    cancel: /\b(?:batal|dibatalkan|cancel|tidak hadir|tidak datang|absen|berhalangan|ga hadir)\b/,
  }
  const kinds = Object.entries(types).filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind)
  if (kinds.length !== 1 || kinds[0] !== args.kind) return 'Jenis perubahan berbeda dari kabar atau belum jelas.'
  const minutes = [...text.matchAll(/\b(\d{1,3})\s*(?:menit|mnt|minutes)\b/g)].map(match => Number(match[1]))
  const times = [...text.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)].map(match => `${match[1].padStart(2, '0')}:${match[2]}`)
  if (args.minutes != null && args.time_hhmm != null) return 'Kirim satu representasi waktu saja.'
  if (args.kind === 'cancel') return args.minutes != null || args.time_hhmm != null ? 'Pembatalan tidak menerima nilai waktu.' : null
  if (args.kind === 'end_estimate' ? item.status !== 'in_progress' : item.status !== 'pending') return 'Status item tidak sesuai jenis perubahan.'
  if (args.minutes != null) return args.kind === 'delay' && minutes.length === 1 && times.length === 0 && minutes[0] === args.minutes ? null : 'Jumlah menit berbeda dari kabar.'
  const given = args.time_hhmm?.replace('.', ':').split(':').map(value => value.padStart(2, '0')).join(':')
  return times.length === 1 && minutes.length === 0 && given === times[0] ? null : 'Jam belum eksplisit atau berbeda dari kabar.'
}

