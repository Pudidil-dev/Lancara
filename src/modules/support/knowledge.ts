// Panduan bantuan berbasis aturan (jalur utama dan fallback saat AI tidak tersedia).
// Fungsi ini murni: hanya mengembalikan teks dan tautan halaman. Tidak pernah mengubah data.

export type SupportCapability = 'coordinator' | 'crew'
export interface Suggestion { label: string; href: string }
export interface RuleReply { answer: string; suggestions: Suggestion[] }

interface Who { capability: SupportCapability }
interface Entry {
  keys: string[]
  answer: (who: Who) => string
  suggestions: (who: Who) => Suggestion[]
}

export const FALLBACK_ANSWER =
  'Saya hanya bisa membantu memakai Ripple. Coba tanya: "Bagaimana cara melapor perubahan?", "Kenapa tidak ada opsi?", atau "Siapa yang bisa menyetujui?".'

const isCoordinator = (who: Who) => who.capability === 'coordinator'

// Urutan penting: entri pertama yang cocok yang dipakai.
const ENTRIES: Entry[] = [
  {
    keys: ['lapor', 'kabar', 'telat', 'terlambat', 'molor', 'batal', 'tukar', 'datang'],
    answer: () => 'Laporkan kabar perubahan di Kabar baru, misalnya "Talent B baru bisa mulai jam 20.05". Sistem menafsirkan kabar itu dulu; tafsiran harus dikonfirmasi sebelum opsi dihitung. Rundown aktif belum berubah sampai koordinator menyetujui opsi.',
    suggestions: () => [{ label: 'Kabar baru', href: '/changes/new' }],
  },
  {
    keys: ['setuju', 'approve', 'persetujuan', 'menyetujui', 'disetujui'],
    answer: (who) => isCoordinator(who)
      ? 'Pilih opsi di halaman perubahan, isi alasan, lalu setujui. Sistem memeriksa ulang versi dan batas sebelum menyimpan. Jika rundown sudah berubah, opsi harus dihitung ulang.'
      : 'Persetujuan dilakukan koordinator. Sebagai kru, Anda menerima brief yang relevan di Inbox.',
    suggestions: (who) => [isCoordinator(who) ? { label: 'Riwayat', href: '/history' } : { label: 'Inbox', href: '/inbox' }],
  },
  {
    keys: ['tidak ada opsi', 'tidak feasible', 'feasible', 'tidak muncul', 'kenapa tidak', 'opsi kosong'],
    answer: () => 'Tidak ada opsi berarti tidak ditemukan kombinasi yang lolos semua batas tercatat, misalnya jam selesai acara atau slot tetap, dalam pencarian terbatas. Itu bukan bukti bahwa tidak ada jadwal lain. Periksa batas di Pengaturan atau coba waktu lain.',
    suggestions: (who) => [isCoordinator(who) ? { label: 'Pengaturan batas', href: '/rundown/setup' } : { label: 'Rundown', href: '/rundown' }],
  },
  {
    keys: ['terkunci', 'berlangsung', 'status', 'selesai'],
    answer: () => 'Item yang sedang berlangsung atau sudah selesai terkunci: jam mulainya tidak dipindahkan otomatis. Koordinator dapat menandai Mulai atau Selesai di Rundown.',
    suggestions: () => [{ label: 'Rundown', href: '/rundown' }],
  },
  {
    keys: ['brief', 'inbox', 'sudah dibaca', 'dibaca', 'konfirmasi'],
    answer: () => 'Brief muncul di Inbox sesuai peran Anda. Tekan "Sudah dibaca" setelah membacanya. Itu hanya tanda sudah membaca, bukan tanda bahwa aksi di lapangan sudah dilakukan.',
    suggestions: () => [{ label: 'Inbox', href: '/inbox' }],
  },
  {
    keys: ['riwayat', 'versi', 'history', 'keputusan'],
    answer: (who) => isCoordinator(who)
      ? 'Riwayat menampilkan keputusan, versi rundown, dan status baca brief per peran.'
      : 'Riwayat hanya dapat dibuka koordinator. Anda dapat melihat brief yang relevan di Inbox.',
    suggestions: (who) => [isCoordinator(who) ? { label: 'Riwayat', href: '/history' } : { label: 'Inbox', href: '/inbox' }],
  },
  {
    keys: ['jam simulasi', 'simulasi', 'reset', 'demo'],
    answer: () => 'Jam simulasi dipakai untuk demo acara. Koordinator dapat memajukan jam atau mereset data demo dari halaman Rundown.',
    suggestions: () => [{ label: 'Rundown', href: '/rundown' }],
  },
  {
    keys: ['login', 'masuk', 'akun', 'peran', 'keluar', 'logout'],
    answer: () => 'Ini simulasi peran demo, bukan login akun asli. Untuk ganti peran, tekan Keluar di sidebar lalu pilih peran lain.',
    suggestions: () => [],
  },
  {
    keys: ['rundown', 'jadwal', 'setup', 'pengaturan', 'edit', 'ubah item', 'urutan'],
    answer: (who) => isCoordinator(who)
      ? 'Di Pengaturan, Anda dapat mengubah item, jam, durasi, PIC, dependensi, dan batas. Setiap simpan menjadi versi baru.'
      : 'Kru hanya dapat melihat rundown. Perubahan dilakukan lewat Kabar baru.',
    suggestions: (who) => [isCoordinator(who) ? { label: 'Pengaturan', href: '/rundown/setup' } : { label: 'Rundown', href: '/rundown' }],
  },
]

const GREETING = /^(halo|hai|hi|hello|selamat (pagi|siang|sore|malam))\b/

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

/** Jawaban berbasis aturan. Fungsi murni: tidak menyentuh database dan tidak memiliki efek samping. */
export function ruleAnswer(text: string, who: Who): RuleReply {
  const t = normalize(text)
  if (GREETING.test(t)) return { answer: 'Halo. Ada yang bisa saya bantu tentang Ripple?', suggestions: [] }
  const entry = ENTRIES.find((e) => e.keys.some((k) => t.includes(k)))
  if (!entry) return { answer: FALLBACK_ANSWER, suggestions: [] }
  return { answer: entry.answer(who), suggestions: entry.suggestions(who) }
}
