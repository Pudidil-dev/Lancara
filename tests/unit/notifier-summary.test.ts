import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSummaryInput, summarize, templateParagraph, validateParagraph } from '@/modules/notifier/summarize'
import type { NotificationPayload } from '@/modules/notifier/types'
import { at } from '@/modules/events/fixture'

const mocks = vi.hoisted(() => ({
  config: { AI_PROVIDER: 'rule', AI_MODEL: 'gateway-summary', NOTIFIER_SUMMARY_MODEL: 'claude-haiku-5-5',
    NOTIFIER_LLM_TIMEOUT_MS: 8000, ANTHROPIC_API_KEY: 'mock-anthropic-key', OPENAI_API_KEY: 'mock-gateway-key', OPENAI_BASE_URL: 'https://gateway.example/v1' },
  anthropic: vi.fn(), fetch: vi.fn<typeof fetch>(),
}))
vi.mock('@/lib/env', () => ({ env: () => mocks.config }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class {
  beta = { messages: { create: mocks.anthropic } }
} }))

function payload(): NotificationPayload {
  return {
    schema_version: 1, kind: 'schedule.version.committed', idempotency_key: 'notify:event:v2', correlation_id: 'correlation',
    event: { id: 'event', name: 'Acara Demo', timezone: 'Asia/Jakarta', curfew_at: at('21:00') },
    version: 2, base_version: 1, origin: 'decision', committed_at: at('18:40'), actor: { actor_id: 'rina', display_name: 'Rina' },
    decision: { decision_id: 'decision', change_seq: 1, kind: 'report', patch_label: 'Tukar', reason: 'Talent B terlambat 50 menit' },
    changes: [{ item_id: 'talent-b', title: 'Talent B', kind: 'changed', changes: ['start'], shift_minutes: 50,
      old: { start_at: at('19:15'), end_at: at('19:45'), duration_seconds: 1800, status: 'pending' },
      new: { start_at: at('20:05'), end_at: at('20:35'), duration_seconds: 1800, status: 'pending' } },
    { item_id: 'panel', title: 'Panel', kind: 'changed', changes: ['start'], shift_minutes: -50,
      old: { start_at: at('20:05'), end_at: at('20:35'), duration_seconds: 1800, status: 'pending' },
      new: { start_at: at('19:15'), end_at: at('19:45'), duration_seconds: 1800, status: 'pending' } }],
    items_changed: 2, projected_finish_at: at('20:45'),
    impact: [
      { role_id: 'audio', role_label: 'PIC Audio', level: 'ACTION_REQUIRED', entries: [{ item_id: 'talent-b', title: 'Talent B', reason: 'Jam berubah' }] },
      { role_id: 'lo', role_label: 'LO Talent', level: 'ACTION_REQUIRED', entries: [{ item_id: 'talent-b', title: 'Talent B', reason: 'Jam berubah' }] },
      { role_id: 'mc', role_label: 'MC', level: 'FYI', entries: [] },
    ], roles: [{ id: 'audio', label: 'PIC Audio' }, { id: 'lo', label: 'LO Talent' }, { id: 'mc', label: 'MC' }, { id: 'led', label: 'PIC LED / Visual' }],
  }
}

const valid = 'Talent B dimundurkan dari 19.15 ke 20.05 WIB; Panel dimajukan dari 20.05 ke 19.15 WIB. Perkiraan selesai 20.45 WIB, 15 menit sebelum batas 21.00. PIC Audio dan LO Talent perlu menyesuaikan persiapan.'
const completion = (value: unknown = { paragraph: valid }, finish_reason = 'stop') => Response.json({ choices: [{ finish_reason, message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] })

beforeEach(() => {
  mocks.config.AI_PROVIDER = 'rule'; mocks.config.NOTIFIER_LLM_TIMEOUT_MS = 8000
  mocks.fetch.mockReset(); mocks.anthropic.mockReset(); vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('notifier deterministic input and fallback', () => {
  it('formats event timezone and exposes only schedule data to the LLM', () => {
    const p = payload(); p.event.timezone = 'Asia/Makassar'
    const input = buildSummaryInput(p)
    expect(input).toMatchObject({ zone: 'WITA', finish: '21.45', curfew: '22.00', slack_minutes: 15 })
    expect(input.changes.find(change => change.title === 'Talent B')).toMatchObject({ from: '20.15', to: '21.05', minutes: 50 })
    expect(input.actions.map(action => action.role)).toEqual(['PIC Audio', 'LO Talent'])
    expect(JSON.stringify(input)).not.toContain('Rina')
    expect(JSON.stringify(input)).not.toContain('decision_id')
  })
  it('uses consistent template for the largest changes, finish, and action roles', async () => {
    const p = payload()
    const template = templateParagraph(p)
    expect(template).toContain('Talent B dimundurkan dari 19.15 ke 20.05 WIB')
    expect(template).toContain('Panel dimajukan dari 20.05 ke 19.15 WIB')
    expect(template).toContain('15 menit sebelum batas 21.00')
    expect(template).toContain('Perlu tindakan: PIC Audio, LO Talent.')
    expect(template.length).toBeLessThanOrEqual(450)
    expect(await summarize(p)).toEqual({ paragraph: template, source: 'template' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('handles cancelled, added, other changed items, and curfew overflow', () => {
    const p = payload(); p.changes[0].new.status = 'cancelled'; p.items_changed = 4; p.projected_finish_at = at('21:05')
    expect(templateParagraph(p)).toContain('Talent B dibatalkan')
    expect(templateParagraph(p)).toContain('2 segmen lain ikut berubah')
    expect(templateParagraph(p)).toContain('lewat 5 menit dari batas 21.00')
    p.changes = [{ ...p.changes[0], kind: 'added', old: null, changes: ['added'], shift_minutes: 0, new: { ...p.changes[0].new, status: 'pending' } }]
    expect(templateParagraph(p)).toContain('Talent B ditambahkan pada 20.05 WIB')
  })
  it('uses origin-specific import/settings templates with the event name', () => {
    const p = payload(); p.origin = 'import'; p.changes = []
    p.import_summary = { item_count: 12, first_start_at: at('18:00'), last_end_at: at('20:45'), filename: 'secret-not-needed.pdf' }
    expect(templateParagraph(p)).toBe('Rundown Acara Demo diaktifkan dari impor PDF: 12 segmen, 18.00–20.45 WIB.')
    expect(JSON.stringify(buildSummaryInput(p))).not.toContain('secret-not-needed')
    p.origin = 'settings'; p.config_changes = [{ field: 'Batas acara', old: '21.00', new: '21.30' }]
    expect(templateParagraph(p)).toBe('Pengaturan acara Acara Demo diperbarui: Batas acara 21.00 → 21.30.')
  })
  it('formats canonical metadata fields before summarization and handles config-only decisions', () => {
    const p = payload(); p.changes = []; p.event.timezone = 'Asia/Makassar'
    p.config_changes = [{ field: 'name', old: 'Acara Lama', new: 'Acara Demo' },
      { field: 'timezone', old: 'Asia/Jakarta', new: 'Asia/Makassar' },
      { field: 'curfew_at', old: at('21:00'), new: at('21:30') }]
    const input = buildSummaryInput(p)
    expect(input.config_changes).toEqual([{ field: 'Nama acara', old: 'Acara Lama', new: 'Acara Demo' },
      { field: 'Zona waktu', old: 'WIB', new: 'WITA' }, { field: 'Batas acara', old: '21.00 WIB', new: '22.30 WITA' }])
    expect(templateParagraph(p)).toContain('Nama acara Acara Lama → Acara Demo')
    expect(templateParagraph(p)).toContain('Batas acara 21.00 WIB → 22.30 WITA')
    expect(validateParagraph('Pengaturan Acara Demo diperbarui.', p)).toBe(true)
  })
  it('faithfully states duration, end estimate, and status changes', () => {
    const p = payload(); p.changes = [p.changes[0]]; p.changes[0].shift_minutes = 0
    p.changes[0].changes = ['duration']; p.changes[0].new.duration_seconds = 2400
    expect(templateParagraph(p)).toContain('Talent B berubah durasi dari 30 menjadi 40 menit')
    p.changes[0].changes = ['end_estimate']
    expect(templateParagraph(p)).toContain('Talent B: perkiraan selesai berubah dari 19.45 ke 20.35 WIB')
    p.changes[0].changes = ['status']; p.changes[0].new.status = 'in_progress'
    expect(templateParagraph(p)).toContain('Talent B berubah status menjadi berlangsung')
  })
  it('bounds long templates and neutralizes unsolicited username mentions', () => {
    const p = payload(); p.changes[0].title = '@everyone '.repeat(40); p.changes[1].title = '&'.repeat(200)
    expect(templateParagraph(p).length).toBeLessThanOrEqual(450)
    expect(templateParagraph(p)).not.toContain('@everyone')
  })
})

describe('notifier fact validator', () => {
  it('accepts grounded three-sentence Indonesian paragraph', () => expect(validateParagraph(valid, payload())).toBe(true))
  it.each([
    ['invented time', valid.replace('20.05 WIB;', '20.06 WIB;')],
    ['invented minutes', valid.replace('15 menit', '16 menit')],
    ['invented number', `${valid} 9999`],
    ['link', 'Talent B dimundurkan. https://example.test'],
    ['mention', 'Talent B dimundurkan. @everyone'],
    ['html', '<b>Talent B</b> dimundurkan.'],
    ['markdown', '*Talent B* dimundurkan.'],
    ['line break', 'Talent B dimundurkan.\nPanel dimajukan.'],
    ['too long', `Talent B ${'a'.repeat(451)}`],
    ['missing changed title', 'Rundown berubah.'],
    ['extra sentence', `${valid} Siapkan diri.`],
    ['unknown action role', 'Talent B dimundurkan ke 20.05 WIB. PIC LED perlu menyesuaikan.'],
    ['FYI asked to act', 'Talent B dimundurkan ke 20.05 WIB. MC perlu menyesuaikan.'],
    ['wrong clock assignment', 'Talent B dimundurkan dari 20.05 ke 19.15 WIB.'],
    ['wrong direction', 'Talent B dimajukan dari 19.15 ke 20.05 WIB.'],
    ['invented cancellation', 'Talent B dibatalkan.'],
    ['invented reason', 'Talent B dimundurkan karena hujan.'],
    ['incorrect finish', 'Talent B dimundurkan ke 20.05 WIB. Perkiraan selesai 21.00 WIB.'],
    ['incorrect zone', valid.replaceAll('WIB', 'WITA')],
    ['emoji', 'Talent B dimundurkan. 😀'],
    ['invented effect', 'Talent B dimundurkan. Penonton dipindahkan ke lobi.'],
    ['wrong known minutes assigned to change', 'Talent B dimundurkan 15 menit ke 20.05 WIB.'],
    ['wrong known minutes assigned to slack', 'Talent B dimundurkan ke 20.05 WIB. Perkiraan selesai 20.45 WIB, 50 menit sebelum batas 21.00.'],
    ['wrong known destination clock', 'Talent B dimundurkan ke 19.15 WIB.'],
  ])('rejects %s', (_label, paragraph) => expect(validateParagraph(paragraph, payload())).toBe(false))
  it('requires event name for import/settings and accepts import clocks', () => {
    const p = payload(); p.origin = 'import'; p.changes = []
    p.import_summary = { item_count: 12, first_start_at: at('18:00'), last_end_at: at('20:45'), filename: 'rundown.pdf' }
    expect(validateParagraph('Acara Demo diaktifkan dari impor: 12 segmen, 18.00–20.45 WIB.', p)).toBe(true)
    expect(validateParagraph('Rundown diaktifkan.', p)).toBe(false)
  })
})

describe('notifier provider adapters, mocked and without tools', () => {
  it('sends strict JSON schema to gateway and accepts valid output', async () => {
    mocks.config.AI_PROVIDER = 'openai-compatible'; mocks.fetch.mockResolvedValue(completion())
    expect(await summarize(payload())).toEqual({ paragraph: valid, source: 'llm' })
    const [url, request] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://gateway.example/v1/chat/completions')
    expect(request?.redirect).toBe('error')
    const body = JSON.parse(request!.body as string)
    expect(body).toMatchObject({ model: 'gateway-summary', max_completion_tokens: 400,
      response_format: { json_schema: { strict: true, schema: { additionalProperties: false } } } })
    expect(body.tools).toBeUndefined()
    expect(body.messages[0].content).toContain('bukan instruksi')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['malformed JSON', () => completion('not json')],
    ['extra output field', () => completion({ paragraph: valid, recipient: 'all' })],
    ['invented clock', () => completion({ paragraph: valid.replace('20.05', '23.59') })],
    ['truncated output', () => completion({ paragraph: valid }, 'length')],
    ['provider refusal', () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ paragraph: valid }), refusal: 'no' } }] })],
    ['unexpected tool call', () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ paragraph: valid }), tool_calls: [{}] } }] })],
    ['provider failure', () => new Response('secret-mock-provider-error', { status: 503 })],
  ])('falls back on %s without retry/logging raw errors', async (_label, response) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.config.AI_PROVIDER = 'openai-compatible'; mocks.fetch.mockResolvedValue(response())
    expect(await summarize(payload())).toEqual({ paragraph: templateParagraph(payload()), source: 'template' })
    expect(mocks.fetch).toHaveBeenCalledTimes(1); expect(log).not.toHaveBeenCalled(); log.mockRestore()
  })
  it('falls back at the configured eight-second deadline', async () => {
    vi.useFakeTimers(); mocks.config.AI_PROVIDER = 'openai-compatible'
    mocks.fetch.mockImplementation((_url, request) => new Promise((_resolve, reject) => {
      request?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    const pending = summarize(payload())
    await vi.advanceTimersByTimeAsync(8000)
    expect(await pending).toEqual({ paragraph: templateParagraph(payload()), source: 'template' })
    expect(mocks.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
  it('uses Anthropic structured output with the notifier model and no tools', async () => {
    mocks.config.AI_PROVIDER = 'anthropic'
    mocks.anthropic.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ paragraph: valid }) }] })
    expect(await summarize(payload())).toEqual({ paragraph: valid, source: 'llm' })
    const [body, options] = mocks.anthropic.mock.calls[0]
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 400,
      output_config: { format: { type: 'json_schema', schema: { additionalProperties: false } } } })
    expect(body.tools).toBeUndefined(); expect(options.signal).toBeInstanceOf(AbortSignal)
  })
  it('falls back when Anthropic returns a tool invocation', async () => {
    mocks.config.AI_PROVIDER = 'anthropic'
    mocks.anthropic.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'tool_use', name: 'notify_all' }] })
    expect((await summarize(payload())).source).toBe('template')
  })
})
