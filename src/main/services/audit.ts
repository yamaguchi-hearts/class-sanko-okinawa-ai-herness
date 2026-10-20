import { randomUUID } from 'node:crypto'
import type { StoreDatabase } from '../db/connection'

export type AuditActor = Readonly<{ id: string; loginName: string; displayName: string; role: 'ADMIN' | 'STAFF' }>
export function audit(db: StoreDatabase, action: string, actor: AuditActor | null, entityType: string | null, entityId: string | null, details: Record<string, string | number | boolean | null> = {}, actorKind: 'USER' | 'OFFLINE_RECOVERY' | 'SYSTEM' = actor ? 'USER' : 'SYSTEM'): void {
  db.prepare(`INSERT INTO audit_logs(id,actor_user_id,actor_login_snapshot,actor_name_snapshot,actor_role_snapshot,actor_kind,action,entity_type,entity_id,details_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), actor?.id ?? null, actor?.loginName ?? null, actor?.displayName ?? null, actor?.role ?? null, actorKind,
    action, entityType, entityId, JSON.stringify(details), new Date().toISOString())
}

export function auditOfflineRecovery(db: StoreDatabase, action: string, userId: string | null, windowsUser: string, details: Record<string, string | number | boolean | null> = {}): void {
  const user = userId ? db.prepare('SELECT login_name,display_name FROM users WHERE id=?').get(userId) as { login_name: string; display_name: string } | undefined : undefined
  db.prepare(`INSERT INTO audit_logs(id,actor_user_id,actor_login_snapshot,actor_name_snapshot,actor_role_snapshot,actor_kind,action,entity_type,entity_id,details_json,created_at)
    VALUES(?,NULL,?,?,NULL,'OFFLINE_RECOVERY',?,?,?,?,?)`).run(randomUUID(), windowsUser.slice(0, 100), 'Windows管理者復旧ツール', action, user ? 'user' : 'database', userId, JSON.stringify({ ...details, targetLoginName: user?.login_name ?? null }), new Date().toISOString())
}
