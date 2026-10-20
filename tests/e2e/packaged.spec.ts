import { test, expect, _electron as electron } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { tinyPng } from '../fixtures/tiny-png'

test('packaged Windows app persists SQLite and verifies Argon2id after restart', async () => {
  test.setTimeout(300_000)
  const userProfile = await mkdtemp(join(tmpdir(), 'inventory-packaged-'))
  const installDirectory = join(userProfile, 'install')
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }
  const installer = join(process.cwd(), 'release', `沖縄店舗在庫管理-${packageJson.version}-win-x64.exe`)
  let installed = false
  const executable = join(installDirectory, '沖縄店舗在庫管理.exe')
  const userData = join(userProfile, 'userData')
  const resultFile = join(userData, 'phase0-validation', 'result.json')
  let imageProductId: string
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const install = spawnSync(installer, ['/S', `/D=${installDirectory}`], { env, encoding: 'utf8', timeout: 120_000 })
    expect(install.error, install.error?.message).toBeUndefined()
    expect(install.status, install.stderr).toBe(0)
    installed = true
    for (const expectedRow of ['created', 'reloaded-and-verified']) {
      const run = spawnSync(executable, ['--phase0-verify', `--phase0-user-data-dir=${userData}`], { env, encoding: 'utf8', timeout: 30_000 })
      expect(run.error, run.error?.message).toBeUndefined()
      expect(run.status, run.stderr).toBe(0)
      const result = JSON.parse(await readFile(resultFile, 'utf8')) as { row: string; argon2idMs: number }
      expect(result.row).toBe(expectedRow)
      expect(result.argon2idMs).toBeGreaterThan(0)
    }
    const launchOptions = { executablePath: executable, args: [`--user-data-dir=${userData}`], env }
    let packagedApp = await electron.launch(launchOptions)
    let window = await packagedApp.firstWindow()
    await window.getByLabel('店舗名').fill('パッケージ検証店舗')
    await window.getByLabel('管理者表示名').fill('配布ADMIN')
    await window.getByLabel('ログインID').fill('packaged-admin')
    await window.getByLabel('パスワード（4〜128文字）').fill('demo')
    await window.getByLabel('パスワード（確認）').fill('demo')
    await window.getByRole('button', { name: '初期設定を完了' }).click()
    await expect(window.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible()
    const product = await window.evaluate(async () => globalThis.window.storeApp.products.create({ sku: 'PACKAGED-IMAGE', name: '配布画像商品', categoryId: null, unit: '個', reorderLevel: 0, note: null, initialStock: 3, imageSelectionId: null }))
    if (!product.ok) throw new Error('Packaged image fixture product could not be created')
    imageProductId = product.value.id
    await packagedApp.close()
    const imageDb = new Database(join(userData, 'store-inventory.sqlite'))
    try {
      imageDb.prepare("INSERT INTO product_images(product_id,content,mime_type,width,height,updated_at) VALUES(?,?,'image/png',1,1,?)")
        .run(imageProductId, tinyPng, new Date().toISOString())
    } finally { imageDb.close() }
    packagedApp = await electron.launch(launchOptions)
    window = await packagedApp.firstWindow()
    await window.getByLabel('ログインID').fill('packaged-admin')
    await window.getByLabel('パスワード', { exact: true }).fill('demo')
    await window.getByRole('button', { name: 'ログイン' }).click()
    await expect(window.getByText('配布ADMIN（ADMIN）')).toBeVisible()
    await window.getByRole('button', { name: '商品一覧' }).click()
    const image = window.getByRole('button', { name: '配布画像商品の商品画像を拡大表示' }).locator('img')
    await expect(image).toBeVisible()
    await expect(image).toHaveJSProperty('naturalWidth', 1)
    await packagedApp.close()
    const uninstall = spawnSync(join(installDirectory, 'Uninstall 沖縄店舗在庫管理.exe'), ['/currentuser', '/S'], { env, encoding: 'utf8', timeout: 60_000 })
    expect(uninstall.error, uninstall.error?.message).toBeUndefined()
    expect(uninstall.status, uninstall.stderr).toBe(0)
    installed = false
  } finally {
    if (installed) spawnSync(join(installDirectory, 'Uninstall 沖縄店舗在庫管理.exe'), ['/currentuser', '/S'], { env, timeout: 60_000 })
    await rm(userProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  }
})
