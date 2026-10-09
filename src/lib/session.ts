import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { query } from './db'
import { env } from './env'
import { AppError } from './errors'

export const SESSION_COOKIE = 'ripple_session'
/** Satu akun otorisasi aplikasi; PIC/peran dalam rundown tetap data operasional. */
export const SINGLE_ACCOUNT_ACTOR_ID = 'act-rina'
export const AUTHORIZATION_ROLE_ID = 'koordinator'
export const AUTHORIZATION_ROLE_LABEL = 'Koordinator'
const SESSION_HOURS = 12

export interface Session {
  session_id: string
  actor_id: string
  display_name: string
  event_id: string
  role_id: string
  role_label: string
  capability: 'coordinator'
}

function sign(id: string): string {
  return createHmac('sha256', env().SESSION_SECRET).update(id).digest('base64url')
}

export function encodeCookie(id: string): string {
  return `${id}.${sign(id)}`
}

export function decodeCookie(value: string | undefined): string | null {
  if (!value) return null
  const [id, mac] = value.split('.')
  if (!id || !mac) return null
  const expected = Buffer.from(sign(id))
  const given = Buffer.from(mac)
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null
}

export async function createSession(actorId: string): Promise<{ id: string; expires: Date }> {
  if (actorId !== SINGLE_ACCOUNT_ACTOR_ID) throw new AppError('UNAUTHENTICATED', 'Gunakan akun utama LANCARA.')
  const actor = await query('SELECT id FROM actors WHERE id = $1', [actorId])
  if (!actor.length) throw new AppError('NOT_FOUND', 'Akun utama LANCARA belum tersedia.')
  const id = randomBytes(24).toString('base64url')
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000)
  await query('INSERT INTO demo_sessions (id, actor_id, expires_at) VALUES ($1, $2, $3)', [id, actorId, expires])
  return { id, expires }
}

export async function loadSession(sessionId: string): Promise<Session | null> {
  const rows = await query<Session>(
    `SELECT s.id AS session_id, a.id AS actor_id, a.display_name, a.event_id,
            $3::text AS role_id, $4::text AS role_label, 'coordinator'::text AS capability
       FROM demo_sessions s
       JOIN actors a ON a.id = s.actor_id
      WHERE s.id = $1 AND s.expires_at > now() AND a.id = $2`,
    [sessionId, SINGLE_ACCOUNT_ACTOR_ID, AUTHORIZATION_ROLE_ID, AUTHORIZATION_ROLE_LABEL],
  )
  return rows[0] ?? null
}

export async function sessionFromRequest(req: NextRequest): Promise<Session | null> {
  const id = decodeCookie(req.cookies.get(SESSION_COOKIE)?.value)
  return id ? loadSession(id) : null
}

/** Actor, event, dan role SELALU dari session server — tidak pernah dari body client. */
export async function requireSession(req: NextRequest): Promise<Session> {
  const session = await sessionFromRequest(req)
  if (!session) throw new AppError('UNAUTHENTICATED', 'Session tidak ada atau kedaluwarsa. Masuk melalui akun utama LANCARA.')
  return session
}

export function requireCoordinator(session: Session): void {
  // Invariant identitas session tunggal, bukan pembatas akses berdasarkan PIC di rundown.
  if (session.actor_id !== SINGLE_ACCOUNT_ACTOR_ID || session.capability !== 'coordinator') {
    throw new AppError('UNAUTHENTICATED', 'Gunakan akun utama LANCARA yang telah masuk.')
  }
}

export function requireEvent(session: Session, eventId: string): void {
  if (session.event_id !== eventId) throw new AppError('NOT_FOUND', 'Event tidak tersedia untuk session ini.')
}
