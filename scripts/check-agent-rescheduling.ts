// Model live, konteks fiktif dan executor murni. Tidak menghubungkan atau menulis database.
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadEnvFiles } from './load-env'
import { env } from '../src/lib/env'
import { formatClock } from '../src/lib/time'
import { demoSnapshot24h, DEMO_24H_CLOCK } from '../src/modules/events/fixture-24h'
import { buildAgentContext } from '../src/modules/support/context'
import { AGENT_PROMPT } from '../src/modules/agent/agent-prompt'
import { reasoningProfileFor } from '../src/modules/agent/policy'
import { createConversation, runToolAgent } from '../src/modules/agent/runner'
import { toolsForCapability, type ToolOutcome } from '../src/modules/agent/tools'
import { buildEditedRundown, EditRundownInputSchema, recommendReschedules } from '../src/modules/agent/rescheduling'
import { analyze } from '../src/modules/engine/analyze'

async function main() {
  loadEnvFiles()
  const cfg = env()
  const snapshot = demoSnapshot24h()
  snapshot.items.find(i => i.id === 'dj-malam')!.status = 'cancelled'
  snapshot.items.find(i => i.id === 'doa-refleksi')!.swappable = false
  snapshot.constraints.push({ id: 'early-acoustic', item_id: 'akustik-malam', type: 'earliest_start', at: snapshot.items.find(i => i.id === 'akustik-malam')!.start_at, hard: true })
  const context = buildAgentContext({ display_name: 'Demo', role_label: 'Koordinator', capability: 'coordinator' }, snapshot, 3, DEMO_24H_CLOCK, 'confirm')
  const directory = path.resolve('../docs/ripple/evidence/agent-rescheduling')
  await fs.mkdir(directory, { recursive: true })
  const records = []
  for (const message of ['lakukan saja reschedule yang efektif kasih rekomendastion', 'ok ganti']) {
    let previews = 0
    let correctDate = false
    const effort = reasoningProfileFor(message).effort
    const user = JSON.stringify({ context, request: { message, history: [{ role: 'assistant', text: 'Alternatif: majukan Talkshow Dini Hari dari 00.20 ke 23.00 untuk mengisi slot DJ yang batal.' }] } })
    const conversation = createConversation(AGENT_PROMPT, user, toolsForCapability('coordinator'), { provider: cfg.AI_PROVIDER, model: cfg.AI_MODEL, anthropicKey: cfg.ANTHROPIC_API_KEY, openaiBaseUrl: cfg.OPENAI_BASE_URL, openaiKey: cfg.OPENAI_API_KEY, reasoningEffort: effort, structured: false })
    if (!conversation) throw new Error('provider_unavailable')
    const started = Date.now()
    const run = await runToolAgent(conversation, async (name, raw): Promise<ToolOutcome> => {
      if (name === 'get_rundown_summary') return { ok: true, data: { version: 3, autonomy: 'konfirmasi', now: formatClock(DEMO_24H_CLOCK, snapshot.event.timezone), timezone: snapshot.event.timezone, items: context.rundown.items } }
      if (name === 'recommend_reschedule') return { ok: true, data: { base_version: 3, applied: false, recommendations: recommendReschedules(snapshot, DEMO_24H_CLOCK) } }
      if (name === 'edit_rundown') {
        try {
          const input = EditRundownInputSchema.parse(raw)
          if (input.base_version !== 3) return { ok: false, error: 'Versi tidak sama; baca ulang.' }
          const proposed = buildEditedRundown(snapshot, input, DEMO_24H_CLOCK)
          const candidate = analyze({ base: snapshot, delta: { type: 'revise_rundown', snapshot: proposed, is_estimate: false, reference_at: DEMO_24H_CLOCK }, analysisNow: DEMO_24H_CLOCK }).candidates[0]
          previews++
          correctDate = candidate.diff.some(d => d.item_id === 'talkshow-dini' && d.new.start_at === '2026-10-09T16:00:00.000Z')
          return { ok: true, data: { applied: false, status: 'menunggu_konfirmasi', base_version: 3, recommended_option: { label: candidate.label, changes: candidate.diff }, note: 'Preview siap; aktif masih v3. Konfirmasi melalui dialog website.' } }
        } catch { return { ok: false, error: 'Rencana belum valid; gunakan operations dari recommend_reschedule.' } }
      }
      return { ok: false, error: 'Dalam simulasi ini gunakan recommend_reschedule dan edit_rundown.' }
    })
    const record = { message, effort, passed: previews === 1 && correctDate && !!run.text && !/sudah (?:diterapkan|dikirim)|rundown sekarang v4/i.test(run.text), previews, correct_date: correctDate, database_writes: 0, reasoning_tokens: conversation.reasoningTokens?.() ?? null, ms: Date.now() - started, answer: run.text, steps: run.steps }
    records.push(record)
    console.log(JSON.stringify({ message, passed: record.passed, effort, previews, ms: record.ms }))
    await fs.writeFile(path.join(directory, 'live-results.json'), JSON.stringify({ provider: cfg.AI_PROVIDER, model: cfg.AI_MODEL, database_writes: 0, records }, null, 2))
  }
  if (records.some(record => !record.passed)) process.exitCode = 1
}
main().catch(() => { console.error('Uji live belum selesai; detail credential/provider tidak dicetak.'); process.exitCode = 1 })
