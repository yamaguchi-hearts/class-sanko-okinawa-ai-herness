import Database from 'better-sqlite3'
import { randomUUID, createHash } from 'node:crypto'
import { copyFile, mkdir, rename, rm, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync, copyFileSync, createReadStream, createWriteStream, openSync, fsyncSync, closeSync, renameSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import type { ProductListQuery, Role, AppSettings, BackupCandidate } from '../../shared/contracts'
import { openStoreDatabase, type StoreDatabase } from '../db/connection'
import { CatalogRepository } from '../db/repositories/catalog'
import { AuthService, AppError } from '../auth/service'
import { audit, type AuditActor } from './audit'

const APP_ID = 'jp.co.sanko-okinawa.store-inventory'
const CSV_HEADERS = ['SKU', '商品名', 'カテゴリ', '現在庫', '最低在庫数', '単位', '状態', 'メモ'] as const
const SAFE_ID = /^[a-z0-9-]{16,80}$/i
function quote(value: string): string { return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value }
async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
export function safeCsvText(value: string): string {
  // eslint-disable-next-line no-control-regex -- CSV formula protection deliberately checks leading control characters.
  const unsafe = /^[\u0000-\u0020\u007f]+[=+\-@]/.test(value) || /^[=+\-@]/.test(value) || /^[\u0000-\u001f\u007f]/.test(value)
  return quote(unsafe ? `'${value}` : value)
}

type Actor = AuditActor
export class MaintenanceService {
  private readonly catalog: CatalogRepository
  private candidates = new Map<string, { path: string; sha256: string; info: BackupCandidate }>()
  constructor(private readonly db: StoreDatabase, private readonly auth: AuthService, private readonly dataDir: string, private readonly dbPath: string) { this.catalog = new CatalogRepository(db) }
  private actor(token: string, senderId: number): Actor {
    this.auth.canUseProtected(token, senderId, 'ADMIN')
    const s = this.auth.getSession(senderId)
    if (!s || s.state !== 'AUTHENTICATED' || s.user.role !== 'ADMIN') throw new AppError('FORBIDDEN')
    return { id: s.user.id, loginName: s.user.loginName, displayName: s.user.displayName, role: 'ADMIN' }
  }
  private auditFailure(action: string, actor: Actor, details: Record<string, string | number | boolean | null> = {}): void {
    try { this.db.transaction(() => audit(this.db, action, actor, 'database', null, details)).immediate() } catch { /* The underlying failure takes precedence; never claim the operation succeeded. */ }
  }
  private getSettings(): Omit<AppSettings, 'databasePath'> {
    const storeName = (this.db.prepare("SELECT value FROM app_meta WHERE key='store_name'").get() as { value: string } | undefined)?.value ?? ''
    const idleLockMinutes = Number((this.db.prepare("SELECT value FROM app_settings WHERE key='idle_lock_minutes'").get() as { value: string } | undefined)?.value ?? '15')
    return { storeName, idleLockMinutes }
  }
  readSettings(token: string, senderId: number): AppSettings {
    this.actor(token, senderId)
    return { ...this.getSettings(), databasePath: this.dbPath }
  }
  updateSettings(token: string, senderId: number, raw: unknown): AppSettings {
    const actor = this.actor(token, senderId)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'idleLockMinutes,storeName') throw new AppError('VALIDATION_ERROR')
    const value = raw as { idleLockMinutes: unknown; storeName: unknown }
    if (typeof value.storeName !== 'string' || value.storeName.trim().length < 1 || value.storeName.trim().length > 100 || typeof value.idleLockMinutes !== 'number' || !Number.isInteger(value.idleLockMinutes) || value.idleLockMinutes < 1 || value.idleLockMinutes > 60) throw new AppError('VALIDATION_ERROR')
    const old = this.getSettings(), name = (value.storeName as string).trim(), idleMinutes = value.idleLockMinutes as number, now = new Date().toISOString()
    this.db.transaction(() => {
      this.db.prepare("UPDATE app_meta SET value=? WHERE key='store_name'").run(name)
      this.db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES('store_name',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(name, now)
      this.db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES('idle_lock_minutes',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(String(idleMinutes), now)
      audit(this.db, 'SETTINGS_UPDATED', actor, 'settings', null, { oldStoreName: old.storeName, storeName: name, oldIdleLockMinutes: old.idleLockMinutes, idleLockMinutes: idleMinutes })
    }).immediate()
    this.auth.recheckIdleSessions()
    return { storeName: name, idleLockMinutes: idleMinutes, databasePath: this.dbPath }
  }
  async exportProducts(token: string, senderId: number, query: ProductListQuery, targetPath: string): Promise<{ count: number; path: string }> {
    this.auth.canUseProtected(token, senderId)
    const target = resolve(targetPath), tmp = `${target}.${randomUUID()}.tmp`, snapshotPath = join(this.dataDir, `.csv-snapshot-${randomUUID()}.sqlite`)
    let snapshot: Database.Database | null = null
    let outputStream: ReturnType<typeof createWriteStream> | null = null
    try {
      await this.db.backup(snapshotPath)
      snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true })
      const repository = new CatalogRepository(snapshot)
      const first = repository.listProducts({ ...query, page: 1, pageSize: 200 })
      const stream = outputStream = createWriteStream(tmp, { flags: 'wx', encoding: 'utf8' })
      const write = async (line: string) => { if (!stream.write(line)) await once(stream, 'drain') }
      await write(`\uFEFF${CSV_HEADERS.map(safeCsvText).join(',')}\r\n`)
      let count = 0
      for (let page = 1; page <= Math.max(1, Math.ceil(first.total / 200)); page++) {
        const currentPage = page === 1 ? first : repository.listProducts({ ...query, page, pageSize: 200 })
        for (const product of currentPage.items) {
          const cells = [product.sku, product.name, product.categoryName ?? '', String(product.currentStock), String(product.reorderLevel), product.unit, product.isActive ? '有効' : '無効', product.note ?? '']
          await write(`${cells.map((value, index) => index === 3 || index === 4 ? value : safeCsvText(value)).join(',')}\r\n`)
          count++
        }
      }
      stream.end()
      await finished(stream)
      const fd = openSync(tmp, 'r+')
      try { fsyncSync(fd) } finally { closeSync(fd) }
      snapshot.close(); snapshot = null
      await rm(snapshotPath, { force: true })
      const current = this.actorFromSession(token, senderId)
      const previous = `${target}.${randomUUID()}.previous`, hadPrevious = existsSync(target)
      if (hadPrevious) renameSync(target, previous)
      let installed = false
      try {
        this.db.transaction(() => {
          renameSync(tmp, target); installed = true
          audit(this.db, 'PRODUCTS_CSV_EXPORTED', current, 'product', null, { count, search: query.search, status: query.status, categoryId: query.categoryId, stockFilter: query.stockFilter, sortKey: query.sortKey, direction: query.direction })
        }).immediate()
        if (hadPrevious) { try { rmSync(previous, { force: true }) } catch { /* orphaned previous output is safe to clean up later */ } }
      } catch (error) {
        if (installed) rmSync(target, { force: true })
        if (hadPrevious && existsSync(previous)) renameSync(previous, target)
        throw error
      }
      return { count, path: basename(target) }
    } catch (error) {
      if (outputStream && !outputStream.destroyed) outputStream.destroy()
      if (outputStream) await finished(outputStream).catch(() => undefined)
      try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
      try { this.auditFailure('PRODUCTS_CSV_EXPORT_FAILED', this.actorFromSession(token, senderId), { reason: 'file_or_audit_failure' }) } catch { /* session may have expired during a long export */ }
      throw error
    }
    finally { snapshot?.close(); await rm(snapshotPath, { force: true }).catch(() => undefined) }
  }
  private actorFromSession(token: string, senderId: number): Actor {
    this.auth.canUseProtected(token, senderId)
    const s = this.auth.getSession(senderId)
    if (!s || s.state !== 'AUTHENTICATED') throw new AppError('AUTH_REQUIRED')
    return { id: s.user.id, loginName: s.user.loginName, displayName: s.user.displayName, role: s.user.role }
  }
  recordDialogCancelled(token: string, senderId: number, action: 'CSV_EXPORT_CANCELLED' | 'BACKUP_CANCELLED' | 'RESTORE_CANCELLED'): void {
    const actor = this.actorFromSession(token, senderId)
    if (action !== 'CSV_EXPORT_CANCELLED' && actor.role !== 'ADMIN') throw new AppError('FORBIDDEN')
    this.db.transaction(() => audit(this.db, action, actor, 'database', null)).immediate()
  }
  async createBackup(token: string, senderId: number, targetPath: string): Promise<{ backupId: string; path: string; schemaVersion: number }> {
    const actor = this.actor(token, senderId)
    const target = resolve(targetPath), tmp = `${target}.${randomUUID()}.tmp`, backupId = randomUUID()
    try {
      await this.db.backup(tmp)
      const createdAt = new Date().toISOString()
      const metadata = new Database(tmp)
      try {
        metadata.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('backup_id',?)").run(backupId)
        metadata.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('backup_created_at',?)").run(createdAt)
      } finally { metadata.close() }
      const check = new Database(tmp, { readonly: true, fileMustExist: true })
      try { this.validateDb(check) } finally { check.close() }
      const schemaVersion = this.schemaVersion(this.db)
      const previous = `${target}.${randomUUID()}.previous`, hadPrevious = existsSync(target)
      if (hadPrevious) await rename(target, previous)
      let installed = false
      try {
        this.db.transaction(() => {
          renameSync(tmp, target); installed = true
          audit(this.db, 'DATABASE_BACKUP_CREATED', actor, 'backup', backupId, { schemaVersion })
        }).immediate()
        if (hadPrevious) await rm(previous, { force: true }).catch(() => undefined)
      } catch (error) {
        if (installed) await rm(target, { force: true })
        if (hadPrevious && existsSync(previous)) await rename(previous, target)
        throw error
      }
      return { backupId, path: basename(target), schemaVersion }
    } catch { await rm(tmp, { force: true }).catch(() => undefined); this.auditFailure('DATABASE_BACKUP_FAILED', actor, { backupId, reason: 'file_or_audit_failure' }); throw new AppError('BACKUP_FAILED') }
  }
  async inspectRestoreCandidate(token: string, senderId: number, candidatePath: string): Promise<BackupCandidate> {
    const actor = this.actor(token, senderId)
    for (const prior of this.candidates.values()) { try { rmSync(prior.path, { force: true }) } catch { /* stale candidate is not selected anymore */ } }
    this.candidates.clear()
    const source = resolve(candidatePath), id = randomUUID(), copy = join(this.dataDir, `.restore-candidate-${id}.sqlite`)
    try {
      await copyFile(source, copy)
      const candidate = new Database(copy)
      let createdAt: string | null
      try {
        const rawVersion = this.schemaVersion(candidate)
        const appType = candidate.prepare("SELECT value FROM app_meta WHERE key='app_type'").get() as {value:string}|undefined
        const integrity = candidate.pragma('integrity_check') as Array<{integrity_check:string}>
        if (appType?.value !== APP_ID || rawVersion > 5 || integrity[0]?.integrity_check !== 'ok') throw new Error('incompatible backup')
        createdAt = (candidate.prepare("SELECT value AS created FROM app_meta WHERE key='backup_created_at'").get() as { created: string } | undefined)?.created ?? (candidate.prepare('SELECT MIN(applied_at) AS created FROM schema_migrations').get() as { created: string | null }).created
      } finally { candidate.close() }
      const migrated = openStoreDatabase(copy)
      try {
        this.validateDb(migrated)
        const storeName = (migrated.prepare("SELECT value FROM app_meta WHERE key='store_name'").get() as { value: string } | undefined)?.value ?? ''
        const info: BackupCandidate = { candidateId: id, storeName, createdAt, schemaVersion: this.schemaVersion(migrated), userCount: Number((migrated.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n), productCount: Number((migrated.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n) }
        this.candidates.set(id, { path: copy, sha256: await sha256File(copy), info })
        return info
      } finally { migrated.close() }
    } catch { try { rmSync(copy, { force: true }) } catch { /* noop */ }; this.auditFailure('BACKUP_CANDIDATE_REJECTED', actor, { reason: 'invalid_candidate' }); throw new AppError('BACKUP_INVALID') }
  }
  async applyRestore(token: string, senderId: number, candidateId: string, confirmation: string, password: string, reauthenticate: (token: string, senderId: number, password: string) => Promise<void>, restart: () => void): Promise<{ backupPath: string }> {
    const actor = this.actor(token, senderId)
    await reauthenticate(token, senderId, password)
    const selected = this.candidates.get(candidateId)
    if (!selected || !SAFE_ID.test(candidateId) || confirmation !== selected.info.storeName) throw new AppError('VALIDATION_ERROR')
    const digest = await sha256File(selected.path)
    if (digest !== selected.sha256) throw new AppError('BACKUP_INVALID')
    const backupDir = join(this.dataDir, 'backups')
    await mkdir(backupDir, { recursive: true })
    const id = randomUUID(), preBackup = join(backupDir, `before-restore-${id}.sqlite3`), tmpBackup = `${preBackup}.tmp`
    await this.db.backup(tmpBackup)
    const backupDb = new Database(tmpBackup, { readonly: true, fileMustExist: true })
    try { this.validateDb(backupDb) } finally { backupDb.close() }
    await rename(tmpBackup, preBackup)
    const original = `${this.dbPath}.pre-restore-${id}`
    const markerPath = join(this.dataDir, 'restore-state.json')
    const marker = { id, phase: 'PREPARED', original, preBackup, candidate: selected.path, dbPath: this.dbPath }
    const writeMarker = async (phase: string) => {
      const next = JSON.stringify({ ...marker, phase })
      const pending = `${markerPath}.tmp`; await writeFile(pending, next, { flag: 'w' }); await rename(pending, markerPath)
    }
    try {
      await writeMarker('PREPARED')
      this.db.pragma('wal_checkpoint(TRUNCATE)')
      this.db.close()
      for (const suffix of ['-wal', '-shm']) await rm(`${this.dbPath}${suffix}`, { force: true })
      await rename(this.dbPath, original)
      await writeMarker('ORIGINAL_RENAMED')
      await rename(selected.path, this.dbPath)
      await writeMarker('CANDIDATE_INSTALLED')
      const restored = new Database(this.dbPath)
      try {
        this.validateDb(restored)
        restored.pragma('foreign_keys = ON')
        const restoredActor = restored.prepare('SELECT id,login_name,display_name,role FROM users WHERE id=?').get(actor.id) as {id:string;login_name:string;display_name:string;role:Role}|undefined
        const at = new Date().toISOString()
        restored.transaction(() => {
          restored.prepare('UPDATE password_reset_codes SET revoked_at=? WHERE consumed_at IS NULL AND revoked_at IS NULL').run(at)
          restored.prepare(`INSERT INTO audit_logs(id,actor_user_id,actor_login_snapshot,actor_name_snapshot,actor_role_snapshot,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,'BACKUP_RESTORED','database',?,?,?)`)
            .run(randomUUID(), restoredActor?.id ?? null, actor.loginName, actor.displayName, actor.role, id, JSON.stringify({ backupId: id, schemaVersion: selected.info.schemaVersion }), at)
        }).immediate()
        this.validateDb(restored)
      } finally { restored.close() }
      await writeMarker('COMMITTED')
      this.candidates.delete(candidateId)
      restart()
      return { backupPath: basename(preBackup) }
    } catch {
      try {
        if (existsSync(this.dbPath)) { const damaged = new Database(this.dbPath); damaged.close(); await rm(this.dbPath, { force: true }) }
        if (existsSync(original)) await rename(original, this.dbPath)
        else if (existsSync(preBackup)) await copyFileSync(preBackup, this.dbPath)
        const restoredOld = new Database(this.dbPath); this.validateDb(restoredOld); restoredOld.close()
        const recovered = openStoreDatabase(this.dbPath)
        try { audit(recovered, 'RESTORE_FAILED', actor, 'database', id, { result: 'rolled_back' }) } finally { recovered.close() }
        await rm(markerPath, { force: true }); await rm(selected.path, { force: true })
      } catch { restart(); throw new AppError('RESTORE_FAILED') }
      restart()
      throw new AppError('RESTORE_FAILED')
    }
  }
  private schemaVersion(db: Database.Database): number { return Number((db.prepare('SELECT COALESCE(MAX(version),0) n FROM schema_migrations').get() as { n: number }).n) }
  private validateDb(db: Database.Database): void {
    const appType = db.prepare("SELECT value FROM app_meta WHERE key='app_type'").get() as { value: string } | undefined
    if (appType?.value !== APP_ID) throw new Error('wrong application')
    const version = this.schemaVersion(db)
    if (version > 5 || version < 4) throw new Error('unsupported schema')
    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{version:number}>
    if (versions.length !== version || versions.some((row, index) => row.version !== index + 1)) throw new Error('incomplete migration history')
    const required = ['users','password_reset_codes','audit_logs','app_settings','categories','products','stock_movements']
    const found = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>).map(x => x.name))
    if (required.some(x => !found.has(x))) throw new Error('incomplete schema')
    const expectedColumns: Record<string, string[]> = { users: ['id','login_name','password_hash','role','is_active'], password_reset_codes: ['user_id','code_hash','expires_at','consumed_at','revoked_at','issuer_kind'], audit_logs: ['actor_kind','action','details_json'], products: ['id','current_stock','reorder_level','category_id'], stock_movements: ['product_id','quantity_delta','stock_before','stock_after'] }
    for (const [table, columns] of Object.entries(expectedColumns)) {
      const foundColumns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).map((column) => column.name))
      if (columns.some((column) => !foundColumns.has(column))) throw new Error(`incomplete ${table}`)
    }
    if ((db.pragma('integrity_check') as Array<{ integrity_check: string }>)[0]?.integrity_check !== 'ok') throw new Error('integrity failure')
    if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('foreign key failure')
    if (!db.prepare("SELECT 1 FROM app_meta WHERE key='setup_completed_at'").get() || !db.prepare("SELECT 1 FROM app_meta WHERE key='store_name'").get()) throw new Error('setup is incomplete')
    if (Number((db.prepare("SELECT COUNT(*) n FROM users WHERE role='ADMIN' AND is_active=1").get() as {n:number}).n) < 1) throw new Error('no active admin')
    if (Number((db.prepare('SELECT COUNT(*) n FROM products WHERE current_stock<0 OR current_stock>2147483647').get() as {n:number}).n)) throw new Error('stock invariant')
    if (Number((db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE stock_after<>stock_before+quantity_delta').get() as {n:number}).n)) throw new Error('movement invariant')
  }
}

export async function recoverInterruptedRestore(dataDir: string, dbPath: string): Promise<void> {
  const markerPath = join(dataDir, 'restore-state.json')
  if (!existsSync(markerPath)) return
  const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { phase?: string; original?: string; preBackup?: string; candidate?: string; dbPath?: string }
  if (resolve(marker.dbPath ?? '') !== resolve(dbPath)) throw new Error('RESTORE_MARKER_PATH_MISMATCH')
  const inspect = (path: string) => { const db = new Database(path); try { const appType = db.prepare("SELECT value FROM app_meta WHERE key='app_type'").get() as {value:string}|undefined; const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>; return appType?.value === APP_ID && integrity[0]?.integrity_check === 'ok' } finally { db.close() } }
  if (marker.phase === 'COMMITTED' && existsSync(dbPath) && inspect(dbPath)) {
    await rm(markerPath, { force: true }); if (marker.original) { await rm(marker.original, { force: true }); await rm(`${marker.original}-wal`, { force: true }); await rm(`${marker.original}-shm`, { force: true }) }; if (marker.candidate) await rm(marker.candidate, { force: true }); return
  }
  if (marker.original && existsSync(marker.original)) {
    if (marker.phase === 'PREPARED') {
      for (const suffix of ['-wal', '-shm']) if (existsSync(`${dbPath}${suffix}`) && !existsSync(`${marker.original}${suffix}`)) await rename(`${dbPath}${suffix}`, `${marker.original}${suffix}`)
    }
    if (existsSync(dbPath)) await rm(dbPath, { force: true })
    await rm(`${dbPath}-wal`, { force: true }); await rm(`${dbPath}-shm`, { force: true })
    await rename(marker.original, dbPath)
    for (const suffix of ['-wal', '-shm']) if (existsSync(`${marker.original}${suffix}`)) await rename(`${marker.original}${suffix}`, `${dbPath}${suffix}`)
  } else if (!existsSync(dbPath) && marker.preBackup && existsSync(marker.preBackup)) {
    await copyFileSync(marker.preBackup, dbPath)
    for (const suffix of ['-wal', '-shm']) if (existsSync(`${marker.preBackup}${suffix}`)) await copyFileSync(`${marker.preBackup}${suffix}`, `${dbPath}${suffix}`)
  }
  if (!existsSync(dbPath) || !inspect(dbPath)) throw new Error('RESTORE_RECOVERY_FAILED')
  await rm(markerPath, { force: true }); if (marker.candidate) await rm(marker.candidate, { force: true })
}

export async function cleanupRestoreCandidates(dataDir: string): Promise<void> {
  for (const entry of await readdir(dataDir, { withFileTypes: true })) {
    if (entry.isFile() && (/^\.(?:restore|recovery)-candidate-[a-f0-9-]+\.sqlite$/i.test(entry.name) || /^store-inventory\.sqlite\.candidate-[a-f0-9-]+$/i.test(entry.name))) await rm(join(dataDir, entry.name), { force: true })
  }
}
