import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { formatClock } from '../src/lib/time'
import { anthropicExtract } from '../src/modules/ai/anthropic-parser'
import { resolveExtraction, type Interpretation } from '../src/modules/ai/extraction'
import { ruleExtract } from '../src/modules/ai/rule-parser'
import { openaiCompatibleExtract } from '../src/modules/ai/openai-compatible-parser'
import { DEMO_TZ, demoSnapshot } from '../src/modules/events/fixture'
import { localDelta, PARSER_SET, type ParserCase } from '../tests/fixtures/parser-set'
import { loadEnvFiles } from './load-env'

loadEnvFiles()

interface Result {
  provider: string
  correct: number
  clarified: number
  ambiguousDeltas: number
  errors: number
  durations: number[]
  rows: string[]
}

function matches(sample: ParserCase, actual: Interpretation): boolean {
  if (sample.expected.status === 'needs_clarification') {
    return actual.status === 'needs_clarification' && actual.delta === null
      && sample.expected.kinds.every((kind) => actual.questions.some((q) => q.kind === kind))
  }
  return actual.status === 'ok' && actual.delta !== null
    && actual.delta.reference_at === sample.reference_at
    && JSON.stringify(localDelta(actual.delta, (value) => formatClock(value, DEMO_TZ))) === JSON.stringify(sample.expected.delta)
}

async function evaluate(provider: 'rule' | 'anthropic' | 'openai-compatible', model: string): Promise<Result> {
  const result: Result = { provider: provider === 'rule' ? 'rule / deterministik' : `${provider} / ${model}`,
    correct: 0, clarified: 0, ambiguousDeltas: 0, errors: 0, durations: [], rows: [] }
  // Satu request per sampel, sequential; tidak ada retry sendiri selain maxRetries adapter.
  for (const sample of PARSER_SET) {
    const snapshot = demoSnapshot()
    const started = performance.now()
    try {
      const extraction = provider === 'rule' ? ruleExtract(sample.text, snapshot)
        : provider === 'anthropic' ? await anthropicExtract(sample.text, snapshot, sample.reference_at, model)
          : await openaiCompatibleExtract(sample.text, snapshot, sample.reference_at, {
            model, baseUrl: process.env.OPENAI_BASE_URL ?? '', apiKey: process.env.OPENAI_API_KEY ?? '',
          })
      const actual = resolveExtraction(extraction, snapshot, sample.reference_at, provider)
      const parseMs = performance.now() - started
      result.durations.push(parseMs)
      const passed = matches(sample, actual)
      if (sample.expected.status === 'ok' && passed) result.correct++
      if (sample.expected.status === 'needs_clarification') {
        if (passed) result.clarified++
        if (actual.delta !== null) result.ambiguousDeltas++
      }
      result.rows.push(`| ${sample.id} | ${sample.text} | ${sample.expected.status} | ${actual.status} | ${passed ? 'Lulus' : 'Gagal'} | ${parseMs.toFixed(3)} |`)
    } catch {
      result.errors++
      const parseMs = performance.now() - started
      result.durations.push(parseMs)
      // Jangan cetak error provider mentah: bisa mengandung teks request/credential.
      result.rows.push(`| ${sample.id} | ${sample.text} | ${sample.expected.status} | AI_UNAVAILABLE | Gagal | ${parseMs.toFixed(3)} |`)
    }
  }
  return result
}

const clearCount = PARSER_SET.filter((sample) => sample.expected.status === 'ok').length
const ambiguousCount = PARSER_SET.length - clearCount
function percent(count: number, total: number): string { return `${(count / total * 100).toFixed(1)}% (${count}/${total})` }
function percentile(durations: number[], fraction: number): string {
  const sorted = [...durations].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(3)
}
function summary(result: Result): string {
  return `${result.provider}: akurasi=${percent(result.correct, clearCount)}; recall klarifikasi=${percent(result.clarified, ambiguousCount)}; delta pada ambigu=${result.ambiguousDeltas}; error=${result.errors}; p50=${percentile(result.durations, 0.5)}ms; p95=${percentile(result.durations, 0.95)}ms; n=${result.durations.length}`
}

async function main(): Promise<void> {
  const model = process.env.AI_MODEL ?? 'claude-opus-5-5'
  const results = [await evaluate('rule', model)]
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim())
  const liveEnabled = process.env.AI_PROVIDER === 'anthropic' && hasKey
  if (liveEnabled) results.push(await evaluate('anthropic', model))
  let liveNote = liveEnabled ? 'Eval Anthropic live dijalankan; hasil aktual di bawah.'
    : `Anthropic: belum diuji live — ${hasKey ? 'AI_PROVIDER bukan anthropic' : 'ANTHROPIC_API_KEY belum tersedia'}. Model konfigurasi: ${model}.`
  if (process.env.AI_PROVIDER === 'openai-compatible') {
    if (process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_BASE_URL?.trim()) {
      results.push(await evaluate('openai-compatible', model))
      liveNote += '\n\nEval gateway OpenAI-compatible live dijalankan; hasil aktual di bawah. Endpoint berasal dari konfigurasi server; tidak dicetak bersama credential.'
    } else {
      liveNote += '\n\nOpenAI-compatible: belum diuji live — OPENAI_BASE_URL atau OPENAI_API_KEY belum tersedia.'
    }
  }
  results.forEach((result) => process.stdout.write(`${summary(result)}\n`))
  process.stdout.write(`${liveNote}\n`)
  const localStamp = new Intl.DateTimeFormat('id-ID', { timeZone: DEMO_TZ, dateStyle: 'full', timeStyle: 'long' }).format(new Date())
  const document = `# AI-01 — Evaluasi parser\n\nV — Pengukuran ${localStamp}. Perintah: \`npm run eval:parser\` (\`npx tsx scripts/eval-parser.ts\`).\n\n`+
    `Lingkungan: Node ${process.version}; ${os.platform()} ${os.arch()}; ${os.cpus()[0]?.model ?? 'CPU tidak diketahui'}. Fixture 12 item, 9 Oktober 2026, Asia/Jakarta, acuan default 18.40 WIB.\n\n`+
    `Label disusun manual dalam \`tests/fixtures/parser-set.ts\`, bukan dari keluaran parser: ${PARSER_SET.length} kalimat (${clearCount} tidak ambigu, ${ambiguousCount} ambigu). Akurasi mencocokkan type, item_id, value lokal, is_estimate dan reference_at. Recall klarifikasi mencocokkan status, delta null dan semua kind pertanyaan yang diwajibkan label.\n\n`+
    `Target: akurasi ≥90%, klarifikasi 100%, delta otomatis pada ambigu 0. Angka delta otomatis mengukur delta non-null sebelum konfirmasi, bukan mutasi database; script tidak melakukan mutation API/database.\n\n`+
    `parse_ms mencakup ekstraksi + resolveExtraction; untuk rule tanpa jaringan, untuk live termasuk request provider dan retry SDK. Satu sampel per kalimat; p50/p95 nearest-rank atas 30 durasi (termasuk error). Ini pengukuran parser CLI, belum request–preview UI dan bukan klaim populasi chat EO.\n\n`+
    `${liveNote}\n\n`+
    `Tinjauan adapter \`src/modules/ai/anthropic-parser.ts\`: constructor timeout 8000 ms dan maxRetries 1; beta \`server-side-fallback-2026-07-01\`, fallbacks \`default\`, output_config.format \`json_schema\`; refusal/max_tokens, JSON invalid, schema invalid, dan kegagalan provider menjadi AiUnavailableError. Kontrak diperiksa pada SDK lokal @anthropic-ai/sdk 0.132.1; tes mock ada di \`tests/unit/parser-adapter.test.ts\`. Tes mock tidak membuktikan model atau beta tersedia pada akun provider. Dengan retry, durasi total bisa melebihi 8 detik.\n\n`+
    `Adapter gateway \`src/modules/ai/openai-compatible-parser.ts\`: native fetch Chat Completions, JSON schema strict diminta + validasi Zod server, reasoning_effort low, total timeout 12 detik termasuk maksimal satu retry transient (di bawah timeout klien 15 detik). Prompt mewajibkan semua field; gateway pernah menghilangkan notes saat schema hanya diminta tanpa template eksplisit. Kegagalan/refusal/length/schema invalid menjadi AiUnavailableError generik. Tes mock: \`tests/unit/parser-openai.test.ts\`; eval gateway dibedakan dari rule dan Anthropic.\n\n`+
    results.map((result) => `## ${result.provider}\n\n${summary(result)}\n\n| ID | Kalimat | Label | Aktual | Hasil | parse_ms |\n|---|---|---|---|---|---|\n${result.rows.join('\n')}\n`).join('\n')
  const output = path.resolve(process.cwd(), '../docs/ripple/evidence/parser-eval.md')
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, document, 'utf8')
  // Exit nonzero bila provider yang dijalankan gagal gate; evidence tetap ditulis.
  if (results.some((result) => result.correct / clearCount < 0.9 || result.clarified !== ambiguousCount || result.ambiguousDeltas > 0 || result.errors > 0)) process.exitCode = 1
}

main().catch(() => { process.stderr.write('Evaluasi parser gagal; cek konfigurasi lokal.\n'); process.exitCode = 1 })
