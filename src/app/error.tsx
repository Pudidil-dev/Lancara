'use client'
import { UnexpectedError } from '@/components/ui/ErrorBoundary'

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="container ui-error-page"><UnexpectedError onRetry={reset} /></main>
}
