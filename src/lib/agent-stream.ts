// Pembaca stream NDJSON untuk AI Agent. Event progres diteruskan saat tiba; event done menjadi hasil akhir.
import { ApiError } from './api-client'

export type AgentStreamEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool'; tool: string; status: 'running' | 'done'; ok?: boolean; note?: string }

export async function streamAgent<R>(path: string, payload: unknown, onEvent: (event: AgentStreamEvent) => void, timeoutMs = 190_000): Promise<R> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const outcome: { reply: R | null } = { reply: null }
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
      throw new ApiError(json?.code ?? 'INTERNAL', json?.message ?? `HTTP ${res.status}`, res.status, json?.request_id ?? null, json?.details ?? null)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const handle = (line: string) => {
      if (!line.trim()) return
      let event: Record<string, unknown>
      try { event = JSON.parse(line) as Record<string, unknown> } catch { return }
      if (event.type === 'done') outcome.reply = event.reply as R
      else if (event.type === 'error') throw new ApiError(String(event.code ?? 'INTERNAL'), String(event.message ?? 'Terjadi kesalahan.'), 500, null, null)
      else onEvent(event as AgentStreamEvent)
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
    if (!outcome.reply) throw new ApiError('INTERNAL', 'Respons AI Agent tidak lengkap.', 500, null, null)
    return outcome.reply
  } catch (error) {
    if (error instanceof ApiError) throw error
    if ((error as Error).name === 'AbortError') throw new ApiError('TIMEOUT', 'AI Agent terlalu lama merespons. Coba lagi.', 0, null, null)
    throw new ApiError('NETWORK', 'Tidak ada koneksi. AI Agent memerlukan server.', 0, null, null)
  } finally {
    clearTimeout(timer)
  }
}
