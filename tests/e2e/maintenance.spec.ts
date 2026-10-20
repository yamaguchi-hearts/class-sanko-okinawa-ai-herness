import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('ADMIN manages idle-lock settings from the sandboxed app and reads its database path', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'inventory-maintenance-e2e-'))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env })
  try {
    const window = await app.firstWindow()
    await window.getByLabel('店舗名').fill('設定E2E店')
    await window.getByLabel('管理者表示名').fill('設定管理者')
    await window.getByLabel('ログインID').fill('settings-admin')
    await window.getByLabel('パスワード（4〜128文字）').fill('settings e2e passphrase')
    await window.getByLabel('パスワード（確認）').fill('settings e2e passphrase')
    await window.getByRole('button', { name: '初期設定を完了' }).click()
    await window.getByRole('button', { name: '設定', exact: true }).click()
    await expect(window.getByRole('heading', { name: '店舗設定' })).toBeVisible()
    await expect(window.getByText(/store-inventory\.sqlite/)).toBeVisible()
    await window.getByLabel('無操作ロック（分）').fill('3')
    await window.getByRole('button', { name: '設定を保存' }).click()
    await expect(window.getByRole('status')).toContainText('設定を保存しました')
    const saved = await window.evaluate(async () => (window as any).storeApp.settings.get())
    expect(saved).toMatchObject({ ok: true, value: { storeName: '設定E2E店', idleLockMinutes: 3 } })
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 5 })
  }
})
