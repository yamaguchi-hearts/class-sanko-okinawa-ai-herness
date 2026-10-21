import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
    const extractZip = createRequire(import.meta.url)('extract-zip')
    const checksums = JSON.parse(readFileSync(join(electronDirectory, 'checksums.json'), 'utf8'))
    const archivePath = await downloadArtifact({
      version,
      artifactName: 'electron',
      platform: 'win32',
      arch: 'x64',
      checksums
    })

    mkdirSync(distDirectory, { recursive: true })
    await extractZip(archivePath, { dir: distDirectory })
    if (!existsSync(executablePath)) throw new Error('展開後にelectron.exeが見つかりません。')

    writeFileSync(join(distDirectory, 'version'), `v${version}`)
    writeFileSync(join(electronDirectory, 'path.txt'), 'electron.exe')
  }
}
