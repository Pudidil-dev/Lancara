import { describe, expect, it } from 'vitest'
import { ruleExtract } from '@/modules/ai/rule-parser'
import { demoSnapshot24h } from '@/modules/events/fixture-24h'

describe('regresi target Talent I dari pemilik', () => {
  it.each(['Talent I baru bisa mulai jam 23.30', 'talent i terlambat 30 menit', 'talent-i telat 10 menit'])('nama pendek/ID tetap menunjuk Talent I: %s', text => {
    expect(ruleExtract(text, demoSnapshot24h()).item_ids).toEqual(['talent-i'])
  })
  it('Talent H dan I tidak tertukar meski punya kata Talent yang sama', () => {
    expect(ruleExtract('Talent H baru bisa mulai jam 22.30', demoSnapshot24h()).item_ids).toEqual(['talent-h'])
  })
})
