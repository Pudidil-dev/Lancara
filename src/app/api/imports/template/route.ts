import { NextResponse } from 'next/server'
import { route } from '@/lib/http'
import { templatePdf } from '@/modules/imports/template'

export const dynamic = 'force-static'

/** Template rundown standar (contoh fiktif, tanpa data pengguna). */
export const GET = route('imports.template', async () => {
  const bytes = templatePdf()
  return new NextResponse(Buffer.from(bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="template-rundown-lancara.pdf"', 'cache-control': 'public, max-age=3600' },
  })
})
