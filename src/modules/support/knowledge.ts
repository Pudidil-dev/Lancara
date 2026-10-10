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
    answer: () => 'Laporkan kabar perubahan lewat panel Lancara Support di Dashboard, misalnya "Talent B baru bisa mulai jam 20.05". Sistem menafsirkan kabar itu dulu; tafsiran harus dikonfirmasi sebelum opsi dihitung. Rundown aktif belum berubah sampai koordinator menyetujui opsi.',
    suggestions: () => [{ label: 'Dashboard', href: '/' }],
  },
  {
    keys: ['setuju', 'approve', 'persetujuan', 'menyetujui', 'disetujui'],
    answer: () => 'Pilih opsi di halaman perubahan, isi alasan, lalu setujui. Sistem memeriksa ulang versi dan batas sebelum menyimpan. Jika rundown sudah berubah, opsi harus dihitung ulang.',
    suggestions: () => [{ label: 'Riwayat', href: '/history' }],
  },
  {
    keys: ['tidak ada opsi', 'tidak feasible', 'feasible', 'tidak muncul', 'kenapa tidak', 'opsi kosong'],
    answer: () => 'Tidak ada opsi berarti tidak ditemukan kombinasi yang lolos semua batas tercatat, misalnya jam selesai acara atau slot tetap, dalam pencarian terbatas. Itu bukan bukti bahwa tidak ada jadwal lain. Periksa batas di menu Rundown atau Pengaturan, atau coba waktu lain.',
    suggestions: () => [{ label: 'Rundown', href: '/rundown/setup' }],
  },
  {
    keys: ['terkunci', 'berlangsung', 'status', 'selesai'],
    answer: () => 'Item yang sedang berlangsung atau sudah selesai terkunci: jam mulainya tidak dipindahkan otomatis. Koordinator dapat membuka segmen di Dashboard lalu menandai mulai atau selesai.',
    suggestions: () => [{ label: 'Dashboard', href: '/' }],
  },
  {
    keys: ['brief', 'inbox', 'sudah dibaca', 'dibaca', 'konfirmasi'],
    answer: () => 'Brief perubahan dan status bacanya per peran dapat dilihat di Riwayat. Status dibaca hanya tanda sudah membaca, bukan tanda bahwa aksi di lapangan sudah dilakukan.',
    suggestions: () => [{ label: 'Riwayat', href: '/history' }],
  },
  {
    keys: ['riwayat', 'versi', 'history', 'keputusan'],
    answer: () => 'Riwayat menampilkan keputusan, versi rundown, dan status baca seluruh brief acara.',
    suggestions: () => [{ label: 'Riwayat', href: '/history' }],
  },
  {
    keys: ['jam simulasi', 'simulasi', 'reset', 'demo'],
    answer: () => 'Jam simulasi dipakai untuk demo acara dan diatur saat data demo disiapkan; Dashboard memakainya untuk segmen yang sedang berlangsung dan sisa waktu.',
    suggestions: () => [{ label: 'Dashboard', href: '/' }],
  },
  {
    keys: ['login', 'masuk', 'akun', 'peran', 'keluar', 'logout'],
    answer: () => 'LANCARA memakai satu akun utama dengan akses penuh koordinator. Masuk menggunakan akun tersebut; semua menu dan tools tersedia. Perubahan melalui AI Agent tetap menunggu konfirmasi.',
    suggestions: () => [],
  },
  {
    keys: ['rundown', 'jadwal', 'setup', 'pengaturan', 'edit', 'ubah item', 'urutan'],
    answer: () => 'Di menu Rundown, Anda dapat mengubah item, jam, durasi, PIC, dependensi, dan batas; nama acara, zona waktu, dan batas selesai ada di Pengaturan. Rundown dari PDF ditambahkan lewat tombol Tambah Rundown. Setiap simpan menjadi versi baru.',
    suggestions: () => [{ label: 'Rundown', href: '/rundown/setup' }],
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
