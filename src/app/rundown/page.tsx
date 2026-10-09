import { Suspense } from 'react'
import { AppShell } from '@/components/shell/AppShell'
import { RundownScreen } from '@/components/rundown/RundownScreen'
import { Loading } from '@/components/ui'

// Judul = nama acara aktif (Figma Dashboard); ?q= dari kolom pencarian memfilter segmen.
export default function Rundown() { return <AppShell><Suspense fallback={<Loading label="Memuat rundown…" />}><RundownScreen /></Suspense></AppShell> }
