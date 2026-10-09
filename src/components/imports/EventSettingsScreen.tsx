'use client'
import { useEffect, useState } from 'react'
import { ErrorState, Icon, Loading } from '@/components/ui'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { usePolling } from '@/hooks/usePolling'
import { EVENT_ID, RUNDOWN_PATH, type RundownResponse } from '@/hooks/types'
import type { ImportSettings } from '@/modules/imports/types'
import { applySettings, EventSettingsFields, settingsError, settingsFromSnapshot } from './EventSettingsFields'

/** Halaman "Pengaturan": kartu Pengaturan acara yang sama dengan langkah 1 Tambah Rundown. */
export function EventSettingsScreen() {
  const rundown = usePolling<RundownResponse>(RUNDOWN_PATH, { intervalMs: 30000 })
  const save = useMutation()
  const online = useOnline()
  const [settings, setSettings] = useState<ImportSettings | null>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => { if (rundown.data && !settings) setSettings(settingsFromSnapshot(rundown.data.snapshot)) }, [rundown.data, settings])
  if (!rundown.data || !settings) return rundown.error ? <ErrorState error={rundown.error} onRetry={rundown.refresh} /> : <Loading label="Memuat pengaturan…" />
  const data = rundown.data
  async function submit() {
    if (!settings || settingsError(settings)) return
    setNotice('')
    try {
      const result = await save.mutate<{ new_version: number }>({ path: `/api/events/${EVENT_ID}/setup`, method: 'PUT', body: { base_version: data.version, snapshot: applySettings(data.snapshot, settings), note: 'Pengaturan acara diperbarui' } })
      setNotice(`Pengaturan tersimpan · Rundown v${result.new_version}.`)
    } catch { /* Error ditampilkan di bawah. */ }
  }
  return <div className="settings-page">
    <EventSettingsFields value={settings} onChange={setSettings} showErrors />
    {save.error && <ErrorState error={save.error} />}
    <p role="status" aria-live="polite" className="dash-notice">{notice}</p>
    <button type="button" className="btn-gradient btn-block wizard-primary" disabled={save.pending || !online || !!settingsError(settings)} onClick={() => void submit()}>{save.pending ? 'Menyimpan…' : 'Simpan perubahan'}<Icon name="check" /></button>
  </div>
}
