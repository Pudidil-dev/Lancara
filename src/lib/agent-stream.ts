// Pembaca stream NDJSON untuk AI Agent. Event progres diteruskan saat tiba; event done menjadi hasil akhir.
import { ApiError, responseError } from './api-client'

export type AgentStreamEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool'; tool: string; status: 'running' | 'done'; ok?: boolean; note?: string }

export async function streamAgent<R>(path: string, payload: unknown, onEvent: (event: AgentStreamEvent) => void, timeoutMs = 190_000): Promise<R> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('OFFLINE', 'Koneksi terputus.', 0, null, null, 'chat')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const outcome: { reply: R | null } = { reply: null }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => null)
      throw responseError(res, json, 'chat')
    }
    reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const handle = (line: string) => {
      if (!line.trim()) return
      let event: Record<string, unknown>
      try { event = JSON.parse(line) as Record<string, unknown> } catch { throw new ApiError('INVALID_RESPONSE', 'Respons AI belum lengkap.', 500, null, null, 'chat') }
      if (!event || typeof event !== 'object') throw new ApiError('INVALID_RESPONSE', 'Respons AI belum lengkap.', 500, null, null, 'chat')
      if (event.type === 'done') outcome.reply = event.reply as R
      else if (event.type === 'error') throw new ApiError(String(event.code ?? 'INTERNAL'), 'AI belum dapat merespons.', 500, null, null, 'chat')
      else if (event.type === 'thinking' && typeof event.text === 'string') onEvent(event as AgentStreamEvent)
      else if (event.type === 'tool' && typeof event.tool === 'string' && ['running', 'done'].includes(String(event.status))) onEvent(event as AgentStreamEvent)
    }
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        handle(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    handle(buffer)
    if (!outcome.reply) throw new ApiError('INTERNAL', 'Respons AI Agent tidak lengkap.', 500, null, null, 'chat')
    return outcome.reply
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (controller.signal.aborted) throw new ApiError('TIMEOUT', 'AI belum merespons.', 0, null, null, 'chat')
    throw new ApiError('NETWORK', 'Tidak ada koneksi. AI Agent memerlukan server.', 0, null, null, 'chat')
  } finally {
    clearTimeout(timer)
    await reader?.cancel().catch(() => undefined)
    reader?.releaseLock()
  }
}
