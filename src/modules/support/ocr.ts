import path from 'node:path'
import { createWorker, OEM } from 'tesseract.js'
import { renderPageAsImage } from 'unpdf'
import { AppError } from '@/lib/errors'

// Webpack mempertahankan require native untuk worker/data yang sudah disertakan tracing;
// CLI tsx memakai require Node biasa. Tidak mengevaluasi kode atau path dari pengguna.
declare const __non_webpack_require__: NodeRequire | undefined

/** Worker baru per operasi, data bahasa lokal, cache disk dimatikan, selalu diakhiri. */
export async function extractImageText(bytes: Uint8Array): Promise<string> {
  const language = (typeof __non_webpack_require__ === 'function'
    ? __non_webpack_require__('@tesseract.js-data/eng')
    : require('@tesseract.js-data/eng')) as { langPath: string }
  const workerModule = typeof __non_webpack_require__ === 'function'
    ? __non_webpack_require__.resolve('tesseract.js')
    : require.resolve('tesseract.js')
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    langPath: language.langPath,
    workerPath: path.join(path.dirname(workerModule), 'worker-script/node/index.js'),
    cacheMethod: 'none', gzip: true, logger: () => undefined, errorHandler: () => undefined,
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const recognized = worker.recognize(Buffer.from(bytes))
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AppError('AI_UNAVAILABLE', 'Pembacaan gambar terlalu lama. Gunakan gambar yang lebih jelas atau bagian tabel yang relevan.')), 45000) })
    const result = await Promise.race([recognized, timeout])
    return result.data.text.trim()
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('VALIDATION_ERROR', 'Gambar tidak dapat dibaca. Gunakan PNG, JPG, atau WebP yang jelas dan tidak rusak.')
  } finally {
    if (timer) clearTimeout(timer)
    await worker.terminate()
  }
}

/** PDF berisi gambar diproses di memori, tanpa berkas sementara atau state lintas request. */
export async function extractScannedPdf(pdf: Parameters<typeof renderPageAsImage>[0], pages: number): Promise<string> {
  if (pages > 10) throw new AppError('VALIDATION_ERROR', 'PDF scan maksimal 10 halaman. Lampirkan bagian jadwal yang relevan.')
  const texts: string[] = []
  for (let page = 1; page <= pages; page++) {
    const image = await renderPageAsImage(pdf, page, { scale: 1.5, canvasImport: () => import('@napi-rs/canvas') })
    const text = await extractImageText(new Uint8Array(image))
    if (text) texts.push(`[Halaman ${page}]\n${text}`)
  }
  return texts.join('\n\n')
}
