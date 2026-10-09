import { describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildAgentRequest } from '@/modules/agent/runner'
import { toolsForCapability } from '@/modules/agent/tools'
import { prepareAttachments } from '@/modules/support/attachments'
import { SupportInput } from '@/modules/support/input'
import { CHAT_MEMORY_PREFIX, chatHistory, compactChat, readChatMemory, writeChatMemory, clearChatMemory, type ChatMessage } from '@/components/agent/chat-memory'
import { extractImageText } from '@/modules/support/ocr'

vi.mock('@/modules/support/ocr', () => ({ extractImageText: vi.fn().mockResolvedValue(''), extractScannedPdf: vi.fn().mockResolvedValue('') }))

const tools = toolsForCapability('coordinator')
const limits = { contextTokens: 400000, outputTokens: 128000 }
const png = { name: 'jadwal.png', mime_type: 'image/png' as const, data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHaUAAAAASUVORK5CYII=' }

describe('budget dan lampiran agent produksi', () => {
  it('reasoning max dan output 128000 benar-benar dikirim dalam request', () => {
    const request = buildAgentRequest('system', 'data', tools, 'cx/gpt-6.1-sol', 'max', false, { limits })
    expect(request).toMatchObject({ reasoning_effort: 'max', max_completion_tokens: 128000, model: 'cx/gpt-6.1-sol' })
    expect(request).not.toHaveProperty('limit')
  })
  it('ringkasan tetap ringan, dan batas output server dapat diturunkan', () => {
    expect(buildAgentRequest('system', 'data', [], 'unit', 'low', false, { limits }).max_completion_tokens).toBe(2048)
    expect(buildAgentRequest('system', 'data', [], 'unit', 'max', false, { limits: { ...limits, outputTokens: 32000 } }).max_completion_tokens).toBe(32000)
  })
  it('budget input dan output tidak boleh melewati kapasitas context', () => {
    expect(() => buildAgentRequest('a'.repeat(280000), 'data', tools, 'unit', 'max', false, { limits })).toThrow('agent_context_limit')
  })
  it('history menerima 64 turn dan pesan panjang, tanpa budget/role dari client', () => {
    expect(SupportInput.safeParse({ message: 'a'.repeat(1500), history: Array.from({ length: 64 }, () => ({ role: 'user', text: 'Talent I' })) }).success).toBe(true)
    expect(SupportInput.safeParse({ message: 'ok', history: Array.from({ length: 65 }, () => ({ role: 'user', text: 'x' })) }).success).toBe(false)
    expect(SupportInput.safeParse({ message: 'ok', attachments: [{ ...png, pages: 1 }] }).success).toBe(false)
  })
  it('gambar menjadi content part image_url, PDF menjadi file part; bukan sekadar deklarasi modalities', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage()
    const file = { name: 'jadwal.pdf', mime_type: 'application/pdf' as const, data: Buffer.from(await pdf.save()).toString('base64') }
    const attachments = await prepareAttachments([png, file])
    expect(attachments[1].pages).toBe(1)
    const request = buildAgentRequest('system', 'baca', [], 'unit', 'max', false, { limits, attachments })
    expect(request.messages[1].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_url', image_url: expect.objectContaining({ url: `data:image/png;base64,${png.data}` }) }),
      expect.objectContaining({ type: 'file', file: expect.objectContaining({ filename: 'jadwal.pdf', file_data: expect.stringContaining('data:application/pdf;base64,') }) }),
    ]))
  })
  it('mime palsu dan total file terlalu besar ditolak tanpa write filesystem', async () => {
    await expect(prepareAttachments([{ ...png, data: Buffer.from('bukan gambar').toString('base64') }])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(prepareAttachments([{ ...png, data: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
  it('PDF berteks dikirim sebagai teks nyata untuk gateway tanpa native PDF', async () => {
    const pdf = await PDFDocument.create(); const page = pdf.addPage(); page.drawText('Talent I 23.30 WIB 30 menit')
    const attachments = await prepareAttachments([{ name: 'jadwal.pdf', mime_type: 'application/pdf', data: Buffer.from(await pdf.save()).toString('base64') }])
    expect(attachments[0].text).toContain('Talent I 23.30 WIB 30 menit')
    const request = buildAgentRequest('system', 'baca', [], 'unit', 'max', false, { limits, attachments })
    expect(request.messages[1].content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining('Talent I 23.30 WIB 30 menit') })]))
  })
  it('gambar menyertakan teks hasil OCR dan byte gambar, sehingga gateway teks tetap mendapat isi', async () => {
    vi.mocked(extractImageText).mockResolvedValueOnce('Talent I 23.30 WIB 30 menit')
    const attachments = await prepareAttachments([png])
    const request = buildAgentRequest('system', 'baca', [], 'unit', 'max', false, { limits, attachments })
    expect(request.messages[1].content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining('Talent I 23.30 WIB 30 menit') }), expect.objectContaining({ type: 'image_url' })]))
  })
})

describe('memori percakapan per session', () => {
  const message: ChatMessage = { id: 1, role: 'user', text: 'Ubah Talent I', at: '13.20', files: [png], fileNames: [png.name] }
  it('pindah halaman memulihkan isi/berkas untuk sesi yang sama, sesi lain tetap kosong', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    writeChatMemory(storage, 'a', [message])
    expect(readChatMemory(storage, 'a')).toEqual([message])
    expect(readChatMemory(storage, 'b')).toBeNull()
    data.set(CHAT_MEMORY_PREFIX + 'c', '{rusak')
    expect(readChatMemory(storage, 'c')).toBeNull()
  })
  it('hapus memori login/logout hanya menghapus data agent', () => {
    const data = new Map([[CHAT_MEMORY_PREFIX + 'a', 'isi'], ['sidebar', '1']])
    clearChatMemory({ length: data.size, key: (i: number) => [...data.keys()][i] ?? null, removeItem: (key: string) => { data.delete(key) } })
    expect([...data.keys()]).toEqual(['sidebar'])
  })
  it('history menyertakan target dan rencana konkret; pesan gagal tidak menjadi ingatan', () => {
    const history = chatHistory([message, { ...message, id: 2, error: true, text: 'gagal' }, { id: 3, role: 'assistant', text: 'Siap', at: '', proposals: [{ change_id: 'change', href: '/changes/change', label: 'Talent I ke 23.30', preview: { base_version: 2, patch_id: 'patch', candidate_rank: 1, label: 'Talent I', timezone: 'Asia/Jakarta', diff: [] } }] }])
    expect(history).toHaveLength(2)
    expect(history[1].text).toContain('Talent I ke 23.30')
    expect(compactChat(Array.from({ length: 80 }, (_, id) => ({ ...message, id, files: undefined })))).toHaveLength(64)
  })
})
