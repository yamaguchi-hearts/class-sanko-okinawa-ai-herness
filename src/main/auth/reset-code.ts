import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export type ResetIssuerKind = 'ADMIN' | 'OFFLINE_RECOVERY'
export function issueResetCode(db: Database.Database, userId: string, issuerUserId: string | null, issuerKind: ResetIssuerKind, now: number): { code: string; expiresAt: string; resetCodeId: string } {
  const code = randomBytes(32).toString('base64url'), id = randomUUID(), createdAt = new Date(now).toISOString(), expiresAt = new Date(now + 15 * 60_000).toISOString()
  db.prepare('UPDATE password_reset_codes SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL').run(createdAt, userId)
  db.prepare('INSERT INTO password_reset_codes(id,user_id,code_hash,expires_at,created_at,issuer_user_id,issuer_kind) VALUES(?,?,?,?,?,?,?)')
    .run(id, userId, createHash('sha256').update(code, 'utf8').digest('hex'), expiresAt, createdAt, issuerUserId, issuerKind)
  return { code, expiresAt, resetCodeId: id }
}
