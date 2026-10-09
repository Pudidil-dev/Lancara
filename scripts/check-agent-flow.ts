// Uji model live dengan konteks dan executor sintetis; tidak ada write database.
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadEnvFiles } from './load-env'
import { env } from '../src/lib/env'
import { demoSnapshot, DEMO_CLOCK } from '../src/modules/events/fixture'
import { buildAgentContext } from '../src/modules/support/context'
import { AGENT_PROMPT } from '../src/modules/agent/agent-prompt'
import { reasoningProfileFor } from '../src/modules/agent/policy'
import { buildAgentRequest, createConversation, runToolAgent } from '../src/modules/agent/runner'
import { toolsForCapability, type ToolOutcome } from '../src/modules/agent/tools'
import { simulateTool, simulationSummary } from '../src/modules/agent/dataset'

async function main() {
  loadEnvFiles()
  const cfg = env()
  const directory = path.resolve('../docs/ripple/evidence/agent-open-flow')
  await fs.mkdir(directory, { recursive: true })
  const context = buildAgentContext({ display_name: 'Koordinator demo', role_label: 'Koordinator', capability: 'coordinator' }, demoSnapshot(), 1, DEMO_CLOCK, 'auto')
  await fs.writeFile(path.join(directory, 'context.json'), JSON.stringify(context, null, 2))
  const cases = [
    { id: 'general', message: 'Buatkan contoh sambutan singkat untuk acara komunitas.', mutation: false },
    { id: 'technical', message: 'Jelaskan konsep SQL untuk pemula dalam dua kalimat.', mutation: false },
    { id: 'direct-change', message: 'Talent B baru bisa mulai jam 20.05. Sesuaikan jadwalnya.', mutation: true },
    { id: 'ambiguous-change', message: 'talent telat 50 menit, sesuaikan jadwalnya', mutation: true },
  ]
  const records = []
  for (const sample of cases) {
    let writes = 0
    const payload = JSON.stringify({ context, application_guide: 'Data demo fiktif. Semua eksekusi tool dalam pengujian ini adalah simulasi.', request: { message: sample.message, history: [] } })
    if (sample.id === 'direct-change') await fs.writeFile(path.join(directory, 'request.json'), JSON.stringify(buildAgentRequest(AGENT_PROMPT, payload, toolsForCapability('coordinator'), cfg.AI_MODEL, 'high', false), null, 2))
    const channel = createConversation(AGENT_PROMPT, payload, toolsForCapability('coordinator'), { provider: cfg.AI_PROVIDER, model: cfg.AI_MODEL, anthropicKey: cfg.ANTHROPIC_API_KEY, openaiBaseUrl: cfg.OPENAI_BASE_URL, openaiKey: cfg.OPENAI_API_KEY, reasoningEffort: reasoningProfileFor(sample.message).effort, structured: false })
    if (!channel) throw new Error('provider_unavailable')
    const started = Date.now()
    const result = await runToolAgent(channel, async (name, input): Promise<ToolOutcome> => {
      if (name === 'get_rundown_summary') return { ok: true, data: { ...simulationSummary(), autonomy: 'otonom' } }
      if (['list_changes', 'get_history', 'get_my_inbox'].includes(name)) return { ok: true, data: { changes: [], decisions: [], briefs: [], active_version: 1 } }
      const simulated = await simulateTool(name, input)
      if (!simulated.ok || name !== 'propose_schedule_change') return simulated
      const data = simulated.data as { candidates: unknown[] }
      if (!data.candidates.length) return { ok: true, data: { ...data, applied: false } }
      writes++
      return { ok: true, data: { ...data, applied: true, applied_option: data.candidates[0], new_version: 2, briefs_sent: 5, simulation_only: true } }
    })
    const passed = !!result.text && !result.text.includes('Asisten hanya melayani') && (sample.mutation ? writes === 1 : writes === 0)
    const record = { id: sample.id, passed, answer: result.text, steps: result.steps, simulated_actions: writes, database_writes: 0, ms: Date.now() - started }
    records.push(record)
    console.log(JSON.stringify({ id: sample.id, passed, simulated_actions: writes, steps: result.steps.length, ms: record.ms }))
  }
  const report = { mode: 'live_model_simulated_website_tools', provider: cfg.AI_PROVIDER, model: cfg.AI_MODEL, database_writes: 0, total: records.length, passed: records.filter(record => record.passed).length, records }
  await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2))
  if (report.passed !== report.total) process.exitCode = 1
}
main().catch(() => { console.error('Verifikasi gagal; detail provider dan credential tidak dicetak.'); process.exitCode = 1 })
