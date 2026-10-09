'use client'
import { useRouter } from 'next/navigation'
import { usePolling } from '@/hooks/usePolling'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import type { Account, SessionResponse } from '@/hooks/types'
import { ErrorState, Loading } from '@/components/ui'
import { Brand } from '@/components/shell/Brand'
export default function Login() {
  const query = usePolling<SessionResponse>('/api/session')
  const mutation = useMutation()
  const online = useOnline()
  const router = useRouter()
  async function select(account: Account) {
    try { await mutation.mutate({ path: '/api/session', body: { actor_id: account.id }, idempotent: false }); router.replace(account.capability === 'coordinator' ? '/rundown' : '/inbox') }
    catch { /* Error stays visible. */ }
  }
  return <main className="login-layout"><section className="login-intro"><Brand /><p className="eyebrow">LIVE EVENT RECOVERY ENGINE</p><h1>Saat rencana berubah,<br />kru tetap satu arah.</h1><p>Konfirmasi kabar, periksa dampak, lalu kirim keputusan yang jelas ke peran terdampak.</p><ol className="login-flow"><li>Kabar masuk</li><li>Opsi diperiksa</li><li>Koordinator menyetujui</li><li>Kru membaca brief</li></ol></section><section className="login-accounts stack"><span className="demo-label">Simulasi peran demo — data fiktif</span><h2>Pilih peran Anda</h2><p className="muted">Akun demo tanpa password. Setiap peran melihat informasi sesuai tugasnya.</p><div aria-live="polite">{!online && <p className="alert alert-action">Tidak ada koneksi. Perubahan memerlukan server.</p>}{mutation.pending && <Loading label="Membuka ruang kerja…" />}</div>{query.error && <ErrorState error={query.error} onRetry={() => void query.refresh()} />}{mutation.error && <ErrorState error={mutation.error} />}{!query.data && !query.error && <Loading label="Memuat akun demo…" />}{query.data && ['coordinator', 'crew'].map(capability => <fieldset className="account-group" key={capability}><legend>{capability === 'coordinator' ? 'Koordinator' : 'Kru acara'}</legend><div className="account-grid">{(query.data?.accounts ?? []).filter(a => a.capability === capability).map(a => <button key={a.id} className="account-card" disabled={mutation.pending || !online} onClick={() => void select(a)}><span className="avatar" aria-hidden="true">{a.display_name[0]}</span><span><strong>{a.display_name}</strong><small>{a.role_label}</small></span><span className="account-arrow" aria-hidden="true">→</span></button>)}</div></fieldset>)}</section></main>
}
