'use client'
import { Icon , Label, Input, NativeSelect, NativeSelectOption } from '@/components/ui'
import { addSeconds, formatClock, localDate, localToUtc, toMs } from '@/lib/time'
import type { Snapshot } from '@/modules/engine/types'
import type { ImportSettings } from '@/modules/imports/types'

export const TIMEZONES: Array<{ value: ImportSettings['timezone']; label: string; abbr: string }> = [
  { value: 'Asia/Jakarta', label: 'WIB (UTC+7 - Jakarta / Barat)', abbr: 'WIB' },
  { value: 'Asia/Makassar', label: 'WITA (UTC+8 - Makassar / Tengah)', abbr: 'WITA' },
  { value: 'Asia/Jayapura', label: 'WIT (UTC+9 - Jayapura / Timur)', abbr: 'WIT' },
]

/** Nilai awal dari rundown aktif. */
export function settingsFromSnapshot(snapshot: Snapshot): ImportSettings {
  const tz = TIMEZONES.some((t) => t.value === snapshot.event.timezone) ? (snapshot.event.timezone as ImportSettings['timezone']) : 'Asia/Jakarta'
  return { name: snapshot.event.name, timezone: tz, curfew_hhmm: formatClock(snapshot.event.curfew_at, snapshot.event.timezone).replace('.', ':').slice(0, 5) }
}

/** Snapshot dengan pengaturan acara baru (item tidak berubah). Curfew diletakkan setelah segmen pertama. */
export function applySettings(snapshot: Snapshot, settings: ImportSettings): Snapshot {
  let curfew = snapshot.event.curfew_at
  if (settings.curfew_hhmm) {
    const first = snapshot.items.reduce((min, i) => Math.min(min, toMs(i.start_at)), Number.POSITIVE_INFINITY)
    const anchor = Number.isFinite(first) ? new Date(first).toISOString() : snapshot.event.curfew_at
    curfew = localToUtc(localDate(anchor, settings.timezone), settings.curfew_hhmm, settings.timezone)
    if (Number.isFinite(first) && toMs(curfew) <= first) curfew = addSeconds(curfew, 24 * 3600)
  }
  return { ...snapshot, event: { ...snapshot.event, name: settings.name.trim(), timezone: settings.timezone, curfew_at: curfew } }
}

export function settingsError(settings: ImportSettings): string | null {
  if (!settings.name.trim()) return 'Nama acara wajib diisi.'
  if (settings.name.trim().length > 120) return 'Nama acara maksimal 120 karakter.'
  return null
}

/** Kartu "Pengaturan acara" (Figma 60:2107): nama acara, zona waktu, batas selesai acara. */
export function EventSettingsFields({ value, onChange, showErrors }: { value: ImportSettings; onChange: (next: ImportSettings) => void; showErrors?: boolean }) {
  const error = showErrors ? settingsError(value) : null
  const abbr = TIMEZONES.find((t) => t.value === value.timezone)?.abbr ?? 'WIB'
  return (
    <section className="lc-card" aria-labelledby="event-settings-title">
      <div>
        <h2 id="event-settings-title" className="lc-h2">Pengaturan acara</h2>
        <p className="lc-small">Informasi dasar untuk penyesuaian jadwal dan batas rundown operasional.</p>
      </div>
      <div className="settings-fields">
        <div className="lc-field">
          <div className="lc-field-label"><Label htmlFor="event-name">Nama acara</Label><span className="lc-tag">Wajib</span></div>
          <div className="lc-input">
            <Icon name="masks" />
            <Input id="event-name" value={value.name} maxLength={120} required aria-invalid={!!error || undefined} aria-describedby="event-name-hint" onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="Opening Night Showcase" />
          </div>
          {error ? <p className="lc-error" role="alert">{error}</p> : <p id="event-name-hint" className="lc-small">Tertera pada teleprompter dan log cue.</p>}
        </div>
        <div className="lc-field">
          <div className="lc-field-label"><Label htmlFor="event-tz">Zona waktu</Label><span className="lc-tag">Wajib</span></div>
          <div className="lc-input">
            <Icon name="clock" />
            <NativeSelect id="event-tz" value={value.timezone} onChange={(e) => onChange({ ...value, timezone: e.target.value as ImportSettings['timezone'] })} aria-describedby="event-tz-hint">
              {TIMEZONES.map((t) => <NativeSelectOption key={t.value} value={t.value}>{t.label}</NativeSelectOption>)}
            </NativeSelect>
            <Icon name="chevron-down" size={10} />
          </div>
          <p id="event-tz-hint" className="lc-small">Patokan sinkronisasi waktu master clock.</p>
        </div>
        <div className="lc-field">
          <div className="lc-field-label"><Label htmlFor="event-curfew">Batas selesai acara</Label><span className="lc-tag" data-optional="true">Opsional</span></div>
          <div className="lc-input">
            <Icon name="timer-off" />
            <Input id="event-curfew" type="time" data-strong="true" value={value.curfew_hhmm ?? ''} aria-describedby="event-curfew-hint" onChange={(e) => onChange({ ...value, curfew_hhmm: e.target.value || null })} />
            {value.curfew_hhmm && <span className="lc-input-suffix">{abbr}</span>}
          </div>
          <p id="event-curfew-hint" className="lc-small">Peringatan otomatis saat alur mendekati batas ({abbr}).</p>
        </div>
      </div>
    </section>
  )
}
