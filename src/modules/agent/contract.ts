import { z } from 'zod'
import { AGENT_ROUTES, ROUTE_TO_KIND, ROUTE_RULES } from './policy'

export const MAX_ANSWER_CHARS = 320

const Shape = z.object({
  schema_version: z.literal('ripple-agent.v1'),
  route: z.enum(AGENT_ROUTES),
  status: z.enum(['answer', 'needs_clarification', 'proposal_ready', 'no_feasible_option', 'refused']),
  answer: z.string().trim().min(1).max(MAX_ANSWER_CHARS).regex(/^[^\r\n]+$/, 'Jawaban chat harus satu paragraf pendek.'),
  question: z.string().trim().min(1).max(200).nullable(),
  evidence_tool_call_ids: z.array(z.string().min(1).max(100)).max(3),
  candidate_rank: z.number().int().min(1).max(3).nullable(),
  applied: z.literal(false),
}).strict()
export const AGENT_REPLY_JSON_SCHEMA = z.toJSONSchema(Shape)
export const AgentReplySchema = Shape.superRefine((value, ctx) => {
  if ((value.status === 'needs_clarification') !== (value.question !== null)) ctx.addIssue({ code: 'custom', message: 'Pertanyaan hanya dan wajib untuk klarifikasi.' })
  if ((value.status === 'proposal_ready') !== (value.candidate_rank !== null)) ctx.addIssue({ code: 'custom', message: 'Rank hanya dan wajib untuk preview siap.' })
  if (new Set(value.evidence_tool_call_ids).size !== value.evidence_tool_call_ids.length) ctx.addIssue({ code: 'custom', message: 'Bukti panggilan tidak boleh berulang.' })
})
export type AgentReply = z.infer<typeof AgentReplySchema>
export interface AgentEvidence { id: string; name: string; data: unknown; kind?: string }

function allowedNumbers(data: unknown): Set<string> {
  const values = new Set<string>()
  function collect(value: unknown, key = '') {
    if (typeof value === 'number' && Number.isFinite(value)) values.add(String(value))
    else if (typeof value === 'string' && /^(?:start|end|now|curfew|start_at|end_at|projected_finish|time_hhmm)$/.test(key)) {
      for (const match of value.matchAll(/\b\d{1,2}[.:]\d{2}\b/g)) values.add(match[0].replace('.', ':'))
    } else if (Array.isArray(value)) value.forEach(item => collect(item, key))
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => collect(v, k))
  }
  collect(data)
  return values
}

/** Validasi skema saja tidak cukup: klaim dan pilihan harus memiliki bukti tool sukses. */
export function validateReply(raw: unknown, evidence: AgentEvidence[], requestText = ''): AgentReply | null {
  const parsed = AgentReplySchema.safeParse(raw)
  if (!parsed.success) return null
  const value = parsed.data
  const cited = value.evidence_tool_call_ids.map(id => evidence.find(entry => entry.id === id))
  if (cited.some(entry => !entry)) return null
  const allowed: readonly string[] = ROUTE_RULES.find(rule => rule.route === value.route)!.tools
  if (cited.some(entry => !allowed.includes(entry!.name))) return null
  if (evidence.some(entry => entry.name === 'propose_schedule_change') && !['proposal_ready', 'no_feasible_option'].includes(value.status)) return null
  const text = value.answer
  if (/https?:\/\/|\/(?:api|changes)\/|\b(?:sudah|telah)\s+(?:diterapkan|disetujui|diubah|berubah|terkirim)|\bberhasil\s+(?:menerapkan|mengubah|menyetujui)|\bbrief\s+(?:sudah|telah)\s*(?:dikirim|terkirim)/i.test(text)) return null
  const numeric = allowedNumbers(cited.map(entry => entry!.data))
  for (const match of text.matchAll(/\b\d{1,2}[.:]\d{2}\b|\bv\d+\b|\b\d+\b/gi)) if (!numeric.has(match[0].replace(/^v/i, '').replace('.', ':'))) return null
  if (value.question) {
    const requested = new Set([...requestText.matchAll(/\b\d{1,2}[.:]\d{2}\b|\b\d+\b/g)].map(match => match[0].replace('.', ':')))
    for (const match of value.question.matchAll(/\b\d{1,2}[.:]\d{2}\b|\b\d+\b/g)) if (!numeric.has(match[0].replace('.', ':')) && !requested.has(match[0].replace('.', ':'))) return null
  }
  if (['rundown_summary', 'item_lookup', 'constraint_check'].includes(value.route) && value.status === 'answer' && !cited.some(entry => entry?.name === 'get_rundown_summary')) return null
  if (value.route === 'scope_guard' && !['refused', 'needs_clarification'].includes(value.status)) return null
  if (['proposal_ready', 'no_feasible_option'].includes(value.status)) {
    const expected = ROUTE_TO_KIND[value.route as keyof typeof ROUTE_TO_KIND]
    const proposal = cited.find(entry => entry?.name === 'propose_schedule_change' && entry.kind === expected)
    if (!expected || !proposal) return null
    const data = proposal.data as { candidates?: Array<{ rank: number }>; status?: string }
    if (value.status === 'proposal_ready' && !data.candidates?.some(candidate => candidate.rank === value.candidate_rank)) return null
    if (value.status === 'no_feasible_option' && (data.status !== 'tidak_ada_opsi_lolos' || data.candidates?.length !== 0)) return null
  }
  return value
}

export function refusal(answer: string): AgentReply {
  return { schema_version: 'ripple-agent.v1', route: 'scope_guard', status: 'refused', answer, question: null, evidence_tool_call_ids: [], candidate_rank: null, applied: false }
}
