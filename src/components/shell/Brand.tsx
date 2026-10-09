import Link from 'next/link'
import { Icon } from '@/components/ui/Icon'
import { BRAND_WORDMARK, PRODUCT_NAME } from '@/lib/brand'

/** Logo LANCARA — dipakai bersama di sidebar dan halaman login. */
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label={`${PRODUCT_NAME} beranda`}>
      <Icon name="lancara" size={22} />
      <span className="brand-text">{BRAND_WORDMARK}</span>
    </Link>
  )
}
