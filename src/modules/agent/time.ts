import { AppError } from '@/lib/errors'
import { localDate, localToUtc, toMs } from '@/lib/time'
import type { Snapshot } from '@/modules/engine/types'

/** Jam lokal dipetakan ke tanggal di rentang event, bukan selalu tanggal curfew. */
export function resolveEventClock(snapshot: Snapshot, hhmm: string, referenceIso: string): string {
  if (!/^([01]?\d|2[0-3])[:.][0-5]\d$/.test(hhmm)) throw new AppError('VALIDATION_ERROR', 'Jam harus berformat HH.MM atau HH:MM.')
  const zone = snapshot.event.timezone
  const end = toMs(snapshot.event.curfew_at)
  const start = snapshot.items.length ? Math.min(...snapshot.items.map(item => toMs(item.start_at))) : end - 24 * 60 * 60_000
  const firstDate = localDate(new Date(start).toISOString(), zone)
  const finalDate = localDate(snapshot.event.curfew_at, zone)
  const calendarStart = Date.parse(`${firstDate}T00:00:00Z`)
  const days = Math.round((Date.parse(`${finalDate}T00:00:00Z`) - calendarStart) / 86_400_000)
  const candidates: string[] = []
  for (let day = 0; day <= days; day++) {
    const date = new Date(calendarStart + day * 86_400_000).toISOString().slice(0, 10)
    const value = localToUtc(date, hhmm.replace('.', ':'), zone)
    if (toMs(value) >= start && toMs(value) <= end) candidates.push(value)
  }
  if (!candidates.length) throw new AppError('VALIDATION_ERROR', 'Jam itu berada di luar rentang tanggal acara. Pilih jam di dalam rundown event.')
  const reference = toMs(referenceIso)
  return candidates.sort((a, b) => Math.abs(toMs(a) - reference) - Math.abs(toMs(b) - reference) || toMs(a) - toMs(b))[0]
}
