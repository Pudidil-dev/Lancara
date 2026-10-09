import { route } from '@/lib/http'
import { getPublicRundown } from '@/modules/share/service'

export const dynamic = 'force-dynamic'

/** Publik tanpa sesi: rundown aktif hanya baca lewat token tautan. Tidak ada endpoint tulis untuk token. */
export const GET = route<{ token: string }>('share.public', async (_req, { params }) => getPublicRundown(params.token))
