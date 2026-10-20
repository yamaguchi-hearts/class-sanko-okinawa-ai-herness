import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = resolve(root, 'release')
const evidenceDir = resolve(releaseDir, 'evidence')

function command(file, args) {
  return execFileSync(file, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function git(args) { return command('git', args) }

function pnpmVersion() {
  for (const executable of process.platform === 'win32' ? ['pnpm.cmd', 'corepack.cmd'] : ['pnpm', 'corepack']) {
    try { return executable.startsWith('corepack') ? command(executable, ['pnpm', '--version']) : command(executable, ['--version']) } catch { /* try the next fixed entry point */ }
  }
  return '未取得'
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function artifacts(directory, entries = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) artifacts(path, entries)
    else if (entry.name.toLowerCase().endsWith('.exe') && !relative(releaseDir, path).split('\\').includes('win-unpacked') && !relative(releaseDir, path).split('/').includes('win-unpacked')) {
      entries.push({ path: relative(root, path).replaceAll('\\', '/'), size: statSync(path).size, sha256: sha256(path) })
    }
  }
  return entries
}

const commit = git(['rev-parse', 'HEAD'])
const branch = git(['branch', '--show-current'])
const clean = git(['status', '--porcelain']) === ''
const lockfilePath = resolve(root, 'pnpm-lock.yaml')
const lockfileSha256 = sha256(lockfilePath)
const record = {
  generatedAt: new Date().toISOString(),
  commit,
  branch,
  clean,
  node: process.version,
  pnpm: pnpmVersion(),
  lockfile: { path: 'pnpm-lock.yaml', sha256: lockfileSha256 },
  artifacts: releaseDir && statSync(releaseDir, { throwIfNoEntry: false }) ? artifacts(releaseDir) : []
}

mkdirSync(evidenceDir, { recursive: true })
const output = resolve(evidenceDir, `${record.generatedAt.replaceAll(':', '').replaceAll('.', '')}-${commit.slice(0, 12)}.json`)
writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
console.log(`証跡を作成しました: ${relative(root, output).replaceAll('\\', '/')}`)
if (!record.clean) process.exitCode = 2
