// Env untuk seluruh suite: DB test terpisah, jam simulasi fixture, parser rule (tanpa jaringan).
import { loadEnvFiles } from '../scripts/load-env'

loadEnvFiles()
if (process.env.DATABASE_URL_TEST) process.env.DATABASE_URL = process.env.DATABASE_URL_TEST
process.env.DEMO_CLOCK_ISO = '2026-10-09T11:40:00Z'
process.env.DEMO_MODE = 'true'
process.env.AI_PROVIDER = 'rule'
process.env.LOG_LEVEL = 'error'
process.env.SESSION_SECRET ??= 'test-secret-test-secret-test-secret-123'
