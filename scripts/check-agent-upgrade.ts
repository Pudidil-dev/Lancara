// Model live dengan executor sintetis, tanpa koneksi/write database aplikasi.
import fs from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { loadEnvFiles } from './load-env'
import { env } from '../src/lib/env'
import { demoSnapshot24h, DEMO_24H_CLOCK } from '../src/modules/events/fixture-24h'
import { buildAgentContext } from '../src/modules/support/context'
import { AGENT_PROMPT } from '../src/modules/agent/agent-prompt'
import { createConversation, runToolAgent } from '../src/modules/agent/runner'
import { buildEditedRundown, EditRundownInputSchema, recommendReschedules } from '../src/modules/agent/rescheduling'
import { guardRequestedTarget, resolveTargetFocus } from '../src/modules/agent/targeting'
import { toolsForCapability, type ToolOutcome } from '../src/modules/agent/tools'
import { analyze } from '../src/modules/engine/analyze'
import { prepareAttachments } from '../src/modules/support/attachments'
import type { AgentAttachment } from '../src/modules/support/limits'

async function main() {
  loadEnvFiles()
  const cfg = env()
  const snapshot = demoSnapshot24h()
  snapshot.items.find(i => i.id === 'dj-malam')!.status = 'cancelled'
  const context = buildAgentContext({ display_name: 'Demo', role_label: 'Koordinator', capability: 'coordinator' }, snapshot, 3, DEMO_24H_CLOCK, 'confirm')
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([550, 250])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText('UPDATE JADWAL: Talent I -- Penutup Musik', { x: 30, y: 200, size: 16, font })
  page.drawText('Jadwal baru: 23.30 WIB, durasi tetap 30 menit.', { x: 30, y: 170, size: 14, font })
  const document: AgentAttachment = { name: 'update-talent-i.pdf', mime_type: 'application/pdf', data: Buffer.from(await pdf.save()).toString('base64') }
  const cases: Array<{ id: string; message: string; history: Array<{ role: 'user' | 'assistant'; text: string }>; attachments: AgentAttachment[]; expected: 'move' | 'extract' }> = [
    { id: 'talent-i-exact', message: 'Mengubah jadwal Talent I menjadi 23.30 WIB, durasi tetap. DJ malam sudah batal. Buat pratinjau.', history: [], attachments: [], expected: 'move' },
    { id: 'talent-i-memory', message: 'Oke ganti jadwalnya sesuai jam yang tadi saya minta. Buat pratinjau.', history: [{ role: 'user', text: 'Ubah Talent I menjadi 23.30 WIB.' }, ...Array.from({ length: 8 }, (_, i) => ({ role: 'assistant' as const, text: `Catatan ${i}: Talent H tetap seperti jadwal server.` }))], attachments: [], expected: 'move' },
    { id: 'pdf-read', message: 'Baca PDF terlampir. Sebutkan nama talent, jam baru, dan durasi di dokumen. Jangan membuat perubahan.', history: [], attachments: [document], expected: 'extract' },
  ]
  const imagePath = process.argv.find(value => value.startsWith('--image='))?.slice('--image='.length)
  if (imagePath) {
    const image = await fs.readFile(imagePath)
    cases.push({ id: 'image-read', message: 'Baca gambar terlampir. Sebutkan nama talent, jam baru dan durasi pada gambar. Jangan membuat perubahan.', history: [], attachments: [{ name: 'update-talent-i.png', mime_type: 'image/png', data: image.toString('base64') }], expected: 'extract' })
    const scan = await PDFDocument.create()
    const picture = await scan.embedPng(image)
    const scanPage = scan.addPage([680, 200])
    scanPage.drawImage(picture, { x: 0, y: 0, width: 680, height: 200 })
    cases.push({ id: 'pdf-scan-read', message: 'Baca PDF scan terlampir. Sebutkan nama talent, jam baru dan durasi pada dokumen. Jangan membuat perubahan.', history: [], attachments: [{ name: 'update-talent-i-scan.pdf', mime_type: 'application/pdf', data: Buffer.from(await scan.save()).toString('base64') }], expected: 'extract' })
  }
  const selected = process.argv.find(value => value.startsWith('--case='))?.slice('--case='.length)
  const selectedCases = selected ? cases.filter(test => test.id === selected) : cases
  if (!selectedCases.length) throw new Error('case_not_found')
  const records: Array<Record<string, unknown> & { case: string; passed: boolean }> = []
  for (const test of selectedCases) {
    const files = await prepareAttachments(test.attachments)
    const focus = resolveTargetFocus(test.message, test.history, snapshot)
    const user = JSON.stringify({ context, request: { message: test.message, history: test.history, target: focus } })
    const channel = createConversation(AGENT_PROMPT, user, toolsForCapability('coordinator'), { provider: cfg.AI_PROVIDER, model: cfg.AI_MODEL, anthropicKey: cfg.ANTHROPIC_API_KEY, openaiBaseUrl: cfg.OPENAI_BASE_URL, openaiKey: cfg.OPENAI_API_KEY, reasoningEffort: cfg.AGENT_REASONING_EFFORT, structured: false, limits: { contextTokens: cfg.AGENT_CONTEXT_TOKENS, outputTokens: cfg.AGENT_MAX_OUTPUT_TOKENS }, attachments: files })
    if (!channel) throw new Error('provider_unavailable')
    const diffs: Array<{ item_id: string; start_at: string }> = []
    const started = Date.now()
    let run
    let failure: string | null = null
    try {
      run = await runToolAgent(channel, async (name, raw): Promise<ToolOutcome> => {
        const mismatch = guardRequestedTarget(snapshot, focus, name, raw, DEMO_24H_CLOCK)
        if (mismatch) return { ok: false, error: mismatch }
        if (name === 'get_rundown_summary' || name === 'get_event_context') return { ok: true, data: { ...context, version: 3, base_version: 3, items: context.rundown.items } }
        if (name === 'recommend_reschedule') return { ok: true, data: { base_version: 3, recommendations: recommendReschedules(snapshot, DEMO_24H_CLOCK, focus.item_ids) } }
        if (name === 'edit_rundown') {
          try {
            const input = EditRundownInputSchema.parse(raw)
            if (input.base_version !== 3) return { ok: false, error: 'Versi berubah; baca ulang.' }
            const proposed = buildEditedRundown(snapshot, input, DEMO_24H_CLOCK)
            const candidate = analyze({ base: snapshot, delta: { type: 'revise_rundown', snapshot: proposed, is_estimate: false, reference_at: DEMO_24H_CLOCK }, analysisNow: DEMO_24H_CLOCK }).candidates[0]
            diffs.push(...candidate.diff.map(d => ({ item_id: d.item_id, start_at: d.new.start_at })))
            return { ok: true, data: { applied: false, status: 'preview_ready', label: input.summary, base_version: 3, diff: candidate.diff, requires_website_confirmation: true } }
          } catch { return { ok: false, error: 'Rencana belum valid; baca batas server lalu perbaiki.' } }
        }
        return { ok: false, error: 'Gunakan edit_rundown untuk pemindahan tepat, atau cukup baca dokumen bila tidak diminta perubahan.' }
      })
    } catch (error) { failure = (error as Error).name + ':' + ((error as Error).message === 'provider_http_error' ? 'provider_http_error' : 'provider_unavailable') }
    const passed = test.expected === 'move'
      ? diffs.some(d => d.item_id === 'talent-i' && d.start_at === '2026-10-09T16:30:00.000Z') && !diffs.some(d => d.item_id === 'talent-h')
      : /talent\s+i/i.test(run?.text ?? '') && /23[.:]30/.test(run?.text ?? '') && /30/.test(run?.text ?? '') && diffs.length === 0
    const record = { case: test.id, passed, model: cfg.AI_MODEL, effort: cfg.AGENT_REASONING_EFFORT, limits: { context: cfg.AGENT_CONTEXT_TOKENS, output: cfg.AGENT_MAX_OUTPUT_TOKENS }, ms: Date.now() - started, answer: run?.text ?? null, steps: run?.steps ?? [], diffs, reasoning_tokens: channel.reasoningTokens?.() ?? null, failure, database_writes: 0 }
    records.push(record)
    console.log(JSON.stringify(record))
  }
  const folder = path.resolve('../docs/ripple/evidence/agent-upgrade')
  await fs.mkdir(folder, { recursive: true })
  let prior: Array<{ case: string }> = []
  if (selected) {
    try { prior = JSON.parse(await fs.readFile(path.join(folder, 'live-results.json'), 'utf8')) } catch { /* Run pertama. */ }
  }
  await fs.writeFile(path.join(folder, 'live-results.json'), JSON.stringify([...prior.filter(record => !records.some(next => next.case === record.case)), ...records], null, 2))
  if (records.some(r => !r.passed)) process.exitCode = 1
}
main().catch(() => { console.error('Verifikasi live belum selesai; credential/provider tidak dicetak.'); process.exitCode = 1 })
