import { env } from '@/lib/env'

export type TelegramId = number | string
export interface SendMessageInput {
  chat_id: TelegramId
  text: string
  parse_mode?: 'HTML'
  message_thread_id?: TelegramId
  link_preview_options?: { is_disabled: boolean }
}
export type SendMessageResult =
  | { ok: true; message_id: number }
  | { ok: false; kind: 'rate_limited'; retry_after: number }
  | { ok: false; kind: 'forbidden' | 'bad_request' | 'ambiguous' | 'network'; code?: number; description_code?: string; migrate_to_chat_id?: number }

export interface TelegramClient {
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>
  getMe(): Promise<{ id: number; username: string }>
  setWebhook(input: { url: string; secret_token: string; allowed_updates: string[]; drop_pending_updates: boolean; max_connections: number }): Promise<boolean>
  deleteWebhook(input: { drop_pending_updates: boolean }): Promise<boolean>
  getWebhookInfo(): Promise<{ url: string; pending_update_count: number; last_error_date?: number; last_error_message?: string }>
  getUpdates(input: { offset?: number; timeout: number; allowed_updates: string[] }): Promise<unknown[]>
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
const PRE_CONNECTION_ERRORS = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'])

/** Only fixed codes cross the client boundary; remote descriptions can contain secrets. */
export class TelegramApiError extends Error {
  constructor(readonly method: string, readonly code: string, readonly http_status?: number) {
    super(`Telegram ${method}: ${code}`)
    this.name = 'TelegramApiError'
  }
}

function apiId(value: TelegramId, positive = false): number {
  if (typeof value === 'string' && !/^-?\d+$/.test(value)) throw new TelegramApiError('sendMessage', 'invalid_id')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed === 0 || (positive && parsed < 0)) throw new TelegramApiError('sendMessage', 'invalid_id')
  return parsed
}

/** Injectable transport for tests; the production API host is deliberately fixed. */
export function createTelegramClient(options: { token: string; fetchImpl?: typeof fetch; timeoutMs?: number }): TelegramClient {
  const transport = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 10_000
  const request = async (method: string, input: unknown, timeout = timeoutMs) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const response = await transport(`https://api.telegram.org/bot${options.token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal,
        redirect: 'error',
      })
      let data: Record<string, unknown>
      try { data = object(await response.json()) } catch { data = {} }
      return { status: response.status, data }
    } catch (error) {
      const details = object(error)
      const cause = object(details.cause)
      const code = typeof cause.code === 'string' ? cause.code : typeof details.code === 'string' ? details.code : ''
      // After a connection exists, a failure may happen after Telegram accepted the message.
      throw new TelegramApiError(method, !controller.signal.aborted && PRE_CONNECTION_ERRORS.has(code) ? 'network' : 'ambiguous')
    } finally { clearTimeout(timer) }
  }
  const requiredResult = async (method: string, input: unknown, timeout?: number): Promise<unknown> => {
    const response = await request(method, input, timeout)
    if (response.status < 200 || response.status >= 300 || response.data.ok !== true) {
      throw new TelegramApiError(method, response.status === 429 ? 'rate_limited' : 'api_error', response.status)
    }
    return response.data.result
  }
  return {
    async sendMessage(input) {
      let response: Awaited<ReturnType<typeof request>>
      try {
        response = await request('sendMessage', {
          ...input, chat_id: apiId(input.chat_id),
          ...(input.message_thread_id === undefined ? {} : { message_thread_id: apiId(input.message_thread_id, true) }),
        })
      } catch (error) {
        const code = error instanceof TelegramApiError ? error.code : 'ambiguous'
        return { ok: false, kind: code === 'network' ? 'network' : code === 'invalid_id' ? 'bad_request' : 'ambiguous', description_code: code }
      }
      const { status, data } = response
      const result = object(data.result)
      if (status >= 200 && status < 300 && data.ok === true && integer(result.message_id) && result.message_id > 0) {
        return { ok: true, message_id: result.message_id }
      }
      const parameters = object(data.parameters)
      const code = integer(data.error_code) ? data.error_code : status
      if (code === 429) return { ok: false, kind: 'rate_limited', retry_after: integer(parameters.retry_after) && parameters.retry_after > 0 ? parameters.retry_after : 30 }
      if (status >= 500 || code >= 500 || (status >= 200 && status < 300 && data.ok !== false)) return { ok: false, kind: 'ambiguous', code, description_code: 'response_uncertain' }
      if (code === 403) return { ok: false, kind: 'forbidden', code, description_code: 'forbidden' }
      const entityError = code === 400 && typeof data.description === 'string' && /can't parse entities|cant parse entities|unsupported start tag|can't find end tag/i.test(data.description)
      return {
        ok: false, kind: 'bad_request', code, description_code: entityError ? 'entities_invalid' : 'bad_request',
        ...(integer(parameters.migrate_to_chat_id) ? { migrate_to_chat_id: parameters.migrate_to_chat_id } : {}),
      }
    },
    async getMe() {
      const result = object(await requiredResult('getMe', {}))
      if (!integer(result.id) || result.id <= 0 || typeof result.username !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(result.username)) throw new TelegramApiError('getMe', 'invalid_response')
      return { id: result.id, username: result.username }
    },
    async setWebhook(input) { return await requiredResult('setWebhook', input) === true },
    async deleteWebhook(input) { return await requiredResult('deleteWebhook', input) === true },
    async getWebhookInfo() {
      const result = object(await requiredResult('getWebhookInfo', {}))
      if (typeof result.url !== 'string' || !integer(result.pending_update_count) || result.pending_update_count < 0) throw new TelegramApiError('getWebhookInfo', 'invalid_response')
      return {
        url: result.url, pending_update_count: result.pending_update_count,
        ...(integer(result.last_error_date) ? { last_error_date: result.last_error_date } : {}),
        ...(typeof result.last_error_message === 'string' ? { last_error_message: 'webhook_delivery_error' } : {}),
      }
    },
    async getUpdates(input) {
      const result = await requiredResult('getUpdates', input, Math.max(timeoutMs, (input.timeout + 10) * 1000))
      if (!Array.isArray(result)) throw new TelegramApiError('getUpdates', 'invalid_response')
      return result
    },
  }
}

export function telegramClient(): TelegramClient {
  const cfg = env()
  if (!cfg.TELEGRAM_BOT_TOKEN) throw new TelegramApiError('configure', 'not_configured')
  return createTelegramClient({ token: cfg.TELEGRAM_BOT_TOKEN })
}
