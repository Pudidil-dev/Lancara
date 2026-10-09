import type { MentionRecipients, NotificationPayload } from './types'

const MAX_MESSAGE = 4096
const cleanText = (value: string) => value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
  .replace(/@/g, '＠').replace(/\b(https?|tg):\/\//gi, '$1：//')

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Truncates source text before escaping, so neither entities nor surrogate pairs are split. */
function boundedText(value: string, budget: number): string {
  const escaped = escapeHtml(cleanText(value))
  if (escaped.length <= budget) return escaped
  let output = ''
  for (const char of cleanText(value)) {
    const encoded = escapeHtml(char)
    if (output.length + encoded.length + 1 > budget) break
    output += encoded
  }
  return `${output}…`
}

function allowedPublicUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || !/\/share\/[A-Za-z0-9_-]{32}$/.test(url.pathname) || value.length > 600) return undefined
    return escapeHtml(url.toString())
  } catch { return undefined }
}

export function renderMessage({ payload, paragraph, recipients, publicUrl, retry = false }: {
  payload: NotificationPayload; paragraph: string; recipients: MentionRecipients; publicUrl?: string; retry?: boolean
}): string {
  const header = `<b>Rundown v${payload.version} · ${boundedText(payload.event.name, 550)}</b>${retry ? ' (kirim ulang)' : ''}`
  const summary = boundedText(paragraph, 1900)
  const url = allowedPublicUrl(publicUrl)
  const footer = url ? `\n<a href="${url}">Lihat rundown</a>` : ''
  const base = `${header}\n${summary}`
  const available = MAX_MESSAGE - base.length - footer.length - '\nPIC: '.length - 40
  const chunks: string[] = []
  const ids = new Set<string>()
  let omitted = Math.max(0, recipients.additional_count)
  let length = 0
  for (const mention of recipients.mentions) {
    if (ids.has(mention.telegram_user_id)) continue
    ids.add(mention.telegram_user_id)
    if (ids.size > 20 || !/^[1-9]\d*$/.test(mention.telegram_user_id)) { omitted++; continue }
    const chunk = `<a href="tg://user?id=${mention.telegram_user_id}">${boundedText(mention.display_name, 130)}</a> (${boundedText(mention.role_labels.join(', '), 180)})`
    if (length + chunk.length + 3 > available) { omitted++; continue }
    chunks.push(chunk); length += chunk.length + 3
  }
  for (const role of [...new Set(recipients.unlinked_roles)]) {
    const chunk = `${boundedText(role, 180)} (belum terhubung)`
    if (length + chunk.length + 3 > available) { omitted++; continue }
    chunks.push(chunk); length += chunk.length + 3
  }
  if (omitted) chunks.push(`+${omitted} lainnya`)
  return `${base}${chunks.length ? `\nPIC: ${chunks.join(' · ')}` : ''}${footer}`
}

/** Only removes tags emitted by renderMessage; escaped source text remains literal text. */
export function plainText(html: string): string {
  return html.replace(/<\/?b>/g, '').replace(/<a href="([^"]*)">([^]*?)<\/a>/g, (_match, href: string, label: string) =>
    /^https?:\/\//i.test(href) ? `${label}: ${href}` : label)
    .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
}
