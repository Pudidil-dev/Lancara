import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTelegramClient, TelegramApiError } from '@/modules/notifier/telegram-client'

const TOKEN = '123456789:test-token-secret'
const input = { chat_id: '-1001234567890', text: '<b>Rundown v2</b>', parse_mode: 'HTML' as const }
const response = (status: number, body: unknown) => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }))
afterEach(() => { vi.restoreAllMocks() })

describe('Telegram client: classified responses and secret-safe transport', () => {
  it('sends JSON to the fixed HTTPS host and converts bigint string IDs safely', async () => {
    const fetchImpl = response(200, { ok: true, result: { message_id: 12 } })
    const client = createTelegramClient({ token: TOKEN, fetchImpl })
    expect(await client.sendMessage({ ...input, message_thread_id: '24' })).toEqual({ ok: true, message_id: 12 })
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(options?.redirect).toBe('error')
    expect(JSON.parse(String(options?.body))).toMatchObject({ chat_id: -1001234567890, message_thread_id: 24, text: input.text })
  })

  it('returns retry_after for 429 flood control, with a safe missing-parameter default', async () => {
    expect(await createTelegramClient({ token: TOKEN, fetchImpl: response(429, { ok: false, error_code: 429, parameters: { retry_after: 17 } }) }).sendMessage(input)).toEqual({ ok: false, kind: 'rate_limited', retry_after: 17 })
    expect(await createTelegramClient({ token: TOKEN, fetchImpl: response(429, { ok: false }) }).sendMessage(input)).toEqual({ ok: false, kind: 'rate_limited', retry_after: 30 })
  })

  it.each([
    [400, { error_code: 400, description: "Bad Request: can't parse entities: Unsupported start tag" }, 'bad_request', 'entities_invalid'],
    [400, { error_code: 400, description: 'Bad Request: chat not found' }, 'bad_request', 'bad_request'],
    [403, { error_code: 403, description: 'Forbidden: bot was kicked' }, 'forbidden', 'forbidden'],
    [502, { error_code: 502, description: 'bad gateway' }, 'ambiguous', 'response_uncertain'],
  ])('classifies HTTP %i without returning raw descriptions', async (status, body, kind, description_code) => {
    expect(await createTelegramClient({ token: TOKEN, fetchImpl: response(status, { ok: false, ...body }) }).sendMessage(input)).toMatchObject({ ok: false, kind, description_code })
  })

  it('preserves numeric migration metadata and rejects unsafe ID rounding', async () => {
    const client = createTelegramClient({ token: TOKEN, fetchImpl: response(400, { ok: false, error_code: 400, parameters: { migrate_to_chat_id: -1001122334455 } }) })
    expect(await client.sendMessage(input)).toMatchObject({ kind: 'bad_request', migrate_to_chat_id: -1001122334455 })
    expect(await client.sendMessage({ ...input, chat_id: '9007199254740993' })).toMatchObject({ kind: 'bad_request', description_code: 'invalid_id' })
  })

  it.each(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'])('classifies preconnection %s as network', async code => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error(`failed ${TOKEN}`, { cause: { code } }))
    expect(await createTelegramClient({ token: TOKEN, fetchImpl }).sendMessage(input)).toEqual({ ok: false, kind: 'network', description_code: 'network' })
  })

  it('classifies an uncertain socket failure or malformed success as ambiguous', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('socket closed', { cause: { code: 'ECONNRESET' } }))
    expect(await createTelegramClient({ token: TOKEN, fetchImpl }).sendMessage(input)).toMatchObject({ kind: 'ambiguous' })
    expect(await createTelegramClient({ token: TOKEN, fetchImpl: response(200, { ok: true }) }).sendMessage(input)).toMatchObject({ kind: 'ambiguous' })
    expect(await createTelegramClient({ token: TOKEN, fetchImpl: response(200, {}) }).sendMessage(input)).toMatchObject({ kind: 'ambiguous' })
  })

  it('aborts timed-out sends and marks outcome ambiguous', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('AbortError')))
    }))
    expect(await createTelegramClient({ token: TOKEN, fetchImpl, timeoutMs: 5 }).sendMessage(input)).toMatchObject({ kind: 'ambiguous', description_code: 'ambiguous' })
  })

  it('never logs token, API URL, body, or raw error details', async () => {
    const stdout = vi.spyOn(process.stdout, 'write')
    const stderr = vi.spyOn(process.stderr, 'write')
    const client = createTelegramClient({ token: TOKEN, fetchImpl: response(400, { ok: false, error_code: 400, description: `secret ${TOKEN} https://api.telegram.org/bot${TOKEN}` }) })
    const result = await client.sendMessage(input)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    await expect(client.getMe()).rejects.toSatisfy((error: unknown) => error instanceof TelegramApiError && !error.message.includes(TOKEN))
    expect(JSON.stringify([...stdout.mock.calls, ...stderr.mock.calls])).not.toContain('api.telegram.org/bot')
    expect(JSON.stringify([...stdout.mock.calls, ...stderr.mock.calls])).not.toContain(TOKEN)
  })

  it('sanitizes webhook error messages and supports getMe/webhook/polling results', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { url: 'https://example.app/api/telegram/webhook', pending_update_count: 2, last_error_message: `token ${TOKEN}`, last_error_date: 123 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { id: 123456, username: 'lancara_bot' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: [{ update_id: 1 }] })))
    const client = createTelegramClient({ token: TOKEN, fetchImpl })
    expect(await client.getWebhookInfo()).toMatchObject({ pending_update_count: 2, last_error_message: 'webhook_delivery_error' })
    expect(await client.getMe()).toEqual({ id: 123456, username: 'lancara_bot' })
    expect(await client.setWebhook({ url: 'https://example.app/api/telegram/webhook', secret_token: 'secret', allowed_updates: ['message', 'my_chat_member'], drop_pending_updates: false, max_connections: 10 })).toBe(true)
    expect(await client.deleteWebhook({ drop_pending_updates: false })).toBe(true)
    expect(await client.getUpdates({ timeout: 25, allowed_updates: ['message'] })).toEqual([{ update_id: 1 }])
  })
})
