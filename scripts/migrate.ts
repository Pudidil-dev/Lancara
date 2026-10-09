// Jalankan migration SQL berurutan, sekali per file (tabel schema_migrations). Aman dijalankan berulang.
// Dipakai lokal (npm run db:migrate) dan di Vercel build (npm run vercel-build).
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { poolConfig } from '../src/lib/db'
import { loadEnvFiles } from './load-env'

loadEnvFiles()

async function main() {
  const url = process.argv.includes('--test') ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) {
    if (process.env.VERCEL) throw new Error('DATABASE_URL belum diatur di Vercel Environment Variables.')
    process.stdout.write('DATABASE_URL kosong; migration dilewati.\n')
    return
  }
  const dir = path.join(process.cwd(), 'db', 'migrations')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const client = new Client(poolConfig(url, 1))
  await client.connect()
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    await client.query("ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY")
    // Cegah dua build menjalankan migration bersamaan.
    await client.query('SELECT pg_advisory_lock(424242)')
    const done = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version))
    for (const file of files) {
      if (done.has(file)) continue
      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file])
        await client.query('COMMIT')
        process.stdout.write(`migrated ${file}\n`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
    process.stdout.write(`schema up to date (${files.length} file)\n`)
  } finally {
    await client.query('SELECT pg_advisory_unlock(424242)').catch(() => undefined)
    await client.end()
  }
}

main().catch((error) => {
  process.stderr.write(`migration gagal: ${(error as Error).message}\n`)
  process.exit(1)
})
