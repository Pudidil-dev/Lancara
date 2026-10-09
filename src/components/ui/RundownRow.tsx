import type { ReactNode } from 'react'
import { Icon } from './Icon'

// Figma "Ripple/Rundown row" (node 9:65): waktu, segmen + subjudul, durasi, PIC, status teks. Tinggi min. 72px.
// Dipakai di dalam <div role="table" className="rundown-list" aria-label="…"> dengan <RundownHead /> sebagai baris pertama.
export type RundownTone = 'success' | 'warning' | 'danger' | 'muted'

export interface RundownRowProps {
  /** Dipakai untuk aria-controls pada detail yang dapat dibuka. */
  id: string
  time: string
  title: string
  subtitle: string
  duration: string
  pic: string
  status: string
  tone?: RundownTone
  /** Item sedang berlangsung (latar successSoft). */
  live?: boolean
  /** Aksi (mis. tombol Mulai/Selesai) di bawah teks status. */
  action?: ReactNode
  /** Isi detail; bila diberikan, judul menjadi tombol pembuka. */
  detail?: ReactNode
  expanded?: boolean
  onToggle?: () => void
}

export function RundownHead() {
  return (
    <div className="rundown-head" role="row">
      <span role="columnheader">WAKTU</span>
      <span role="columnheader">SEGMEN</span>
      <span role="columnheader">DURASI</span>
      <span role="columnheader">PIC</span>
      <span role="columnheader">STATUS</span>
    </div>
  )
}

export function RundownRow({ id, time, title, subtitle, duration, pic, status, tone = 'muted', live = false, action, detail, expanded = false, onToggle }: RundownRowProps) {
  const detailId = `rundown-detail-${id}`
  return (
    <div className="rundown-item" role="rowgroup" data-live={live || undefined}>
      <div className="rundown-row" role="row">
        <span className="rundown-time" role="cell">{time}</span>
        <span className="rundown-segment" role="rowheader">
          {detail ? (
            <button type="button" className="rundown-title rundown-title-btn" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle}>{title}<span className="rundown-caret"><Icon name="chevron" size={16} /></span></button>
          ) : (
            <span className="rundown-title">{title}</span>
          )}
          <span className="rundown-sub">{subtitle}</span>
        </span>
        <span className="rundown-muted" role="cell">{duration}</span>
        <span className="rundown-muted rundown-pic" role="cell">{pic}</span>
        <span className="rundown-state" role="cell">
          <span className="rundown-status" data-tone={tone}>{status}</span>
          {action}
        </span>
      </div>
      {detail && !!expanded && (
        <div className="rundown-detail" role="row" id={detailId}>
          <div role="cell" aria-colspan={5}>{detail}</div>
        </div>
      )}
    </div>
  )
}
