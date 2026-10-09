import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorker } from 'tesseract.js'
import { extractImageText, extractScannedPdf } from '@/modules/support/ocr'

vi.mock('tesseract.js', () => ({ createWorker: vi.fn(), OEM: { LSTM_ONLY: 1 } }))
afterEach(() => vi.clearAllMocks())

describe('OCR serverless-safe', () => {
  it('memakai data bahasa lokal/cache none dan mengakhiri worker setelah pembacaan', async () => {
    const worker = { recognize: vi.fn().mockResolvedValue({ data: { text: ' Talent I 23.30 WIB 30 menit\n' } }), terminate: vi.fn().mockResolvedValue(undefined) }
    vi.mocked(createWorker).mockResolvedValueOnce(worker as unknown as Awaited<ReturnType<typeof createWorker>>)
    expect(await extractImageText(new Uint8Array([1, 2]))).toBe('Talent I 23.30 WIB 30 menit')
    expect(createWorker).toHaveBeenCalledWith('eng', 1, expect.objectContaining({ cacheMethod: 'none', gzip: true, langPath: expect.stringContaining('@tesseract.js-data'), workerPath: expect.stringContaining('worker-script') }))
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('worker tetap dihentikan ketika gambar gagal dibaca, tanpa membocorkan detail internal', async () => {
    const worker = { recognize: vi.fn().mockRejectedValue(new Error('private decoder detail')), terminate: vi.fn().mockResolvedValue(undefined) }
    vi.mocked(createWorker).mockResolvedValueOnce(worker as unknown as Awaited<ReturnType<typeof createWorker>>)
    await expect(extractImageText(new Uint8Array([1]))).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.not.stringContaining('private') })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('batas halaman scan diperiksa sebelum membuat worker/render', async () => {
    await expect(extractScannedPdf(new Uint8Array(), 11)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(createWorker).not.toHaveBeenCalled()
  })
})
