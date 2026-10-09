import { z } from 'zod'
import { body, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { MAX_TEXT } from '@/modules/changes/service'
import { createCorrection } from '@/modules/decisions/service'

export const dynamic = 'force-dynamic'

const Input = z.object({ original_text: z.string().max(MAX_TEXT).nullable().optional(), reference_at: z.string().nullable().optional() })

export const POST = route<{ id: string }>(
  'decision.correction',
  async (req, { params }) => createCorrection(await requireSession(req), params.id, await body(req, Input)),
  { mutation: true },
)
