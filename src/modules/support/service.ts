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
import { agentInputBudget, createConversation, runToolAgent, type AgentProgress } from '@/modules/agent/runner'
import { describeOutcome, executeTool, handleDelta, toolsForCapability, undoDecision, type Proposal } from '@/modules/agent/tools'
import { getEvent, getSnapshot } from '@/modules/events/service'
import { buildAgentContext, buildLatestCommit } from './context'
import { latestExchange } from './history'
import { guardRequestedTarget, resolveTargetFocus } from '@/modules/agent/targeting'
import { groundingFacts, ruleAnswer, type Suggestion } from './knowledge'
import { MAX_MESSAGE, MAX_HISTORY_TURNS, type AgentAttachment } from './limits'
import { prepareAttachments } from './attachments'
import { buildPayload } from '@/modules/notifier/payload'
import { templateParagraph, validateParagraph } from '@/modules/notifier/summarize'

export { MAX_MESSAGE } from './limits'
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
export async function answerSupport(session: Session, message: string, history: SupportTurn[] = [], onEvent?: (event: AgentProgress) => void, attachments: AgentAttachment[] = []): Promise<SupportReply> {
  const text = message.trim()
  const latestReportRequested = /\b(?:ringkas\w*|rangkum\w*|laporkan)\b/i.test(text) && /\b(?:perubahan|terbaru|terakhir|tadi)\b/i.test(text)
  if (!text || text.length > MAX_MESSAGE) throw new AppError('VALIDATION_ERROR', `Pesan harus 1–${MAX_MESSAGE} karakter.`)
  const files = await prepareAttachments(attachments)

  // Rate limit per sesi memakai tabel parse_usage dengan kunci "support:" agar tidak tercampur.
  const key = `support:${session.session_id}`
  const recent = await query<{ n: string }>(`SELECT count(*) AS n FROM parse_usage WHERE session_id = $1 AND at > now() - interval '1 minute'`, [key])
  if (Number(recent[0].n) >= SUPPORT_PER_MINUTE) throw new AppError('RATE_LIMITED', 'Terlalu banyak pertanyaan. Tunggu sebentar.')
  await query('INSERT INTO parse_usage (session_id) VALUES ($1)', [key])

  const currentEvent = await getEvent(session.event_id)
  const currentSnapshot = await getSnapshot(session.event_id, currentEvent.active_version)
  const currentNow = serverNow(currentEvent.sim_clock_at)
  history = latestExchange(history)
  const focus = resolveTargetFocus(text, history, currentSnapshot)
  if (focus.unknown_name) return reply(`${focus.unknown_name} tidak ditemukan pada rundown aktif. Sebutkan nama segmen yang tercatat; saya belum membuat perubahan.`, 'rule')
  if (focus.ambiguous) return reply(`Yang ingin diubah ${focus.item_ids.map(id => currentSnapshot.items.find(item => item.id === id)!.title).join(' atau ')}?`, 'rule')

  const proposals: Proposal[] = []
  const execute = async (name: string, input: unknown) => {
    if (latestReportRequested && !['get_rundown_summary', 'get_event_context'].includes(name)) return { ok: false as const, error: 'Laporan terbaru hanya membaca rundown aktif; gunakan latest_commit dari server.' }
    const mismatch = guardRequestedTarget(currentSnapshot, focus, name, input, currentNow)
    if (mismatch) return { ok: false as const, error: mismatch }
    const scoped = name === 'recommend_reschedule' && focus.item_ids.length ? { target_item_ids: focus.item_ids } : input
    const outcome = await executeTool(session, name, scoped)
    if (outcome.ok && outcome.proposal) proposals.push(outcome.proposal)
    return outcome
  }

  const cfg = env()
  const previous = currentEvent.active_version > 1 && (cfg.AI_PROVIDER !== 'rule' || latestReportRequested)
    ? await getSnapshot(session.event_id, currentEvent.active_version - 1) : null
  const latestReport = latestReportRequested && previous ? buildPayload({
    base: previous, proposed: currentSnapshot, baseVersion: currentEvent.active_version - 1, version: currentEvent.active_version,
    session, origin: 'manual_edit', committedAt: currentNow,
  }) : null
  if (latestReportRequested && !previous) return reply('Belum ada perubahan versi setelah rundown awal.', 'rule')
  if (cfg.AI_PROVIDER !== 'rule') {
    try {
      const context = buildAgentContext(session, currentSnapshot, currentEvent.active_version, currentNow, 'confirm')
      const latestCommit = buildLatestCommit(previous, currentSnapshot, currentEvent.active_version)
      const tools = toolsForCapability(session.capability).filter(tool => !latestReportRequested || ['get_rundown_summary', 'get_event_context'].includes(tool.name))
      const effort = files.length || reasoningProfileFor(text).effort === 'high' ? cfg.AGENT_REASONING_EFFORT : 'low'
      const memory = history.slice(-MAX_HISTORY_TURNS)
      const payload = () => JSON.stringify({ context, latest_commit: latestCommit, application_guide: groundingFacts(), request: { message: text, history: memory, target: { ...focus, items: context.rundown.items.filter(item => focus.item_ids.includes(item.id)) }, attachments: files.map(file => ({ name: file.name, mime_type: file.mime_type, pages: file.pages })) } })
      let user = payload()
      const outputBudget = effort === 'low' ? 2048 : cfg.AGENT_MAX_OUTPUT_TOKENS
      while (memory.length && agentInputBudget(AGENT_PROMPT + user, tools, files) + outputBudget > cfg.AGENT_CONTEXT_TOKENS) { memory.shift(); user = payload() }
      const conversation = createConversation(AGENT_PROMPT, user, tools, {
        provider: cfg.AI_PROVIDER,
        model: cfg.AI_MODEL,
        anthropicKey: cfg.ANTHROPIC_API_KEY,
        openaiBaseUrl: cfg.OPENAI_BASE_URL,
        openaiKey: cfg.OPENAI_API_KEY,
        reasoningEffort: effort,
        limits: { contextTokens: cfg.AGENT_CONTEXT_TOKENS, outputTokens: cfg.AGENT_MAX_OUTPUT_TOKENS },
        attachments: files,
        structured: false,
        onThinking: latestReportRequested ? undefined : (text) => onEvent?.({ type: 'thinking', text }),
      })
      if (conversation) {
        const run = await runToolAgent(conversation, execute, undefined, onEvent)
        if (run.text) {
          // Jangan berhenti pada narasi tanpa preview untuk permintaan reschedule yang bisa ditangani.
          if (!latestReportRequested && !proposals.length && (RESCHEDULE_PATTERN.test(text) || (focus.item_ids.length && /ubah|ganti|geser|pindah/i.test(text)))) {
            const planned = focus.item_ids.length === 1 && focus.requested_start_hhmm
              ? await prepareSpecificMove(session, proposals, focus.item_ids[0], focus.requested_start_hhmm, onEvent)
              : await prepareRecommendation(session, proposals, history, onEvent, focus.item_ids)
            if (planned.proposals.length) return { ...planned, source: 'ai', reasoning: run.reasoning, steps: [...run.steps, ...planned.steps] }
          }
          log('info', 'support', { source: 'ai', steps: run.steps.length, proposals: proposals.length, reasoning: run.reasoning.length })
          const ungroundedReport = latestReport && !validateParagraph(run.text, latestReport)
          const answer = proposals.length ? 'Rekomendasi perubahan siap. Periksa pratinjau di bawah, lalu konfirmasi perubahan rundown untuk menyimpan versi baru.'
            : ungroundedReport ? templateParagraph(latestReport) : run.text
          return { ...reply(answer, ungroundedReport && !proposals.length ? 'rule' : 'ai'), proposals, reasoning: ungroundedReport ? [] : run.reasoning, steps: run.steps }
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

  if (latestReport) return reply(templateParagraph(latestReport), 'rule')
  if (files.length) return reply('Model belum dapat membaca lampiran sekarang. Coba lagi atau tuliskan isi yang relevan; saya belum mengekstrak data dari berkas tersebut.', 'rule')
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
  const focus = resolveTargetFocus(text, history, snapshot)
  if (focus.item_ids.length === 1 && focus.requested_start_hhmm) return prepareSpecificMove(session, proposals, focus.item_ids[0], focus.requested_start_hhmm, onEvent)
  if (!extraction.type || !extraction.item_ids.length) {
    if (RESCHEDULE_PATTERN.test(text)) return prepareRecommendation(session, proposals, history, onEvent, focus.item_ids)
    if (focus.item_ids.length && /ubah|ganti|geser|jadwal/i.test(text)) return reply(`Targetnya ${snapshot.items.find(item => item.id === focus.item_ids[0])!.title}. Sebutkan jam baru atau minta rekomendasi untuk segmen tersebut.`, 'rule')
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

async function prepareSpecificMove(session: Session, proposals: Proposal[], itemId: string, clock: string, onEvent?: (event: AgentProgress) => void): Promise<SupportReply> {
  const event = await getEvent(session.event_id)
  const snapshot = await getSnapshot(session.event_id, event.active_version)
  const title = snapshot.items.find(item => item.id === itemId)?.title ?? itemId
  onEvent?.({ type: 'tool', tool: 'edit_rundown', status: 'running' })
  const outcome = await executeTool(session, 'edit_rundown', { base_version: event.active_version, summary: `Pindahkan ${title} ke ${clock}`.slice(0, 200), operations: [{ op: 'update', item_id: itemId, start_hhmm: clock }] })
  onEvent?.({ type: 'tool', tool: 'edit_rundown', status: 'done', ok: outcome.ok })
  if (outcome.ok && outcome.proposal) proposals.push(outcome.proposal)
  return { ...reply(outcome.ok ? `${title} siap dipindah ke ${clock.replace(':', '.')}. Periksa pratinjau lalu konfirmasi perubahan rundown.` : `${title} belum bisa dipindah ke ${clock.replace(':', '.')}: ${outcome.error}`, 'rule'), proposals, steps: [{ tool: 'edit_rundown', ok: outcome.ok }] }
}

/** Rekomendasi selalu diverifikasi dari snapshot baru; riwayat hanya membantu memilih. */
async function prepareRecommendation(session: Session, proposals: Proposal[], history: SupportTurn[], onEvent?: (event: AgentProgress) => void, targetItemIds: string[] = []): Promise<SupportReply> {
  onEvent?.({ type: 'tool', tool: 'recommend_reschedule', status: 'running' })
  const outcome = await executeTool(session, 'recommend_reschedule', targetItemIds.length ? { target_item_ids: targetItemIds } : {})
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
