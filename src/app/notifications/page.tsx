'use client'
import { NotificationsScreen } from '@/components/notifications/NotificationsScreen'
import { AppShell } from '@/components/shell/AppShell'

export default function NotificationsPage() {
  return <AppShell title="Notifikasi" hideTitle><NotificationsScreen /></AppShell>
}
