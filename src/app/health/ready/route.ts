import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  const started = performance.now()
  try {
    const rows = await query<{ n: string }>('SELECT count(*) AS n FROM events')
    const cfg = env()
    return NextResponse.json({
      status: 'ready',
      db: 'ok',
      db_ms: Math.round(performance.now() - started),
      seeded: Number(rows[0].n) > 0,
      ai: cfg.AI_PROVIDER === 'anthropic' && !cfg.ANTHROPIC_API_KEY ? 'degraded' : cfg.AI_PROVIDER,
    })
  } catch {
    return NextResponse.json({ status: 'not_ready', db: 'unavailable' }, { status: 503 })
  }
}
