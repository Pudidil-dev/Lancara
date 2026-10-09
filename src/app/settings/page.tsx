import { AppShell } from '@/components/shell/AppShell'
import { EventSettingsScreen } from '@/components/imports/EventSettingsScreen'
import { TelegramSettings } from '@/components/notifier/TelegramSettings'
import { NotificationLog } from '@/components/notifier/NotificationLog'

export default function SettingsPage() {
  return <AppShell title="Pengaturan" description="Atur informasi acara dan notifikasi perubahan rundown."><div className="stack"><EventSettingsScreen /><TelegramSettings /><NotificationLog /></div></AppShell>
}
