import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import argon2 from 'argon2'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let directory = ''
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })

describe('SQLite and Argon2id native modules', () => {
  it('writes, closes, reopens and verifies a password hash', async () => {
    directory = mkdtempSync(join(tmpdir(), 'inventory-phase0-'))
    const file = join(directory, 'smoke.sqlite')
    const db = new Database(file)
    db.exec('CREATE TABLE check_data (value TEXT NOT NULL)')
    db.prepare('INSERT INTO check_data VALUES (?)').run('persistent')
    db.close()
    const reopened = new Database(file)
    expect((reopened.prepare('SELECT value FROM check_data').get() as { value: string }).value).toBe('persistent')
    reopened.close()
    const hash = await argon2.hash('test-only-secret', { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 4 })
    expect(await argon2.verify(hash, 'test-only-secret')).toBe(true)
    expect(await argon2.verify(hash, 'wrong-secret')).toBe(false)
  })
})
