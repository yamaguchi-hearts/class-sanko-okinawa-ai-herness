import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const electronPackagePath = createRequire(import.meta.url).resolve('electron/package.json')
const electronPackage = JSON.parse(readFileSync(electronPackagePath, 'utf8'))
const electronDirectory = dirname(electronPackagePath)
const version = electronPackage.version
const distDirectory = join(electronDirectory, 'dist')
const executablePath = join(distDirectory, 'electron.exe')
const packageRequire = createRequire(electronPackagePath)

if (process.platform !== 'win32' || process.arch !== 'x64') {
  packageRequire('electron')
} else {
  const isInstalled = existsSync(executablePath)
    && existsSync(join(distDirectory, 'version'))
    && readFileSync(join(distDirectory, 'version'), 'utf8').replace(/^v/, '') === version
    && readFileSync(join(electronDirectory, 'path.txt'), 'utf8') === 'electron.exe'

  if (!isInstalled) {
    const { downloadArtifact } = packageRequire('@electron/get')
    const checksums = JSON.parse(readFileSync(join(electronDirectory, 'checksums.json'), 'utf8'))
    const archivePath = await downloadArtifact({
      version,
      artifactName: 'electron',
      platform: 'win32',
      arch: 'x64',
      checksums
    })

    mkdirSync(distDirectory, { recursive: true })
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$ErrorActionPreference = \'Stop\'; Expand-Archive -LiteralPath $env:ELECTRON_DEMO_ARCHIVE -DestinationPath $env:ELECTRON_DEMO_DIST -Force'
    ], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ELECTRON_DEMO_ARCHIVE: resolve(archivePath),
        ELECTRON_DEMO_DIST: resolve(distDirectory)
      }
    })

    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Electron ZIP展開に失敗しました (exit ${result.status})`)
    if (!existsSync(executablePath)) throw new Error('展開後にelectron.exeが見つかりません。')

    writeFileSync(join(distDirectory, 'version'), `v${version}`)
    writeFileSync(join(electronDirectory, 'path.txt'), 'electron.exe')
  }
}
