import { route } from '@/lib/http'
import { requireNotifierSecret } from '@/modules/notifier/internal'
import { drain } from '@/modules/notifier/dispatch'
export const dynamic='force-dynamic'
export const maxDuration=60
export const POST=route('notifier.drain',async req=>{requireNotifierSecret(req);return drain()})
