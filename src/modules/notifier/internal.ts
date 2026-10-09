import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'

export function requireNotifierSecret(req: NextRequest) {
  const secret=env().NOTIFIER_CRON_SECRET
  const given=req.headers.get('authorization')
  const digest=(value:string)=>createHash('sha256').update(value).digest()
  if (!secret || !given || !timingSafeEqual(digest('Bearer '+secret),digest(given))) throw new AppError('UNAUTHENTICATED','Secret notifier tidak valid.')
}
