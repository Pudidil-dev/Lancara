import { env } from '@/lib/env'
import type { Snapshot } from '@/modules/engine/types'
import { AiUnavailableError, anthropicExtract } from './anthropic-parser'
import { resolveExtraction, type Interpretation } from './extraction'
import { ruleExtract } from './rule-parser'
import { openaiCompatibleExtract } from './openai-compatible-parser'
import { constrainToRundown, outsideRundownScope } from './rundown-context'

export { AiUnavailableError }

/** Adapter provider (ADR-006). Kegagalan provider AI tidak menghapus draft; UI memakai form manual. */
export async function interpret(text: string, snapshot: Snapshot, referenceAt: string | null): Promise<Interpretation> {
  const refused = outsideRundownScope(text, snapshot)
  if (refused) return resolveExtraction(refused, snapshot, referenceAt, 'system')
  const cfg = env()
  if (cfg.AI_PROVIDER === 'openai-compatible') {
    if (!cfg.OPENAI_API_KEY || !cfg.OPENAI_BASE_URL) throw new AiUnavailableError('Konfigurasi penafsir belum lengkap.')
    const extraction = await openaiCompatibleExtract(text, snapshot, referenceAt, {
      baseUrl: cfg.OPENAI_BASE_URL, apiKey: cfg.OPENAI_API_KEY, model: cfg.AI_MODEL,
    })
    return resolveExtraction(extraction, snapshot, referenceAt, `openai-compatible:${cfg.AI_MODEL}`)
  }
  if (cfg.AI_PROVIDER === 'anthropic') {
    if (!cfg.ANTHROPIC_API_KEY) throw new AiUnavailableError('ANTHROPIC_API_KEY belum diatur.')
    const extraction = await anthropicExtract(text, snapshot, referenceAt, cfg.AI_MODEL)
    return resolveExtraction(extraction, snapshot, referenceAt, `anthropic:${cfg.AI_MODEL}`)
  }
  return resolveExtraction(constrainToRundown(text, snapshot, ruleExtract(text, snapshot)), snapshot, referenceAt, 'rule')
}
