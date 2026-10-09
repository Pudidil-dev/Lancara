import { test, expect } from '@playwright/test'
import { login, reset, screenshot } from './helpers'

test.beforeEach(async ({ baseURL }) => { await reset(baseURL!) })
test('UI-A login koordinator: v1, 18.40 WIB, navigasi dan offline', async ({ page, context }, info) => {
  await page.goto('/login')
  await expect(page.getByText('Simulasi peran demo — data fiktif')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Rina / })).toBeVisible()
  await screenshot(page, info, 'login')
  await login(page)
  await expect(page.getByText('Rundown v1', { exact: true })).toBeVisible()
  await expect(page.getByRole('banner').getByText(/^18[.:]40(?::00)? WIB$/)).toBeVisible()
  await expect(page.getByRole('navigation').getByRole('link', { name: /Riwayat/ })).toBeVisible()
  await screenshot(page, info, 'shell')
  await context.setOffline(true)
  await expect(page.getByText('Tidak ada koneksi. Perubahan memerlukan server.', { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Keluar' })).toBeDisabled()
  await screenshot(page, info, 'offline')
  await context.setOffline(false)
  await expect(page.getByRole('button', { name: 'Keluar' })).toBeEnabled()
})
test('UI-A login Bayu: inbox dan akses kru', async ({ page }, info) => {
  await login(page, 'Bayu')
  await expect(page.getByText('Rundown v1', { exact: true })).toBeVisible()
  await expect(page.getByRole('navigation').getByRole('link', { name: /Riwayat/ })).toHaveCount(0)
  await screenshot(page, info, 'shell-crew')
  await page.getByRole('button', { name: 'Keluar' }).click()
  await expect(page).toHaveURL(/\/login$/)
})
