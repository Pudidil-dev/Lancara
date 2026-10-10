import { AppShell } from '@/components/shell/AppShell'
import { RundownList } from '@/components/rundown/RundownList'

// Daftar seluruh rundown akun: berlangsung, akan datang, dan selesai.
export default function Rundowns() {
  return <AppShell title="Daftar Rundown" description="Semua rundown acara Anda, termasuk yang sedang berlangsung, akan datang, dan sudah selesai."><RundownList /></AppShell>
}
