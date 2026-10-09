import type { RoleRef, Snapshot } from '@/modules/engine/types'

/** PIC default selalu memakai peran koordinator yang sudah terdaftar pada acara. */
export function defaultPicRole(roles: RoleRef[]): RoleRef | undefined {
  return roles.find(role => role.id === 'koordinator')
    ?? roles.find(role => /\b(koordinator|coordinator)\b/i.test(role.label))
}

export function fillDefaultPic(snapshot: Snapshot): Snapshot {
  const role = defaultPicRole(snapshot.roles)
  if (!role) return snapshot
  return { ...snapshot, items: snapshot.items.map(item => item.pic_role_ids.length ? item : { ...item, pic_role_ids: [role.id] }) }
}
