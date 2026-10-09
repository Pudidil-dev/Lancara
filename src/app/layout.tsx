import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import { PRODUCT_NAME } from '@/lib/brand'

// Typeface dari Figma (Ripple/h1…caption): Plus Jakarta Sans 400/500/600/700.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-jakarta',
})

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
    <html lang="id" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  )
}
