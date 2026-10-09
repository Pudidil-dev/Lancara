import { ApiError } from './api-client'

export type ErrorContext = 'read' | 'write' | 'chat' | 'upload'
export interface ErrorFeedback { title: string; message: string; retryable: boolean; tone: 'warning' | 'danger'; uncertain?: boolean }

const copy: Record<string, ErrorFeedback> = {
  OFFLINE: { title: 'Koneksi terputus', message: 'Sambungkan kembali internet untuk melanjutkan. Perubahan memerlukan koneksi ke server.', retryable: true, tone: 'warning' },
  NETWORK: { title: 'Belum dapat terhubung', message: 'Periksa koneksi internet, lalu coba lagi. Isian Anda tetap tersedia di halaman ini.', retryable: true, tone: 'warning' },
  TIMEOUT: { title: 'Respons memerlukan waktu lebih lama', message: 'Server belum merespons. Tunggu sebentar, lalu coba muat kembali.', retryable: true, tone: 'warning' },
  UNAUTHENTICATED: { title: 'Sesi Anda telah berakhir', message: 'Masuk kembali untuk melanjutkan.', retryable: false, tone: 'warning' },
  FORBIDDEN: { title: 'Tindakan belum diizinkan', message: 'Akun Anda tidak memiliki akses untuk tindakan ini.', retryable: false, tone: 'warning' },
  NOT_FOUND: { title: 'Data belum ditemukan', message: 'Data mungkin sudah berubah atau tautannya tidak lagi tersedia. Kembali ke rundown untuk melanjutkan.', retryable: false, tone: 'warning' },
  STALE_VERSION: { title: 'Rundown sudah diperbarui', message: 'Muat versi terbaru sebelum melanjutkan. Isian Anda tetap tersedia untuk diperiksa kembali.', retryable: false, tone: 'warning' },
  CONTEXT_CHANGED: { title: 'Kondisi acara sudah berubah', message: 'Hitung ulang opsi dari kondisi terkini sebelum menyetujui perubahan.', retryable: false, tone: 'warning' },
  VALIDATION_ERROR: { title: 'Periksa kembali isian Anda', message: 'Ada isian yang belum sesuai. Lengkapi atau perbaiki bagian yang ditandai, lalu coba lagi.', retryable: false, tone: 'warning' },
  MISSING_DATA: { title: 'Data acara belum lengkap', message: 'Lengkapi data rundown yang diperlukan sebelum melanjutkan.', retryable: false, tone: 'warning' },
  PATCH_BLOCKED: { title: 'Opsi ini belum dapat diterapkan', message: 'Periksa batas acara yang ditampilkan, lalu hitung ulang opsi yang sesuai.', retryable: false, tone: 'warning' },
  INVALID_STATE: { title: 'Tindakan ini belum dapat dilanjutkan', message: 'Status data sudah berubah. Perbarui halaman dan periksa kembali tindakan yang tersedia.', retryable: false, tone: 'warning' },
  IDEMPOTENCY_CONFLICT: { title: 'Permintaan perlu diperiksa kembali', message: 'Ada permintaan sebelumnya untuk tindakan ini. Periksa hasilnya sebelum membuat perubahan lain.', retryable: false, tone: 'warning' },
  RATE_LIMITED: { title: 'Tunggu sebentar', message: 'Ada beberapa permintaan dalam waktu berdekatan. Coba lagi sesaat lagi.', retryable: true, tone: 'warning' },
  AI_UNAVAILABLE: { title: 'AI belum tersedia', message: 'Coba lagi sebentar atau lanjutkan melalui form manual. Draft yang sudah tersimpan tetap tersedia.', retryable: true, tone: 'warning' },
  STORAGE_UNAVAILABLE: { title: 'Data belum dapat diakses', message: 'Layanan penyimpanan sedang mengalami kendala. Tunggu sebentar, lalu coba lagi.', retryable: true, tone: 'danger' },
}

/** Server codes are actionable; stack traces, SQL, raw JSON and exception messages are not user copy. */
export function errorFeedback(error: unknown, context?: ErrorContext): ErrorFeedback {
  const apiError = error instanceof ApiError ? error : null
  const operation = context ?? apiError?.operation ?? 'read'
  if (operation === 'write' && apiError && ['TIMEOUT', 'NETWORK', 'INVALID_RESPONSE', 'STORAGE_UNAVAILABLE'].includes(apiError.code)) {
    return { title: 'Perubahan masih diperiksa', message: 'Hasil perubahan belum dapat dipastikan. Tunggu sebentar sebelum melanjutkan.', retryable: false, tone: 'warning', uncertain: true }
  }
  if (operation === 'chat' && apiError && ['TIMEOUT', 'INTERNAL', 'INVALID_RESPONSE', 'AI_UNAVAILABLE'].includes(apiError.code)) {
    return { title: 'AI belum dapat merespons', message: 'Coba kirim pesan lagi sebentar. Perubahan rundown tetap memerlukan konfirmasi Anda.', retryable: true, tone: 'warning' }
  }
  if (operation === 'upload' && apiError?.code === 'TIMEOUT') {
    return { title: 'Unggahan memerlukan waktu lebih lama', message: 'Hasil pembacaan berkas belum diterima. Tunggu sebentar sebelum mengunggah kembali.', retryable: true, tone: 'warning' }
  }
  return (apiError && copy[apiError.code]) ?? { title: 'Terjadi kendala sementara', message: 'Permintaan belum dapat diselesaikan. Tunggu sebentar, lalu coba lagi.', retryable: true, tone: 'danger' }
}

export const userErrorMessage = (error: unknown, context?: ErrorContext) => errorFeedback(error, context).message
