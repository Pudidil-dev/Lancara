import type { Metadata } from 'next'
import { PublicRundownView } from '@/components/share/PublicRundownView'

// Tautan publik tidak untuk diindeks mesin pencari; akses hanya bagi yang menerima tautan.
export const metadata: Metadata = { title: 'Rundown publik — Lancara', robots: { index: false, follow: false } }

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <PublicRundownView token={token} />
}
