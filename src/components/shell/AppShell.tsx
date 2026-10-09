'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSession } from '@/hooks/useSession'
import { usePolling } from '@/hooks/usePolling'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { RUNDOWN_PATH, type RundownResponse } from '@/hooks/types'
import { formatClock, formatClockFull, zoneAbbrev } from '@/lib/time'
import { ErrorState, Icon, Loading, type IconName } from '@/components/ui'
import { Brand } from './Brand'
import { PRODUCT_NAME } from '@/lib/brand'
import { PageHeaderContext } from './PageHeader'
import { SupportChat } from '@/components/support/SupportChat'

interface NavLink {
  href: string
  label: string
  icon: IconName
  /** Aktif bila pathname cocok; `exact` mencegah /rundown ikut aktif di /rundown/setup. */
  match: (pathname: string) => boolean
}

const dashboard: NavLink = { href: '/rundown', label: 'Dashboard', icon: 'layout-grid', match: (p) => p === '/rundown' }
const changes: NavLink = { href: '/changes/new', label: 'Perubahan', icon: 'calendar-days', match: (p) => p.startsWith('/changes') }
const history: NavLink = { href: '/history', label: 'Riwayat & konfirmasi', icon: 'history', match: (p) => p.startsWith('/history') }
const setup: NavLink = { href: '/rundown/setup', label: 'Pengaturan', icon: 'settings-2', match: (p) => p.startsWith('/rundown/setup') }
const inbox: NavLink = { href: '/inbox', label: 'Inbox kru', icon: 'inbox', match: (p) => p.startsWith('/inbox') }

const COORDINATOR_NAV = [dashboard, changes, history, setup, inbox]
const CREW_NAV = [inbox, changes, { ...dashboard, label: 'Rundown' }]

function initials(name: string): string {
  const words = name.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}

/**
 * Shell sesuai Figma: sidebar 224px (Ripple/Sidebar) + top bar 80px + konten 32px.
 * `description` dan `actions` mengisi blok "Page title" (deskripsi + tombol aksi di kanan).
 */
export function AppShell({ children, title, description, actions }: { children: ReactNode; title: string; description?: ReactNode; actions?: ReactNode }) {
  const { session, loading, error, refresh } = useSession()
  const online = useOnline()
  const query = usePolling<RundownResponse>(session ? RUNDOWN_PATH : null)
  const logout = useMutation()
  const router = useRouter()
  const pathname = usePathname()
  const [descriptionSlot, setDescriptionSlot] = useState<HTMLElement | null>(null)
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null)
  const slots = useMemo(() => ({ description: descriptionSlot, actions: actionsSlot }), [descriptionSlot, actionsSlot])
  useEffect(() => { if (query.error?.status === 401) void refresh() }, [query.error, refresh])
  async function exit() { try { await logout.mutate({ path: '/api/session', method: 'DELETE', idempotent: false }); router.replace('/login') } catch { /* Hook presents the API error. */ } }
  if (loading) return <main className="container"><Loading label="Memuat sesi…" /></main>
  if (error) return <main className="container"><ErrorState error={error} onRetry={() => void refresh()} /></main>
  if (!session) return <main className="container"><Loading label="Membuka pilihan akun…" /></main>
  const tz = query.data?.event.timezone ?? 'Asia/Jakarta'
  const zone = zoneAbbrev(tz)
  const links = session.capability === 'coordinator' ? COORDINATOR_NAV : CREW_NAV
  const connection = online && !query.error ? '● Terhubung' : online ? '! Gagal memperbarui' : '○ Offline'
  return <>
    <a className="skip-link" href="#main">Lewati ke isi</a>
    <div className="app-shell">
      <aside className="sidebar" aria-label={PRODUCT_NAME}>
        <Brand />
        <nav className="sidebar-nav" aria-label="Navigasi utama">
          {links.map((link) => <Link key={link.href} href={link.href} className="nav-item" aria-current={link.match(pathname) ? 'page' : undefined}>
            <Icon name={link.icon} />{link.label}{link.href === '/rundown' && session.capability === 'crew' && <span className="sr-only"> · hanya baca</span>}
          </Link>)}
        </nav>
        <div className="sidebar-footer">
          <div className="role-card">
            <span className="role-avatar" aria-hidden="true">{initials(session.display_name)}</span>
            <span><span className="role-name">{session.display_name}</span><span className="role-sub">{session.role_label}</span></span>
          </div>
          <span className="sidebar-status" role="status">{connection}{query.lastRefreshed ? ` · Diperbarui ${formatClock(query.lastRefreshed, tz)}` : ''}</span>
          <button className="btn btn-small btn-on-dark" disabled={logout.pending || !online} onClick={() => void exit()}>Keluar</button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="topbar-event">{query.data?.event.name ?? 'Memuat acara…'}</span>
          <span className="topbar-sep" aria-hidden="true">/</span>
          <span className="topbar-stage">Panggung utama</span>
          <span className="topbar-spacer" />
          <span className="badge badge-warning">Simulasi peran demo</span>
          <span className="badge badge-neutral version-tag">Rundown {query.data ? `v${query.data.version}` : '…'}</span>
          <span className="topbar-clock" title="Jam simulasi">{query.data ? `${formatClockFull(query.data.server_now, tz)} ${zone}` : '…'}</span>
        </header>
        <main id="main" className="page-content">
          <div aria-live="polite">{!online && <p className="alert alert-action">! Tidak ada koneksi. Perubahan memerlukan server.</p>}</div>
          {query.error && <ErrorState error={query.error} onRetry={() => void query.refresh()} />}
          {logout.error && <ErrorState error={logout.error} />}
          <div className="page-title">
            <div className="page-title-copy"><h1>{title}</h1>{description && <p>{description}</p>}<div className="page-title-description" ref={setDescriptionSlot} /></div>
            <div className="page-title-actions" ref={setActionsSlot}>{actions}</div>
          </div>
          <PageHeaderContext.Provider value={slots}>{children}</PageHeaderContext.Provider>
          <SupportChat />
        </main>
      </div>
    </div>
  </>
}
