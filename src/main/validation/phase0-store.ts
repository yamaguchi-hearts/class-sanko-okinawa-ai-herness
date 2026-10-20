import { app } from 'electron'
import Database from 'better-sqlite3'
import argon2 from 'argon2'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export const phase0Argon2Options = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32
})

export async function verifyPhase0Persistence(): Promise<{ elapsedMs: number; row: string }> {
  const directory = join(app.getPath('userData'), 'phase0-validation')
  await mkdir(directory, { recursive: true })
  const database = new Database(join(directory, 'persistence.sqlite'))
  try {
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    database.exec('CREATE TABLE IF NOT EXISTS validation (key TEXT PRIMARY KEY, value TEXT NOT NULL, hash TEXT NOT NULL)')
    const row = database.prepare('SELECT key, value, hash FROM validation WHERE key = ?').get('restart-check') as { key: string; value: string; hash: string } | undefined
    if (!row) {
      const started = performance.now()
      const hash = await argon2.hash('phase0-validation-only', phase0Argon2Options)
      const elapsedMs = performance.now() - started
      database.prepare('INSERT INTO validation (key, value, hash) VALUES (?, ?, ?)').run('restart-check', 'persisted', hash)
      return { elapsedMs, row: 'created' }
    }
    const started = performance.now()
    const verified = await argon2.verify(row.hash, 'phase0-validation-only')
    const elapsedMs = performance.now() - started
    if (!verified || row.value !== 'persisted') throw new Error('Phase 0 persistence verification failed')
    return { elapsedMs, row: 'reloaded-and-verified' }
  } finally {
    database.close()
  }
}
