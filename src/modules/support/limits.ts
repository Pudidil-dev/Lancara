export const MAX_MESSAGE = 16000
export const MAX_HISTORY_TURNS = 64
export const MAX_HISTORY_TEXT = 16000
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024
export const MAX_ATTACHMENTS = 2

export interface AgentAttachment {
  name: string
  mime_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf'
  data: string
  /** Dihitung server, bukan dipercaya dari client. */
  pages?: number
  /** Teks PDF hasil ekstraksi server untuk gateway yang tidak meneruskan native file part. */
  text?: string
}
