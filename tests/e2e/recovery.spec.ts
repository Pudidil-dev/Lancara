import { test, expect } from '@playwright/test'
import { analyseApi, at, confirmUi, eventPath, key, login, newChangeUi, post, reset, screenshot } from './helpers'

test.beforeEach(async ({ baseURL }) => { await reset(baseURL!) })
async function openApproval(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Pilih opsi ini', exact: true }).first().click()
  await page.getByRole('button', { name: 'Setujui opsi terpilih', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Setujui perubahan rundown' })
  await dialog.getByLabel('Alasan persetujuan', { exact: true }).fill('Panel ditukar, sponsor tetap aman')
  return dialog
}

test('AT-07 dua tab preview menjadi stale setelah keputusan pertama', async ({ page, context, baseURL }, info) => {
  await login(page)
  const first = await analyseApi(page.request, baseURL!)
  const second = await analyseApi(page.request, baseURL!)
  const third = await analyseApi(page.request, baseURL!)
  await page.goto(`/changes/${second.change.id}`)
  await expect(page.getByRole('article', { name: /^Opsi/ })).toHaveCount(1)
  const tab = await context.newPage()
  await tab.goto(`/changes/${third.change.id}`)
  await expect(tab.getByRole('article', { name: /^Opsi/ })).toHaveCount(1)
  await post(page.request, `/api/changes/${first.change.id}/approve`, { patch_id: first.patches[0].id, base_version: 1, reason: 'Opsi pertama', idempotency_key: key() }, baseURL!)
  for (const current of [page, tab]) {
    await current.bringToFront()
    await expect(current.getByText('Rundown sudah berubah ke v2. Hitung ulang dari versi terkini.', { exact: false }).first()).toBeVisible()
    await expect(current.getByRole('button', { name: 'Setujui opsi terpilih', exact: true })).toBeDisabled()
  }
  const rejected = await page.request.post(`/api/changes/${second.change.id}/approve`, { data: { patch_id: second.patches[0].id, base_version: 1, reason: 'Opsi lama', idempotency_key: key() }, headers: { Origin: baseURL! } })
  expect(rejected.status()).toBe(409)
  expect((await rejected.json()).code).toBe('STALE_VERSION')
  await page.bringToFront()
  await screenshot(page, info, 'stale')
  await page.getByRole('button', { name: 'Hitung ulang', exact: true }).click()
  await expect(page.getByText('Rundown sudah berubah ke v2. Hitung ulang dari versi terkini.', { exact: false })).toHaveCount(0)
  const history = (await (await page.request.get(`${eventPath}/history`)).json()).data
  expect(history.versions).toHaveLength(2)
  await tab.close()
})

test('AT-08 klik ganda approve hanya satu permintaan, versi, keputusan dan lima brief', async ({ page, baseURL }, info) => {
  await login(page)
  await newChangeUi(page)
  await confirmUi(page)
  const dialog = await openApproval(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let count = 0
  await page.route('**/api/changes/*/approve', async route => { count++; await gate; await route.continue() })
  const button = dialog.getByRole('button', { name: 'Setujui dan kirim brief', exact: true })
  await button.evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click() })
  await expect(page.getByText('Menyimpan keputusan…', { exact: true })).toBeVisible()
  await expect(button).toBeDisabled()
  await screenshot(page, info, 'loading-approve')
  release()
  await expect(page.getByText(/Disetujui sebagai v2 · 5 brief terkirim/)).toBeVisible()
  expect(count).toBe(1)
  const history = (await (await page.request.get(`${eventPath}/history`)).json()).data
  expect(history.versions).toHaveLength(2)
  expect(history.decisions).toHaveLength(1)
  expect(history.decisions[0].acks).toHaveLength(5)
})

test('AT-08 respons approve hilang: pulihkan committed tanpa commit baru', async ({ page }, info) => {
  await login(page)
  await newChangeUi(page)
  await confirmUi(page)
  const dialog = await openApproval(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/requests/*', async route => { await gate; await route.continue() })
  let approvals = 0
  await page.route('**/api/changes/*/approve', async route => { approvals++; await route.fetch(); await route.abort('failed') })
  await dialog.getByRole('button', { name: 'Setujui dan kirim brief', exact: true }).click()
  await expect(page.getByText('! Status penyimpanan belum diketahui. Memeriksa permintaan…', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Alasan persetujuan')).toBeDisabled()
  await screenshot(page, info, 'timeout-committed')
  release()
  await expect(page.getByText(/Disetujui sebagai v2 · 5 brief terkirim/)).toBeVisible()
  expect(approvals).toBe(1)
})

test('AT-08 permintaan belum diterima: retry memakai key dan payload yang sama', async ({ page, baseURL }, info) => {
  await login(page)
  await newChangeUi(page)
  await confirmUi(page)
  const dialog = await openApproval(page)
  const bodies: unknown[] = []
  await page.route('**/api/changes/*/approve', async route => {
    bodies.push(route.request().postDataJSON())
    if (bodies.length === 1) await route.abort('failed')
    else await route.continue()
  })
  await dialog.getByRole('button', { name: 'Setujui dan kirim brief', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Coba lagi', exact: true })).toBeVisible()
  await expect(page.getByText(/Disetujui sebagai v2/)).toHaveCount(0)
  await screenshot(page, info, 'timeout-not-found')
  await dialog.getByRole('button', { name: 'Coba lagi', exact: true }).click()
  await expect(page.getByText(/Disetujui sebagai v2 · 5 brief terkirim/)).toBeVisible()
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toEqual(bodies[0])
  const history = (await (await page.request.get(`${eventPath}/history`)).json()).data
  expect(history.versions).toHaveLength(2)
})

test('AT-09 Bayu tidak melihat approve; server menolak 403', async ({ page, baseURL }) => {
  await login(page)
  const detail = await analyseApi(page.request, baseURL!)
  await login(page, 'Bayu')
  await page.goto(`/changes/${detail.change.id}`)
  await expect(page.getByRole('heading', { name: 'Perbandingan opsi pemulihan', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Setujui opsi terpilih', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Tolak kabar', exact: true })).toHaveCount(0)
  const response = await page.request.post(`/api/changes/${detail.change.id}/approve`, { data: { patch_id: detail.patches[0].id, base_version: 1, reason: 'Saya kru', idempotency_key: key() }, headers: { Origin: baseURL! } })
  expect(response.status()).toBe(403)
  await page.goto('/history')
  await expect(page.getByRole('alert').getByText(/^FORBIDDEN/)).toBeVisible()
})

test('AT-04/09 ack brief versi lama tidak menutup revisi baru', async ({ page, baseURL }, info) => {
  await login(page)
  const first = await analyseApi(page.request, baseURL!)
  await post(page.request, `/api/changes/${first.change.id}/approve`, { patch_id: first.patches[0].id, base_version: 1, reason: 'Tukar panel', idempotency_key: key() }, baseURL!)
  const second = await analyseApi(page.request, baseURL!, '19:15', 2)
  const swap = second.patches.find(p => p.strategy === 'swap')!
  expect(swap).toBeTruthy()
  await post(page.request, `/api/changes/${second.change.id}/approve`, { patch_id: swap.id, base_version: 2, reason: 'Talent sudah datang lebih cepat', idempotency_key: key() }, baseURL!)
  await login(page, 'Bayu')
  const old = page.getByRole('article', { name: /CH-\d+ · v2 · Brief/ })
  const current = page.getByRole('article', { name: /CH-\d+ · v3 · Brief/ })
  await expect(old).toContainText('Brief versi lama')
  await old.getByRole('button', { name: 'Sudah dibaca', exact: true }).click()
  await expect(old.getByText(/Sudah dibaca pukul/).first()).toBeVisible()
  await expect(current.getByRole('button', { name: 'Sudah dibaca', exact: true })).toBeEnabled()
  await screenshot(page, info, 'ack-old-revision')
  await page.reload()
  await expect(old.getByText(/Sudah dibaca pukul/).first()).toBeVisible()
  await expect(current.getByRole('button', { name: 'Sudah dibaca', exact: true })).toBeEnabled()
})

test('AT-08 penafsir tidak tersedia: draft tetap, form manual dapat dikonfirmasi', async ({ page }, info) => {
  await login(page)
  await page.route('**/api/changes/*/parse', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'AI_UNAVAILABLE', message: 'Penafsir tidak tersedia.', request_id: 'qa-ai-unavailable', details: null }) }))
  await newChangeUi(page)
  await expect(page.getByText(/Penafsir tidak tersedia. Gunakan form manual; draft tetap tersimpan./)).toBeVisible()
  await page.getByLabel('Item (ID, judul, jadwal)', { exact: true }).selectOption('talent-b')
  await page.getByLabel('Jenis perubahan', { exact: true }).selectOption('earliest_start')
  await page.getByLabel('Mulai paling awal (WIB)', { exact: true }).fill('2026-10-09T20:05')
  await screenshot(page, info, 'ai-unavailable-manual')
  await confirmUi(page)
  await expect(page.getByRole('article', { name: /^Opsi/ })).toHaveCount(1)
  await expect(page.getByText('Rundown v1', { exact: true })).toBeVisible()
})

test('AT-08 offline blok approve dan mempertahankan alasan hingga koneksi pulih', async ({ page, context }, info) => {
  await login(page)
  await newChangeUi(page)
  await confirmUi(page)
  const dialog = await openApproval(page)
  let count = 0
  page.on('request', req => { if (req.url().endsWith('/approve')) count++ })
  await context.setOffline(true)
  const submit = dialog.getByRole('button', { name: 'Setujui dan kirim brief', exact: true })
  await expect(submit).toBeDisabled()
  await submit.evaluate(el => (el as HTMLButtonElement).click())
  expect(count).toBe(0)
  await expect(dialog.getByLabel('Alasan persetujuan')).toHaveValue('Panel ditukar, sponsor tetap aman')
  await screenshot(page, info, 'offline-approval')
  await context.setOffline(false)
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(page.getByText(/Disetujui sebagai v2 · 5 brief terkirim/)).toBeVisible()
  expect(count).toBe(1)
})

test('DATA BELUM LENGKAP resource tanpa penanggung jawab memblokir approve', async ({ page, baseURL }, info) => {
  await login(page)
  const data = (await (await page.request.get(`${eventPath}/rundown`)).json()).data
  const resourceId = data.snapshot.items.find((item: { id: string }) => item.id === 'panel').resource_ids[0]
  data.snapshot.resources.find((r: { id: string }) => r.id === resourceId).role_ids = []
  const setup = await page.request.put(`${eventPath}/setup`, { data: { base_version: 1, snapshot: data.snapshot, idempotency_key: key() }, headers: { Origin: baseURL! } })
  expect(setup.ok()).toBeTruthy()
  await newChangeUi(page)
  await confirmUi(page)
  await expect(page.getByRole('heading', { name: /DATA BELUM LENGKAP/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Setujui opsi terpilih', exact: true })).toHaveCount(0)
  await screenshot(page, info, 'blocked')
})
