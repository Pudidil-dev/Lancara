import { env } from '@/lib/env'
import type { Snapshot } from '@/modules/engine/types'
import { AiUnavailableError, anthropicExtract } from './anthropic-parser'
import { resolveExtraction, type Interpretation } from './extraction'
import { ruleExtract } from './rule-parser'

export { AiUnavailableError }

/** Adapter provider (ADR-006). Kegagalan provider AI tidak menghapus draft; UI memakai form manual. */
export async function interpret(text: string, snapshot: Snapshot, referenceAt: string | null): Promise<Interpretation> {
  const cfg = env()
  if (cfg.AI_PROVIDER === 'anthropic') {
    if (!cfg.ANTHROPIC_API_KEY) throw new AiUnavailableError('ANTHROPIC_API_KEY belum diatur.')
    const extraction = await anthropicExtract(text, snapshot, referenceAt, cfg.AI_MODEL)
    return resolveExtraction(extraction, snapshot, referenceAt, `anthropic:${cfg.AI_MODEL}`)
  }
  return resolveExtraction(ruleExtract(text, snapshot), snapshot, referenceAt, 'rule')
}
