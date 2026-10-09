// Log terstruktur satu baris JSON. Jangan log kabar mentah, cookie, token, atau connection string.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const
type Level = keyof typeof LEVELS

const REDACT = /(text|original_text|cookie|token|secret|password|authorization|database_url|api_key)/i

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL as Level) || 'info'
  return LEVELS[lvl] ?? LEVELS.info
}

function sanitize(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, REDACT.test(k) ? '[redacted]' : v]))
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold()) return
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...sanitize(fields) })
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}
