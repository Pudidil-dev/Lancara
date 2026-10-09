import { serverNow } from '@/lib/clock'
import { query } from '@/lib/db'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import { log } from '@/lib/logger'
import type { Session } from '@/lib/session'
import { toMs } from '@/lib/time'
import { resolveExtraction } from '@/modules/ai/extraction'
import { ruleExtract } from '@/modules/ai/rule-parser'
import { AGENT_PROMPT } from '@/modules/agent/agent-prompt'
import { reasoningProfileFor } from '@/modules/agent/policy'
import type { RescheduleRecommendation } from '@/modules/agent/rescheduling'
import { createConversation, runToolAgent, type AgentProgress } from '@/modules/agent/runner'
import { describeOutcome, executeTool, handleDelta, toolsForCapability, undoDecision, type Proposal } from '@/modules/agent/tools'
import { getEvent, getSnapshot } from '@/modules/events/service'
import { buildAgentContext } from './context'
import { groundingFacts, ruleAnswer, type Suggestion } from './knowledge'

export const MAX_MESSAGE = 500
export const SUPPORT_PER_MINUTE = 20

export interface SupportTurn { role: 'user' | 'assistant'; text: string }
export interface AgentStep { tool: string; ok: boolean; note?: string }
export interface SupportReply {
  answer: string
  source: 'rule' | 'ai'
  suggestions: Suggestion[]
  proposals: Proposal[]
  /** Ringkasan proses berpikir dari provider (bila dikirim). */
  reasoning: string[]
  /** Jejak tool yang dijalankan agen. */
  steps: AgentStep[]
}

const UNDO_PATTERN = /\b(?:batalkan|kembalikan|balikin|undo|revert)\b.{0,30}\b(?:perubahan|keputusan|tadi|terakhir)\b|\bsalah,?\s*balik/i
const RESCHEDULE_PATTERN = /reschedul|rekomendasi|rekomendastion|recommend|susun ulang|atur ulang|\b(?:ok|oke|ya)?\s*ganti\b/i

/**
 * Model menyusun rencana lewat tools. Versi aktif hanya berubah setelah konfirmasi website.
 * Jalur aturan tetap membuat preview saat provider gagal; bukan commit tersembunyi.
 */
export async function answerSupport(session: Session, message: string, history: SupportTurn[] = [], onEvent?: (event: AgentProgress) => void): Promise<SupportReply> {
  const text = message.trim()
  if (!text || text.length > MAX_MESSAGE) throw new AppError('VALIDATION_ERROR', `Pesan harus 1–${MAX_MESSAGE} karakter.`)

  // Rate limit per sesi memakai tabel parse_usage dengan kunci "support:" agar tidak tercampur.
  const key = `support:${session.session_id}`
  const recent = await query<{ n: string }>(`SELECT count(*) AS n FROM parse_usage WHERE session_id = $1 AND at > now() - interval '1 minute'`, [key])
  if (Number(recent[0].n) >= SUPPORT_PER_MINUTE) throw new AppError('RATE_LIMITED', 'Terlalu banyak pertanyaan. Tunggu sebentar.')
  await query('INSERT INTO parse_usage (session_id) VALUES ($1)', [key])

  const proposals: Proposal[] = []
  const execute = async (name: string, input: unknown) => {
    const outcome = await executeTool(session, name, input)
    if (outcome.ok && outcome.proposal) proposals.push(outcome.proposal)
    return outcome
  }

  const cfg = env()
  if (cfg.AI_PROVIDER !== 'rule') {
    try {
      const event = await getEvent(session.event_id)
      const snapshot = await getSnapshot(session.event_id, event.active_version)
      const context = buildAgentContext(session, snapshot, event.active_version, serverNow(event.sim_clock_at), 'confirm')
      const user = JSON.stringify({ context, application_guide: groundingFacts(), request: { message: text, history: history.slice(-6) } })
      const conversation = createConversation(AGENT_PROMPT, user, toolsForCapability(session.capability), {
        provider: cfg.AI_PROVIDER,
        model: cfg.AI_MODEL,
        anthropicKey: cfg.ANTHROPIC_API_KEY,
        openaiBaseUrl: cfg.OPENAI_BASE_URL,
        openaiKey: cfg.OPENAI_API_KEY,
        reasoningEffort: reasoningProfileFor(text).effort,
        structured: false,
        onThinking: (text) => onEvent?.({ type: 'thinking', text }),
      })
      if (conversation) {
        const run = await runToolAgent(conversation, execute, undefined, onEvent)
        if (run.text) {
          // Jangan berhenti pada narasi tanpa preview untuk permintaan reschedule yang bisa ditangani.
          if (!proposals.length && RESCHEDULE_PATTERN.test(text)) {
            const planned = await prepareRecommendation(session, proposals, history, onEvent)
            if (planned.proposals.length) return { ...planned, source: 'ai', reasoning: run.reasoning, steps: [...run.steps, ...planned.steps] }
          }
          log('info', 'support', { source: 'ai', steps: run.steps.length, proposals: proposals.length, reasoning: run.reasoning.length })
          const answer = proposals.length ? 'Rekomendasi perubahan siap. Periksa pratinjau di bawah, lalu konfirmasi perubahan rundown untuk menyimpan versi baru.' : run.text
          return { ...reply(answer, 'ai'), proposals, reasoning: run.reasoning, steps: run.steps }
        }
      }
    } catch (error) {
      // Kegagalan model tidak menggagalkan asisten; isi pesan dan detail provider tidak dicetak.
      log('warn', 'support_ai_fallback', { reason: (error as Error)?.name ?? 'error' })
    }
    // Preview bisa sudah tersimpan walau model gagal menyusun jawaban akhir.
    if (proposals.length) {
      return { ...reply('Rekomendasi siap. Periksa pratinjau di bawah lalu konfirmasi perubahan rundown.', 'rule'), proposals }
    }
  }

  return ruleAgent(session, text, proposals, history, onEvent)
}

function reply(answer: string, source: 'rule' | 'ai', suggestions: Suggestion[] = []): SupportReply {
  return { answer, source, suggestions, proposals: [], reasoning: [], steps: [] }
}

/**
 * Jalur aturan: tafsirkan kabar, selesaikan ambiguitas dengan item pending terdekat,
 * lalu jalankan alur yang sama dengan tool agen. Pertanyaan umum dijawab dari panduan.
 */
async function ruleAgent(session: Session, text: string, proposals: Proposal[], history: SupportTurn[], onEvent?: (event: AgentProgress) => void): Promise<SupportReply> {
  const faq = ruleAnswer(text, { capability: session.capability })

  if (UNDO_PATTERN.test(text)) {
    const outcome = await undoDecision(session, null)
    if (outcome.ok && outcome.proposal) proposals.push(outcome.proposal)
    return { ...reply(describeOutcome(outcome), 'rule'), proposals, steps: [{ tool: 'undo_decision', ok: outcome.ok }] }
  }

  const event = await getEvent(session.event_id)
  const snapshot = await getSnapshot(session.event_id, event.active_version)
  const now = serverNow(event.sim_clock_at)
  const extraction = ruleExtract(text, snapshot)
  if (!extraction.type || !extraction.item_ids.length) {
    if (RESCHEDULE_PATTERN.test(text)) return prepareRecommendation(session, proposals, history, onEvent)
    return reply(faq.answer, 'rule', faq.suggestions)
  }

  let assumption = ''
  if (extraction.item_ids.length > 1) {
    // Ambigu: pilih item pending dengan jadwal paling dekat dari jam sekarang.
    const pending = extraction.item_ids
      .map((id) => snapshot.items.find((i) => i.id === id)!)
      .filter((i) => i && i.status === 'pending')
      .sort((a, b) => Math.abs(toMs(a.start_at) - toMs(now)) - Math.abs(toMs(b.start_at) - toMs(now)))
    if (!pending.length) return reply(faq.answer, 'rule', faq.suggestions)
    extraction.item_ids = [pending[0].id]
    assumption = `Saya anggap yang dimaksud ${pending[0].title} (belum mulai dan paling dekat).\n`
  }
  const interpretation = resolveExtraction(extraction, snapshot, now, 'rule')
  if (interpretation.status !== 'ok' || !interpretation.delta) {
    return reply(interpretation.questions[0]?.message ?? faq.answer, 'rule', faq.suggestions)
  }
  const outcome = await handleDelta(session, interpretation.delta, text)
  if (outcome.ok && outcome.proposal) proposals.push(outcome.proposal)
  return { ...reply(assumption + describeOutcome(outcome), 'rule'), proposals, steps: [{ tool: 'propose_schedule_change', ok: outcome.ok }] }
}

/** Rekomendasi selalu diverifikasi dari snapshot baru; riwayat hanya membantu memilih. */
async function prepareRecommendation(session: Session, proposals: Proposal[], history: SupportTurn[], onEvent?: (event: AgentProgress) => void): Promise<SupportReply> {
  onEvent?.({ type: 'tool', tool: 'recommend_reschedule', status: 'running' })
  const outcome = await executeTool(session, 'recommend_reschedule', {})
  onEvent?.({ type: 'tool', tool: 'recommend_reschedule', status: 'done', ok: outcome.ok })
  const steps: AgentStep[] = [{ tool: 'recommend_reschedule', ok: outcome.ok }]
  if (!outcome.ok) return { ...reply(outcome.error, 'rule'), steps }
  const data = outcome.data as { base_version: number; recommendations: RescheduleRecommendation[] }
  const prior = history.filter(turn => turn.role === 'assistant').at(-1)?.text.toLowerCase() ?? ''
  const selected = data.recommendations.find(r => r.diff.some(d => prior.includes(d.title.toLowerCase()) || prior.includes(d.title.split(':')[0].trim().toLowerCase()))) ?? data.recommendations[0]
  if (!selected) return { ...reply('Belum ada pemajuan sesi yang lolos pada jeda yang tersedia. Sebutkan sesi pengganti atau perubahan durasi yang diinginkan agar saya buatkan pratinjau.', 'rule'), steps }
  onEvent?.({ type: 'tool', tool: 'edit_rundown', status: 'running' })
  const edited = await executeTool(session, 'edit_rundown', { base_version: data.base_version, summary: selected.label.slice(0, 200), operations: selected.operations })
  onEvent?.({ type: 'tool', tool: 'edit_rundown', status: 'done', ok: edited.ok })
  steps.push({ tool: 'edit_rundown', ok: edited.ok })
  if (edited.ok && edited.proposal) proposals.push(edited.proposal)
  return { ...reply(edited.ok && edited.proposal ? `${selected.label}. Konfirmasi perubahan pada pratinjau di bawah untuk menyimpan rundown baru.` : describeOutcome(edited), 'rule'), proposals, steps }
}
