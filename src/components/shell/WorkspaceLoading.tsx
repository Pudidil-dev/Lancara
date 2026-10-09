import { Icon } from '@/components/ui/Icon'
import { Skeleton } from '@/components/ui/skeleton'
import { BRAND_WORDMARK } from '@/lib/brand'

/** Non-interactive shell while the server resolves the session and active event. */
export function WorkspaceLoading({ label = 'Membuka ruang kerja…' }: { label?: string }) {
  return <main className="workspace-loading" aria-busy="true" aria-label="Ruang kerja sedang dimuat">
    <aside className="workspace-loading-sidebar" aria-hidden="true">
      <div className="workspace-loading-brand"><Icon name="lancara-mark" size={24} /><span>{BRAND_WORDMARK}</span></div>
      <div className="workspace-loading-nav">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="workspace-loading-nav-item" />)}</div>
    </aside>
    <div className="workspace-loading-body">
      <div className="workspace-loading-topbar" aria-hidden="true">
        <div className="workspace-loading-brand"><Icon name="lancara-mark" size={24} /><span>{BRAND_WORDMARK}</span></div>
        <Skeleton className="workspace-loading-avatar" />
      </div>
      <div className="workspace-loading-content">
        <div className="workspace-loading-status" role="status" aria-live="polite" aria-atomic="true">
          <span className="workspace-loading-indicator" aria-hidden="true"><span className="spinner" /></span>
          <div><h1>{label}</h1><p>Menyiapkan acara dan rundown Anda.</p></div>
        </div>
        <div className="workspace-loading-preview" aria-hidden="true">
          <div className="workspace-loading-summary">{Array.from({ length: 3 }, (_, i) => <div className="workspace-loading-card" key={i}><Skeleton className="workspace-loading-short" /><Skeleton className="workspace-loading-number" /></div>)}</div>
          <div className="workspace-loading-card workspace-loading-table">
            <Skeleton className="workspace-loading-title" />
            {Array.from({ length: 5 }, (_, i) => <div className="workspace-loading-row" key={i}><Skeleton className="workspace-loading-time" /><Skeleton className="workspace-loading-segment" /><Skeleton className="workspace-loading-time" /></div>)}
          </div>
        </div>
      </div>
    </div>
  </main>
}
