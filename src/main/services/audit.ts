import { randomUUID } from 'node:crypto'
import type { StoreDatabase } from '../db/connection'

export type AuditActor = Readonly<{ id: string; loginName: string; displayName: string; role: 'ADMIN' | 'STAFF' }>
export function audit(db: StoreDatabase, action: string, actor: AuditActor | null, entityType: string | null, entityId: string | null, details: Record<string, string | number | boolean | null> = {}): void {
  db.prepare(`INSERT INTO audit_logs(id,actor_user_id,actor_login_snapshot,actor_name_snapshot,actor_role_snapshot,action,entity_type,entity_id,details_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), actor?.id ?? null, actor?.loginName ?? null, actor?.displayName ?? null, actor?.role ?? null,
    action, entityType, entityId, JSON.stringify(details), new Date().toISOString())
}
