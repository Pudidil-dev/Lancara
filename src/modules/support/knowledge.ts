import { PRODUCT_NAME } from '@/lib/brand'

// Panduan berbasis aturan (jalur utama dan fallback saat AI tidak tersedia).
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
  'Model belum tersedia untuk menjawab pesan ini. Coba lagi sebentar; Anda tetap dapat memakai menu website.'

// Urutan penting: entri pertama yang cocok yang dipakai.
const ENTRIES: Entry[] = [
  {
    keys: ['lapor', 'kabar', 'telat', 'terlambat', 'molor', 'batal', 'tukar', 'datang'],
    answer: () => 'Laporkan kabar perubahan di Kabar baru, misalnya "Talent B baru bisa mulai jam 20.05". Sistem menafsirkan kabar itu dulu; tafsiran harus dikonfirmasi sebelum opsi dihitung. Rundown aktif belum berubah sampai koordinator menyetujui opsi.',
    suggestions: () => [{ label: 'Kabar baru', href: '/changes/new' }],
  },
  {
    keys: ['setuju', 'approve', 'persetujuan', 'menyetujui', 'disetujui'],
    answer: () => 'Pilih opsi di halaman perubahan, isi alasan, lalu setujui. Sistem memeriksa ulang versi dan batas sebelum menyimpan. Jika rundown sudah berubah, opsi harus dihitung ulang.',
    suggestions: () => [{ label: 'Riwayat', href: '/history' }],
  },
  {
    keys: ['tidak ada opsi', 'tidak feasible', 'feasible', 'tidak muncul', 'kenapa tidak', 'opsi kosong'],
    answer: () => 'Tidak ada opsi berarti tidak ditemukan kombinasi yang lolos semua batas tercatat, misalnya jam selesai acara atau slot tetap, dalam pencarian terbatas. Itu bukan bukti bahwa tidak ada jadwal lain. Periksa batas di Pengaturan atau coba waktu lain.',
    suggestions: () => [{ label: 'Pengaturan batas', href: '/rundown/setup' }],
  },
  {
    keys: ['terkunci', 'berlangsung', 'status', 'selesai'],
    answer: () => 'Item yang sedang berlangsung atau sudah selesai terkunci: jam mulainya tidak dipindahkan otomatis. Koordinator dapat menandai Mulai atau Selesai di Rundown.',
    suggestions: () => [{ label: 'Rundown', href: '/rundown' }],
  },
  {
    keys: ['brief', 'inbox', 'sudah dibaca', 'dibaca', 'konfirmasi'],
    answer: () => 'Seluruh brief acara muncul di Inbox. Tekan "Sudah dibaca" setelah membacanya. Itu hanya tanda sudah membaca, bukan tanda bahwa aksi di lapangan sudah dilakukan.',
    suggestions: () => [{ label: 'Inbox', href: '/inbox' }],
  },
  {
    keys: ['riwayat', 'versi', 'history', 'keputusan'],
    answer: () => 'Riwayat menampilkan keputusan, versi rundown, dan status baca seluruh brief acara.',
    suggestions: () => [{ label: 'Riwayat', href: '/history' }],
  },
  {
    keys: ['jam simulasi', 'simulasi', 'reset', 'demo'],
    answer: () => 'Jam simulasi dipakai untuk demo acara. Koordinator dapat memajukan jam atau mereset data demo dari halaman Rundown.',
    suggestions: () => [{ label: 'Rundown', href: '/rundown' }],
  },
  {
    keys: ['login', 'masuk', 'akun', 'peran', 'keluar', 'logout'],
    answer: () => 'LANCARA memakai satu akun utama dengan akses penuh koordinator. Masuk menggunakan akun tersebut; semua menu dan tools tersedia. Perubahan melalui AI Agent tetap menunggu konfirmasi.',
    suggestions: () => [],
  },
  {
    keys: ['rundown', 'jadwal', 'setup', 'pengaturan', 'edit', 'ubah item', 'urutan'],
    answer: () => 'Di Pengaturan, Anda dapat mengubah item, jam, durasi, PIC, dependensi, dan batas. Setiap simpan menjadi versi baru.',
    suggestions: () => [{ label: 'Pengaturan', href: '/rundown/setup' }],
  },
]

/** Fakta cara kerja LANCARA untuk dikirim ke model sebagai PANDUAN (data), dari sumber yang sama dengan jawaban aturan. */
export function groundingFacts(): string {
  const lines = new Set<string>()
  for (const entry of ENTRIES) {
    lines.add(`- ${entry.answer({ capability: 'coordinator' })} (koordinator)`)
  }
  return [...lines].join('\n')
}

const GREETING = /^(halo|hai|hi|hello|selamat (pagi|siang|sore|malam))\b/

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

/** Jawaban berbasis aturan. Fungsi murni: tidak menyentuh database dan tidak memiliki efek samping. */
export function ruleAnswer(text: string, who: Who): RuleReply {
  const t = normalize(text)
  if (GREETING.test(t)) return { answer: `Halo. Ada yang bisa saya bantu tentang ${PRODUCT_NAME}?`, suggestions: [] }
  const entry = ENTRIES.find((e) => e.keys.some((k) => t.includes(k)))
  if (!entry) return { answer: FALLBACK_ANSWER, suggestions: [] }
  return { answer: entry.answer(who), suggestions: entry.suggestions(who) }
}
