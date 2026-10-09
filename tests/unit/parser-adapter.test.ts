import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_CLOCK, demoSnapshot } from '@/modules/events/fixture'

const mocks = vi.hoisted(() => ({ create: vi.fn(), constructor: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  return { default: Object.assign(mocks.constructor, { APIError }) }
})

const valid = { type: 'earliest_start', item_ids: ['talent-b'], time_hhmm: '20:05', offset_minutes: null,
  offset_base: null, is_estimate: false, notes: [] }
const response = (text: string, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text }] })

beforeEach(() => {
  vi.resetModules()
  mocks.create.mockReset()
  mocks.constructor.mockReset().mockImplementation(function () { return { beta: { messages: { create: mocks.create } } } })
})

describe('adapter Anthropic — kontrak mock, bukan eval live', () => {
  it('mengirim JSON schema, fallback dan timeout/retry sesuai kontrak', async () => {
    mocks.create.mockResolvedValue(response(JSON.stringify(valid)))
    const { anthropicExtract } = await import('@/modules/ai/anthropic-parser')
    const result = await anthropicExtract('Talent B baru bisa mulai jam 20.05', demoSnapshot(), DEMO_CLOCK, 'model-uji')
    expect(result).toEqual(valid)
    expect(mocks.constructor).toHaveBeenCalledWith({ timeout: 8000, maxRetries: 1 })
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'model-uji', betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: expect.objectContaining({ format: expect.objectContaining({ type: 'json_schema',
        schema: expect.objectContaining({ additionalProperties: false }) }) }),
    }))
    const request = mocks.create.mock.calls[0][0]
    const context = JSON.parse(request.messages[0].content)
    expect(context.document.event_id).toBe(demoSnapshot().event.id)
    expect(context.document.kind).toBe('event_rundown')
    expect(context.requested_item_ids).toEqual(['talent-b'])
    expect(context.reference_iso).toBe(DEMO_CLOCK)
    expect(context).not.toHaveProperty('roles')
    expect(context).not.toHaveProperty('constraints')
    expect(request.output_config.format.schema.properties.item_ids.items.enum).toEqual(demoSnapshot().items.map(item => item.id))
  })

  it.each(['refusal', 'max_tokens', 'tool_use'])('%s menjadi AI_UNAVAILABLE', async (stop) => {
    mocks.create.mockResolvedValue(response(JSON.stringify(valid), stop))
    const { anthropicExtract, AiUnavailableError } = await import('@/modules/ai/anthropic-parser')
    await expect(anthropicExtract('Talent B baru bisa mulai jam 20.05', demoSnapshot(), null, 'model-uji')).rejects.toBeInstanceOf(AiUnavailableError)
  })

  it('Claude tidak dapat menyempitkan talent ambigu atau memakai item asing', async () => {
    mocks.create.mockResolvedValue(response(JSON.stringify(valid)))
    const { anthropicExtract } = await import('@/modules/ai/anthropic-parser')
    expect((await anthropicExtract('talent baru bisa mulai jam 20.05', demoSnapshot(), DEMO_CLOCK, 'model-uji')).item_ids.sort()).toEqual(['talent-a', 'talent-b'])
    mocks.create.mockResolvedValue(response(JSON.stringify({ ...valid, item_ids: ['talent-b', 'foreign-item'] })))
    expect((await anthropicExtract('Talent B baru bisa mulai jam 20.05', demoSnapshot(), DEMO_CLOCK, 'model-uji')).type).toBeNull()
  })

  it.each(['bukan JSON', JSON.stringify({ ...valid, item_ids: 'talent-b' })])('keluaran invalid ditolak: %s', async (text) => {
    mocks.create.mockResolvedValue(response(text))
    const { anthropicExtract, AiUnavailableError } = await import('@/modules/ai/anthropic-parser')
    await expect(anthropicExtract('Talent B baru bisa mulai jam 20.05', demoSnapshot(), null, 'model-uji')).rejects.toBeInstanceOf(AiUnavailableError)
  })

  it('network gagal menjadi AI_UNAVAILABLE tanpa meloloskan keluaran', async () => {
    mocks.create.mockRejectedValue(new Error('network'))
    const { anthropicExtract, AiUnavailableError } = await import('@/modules/ai/anthropic-parser')
    await expect(anthropicExtract('Talent B baru bisa mulai jam 20.05', demoSnapshot(), null, 'model-uji')).rejects.toBeInstanceOf(AiUnavailableError)
  })
})
