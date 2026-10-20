import Database from 'better-sqlite3'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { migrations } from './migrations'
import { randomUUID } from 'node:crypto'

export type StoreDatabase = Database.Database

export function openStoreDatabase(filePath: string): StoreDatabase {
  mkdirSync(dirname(filePath), { recursive: true })
  const db = new Database(filePath)
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const current = Number((db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number }).version)
  const latest = migrations.at(-1)?.version ?? 0
  if (current > latest) {
    db.close()
    throw new Error(`DATABASE_FUTURE_VERSION:${current}`)
  }
  try {
    for (const migration of migrations.filter(({ version }) => version > current)) {
      db.transaction(() => {
        migration.up(db)
        db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString())
      }).immediate()
    }
  } catch (error) {
    db.close()
    throw error
  }
  const appType = db.prepare("SELECT value FROM app_meta WHERE key='app_type'").get() as { value: string } | undefined
  if (appType && appType.value !== 'jp.co.sanko-okinawa.store-inventory') {
    db.close()
    throw new Error('DATABASE_WRONG_APPLICATION')
  }
  db.prepare("INSERT OR IGNORE INTO app_meta(key,value) VALUES ('app_type','jp.co.sanko-okinawa.store-inventory')").run()
  db.prepare("INSERT OR IGNORE INTO app_meta(key,value) VALUES ('installation_id',?)").run(randomUUID())
  return db
}
