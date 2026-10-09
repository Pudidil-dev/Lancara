'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useSession } from '@/hooks/useSession'
import { usePolling } from '@/hooks/usePolling'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { EVENT_ID, RUNDOWN_PATH, type RundownResponse } from '@/hooks/types'
import { ErrorState, Icon, Loading, type IconName } from '@/components/ui'
import { Brand } from './Brand'
import { PageHeaderContext } from './PageHeader'
import { PRODUCT_NAME } from '@/lib/brand'

interface NavLink {
  href: string
  label: string
  icon: IconName
  match: (pathname: string) => boolean
}

/** Menu sesuai Figma Ripple/Sidebar: Dashboard, Rundown, Konfirmasi perubahan, Riwayat, Pengaturan. */
const NAVIGATION: NavLink[] = [
  { href: '/rundown', label: 'Dashboard', icon: 'layout-grid', match: (p) => p === '/rundown' || p.startsWith('/changes/') },
  { href: '/rundown/setup', label: 'Rundown', icon: 'calendar-days', match: (p) => p.startsWith('/rundown/setup') || p.startsWith('/rundown/new') },
  { href: '/inbox', label: 'Konfirmasi perubahan', icon: 'inbox', match: (p) => p.startsWith('/inbox') },
  { href: '/history', label: 'Riwayat', icon: 'history', match: (p) => p.startsWith('/history') },
  { href: '/settings', label: 'Pengaturan', icon: 'settings-2', match: (p) => p.startsWith('/settings') },
]

const COLLAPSE_KEY = 'lancara.sidebar.collapsed'

function initials(name: string): string {
  const words = name.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}

interface AppShellProps {
  children: ReactNode
  /** Judul halaman; default nama acara aktif (Figma Dashboard). */
  title?: string
  description?: ReactNode
  actions?: ReactNode
  /** Top bar: nama acara (Dashboard) atau kolom pencarian (layar Tambah Rundown). */
  topbar?: 'event' | 'search'
  /** Halaman yang menggambar judulnya sendiri (wizard). */
  hideTitle?: boolean
}

/** Shell Figma: sidebar ungu 224px (Ripple/Sidebar) + top bar 80px + konten. Mobile: drawer lewat tombol menu. */
export function AppShell({ children, title, description, actions, topbar = 'event', hideTitle = false }: AppShellProps) {
  const { session, loading, error, refresh } = useSession()
  const online = useOnline()
  // Session dan rundown dapat dimuat bersamaan; endpoint rundown tetap memeriksa session server.
  const query = usePolling<RundownResponse>(loading || session ? RUNDOWN_PATH : null)
  const inbox = usePolling<{ briefs: Array<{ acknowledged_at: string | null }> }>(session ? `/api/events/${EVENT_ID}/inbox` : null, { intervalMs: 15000 })
  const logout = useMutation()
  const router = useRouter()
  const pathname = usePathname()
  const [descriptionSlot, setDescriptionSlot] = useState<HTMLElement | null>(null)
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [search, setSearch] = useState('')
  const accountRef = useRef<HTMLDivElement>(null)
  const slots = useMemo(() => ({ description: descriptionSlot, actions: actionsSlot }), [descriptionSlot, actionsSlot])
  useEffect(() => { if (query.error?.status === 401) void refresh() }, [query.error, refresh])
  useEffect(() => { try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1') } catch { /* Penyimpanan lokal opsional. */ } }, [])
  useEffect(() => { setMenuOpen(false); setAccountOpen(false) }, [pathname])
  useEffect(() => {
    if (!accountOpen) return
    const close = (event: MouseEvent) => { if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [accountOpen])

  function toggleCollapsed() {
    setCollapsed((value) => {
      try { localStorage.setItem(COLLAPSE_KEY, value ? '0' : '1') } catch { /* Penyimpanan lokal opsional. */ }
      return !value
    })
  }
  async function exit() { try { await logout.mutate({ path: '/api/session', method: 'DELETE', idempotent: false }); router.replace('/login') } catch { /* Hook presents the API error. */ } }
  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const term = search.trim()
    router.push(term ? `/rundown?q=${encodeURIComponent(term)}` : '/rundown')
  }

  if (loading) return <main className="container"><Loading label="Memuat sesi…" /></main>
  if (error) return <main className="container"><ErrorState error={error} onRetry={() => void refresh()} /></main>
  if (!session) return <main className="container"><Loading label="Membuka pilihan akun…" /></main>
  const eventName = query.data?.event.name ?? 'Memuat acara…'
  const unread = (inbox.data?.briefs ?? []).filter((brief) => !brief.acknowledged_at).length
  return <>
    <a className="skip-link" href="#main">Lewati ke isi</a>
    <div className="app-shell" data-collapsed={collapsed || undefined} data-menu={menuOpen ? 'open' : undefined}>
      <aside className="sidebar" id="app-sidebar" aria-label={PRODUCT_NAME}>
        <div className="sidebar-brand">
          <Brand />
          <button type="button" className="sidebar-icon-btn sidebar-collapse" aria-pressed={collapsed} aria-label={collapsed ? 'Lebarkan menu' : 'Ciutkan menu'} onClick={toggleCollapsed}><Icon name="panel-left-close" /></button>
        </div>
        <nav className="sidebar-nav" aria-label="Navigasi utama">
          {NAVIGATION.map((link) => <Link key={link.href} href={link.href} className="nav-item" title={collapsed ? link.label : undefined} aria-current={link.match(pathname) ? 'page' : undefined}>
            <Icon name={link.icon} /><span className="nav-label">{link.label}</span>
          </Link>)}
        </nav>
        <div className="sidebar-footer" ref={accountRef}>
          {accountOpen && <div className="role-menu" role="menu" aria-label="Akun">
            <p>{session.display_name}</p>
            <button type="button" role="menuitem" disabled={logout.pending || !online} onClick={() => void exit()}>{logout.pending ? 'Keluar…' : 'Keluar'}</button>
          </div>}
          <button type="button" className="role-card" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((v) => !v)}>
            <span className="role-avatar" aria-hidden="true">{initials(session.display_name)}</span>
            <span className="role-text"><span className="role-name">{session.role_label}</span><span className="role-sub">Ruang kendali</span></span>
          </button>
        </div>
      </aside>
      <button type="button" className="sidebar-backdrop" aria-label="Tutup menu" tabIndex={-1} onClick={() => setMenuOpen(false)} />
      <div className="workspace">
        <header className="topbar">
          {topbar === 'search'
            ? <form className="topbar-search" role="search" onSubmit={submitSearch}>
                <Icon name="search" />
                <label htmlFor="topbar-search" className="sr-only">Cari rundown</label>
                <input id="topbar-search" type="search" placeholder="Cari rundown anda..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </form>
            : <div className="topbar-title"><span>{eventName}</span><Icon name="chevrons-down-up" /></div>}
          <span className="topbar-spacer" />
          <Link href="/inbox" className="topbar-bell" data-unread={unread > 0 || undefined} aria-label={unread ? `Konfirmasi perubahan: ${unread} brief belum dibaca` : 'Konfirmasi perubahan'}><Icon name="bell-line" /></Link>
          <Link href="/rundown/new" className="btn-gradient"><span className="btn-label">Tambah Rundown</span><Icon name="plus" /></Link>
          <button type="button" className="topbar-menu" aria-label="Buka menu" aria-controls="app-sidebar" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><span /></button>
        </header>
        <main id="main" className="page-content">
          <div aria-live="polite">{!online && <p className="alert alert-action">! Tidak ada koneksi. Perubahan memerlukan server.</p>}</div>
          {query.error && <ErrorState error={query.error} onRetry={() => void query.refresh()} />}
          {logout.error && <ErrorState error={logout.error} />}
          {!hideTitle && <div className="page-title">
            <div className="page-title-copy"><h1>{title ?? eventName}</h1>{description && <p>{description}</p>}<div className="page-title-description" ref={setDescriptionSlot} /></div>
            <div className="page-title-actions" ref={setActionsSlot}>{actions}</div>
          </div>}
          <PageHeaderContext.Provider value={slots}>{children}</PageHeaderContext.Provider>
        </main>
      </div>
    </div>
  </>
}
