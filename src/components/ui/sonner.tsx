'use client'
import { Toaster as Sonner } from 'sonner'
import { Icon } from './Icon'

export function Toaster() {
  return <Sonner theme="light" position="bottom-right" closeButton visibleToasts={3} duration={6000}
    containerAriaLabel="Notifikasi aplikasi" className="ui-toaster"
    icons={{ success: <Icon name="check" />, error: <Icon name="alert" />, warning: <Icon name="alert" />, info: <Icon name="info" /> }}
    toastOptions={{ unstyled: true, classNames: { toast: 'ui-toast', title: 'ui-toast-title', description: 'ui-toast-description',
      closeButton: 'ui-toast-close', actionButton: 'ui-toast-action', cancelButton: 'ui-toast-cancel' } }} />
}
