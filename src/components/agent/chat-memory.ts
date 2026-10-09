import { MAX_ATTACHMENT_BYTES, MAX_HISTORY_TEXT, MAX_HISTORY_TURNS, type AgentAttachment } from '@/modules/support/limits'
import type { ScheduleProposal } from './SchedulePreview'
import { latestExchange } from '@/modules/support/history'

export const CHAT_MEMORY_PREFIX = 'lancara.agent.chat.'
export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  at: string
  source?: 'rule' | 'ai'
  suggestions?: Array<{ label: string; href: string }>
  proposals?: ScheduleProposal[]
  reasoning?: string[]
  steps?: Array<{ tool: string; ok: boolean; note?: string; running?: boolean }>
  files?: AgentAttachment[]
  fileNames?: string[]
  error?: boolean
}

/** Keep the visible archive, but send only the latest exchange and preview as model memory. */
export function chatHistory(messages: ChatMessage[]) {
  return latestExchange(messages.filter(m => !m.error && m.id !== 0)).slice(-MAX_HISTORY_TURNS).map(m => ({
    role: m.role,
    text: (m.text + (m.fileNames?.length ? `\nLampiran: ${m.fileNames.join(', ')}` : '') + (m.proposals?.length ? `\nPratinjau sebelumnya (cek versi server): ${JSON.stringify(m.proposals.slice(-1).map(p => ({ label: p.label, applied: p.applied ?? false, base_version: p.preview?.base_version, diff: p.preview?.diff })))}` : '')).slice(0, MAX_HISTORY_TEXT),
  }))
}

/** Pertahankan lampiran terbaru dalam budget; lampiran lama tetap punya nama dan hasil pembacaan pada history. */
export function compactChat(messages: ChatMessage[]): ChatMessage[] {
  let remaining = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4
  return messages.slice(-MAX_HISTORY_TURNS).map(m => ({ ...m, text: m.text.slice(0, MAX_HISTORY_TEXT) })).reverse().map(m => {
    const size = (m.files ?? []).reduce((sum, file) => sum + file.data.length, 0)
    if (size > remaining) return { ...m, files: undefined }
    remaining -= size
    return m
  }).reverse()
}

export function readChatMemory(storage: Pick<Storage, 'getItem'>, sessionId: string): ChatMessage[] | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(CHAT_MEMORY_PREFIX + sessionId) ?? 'null')
    if (!Array.isArray(value) || !value.every(m => m && typeof m.id === 'number' && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string' && typeof m.at === 'string')) return null
    return compactChat(value as ChatMessage[])
  } catch { return null }
}

export function writeChatMemory(storage: Pick<Storage, 'setItem'>, sessionId: string, messages: ChatMessage[]) {
  const compact = compactChat(messages)
  try { storage.setItem(CHAT_MEMORY_PREFIX + sessionId, JSON.stringify(compact)) } catch {
    // Bila lampiran memenuhi quota tab, pertahankan percakapan/hasil pembacaan tanpa byte lampiran.
    try { storage.setItem(CHAT_MEMORY_PREFIX + sessionId, JSON.stringify(compact.map(m => ({ ...m, files: undefined })))) } catch { /* Mode privat: percakapan tetap di tab aktif. */ }
  }
}

export function clearChatMemory(storage: Pick<Storage, 'key' | 'length' | 'removeItem'>) {
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i)
      if (key?.startsWith(CHAT_MEMORY_PREFIX)) storage.removeItem(key)
    }
  } catch { /* Penyimpanan tab opsional. */ }
}
