import { env } from './env'

/**
 * Jam server untuk analysis_now. Prioritas: jam simulasi event (diatur koordinator di mode demo)
 * → DEMO_CLOCK_ISO → jam nyata. Engine menerima nilai ini sebagai parameter, tidak membaca jam sendiri.
 */
export function serverNow(eventSimClock: Date | string | null | undefined): string {
  if (eventSimClock) return new Date(eventSimClock).toISOString()
  const demo = env().DEMO_CLOCK_ISO
  if (demo && !Number.isNaN(Date.parse(demo))) return new Date(demo).toISOString()
  return new Date().toISOString()
}
