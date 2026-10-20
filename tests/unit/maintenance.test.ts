import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import lockfile from 'proper-lockfile'
import { openStoreDatabase } from '../../src/main/db/connection'
import { AuthService, AppError } from '../../src/main/auth/service'
import { CatalogService } from '../../src/main/services/catalog'
import { InventoryService } from '../../src/main/services/inventory'
import { ProductImageService } from '../../src/main/services/product-images'
import type { DecodedProductImage } from '../../src/main/services/product-images'
import { MaintenanceService, recoverInterruptedRestore, safeCsvText } from '../../src/main/services/maintenance'
import type { ProductListQuery } from '../../src/shared/contracts'

let dir = ''
let db: ReturnType<typeof openStoreDatabase> | null = null
afterEach(() => { db?.close(); db = null; if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); dir = '' })
const query: ProductListQuery = { search: '', categoryId: null, status: 'ALL', stockFilter: 'ALL', sortKey: 'sku', direction: 'asc', page: 1, pageSize: 1 }
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVf8AAAAASUVORK5CYII=', 'base64')
const imageDecoder = (content: Buffer): DecodedProductImage => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => Buffer.from(tinyPng), resize: () => imageDecoder(content) })

describe('CSV/settings/backup maintenance', () => {
  it('prefixes dangerous leading formulas after whitespace and quotes CSV controls', () => {
    expect(safeCsvText('=1+1')).toBe("'=1+1")
    expect(safeCsvText(' \t\n@SUM(A1)')).toBe("\"' \t\n@SUM(A1)\"")
    expect(safeCsvText('\u0001value')).toBe("'\u0001value")
    expect(safeCsvText('a,"b"\r\nc')).toBe('"a,""b""\r\nc"')
  })

  it('uses an exclusive directory lock that rejects a concurrent maintenance owner', async () => {
    dir = mkdtempSync(join(tmpdir(), 'inventory-lock-'))
    const release = await lockfile.lock(dir, { realpath: false, retries: 0, stale: 15_000, update: 5_000 })
    try { await expect(lockfile.lock(dir, { realpath: false, retries: 0, stale: 15_000, update: 5_000 })).rejects.toThrow() }
    finally { await release() }
  })

  it('exports every matching page with fixed BOM/columns and records an audit without changing source text', async () => {
    dir = mkdtempSync(join(tmpdir(), 'inventory-maintenance-'))
    db = openStoreDatabase(join(dir, 'store.sqlite'))
    const auth = new AuthService(db), inventory = new InventoryService(db, auth), images = new ProductImageService(db, auth, () => { throw new Error('Image decoder is not used in this test') }), catalog = new CatalogService(db, auth, inventory, images)
    const admin = await auth.setup({ storeName: '検証店', displayName: '管理者', loginName: 'admin', password: 'maintenance test password' }, 4)
    catalog.createProduct(admin.token, 4, { sku: 'A', name: '=商品', categoryId: null, unit: '個', reorderLevel: 1, note: 'a,"b"\nc', initialStock: 0, imageSelectionId: null })
    catalog.createProduct(admin.token, 4, { sku: 'B', name: '通常商品', categoryId: null, unit: '箱', reorderLevel: 0, note: null, initialStock: 0, imageSelectionId: null })
    const insert = db.prepare('INSERT INTO products(id,sku,name,name_search_key,category_id,unit,current_stock,reorder_level,note,is_active,created_at,updated_at) VALUES(?,?,?, ?,NULL,?,0,0,NULL,1,?,?)')
    const timestamp = new Date().toISOString()
    for (let i = 0; i < 205; i++) insert.run(`test-product-${i}`, `TEST-${i}`, `追加商品${i}`, `追加商品${i}`, '個', timestamp, timestamp)
    const service = new MaintenanceService(db, auth, dir, join(dir, 'store.sqlite'))
    const output = join(dir, 'result.csv')
    expect((await service.exportProducts(admin.token, 4, query, output)).count).toBe(207)
    const content = readFileSync(output, 'utf8')
    expect(content.startsWith('\uFEFFSKU,商品名,カテゴリ,現在庫,最低在庫数,単位,状態,メモ\r\n')).toBe(true)
    expect(content).toContain("'=商品")
    expect(content.match(/\r\n/g)).toHaveLength(208)
    expect(content).toContain('"a,""b""\nc"')
    expect((db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='PRODUCTS_CSV_EXPORTED'").get() as {n:number}).n).toBe(1)
  })

  it('enforces admin settings and creates an integrity checked standalone backup', async () => {
    dir = mkdtempSync(join(tmpdir(), 'inventory-maintenance-'))
    db = openStoreDatabase(join(dir, 'store.sqlite'))
    let now = Date.now()
    const auth = new AuthService(db, () => now)
    const admin = await auth.setup({ storeName: '設定前', displayName: '管理者', loginName: 'admin', password: 'maintenance test password' }, 4)
    const service = new MaintenanceService(db, auth, dir, join(dir, 'store.sqlite'))
    expect(service.readSettings(admin.token, 4).idleLockMinutes).toBe(15)
    expect(service.updateSettings(admin.token, 4, { storeName: '設定後', idleLockMinutes: 5 }).storeName).toBe('設定後')
    expect((db.prepare("SELECT value FROM app_settings WHERE key='store_name'").get() as {value:string}).value).toBe('設定後')
    expect(() => service.updateSettings(admin.token, 4, { storeName: '不正', idleLockMinutes: 0 })).toThrowError(AppError)
    const staffIssued = await auth.createUser(admin.token, 4, { loginName: 'staff', displayName: '担当者', role: 'STAFF' })
    const reset = await auth.beginPasswordReset('staff', staffIssued.code, 5)
    await auth.completePasswordReset(reset.token, 5, 'maintenance staff password')
    const staff = await auth.login('staff', 'maintenance staff password', 5)
    expect(() => service.readSettings(staff.token, 5)).toThrowError(AppError)
    expect(() => service.updateSettings(staff.token, 5, { storeName: '禁止', idleLockMinutes: 5 })).toThrowError(AppError)
    const output = join(dir, 'backup.sqlite3')
    const backup = await service.createBackup(admin.token, 4, output)
    expect(backup.schemaVersion).toBe(7)
    const restored = new Database(output, { readonly: true, fileMustExist: true })
    expect(restored.pragma('integrity_check')).toMatchObject([{ integrity_check: 'ok' }])
    expect((restored.prepare("SELECT value FROM app_meta WHERE key='store_name'").get() as {value:string}).value).toBe('設定後')
    restored.close()
    expect((await service.inspectRestoreCandidate(admin.token, 4, output)).productCount).toBe(0)
    now += 4 * 60_000
    service.updateSettings(admin.token, 4, { storeName: '設定後', idleLockMinutes: 1 })
    expect(auth.getSession(4)?.state).toBe('LOCKED')
  })

  it('backs up and restores an image with its opening stock while rejecting a corrupted image candidate', async () => {
    dir = mkdtempSync(join(tmpdir(), 'inventory-image-backup-'))
    const dbPath = join(dir, 'store.sqlite')
    db = openStoreDatabase(dbPath)
    const auth = new AuthService(db)
    const admin = await auth.setup({ storeName: '画像復元店舗', displayName: '管理者', loginName: 'admin', password: 'image restore password' }, 4)
    const inventory = new InventoryService(db, auth)
    const images = new ProductImageService(db, auth, imageDecoder)
    const catalog = new CatalogService(db, auth, inventory, images)
    const sourcePath = join(dir, 'source.png')
    writeFileSync(sourcePath, tinyPng)
    const selection = await images.selectFile(admin.token, 4, sourcePath)
    const item = catalog.createProduct(admin.token, 4, { sku: 'IMAGE-BACKUP', name: '復元画像商品', categoryId: null, unit: '個', reorderLevel: 0, note: null, initialStock: 12, imageSelectionId: selection.selectionId })
    const service = new MaintenanceService(db, auth, dir, dbPath)
    const backupPath = join(dir, 'image-backup.sqlite3')
    const backup = await service.createBackup(admin.token, 4, backupPath)
    expect(backup.schemaVersion).toBe(7)
    const candidate = await service.inspectRestoreCandidate(admin.token, 4, backupPath)
    expect(candidate.schemaVersion).toBe(7)

    const corruptedPath = join(dir, 'corrupted-image-backup.sqlite3')
    copyFileSync(backupPath, corruptedPath)
    const corrupted = new Database(corruptedPath)
    corrupted.prepare('UPDATE product_images SET content=? WHERE product_id=?').run(Buffer.from('not a PNG'), item.id)
    corrupted.close()
    await expect(service.inspectRestoreCandidate(admin.token, 4, corruptedPath)).rejects.toMatchObject({ code: 'BACKUP_INVALID' })
    const validCandidate = await service.inspectRestoreCandidate(admin.token, 4, backupPath)

    catalog.updateProduct(admin.token, 4, { sku: item.sku, name: item.name, categoryId: item.categoryId, unit: item.unit, reorderLevel: item.reorderLevel, note: item.note, productId: item.id, imageChange: { action: 'REMOVE' } })
    inventory.record(admin.token, 4, { productId: item.id, type: 'ISSUE', quantity: 5, reasonCode: 'OTHER', note: null })
    let restarted = false
    await service.applyRestore(admin.token, 4, validCandidate.candidateId, validCandidate.storeName, 'image restore password', (token, senderId, password) => auth.reauthenticateAdmin(token, senderId, password), () => { restarted = true })
    expect(restarted).toBe(true)
    db = null
    const restored = openStoreDatabase(dbPath)
    expect((restored.prepare('SELECT current_stock FROM products WHERE id=?').get(item.id) as { current_stock: number }).current_stock).toBe(12)
    expect(restored.prepare('SELECT content,mime_type,width,height FROM product_images WHERE product_id=?').get(item.id)).toMatchObject({ content: tinyPng, mime_type: 'image/png', width: 1, height: 1 })
    expect((restored.prepare("SELECT COUNT(*) AS count FROM stock_movements WHERE product_id=? AND movement_type='OPENING'").get(item.id) as { count: number }).count).toBe(1)
    db = restored
  })

  it('rejects a non-app SQLite restore candidate without touching the open database', async () => {
    dir = mkdtempSync(join(tmpdir(), 'inventory-maintenance-'))
    db = openStoreDatabase(join(dir, 'store.sqlite'))
    const auth = new AuthService(db)
    const admin = await auth.setup({ storeName: '保持店', displayName: '管理者', loginName: 'admin', password: 'maintenance test password' }, 4)
    const badPath = join(dir, 'other.sqlite3'), bad = new Database(badPath)
    bad.exec('CREATE TABLE unrelated(value TEXT)'); bad.close()
    const service = new MaintenanceService(db, auth, dir, join(dir, 'store.sqlite'))
    await expect(service.inspectRestoreCandidate(admin.token, 4, badPath)).rejects.toThrowError(AppError)
    expect(auth.isSetupRequired()).toBe(false)
    expect((db.prepare("SELECT value FROM app_meta WHERE key='store_name'").get() as {value:string}).value).toBe('保持店')
  })

  it('keeps the previous CSV and backup files intact when audit insertion fails', async () => {
    dir = mkdtempSync(join(tmpdir(), 'inventory-maintenance-'))
    db = openStoreDatabase(join(dir, 'store.sqlite'))
    const auth = new AuthService(db)
    const admin = await auth.setup({ storeName: '監査試験店', displayName: '管理者', loginName: 'admin', password: 'maintenance test password' }, 4)
    const service = new MaintenanceService(db, auth, dir, join(dir, 'store.sqlite'))
    const csv = join(dir, 'output.csv'), backup = join(dir, 'backup.sqlite3')
    writeFileSync(csv, 'previous CSV'); writeFileSync(backup, 'previous backup')
    db.exec(`CREATE TRIGGER reject_csv_audit BEFORE INSERT ON audit_logs WHEN NEW.action='PRODUCTS_CSV_EXPORTED' BEGIN SELECT RAISE(ABORT,'audit failure'); END`)
    await expect(service.exportProducts(admin.token, 4, query, csv)).rejects.toThrow()
    expect(readFileSync(csv, 'utf8')).toBe('previous CSV')
    db.exec('DROP TRIGGER reject_csv_audit')
    db.exec(`CREATE TRIGGER reject_backup_audit BEFORE INSERT ON audit_logs WHEN NEW.action='DATABASE_BACKUP_CREATED' BEGIN SELECT RAISE(ABORT,'audit failure'); END`)
    await expect(service.createBackup(admin.token, 4, backup)).rejects.toThrow()
    expect(readFileSync(backup, 'utf8')).toBe('previous backup')
  })

  it('restores from a staged candidate, preserves a pre-restore backup, revokes old codes and restarts the caller', async () => {
    dir = mkdtempSync(join(tmpdir(), 'inventory-maintenance-'))
    const dbPath = join(dir, 'store.sqlite')
    db = openStoreDatabase(dbPath)
    const auth = new AuthService(db)
    const admin = await auth.setup({ storeName: '復元元店舗', displayName: '管理者', loginName: 'admin', password: 'maintenance test password' }, 4)
    const issued = await auth.createUser(admin.token, 4, { loginName: 'staff', displayName: '担当者', role: 'STAFF' })
    const service = new MaintenanceService(db, auth, dir, dbPath)
    const backupPath = join(dir, 'restore-source.sqlite3')
    await service.createBackup(admin.token, 4, backupPath)
    const candidate = await service.inspectRestoreCandidate(admin.token, 4, backupPath)
    service.updateSettings(admin.token, 4, { storeName: '置換後の現行DB', idleLockMinutes: 15 })
    let restarted = false
    const applied = await service.applyRestore(admin.token, 4, candidate.candidateId, candidate.storeName, 'maintenance test password', (token, senderId, password) => auth.reauthenticateAdmin(token, senderId, password), () => { restarted = true })
    expect(restarted).toBe(true)
    expect(applied.backupPath).toContain('before-restore-')
    db = null // applyRestore closed the old connection before replacing the file.
    const reopened = openStoreDatabase(dbPath)
    expect((reopened.prepare("SELECT value FROM app_meta WHERE key='store_name'").get() as {value:string}).value).toBe('復元元店舗')
    expect((reopened.prepare("SELECT revoked_at FROM password_reset_codes WHERE user_id=(SELECT id FROM users WHERE login_name='staff')").get() as {revoked_at:string|null}).revoked_at).not.toBeNull()
    const restartedAuth = new AuthService(reopened)
    expect(restartedAuth.getSession(4)).toBeNull()
    await expect(restartedAuth.beginPasswordReset('staff', issued.code, 5)).rejects.toBeInstanceOf(AppError)
    db = reopened
  })

  it('rolls an interrupted candidate install back to the original before app startup', async () => {
    dir = mkdtempSync(join(tmpdir(), 'inventory-restore-recovery-'))
    const dbPath = join(dir, 'store.sqlite')
    db = openStoreDatabase(dbPath)
    const auth = new AuthService(db)
    await auth.setup({ storeName: '原本店舗', displayName: '管理者', loginName: 'admin', password: 'maintenance test password' }, 4)
    db.close(); db = null
    const original = `${dbPath}.pre-restore-test`, candidate = join(dir, '.restore-candidate-test.sqlite'), marker = join(dir, 'restore-state.json')
    copyFileSync(dbPath, original); copyFileSync(dbPath, candidate)
    const newDb = new Database(candidate)
    newDb.prepare("UPDATE app_meta SET value='候補店舗' WHERE key='store_name'").run(); newDb.close()
    copyFileSync(candidate, dbPath)
    writeFileSync(marker, JSON.stringify({ phase: 'CANDIDATE_INSTALLED', original, preBackup: join(dir,'backup.sqlite3'), candidate, dbPath }))
    await recoverInterruptedRestore(dir, dbPath)
    const recovered = openStoreDatabase(dbPath)
    expect((recovered.prepare("SELECT value FROM app_meta WHERE key='store_name'").get() as {value:string}).value).toBe('原本店舗')
    expect(recovered.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='products'").get()).toBeTruthy()
    db = recovered
  })
})
