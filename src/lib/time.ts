// Utilitas waktu tanpa dependensi. Penyimpanan selalu UTC; tampilan memakai zona waktu IANA event.

export const MINUTE = 60
export const HOUR = 3600

export function toMs(iso: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`Timestamp tidak valid: ${iso}`)
  return ms
}

export function isValidIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

export function normalizeIso(iso: string): string {
  return toIso(toMs(iso))
}

export function addSeconds(iso: string, seconds: number): string {
  return toIso(toMs(iso) + seconds * 1000)
}

function partsInZone(ms: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const out: Record<string, string> = {}
  for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
  }
}

/** Offset zona (ms) pada instant tertentu: local - UTC. */
export function zoneOffsetMs(ms: number, timeZone: string): number {
  const p = partsInZone(ms, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - (ms - (ms % 1000))
}

/** Tanggal lokal event (YYYY-MM-DD) untuk sebuah instant. */
export function localDate(iso: string, timeZone: string): string {
  const p = partsInZone(toMs(iso), timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** "HH:MM" lokal pada tanggal lokal tertentu → ISO UTC. */
export function localToUtc(dateYmd: string, hhmm: string, timeZone: string): string {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(hhmm.trim())
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd)
  if (!m || !d) throw new Error(`Format waktu tidak valid: ${dateYmd} ${hhmm}`)
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(m[1]), Number(m[2]))
  const offset = zoneOffsetMs(guess - zoneOffsetMs(guess, timeZone), timeZone)
  return toIso(guess - offset)
}

/** Jam lokal "HH.MM" (gaya Indonesia). Tambahkan tanggal bila berbeda dari tanggal acuan. */
export function formatClock(iso: string, timeZone: string, refIso?: string): string {
  const p = partsInZone(toMs(iso), timeZone)
  const hm = `${String(p.hour).padStart(2, '0')}.${String(p.minute).padStart(2, '0')}`
  if (refIso && localDate(iso, timeZone) !== localDate(refIso, timeZone)) {
    return `${hm} (${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')})`
  }
  return hm
}

export function formatRange(startIso: string, endIso: string, timeZone: string): string {
  return `${formatClock(startIso, timeZone)}–${formatClock(endIso, timeZone, startIso)}`
}

export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} mnt`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} j ${rest} mnt` : `${h} j`
}

export function zoneAbbrev(timeZone: string): string {
  if (timeZone === 'Asia/Jakarta') return 'WIB'
  if (timeZone === 'Asia/Makassar') return 'WITA'
  if (timeZone === 'Asia/Jayapura') return 'WIT'
  return timeZone
}

/** Jam lokal lengkap "HH:MM:SS" (gaya papan status; dipakai top bar). */
export function formatClockFull(iso: string, timeZone: string): string {
  const p = partsInZone(toMs(iso), timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
}
