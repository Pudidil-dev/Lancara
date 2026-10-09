// Provider "anthropic": hanya mengekstrak struktur dari kabar. Output divalidasi ulang dengan zod;
// item_id di luar rundown dibuang oleh resolveExtraction. Engine tidak bergantung pada model ini.
import Anthropic from '@anthropic-ai/sdk'
import { formatClock } from '@/lib/time'
import { endIso } from '@/modules/engine/schedule'
import type { Snapshot } from '@/modules/engine/types'
import { ExtractionSchema, type Extraction } from './extraction'

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'item_ids', 'time_hhmm', 'offset_minutes', 'offset_base', 'is_estimate', 'notes'],
  properties: {
    type: { type: ['string', 'null'], enum: ['earliest_start', 'active_end_estimate', 'cancel_item', null] },
    item_ids: { type: 'array', items: { type: 'string' } },
    time_hhmm: { type: ['string', 'null'], description: 'Jam lokal acara HH:MM (24 jam) bila disebut eksplisit' },
    offset_minutes: { type: ['integer', 'null'], description: 'Selisih menit bila kabar relatif' },
    offset_base: { type: ['string', 'null'], enum: ['reference', 'planned_start', 'planned_end', null] },
    is_estimate: { type: 'boolean' },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const

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
  const tz = snapshot.event.timezone
  const rundown = snapshot.items
    .map((i) => `${i.id} | ${i.title} | ${formatClock(i.start_at, tz)}–${formatClock(endIso(i), tz)} | ${i.status}`)
    .join('\n')
  const userContent = `Rundown (id | judul | jam lokal | status):\n${rundown}\n\nWaktu acuan kabar: ${referenceAt ? formatClock(referenceAt, tz) : 'tidak diisi'}\nKabar: """${text}"""`

  try {
    const response = await getClient().beta.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages: [{ role: 'user', content: userContent }],
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming)
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      throw new AiUnavailableError(`Model berhenti: ${response.stop_reason}`)
    }
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new AiUnavailableError('Model tidak mengembalikan teks.')
    const parsed = ExtractionSchema.safeParse(JSON.parse(textBlock.text))
    if (!parsed.success) throw new AiUnavailableError('Keluaran model tidak sesuai schema.')
    return parsed.data
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error
    if (error instanceof Anthropic.APIError) throw new AiUnavailableError(`Provider AI gagal (${error.status ?? 'network'}).`)
    if (error instanceof SyntaxError) throw new AiUnavailableError('Keluaran model bukan JSON valid.')
    throw new AiUnavailableError('Provider AI tidak tersedia.')
  }
}
