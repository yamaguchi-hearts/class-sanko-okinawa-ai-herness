import { app, BrowserWindow, session } from 'electron'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import lockfile from 'proper-lockfile'
import { verifyPhase0Persistence } from './validation/phase0-store'

const appId = 'jp.co.sanko-okinawa.store-inventory'
app.setName('沖縄店舗在庫管理')
app.setAppUserModelId(appId)
const verificationMode = process.argv.includes('--phase0-verify')
const verificationDataArg = process.argv.find((argument) => argument.startsWith('--phase0-user-data-dir='))
const userDataArg = process.argv.find((argument) => argument.startsWith('--user-data-dir='))
const selectedDataArg = verificationMode ? verificationDataArg ?? userDataArg : userDataArg
if (selectedDataArg) {
  const selectedUserData = resolve(selectedDataArg.slice(selectedDataArg.indexOf('=') + 1))
  mkdirSync(selectedUserData, { recursive: true })
  app.setPath('userData', selectedUserData)
}
const allowedDevUrl = 'http://127.0.0.1:5173/'
let releaseDataLock: (() => Promise<void>) | undefined
let finishingQuit = false

function isAllowedAppUrl(rawUrl: string): boolean {
  if (app.isPackaged) return rawUrl === pathToFileURL(resolve(__dirname, '../renderer/index.html')).href
  return rawUrl === allowedDevUrl
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url)) event.preventDefault()
  })
  if (app.isPackaged) await window.loadFile(resolve(__dirname, '../renderer/index.html'))
  else await window.loadURL(allowedDevUrl)
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

app.on('before-quit', (event) => {
  if (finishingQuit || !releaseDataLock) return
  event.preventDefault()
  finishingQuit = true
  void releaseDataLock().finally(() => app.quit())
})

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [`default-src 'self'; script-src 'self'; style-src 'self'${app.isPackaged ? '' : " 'unsafe-inline'"}; img-src 'self' data:; connect-src 'self'${app.isPackaged ? '' : ' http://127.0.0.1:5173 ws://127.0.0.1:5173'}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`]
      }
    })
  })
  const userData = app.getPath('userData')
  releaseDataLock = await lockfile.lock(userData, { realpath: false, retries: 0, stale: 15_000, update: 5_000 })
  if (verificationMode) {
    const result = await verifyPhase0Persistence()
    const resultPath = resolve(userData, 'phase0-validation', 'result.json')
    await writeFile(resultPath, JSON.stringify({ ...result, argon2idMs: Math.round(result.elapsedMs) }, null, 2), 'utf8')
    console.log(JSON.stringify({ phase0: result.row, argon2idMs: Math.round(result.elapsedMs) }))
    app.quit()
    return
  }
  await createWindow()
}).catch((error: unknown) => {
  console.error('Application startup failed:', error instanceof Error ? error.message : 'unknown error')
  app.exit(1)
})
