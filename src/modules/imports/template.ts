// Penulis PDF minimal (Helvetica, teks saja) untuk "Template Rundown Standar" dan fixture tes.
// Kolom diletakkan pada posisi x tetap sehingga pembaca PDF memisahkannya dengan " | ".

export interface PdfTextRun { x: number; y: number; text: string; size?: number; bold?: boolean }

const PAGE = { width: 842, height: 595 } // A4 lanskap

/** Hanya ASCII cetak agar aman untuk WinAnsiEncoding tanpa embed font. */
function ascii(text: string): string {
  return text
    .replace(/[–—]/g, '-')
    .replace(/[·•]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e]/g, '')
}

const escapePdf = (text: string) => ascii(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

/** Bangun PDF valid (xref benar) dari daftar halaman berisi potongan teks. */
export function buildPdf(pages: PdfTextRun[][]): Uint8Array {
  const objects: string[] = []
  const add = (body: string) => objects.push(body) // nomor objek = indeks + 1
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('') // Pages, diisi setelah halaman diketahui
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const kids: number[] = []
  for (const runs of pages) {
    const content = runs.map((r) => `BT /${r.bold ? 'F2' : 'F1'} ${r.size ?? 9} Tf ${r.x.toFixed(1)} ${r.y.toFixed(1)} Td (${escapePdf(r.text)}) Tj ET`).join('\n')
    add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`)
    const contentRef = objects.length
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentRef} 0 R >>`)
    kids.push(objects.length)
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(out, 'latin1'))
}

export interface TableRow { time: string; title: string; segment: string; duration: string; pic: string; equipment: string; notes: string }

const COLUMNS: Array<{ key: keyof TableRow; label: string; x: number; width: number }> = [
  { key: 'time', label: 'WAKTU', x: 36, width: 70 },
  { key: 'title', label: 'SEGMEN', x: 116, width: 150 },
  { key: 'segment', label: 'TIPE', x: 276, width: 80 },
  { key: 'duration', label: 'DURASI', x: 366, width: 44 },
  { key: 'pic', label: 'PIC', x: 420, width: 104 },
  { key: 'equipment', label: 'PERLENGKAPAN', x: 534, width: 112 },
  { key: 'notes', label: 'TEKNIS', x: 656, width: 156 },
]

/** Perkiraan lebar Helvetica 9pt ≈ 0,5 em per karakter; potong agar kolom tidak saling menimpa. */
const fit = (text: string, width: number, size = 9) => {
  const max = Math.max(4, Math.floor(width / (size * 0.52)))
  return text.length > max ? `${text.slice(0, max - 1)}~` : text
}

/** PDF tabel rundown: judul, info acara, header kolom, lalu baris (dipecah ke halaman berikutnya bila penuh). */
export function rundownTablePdf(title: string, subtitle: string, rows: TableRow[]): Uint8Array {
  const pages: PdfTextRun[][] = []
  let runs: PdfTextRun[] = []
  let y = 0
  const header = () => {
    runs = [{ x: 36, y: 550, text: title, size: 16, bold: true }, { x: 36, y: 530, text: subtitle, size: 10 }]
    for (const c of COLUMNS) runs.push({ x: c.x, y: 500, text: c.label, size: 8, bold: true })
    y = 480
  }
  header()
  for (const row of rows) {
    if (y < 40) {
      pages.push(runs)
      header()
    }
    for (const c of COLUMNS) if (row[c.key]) runs.push({ x: c.x, y, text: fit(row[c.key], c.width), size: 9 })
    y -= 22
  }
  pages.push(runs)
  return buildPdf(pages)
}

/** Contoh standar yang diunduh dari halaman "Unggah PDF". */
export const TEMPLATE_ROWS: TableRow[] = [
  { time: '17:00 - 17:30', title: 'Registrasi Panitia', segment: 'Persiapan', duration: "30'", pic: 'LO Talent', equipment: 'Meja registrasi; Pulpen', notes: 'Panitia mengisi daftar hadir' },
  { time: '17:30 - 18:00', title: 'Briefing Kru', segment: 'Persiapan', duration: "30'", pic: 'Stage Crew', equipment: 'HT; Rundown cetak', notes: 'Korlap membagi pos kru' },
  { time: '18:00 - 18:30', title: 'Soundcheck Final', segment: 'Teknis', duration: "30'", pic: 'PIC Audio', equipment: 'Wireless mic; Backline', notes: 'Cek semua kanal mic' },
  { time: '18:30 - 18:45', title: 'Opening', segment: 'Main stage', duration: "15'", pic: 'MC', equipment: 'Wireless mic', notes: 'Lampu panggung penuh' },
  { time: '18:45 - 19:15', title: 'Keynote', segment: 'Mulai tetap', duration: "30'", pic: 'MC / LO Talent', equipment: 'Clicker; Konten LED', notes: 'Slide dari laptop operator' },
  { time: '19:15 - 19:45', title: 'Talent B', segment: 'Performance', duration: "30'", pic: 'LO Talent / PIC Audio', equipment: 'Backline band', notes: 'Cue lighting mengikuti lagu' },
  { time: '19:45 - 20:15', title: 'Ishoma', segment: 'Istirahat', duration: "30'", pic: 'Stage Crew', equipment: 'Konsumsi', notes: 'Panggung kosong, musik latar' },
  { time: '20:15 - 20:45', title: 'Panel Diskusi', segment: 'Diskusi', duration: "30'", pic: 'MC / Stage Crew', equipment: 'Sofa panel; 3 mic', notes: 'Set panel dipasang saat ishoma' },
  { time: '20:45 - 20:55', title: 'Closing', segment: 'Main stage', duration: "10'", pic: 'MC / PIC Lighting', equipment: 'Wireless mic', notes: 'Lampu fade out di akhir' },
]

export function templatePdf(): Uint8Array {
  return rundownTablePdf('Template Rundown Standar Lancara', 'Nama acara: Malam Apresiasi Komunitas - Zona waktu: WIB - Batas selesai 21:00', TEMPLATE_ROWS)
}
