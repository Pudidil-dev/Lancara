import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { body, route } from '@/lib/http'
import { requireCoordinator, requireEvent, requireSession } from '@/lib/session'
import { executeTool } from '@/modules/agent/tools'

export const dynamic = 'force-dynamic'

const Input = z.object({ tool: z.enum(['edit_rundown', 'edit_event_configuration']), input: z.unknown() }).strict()

/** API agent menyimpan proposal; konfirmasi eksplisit lewat /changes/:id/approve. */
export const POST = route<{ id: string }>('agent.preview', async (req, { params }) => {
  const session = await requireSession(req)
  requireEvent(session, params.id)
  requireCoordinator(session)
  const input = await body(req, Input)
  const outcome = await executeTool(session, input.tool, input.input)
  if (!outcome.ok) throw new AppError(outcome.code ?? 'VALIDATION_ERROR', outcome.error)
  return outcome
}, { mutation: true })
