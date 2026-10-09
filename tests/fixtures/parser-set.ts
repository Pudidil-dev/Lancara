import type { Delta } from '../../src/modules/engine/types'
import type { Question } from '../../src/modules/ai/extraction'
import { DEMO_CLOCK } from '../../src/modules/events/fixture'

type ExpectedDelta =
  | { type: 'earliest_start' | 'active_end_estimate'; item_id: string; value: string; is_estimate: boolean }
  | { type: 'cancel_item'; item_id: string; is_estimate: false }

export interface ParserCase {
  id: string
  text: string
  reference_at: string | null
  expected:
    | { status: 'ok'; delta: ExpectedDelta }
    | { status: 'needs_clarification'; kinds: Question['kind'][] }
}

// Label disusun manual dari fixture 9 Oktober 2026, BUKAN dari output parser.
// value menggunakan jam lokal WIB. Reference default 18.40; start Talent B 19.15,
// end Opening 18.45. Ini corpus regresi demo, bukan sampel populasi chat EO.
const ok = (id: string, text: string, delta: ExpectedDelta, reference_at: string | null = DEMO_CLOCK): ParserCase =>
  ({ id, text, reference_at, expected: { status: 'ok', delta } })
const unclear = (id: string, text: string, kinds: Question['kind'][], reference_at: string | null = DEMO_CLOCK): ParserCase =>
  ({ id, text, reference_at, expected: { status: 'needs_clarification', kinds } })
const start = (value: string, is_estimate = false): ExpectedDelta =>
  ({ type: 'earliest_start', item_id: 'talent-b', value, is_estimate })
const end = (value: string, is_estimate = false): ExpectedDelta =>
  ({ type: 'active_end_estimate', item_id: 'opening', value, is_estimate })
const cancel = (item_id: string): ExpectedDelta => ({ type: 'cancel_item', item_id, is_estimate: false })

export const PARSER_SET: readonly ParserCase[] = [
  ok('P01', 'Talent B baru bisa mulai jam 20.05', start('20:05')),
  ok('P02', 'kayaknya talent b baru sampai jam 8an malam', start('20:00', true)),
  ok('P03', 'Talent B telat 50 menit', start('20:05')),
  ok('P04', 'Talent B terlambat 30 mnt nih', start('19:45')),
  ok('P05', 'Talent B mundur setengah jam', start('19:45')),
  ok('P06', 'Talent B delay 1 jam 10 menit', start('20:25')),
  ok('P07', 'Talent B 40 menit lagi baru sampai', start('19:20')),
  ok('P08', 'Talent B baru datang dalam setengah jam', start('19:10')),
  ok('P09', 'Talent B baru bs mulai pkl 20:15', start('20:15')),
  ok('P10', 'Talent B lebih cepat, sudah sampai pukul 19.00', start('19:00')),
  ok('P11', 'Opening molor 10 menit nih', end('18:55')),
  ok('P12', 'Opening lebih lama 5 mnt', end('18:50')),
  ok('P13', 'Opening baru selesai jam 19.00', end('19:00')),
  ok('P14', 'Opening kira-kira selesai pukul 18:55', end('18:55', true)),
  ok('P15', 'Opening molor sekitar setengah jam', end('19:15', true)),
  ok('P16', 'Keynote dibatalkan', cancel('keynote')),
  ok('P17', 'Panel ga jadi ya', cancel('panel')),
  ok('P18', 'Sponsor nggak jadi', cancel('sponsor')),
  ok('P19', 'Closing cancel', cancel('closing')),
  ok('P20', 'Talent B terlmbat 50 menit', start('20:05')),
  unclear('P21', 'talent telat, 40 menit lagi baru sampai', ['item', 'reference_at'], null),
  unclear('P22', 'Talent B 40 menit lagi baru sampai', ['reference_at'], null),
  unclear('P23', 'Talent B baru tiba dalam 15 mnt', ['reference_at'], null),
  unclear('P24', 'talent baru bisa mulai jam 20.05', ['item']),
  unclear('P25', 'baru bisa mulai jam 20.05', ['item']),
  unclear('P26', 'Talent B telat nih', ['value']),
  unclear('P27', 'Panel jam 20.00 ya', ['type']),
  unclear('P28', 'Talent B baru bisa mulai jam 25.90', ['value']),
  unclear('P29', 'Talent B atau Panel ga jadi', ['item']),
  unclear('P30', 'Talent B baru bisa mulai jam 20.05 atau jam 20.15', ['value']),
]

/** Bandingkan label jam lokal dengan delta UTC, tanpa membandingkan narasi provider. */
export function localDelta(delta: Delta, clock: (iso: string) => string): ExpectedDelta | null {
  if (delta.type === 'revert_decision') return null
  if (delta.type === 'cancel_item') return { type: delta.type, item_id: delta.item_id, is_estimate: false }
  return { type: delta.type, item_id: delta.item_id, value: clock(delta.value).replace('.', ':'), is_estimate: delta.is_estimate }
}
