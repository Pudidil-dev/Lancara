import { extractTextItems, getDocumentProxy } from 'unpdf'
import { AppError } from '@/lib/errors'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, type AgentAttachment } from './limits'
import { itemsToLines } from '@/modules/imports/pdf'
import { extractImageText, extractScannedPdf } from './ocr'

/** Validasi dalam memori; berkas tidak ditulis ke disk atau dibagikan lewat URL publik. */
export async function prepareAttachments(files: AgentAttachment[]): Promise<AgentAttachment[]> {
  if (files.length > MAX_ATTACHMENTS) throw new AppError('VALIDATION_ERROR', `Maksimal ${MAX_ATTACHMENTS} lampiran.`)
  let total = 0
  const validated: AgentAttachment[] = []
  for (const file of files) {
    const bytes = Buffer.from(file.data, 'base64')
    total += bytes.length
    if (!bytes.length || total > MAX_ATTACHMENT_BYTES) throw new AppError('VALIDATION_ERROR', 'Total gambar/PDF maksimal 2 MB.')
    const magic = file.mime_type === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
      : file.mime_type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : file.mime_type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : file.mime_type === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    if (!magic) throw new AppError('VALIDATION_ERROR', 'Isi lampiran tidak sesuai format gambar/PDF.')
    let pages: number | undefined
    let text: string | undefined
    if (file.mime_type === 'application/pdf') {
      try {
        const pdf = await getDocumentProxy(new Uint8Array(bytes))
        try {
          pages = pdf.numPages
          if (pages > 50) throw new AppError('VALIDATION_ERROR', 'PDF maksimal 50 halaman; lampirkan bagian yang relevan.')
          const extracted = await extractTextItems(pdf)
          text = extracted.items.map((items, index) => `[Halaman ${index + 1}]\n${itemsToLines(items).join('\n')}`).join('\n\n')
          if (!extracted.items.some(items => items.some(item => item.str.trim()))) text = await extractScannedPdf(pdf, pages) || undefined
        } finally { await pdf.destroy() }
      } catch (error) {
        if (error instanceof AppError) throw error
        throw new AppError('VALIDATION_ERROR', 'PDF tidak dapat dibaca. Pastikan berkas tidak rusak atau terkunci.')
      }
    } else { text = await extractImageText(bytes) || undefined }
    validated.push({ name: file.name.replace(/[\\/\u0000-\u001f]/g, ' ').trim().slice(0, 200), mime_type: file.mime_type, data: bytes.toString('base64'), ...(pages ? { pages } : {}), ...(text ? { text } : {}) })
  }
  return validated
}
