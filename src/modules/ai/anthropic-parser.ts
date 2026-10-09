// Provider "anthropic": hanya mengekstrak struktur dari kabar. Output divalidasi ulang dengan zod;
// item_id di luar rundown dibuang oleh resolveExtraction. Engine tidak bergantung pada model ini.
import Anthropic from '@anthropic-ai/sdk'
import type { Snapshot } from '@/modules/engine/types'
import { ExtractionSchema, type Extraction } from './extraction'
import { buildRundownContext, constrainToRundown, extractionJsonSchema, outsideRundownScope, RUNDOWN_SCOPE } from './rundown-context'

const SYSTEM = `Anda mengekstrak SATU perubahan rundown dari kabar berbahasa Indonesia.
- type: earliest_start (penampil terlambat/datang lebih cepat/baru bisa mulai), active_end_estimate (sesi yang sedang berlangsung molor), cancel_item (dibatalkan). null bila tidak jelas.
- item_ids: HANYA id dari daftar rundown. Bila nama cocok dengan lebih dari satu item (mis. "talent"), cantumkan semua kandidat; jangan menebak.
- Waktu: isi time_hhmm untuk jam eksplisit (acara sore–malam: "jam 8" = 20:00). Untuk "N menit lagi" isi offset_minutes=N, offset_base="reference". Untuk "telat N menit" offset_base="planned_start"; "molor N menit" offset_base="planned_end".
- is_estimate true bila ada kata sekitar/kira-kira/perkiraan/"jam 8-an".
- Jangan menambah penerima, batas, atau menilai kelayakan jadwal.`

let client: Anthropic | null = null
function getClient(): Anthropic {
  client ??= new Anthropic({ timeout: 8000, maxRetries: 1 })
  return client
}

export class AiUnavailableError extends Error {}

export async function anthropicExtract(text: string, snapshot: Snapshot, referenceAt: string | null, model: string): Promise<Extraction> {
  const refused = outsideRundownScope(text, snapshot)
  if (refused) return refused
  const userContent = JSON.stringify(buildRundownContext(text, snapshot, referenceAt))

  try {
    const response = await getClient().beta.messages.create({
      model,
      max_tokens: 1024,
      system: `${RUNDOWN_SCOPE}\n${SYSTEM}`,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: extractionJsonSchema(snapshot) } },
      messages: [{ role: 'user', content: userContent }],
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming)
    if (response.stop_reason !== 'end_turn' && response.stop_reason !== 'stop_sequence') {
      throw new AiUnavailableError(`Model berhenti: ${response.stop_reason}`)
    }
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new AiUnavailableError('Model tidak mengembalikan teks.')
    const parsed = ExtractionSchema.safeParse(JSON.parse(textBlock.text))
    if (!parsed.success) throw new AiUnavailableError('Keluaran model tidak sesuai schema.')
    return constrainToRundown(text, snapshot, parsed.data)
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error
    if (error instanceof Anthropic.APIError) throw new AiUnavailableError(`Provider AI gagal (${error.status ?? 'network'}).`)
    if (error instanceof SyntaxError) throw new AiUnavailableError('Keluaran model bukan JSON valid.')
    throw new AiUnavailableError('Provider AI tidak tersedia.')
  }
}
