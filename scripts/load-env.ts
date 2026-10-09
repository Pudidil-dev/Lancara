// Muat .env.local lalu .env untuk script CLI (Next.js memuatnya sendiri untuk app). Tidak menimpa env yang sudah ada.
import fs from 'node:fs'
import path from 'node:path'

export function loadEnvFiles(): void {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(process.cwd(), name)
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (!m || line.trim().startsWith('#')) continue
      const value = m[2].replace(/^["']|["']$/g, '')
      if (process.env[m[1]] === undefined) process.env[m[1]] = value
    }
  }
}
