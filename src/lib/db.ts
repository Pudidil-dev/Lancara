import { Pool, type PoolClient, type PoolConfig } from 'pg'
import { AppError } from './errors'
import { env } from './env'

type Global = typeof globalThis & { __ripplePool?: Pool }

/**
 * Pool kecil per instance (serverless). Untuk Supabase/Neon gunakan URL pooler (transaction mode).
 * sslmode=require di URL → TLS tanpa verifikasi CA (CA pooler tidak ada di trust store Node);
 * set DB_SSL_REJECT_UNAUTHORIZED=true bila CA sudah dipasang.
 */
export function poolConfig(connectionString: string, max: number): PoolConfig {
  const url = new URL(connectionString)
  const sslmode = url.searchParams.get('sslmode')
  url.searchParams.delete('sslmode')
  const ssl = sslmode && sslmode !== 'disable' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' } : undefined
  return { connectionString: url.toString(), ssl, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, application_name: 'ripple' }
}

export function pool(): Pool {
  const g = globalThis as Global
  if (!g.__ripplePool) {
    const cfg = env()
    g.__ripplePool = new Pool(poolConfig(cfg.DATABASE_URL, cfg.DB_POOL_MAX))
    // Koneksi idle yang putus dibuang pool; request berikutnya membuka koneksi baru.
    g.__ripplePool.on('error', () => undefined)
  }
  return g.__ripplePool
}

const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', '57P01', '57P03', '08000', '08003', '08006'])

export function toStorageError(error: unknown): unknown {
  const code = (error as { code?: string })?.code
  const msg = (error as Error)?.message ?? ''
  if ((code && CONNECTION_CODES.has(code)) || /timeout exceeded when trying to connect|Connection terminated/i.test(msg)) {
    return new AppError('STORAGE_UNAVAILABLE', 'Database tidak tersedia. Perubahan belum tersimpan; cek status setelah pulih.')
  }
  return error
}

export type Db = Pick<PoolClient, 'query'>

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = [], db?: Db): Promise<T[]> {
  try {
    const res = await (db ?? pool()).query(sql, params)
    return res.rows as T[]
  } catch (error) {
    throw toStorageError(error)
  }
}

/** Commit semua atau rollback semua. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient
  try {
    client = await pool().connect()
  } catch (error) {
    throw toStorageError(error)
  }
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw toStorageError(error)
  } finally {
    client.release()
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === '23505'
}
