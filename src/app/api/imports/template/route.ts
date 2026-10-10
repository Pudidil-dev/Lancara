import { NextResponse } from 'next/server'
import { route } from '@/lib/http'

/** Pertahankan URL lama untuk unduhan template Word. */
export const GET = route('imports.template', async (req) => {
  return NextResponse.redirect(new URL('/templates/Template_Rundown.docx', req.url))
})
