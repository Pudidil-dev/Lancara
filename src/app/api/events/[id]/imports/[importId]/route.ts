import { z } from 'zod'
import { body, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { getImport, updateImportRows } from '@/modules/imports/service'

export const dynamic = 'force-dynamic'

export const GET = route<{ id: string; importId: string }>('imports.get', async (req, { params }) => getImport(await requireSession(req), params.id, params.importId))

// Isi baris divalidasi ketat di service (ImportRowSchema); di sini hanya bentuk amplop.
const Input = z.object({ rows: z.array(z.unknown()).max(60), settings: z.unknown().optional() })

export const PATCH = route<{ id: string; importId: string }>(
  'imports.update',
  async (req, { params }) => updateImportRows(await requireSession(req), params.id, params.importId, await body(req, Input)),
  { mutation: true },
)
