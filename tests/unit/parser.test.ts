import { describe, expect, it } from 'vitest'
import { resolveExtraction } from '@/modules/ai/extraction'
import { ruleExtract } from '@/modules/ai/rule-parser'
import { at, DEMO_CLOCK, demoSnapshot } from '@/modules/events/fixture'

const parse = (text: string, ref: string | null = DEMO_CLOCK) => {
  const s = demoSnapshot()
  return resolveExtraction(ruleExtract(text, s), s, ref, 'rule')
}

describe('parser aturan (FR-02)', () => {
  it('jam eksplisit → earliest_start terstruktur', () => {
    const r = parse('Talent B baru bisa mulai jam 20.05')
    expect(r.status).toBe('ok')
    expect(r.delta).toMatchObject({ type: 'earliest_start', item_id: 'talent-b', value: at('20:05'), is_estimate: false })
  })

  it('"jam 8 malam" dibaca 20.00 dan penanda perkiraan', () => {
    const r = parse('kayaknya talent b baru sampai jam 8an malam')
    expect(r.delta).toMatchObject({ item_id: 'talent-b', value: at('20:00'), is_estimate: true })
  })

  it('telat N menit dihitung dari jadwal mulai item', () => {
    const r = parse('Talent B telat 50 menit')
    expect(r.delta).toMatchObject({ type: 'earliest_start', value: at('20:05') })
  })

  it('sesi aktif molor tanpa menyebut item → estimasi selesai Opening', () => {
    const r = parse('molor 10 menit nih')
    expect(r.delta).toMatchObject({ type: 'active_end_estimate', item_id: 'opening', value: at('18:55') })
  })

  it('pembatalan item', () => {
    expect(parse('Keynote dibatalkan').delta).toMatchObject({ type: 'cancel_item', item_id: 'keynote' })
  })

  it('AT-05 nama ganda + "40 menit lagi" tanpa acuan → klarifikasi, tanpa delta', () => {
    const r = parse('talent telat, 40 menit lagi baru sampai', null)
    expect(r.status).toBe('needs_clarification')
    expect(r.delta).toBeNull()
    const kinds = r.questions.map((q) => q.kind)
    expect(kinds).toContain('item')
    expect(kinds).toContain('reference_at')
    expect(r.questions.find((q) => q.kind === 'item')!.options!.map((o) => o.id).sort()).toEqual(['talent-a', 'talent-b'])
  })

  it('"40 menit lagi" dengan waktu acuan → nilai absolut', () => {
    const r = parse('Talent B 40 menit lagi baru sampai')
    expect(r.delta).toMatchObject({ type: 'earliest_start', value: at('19:20') })
  })
})
