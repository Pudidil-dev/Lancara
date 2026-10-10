import { Suspense } from 'react'
import { AppShell } from '@/components/shell/AppShell'
import { RundownScreen } from '@/components/rundown/RundownScreen'
import { Loading } from '@/components/ui'

// Dashboard = halaman utama "/". Judul = nama acara aktif (Figma Dashboard); ?q= dari kolom pencarian memfilter segmen.
// Tanpa sesi, AppShell (useSession) mengarahkan ke /login.
export default function Dashboard() { return <AppShell><Suspense fallback={<Loading label="Memuat rundown…" />}><RundownScreen /></Suspense></AppShell> }
