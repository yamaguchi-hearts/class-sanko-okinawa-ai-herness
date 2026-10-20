import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStoreDatabase } from '../../src/main/db/connection'
import { AppError, AuthService } from '../../src/main/auth/service'
import { migrations } from '../../src/main/db/migrations'
import Database from 'better-sqlite3'

let dir = ''
let db: ReturnType<typeof openStoreDatabase> | null = null
afterEach(() => {
  db?.close(); db = null
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})
function setupDb(): AuthService {
  dir = mkdtempSync(join(tmpdir(), 'inventory-phase1-'))
  db = openStoreDatabase(join(dir, 'store.sqlite'))
  return new AuthService(db)
}
const setupInput = { storeName: '検証店舗', displayName: '管理者', loginName: 'Admin', password: 'correct horse battery', confirmPassword: 'correct horse battery' }

describe('Phase 1 database and identity foundation', () => {
  it('runs numbered migrations once, enables constraints, and refuses a future schema', () => {
    dir = mkdtempSync(join(tmpdir(), 'inventory-migration-'))
    const file = join(dir, 'store.sqlite')
    let first = openStoreDatabase(file)
    expect(first.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(first.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect((first.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version).toBe(5)
    first.close()
    first = openStoreDatabase(file)
    expect((first.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count).toBe(5)
    first.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(99, new Date().toISOString())
    first.close()
    expect(() => openStoreDatabase(file)).toThrow(/DATABASE_FUTURE_VERSION/)
  })

  it('upgrades an already applied earlier migration without recreating its rows', () => {
    dir = mkdtempSync(join(tmpdir(), 'inventory-existing-'))
    const file = join(dir, 'store.sqlite'); const legacy = new Database(file)
    legacy.pragma('foreign_keys = ON')
    legacy.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    migrations[0]!.up(legacy)
    legacy.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)').run(new Date().toISOString())
    legacy.prepare("INSERT INTO app_meta(key,value) VALUES('app_type','jp.co.sanko-okinawa.store-inventory')").run()
    legacy.close()
    const migrated = openStoreDatabase(file)
    expect((migrated.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v).toBe(5)
    expect((migrated.prepare('SELECT value FROM app_meta WHERE key=\'app_type\'').get() as { value: string }).value).toContain('store-inventory')
    migrated.close()
  })

  it('allows only one concurrent initial setup and persists the account across reopening', async () => {
    const auth = setupDb()
    const attempts = await Promise.allSettled([auth.setup(setupInput, 1), auth.setup(setupInput, 2)])
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(auth.isSetupRequired()).toBe(false)
    const user = db!.prepare('SELECT login_name,password_hash FROM users').get() as { login_name: string; password_hash: string }
    expect(user.login_name).toBe('admin')
    expect(user.password_hash).not.toContain(setupInput.password)
    db!.close(); db = openStoreDatabase(join(dir, 'store.sqlite'))
    const restarted = new AuthService(db)
    expect(restarted.getSession(1)).toBeNull()
    await expect(restarted.login('admin', setupInput.password, 3)).resolves.toHaveProperty('view.user.loginName', 'admin')
  })

  it('rejects a second setup, protects the last ADMIN and revokes an old user token', async () => {
    const auth = setupDb(); const admin = await auth.setup(setupInput, 1)
    await expect(auth.setup(setupInput, 2)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const staff = await auth.createUser(admin.token, 1, { loginName: 'staff', displayName: '担当者', role: 'STAFF' })
    expect(staff.user.mustChangePassword).toBe(true)
    expect(() => auth.updateUser(admin.token, 1, { userId: admin.view.user.id, displayName: '管理者', role: 'STAFF' })).toThrowError(AppError)
    const resetSession = await auth.beginPasswordReset('staff', staff.code, 2)
    await auth.completePasswordReset(resetSession.token, 2, 'staff initial password')
    const staffSession = await auth.login('staff', 'staff initial password', 2)
    auth.updateUser(admin.token, 1, { userId: staff.user.id, displayName: '担当者2', role: 'ADMIN' })
    expect(() => auth.canUseProtected(staffSession.token, 2)).toThrow()
  })

  it('consumes reset codes once, rejects business access in limited reset state and allows the new password', async () => {
    const auth = setupDb(); const admin = await auth.setup(setupInput, 1)
    const created = await auth.createUser(admin.token, 1, { loginName: 'new-staff', displayName: '新担当', role: 'STAFF' })
    await expect(auth.login('new-staff', 'any passphrase long', 2)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    const limited = await auth.beginPasswordReset('new-staff', created.code, 2)
    expect(limited.view.state).toBe('PASSWORD_RESET_REQUIRED')
    expect(() => auth.listUsers(limited.token, 2)).toThrowError(AppError)
    await expect(auth.beginPasswordReset('new-staff', created.code, 3)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    await auth.completePasswordReset(limited.token, 2, 'new staff passphrase')
    await expect(auth.login('new-staff', 'new staff passphrase', 3)).resolves.toHaveProperty('view.user.role', 'STAFF')
  })

  it('revokes an earlier code on reissue and rejects an expired code', async () => {
    let time = Date.now(); dir = mkdtempSync(join(tmpdir(), 'inventory-reset-')); db = openStoreDatabase(join(dir, 'store.sqlite'))
    const auth = new AuthService(db, () => time); const admin = await auth.setup(setupInput, 1)
    const created = await auth.createUser(admin.token, 1, { loginName: 'reset-user', displayName: '再設定対象', role: 'STAFF' })
    const next = auth.issuePasswordReset(admin.token, 1, created.user.id)
    await expect(auth.beginPasswordReset('reset-user', created.code, 2)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    time += 15 * 60_000 + 1
    await expect(auth.beginPasswordReset('reset-user', next.code, 2)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    const auditDetails = db.prepare('SELECT details_json FROM audit_logs').all().map((r) => JSON.stringify(r))
    expect(auditDetails.join('')).not.toContain(created.code)
    expect(auditDetails.join('')).not.toContain(next.code)
  })

  it('does not extend idle lock through session polling and rejects the pre-lock token', async () => {
    let time = Date.now(); dir = mkdtempSync(join(tmpdir(), 'inventory-idle-')); db = openStoreDatabase(join(dir, 'store.sqlite'))
    const auth = new AuthService(db, () => time); const first = await auth.setup(setupInput, 1)
    time += 14 * 60_000; expect(auth.getSession(1)?.state).toBe('AUTHENTICATED')
    time += 60_001; auth.expireIdleSessions()
    expect(auth.getSession(1)?.state).toBe('LOCKED')
    expect(() => auth.canUseProtected(first.token, 1)).toThrowError(AppError)
    const unlocked = await auth.unlock(setupInput.password, 1)
    expect(unlocked.view.state).toBe('AUTHENTICATED')
    expect(() => auth.canUseProtected(first.token, 1)).toThrowError(AppError)
  })

  it('locks after five failed attempts, preserves the cooldown in SQLite and unlocks by correct password', async () => {
    let time = Date.now()
    dir = mkdtempSync(join(tmpdir(), 'inventory-lock-')); db = openStoreDatabase(join(dir, 'store.sqlite'))
    const auth = new AuthService(db, () => time); await auth.setup(setupInput, 1)
    for (let i = 0; i < 5; i++) await expect(auth.login('admin', 'wrong password', 2)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    const row = db.prepare('SELECT failed_login_count,locked_until FROM users').get() as { failed_login_count: number; locked_until: string }
    expect(row.failed_login_count).toBe(5)
    expect(Date.parse(row.locked_until) - time).toBe(30_000)
    time += 30_001
    await expect(auth.login('admin', 'wrong after cooldown', 2)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    const second = db.prepare('SELECT failed_login_count,locked_until FROM users').get() as { failed_login_count: number; locked_until: string }
    expect(second.failed_login_count).toBe(6)
    expect(Date.parse(second.locked_until) - time).toBe(60_000)
    time += 60_001
    await expect(auth.login('admin', setupInput.password, 2)).resolves.toHaveProperty('view.user.loginName', 'admin')
    expect((db.prepare('SELECT failed_login_count FROM users').get() as { failed_login_count: number }).failed_login_count).toBe(0)
  })
})
