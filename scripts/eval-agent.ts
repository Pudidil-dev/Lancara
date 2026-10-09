import fs from 'node:fs/promises'
import path from 'node:path'
import { loadEnvFiles } from './load-env'
import { env } from '../src/lib/env'
import { AGENT_DATASET, goldReply, simulateTool, simulationSummary, type AgentCase } from '../src/modules/agent/dataset'
import { AGENT_REPLY_JSON_SCHEMA, AgentReplySchema, validateReply, type AgentEvidence } from '../src/modules/agent/contract'
import { AGENT_ROUTES, ROUTE_RULES, REASONING_PROFILES, reasoningProfileFor } from '../src/modules/agent/policy'
import { SYSTEM_PROMPT } from '../src/modules/agent/prompt'
import { buildAgentRequest, createConversation, runStructuredAgent, MAX_ROUNDS, MAX_TOOL_CALLS, TOTAL_TIMEOUT_MS, type Conversation, type Turn } from '../src/modules/agent/runner'
import { toolsForCapability } from '../src/modules/agent/tools'
import { groundingFacts } from '../src/modules/support/knowledge'

function user(sample: AgentCase) {
  return JSON.stringify({ context: { capability: sample.capability, event_version: 1, timezone: 'Asia/Jakarta' }, facts: groundingFacts(), message: sample.message })
}

async function trajectory(sample: AgentCase) {
  const final = await goldReply(sample)
  const messages: unknown[] = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user(sample) }]
  if (!['workflow_help', 'scope_guard'].includes(sample.route)) {
    messages.push({ role: 'assistant', content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'get_rundown_summary', arguments: '{}' } }] })
    messages.push({ role: 'tool', tool_call_id: 'read', content: JSON.stringify({ tool_call_id: 'read', ok: true, result: simulationSummary() }) })
    if (sample.proposal) {
      const args = { ...sample.proposal, minutes: sample.proposal.minutes ?? null, time_hhmm: sample.proposal.time_hhmm ?? null }
      const outcome = await simulateTool('propose_schedule_change', args)
      messages.push({ role: 'assistant', content: null, tool_calls: [{ id: 'preview', type: 'function', function: { name: 'propose_schedule_change', arguments: JSON.stringify(args) } }] })
      messages.push({ role: 'tool', tool_call_id: 'preview', content: JSON.stringify({ tool_call_id: 'preview', ok: outcome.ok, result: outcome.ok ? outcome.data : { error: outcome.error } }) })
    }
  }
  messages.push({ role: 'assistant', content: JSON.stringify(final) })
  return { id: sample.id, split: sample.split, expected_route: sample.route, synthetic: true, messages }
}

async function main() {
  loadEnvFiles()
  const args = process.argv.slice(2)
  const live = args.includes('--live')
  const split = args.find(arg => arg.startsWith('--split='))?.slice(8) ?? (live ? 'validation' : 'all')
  const repeat = Number(args.find(arg => arg.startsWith('--repeat='))?.slice(9) ?? 1)
  const concurrency = Number(args.find(arg => arg.startsWith('--concurrency='))?.slice(14) ?? 1)
  const routeFilter = args.find(arg => arg.startsWith('--routes='))?.slice(9).split(',')
  if (routeFilter?.some(route => !(AGENT_ROUTES as readonly string[]).includes(route))) throw new Error('Filter route tidak dikenal.')
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) throw new Error('Concurrency maksimal 2; hanya executor simulasi.')
  if (!['train', 'validation', 'test', 'all'].includes(split) || !Number.isInteger(repeat) || repeat < 1 || repeat > 5) throw new Error('Gunakan split train|validation|test|all dan repeat 1..5.')
  if (live && (split === 'train' || split === 'all')) throw new Error('Evaluasi live hanya validation atau test; training tidak dicampur.')
  const outputDir = path.resolve(process.cwd(), args.find(arg => arg.startsWith('--out='))?.slice(6) ?? '../docs/ripple/evidence/agent-9-router')
  await fs.mkdir(outputDir, { recursive: true })
  const pack = {
    schema_version: 'ripple-agent-prompt.v1', synthetic_example: true,
    routers: ROUTE_RULES, limits: { max_rounds: MAX_ROUNDS, max_tool_calls: MAX_TOOL_CALLS, timeout_ms: TOTAL_TIMEOUT_MS },
    reasoning_profiles: REASONING_PROFILES,
    response_schema: AGENT_REPLY_JSON_SCHEMA,
    request_example: buildAgentRequest(SYSTEM_PROMPT, user(AGENT_DATASET[0]), toolsForCapability('coordinator'), '<model-dari-konfigurasi-server>'),
    analysis_request_example: buildAgentRequest(SYSTEM_PROMPT, user(AGENT_DATASET.find(sample => sample.route === 'delay_report')!), toolsForCapability('coordinator'), '<model-dari-konfigurasi-server>', 'high'),
    account_tools: toolsForCapability('coordinator'),
    research_sources: [
      'https://hermes-agent.nousresearch.com/docs/developer-guide/architecture/',
      'https://hermes-agent.nousresearch.com/docs/user-guide/security/',
      'https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/',
      'https://hermes-agent.nousresearch.com/docs/getting-started/learning-path/',
    ],
    training: { method: 'dataset_dan_evaluasi_prompt', weights_updated: false, export_contains_only_synthetic_data: true, evaluation_examples_in_system_prompt: false },
  }
  await fs.writeFile(path.join(outputDir, 'prompt.json'), JSON.stringify(pack, null, 2))
  const trajectories = await Promise.all(AGENT_DATASET.map(trajectory))
  for (const part of ['train', 'validation', 'test']) await fs.writeFile(path.join(outputDir, `${part}.jsonl`), trajectories.filter(row => row.split === part).map(row => JSON.stringify(row)).join('\n') + '\n')
  const cfg = live ? env() : null
  const records: Array<{ id: string; repeat: number; route: string | null; expected_route: string; passed: boolean; model_called: boolean; tool_calls: number; ms: number; reply: unknown; failure: string | null; diagnostics: unknown; effort: string; reasoning_tokens: number | null }> = []
  const samples = AGENT_DATASET.filter(sample => (split === 'all' || sample.split === split) && (!routeFilter || routeFilter.includes(sample.route)))
  async function evaluate(sample: AgentCase, iteration: number) {
    const started = Date.now()
    let steps = 0
    let calls = 0
    let reply = null
    let failure: string | null = null
    let diagnostics: unknown = null
    let reasoningTokens: number | null = null
    const profile = reasoningProfileFor(sample.message)
    try {
      if (live && cfg) {
        const conversation = createConversation(SYSTEM_PROMPT, user(sample), toolsForCapability(sample.capability), { provider: cfg.AI_PROVIDER, model: cfg.AI_MODEL, anthropicKey: cfg.ANTHROPIC_API_KEY, openaiBaseUrl: cfg.OPENAI_BASE_URL, openaiKey: cfg.OPENAI_API_KEY, reasoningEffort: profile.effort })
        if (!conversation) throw new Error('provider_unavailable')
        const observed: Conversation = { step: async () => {
          steps++
          const turn = await conversation.step()
          if (turn.kind === 'text' && turn.text) {
            try {
              const parsed = JSON.parse(turn.text)
              const shape = AgentReplySchema.safeParse(parsed)
              diagnostics = { json: true, schema: shape.success, route: AGENT_ROUTES.includes(parsed.route) ? parsed.route : 'unknown', status: ['answer', 'needs_clarification', 'proposal_ready', 'no_feasible_option', 'refused'].includes(parsed.status) ? parsed.status : 'unknown', cited_ids: Array.isArray(parsed.evidence_tool_call_ids) ? parsed.evidence_tool_call_ids.filter((id: unknown) => typeof id === 'string' && /^[\w-]{1,100}$/.test(id as string)).slice(0, 3) : [], issues: shape.success ? [] : shape.error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code })) }
            } catch { diagnostics = { json: false } }
          }
          return turn
        }, pushResults: results => conversation.pushResults(results) }
        reply = await runStructuredAgent(observed, async (name, input) => { calls++; return simulateTool(name, input) }, { capability: sample.capability, message: sample.message })
        reasoningTokens = conversation.reasoningTokens?.() ?? null
      } else {
        const gold = await goldReply(sample)
        const evidence: AgentEvidence[] = [{ id: 'read', name: 'get_rundown_summary', data: simulationSummary() }]
        if (sample.proposal) {
          const outcome = await simulateTool('propose_schedule_change', sample.proposal)
          if (outcome.ok) evidence.push({ id: 'preview', name: 'propose_schedule_change', kind: sample.proposal.kind, data: outcome.data })
        }
        reply = validateReply(gold, evidence)
      }
    } catch { failure = 'provider_or_execution_error' }
    const gold = await goldReply(sample)
    const passed = !!reply && reply.route === sample.route && reply.status === gold.status
    const record = { id: sample.id, repeat: iteration + 1, route: reply?.route ?? null, expected_route: sample.route, passed, model_called: steps > 0, tool_calls: calls, ms: Date.now() - started, reply, failure: failure ?? (passed ? null : 'schema_grounding_route_or_status_mismatch'), diagnostics, effort: profile.effort, reasoning_tokens: reasoningTokens }
    records.push(record)
    if (live) console.log(JSON.stringify({ id: record.id, repeat: record.repeat, passed, route: record.route, effort: record.effort, reasoning_tokens: reasoningTokens, model_called: record.model_called, tool_calls: calls, ms: record.ms }))
  }
  const queue = samples.flatMap(sample => Array.from({ length: repeat }, (_, iteration) => ({ sample, iteration })))
  let cursor = 0
  await Promise.all(Array.from({ length: concurrency }, async () => { while (cursor < queue.length) { const task = queue[cursor++]; await evaluate(task.sample, task.iteration) } }))
  const latencies = records.filter(row => row.model_called).map(row => row.ms).sort((a, b) => a - b)
  const report = { mode: live ? 'live_model_engine_simulation' : 'offline_gold_contract', provider: cfg?.AI_PROVIDER ?? null, model: cfg?.AI_MODEL ?? null, split, repeat, concurrency, route_filter: routeFilter ?? null, reasoning_policy: 'adaptive_low_high', weights_updated: false, database_writes: 0, total: records.length, passed: records.filter(row => row.passed).length, model_calls_evaluated: records.filter(row => row.model_called).length, latency_ms: { p50: latencies[Math.max(0, Math.ceil(latencies.length * 0.50) - 1)] ?? null, p95: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? null },
    routes: AGENT_ROUTES.map(route => ({ route, total: records.filter(row => row.expected_route === route).length, passed: records.filter(row => row.expected_route === route && row.passed).length })), records }
  const reportName = live ? `live-${split}.json` : 'offline-validation.json'
  await fs.writeFile(path.join(outputDir, reportName), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ mode: report.mode, total: report.total, passed: report.passed, model_cases: report.model_calls_evaluated, artifact: path.join(outputDir, reportName), dataset: { train: trajectories.filter(row => row.split === 'train').length, validation: trajectories.filter(row => row.split === 'validation').length, test: trajectories.filter(row => row.split === 'test').length } }))
  if (report.passed !== report.total) process.exitCode = 1
}
main().catch(() => { console.error('Evaluasi agent gagal; detail provider dan environment tidak dicetak.'); process.exitCode = 1 })
