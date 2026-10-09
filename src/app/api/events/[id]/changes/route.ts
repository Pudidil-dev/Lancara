import { z } from 'zod'
import { body, route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { createChange, listChanges, MAX_TEXT } from '@/modules/changes/service'

export const dynamic = 'force-dynamic'

const Input = z.object({
  original_text: z.string().max(MAX_TEXT).nullable().optional(),
  reference_at: z.string().refine((v) => !Number.isNaN(Date.parse(v))).nullable().optional(),
})

export const GET = route<{ id: string }>('changes.list', async (req, { params }) => listChanges(await requireSession(req), params.id))

export const POST = route<{ id: string }>(
  'changes.create',
  async (req, { params }) => createChange(await requireSession(req), params.id, await body(req, Input)),
  { mutation: true },
)
