import { route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { listRundowns } from '@/modules/events/rundown-list'

export const dynamic = 'force-dynamic'

/** Daftar rundown akun (halaman /rundown) dengan status berlangsung / akan datang / selesai. */
export const GET = route('rundowns.list', async (req) => listRundowns(await requireSession(req)))
