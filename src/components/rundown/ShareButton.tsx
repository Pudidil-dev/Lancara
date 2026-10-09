'use client'
import { useEffect, useState } from 'react'
import { Dialog, ErrorState, Icon } from '@/components/ui'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { usePolling } from '@/hooks/usePolling'
import { EVENT_ID } from '@/hooks/types'

interface ShareLink { token: string; path: string; created_at: string }
const PATH = `/api/events/${EVENT_ID}/share`

/** Tombol "Bagikan" di kanan atas rundown: tautan publik hanya-baca untuk siapa pun tanpa login. */
export function ShareButton() {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [origin, setOrigin] = useState('')
  const query = usePolling<{ share: ShareLink | null }>(open ? PATH : null, { intervalMs: 0 })
  const create = useMutation()
  const revoke = useMutation()
  const online = useOnline()
  useEffect(() => setOrigin(window.location.origin), [])
  const share = query.data?.share ?? null
  const url = share ? `${origin}${share.path}` : ''
  const busy = create.pending || revoke.pending

  async function makeLink() {
    setNotice('')
    try { await create.mutate({ path: PATH, idempotent: false }); await query.refresh(); setNotice('Tautan publik aktif.') } catch { /* Error ditampilkan di dialog. */ }
  }
  async function disable() {
    setNotice('')
    try { await revoke.mutate({ path: PATH, method: 'DELETE', idempotent: false }); await query.refresh(); setNotice('Tautan dinonaktifkan. Orang yang memegang tautan lama tidak bisa membuka rundown lagi.') } catch { /* Error ditampilkan di dialog. */ }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); setNotice('Tautan disalin.') }
    catch { setNotice('Salin manual: pilih tautan di kolom lalu tekan Ctrl+C.') }
  }

  return <>
    <button type="button" className="btn-share" aria-haspopup="dialog" onClick={() => { setOpen(true); setNotice('') }}><Icon name="share" />Bagikan</button>
    <Dialog open={open} title="Bagikan rundown" onClose={() => setOpen(false)} busy={busy}>
      <div className="share-dialog">
        <p className="lc-small">Siapa pun yang memiliki tautan dapat melihat rundown aktif tanpa login atau peran. Tampilan hanya baca dan ikut diperbarui saat rundown berubah.</p>
        <p className="lc-small">Yang dibagikan: jam, segmen, durasi, PIC (peran), dan status. Catatan teknis, perlengkapan, dan kabar perubahan tidak dibagikan.</p>
        {query.error && <ErrorState error={query.error} onRetry={() => void query.refresh()} />}
        {!query.data && !query.error && <p className="lc-small" role="status">Memuat tautan…</p>}
        {query.data && !share && <button type="button" className="btn-gradient btn-block" disabled={busy || !online} onClick={() => void makeLink()}>{create.pending ? 'Membuat tautan…' : 'Buat tautan publik'}<Icon name="share" /></button>}
        {share && <>
          <label htmlFor="share-url" className="share-label">Tautan publik</label>
          <div className="share-row">
            <input id="share-url" readOnly value={url} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn-gradient" onClick={() => void copy()}>Salin tautan</button>
          </div>
          <div className="share-row">
            <a className="template-link" href={share.path} target="_blank" rel="noopener noreferrer">Buka tampilan publik</a>
            <button type="button" className="btn btn-danger btn-compact" disabled={busy || !online} onClick={() => void disable()}>{revoke.pending ? 'Menonaktifkan…' : 'Nonaktifkan tautan'}</button>
          </div>
        </>}
        {(create.error || revoke.error) && <ErrorState error={(create.error ?? revoke.error)!} />}
        <p role="status" aria-live="polite" className="dash-notice">{notice}</p>
      </div>
    </Dialog>
  </>
}
