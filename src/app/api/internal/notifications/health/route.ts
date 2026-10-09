import { route } from '@/lib/http'
import { requireNotifierSecret } from '@/modules/notifier/internal'
import { health } from '@/modules/notifier/dispatch'
export const dynamic='force-dynamic'
export const GET=route('notifier.health',async req=>{requireNotifierSecret(req);return health()})
