import type { Metadata, Viewport } from 'next'
import { Inter, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import './lancara-figma.css'
import './ui-components.css'
import { PRODUCT_NAME } from '@/lib/brand'
import { PollingProvider } from '@/hooks/PollingProvider'
import { EventBoundary } from '@/hooks/EventBoundary'
import { Toaster } from '@/components/ui/sonner'

// Typeface dari Figma (Ripple/h1…caption): Plus Jakarta Sans 400/500/600/700.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-jakarta',
})
// Layar Tambah Rundown di Figma (40:328, 60:2280, 66:2938) memakai Inter untuk judul dan teks isian.
const inter = Inter({ subsets: ['latin'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-inter-family' })

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — Live Event Recovery`,
  applicationName: PRODUCT_NAME,
  description: `${PRODUCT_NAME}: kelola perubahan acara, sesuaikan rundown, dan kirim brief ke kru.`,
  openGraph: {
    title: `${PRODUCT_NAME} — Live Event Recovery`,
    siteName: PRODUCT_NAME,
    description: 'Kelola perubahan acara, sesuaikan rundown, dan kirim brief ke kru.',
    locale: 'id_ID',
    type: 'website',
  },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${jakarta.variable} ${inter.variable}`}>
      <body><PollingProvider><EventBoundary>{children}</EventBoundary></PollingProvider><Toaster /></body>
    </html>
  )
}
