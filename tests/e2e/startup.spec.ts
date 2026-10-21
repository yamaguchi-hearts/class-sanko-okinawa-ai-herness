import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('opens a sandboxed renderer with no Node integration', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'inventory-e2e-'))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, `--app-data-dir=${userData}`], env })
  let startupLogs = ''
  app.process().stderr?.on('data', (chunk: Buffer) => { startupLogs += chunk.toString() })
  try {
    const window = await app.firstWindow()
    try {
      await expect(window.getByRole('heading', { name: '初期セットアップ' })).toBeVisible()
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nMain process output:\n${startupLogs}`)
    }
    expect(await window.evaluate(() => ({ process: typeof process, require: typeof require }))).toEqual({ process: 'undefined', require: 'undefined' })
    const csp = await window.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("img-src 'self' data:")
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
})
