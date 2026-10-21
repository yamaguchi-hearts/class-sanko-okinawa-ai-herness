import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electronVitePackage = require.resolve('electron-vite/package.json')
const electronVite = require(electronVitePackage)
const cliPath = join(dirname(electronVitePackage), electronVite.bin['electron-vite'])
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [cliPath, 'dev'], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
  windowsHide: true
})

child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1)
})
