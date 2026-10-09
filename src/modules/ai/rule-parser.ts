// Parser deterministik bahasa Indonesia (provider "rule"). Tanpa jaringan → jalur demo yang selalu tersedia.
import type { Snapshot } from '@/modules/engine/types'
import type { Extraction } from './extraction'

const STOPWORDS = new Set(['dan', 'yang', 'untuk', 'final', 'acara', 'sesi', 'dengan'])

const CANCEL = /\b(batal|dibatalkan|cancel|cancelled|tidak jadi|ga jadi|gak jadi|nggak jadi|ngga jadi)\b/
const OVERRUN = /\b(molor|lebih lama|overtime|over time|belum selesai|baru selesai|selesai (jam|pukul|sekitar|kira))/
const LATE = /\b(telat|terlambat|delay|baru bisa|baru sampai|baru tiba|baru datang|datang|tiba|sampai|bisa mulai|lebih cepat|sudah sampai|sudah datang|otw|mundur)\b/
const ESTIMATE = /\b(sekitar|kira[- ]?kira|kurang lebih|perkiraan|estimasi|kayaknya|mungkin|an)\b|\d(an)\b/

function matchItems(text: string, snapshot: Snapshot): string[] {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Batas kata penting: "talent baru" bukan penyebutan "Talent B".
  const exact = snapshot.items.filter((i) => new RegExp(`\\b${escape(i.title.toLowerCase())}\\b`).test(text))
  if (exact.length) {
    // Singkirkan hanya judul yang merupakan bagian dari judul lebih spesifik.
    // Dua item berbeda yang disebut tetap menjadi pilihan klarifikasi.
    return exact.filter((i) => !exact.some((other) => other.title.length > i.title.length
      && other.title.toLowerCase().includes(i.title.toLowerCase()))).map((i) => i.id)
  }
  const tokenMatches = snapshot.items.filter((i) =>
    i.title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
      .some((w) => new RegExp(`\\b${w}\\b`).test(text)),
  )
  return tokenMatches.map((i) => i.id)
}

function hourFor(h: number, text: string): number {
  if (/\b(malam|sore)\b/.test(text) && h < 12) return h + 12
  if (/\b(pagi)\b/.test(text)) return h
  // Acara demo berlangsung sore–malam: jam 1–11 tanpa keterangan dibaca PM.
  return h >= 1 && h <= 11 ? h + 12 : h
}

function parseTime(text: string): string | null {
  const matches = [...text.matchAll(/(?:jam|pukul|pkl\.?)\s*(\d{1,2})(?:[.:](\d{2}))?|\b(\d{1,2})[.:](\d{2})\b/g)]
  // Beberapa jam dalam satu kabar belum tentu jam yang dimaksud; jangan pilih pertama.
  if (matches.length !== 1) return null
  const match = matches[0]
  const h = hourFor(Number(match[1] ?? match[3]), text)
  const m = Number(match[2] ?? match[4] ?? '0')
  if (h > 23 || m > 59) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function parseMinutes(fragment: string): number | null {
  if (/setengah jam/.test(fragment)) return 30
  const hours = /(\d+(?:[.,]\d+)?)\s*jam\b/.exec(fragment)
  const mins = /(\d+)\s*(menit|mnt|min)\b/.exec(fragment)
  if (!hours && !mins) return null
  return Math.round((hours ? Number(hours[1].replace(',', '.')) * 60 : 0) + (mins ? Number(mins[1]) : 0))
}

export function ruleExtract(rawText: string, snapshot: Snapshot): Extraction {
  const text = rawText.toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/\bbs\b/g, 'bisa').replace(/\bterlmbat\b/g, 'terlambat')
  const notes: string[] = []
  const type = CANCEL.test(text) ? 'cancel_item' : OVERRUN.test(text) ? 'active_end_estimate' : LATE.test(text) ? 'earliest_start' : null
  const item_ids = matchItems(text, snapshot)

  let time_hhmm: string | null = null
  let offset_minutes: number | null = null
  let offset_base: Extraction['offset_base'] = null

  const relative = /(\d+(?:[.,]\d+)?\s*(?:jam|menit|mnt|min)(?:\s*\d+\s*(?:menit|mnt))?|setengah jam)\s*(lagi|dari sekarang)|dalam\s+(\d+\s*(?:jam|menit|mnt)|setengah jam)/.exec(text)
  const delayed = /(telat|terlambat|molor|mundur|delay|lebih lama|lewat)\s*(sekitar|kira-kira|kurang lebih)?\s*(\d+(?:[.,]\d+)?\s*(?:jam|menit|mnt|min)(?:\s*\d+\s*(?:menit|mnt))?|setengah jam)/.exec(text)

  if (relative) {
    offset_minutes = parseMinutes(relative[0])
    offset_base = 'reference'
  } else if (delayed) {
    offset_minutes = parseMinutes(delayed[3])
    offset_base = type === 'active_end_estimate' ? 'planned_end' : 'planned_start'
  } else {
    time_hhmm = parseTime(text)
  }
  if (!time_hhmm && offset_minutes === null && type && type !== 'cancel_item') notes.push('Waktu tidak ditemukan dalam kabar.')

  return { type, item_ids, time_hhmm, offset_minutes, offset_base, is_estimate: ESTIMATE.test(text), notes }
}
