import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveExtraction } from '@/modules/ai/extraction'
import { AiUnavailableError } from '@/modules/ai/anthropic-parser'
import { openaiCompatibleExtract } from '@/modules/ai/openai-compatible-parser'
import { at, DEMO_CLOCK, demoSnapshot } from '@/modules/events/fixture'

const config = { baseUrl: 'http://localhost:20129/v1/', apiKey: 'mock-server-key', model: 'cx/gpt-6.1-sol' }
const valid = { type: 'earliest_start', item_ids: ['talent-b'], time_hhmm: '20:05', offset_minutes: null,
  offset_base: null, is_estimate: false, notes: [] }
const fetchMock = vi.fn<typeof fetch>()
const completion = (content: unknown = JSON.stringify(valid), finish_reason = 'stop', refusal: unknown = null) =>
  Response.json({ choices: [{ finish_reason, message: { content, refusal } }] })
const extract = (text = 'Talent B baru bisa mulai jam 20.05', ref: string | null = DEMO_CLOCK) =>
  openaiCompatibleExtract(text, demoSnapshot(), ref, config)

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.resetModules() })

describe('OpenAI-compatible — mocked fetch, tanpa jaringan', () => {
  it('mengirim schema strict dan hanya kabar/item/waktu; delta ter-resolve', async () => {
    fetchMock.mockResolvedValue(completion())
    const extraction = await extract()
    expect(resolveExtraction(extraction, demoSnapshot(), DEMO_CLOCK, 'openai-compatible').delta)
      .toMatchObject({ type: 'earliest_start', item_id: 'talent-b', value: at('20:05') })
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:20129/v1/chat/completions')
    expect(request?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer mock-server-key' })
    expect(request?.redirect).toBe('error')
    const body = JSON.parse(request!.body as string)
    expect(body.model).toBe('cx/gpt-6.1-sol')
    expect(body.reasoning_effort).toBe('low')
    expect(body.response_format.json_schema).toMatchObject({ strict: true, schema: { additionalProperties: false } })
    const data = JSON.parse(body.messages[1].content)
    expect(data.document).toEqual({ kind: 'event_rundown', event_id: demoSnapshot().event.id, name: demoSnapshot().event.name, stage: demoSnapshot().event.stage })
    expect(data.requested_item_ids).toEqual(['talent-b'])
    expect(data.reference_iso).toBe(DEMO_CLOCK)
    expect(data.items[0]).toMatchObject({ id: 'briefing', title: 'Briefing Kru', start: '16.00', end: '16.30', status: 'completed' })
    expect(Object.keys(data.items[0]).sort()).toEqual(['end', 'end_at', 'id', 'start', 'start_at', 'status', 'title'])
    expect(body.response_format.json_schema.schema.properties.item_ids.items.enum).toEqual(demoSnapshot().items.map(item => item.id))
    expect(JSON.stringify(data)).not.toContain('mock-server-key')
  })

  it.each([
    ['refusal', () => completion(JSON.stringify(valid), 'stop', 'refused')],
    ['length', () => completion(JSON.stringify(valid), 'length')],
    ['content_filter', () => completion(JSON.stringify(valid), 'content_filter')],
    ['non-JSON', () => completion('not JSON')],
    ['invalid schema', () => completion(JSON.stringify({ ...valid, item_ids: 'talent-b' }))],
    ['invalid clock', () => completion(JSON.stringify({ ...valid, time_hhmm: '25:90' }))],
    ['missing message', () => Response.json({ choices: [] })],
  ] as const)('%s ditolak tanpa retry, isi provider tidak bocor', async (_label, response) => {
    fetchMock.mockResolvedValue(response())
    const error: unknown = await extract().catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(AiUnavailableError)
    expect((error as Error).message).toBe('Penafsir tidak tersedia. Gunakan form manual.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('401 tidak di-retry atau meneruskan error provider', async () => {
    fetchMock.mockResolvedValue(new Response('mock-server-key', { status: 401 }))
    await expect(extract()).rejects.toThrow('Penafsir tidak tersedia. Gunakan form manual.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([429, 503])('%s transient di-retry tepat sekali lalu sukses', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('transient', { status })).mockResolvedValueOnce(completion())
    expect(await extract()).toEqual(valid)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(fetchMock.mock.calls[1][1]?.signal)
  })

  it('network gagal maksimal dua request dan error generik', async () => {
    fetchMock.mockRejectedValue(new Error('mock-server-key'))
    await expect(extract()).rejects.toThrow('Penafsir tidak tersedia. Gunakan form manual.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('budget timeout total 12 detik untuk kedua attempt', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValueOnce(new Error('network transient')).mockImplementationOnce((_url, request) =>
      new Promise((_resolve, reject) => request?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })))
    const result = expect(extract()).rejects.toThrow('Penafsir tidak tersedia. Gunakan form manual.')
    await vi.advanceTimersByTimeAsync(12_000)
    await result
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('model tidak dapat menyempitkan nama talent ambigu', async () => {
    fetchMock.mockResolvedValue(completion())
    const extraction = await extract('talent baru bisa mulai jam 20.05')
    const actual = resolveExtraction(extraction, demoSnapshot(), DEMO_CLOCK, 'openai-compatible')
    expect(extraction.item_ids.sort()).toEqual(['talent-a', 'talent-b'])
    expect(actual.delta).toBeNull()
    expect(actual.questions.some((question) => question.kind === 'item')).toBe(true)
  })

  it('dua jam alternatif memerlukan klarifikasi nilai', async () => {
    fetchMock.mockResolvedValue(completion())
    const extraction = await extract('Talent B baru bisa mulai jam 20.05 atau jam 20.15')
    const actual = resolveExtraction(extraction, demoSnapshot(), DEMO_CLOCK, 'openai-compatible')
    expect(actual.delta).toBeNull()
    expect(actual.questions.some((question) => question.kind === 'value')).toBe(true)
  })

  it.each([
    ['Panel jam 20.00 ya', 'panel', '20:00'],
    ['Keynote pukul 19.00', 'keynote', '19:00'],
  ])('nama dan jam tanpa jenis perubahan meminta klarifikasi: %s', async (text, itemId, time) => {
    fetchMock.mockResolvedValue(completion(JSON.stringify({ ...valid, item_ids: [itemId], time_hhmm: time })))
    const actual = resolveExtraction(await extract(text), demoSnapshot(), DEMO_CLOCK, 'openai-compatible')
    expect(actual.delta).toBeNull()
    expect(actual.questions.some(question => question.kind === 'type')).toBe(true)
  })

  it('ID di luar rundown tidak menjadi item baru', async () => {
    fetchMock.mockResolvedValue(completion(JSON.stringify({ ...valid, item_ids: ['talent-baru'] })))
    const actual = resolveExtraction(await extract(), demoSnapshot(), DEMO_CLOCK, 'openai-compatible')
    expect(actual.delta).toBeNull()
    expect(actual.questions.some((question) => question.kind === 'item')).toBe(true)
  })

  it('waktu relatif tanpa acuan meminta reference_at', async () => {
    fetchMock.mockResolvedValue(completion(JSON.stringify({ ...valid, time_hhmm: null, offset_minutes: 40, offset_base: 'reference' })))
    const actual = resolveExtraction(await extract('Talent B 40 menit lagi baru sampai', null), demoSnapshot(), null, 'openai-compatible')
    expect(actual.delta).toBeNull()
    expect(actual.questions.some((question) => question.kind === 'reference_at')).toBe(true)
  })

  it('jam absolut tebakan model tidak menghilangkan kebutuhan waktu acuan', async () => {
    fetchMock.mockResolvedValue(completion())
    const actual = resolveExtraction(await extract('Talent B 40 menit lagi baru sampai', null), demoSnapshot(), null, 'openai-compatible')
    expect(actual.delta).toBeNull()
    expect(actual.questions.some((question) => question.kind === 'reference_at')).toBe(true)
  })

  it('interpret memilih provider dari env dan menjaga key di server', async () => {
    vi.resetModules()
    vi.stubEnv('AI_PROVIDER', 'openai-compatible')
    vi.stubEnv('AI_MODEL', config.model)
    vi.stubEnv('OPENAI_BASE_URL', config.baseUrl)
    vi.stubEnv('OPENAI_API_KEY', config.apiKey)
    fetchMock.mockResolvedValue(completion())
    const { interpret } = await import('@/modules/ai/index')
    expect((await interpret('Talent B baru bisa mulai jam 20.05', demoSnapshot(), DEMO_CLOCK)).provider)
      .toBe('openai-compatible:cx/gpt-6.1-sol')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('konfigurasi key kosong ditolak sebelum fetch', async () => {
    await expect(openaiCompatibleExtract('Talent B baru bisa mulai jam 20.05', demoSnapshot(), null, { ...config, apiKey: '' })).rejects.toBeInstanceOf(AiUnavailableError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('provider rule tetap deterministik walau gateway dikonfigurasi', async () => {
    vi.resetModules()
    vi.stubEnv('AI_PROVIDER', 'rule')
    vi.stubEnv('OPENAI_API_KEY', config.apiKey)
    vi.stubEnv('OPENAI_BASE_URL', config.baseUrl)
    const { interpret } = await import('@/modules/ai/index')
    const result = await interpret('Talent B baru bisa mulai jam 20.05', demoSnapshot(), DEMO_CLOCK)
    expect(result.provider).toBe('rule')
    expect(result.delta).toMatchObject({ item_id: 'talent-b', value: at('20:05') })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gateway dengan konfigurasi env belum lengkap tetap tidak memanggil fetch', async () => {
    vi.resetModules()
    vi.stubEnv('AI_PROVIDER', 'openai-compatible')
    vi.stubEnv('OPENAI_BASE_URL', '')
    vi.stubEnv('OPENAI_API_KEY', config.apiKey)
    const { interpret } = await import('@/modules/ai/index')
    await expect(interpret('Talent B baru bisa mulai jam 20.05', demoSnapshot(), null)).rejects.toThrow('Konfigurasi penafsir belum lengkap.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('URL gateway dengan credential/query ditolak sebelum fetch', async () => {
    await expect(openaiCompatibleExtract('Talent B baru bisa mulai jam 20.05', demoSnapshot(), null, { ...config,
      baseUrl: 'http://user:password@localhost:20129/v1?key=secret' })).rejects.toBeInstanceOf(AiUnavailableError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
