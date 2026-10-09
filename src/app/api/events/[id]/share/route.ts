import { route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { createShare, getShare, revokeShare } from '@/modules/share/service'

export const dynamic = 'force-dynamic'

/** Kelola tautan publik rundown (akun utama). */
export const GET = route<{ id: string }>('share.get', async (req, { params }) => getShare(await requireSession(req), params.id))
export const POST = route<{ id: string }>('share.create', async (req, { params }) => createShare(await requireSession(req), params.id), { mutation: true })
export const DELETE = route<{ id: string }>('share.revoke', async (req, { params }) => revokeShare(await requireSession(req), params.id), { mutation: true })
