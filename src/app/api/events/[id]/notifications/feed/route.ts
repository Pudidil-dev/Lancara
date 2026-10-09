import { route } from '@/lib/http'
import { requireSession } from '@/lib/session'
import { notificationFeed } from '@/modules/notifications/service'

export const dynamic = 'force-dynamic'

/** Feed halaman Notifikasi; ?filter=unread hanya yang belum dibaca. */
export const GET = route<{ id: string }>('notifications.feed', async (req, { params }) =>
  notificationFeed(await requireSession(req), params.id, req.nextUrl.searchParams.get('filter') === 'unread' ? 'unread' : 'all'),
)
