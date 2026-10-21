import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config vite.renderer.config.mts',
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
})
