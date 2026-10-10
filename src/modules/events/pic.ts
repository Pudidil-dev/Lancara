// PIC teks bebas: nama ditulis apa adanya (pic_text); peran sistem (pic_role_ids) dicocokkan dari teks
// untuk brief/notifikasi dan, bila tidak ada yang cocok, memakai Koordinator agar engine tetap valid.
import type { RoleRef } from '@/modules/engine/types'
import { matchRole } from '@/modules/imports/normalize'
import { defaultPicRole } from './default-pic'

/** Pecah "MC, Audio / Lighting & Sidiq" menjadi nama PIC. */
export function splitPic(text: string): string[] {
  return [...new Set(text.split(/[,;/&\n]| dan /i).map(name => name.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 10)
}

export function resolvePic(text: string, roles: RoleRef[]): { pic_text: string | undefined; pic_role_ids: string[] } {
  const names = splitPic(text)
  const matched = [...new Set(names.flatMap(name => { const id = matchRole(name, roles); return id ? [id] : [] }))].slice(0, 10)
  const fallback = defaultPicRole(roles)
  return { pic_text: names.length ? names.join(', ').slice(0, 200) : undefined, pic_role_ids: matched.length ? matched : fallback ? [fallback.id] : [] }
}
