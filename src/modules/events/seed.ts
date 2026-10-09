import type { PoolClient } from 'pg'
import { DEMO_ACTORS, DEMO_EVENT_ID, DEMO_ROLES, demoSnapshot } from './fixture'
import { DEMO_24H_CLOCK, demoSnapshot24h } from './fixture-24h'

export type DemoProfile = 'demo' | '24h'

const ALL_TABLES = ['parse_usage', 'requests', 'acknowledgements', 'briefs', 'decisions', 'patches', 'analyses', 'changes', 'versions', 'demo_sessions', 'actors', 'roles', 'events']

/**
 * Seed fixture demo. Tanpa `reset`, hanya membuat data bila event belum ada (tidak pernah menghapus otomatis).
 * Dengan `reset`, TRUNCATE seluruh tabel aplikasi lalu seed ulang — khusus demo/test.
 */
export async function seedDemo(client: PoolClient, opts: { reset?: boolean; profile?: DemoProfile } = {}): Promise<{ seeded: boolean }> {
  if (opts.reset) {
    await client.query(`TRUNCATE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE`)
  } else {
    const exists = await client.query('SELECT 1 FROM events WHERE id = $1', [DEMO_EVENT_ID])
    if (exists.rowCount) return { seeded: false }
  }
  const snapshot = opts.profile === '24h' ? demoSnapshot24h() : demoSnapshot()
  await client.query('INSERT INTO events (id, name, timezone, active_version, sim_clock_at) VALUES ($1, $2, $3, 1, $4)', [DEMO_EVENT_ID, snapshot.event.name, snapshot.event.timezone, opts.profile === '24h' ? DEMO_24H_CLOCK : null])
  for (const r of DEMO_ROLES) {
    await client.query('INSERT INTO roles (event_id, id, label, capability) VALUES ($1, $2, $3, $4)', [DEMO_EVENT_ID, r.id, r.label, r.capability])
  }
  for (const a of DEMO_ACTORS) {
    await client.query('INSERT INTO actors (id, event_id, role_id, display_name) VALUES ($1, $2, $3, $4)', [a.id, DEMO_EVENT_ID, a.role_id, a.display_name])
  }
  await client.query(`INSERT INTO versions (event_id, number, parent_number, snapshot, source, note) VALUES ($1, 1, NULL, $2, 'seed', $3)`, [
    DEMO_EVENT_ID,
    JSON.stringify(snapshot),
    opts.profile === '24h' ? 'Fixture demo 24 jam (38 item)' : 'Fixture demo 12 item',
  ])
  return { seeded: true }
}
