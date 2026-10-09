import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, request, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import { assertResetAllowed } from './global-setup'
export const eventPath = '/api/events/evt-ripple-demo'
export const at = (hhmm: string) => `2026-10-09T${String(Number(hhmm.slice(0, 2)) - 7).padStart(2, '0')}:${hhmm.slice(3)}:00.000Z`
export const key = () => `e2e-${randomUUID()}`
export async function post<T = Record<string, unknown>>(api: APIRequestContext, url: string, data: unknown, baseURL: string): Promise<T> {
  const response = await api.post(url, { data, headers: { Origin: new URL(baseURL).origin } })
  expect(response.ok(), `${url}: ${response.status()} ${await response.text()}`).toBeTruthy()
  return (await response.json()).data as T
}
export async function reset(baseURL: string) {
  assertResetAllowed(baseURL)
  const api = await request.newContext({ baseURL })
  try { await post(api, '/api/session', { actor_id: 'act-rina' }, baseURL); await post(api, '/api/demo/reset', {}, baseURL) }
  finally { await api.dispose() }
}
export async function login(page: Page, name = 'Rina') {
  await page.goto('/login')
  await page.getByRole('button', { name: new RegExp(`^${name} `) }).click()
  await expect(page).toHaveURL(name === 'Rina' ? /\/rundown$/ : /\/inbox$/)
  await expect(page.getByText(new RegExp(`^${name} \\(`)).first()).toBeVisible()
}
export async function screenshot(page: Page, info: TestInfo, name: string) {
  const folder = path.resolve('../docs/ripple/evidence/screenshots')
  await mkdir(folder, { recursive: true })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: path.join(folder, `${info.project.name}-${name}.png`), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
}
export async function analyseApi(api: APIRequestContext, baseURL: string, time = '20:05', baseVersion = 1) {
  const change = await post<{ change_id: string }>(api, `${eventPath}/changes`, { original_text: 'Talent B', reference_at: at('18:40') }, baseURL)
  await post(api, `/api/changes/${change.change_id}/confirm`, { base_version: baseVersion, delta: { type: 'earliest_start', item_id: 'talent-b', value: at(time), is_estimate: false, reference_at: at('18:40') }, idempotency_key: key() }, baseURL)
  return (await (await api.get(`/api/changes/${change.change_id}`)).json()).data as { change: { id: string }; patches: { id: string; strategy: string }[] }
}
export async function newChangeUi(page: Page, text = 'Talent B baru bisa mulai jam 20.05', withoutReference = false) {
  await page.goto('/changes/new')
  await page.getByLabel('Kabar perubahan').fill(text)
  const reference = page.getByLabel('Waktu acuan kabar (WIB)', { exact: true })
  await expect(reference).not.toHaveValue('')
  if (withoutReference) await reference.fill('')
  await page.getByRole('button', { name: 'Tafsirkan', exact: true }).click()
  await expect(page).toHaveURL(/\/changes\/[0-9a-f-]{36}(?:\?.*)?$/)
  await expect(page.getByRole('button', { name: 'Konfirmasi tafsiran', exact: true })).toBeVisible()
  const detailResponse = await page.request.get(new URL(page.url()).pathname.replace('/changes/', '/api/changes/'))
  expect(detailResponse.ok()).toBeTruthy()
  const detail = (await detailResponse.json()).data
  await test.info().attach('parser-provider', {
    body: Buffer.from(JSON.stringify({ provider: detail.change.parse_provider, parse_ms: detail.change.parse_ms, status: detail.change.status })),
    contentType: 'application/json',
  })
}
export async function confirmUi(page: Page) {
  await page.getByRole('button', { name: 'Konfirmasi tafsiran', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Konfirmasi tafsiran', exact: true })).toHaveCount(0)
}
export async function approveUi(page: Page, reason = 'Panel ditukar, slot sponsor tetap aman') {
  await page.getByRole('button', { name: 'Pilih opsi ini', exact: true }).first().click()
  await page.getByRole('button', { name: 'Setujui opsi terpilih', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Setujui perubahan rundown' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Alasan persetujuan', { exact: true }).fill(reason)
  await dialog.getByRole('button', { name: 'Setujui dan kirim brief', exact: true }).click()
  await expect(page.getByText(/Disetujui sebagai v\d+ · \d+ brief terkirim/)).toBeVisible()
}
