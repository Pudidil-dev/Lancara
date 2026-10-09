'use client'
import { useRef, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'
import { Button } from './button'
export function Dialog({ open, title, children, onClose, busy = false, className }: { open: boolean; title: string; children: ReactNode; onClose: () => void; busy?: boolean; className?: string }) {
  const returnFocus = useRef<HTMLElement | null>(null)
  return <DialogPrimitive.Root open={open} onOpenChange={value => { if (!value && !busy) onClose() }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-dialog-overlay" />
      <DialogPrimitive.Content className={cn('ui-dialog', className)} aria-describedby={undefined}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={event => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus() } }}
        onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onPointerDownOutside={event => event.preventDefault()}>
        <div className="stack"><div className="row between ui-dialog-heading">
          <DialogPrimitive.Title asChild><h2>{title}</h2></DialogPrimitive.Title>
          <DialogPrimitive.Close asChild><Button variant="ghost" size="icon" aria-label="Tutup dialog" disabled={busy}><span aria-hidden="true">×</span></Button></DialogPrimitive.Close>
        </div>{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}
