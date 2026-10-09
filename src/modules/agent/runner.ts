// Loop tool-calling untuk AI Agent LANCARA. Hanya dipanggil dari server.
// Jalur produksi memakai JSON tervalidasi, izin server dan profil reasoning adaptif.
import Anthropic from '@anthropic-ai/sdk'
import type { ToolOutcome, ToolSpec } from './tools'
import { validateToolInput } from './tools'
import { AGENT_REPLY_JSON_SCHEMA, MAX_ANSWER_CHARS, refusal, validateReply, type AgentEvidence, type AgentReply } from './contract'
import { authorizeProposal, inspectRequest, reasoningProfileFor, REASONING_PROFILES, type Capability, type ProposalArgs, type SummaryData, type ReasoningEffort } from './policy'

export const MAX_ROUNDS = 3
export const MAX_ANSWER = MAX_ANSWER_CHARS
export const TOTAL_TIMEOUT_MS = 45000
export const MAX_TOOL_CALLS = 3

export type Execute = (name: string, input: unknown) => Promise<ToolOutcome>
export interface ToolCall { id: string; name: string; input: unknown }
export interface ToolResult { id: string; ok: boolean; payload: unknown }
export type Turn = { kind: 'text'; text: string | null } | { kind: 'tools'; calls: ToolCall[] }
/** Progres yang dikirim ke UI selama agen bekerja: potongan thinking dan status tiap tool. */
export type AgentProgress = { type: 'thinking'; text: string } | { type: 'tool'; tool: string; status: 'running' | 'done'; ok?: boolean; note?: string }

/** Percakapan satu provider. step() meminta giliran model; pushResults() mengirim hasil tool kembali. */
export interface Conversation {
  step(): Promise<Turn>
  pushResults(results: ToolResult[]): void
  reasoningTokens?(): number | null
  /** Ringkasan reasoning dari provider (thinking Anthropic / reasoning_content gateway), bila dikirim. */
  reasoning?(): string[]
}

/** Buang penanda markdown yang mungkin tetap dikeluarkan model. Bubble chat hanya menampilkan teks biasa. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()
}

/** Jalankan percakapan sampai model memberi teks akhir. Null bila melewati batas putaran atau model menolak. */
export async function runAgent(conversation: Conversation, execute: Execute): Promise<string | null> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const turn = await conversation.step()
    if (turn.kind === 'text') {
      const clean = turn.text ? stripMarkdown(turn.text) : ''
      return clean ? clean.slice(0, MAX_ANSWER) : null
    }
    const results: ToolResult[] = []
    for (const call of turn.calls) {
      const outcome = await execute(call.name, call.input)
      results.push({ id: call.id, ok: outcome.ok, payload: outcome.ok ? outcome.data : { error: outcome.error } })
    }
    conversation.pushResults(results)
  }
  return null
}

export interface AgentRun { text: string | null; reasoning: string[]; steps: Array<{ tool: string; ok: boolean; note?: string }> }
export const FREE_MAX_ROUNDS = 6
export const FREE_MAX_ANSWER = 1500

/**
 * Agen umum: model bebas membaca konteks lewat tool, memutuskan, lalu bertindak. Batas aman ada di server
 * (otorisasi peran per tool, engine constraint, kunci ishoma, idempotensi), bukan di pola kata pesan.
 */
export async function runToolAgent(conversation: Conversation, execute: Execute, maxRounds = FREE_MAX_ROUNDS, onProgress?: (event: AgentProgress) => void): Promise<AgentRun> {
  const steps: AgentRun['steps'] = []
  const mutations = new Map<string, ToolOutcome>()
  const callIds = new Map<string, string>()
  let toolCalls = 0
  for (let round = 0; round < maxRounds; round++) {
    const turn = await conversation.step()
    if (turn.kind === 'text') {
      const clean = turn.text ? stripMarkdown(turn.text).slice(0, FREE_MAX_ANSWER) : ''
      return { text: clean || null, reasoning: conversation.reasoning?.() ?? [], steps }
    }
    const results: ToolResult[] = []
    if (!turn.calls.length) break
    if (turn.calls.length > 4 || toolCalls + turn.calls.length > 16) {
      conversation.pushResults(turn.calls.map(call => ({ id: call.id, ok: false, payload: { error: 'Budget panggilan tool terlampaui; gunakan maksimal empat tool per giliran.' } })))
      continue
    }
    for (const call of turn.calls) {
      toolCalls++
      onProgress?.({ type: 'tool', tool: call.name, status: 'running' })
      let outcome: ToolOutcome
      const parsed = validateToolInput(call.name, call.input)
      if (!parsed.ok) outcome = { ok: false, error: parsed.error }
      else {
        const values = Object.entries(parsed.data as Record<string, unknown>).filter(([key, value]) => key !== 'summary' && value != null).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, key === 'time_hhmm' && typeof value === 'string' ? value.replace('.', ':').split(':').map(part => part.padStart(2, '0')).join(':') : value])
        const fingerprint = `${call.name}:${JSON.stringify(values)}`
        const previous = callIds.get(call.id)
        const mutation = ['propose_schedule_change', 'undo_decision', 'edit_rundown', 'edit_event_configuration'].includes(call.name)
        if (previous && previous !== fingerprint) outcome = { ok: false, error: 'ID panggilan sudah dipakai untuk argumen berbeda.' }
        else if (mutation && mutations.has(fingerprint)) outcome = mutations.get(fingerprint)!
        else {
          callIds.set(call.id, fingerprint)
          try { outcome = await execute(call.name, parsed.data) } catch { outcome = { ok: false, error: 'Tool tidak tersedia; status tindakan perlu diperiksa.' } }
          // Error bisa terjadi setelah commit; pengulangan niat yang sama memakai hasil ini.
          if (mutation) mutations.set(fingerprint, outcome)
        }
      }
      steps.push({ tool: call.name, ok: outcome.ok, note: outcome.ok ? undefined : outcome.error })
      onProgress?.({ type: 'tool', tool: call.name, status: 'done', ok: outcome.ok, note: outcome.ok ? undefined : outcome.error })
      results.push({ id: call.id, ok: outcome.ok, payload: outcome.ok ? outcome.data : { error: outcome.error } })
    }
    conversation.pushResults(results)
  }
  return { text: null, reasoning: conversation.reasoning?.() ?? [], steps }
}

/** Jalur lama berbasis JSON tervalidasi (dipertahankan untuk dataset/evaluasi). */
export async function runStructuredAgent(conversation: Conversation, execute: Execute, policy: { capability: Capability; message: string }): Promise<AgentReply | null> {
  const inspected = inspectRequest(policy.message)
  if (inspected.blocked) return refusal(inspected.reason!)
  const deadline = Date.now() + reasoningProfileFor(policy.message).total_timeout_ms
  const ids = new Set<string>()
  const evidence: AgentEvidence[] = []
  const previews = new Set<string>()
  let summary: SummaryData | null = null
  let count = 0
  for (let round = 0; round < MAX_ROUNDS && Date.now() < deadline; round++) {
    const turn = await conversation.step()
    if (Date.now() >= deadline) return null
    if (turn.kind === 'text') {
      if (!turn.text || turn.text.length > 6000) return null
      try { return validateReply(JSON.parse(turn.text), evidence, policy.message) } catch { return null }
    }
    if (!turn.calls.length || turn.calls.length > 2 || count + turn.calls.length > MAX_TOOL_CALLS) return null
    const batch = new Set<string>()
    for (const call of turn.calls) {
      if (typeof call.id !== 'string' || !/^[\w-]{1,100}$/.test(call.id) || ids.has(call.id) || batch.has(call.id)) return null
      batch.add(call.id)
    }
    const results: ToolResult[] = []
    for (const call of turn.calls) {
      count++
      ids.add(call.id)
      let error: string | null = null
      const input = validateToolInput(call.name, call.input)
      if (!input.ok) error = input.error
      if (call.name === 'propose_schedule_change') {
        if (!summary) error = 'Baca rundown aktif sebelum mengusulkan perubahan.'
        else if (input.ok) error = authorizeProposal(policy.message, input.data as ProposalArgs, summary)
      }
      const intent = call.name === 'propose_schedule_change' && input.ok ? JSON.stringify(input.data) : null
      if (intent && previews.has(intent)) error = 'Usulan yang sama sudah dibuat; tidak diulang.'
      if (intent && previews.size > 0) error = 'Satu pesan hanya dapat membuat satu preview.'
      if (error || Date.now() >= deadline) {
        results.push({ id: call.id, ok: false, payload: { error: error ?? 'Budget waktu habis.' } })
        continue
      }
      let outcome: ToolOutcome
      // Catat sebelum eksekusi: error dapat terjadi sesudah draft committed.
      if (intent) previews.add(intent)
      try { outcome = await execute(call.name, input.ok ? input.data : {}) } catch { outcome = { ok: false, error: 'Tool tidak tersedia.' } }
      results.push({ id: call.id, ok: outcome.ok, payload: outcome.ok ? outcome.data : { error: outcome.error } })
      if (outcome.ok) {
        evidence.push({ id: call.id, name: call.name, data: outcome.data, kind: input.ok && call.name === 'propose_schedule_change' ? (input.data as ProposalArgs).kind : undefined })
        if (call.name === 'get_rundown_summary') {
          const parsed = outcome.data as SummaryData
          if (Array.isArray(parsed?.items)) summary = parsed
        }
      }
    }
    conversation.pushResults(results)
  }
  return null
}

function anthropicConversation(system: string, user: string, tools: ToolSpec[], model: string, apiKey: string, effort: ReasoningEffort): Conversation {
  const profile = REASONING_PROFILES[effort]
  const client = new Anthropic({ apiKey, timeout: profile.step_timeout_ms, maxRetries: 0 })
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }]
  const schemaTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool['input_schema'] }))
  const deadline = Date.now() + profile.total_timeout_ms
  const thoughts: string[] = []
  return {
    reasoning: () => thoughts,
    async step() {
      if (Date.now() >= deadline) throw new Error('agent_timeout')
      const modern = /^claude-(?:opus|sonnet)-(?:4-[6-9]|[5-9])/.test(model)
      const thinking: Pick<Anthropic.MessageCreateParamsNonStreaming, 'thinking' | 'output_config'> = modern
        ? { thinking: { type: 'adaptive', display: 'summarized' } as Anthropic.MessageCreateParamsNonStreaming['thinking'], output_config: { effort } }
        : effort === 'high' ? { thinking: { type: 'enabled', budget_tokens: 4096 } } : {}
      const response = await client.messages.create({ model, max_tokens: profile.max_tokens, system, tools: schemaTools, messages, ...thinking }, { timeout: Math.min(profile.step_timeout_ms, deadline - Date.now()) })
      if (response.stop_reason === 'refusal') return { kind: 'text', text: null }
      messages.push({ role: 'assistant', content: response.content })
      for (const block of response.content) if (block.type === 'thinking' && block.thinking.trim()) thoughts.push(block.thinking.trim().slice(0, 1200))
      const calls = response.content.flatMap((block) => (block.type === 'tool_use' ? [{ id: block.id, name: block.name, input: block.input }] : []))
      if (response.stop_reason === 'tool_use' && calls.length > 0) return { kind: 'tools', calls }
      return { kind: 'text', text: response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n') }
    },
    pushResults(results) {
      messages.push({
        role: 'user',
        content: results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: JSON.stringify({ tool_call_id: r.id, ok: r.ok, result: r.payload }), is_error: !r.ok })),
      })
    },
  }
}

interface OpenAiMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content?: string | null; tool_calls?: unknown; tool_call_id?: string }
function parseArguments(raw: string | undefined): unknown {
  try { return typeof raw === 'string' && raw.length <= 32768 ? JSON.parse(raw) : null } catch { return null }
}

/** Request JSON tanpa credential; dipakai adapter dan eksportir prompt. */
export function buildAgentRequest(system: string, user: string, tools: ToolSpec[], model: string, effort: ReasoningEffort = 'low', structured = true) {
  const profile = REASONING_PROFILES[effort]
  return {
    model, reasoning_effort: effort, max_completion_tokens: profile.max_tokens, parallel_tool_calls: false,
    ...(structured ? { response_format: { type: 'json_schema', json_schema: { name: 'ripple_agent_reply', strict: true, schema: AGENT_REPLY_JSON_SCHEMA } } } : {}),
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters, strict: structured } })),
    tool_choice: 'auto',
  }
}

interface OpenAiStreamChunk {
  usage?: { completion_tokens_details?: { reasoning_tokens?: number } }
  choices?: Array<{
    finish_reason?: string | null
    delta?: {
      content?: string | null
      refusal?: unknown
      reasoning_content?: unknown
      reasoning?: unknown
      tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
    }
  }>
}
interface StreamedCall { id: string; name: string; arguments: string }
interface StreamedTurn { content: string; thought: string; finish: string | null; refusal: boolean; calls: StreamedCall[]; reasoningTokens: number | null }

/**
 * Membaca SSE chat completions. Teks dan argumen tool diakumulasi; reasoning diteruskan ke onThinking saat tiba
 * (chunking thinking), sehingga UI bisa menampilkannya sebelum langkah selesai.
 */
async function readChatStream(body: ReadableStream<Uint8Array>, onThinking?: (text: string) => void): Promise<StreamedTurn> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const turn: StreamedTurn = { content: '', thought: '', finish: null, refusal: false, calls: [], reasoningTokens: null }
  const slots = new Map<number, StreamedCall>()
  let buffer = ''
  const consume = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return
    let chunk: OpenAiStreamChunk
    try { chunk = JSON.parse(data) as OpenAiStreamChunk } catch { return }
    const tokens = chunk.usage?.completion_tokens_details?.reasoning_tokens
    if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0) turn.reasoningTokens = tokens
    const choice = chunk.choices?.[0]
    if (!choice) return
    if (choice.finish_reason) turn.finish = choice.finish_reason
    const delta = choice.delta ?? {}
    if (delta.refusal) turn.refusal = true
    if (typeof delta.content === 'string') turn.content += delta.content
    const piece = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : typeof delta.reasoning === 'string' ? delta.reasoning : ''
    if (piece) {
      turn.thought += piece
      onThinking?.(piece)
    }
    for (const part of delta.tool_calls ?? []) {
      const slot = slots.get(part.index) ?? { id: '', name: '', arguments: '' }
      if (part.id) slot.id = part.id
      if (part.function?.name) slot.name = part.function.name
      if (part.function?.arguments) slot.arguments += part.function.arguments
      slots.set(part.index, slot)
    }
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      consume(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }
  buffer += decoder.decode()
  consume(buffer)
  turn.calls = [...slots.entries()].sort(([a], [b]) => a - b).map(([, slot]) => slot).filter(slot => slot.name)
  return turn
}

function openAiConversation(system: string, user: string, tools: ToolSpec[], cfg: { baseUrl: string; apiKey: string; model: string; effort: ReasoningEffort; structured: boolean; onThinking?: (text: string) => void }): Conversation {
  const base = new URL(cfg.baseUrl)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('invalid_provider_url')
  const endpoint = `${base.toString().replace(/\/$/, '')}/chat/completions`
  const messages: OpenAiMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }]
  const profile = REASONING_PROFILES[cfg.effort]
  const request = buildAgentRequest(system, user, tools, cfg.model, cfg.effort, cfg.structured)
  const thoughts: string[] = []
  const deadline = Date.now() + profile.total_timeout_ms
  let reasoningTokens: number | null = null
  return {
    async step() {
      const controller = new AbortController()
      if (Date.now() >= deadline) throw new Error('agent_timeout')
      // Satu request per langkah. Timeout mencakup seluruh pembacaan stream; tidak ada retry otomatis agar request tidak digandakan.
      const timer = setTimeout(() => controller.abort(), Math.min(profile.step_timeout_ms, deadline - Date.now()))
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ ...request, messages, stream: true, stream_options: { include_usage: true } }),
        })
        if (!response.ok || !response.body) {
          // Body error tidak dibaca atau dicetak: bisa memuat detail credential atau request.
          await response.body?.cancel()
          throw new Error('provider_http_error')
        }
        const streamed = await readChatStream(response.body, cfg.onThinking)
        if (streamed.reasoningTokens !== null) reasoningTokens = (reasoningTokens ?? 0) + streamed.reasoningTokens
        if (streamed.thought.trim()) thoughts.push(streamed.thought.trim().slice(0, 1200))
        if (!['stop', 'tool_calls'].includes(streamed.finish ?? '') || streamed.refusal) return { kind: 'text', text: null }
        if (streamed.calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: streamed.content || null,
            tool_calls: streamed.calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })),
          })
          return { kind: 'tools', calls: streamed.calls.map(call => ({ id: call.id, name: call.name, input: parseArguments(call.arguments) })) }
        }
        return { kind: 'text', text: streamed.content || null }
      } finally {
        clearTimeout(timer)
      }
    },
    pushResults(results) {
      for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify({ tool_call_id: r.id, ok: r.ok, result: r.payload }) })
    },
    reasoningTokens: () => reasoningTokens,
    reasoning: () => thoughts,
  }
}

/** Buat percakapan untuk provider yang dikonfigurasi. Null bila provider tidak lengkap konfigurasinya. */
export function createConversation(system: string, user: string, tools: ToolSpec[], cfg: {
  provider: string; model: string; anthropicKey?: string; openaiBaseUrl?: string; openaiKey?: string; reasoningEffort?: ReasoningEffort; structured?: boolean
  /** Potongan reasoning yang tiba saat streaming (hanya provider OpenAI-compatible yang mengirimnya). */
  onThinking?: (text: string) => void
}): Conversation | null {
  const effort = cfg.reasoningEffort ?? 'low'
  if (cfg.provider === 'anthropic') return cfg.anthropicKey ? anthropicConversation(system, user, tools, cfg.model, cfg.anthropicKey, effort) : null
  if (cfg.provider === 'openai-compatible') {
    if (!cfg.openaiBaseUrl || !cfg.openaiKey) return null
    return openAiConversation(system, user, tools, { baseUrl: cfg.openaiBaseUrl, apiKey: cfg.openaiKey, model: cfg.model, effort, structured: cfg.structured ?? true, onThinking: cfg.onThinking })
  }
  return null
}
