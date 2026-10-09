'use client'
import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Slot header halaman (Figma "Page title": judul + deskripsi di kiri, tombol aksi di kanan).
 * AppShell menyediakan elemen slot; layar yang punya state lokal (mis. tombol simpan) memakai
 * <PageDescription> / <PageActions> untuk merender isi ke slot tanpa memindahkan state ke shell.
 */
export interface HeaderSlots {
  description: HTMLElement | null
  actions: HTMLElement | null
}

export const PageHeaderContext = createContext<HeaderSlots>({ description: null, actions: null })

export function PageDescription({ children }: { children: ReactNode }) {
  const { description } = useContext(PageHeaderContext)
  return description ? createPortal(children, description) : null
}

export function PageActions({ children }: { children: ReactNode }) {
  const { actions } = useContext(PageHeaderContext)
  return actions ? createPortal(children, actions) : null
}
