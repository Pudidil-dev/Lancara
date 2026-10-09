import { execFileSync } from 'node:child_process'
import { request, type FullConfig } from '@playwright/test'

export function assertResetAllowed(baseURL: string) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)
  if (!local && process.env.E2E_ALLOW_RESET !== 'true') throw new Error('E2E mengubah/reset fixture. URL eksternal memerlukan E2E_ALLOW_RESET=true.')
  return local
}
export default async function setup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!
  if (assertResetAllowed(baseURL)) {
    const database = process.env.E2E_DATABASE_URL ?? 'postgres://ripple@127.0.0.1:54329/ripple'
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname) && process.env.E2E_ALLOW_RESET !== 'true') throw new Error('Database E2E eksternal memerlukan E2E_ALLOW_RESET=true.')
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'db:reset'], {
      shell: process.platform === 'win32', stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: database },
    })
  } else {
    const api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } })
    try {
      const login = await api.post('/api/session', { data: { actor_id: 'act-rina' } })
      if (!login.ok()) throw new Error(`Login reset gagal: ${login.status()}`)
      const reset = await api.post('/api/demo/reset', { data: {} })
      if (!reset.ok()) throw new Error(`Reset demo gagal: ${reset.status()}`)
    } finally { await api.dispose() }
  }
}
