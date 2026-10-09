import { test, expect, type Locator, type Page } from '@playwright/test'
import { approveUi, confirmUi, login, newChangeUi, reset, screenshot } from './helpers'

async function keyboardFocus(page: Page, target: Locator) {
  for (let count = 0; count < 100; count++) {
    if (await target.evaluate(element => document.activeElement === element)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Kontrol tidak dapat dicapai dengan Tab.')
}
async function visibleFocus(target: Locator) {
  await expect(target).toBeFocused()
  const focus = await target.evaluate(element => {
    const style = getComputedStyle(element)
    return { visible: element.matches(':focus-visible'), width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle }
  })
  expect(focus.visible).toBeTruthy()
  expect(focus.width).toBeGreaterThanOrEqual(2)
  expect(focus.style).not.toBe('none')
}
async function basicSemantics(page: Page) {
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveAccessibleName(/\S/)
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible()
  const controls = page.locator('main button, main input:not([type="hidden"]), main textarea, main select, main a[href]')
  for (const control of await controls.all()) if (await control.isVisible()) await expect(control).toHaveAccessibleName(/\S/)
}

test.beforeEach(async ({ baseURL }) => { await reset(baseURL!) })

test('Aksesibilitas dasar lima layar: landmark, label kontrol, focus terlihat dan layout 360px', async ({ page }, info) => {
  await login(page)
  await basicSemantics(page)
  if (info.project.name === 'desktop') {
    const table = page.getByRole('table', { name: 'Rundown v1 · WIB' })
    await expect(table).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'WAKTU' })).toBeVisible()
  }
  await screenshot(page, info, 'a11y-rundown')
  await page.goto('/changes/new')
  const text = page.getByLabel('Kabar perubahan', { exact: true })
  await expect(text).toBeEnabled()
  await basicSemantics(page)
  await keyboardFocus(page, text)
  await visibleFocus(text)
  await screenshot(page, info, 'a11y-input-keyboard-focus')
  await newChangeUi(page)
  await basicSemantics(page)
  await expect(page.getByLabel('Item (ID, judul, jadwal)', { exact: true })).toHaveValue('talent-b')
  await screenshot(page, info, 'a11y-interpretation')
  await confirmUi(page)
  await basicSemantics(page)
  await screenshot(page, info, 'a11y-compare')
  await approveUi(page)
  await page.goto('/history')
  await expect(page.getByRole('region', { name: 'Ringkasan status baca' })).toBeVisible()
  await basicSemantics(page)
  await screenshot(page, info, 'a11y-history')
  await login(page, 'Bayu')
  await expect(page.getByRole('button', { name: 'Sudah dibaca', exact: true })).toBeVisible()
  await basicSemantics(page)
  await screenshot(page, info, 'a11y-inbox')
})

test('Persetujuan keyboard-only: focus trap native dialog dan return focus', async ({ page }, info) => {
  await login(page)
  await newChangeUi(page)
  await confirmUi(page)
  const choose = page.getByRole('button', { name: 'Pilih opsi ini', exact: true }).first()
  await keyboardFocus(page, choose)
  await visibleFocus(choose)
  await page.keyboard.press('Enter')
  const opener = page.getByRole('button', { name: 'Setujui opsi terpilih', exact: true })
  await keyboardFocus(page, opener)
  await visibleFocus(opener)
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Setujui perubahan rundown' })
  await expect(dialog).toBeVisible()
  for (const direction of ['Tab', 'Shift+Tab']) for (let count = 0; count < 10; count++) {
    await page.keyboard.press(direction)
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBeTruthy()
  }
  const reason = dialog.getByLabel('Alasan persetujuan', { exact: true })
  await keyboardFocus(page, reason)
  await visibleFocus(reason)
  await page.keyboard.type('Panel ditukar setelah koordinasi seluruh peran')
  await screenshot(page, info, 'a11y-approve-keyboard-dialog')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await visibleFocus(opener)
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await keyboardFocus(page, reason)
  await page.keyboard.type('Keputusan setelah konfirmasi ulang lapangan')
  const commit = dialog.getByRole('button', { name: 'Setujui dan kirim brief', exact: true })
  await keyboardFocus(page, commit)
  await visibleFocus(commit)
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Disetujui sebagai v2 · 5 brief terkirim/)).toBeVisible()
})
