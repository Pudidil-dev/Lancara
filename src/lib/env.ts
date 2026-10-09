import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL (atau POSTGRES_URL) wajib diisi'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET minimal 32 karakter'),
  AI_PROVIDER: z.enum(['rule', 'anthropic', 'openai-compatible']).default('rule'),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'OPENAI_BASE_URL harus http atau https').optional(),
  OPENAI_API_KEY: z.string().optional(),
  APP_BASE_URL: z.string().optional(),
  DEMO_MODE: z.string().default('true').transform((v) => v === 'true' || v === '1'),
  DEMO_CLOCK_ISO: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),
  TELEGRAM_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(24).max(256).regex(/^[A-Za-z0-9_-]+$/, 'Secret webhook hanya boleh berisi huruf, angka, _ dan -').optional(),
  TELEGRAM_BOT_USERNAME: z.string().min(5).max(32).regex(/^[A-Za-z][A-Za-z0-9_]+$/, 'Username bot tanpa @ atau URL').optional(),
}).superRefine((value, ctx) => {
  if (!value.TELEGRAM_ENABLED) return
  for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_USERNAME'] as const) {
    if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} wajib diisi bila TELEGRAM_ENABLED=true` })
  }
})

export type Env = z.infer<typeof EnvSchema>

let cached: Env | null = null

/** Dibaca lazily agar `next build` tidak gagal saat env runtime belum tersedia. */
export function env(): Env {
  if (cached) return cached
  const parsed = EnvSchema.safeParse({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || undefined,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || undefined,
    APP_BASE_URL: process.env.APP_BASE_URL || undefined,
    DEMO_CLOCK_ISO: process.env.DEMO_CLOCK_ISO || undefined,
    TELEGRAM_ENABLED: process.env.TELEGRAM_ENABLED || undefined,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || undefined,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
    TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || undefined,
  })
  if (!parsed.success) {
    throw new Error(`Konfigurasi environment tidak valid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  cached = parsed.data
  return cached
}
