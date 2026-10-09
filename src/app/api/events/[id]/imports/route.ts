import { readFile, route } from '@/lib/http'
import { AppError } from '@/lib/errors'
import { requireSession } from '@/lib/session'
import { createImport } from '@/modules/imports/service'
import { MAX_IMPORT_BYTES } from '@/modules/imports/types'

export const dynamic = 'force-dynamic'
// Ekstraksi AI dokumen panjang bisa memakan puluhan detik.
export const maxDuration = 90

/** POST multipart: file (PDF), pages (opsional, mis. "1-4"), settings (JSON pengaturan acara langkah 1). */
export const POST = route<{ id: string }>(
  'imports.create',
  async (req, { params }) => {
    const session = await requireSession(req)
    const file = await readFile(req, { maxBytes: MAX_IMPORT_BYTES })
    let settings: unknown
    try { settings = JSON.parse(file.fields.settings ?? 'null') } catch { throw new AppError('VALIDATION_ERROR', 'Pengaturan acara tidak valid.') }
    return createImport(session, params.id, { filename: file.name, bytes: file.bytes, pages: file.fields.pages ?? null, settings })
  },
  { multipart: true },
)
