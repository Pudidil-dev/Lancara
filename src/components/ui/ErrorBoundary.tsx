'use client'
import { Component, type ReactNode } from 'react'
import { Button } from './button'
import { Icon } from './Icon'

export function UnexpectedError({ onRetry }: { onRetry: () => void }) {
  return <section className="card ui-unexpected-error" role="alert">
    <span className="ui-error-illustration"><Icon name="alert" size={28} /></span>
    <h2>Bagian ini belum dapat ditampilkan</h2>
    <p>Terjadi kendala sementara. Coba muat kembali bagian ini untuk melanjutkan.</p>
    <Button variant="outline" onClick={onRetry}><Icon name="history" />Muat kembali</Button>
  </section>
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <UnexpectedError onRetry={() => this.setState({ failed: false })} /> : this.props.children }
}
