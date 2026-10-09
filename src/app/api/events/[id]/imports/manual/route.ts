import { body, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { createManualImport } from '@/modules/imports/service'
import { ManualImportInputSchema } from '@/modules/imports/types'

export const dynamic = 'force-dynamic'

/** POST JSON {settings, rows}: isian manual Figma "Siapkan Data" → draft impor yang ditinjau di langkah 3. */
export const POST = route<{ id: string }>(
  'imports.manual',
  async (req, { params }) => createManualImport(await requireSession(req), params.id, await body(req, ManualImportInputSchema)),
  { mutation: true },
)
