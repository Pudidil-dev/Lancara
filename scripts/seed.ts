// Seed fixture demo secara eksplisit. `--reset` mengosongkan seluruh data aplikasi (khusus demo/test).
// `--test` memakai DATABASE_URL_TEST.
import { Client } from 'pg'
import { poolConfig } from '../src/lib/db'
import { seedDemo, type DemoProfile } from '../src/modules/events/seed'
import { loadEnvFiles } from './load-env'

loadEnvFiles()

async function main() {
  const url = process.argv.includes('--test') ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) throw new Error('DATABASE_URL belum diatur.')
  const client = new Client(poolConfig(url, 1))
  await client.connect()
  try {
    await client.query('BEGIN')
    // seedDemo hanya memakai client.query, aman dipanggil dengan Client tunggal.
    const profile: DemoProfile = process.argv.includes('--profile=24h') ? '24h' : 'demo'
    const result = await seedDemo(client as never, { reset: process.argv.includes('--reset'), profile })
    await client.query('COMMIT')
    const count = profile === '24h' ? '38 item' : '12 item'
    process.stdout.write(result.seeded ? `seed demo selesai (${count}, 1 akun utama)\n` :'event demo sudah ada; tidak ada perubahan (pakai --reset untuk mengulang)\n')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  process.stderr.write(`seed gagal: ${(error as Error).message}\n`)
  process.exit(1)
})
