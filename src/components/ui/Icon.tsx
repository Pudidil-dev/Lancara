import type { CSSProperties } from 'react'

// Ikon dari Figma (Ripple/Icon/*, lucide-style) di /public/icons. Dirender dengan CSS mask sehingga warna
// mengikuti `color` konteks (nav = teks nav, notice = warna notice, panel = muted) — bukan warna tetap dari file SVG.
export type IconName = 'lancara' | 'panel-left-close' | 'layout-grid' | 'calendar-days' | 'inbox' | 'history' | 'settings-2' | 'bell' | 'plus' | 'lock' | 'alert' | 'check' | 'chevron'

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  // Dekoratif: makna selalu ada di teks di sebelahnya.
  const style = { '--icon': `url(/icons/${name}.svg)`, width: size, height: size } as CSSProperties
  return <span className="icon" style={style} aria-hidden="true" />
}
