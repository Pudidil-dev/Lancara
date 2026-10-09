import { describe, expect, it } from 'vitest'
import { analyze, revalidate } from '@/modules/engine/analyze'
import { validateSnapshot } from '@/modules/engine/validate'
import type { Delta, Snapshot } from '@/modules/engine/types'
import { at, DEMO_CLOCK, demoSnapshot } from '@/modules/events/fixture'
import { AT01_ORACLE } from '../fixtures/oracle'

const startOf = (s: Snapshot, id: string) => s.items.find((i) => i.id === id)!.start_at
const durOf = (s: Snapshot, id: string) => s.items.find((i) => i.id === id)!.duration_seconds

const earliest = (item_id: string, hhmm: string): Delta => ({ type: 'earliest_start', item_id, value: at(hhmm), is_estimate: false, reference_at: DEMO_CLOCK })

function withStatuses(s: Snapshot, statuses: Record<string, Snapshot['items'][number]['status']>): Snapshot {
  return { ...s, items: s.items.map((i) => (statuses[i.id] ? { ...i, status: statuses[i.id] } : i)) }
}

describe('FR-01 validasi setup', () => {
  it('fixture demo valid dan lengkap', () => {
    expect(validateSnapshot(demoSnapshot())).toEqual({ errors: [], missing: [] })
  })

  it('menolak durasi negatif, referensi hilang, dan siklus dependensi', () => {
    const s = demoSnapshot()
    s.items[8] = { ...s.items[8], duration_seconds: -60 }
    s.items[9] = { ...s.items[9], pic_role_ids: ['tidak-ada'] }
    s.dependencies.push({ id: 'D-99', predecessor_id: 'closing', successor_id: 'talent-b', type: 'finish_before_start' })
    const rules = validateSnapshot(s).errors.map((e) => e.rule)
    expect(rules).toContain('INVALID_DURATION')
    expect(rules).toContain('INVALID_REFERENCE')
    expect(rules).toContain('DEPENDENCY_CYCLE')
  })

  it('resource tanpa peran → DATA BELUM LENGKAP dan analisis diblok', () => {
    const s = demoSnapshot()
    s.resources = s.resources.map((r) => (r.id === 'res-panel' ? { ...r, role_ids: [] } : r))
    const result = analyze({ base: s, delta: earliest('talent-b', '20:05'), analysisNow: DEMO_CLOCK })
    expect(result.candidates).toHaveLength(0)
    expect(result.blockers[0].message).toContain('Resource Set Panel (sofa & meja) belum memiliki peran penanggung jawab')
  })
})

describe('AT-01 Talent B terlambat (earliest 20.05)', () => {
  const base = demoSnapshot()
  const result = analyze({ base, delta: earliest('talent-b', '20:05'), analysisNow: DEMO_CLOCK })

  it('patch tukar Panel/Talent B lolos; Sponsor dan curfew terjaga', () => {
    expect(result.blockers).toEqual([])
    expect(result.candidates.length).toBeGreaterThanOrEqual(1)
    const top = result.candidates[0]
    expect(top.strategy).toBe('swap')
    expect(startOf(top.proposed, 'panel')).toBe(at('19:15'))
    expect(startOf(top.proposed, 'sponsor')).toBe(at('19:45'))
    expect(startOf(top.proposed, 'talent-b')).toBe(at('20:05'))
    expect(startOf(top.proposed, 'closing')).toBe(at('20:35'))
  })

  it('tidak ada kandidat lolos yang menggeser slot Sponsor', () => {
    for (const c of result.candidates) expect(startOf(c.proposed, 'sponsor')).toBe(at('19:45'))
    expect(result.rejected.some((r) => r.violations.some((v) => v.constraint_id === 'C-FIX-sponsor'))).toBe(true)
  })

  it('penerima dampak sama dengan oracle manual', () => {
    const impact = result.candidates[0].impact
    const byLevel = (lvl: string) => impact.filter((r) => r.level === lvl).map((r) => r.role_id).sort()
    expect(byLevel('ACTION_REQUIRED')).toEqual(AT01_ORACLE.action)
    expect(byLevel('FYI')).toEqual(AT01_ORACLE.fyi)
    expect(byLevel('UNCHANGED')).toEqual(AT01_ORACLE.unchanged)
  })

  it('FR-03 deterministik: input sama → hasil sama', () => {
    const again = analyze({ base: demoSnapshot(), delta: earliest('talent-b', '20:05'), analysisNow: DEMO_CLOCK })
    expect(JSON.stringify(again)).toBe(JSON.stringify(result))
  })

  it('tidak memutasi snapshot input', () => {
    expect(base).toEqual(demoSnapshot())
  })
})

describe('AT-02 sesi aktif molor', () => {
  const base = withStatuses(demoSnapshot(), { opening: 'completed', keynote: 'completed', 'talent-b': 'completed', sponsor: 'in_progress' })
  const now = at('19:55')
  const result = analyze({ base, delta: { type: 'active_end_estimate', item_id: 'sponsor', value: at('20:15'), is_estimate: true, reference_at: now }, analysisNow: now })

  it('estimasi selesai berubah dan hanya item belum berlangsung yang disesuaikan', () => {
    expect(result.candidates.length).toBeGreaterThanOrEqual(1)
    for (const c of result.candidates) {
      expect(c.proposed.items.find((i) => i.id === 'sponsor')!.estimated_end_at).toBe(at('20:15'))
      for (const id of ['keynote', 'talent-b', 'opening']) expect(startOf(c.proposed, id)).toBe(startOf(base, id))
      expect(durOf(c.proposed, 'panel')).toBeGreaterThanOrEqual(20 * 60)
    }
  })

  it('opsi pangkas Panel ke minimum lebih diutamakan (lebih sedikit item berubah)', () => {
    const top = result.candidates[0]
    expect(top.strategy).toBe('trim')
    expect(startOf(top.proposed, 'panel')).toBe(at('20:15'))
    expect(durOf(top.proposed, 'panel')).toBe(20 * 60)
    expect(startOf(top.proposed, 'closing')).toBe(at('20:35'))
    expect(result.candidates.some((c) => c.strategy === 'shift' && startOf(c.proposed, 'closing') === at('20:45'))).toBe(true)
  })
})

describe('AT-03 item dibatalkan', () => {
  it('pembatalan tanpa dependen menghasilkan patch dengan status cancelled', () => {
    const result = analyze({ base: demoSnapshot(), delta: { type: 'cancel_item', item_id: 'keynote', is_estimate: false, reference_at: DEMO_CLOCK }, analysisNow: DEMO_CLOCK })
    expect(result.candidates[0].proposed.items.find((i) => i.id === 'keynote')!.status).toBe('cancelled')
    expect(result.candidates[0].proposed.items).toHaveLength(12)
  })

  it('dependensi yang mengharuskan item selesai muncul sebagai konflik', () => {
    const result = analyze({ base: demoSnapshot(), delta: { type: 'cancel_item', item_id: 'panel', is_estimate: false, reference_at: DEMO_CLOCK }, analysisNow: DEMO_CLOCK })
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected.flatMap((r) => r.violations).some((v) => v.rule === 'DEPENDENCY_CANCELLED' && v.constraint_id === 'D-05')).toBe(true)
  })
})

describe('AT-04 penampil datang lebih cepat', () => {
  it('memperbarui earliest start tanpa otomatis mengembalikan jadwal lama', () => {
    const first = analyze({ base: demoSnapshot(), delta: earliest('talent-b', '20:05'), analysisNow: DEMO_CLOCK })
    const v2 = first.candidates[0].proposed
    const result = analyze({ base: v2, delta: earliest('talent-b', '19:15'), analysisNow: DEMO_CLOCK })
    const top = result.candidates[0]
    expect(top.strategy).toBe('keep')
    expect(top.items_changed).toBe(0)
    expect(startOf(top.proposed, 'talent-b')).toBe(at('20:05'))
    expect(top.proposed.constraints.find((c) => c.item_id === 'talent-b')!.at).toBe(at('19:15'))
    expect(result.candidates.some((c) => startOf(c.proposed, 'talent-b') === at('19:15'))).toBe(true)
  })
})

describe('AT-06 talent baru bisa mulai 21.00', () => {
  it('tidak ada kandidat feasible karena curfew; alasan terlihat', () => {
    const result = analyze({ base: demoSnapshot(), delta: earliest('talent-b', '21:00'), analysisNow: DEMO_CLOCK })
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected.flatMap((r) => r.violations).some((v) => v.constraint_id === 'C-CURFEW')).toBe(true)
  })
})

describe('validasi ulang saat approve', () => {
  it('kandidat menjadi tidak valid bila jam server sudah lewat slot', () => {
    const result = analyze({ base: demoSnapshot(), delta: earliest('talent-b', '20:05'), analysisNow: DEMO_CLOCK })
    const delta = earliest('talent-b', '20:05')
    expect(revalidate(result.candidates[0].proposed, demoSnapshot(), DEMO_CLOCK, delta)).toEqual([])
    expect(revalidate(result.candidates[0].proposed, demoSnapshot(), at('19:30'), delta).some((v) => v.rule === 'PAST_START')).toBe(true)
  })
})

describe('AT-10 pembatalan keputusan setelah segmen berlangsung', () => {
  it('reversal ditolak karena item terkunci dan waktu sudah lewat', () => {
    const base = demoSnapshot()
    const after = analyze({ base, delta: earliest('talent-b', '20:05'), analysisNow: DEMO_CLOCK }).candidates[0].proposed
    const current = withStatuses(after, { opening: 'completed', keynote: 'completed', panel: 'in_progress' })
    const result = analyze({
      base: current,
      delta: { type: 'revert_decision', decision_id: 'd-1', before: base, after, is_estimate: false, reference_at: null },
      analysisNow: at('19:20'),
    })
    expect(result.candidates).toHaveLength(0)
    const rules = result.rejected.flatMap((r) => r.violations).map((v) => v.rule)
    expect(rules).toContain('LOCKED_ITEM')
  })

  it('reversal sebelum segmen berlangsung dapat disetujui', () => {
    const base = demoSnapshot()
    const after = analyze({ base, delta: earliest('talent-b', '20:05'), analysisNow: DEMO_CLOCK }).candidates[0].proposed
    const result = analyze({
      base: after,
      delta: { type: 'revert_decision', decision_id: 'd-1', before: base, after, is_estimate: false, reference_at: null },
      analysisNow: DEMO_CLOCK,
    })
    expect(result.candidates).toHaveLength(1)
    expect(startOf(result.candidates[0].proposed, 'talent-b')).toBe(at('19:15'))
  })
})
