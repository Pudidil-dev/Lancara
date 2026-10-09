import Link from 'next/link'
import { Icon } from '@/components/ui/Icon'

/** Logo Ripple (ikon + wordmark 28/36 bold putih) — dipakai di sidebar dan halaman login. */
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Ripple beranda">
      <Icon name="ripple" size={24} />
      Ripple
    </Link>
  )
}
