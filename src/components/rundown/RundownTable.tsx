// "Rundown table" Figma (179:1739 Siapkan Data, 179:2168 Dashboard): kolom tetap, baris selang-seling canvas/line.
import type { ReactNode } from 'react'

export const RUNDOWN_COLUMNS = ['NO', 'WAKTU', 'SEGMEN', 'DURASI', 'PIC', 'PIHAK YANG TERLIBAT', 'PERLENGKAPAN', 'TEKNIS'] as const

export interface RundownCells {
  waktu: string
  segmen: string
  durasi: string
  pic: string
  involved: string
  equipment: string
  notes: string
}

/** Tujuh sel setelah NO; dipakai di dalam elemen dengan kelas rt-cells (subgrid). */
export function RundownCellsView({ cells }: { cells: RundownCells }) {
  return <>
    <span className="rt-strong">{cells.waktu}</span>
    <span className="rt-strong">{cells.segmen}</span>
    <span className="rt-muted">{cells.durasi}</span>
    <span className="rt-muted">{cells.pic}</span>
    <span className="rt-small">{cells.involved || '–'}</span>
    <span className="rt-small">{cells.equipment || '–'}</span>
    <span className="rt-small">{cells.notes || '–'}</span>
  </>
}

/** Kartu tabel: judul (nama acara), "N item" + aksi opsional, header kolom, lalu baris (children). */
export function RundownTable({ title, count, action, label, scroll = false, children }: { title: string; count: number; action?: ReactNode; label: string; scroll?: boolean; children: ReactNode }) {
  return (
    <section className="rt-card" data-scroll={scroll || undefined} aria-label={label}>
      <div className="rt-heading">
        <h2>{title}</h2>
        <span className="rt-heading-side"><span className="rt-count">{count} item</span>{action}</span>
      </div>
      <div className="rt-scroll">
        <div className="rt-table">
          <div className="rt-grid rt-head" aria-hidden="true">{RUNDOWN_COLUMNS.map((c) => <span key={c}>{c}</span>)}</div>
          <ol className="rt-body">{children}</ol>
        </div>
      </div>
    </section>
  )
}

export const listText = (values: string[] | undefined, separator = ', ') => (values ?? []).join(separator)
export const minutesText = (minutes: number) => `${minutes} mnt`
