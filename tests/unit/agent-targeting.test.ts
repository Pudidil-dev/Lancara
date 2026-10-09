import { describe, expect, it } from 'vitest'
import { matchNamedItems, resolveTargetFocus, guardRequestedTarget } from '@/modules/agent/targeting'
import { demoSnapshot24h, DEMO_24H_CLOCK } from '@/modules/events/fixture-24h'

describe('target agent dari nama pendek dan ingatan percakapan', () => {
  const snapshot = demoSnapshot24h()
  it('Talent I, ID dan nama lengkap menunjuk satu item', () => {
    for (const text of ['ubah Talent I', 'ubah talent-i', 'Talent I — Penutup Musik']) expect(matchNamedItems(text, snapshot.items)).toEqual(['talent-i'])
  })
  it('nama prefix dan huruf berbeda tidak menjadi target', () => {
    expect(matchNamedItems('Talent Iwan datang', snapshot.items)).toEqual([])
    expect(matchNamedItems('Talent H lalu Talent I', snapshot.items)).toEqual(['talent-h', 'talent-i'])
  })
  it('lanjutan tanpa nama mengingat target pengguna meski balasan AI menyebut segmen lain', () => {
    expect(resolveTargetFocus('ok ganti jadwalnya', [{ role: 'user', text: 'Talent I perlu digeser' }, { role: 'assistant', text: 'Talent H bisa mengisi slot.' }], snapshot)).toMatchObject({ item_ids: ['talent-i'], source: 'history' })
    expect(resolveTargetFocus('ganti Talent G', [{ role: 'user', text: 'ubah Talent I' }], snapshot).item_ids).toEqual(['talent-g'])
  })
  it('target dengan kata atau perlu diklarifikasi', () => {
    const focus = resolveTargetFocus('ganti Talent H atau Talent I', [], snapshot)
    expect(guardRequestedTarget(snapshot, focus, 'propose_schedule_change', { item_id: 'talent-i' }, DEMO_24H_CLOCK)).toMatch(/Tanyakan segmen/)
  })
  it('usulan target lain ditolak sebelum preview dibuat', () => {
    const focus = resolveTargetFocus('Talent I terlambat 30 menit', [], snapshot)
    expect(guardRequestedTarget(snapshot, focus, 'propose_schedule_change', { item_id: 'talent-h' }, DEMO_24H_CLOCK)).toMatch(/talent-i/)
    expect(guardRequestedTarget(snapshot, focus, 'propose_schedule_change', { item_id: 'talent-i' }, DEMO_24H_CLOCK)).toBeNull()
  })
  it('rencana valid yang hanya mengubah item lain tetap ditolak', () => {
    const focus = resolveTargetFocus('ubah Talent I', [], snapshot)
    const input = { base_version: 1, summary: 'Ubah nama sesi lain', operations: [{ op: 'update', item_id: 'talent-h', title: 'Talent H baru' }] }
    expect(guardRequestedTarget(snapshot, focus, 'edit_rundown', input, DEMO_24H_CLOCK)).toMatch(/tidak menyentuh Talent I/)
  })
})
