'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { api, ApiError } from '@/lib/api-client'
import { BRAND_WORDMARK } from '@/lib/brand'
import { resetQueries } from '@/hooks/usePolling'

type Mode = 'login' | 'register'

const COPY = {
  login: { title: 'Login ke Lancara', subtitle: 'Masuk ke akun anda', button: 'Masuk ke Lancara', busy: 'Masuk…', path: '/api/auth/login', switchText: 'Belum punya akun?', switchLink: 'Daftar', switchHref: '/register' },
  register: { title: 'Daftar Akun Lancara', subtitle: 'Buat akun anda terlebih dahulu', button: 'Daftar ke Lancara', busy: 'Mendaftar…', path: '/api/auth/register', switchText: 'Sudah punya akun?', switchLink: 'Masuk', switchHref: '/login' },
} as const

/** Halaman Login dan Register (Figma 159:7266 dan 169:7623): username + password saja. */
export function AuthScreen({ mode }: { mode: Mode }) {
  const copy = COPY[mode]
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError('')
    try {
      await api(copy.path, { method: 'POST', body: { username, password } })
      resetQueries()
      router.replace('/rundown')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Tidak dapat terhubung ke server.')
      setPending(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-form-side">
        <Link href="/" className="auth-logo" aria-label={`${BRAND_WORDMARK} beranda`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- logo kecil statis dari Figma */}
          <img src="/brand/lancara-logo.png" alt="" width={23} height={23} />
          <span>{BRAND_WORDMARK}</span>
        </Link>
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-heading"><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
          <div className="auth-field"><label htmlFor="auth-username">Username</label><input id="auth-username" name="username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></div>
          <div className="auth-field"><label htmlFor="auth-password">Password</label><input id="auth-password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {error && <p className="lc-alert" role="alert">{error}</p>}
          <button type="submit" className="btn-gradient auth-submit" disabled={pending}>{pending ? copy.busy : copy.button}</button>
          <p className="auth-switch">{copy.switchText} <Link href={copy.switchHref}>{copy.switchLink}</Link></p>
        </form>
      </section>
      <section className="auth-art" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- pola dekoratif SVG dari Figma */}
        <img className="auth-pattern auth-pattern-top" src="/brand/pattern.svg" alt="" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="auth-pattern auth-pattern-bottom" src="/brand/pattern.svg" alt="" />
        <p className="auth-tagline">Saat rencana berubah, kendali tetap di <span>tangan</span>.</p>
      </section>
    </main>
  )
}
