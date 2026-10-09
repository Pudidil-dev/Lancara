// NFR-06: p50/p95 engine (tanpa AI), 30 pengulangan per skenario pada fixture 12 item.
import os from 'node:os'
import { analyze } from '../src/modules/engine/analyze'
import type { Delta } from '../src/modules/engine/types'
import { at, DEMO_CLOCK, demoSnapshot } from '../src/modules/events/fixture'

const RUNS = 30
const scenarios: Array<[string, Delta]> = [
  ['AT-01 earliest 20.05', { type: 'earliest_start', item_id: 'talent-b', value: at('20:05'), is_estimate: false, reference_at: DEMO_CLOCK }],
  ['AT-06 earliest 21.00', { type: 'earliest_start', item_id: 'talent-b', value: at('21:00'), is_estimate: false, reference_at: DEMO_CLOCK }],
  ['AT-03 cancel panel', { type: 'cancel_item', item_id: 'panel', is_estimate: false, reference_at: DEMO_CLOCK }],
]

const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]

process.stdout.write(`node ${process.version} · ${os.cpus()[0]?.model ?? 'cpu?'} · ${RUNS} runs\n`)
for (const [name, delta] of scenarios) {
  const times: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const base = demoSnapshot()
    const t = performance.now()
    analyze({ base, delta, analysisNow: DEMO_CLOCK })
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  process.stdout.write(`${name.padEnd(22)} p50=${pct(times, 50).toFixed(2)}ms p95=${pct(times, 95).toFixed(2)}ms (target p95 ≤ 1000ms)\n`)
}
