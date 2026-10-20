import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { ESLint } from 'eslint'

const eslint = new ESLint()
const rendererPath = 'src/renderer/lint-probe.tsx'

async function ruleIds(source) {
  const [result] = await eslint.lintText(source, { filePath: rendererPath })
  assert.equal(result.fatalErrorCount, 0)
  return result.messages.map((message) => message.ruleId)
}

test('valid typed React code passes', async () => {
  assert.deepEqual(await ruleIds('export function App() { const title: string = "Inventory"; return <h1>{title}</h1> }'), [])
})

test('conditional Hooks and missing effect dependencies are rejected', async () => {
  assert.ok((await ruleIds('import { useState } from "react"; export function App({ active }: { active: boolean }) { if (active) { useState(0) } return null }')).includes('react-hooks/rules-of-hooks'))
  assert.ok((await ruleIds('import { useEffect } from "react"; export function App({ value }: { value: string }) { useEffect(() => { console.log(value) }, []); return null }')).includes('react-hooks/exhaustive-deps'))
})

test('Renderer cannot import privileged modules at any relative depth', async () => {
  for (const moduleName of ['node:fs', 'electron', 'electron/main', 'better-sqlite3', 'argon2', '../main/services/audit', '../../../main/auth/service', '../recovery/index']) {
    assert.ok((await ruleIds(`import * as forbidden from '${moduleName}'; console.log(forbidden)`)).includes('no-restricted-imports'), moduleName)
  }
})

test('browser and Node globals remain separated', async () => {
  const renderer = await eslint.calculateConfigForFile(rendererPath)
  const main = await eslint.calculateConfigForFile('src/main/index.ts')
  assert.equal(renderer.languageOptions.globals.process, undefined)
  assert.equal(renderer.languageOptions.globals.require, undefined)
  assert.notEqual(renderer.languageOptions.globals.window, undefined)
  assert.notEqual(main.languageOptions.globals.process, undefined)
  assert.equal(main.languageOptions.globals.window, undefined)
})

test('dependencies and generated outputs are ignored', async () => {
  for (const directory of ['node_modules', 'out', 'release', 'coverage', 'test-results', 'playwright-report']) {
    assert.equal(await eslint.isPathIgnored(`${directory}/lint-probe.ts`), true, directory)
  }
})

test('CLI exits nonzero on forbidden imports and succeeds on valid code', () => {
  const require = createRequire(import.meta.url)
  const cli = join(dirname(require.resolve('eslint/package.json')), 'bin/eslint.js')
  const args = [cli, '--stdin', '--stdin-filename', rendererPath, '--max-warnings', '0']
  const valid = spawnSync(process.execPath, args, { input: 'export const value: number = 1', encoding: 'utf8' })
  assert.equal(valid.status, 0, valid.stdout + valid.stderr)
  const invalid = spawnSync(process.execPath, args, { input: 'import fs from "node:fs"; console.log(fs)', encoding: 'utf8' })
  assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr)
  assert.match(invalid.stdout, /no-restricted-imports/)
})