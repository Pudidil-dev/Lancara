import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pisahkan folder build bila perlu (mis. validasi paralel): NEXT_DIST_DIR=.next-validate
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  reactStrictMode: true,
  // Build aplikasi tidak bergantung pada fixture evaluasi lokal yang diabaikan Git.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
  serverExternalPackages: ['pg', 'tesseract.js', '@tesseract.js-data/eng', '@napi-rs/canvas'],
  outputFileTracingIncludes: {
    '/api/support/chat{,/stream}': ['node_modules/tesseract.js/**', 'node_modules/tesseract.js-core/**', 'node_modules/@tesseract.js-data/eng/**', 'node_modules/@napi-rs/canvas*/**'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
