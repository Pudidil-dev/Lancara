// Panggilan model untuk asisten bantuan. Hanya dipanggil dari server. Melempar error bila gagal; pemanggil jatuh ke aturan.
import Anthropic from '@anthropic-ai/sdk'
import { env } from '@/lib/env'

const MAX_ANSWER = 1200

export async function askModel(system: string, user: string): Promise<string | null> {
  const cfg = env()
  if (cfg.AI_PROVIDER === 'anthropic') {
    if (!cfg.ANTHROPIC_API_KEY) return null
    const client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, timeout: 8000, maxRetries: 1 })
    const response = await client.messages.create({
      model: cfg.AI_MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: user }],
    })
    if (response.stop_reason === 'refusal') return null
    const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n').trim()
    return text ? text.slice(0, MAX_ANSWER) : null
  }
  if (cfg.AI_PROVIDER === 'openai-compatible') {
    if (!cfg.OPENAI_BASE_URL || !cfg.OPENAI_API_KEY) return null
    const base = new URL(cfg.OPENAI_BASE_URL)
    if (base.username || base.password || base.search || base.hash) return null
    const endpoint = `${base.toString().replace(/\/$/, '')}/chat/completions`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: cfg.AI_MODEL,
          max_completion_tokens: 400,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      })
      if (!response.ok) {
        // Body error tidak dibaca atau dicetak: bisa memuat detail credential atau request.
        await response.body?.cancel()
        return null
      }
      const completion = (await response.json()) as { choices?: Array<{ finish_reason?: string; message?: { content?: unknown; refusal?: unknown } }> }
      const choice = completion.choices?.[0]
      if (choice?.message?.refusal || typeof choice?.message?.content !== 'string') return null
      const text = choice.message.content.trim()
      return text ? text.slice(0, MAX_ANSWER) : null
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}
