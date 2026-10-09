import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '@/lib/errors'
import { inbox, acknowledge, history } from '@/modules/briefs/service'
import { analyseChange, createChange, getChangeDetail, parseChange } from '@/modules/changes/service'
import { approve, createCompensation, requestStatus } from '@/modules/decisions/service'
import { at, DEMO_CLOCK, DEMO_EVENT_ID } from '@/modules/events/fixture'
import { getRundown, setItemStatus, setSimClock } from '@/modules/events/service'
import { analysedChange, closePool, count, earliest, hasDb, key, resetDb, sessionFor } from './helpers'

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code)
}

describe.skipIf(!hasDb)('alur keputusan (PostgreSQL)', () => {
  beforeEach(resetDb)
  afterAll(closePool)

  it('AT-01 end-to-end: approve membuat versi baru + brief hanya untuk peran terdampak', async () => {
    const rina = await sessionFor('act-rina')
    const detail = await analysedChange(rina, earliest('talent-b', '20:05'), 1)
    const patch = detail.patches[0] as { id: string }
    const result = await approve(rina, detail.change.id, { patch_id: patch.id, base_version: 1, reason: 'Tukar panel, sponsor aman', idempotency_key: key() })
    expect(result.new_version).toBe(2)
    const rundown = await getRundown(rina, DEMO_EVENT_ID)
    expect(rundown.snapshot.items.find((i) => i.id === 'panel')!.start_at).toBe(at('19:15'))
    const roles = (await history(rina, DEMO_EVENT_ID)).decisions[0].acks as Array<{ role_id: string }>
    expect(roles.map((r) => r.role_id).sort()).toEqual(['audio', 'lighting', 'lo', 'mc', 'stage'])
    const led = await sessionFor('act-dimas')
    expect((await inbox(led, DEMO_EVENT_ID)).briefs).toHaveLength(0)
  })

  it('AT-07 dua preview dari versi sama: approve kedua ditolak STALE_VERSION', async () => {
    const rina = await sessionFor('act-rina')
    const a = await analysedChange(rina, earliest('talent-b', '20:05'), 1)
    const b = await analysedChange(rina, { type: 'cancel_item', item_id: 'keynote', is_estimate: false, reference_at: DEMO_CLOCK }, 1)
    await approve(rina, a.change.id, { patch_id: (a.patches[0] as { id: string }).id, base_version: 1, reason: 'Opsi pertama', idempotency_key: key() })
    await expectCode(approve(rina, b.change.id, { patch_id: (b.patches[0] as { id: string }).id, base_version: 1, reason: 'Opsi kedua', idempotency_key: key() }), 'STALE_VERSION')
    expect((await getChangeDetail(rina, b.change.id)).stale).toBe(true)
    expect(await count('versions')).toBe(2)
  })

  it('AT-08 klik ganda paralel dengan key sama: satu versi, brief tidak ganda, status request committed', async () => {
    const rina = await sessionFor('act-rina')
    const d = await analysedChange(rina, earliest('talent-b', '20:05'), 1)
    const input = { patch_id: (d.patches[0] as { id: string }).id, base_version: 1, reason: 'Klik ganda', idempotency_key: key() }
    const [r1, r2] = await Promise.all([approve(rina, d.change.id, input), approve(rina, d.change.id, input)])
    expect(r1.decision_id).toBe(r2.decision_id)
    expect([r1.replayed, r2.replayed].sort()).toEqual([false, true])
    expect(await count('versions')).toBe(2)
    expect(await count('decisions')).toBe(1)
    expect(await count('briefs')).toBe(5)
    const status = (await requestStatus(rina, input.idempotency_key)) as { status: string; result: { decision_id: string } }
    expect(status.status).toBe('committed')
    expect(status.result.decision_id).toBe(r1.decision_id)
    await expectCode(approve(rina, d.change.id, { ...input, reason: 'Isi berbeda' }), 'IDEMPOTENCY_CONFLICT')
  })

  it('AT-08 provider AI gagal: AI_UNAVAILABLE, draft tetap, form manual tetap jalan', async () => {
    const andi = await sessionFor('act-andi')
    const { change_id } = await createChange(andi, DEMO_EVENT_ID, { original_text: 'Talent B baru bisa mulai jam 20.05', reference_at: DEMO_CLOCK })
    process.env.AI_PROVIDER = 'anthropic'
    const { env } = await import('@/lib/env')
    const cached = env()
    const saved = { provider: cached.AI_PROVIDER, key: cached.ANTHROPIC_API_KEY }
    Object.assign(cached, { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: undefined })
    try {
      await expectCode(parseChange(andi, change_id), 'AI_UNAVAILABLE')
    } finally {
      Object.assign(cached, { AI_PROVIDER: saved.provider, ANTHROPIC_API_KEY: saved.key })
      process.env.AI_PROVIDER = 'rule'
    }
    const after = await getChangeDetail(andi, change_id)
    expect(after.change.status).toBe('draft')
    await analyseChange(andi, change_id, { delta: earliest('talent-b', '20:05'), base_version: 1, idempotency_key: key() }, 'confirm')
    expect((await getChangeDetail(andi, change_id)).patches.length).toBeGreaterThan(0)
  })

  it('AT-09 PIC tidak bisa approve; ack terikat versi dan tidak menutup revisi baru', async () => {
    const rina = await sessionFor('act-rina')
    const bayu = await sessionFor('act-bayu')
    const first = await analysedChange(rina, earliest('talent-b', '20:05'), 1)
    await expectCode(approve(bayu, first.change.id, { patch_id: (first.patches[0] as { id: string }).id, base_version: 1, reason: 'Saya PIC', idempotency_key: key() }), 'FORBIDDEN')
    await approve(rina, first.change.id, { patch_id: (first.patches[0] as { id: string }).id, base_version: 1, reason: 'Tukar panel', idempotency_key: key() })

    const v2Brief = (await inbox(bayu, DEMO_EVENT_ID)).briefs[0]
    const ack1 = await acknowledge(bayu, v2Brief.id)
    const ack2 = await acknowledge(bayu, v2Brief.id)
    expect(ack2.acknowledged_at).toEqual(ack1.acknowledged_at)
    expect(await count('acknowledgements')).toBe(1)

    const dimas = await sessionFor('act-dimas')
    await expectCode(acknowledge(dimas, v2Brief.id), 'FORBIDDEN')

    // Revisi baru: Talent B kembali bisa 19.15 → pilih opsi tukar balik.
    const second = await analysedChange(rina, earliest('talent-b', '19:15'), 2)
    const swapBack = (second.patches as Array<{ id: string; strategy: string }>).find((p) => p.strategy === 'swap')!
    await approve(rina, second.change.id, { patch_id: swapBack.id, base_version: 2, reason: 'Talent datang lebih cepat', idempotency_key: key() })
    const box = await inbox(bayu, DEMO_EVENT_ID)
    const v3 = box.briefs.find((b) => b.version === 3)!
    const old = box.briefs.find((b) => b.version === 2)!
    expect(v3.acknowledged_at).toBeNull()
    expect(old.acknowledged_at).not.toBeNull()
    expect(old.superseded_by?.version).toBe(3)
  })

  it('validasi ulang saat approve: jam server sudah lewat → CONTEXT_CHANGED, tidak ada versi baru', async () => {
    const rina = await sessionFor('act-rina')
    const d = await analysedChange(rina, earliest('talent-b', '20:05'), 1)
    await setSimClock(rina, DEMO_EVENT_ID, at('19:30'))
    await expectCode(approve(rina, d.change.id, { patch_id: (d.patches[0] as { id: string }).id, base_version: 1, reason: 'Terlambat menyetujui', idempotency_key: key() }), 'CONTEXT_CHANGED')
    expect(await count('versions')).toBe(1)
  })

  it('AT-10 pembatalan setelah segmen berlangsung: riwayat utuh, reversal ditolak', async () => {
    const rina = await sessionFor('act-rina')
    const d = await analysedChange(rina, earliest('talent-b', '20:05'), 1)
    const decision = await approve(rina, d.change.id, { patch_id: (d.patches[0] as { id: string }).id, base_version: 1, reason: 'Tukar panel', idempotency_key: key() })
    let v = decision.new_version
    for (const [item, status] of [['opening', 'completed'], ['keynote', 'in_progress'], ['keynote', 'completed'], ['panel', 'in_progress']] as const) {
      v = (await setItemStatus(rina, DEMO_EVENT_ID, { item_id: item, status, base_version: v, idempotency_key: key() })).new_version
    }
    await setSimClock(rina, DEMO_EVENT_ID, at('19:20'))
    const comp = await createCompensation(rina, decision.decision_id, { reason: 'Batalkan tukar' })
    await analyseChange(rina, comp.change_id, { base_version: v, idempotency_key: key() }, 'confirm')
    const detail = await getChangeDetail(rina, comp.change_id)
    expect(detail.patches).toHaveLength(0)
    const rejected = (detail.analysis!.rejected as Array<{ violations: Array<{ rule: string }> }>).flatMap((r) => r.violations.map((x) => x.rule))
    expect(rejected).toContain('LOCKED_ITEM')
    const h = await history(rina, DEMO_EVENT_ID)
    expect(h.decisions).toHaveLength(1)
    expect(h.versions).toHaveLength(v)
  })
})
