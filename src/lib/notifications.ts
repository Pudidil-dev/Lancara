'use client'
import { toast } from 'sonner'
import { errorFeedback, type ErrorContext } from './error-feedback'

export function notifyError(error: unknown, options: { id?: string; context?: ErrorContext } = {}) {
  const feedback = errorFeedback(error, options.context)
  const show = feedback.tone === 'warning' ? toast.warning : toast.error
  return show(feedback.title, { id: options.id, description: feedback.message, duration: feedback.uncertain ? 9000 : 6000 })
}

export { toast }
