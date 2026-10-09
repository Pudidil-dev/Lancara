import { Suspense } from 'react'
import { AppShell } from '@/components/shell/AppShell'
import { ImportWizard } from '@/components/imports/ImportWizard'
import { Loading } from '@/components/ui'

// Figma "Tambah Rundown" (40:328 → 60:2280 → 66:2938): langkah disimpan di URL (?step=&import=).
export default function NewRundownPage() {
  return <AppShell title="Tambah Rundown" topbar="search" hideTitle><Suspense fallback={<Loading label="Menyiapkan formulir…" />}><ImportWizard /></Suspense></AppShell>
}
