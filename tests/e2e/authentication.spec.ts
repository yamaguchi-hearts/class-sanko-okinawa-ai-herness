import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test.setTimeout(300_000)
test('first setup, restart login, STAFF code setup and Main authorization', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'inventory-auth-e2e-'))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  delete env.ELECTRON_RUN_AS_NODE
  let app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env })
  try {
    let window = await app.firstWindow()
    await window.getByLabel('店舗名').fill('E2E店舗')
    await window.getByLabel('管理者表示名').fill('管理責任者')
    await window.getByLabel('ログインID').fill('admin')
    await window.getByLabel('パスワード（12〜128文字）').fill('admin e2e passphrase')
    await window.getByLabel('パスワード（確認）').fill('admin e2e passphrase')
    await window.getByRole('button', { name: '初期設定を完了' }).click()
    await expect(window.getByRole('heading', { name: '認証・ユーザー基盤' })).toBeVisible()
    await app.close()

    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env })
    window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: '沖縄店舗在庫管理' })).toBeVisible()
    const anonymous = await window.evaluate(async () => (window as any).storeApp.users.list())
    expect(anonymous).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
    await window.getByLabel('ログインID').fill('admin')
    await window.getByLabel('パスワード', { exact: true }).fill('admin e2e passphrase')
    await window.getByRole('button', { name: 'ログイン' }).click()
    await expect(window.getByRole('heading', { name: '認証・ユーザー基盤' })).toBeVisible()
    await window.getByLabel('ログインID', { exact: true }).fill('staff')
    await window.getByLabel('表示名').fill('店舗担当')
    await window.getByRole('button', { name: 'ユーザー作成・コード発行' }).click()
    const message = await window.locator('.notice').innerText()
    const code = message.match(/コード: ([A-Za-z0-9_-]+)/)?.[1]
    expect(code).toBeTruthy()
    await window.getByRole('button', { name: 'ログアウト' }).click()
    await window.getByRole('button', { name: '再設定コードを使う' }).click()
    await window.getByLabel('ログインID', { exact: true }).fill('staff')
    await window.getByLabel('再設定コード').fill(code!)
    await window.getByRole('button', { name: 'コードを確認' }).click()
    await expect(window.getByRole('heading', { name: '新しいパスワード' })).toBeVisible()
    await window.getByLabel('新しいパスワード').fill('staff first passphrase')
    await window.getByLabel('確認入力').fill('staff first passphrase')
    await window.getByRole('button', { name: 'パスワードを設定' }).click()
    await window.getByLabel('ログインID', { exact: true }).fill('staff')
    await window.getByLabel('パスワード', { exact: true }).fill('staff first passphrase')
    await window.getByRole('button', { name: 'ログイン' }).click()
    await expect(window.getByText('店舗担当（STAFF）')).toBeVisible()
    const denied = await window.evaluate(async () => (window as any).storeApp.users.list())
    expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
