'use client'
import { useEffect, useId, useRef, type ReactNode } from 'react'
export function Dialog({ open, title, children, onClose, busy = false }: { open: boolean; title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => { dialog.close(); previous?.focus() }
  }, [open])
  return <dialog ref={ref} tabIndex={-1} aria-labelledby={titleId} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const dialog = event.currentTarget
    const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(control => control.getClientRects().length > 0)
    const first = controls[0]
    const last = controls.at(-1)
    if (!first) { event.preventDefault(); dialog.focus(); return }
    const focused = document.activeElement
    if (!controls.includes(focused as HTMLElement) || (event.shiftKey && focused === first) || (!event.shiftKey && focused === last)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first)?.focus()
    }
  }} onCancel={e => { e.preventDefault(); if (!busy) onClose() }}><div className="stack"><div className="row between"><h2 id={titleId}>{title}</h2><button type="button" className="btn" aria-label="Tutup dialog" disabled={busy} onClick={onClose}>×</button></div>{children}</div></dialog>
}
