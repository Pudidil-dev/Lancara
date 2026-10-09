// Register/login sederhana: username + password. Tanpa aturan kekuatan password, batas percobaan, atau verifikasi tambahan.
// Password tetap di-hash (scrypt) agar tidak tersimpan sebagai teks biasa.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { isUniqueViolation, query, withTransaction } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { AUTHORIZATION_ROLE_ID, createSession } from '@/lib/session'
import { DEMO_EVENT_ID } from '@/modules/events/fixture'

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, 32)
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function register(input: { username: string; password: string }) {
  const username = input.username.trim()
  if (!username || !input.password) throw new AppError('VALIDATION_ERROR', 'Username dan password wajib diisi.')
  const passwordHash = await hashPassword(input.password)
  const actorId = `act-u-${randomBytes(6).toString('hex')}`
  try {
    await withTransaction(async (client) => {
      await query('INSERT INTO actors (id, event_id, role_id, display_name) VALUES ($1, $2, $3, $4)', [actorId, DEMO_EVENT_ID, AUTHORIZATION_ROLE_ID, username], client)
      await query('INSERT INTO users (username, password_hash, actor_id) VALUES ($1, $2, $3)', [username, passwordHash, actorId], client)
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('INVALID_STATE', 'Username sudah dipakai. Pilih username lain.')
    throw error
  }
  return createSession(actorId)
}

export async function login(input: { username: string; password: string }) {
  const rows = await query<{ actor_id: string; password_hash: string }>('SELECT actor_id, password_hash FROM users WHERE lower(username) = lower($1)', [input.username.trim()])
  // Pesan sama untuk username tidak ada dan password salah.
  if (!rows[0] || !(await verifyPassword(input.password, rows[0].password_hash))) throw new AppError('UNAUTHENTICATED', 'Username atau password salah.')
  return createSession(rows[0].actor_id)
}
