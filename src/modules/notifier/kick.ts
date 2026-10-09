import { after } from 'next/server'
import { env } from '@/lib/env'
import { log } from '@/lib/logger'
import { drain } from './dispatch'

export function scheduleNotificationDrain() {
  if (!env().TELEGRAM_ENABLED) return
  after(async()=>{
    try { await drain() } catch { log('error','notifier.drain',{error_code:'drain_failed'}) }
  })
}
