// Live LLM, data fiktif, tool murni: tidak ada koneksi/write database.
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadEnvFiles } from './load-env'
import { env } from '../src/lib/env'
import { demoSnapshot, DEMO_CLOCK } from '../src/modules/events/fixture'
import { buildAgentContext } from '../src/modules/support/context'
import { AGENT_PROMPT } from '../src/modules/agent/agent-prompt'
import { createConversation, runToolAgent } from '../src/modules/agent/runner'
import { toolsForCapability, type ToolOutcome } from '../src/modules/agent/tools'
import { buildEventConfiguration } from '../src/modules/agent/configuration'
import { diffConfiguration } from '../src/modules/engine/revision'
import { reasoningProfileFor } from '../src/modules/agent/policy'

async function main() {
  loadEnvFiles()
  const cfg = env()
  const snapshot = demoSnapshot()
  const context = buildAgentContext({ display_name: 'Demo', role_label: 'Koordinator', capability: 'coordinator' }, snapshot, 1, DEMO_CLOCK, 'confirm')
  const message = 'Ubah nama acara menjadi Festival LANCARA dan nama peran MC menjadi Host. Buat perubahan.'
  const effort = reasoningProfileFor(message).effort
  const conversation = createConversation(AGENT_PROMPT, JSON.stringify({ context, request: { message, history: [] } }), toolsForCapability('coordinator'), { provider: cfg.AI_PROVIDER, model: cfg.AI_MODEL, anthropicKey: cfg.ANTHROPIC_API_KEY, openaiBaseUrl: cfg.OPENAI_BASE_URL, openaiKey: cfg.OPENAI_API_KEY, reasoningEffort: effort, structured: false })
  if (!conversation) throw new Error('provider_unavailable')
  let previews = 0
  let correct = false
  const started = Date.now()
  const run = await runToolAgent(conversation, async (name, input): Promise<ToolOutcome> => {
    if (name === 'get_event_context') return { ok: true, data: context }
    if (name === 'get_rundown_summary') return { ok: true, data: { version: 1, items: context.rundown.items } }
    if (name !== 'edit_event_configuration') return { ok: false, error: 'Gunakan edit_event_configuration untuk permintaan ini.' }
    try {
      const proposed = buildEventConfiguration(snapshot, input, DEMO_CLOCK)
      if ((input as { base_version: number }).base_version !== 1) return { ok: false, error: 'Baca versi aktif.' }
      previews++
      correct = proposed.event.name === 'Festival LANCARA' && proposed.roles.find(role => role.id === 'mc')?.label === 'Host'
      return { ok: true, data: { applied: false, status: 'menunggu_konfirmasi', configuration_changes: diffConfiguration(snapshot, proposed), note: 'Bubble preview tersimpan. Database aktif belum berubah; koordinator klik Ya, ubah rundown.' } }
    } catch { return { ok: false, error: 'Input belum valid; periksa operasi dan versi.' } }
  })
  const result = { provider: cfg.AI_PROVIDER, model: cfg.AI_MODEL, effort, previews, correct_changes: correct, database_writes: 0, passed: correct && previews === 1 && !!run.text && !/sudah (?:diterapkan|dikirim)|sudah (?:diubah|tersimpan)/i.test(run.text), ms: Date.now() - started, reasoning_tokens: conversation.reasoningTokens?.() ?? null, answer: run.text, steps: run.steps }
  const directory = path.resolve('../docs/ripple/evidence/agent-configuration')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'live-results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ passed: result.passed, effort, previews, database_writes: 0, ms: result.ms }))
  if (!result.passed) process.exitCode = 1
}
main().catch(() => { console.error('Uji live belum selesai; detail credential/provider tidak dicetak.'); process.exitCode = 1 })
