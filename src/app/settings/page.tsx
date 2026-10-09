import { AppShell } from '@/components/shell/AppShell'
import { EventSettingsScreen } from '@/components/imports/EventSettingsScreen'

export default function SettingsPage() {
  return <AppShell title="Pengaturan" description="Atur informasi acara."><EventSettingsScreen /></AppShell>
}
