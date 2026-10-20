import argon2 from 'argon2'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { StoreDatabase } from '../db/connection'
import { audit, type AuditActor } from '../services/audit'
import type { CreateUserInput, Role, SessionView, UserSummary } from '../../shared/contracts'

export const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 4, hashLength: 32 } as const
export type AppErrorCode = 'VALIDATION_ERROR' | 'AUTH_REQUIRED' | 'AUTH_FAILED' | 'SESSION_EXPIRED' | 'ACCOUNT_LOCKED' | 'FORBIDDEN' | 'DUPLICATE_LOGIN' | 'DUPLICATE_SKU' | 'DUPLICATE_CATEGORY' | 'LAST_ADMIN_REQUIRED' | 'NOT_FOUND' | 'INACTIVE_ENTITY' | 'INSUFFICIENT_STOCK' | 'DATABASE_BUSY' | 'DATABASE_ERROR' | 'RECOVERY_REQUIRED'
export class AppError extends Error {
  constructor(readonly code: AppErrorCode) { super(code) }
}
type UserRow = { id: string; login_name: string; display_name: string; password_hash: string; role: Role; is_active: number; must_change_password: number; failed_login_count: number; locked_until: string | null }
type AuthSession = { token: string; senderId: number; userId: string; state: 'AUTHENTICATED' | 'PASSWORD_RESET_REQUIRED'; expiresAt: number; lastActivity: number; resetCodeId?: string }
type LockContext = { userId: string; senderId: number }
const nowIso = (time: number) => new Date(time).toISOString()
const normalizedLogin = (value: string) => value.trim().toLowerCase()
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()

export class AuthService {
  private readonly sessions = new Map<string, AuthSession>()
  private readonly tokenBySender = new Map<number, string>()
  private readonly lockContexts = new Map<number, LockContext>()
  private readonly anonymousFailures = new Map<string, { count: number; lockedUntil: number }>()
  private readonly resetFailures = new Map<string, { count: number; lockedUntil: number }>()
  private dummyHash?: Promise<string>
  constructor(private readonly db: StoreDatabase, private readonly clock: () => number = Date.now) {
  }
  private getDummyHash(): Promise<string> { return this.dummyHash ??= argon2.hash(randomBytes(32), ARGON_OPTIONS) }

  isSetupRequired(): boolean {
    const complete = !!this.getMeta('setup_completed_at')
    const users = Number((this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n)
    const admins = Number((this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='ADMIN' AND is_active=1").get() as { n: number }).n)
    if ((complete && admins === 0) || (!complete && users > 0)) throw new AppError('RECOVERY_REQUIRED')
    return !complete
  }
  private getMeta(key: string): string | null {
    return (this.db.prepare('SELECT value FROM app_meta WHERE key=?').get(key) as { value: string } | undefined)?.value ?? null
  }
  private actor(userId: string): AuditActor | null {
    const row = this.db.prepare('SELECT id,login_name,display_name,role FROM users WHERE id=?').get(userId) as { id: string; login_name: string; display_name: string; role: Role } | undefined
    return row ? { id: row.id, loginName: row.login_name, displayName: row.display_name, role: row.role } : null
  }
  private userByLogin(loginName: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE login_name=?').get(normalizedLogin(loginName)) as UserRow | undefined
  }
  private issueSession(user: UserRow, senderId: number, state: AuthSession['state'] = 'AUTHENTICATED', resetCodeId?: string, expiresAt?: number): { token: string; view: SessionView } {
    this.revokeSender(senderId)
    const token = randomBytes(32).toString('base64url')
    const now = this.clock()
    const timeoutMinutes = Number((this.db.prepare("SELECT value FROM app_settings WHERE key='idle_lock_minutes'").get() as { value: string } | undefined)?.value ?? '15')
    const expiry = expiresAt ?? now + timeoutMinutes * 60_000
    this.sessions.set(token, { token, senderId, userId: user.id, state, expiresAt: expiry, lastActivity: now, ...(resetCodeId ? { resetCodeId } : {}) })
    this.tokenBySender.set(senderId, token)
    this.lockContexts.delete(senderId)
    const storeName = this.getMeta('store_name') ?? ''
    return { token, view: { user: { id: user.id, loginName: user.login_name, displayName: user.display_name, role: user.role }, state, storeName, expiresAt: nowIso(expiry) } }
  }
  private revokeSender(senderId: number): void {
    const old = this.tokenBySender.get(senderId)
    if (old) this.sessions.delete(old)
    this.tokenBySender.delete(senderId)
  }
  revokeUser(userId: string): void {
    for (const session of this.sessions.values()) if (session.userId === userId) this.revokeSender(session.senderId)
    for (const [senderId, ctx] of this.lockContexts) if (ctx.userId === userId) this.lockContexts.delete(senderId)
  }
  logout(senderId: number): void { this.revokeSender(senderId); this.lockContexts.delete(senderId) }
  private lock(session: AuthSession): void {
    this.revokeSender(session.senderId)
    this.lockContexts.set(session.senderId, { userId: session.userId, senderId: session.senderId })
    const actor = this.actor(session.userId)
    if (actor) { try { audit(this.db, 'SESSION_LOCKED', actor, 'user', actor.id) } catch { /* Keep the already locked session fail-closed. */ } }
  }
  private session(token: string, senderId: number, allowReset = false): AuthSession {
    const session = this.sessions.get(token)
    if (!session || session.senderId !== senderId || this.tokenBySender.get(senderId) !== token) throw new AppError('AUTH_REQUIRED')
    const user = this.db.prepare('SELECT id,role,is_active,must_change_password FROM users WHERE id=?').get(session.userId) as { id: string; role: Role; is_active: number; must_change_password: number } | undefined
    if (!user || !user.is_active || (session.state === 'AUTHENTICATED' && user.must_change_password)) {
      this.revokeSender(senderId)
      throw new AppError('SESSION_EXPIRED')
    }
    if (session.state === 'PASSWORD_RESET_REQUIRED' && !allowReset) throw new AppError('FORBIDDEN')
    if (session.expiresAt <= this.clock()) {
      if (session.state === 'AUTHENTICATED') this.lock(session)
      else this.revokeSender(senderId)
      throw new AppError('SESSION_EXPIRED')
    }
    return session
  }
  private touch(session: AuthSession): void {
    const mins = Number((this.db.prepare("SELECT value FROM app_settings WHERE key='idle_lock_minutes'").get() as { value: string } | undefined)?.value ?? '15')
    session.lastActivity = this.clock(); session.expiresAt = session.lastActivity + mins * 60_000
  }
  reportActivity(senderId: number): void {
    const token = this.tokenBySender.get(senderId)
    if (!token) return
    const session = this.sessions.get(token)
    if (session && session.state === 'AUTHENTICATED' && session.expiresAt > this.clock()) this.touch(session)
  }
  expireIdleSessions(): void {
    for (const session of [...this.sessions.values()]) if (session.state === 'AUTHENTICATED' && session.expiresAt <= this.clock()) this.lock(session)
  }
  getSession(senderId: number): SessionView | null {
    const token = this.tokenBySender.get(senderId)
    if (token) {
      const s = this.sessions.get(token)
      if (s && s.expiresAt <= this.clock()) this.lock(s)
    }
    const activeToken = this.tokenBySender.get(senderId)
    if (activeToken) {
      const s = this.sessions.get(activeToken)
      const user = s ? this.actor(s.userId) : null
      if (s && user) return { user: { id: user.id, loginName: user.loginName, displayName: user.displayName, role: user.role }, state: s.state, storeName: this.getMeta('store_name') ?? '', expiresAt: nowIso(s.expiresAt) }
    }
    const lock = this.lockContexts.get(senderId)
    if (lock) {
      const user = this.actor(lock.userId)
      if (!user) { this.lockContexts.delete(senderId); return null }
      return { user: { id: user.id, loginName: user.loginName, displayName: user.displayName, role: user.role }, state: 'LOCKED', storeName: this.getMeta('store_name') ?? '', expiresAt: nowIso(this.clock()) }
    }
    return null
  }

  async setup(input: { storeName: string; displayName: string; loginName: string; password: string }, senderId: number): Promise<{ token: string; view: SessionView }> {
    const normalized = normalizedLogin(input.loginName)
    const hash = await argon2.hash(input.password, ARGON_OPTIONS)
    const id = randomUUID(); const now = nowIso(this.clock())
    this.db.transaction(() => {
      if (this.getMeta('setup_completed_at')) throw new AppError('FORBIDDEN')
      const anyUser = this.db.prepare('SELECT 1 FROM users LIMIT 1').get()
      if (anyUser) throw new AppError('RECOVERY_REQUIRED')
      this.db.prepare('INSERT INTO users(id,login_name,display_name,password_hash,role,created_at,updated_at,last_login_at) VALUES(?,?,?,?,?,?,?,?)').run(id, normalized, input.displayName.trim(), hash, 'ADMIN', now, now, now)
      this.db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES('store_name',?,?)").run(input.storeName.trim(), now)
      this.db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES('idle_lock_minutes','15',?)").run(now)
      this.db.prepare("INSERT INTO app_meta(key,value) VALUES('store_name',?)").run(input.storeName.trim())
      this.db.prepare("INSERT INTO app_meta(key,value) VALUES('setup_completed_at',?)").run(now)
      audit(this.db, 'SETUP_COMPLETED', { id, loginName: normalized, displayName: input.displayName.trim(), role: 'ADMIN' }, 'user', id, { storeName: input.storeName.trim() })
      audit(this.db, 'LOGIN_SUCCEEDED', { id, loginName: normalized, displayName: input.displayName.trim(), role: 'ADMIN' }, 'user', id)
    }).immediate()
    this.lockContexts.delete(senderId)
    return this.issueSession({ id, login_name: normalized, display_name: input.displayName.trim(), password_hash: hash, role: 'ADMIN', is_active: 1, must_change_password: 0, failed_login_count: 0, locked_until: null }, senderId)
  }

  async login(loginName: string, password: string, senderId: number): Promise<{ token: string; view: SessionView }> {
    const normalized = normalizedLogin(loginName); const user = this.userByLogin(normalized); const now = this.clock()
    if (!user) {
      const throttle = this.anonymousFailures.get(normalized)
      await argon2.verify(await this.getDummyHash(), password).catch(() => false)
      if (!throttle || throttle.lockedUntil <= now) {
        const count = (throttle?.count ?? 0) + 1
        const lockedUntil = count >= 5 ? now + Math.min(300, 30 * 2 ** (count - 5)) * 1000 : 0
        this.anonymousFailures.set(normalized, { count, lockedUntil })
      }
      throw new AppError('AUTH_FAILED')
    }
    if (!user.is_active || user.must_change_password || (user.locked_until && Date.parse(user.locked_until) > now)) {
      await argon2.verify(user.password_hash, password).catch(() => false)
      audit(this.db, 'LOGIN_FAILED', this.actor(user.id), 'user', user.id, { reason: 'rejected' })
      throw new AppError('AUTH_FAILED')
    }
    const valid = await argon2.verify(user.password_hash, password).catch(() => false)
    if (!valid) {
      const count = user.failed_login_count + 1
      const wait = count >= 5 ? Math.min(300, 30 * 2 ** (count - 5)) : 0
      const until = wait ? nowIso(now + wait * 1000) : null
      this.db.transaction(() => this.db.prepare('UPDATE users SET failed_login_count=?,locked_until=?,updated_at=? WHERE id=?').run(count, until, nowIso(now), user.id)).immediate()
      try { audit(this.db, 'LOGIN_FAILED', this.actor(user.id), 'user', user.id, { failedCount: count }) } catch { /* Failure control is persisted even when auditing is unavailable. */ }
      throw new AppError('AUTH_FAILED')
    }
    this.db.transaction(() => {
      this.db.prepare('UPDATE users SET failed_login_count=0,locked_until=NULL,last_login_at=?,updated_at=? WHERE id=?').run(nowIso(now), nowIso(now), user.id)
      audit(this.db, 'LOGIN_SUCCEEDED', this.actor(user.id), 'user', user.id)
    }).immediate()
    this.lockContexts.delete(senderId)
    return this.issueSession({ ...user, failed_login_count: 0, locked_until: null }, senderId)
  }

  async unlock(password: string, senderId: number): Promise<{ token: string; view: SessionView }> {
    const context = this.lockContexts.get(senderId)
    if (!context) throw new AppError('AUTH_REQUIRED')
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(context.userId) as UserRow | undefined
    if (!user || !user.is_active || user.must_change_password || (user.locked_until && Date.parse(user.locked_until) > this.clock())) throw new AppError('AUTH_FAILED')
    if (!await argon2.verify(user.password_hash, password).catch(() => false)) throw new AppError('AUTH_FAILED')
    this.db.transaction(() => audit(this.db, 'SESSION_UNLOCKED', this.actor(user.id), 'user', user.id)).immediate()
    return this.issueSession(user, senderId)
  }

  async changeOwnPassword(token: string, senderId: number, current: string, next: string): Promise<void> {
    const session = this.session(token, senderId)
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(session.userId) as UserRow
    if (!await argon2.verify(user.password_hash, current).catch(() => false)) throw new AppError('AUTH_FAILED')
    const hash = await argon2.hash(next, ARGON_OPTIONS); const now = nowIso(this.clock())
    this.db.transaction(() => {
      this.db.prepare('UPDATE users SET password_hash=?,must_change_password=0,failed_login_count=0,locked_until=NULL,updated_at=? WHERE id=?').run(hash, now, user.id)
      this.db.prepare('UPDATE password_reset_codes SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL').run(now, user.id)
      audit(this.db, 'PASSWORD_CHANGED', this.actor(user.id), 'user', user.id)
    }).immediate()
    this.revokeUser(user.id)
  }

  private resetCode(userId: string, issuerId: string | null, issuerKind: 'ADMIN' | 'OFFLINE_RECOVERY', now: number): { code: string; expiresAt: string; resetCodeId: string } {
    const code = randomBytes(32).toString('base64url'); const id = randomUUID(); const created = nowIso(now); const expires = nowIso(now + 15 * 60_000)
    this.db.prepare('UPDATE password_reset_codes SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL').run(created, userId)
    this.db.prepare('INSERT INTO password_reset_codes(id,user_id,code_hash,expires_at,created_at,issuer_user_id,issuer_kind) VALUES(?,?,?,?,?,?,?)').run(id, userId, digest(code).toString('hex'), expires, created, issuerId, issuerKind)
    return { code, expiresAt: expires, resetCodeId: id }
  }
  private issueResetWithAudit(userId: string, issuer: AuditActor, mustChange = true): { code: string; expiresAt: string } {
    const result = this.db.transaction(() => {
      const user = this.db.prepare('SELECT id,is_active FROM users WHERE id=?').get(userId) as { id: string; is_active: number } | undefined
      if (!user) throw new AppError('NOT_FOUND')
      if (!user.is_active) throw new AppError('FORBIDDEN')
      if (mustChange) this.db.prepare('UPDATE users SET must_change_password=1,updated_at=? WHERE id=?').run(nowIso(this.clock()), userId)
      const code = this.resetCode(userId, issuer.id, 'ADMIN', this.clock())
      audit(this.db, 'PASSWORD_RESET_REQUESTED', issuer, 'user', userId, { issuerUserId: issuer.id })
      return code
    }).immediate()
    this.revokeUser(userId)
    return { code: result.code, expiresAt: result.expiresAt }
  }
  issuePasswordReset(token: string, senderId: number, userId: string): { code: string; expiresAt: string } {
    const session = this.session(token, senderId)
    const issuer = this.actor(session.userId)
    if (!issuer || issuer.role !== 'ADMIN') throw new AppError('FORBIDDEN')
    return this.issueResetWithAudit(userId, issuer, false)
  }
  async createUser(token: string, senderId: number, input: CreateUserInput): Promise<{ user: UserSummary; code: string; expiresAt: string }> {
    const session = this.session(token, senderId); const actor = this.actor(session.userId)
    if (!actor || actor.role !== 'ADMIN') throw new AppError('FORBIDDEN')
    const id = randomUUID(); const normalized = normalizedLogin(input.loginName); const now = nowIso(this.clock())
    const randomInitialHash = await argon2.hash(randomBytes(32), ARGON_OPTIONS)
    try {
      const result = this.db.transaction(() => {
        this.db.prepare('INSERT INTO users(id,login_name,display_name,password_hash,role,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(id, normalized, input.displayName.trim(), randomInitialHash, input.role, now, now)
        const reset = this.resetCode(id, actor.id, 'ADMIN', this.clock())
        audit(this.db, 'USER_CREATED', actor, 'user', id, { loginName: normalized, role: input.role })
        audit(this.db, 'PASSWORD_RESET_REQUESTED', actor, 'user', id, { issuerUserId: actor.id })
        return reset
      }).immediate()
      return { user: { id, loginName: normalized, displayName: input.displayName.trim(), role: input.role, isActive: true, mustChangePassword: true }, code: result.code, expiresAt: result.expiresAt }
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE')) throw new AppError('DUPLICATE_LOGIN')
      throw error
    }
  }
  listUsers(token: string, senderId: number): UserSummary[] {
    const session = this.session(token, senderId); const actor = this.actor(session.userId)
    if (!actor || actor.role !== 'ADMIN') throw new AppError('FORBIDDEN')
    return (this.db.prepare('SELECT id,login_name,display_name,role,is_active,must_change_password FROM users ORDER BY login_name').all() as Array<{ id: string; login_name: string; display_name: string; role: Role; is_active: number; must_change_password: number }>).map((u) => ({ id: u.id, loginName: u.login_name, displayName: u.display_name, role: u.role, isActive: !!u.is_active, mustChangePassword: !!u.must_change_password }))
  }
  updateUser(token: string, senderId: number, input: { userId: string; displayName: string; role: Role }): void {
    const session = this.session(token, senderId); const actor = this.actor(session.userId)
    if (!actor || actor.role !== 'ADMIN') throw new AppError('FORBIDDEN')
    this.db.transaction(() => {
      const target = this.db.prepare('SELECT id,display_name,role,is_active FROM users WHERE id=?').get(input.userId) as { id: string; display_name: string; role: Role; is_active: number } | undefined
      if (!target) throw new AppError('NOT_FOUND')
      if (target.role === 'ADMIN' && target.is_active && input.role !== 'ADMIN') {
        const count = Number((this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='ADMIN' AND is_active=1").get() as { n: number }).n)
        if (count <= 1) throw new AppError('LAST_ADMIN_REQUIRED')
      }
      const now = nowIso(this.clock())
      this.db.prepare('UPDATE users SET display_name=?,role=?,updated_at=? WHERE id=?').run(input.displayName.trim(), input.role, now, input.userId)
      audit(this.db, target.role === input.role ? 'USER_UPDATED' : 'USER_ROLE_CHANGED', actor, 'user', input.userId, { oldDisplayName: target.display_name, newDisplayName: input.displayName.trim(), oldRole: target.role, newRole: input.role })
    }).immediate()
    if (input.userId !== actor.id) this.revokeUser(input.userId)
    else if (input.role !== actor.role) this.revokeUser(input.userId)
  }
  deactivateUser(token: string, senderId: number, userId: string): void {
    const session = this.session(token, senderId); const actor = this.actor(session.userId)
    if (!actor || actor.role !== 'ADMIN') throw new AppError('FORBIDDEN')
    this.db.transaction(() => {
      const target = this.db.prepare('SELECT id,role,is_active FROM users WHERE id=?').get(userId) as { id: string; role: Role; is_active: number } | undefined
      if (!target) throw new AppError('NOT_FOUND')
      if (target.role === 'ADMIN' && target.is_active) {
        const n = Number((this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='ADMIN' AND is_active=1").get() as { n: number }).n)
        if (n <= 1) throw new AppError('LAST_ADMIN_REQUIRED')
      }
      this.db.prepare('UPDATE users SET is_active=0,updated_at=? WHERE id=?').run(nowIso(this.clock()), userId)
      this.db.prepare('UPDATE password_reset_codes SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL').run(nowIso(this.clock()), userId)
      audit(this.db, 'USER_DEACTIVATED', actor, 'user', userId, { role: target.role })
    }).immediate()
    this.revokeUser(userId)
  }
  async beginPasswordReset(loginName: string, code: string, senderId: number): Promise<{ token: string; view: SessionView }> {
    const normalized = normalizedLogin(loginName); const user = this.userByLogin(normalized); const supplied = digest(code); const now = this.clock()
    const throttle = this.resetFailures.get(normalized)
    if (throttle && throttle.lockedUntil > now) { await argon2.verify(await this.getDummyHash(), code).catch(() => false); throw new AppError('AUTH_FAILED') }
    const countGenericFailure = () => {
      const count = (this.resetFailures.get(normalized)?.count ?? 0) + 1
      const wait = count >= 5 ? Math.min(300, 30 * 2 ** (count - 5)) * 1000 : 0
      this.resetFailures.set(normalized, { count, lockedUntil: wait ? now + wait : 0 })
    }
    if (!user || !user.is_active || (user.locked_until && Date.parse(user.locked_until) > now)) { await argon2.verify(await this.getDummyHash(), code).catch(() => false); countGenericFailure(); throw new AppError('AUTH_FAILED') }
    const reset = this.db.prepare('SELECT * FROM password_reset_codes WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1').get(user.id) as { id: string; code_hash: string; expires_at: string; failed_attempt_count: number } | undefined
    const actual = reset ? Buffer.from(reset.code_hash, 'hex') : randomBytes(32)
    if (!reset || Date.parse(reset.expires_at) <= now || actual.length !== supplied.length || !timingSafeEqual(actual, supplied)) {
      if (reset && Date.parse(reset.expires_at) > now) this.db.transaction(() => {
        const count = reset.failed_attempt_count + 1; const at = nowIso(now)
        if (count >= 5) this.db.prepare('UPDATE password_reset_codes SET failed_attempt_count=?,revoked_at=? WHERE id=?').run(count, at, reset.id)
        else this.db.prepare('UPDATE password_reset_codes SET failed_attempt_count=? WHERE id=?').run(count, reset.id)
      }).immediate()
      countGenericFailure()
      throw new AppError('AUTH_FAILED')
    }
    this.resetFailures.delete(normalized)
    this.db.transaction(() => this.db.prepare('UPDATE password_reset_codes SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL').run(nowIso(now), reset.id)).immediate()
    const session = this.issueSession(user, senderId, 'PASSWORD_RESET_REQUIRED', reset.id, Date.parse(reset.expires_at))
    return session
  }
  async completePasswordReset(token: string, senderId: number, next: string): Promise<void> {
    const session = this.session(token, senderId, true); if (session.state !== 'PASSWORD_RESET_REQUIRED' || !session.resetCodeId) throw new AppError('FORBIDDEN')
    const hash = await argon2.hash(next, ARGON_OPTIONS); const now = nowIso(this.clock())
    this.db.transaction(() => {
      const code = this.db.prepare('SELECT id FROM password_reset_codes WHERE id=? AND user_id=? AND consumed_at IS NOT NULL AND revoked_at IS NULL').get(session.resetCodeId, session.userId)
      if (!code) throw new AppError('AUTH_FAILED')
      this.db.prepare('UPDATE users SET password_hash=?,must_change_password=0,failed_login_count=0,locked_until=NULL,updated_at=? WHERE id=?').run(hash, now, session.userId)
      this.db.prepare('UPDATE password_reset_codes SET revoked_at=? WHERE user_id=? AND id<>? AND consumed_at IS NULL AND revoked_at IS NULL').run(now, session.userId, session.resetCodeId)
      audit(this.db, 'PASSWORD_RESET_COMPLETED', this.actor(session.userId), 'user', session.userId)
    }).immediate()
    this.revokeUser(session.userId)
  }
  canUseProtected(token: string, senderId: number, role?: Role): void {
    const s = this.session(token, senderId)
    if (role) { const actor = this.actor(s.userId); if (!actor || actor.role !== role) throw new AppError('FORBIDDEN') }
  }
  getCurrentRole(token: string, senderId: number): Role { const s = this.session(token, senderId); const a = this.actor(s.userId); if (!a) throw new AppError('AUTH_REQUIRED'); return a.role }
}
