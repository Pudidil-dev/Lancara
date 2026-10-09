import { z } from 'zod'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_HISTORY_TEXT, MAX_HISTORY_TURNS, MAX_MESSAGE } from './limits'

export const SupportInput = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(MAX_HISTORY_TEXT) })).max(MAX_HISTORY_TURNS).optional(),
  attachments: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    mime_type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
    data: z.string().min(4).max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  }).strict()).max(MAX_ATTACHMENTS).optional(),
})
