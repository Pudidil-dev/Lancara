'use client'
import { useRef, useState } from 'react'
import { ErrorState, Icon , Button } from '@/components/ui'
import { useMutation } from '@/hooks/useMutation'
import { useOnline } from '@/hooks/useOnline'
import { defaultPicRole, fillDefaultPic } from '@/modules/events/default-pic'
import type { Snapshot } from '@/modules/engine/types'

export function DefaultPicButton({ snapshot, version, eventId }: { snapshot: Snapshot; version: number; eventId: string }) {
  const mutation = useMutation()
  const online = useOnline()
  const [notice, setNotice] = useState('')
  const intent = useRef<{ base_version: number; snapshot: Snapshot; note: string; origin: string } | null>(null)
  const role = defaultPicRole(snapshot.roles)
  const count = snapshot.items.filter(item => !item.pic_role_ids.length).length
  async function save() {
    if (!role || !count) return
    intent.current ??= { base_version: version, snapshot: fillDefaultPic(snapshot), origin: 'manual_edit', note: 'PIC kosong diisi dengan peran koordinator default' }
    try {
      const result = await mutation.mutate<{ new_version: number }>({ path: `/api/events/${eventId}/setup`, method: 'PUT', body: intent.current })
      intent.current = null
      setNotice(`PIC default disimpan · Rundown v${result.new_version}.`)
    } catch (error) {
      if ((error as { code?: string }).code === 'STALE_VERSION') intent.current = null
    }
  }
  return <div className="stack">
    {!!count && role && <div className="row"><Button variant="outline" type="button" className="btn" disabled={mutation.pending || !online} onClick={() => void save()}><Icon name="check" /> {mutation.pending ? 'Menyimpan PIC…' : `Isi PIC default (${count} segmen)`}</Button><span className="muted small">PIC kosong memakai {role.label}; dapat diubah di editor rundown.</span></div>}
    {mutation.error && <ErrorState error={mutation.error} />}
    {notice && <p role="status" className="alert alert-success"><Icon name="check" /> {notice}</p>}
  </div>
}
