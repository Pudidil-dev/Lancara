'use client'
import { UnexpectedError } from '@/components/ui/ErrorBoundary'
import './globals.css'
import './lancara-figma.css'
import './ui-components.css'

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="id"><body><main className="container ui-error-page"><UnexpectedError onRetry={reset} /></main></body></html>
}
