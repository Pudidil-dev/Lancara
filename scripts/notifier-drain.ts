import { loadEnvFiles } from './load-env'
import { pool } from '../src/lib/db'
import { drain } from '../src/modules/notifier/dispatch'

loadEnvFiles()

drain().then(result => {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}).catch(() => {
  process.stderr.write('Drain notifikasi gagal. Cek database dan konfigurasi notifier; detail rahasia tidak ditampilkan.\n')
  process.exitCode = 1
}).finally(async () => { if ((globalThis as { __ripplePool?: unknown }).__ripplePool) await pool().end().catch(() => undefined) })
