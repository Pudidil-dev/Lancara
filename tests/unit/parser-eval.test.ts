import { describe, expect, it } from 'vitest'
import { formatClock } from '@/lib/time'
import { resolveExtraction } from '@/modules/ai/extraction'
import { ruleExtract } from '@/modules/ai/rule-parser'
import { DEMO_TZ, demoSnapshot } from '@/modules/events/fixture'
import { localDelta, PARSER_SET } from '../fixtures/parser-set'

function interpret(sample: (typeof PARSER_SET)[number]) {
  const snapshot = demoSnapshot()
  return resolveExtraction(ruleExtract(sample.text, snapshot), snapshot, sample.reference_at, 'rule')
}

describe('eval parser — 30 label manual (AI-01)', () => {
  it.each(PARSER_SET)('$id: $text', (sample) => {
    const result = interpret(sample)
    expect(result.status).toBe(sample.expected.status)
    if (sample.expected.status === 'needs_clarification') {
      expect(result.delta).toBeNull()
      expect(result.questions.map((q) => q.kind)).toEqual(expect.arrayContaining(sample.expected.kinds))
    } else {
      expect(result.delta).not.toBeNull()
      expect(localDelta(result.delta!, (value) => formatClock(value, DEMO_TZ))).toEqual(sample.expected.delta)
      expect(result.delta!.reference_at).toBe(sample.reference_at)
    }
  })

  it('gate ≥90% delta benar; 100% ambigu diklarifikasi tanpa delta', () => {
    expect(PARSER_SET).toHaveLength(30)
    const ambiguous = PARSER_SET.filter((sample) => sample.expected.status === 'needs_clarification')
    expect(ambiguous.length).toBeGreaterThanOrEqual(8)
    expect(ambiguous.every((sample) => {
      const result = interpret(sample)
      return result.status === 'needs_clarification' && result.delta === null
    })).toBe(true)
    const clear = PARSER_SET.filter((sample) => sample.expected.status === 'ok')
    const correct = clear.filter((sample) => {
      const result = interpret(sample)
      return result.status === 'ok' && result.delta && sample.expected.status === 'ok'
        && JSON.stringify(localDelta(result.delta, (value) => formatClock(value, DEMO_TZ))) === JSON.stringify(sample.expected.delta)
    })
    expect(correct.length / clear.length).toBeGreaterThanOrEqual(0.9)
  })
})
