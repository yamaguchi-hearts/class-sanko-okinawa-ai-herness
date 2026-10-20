import { app, dialog } from 'electron'
import Database from 'better-sqlite3'
import lockfile from 'proper-lockfile'
import { randomUUID } from 'node:crypto'
import { copyFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'
import { issueResetCode } from '../main/auth/reset-code'
import { auditOfflineRecovery } from '../main/services/audit'
import { openStoreDatabase } from '../main/db/connection'
import { CURRENT_SCHEMA_VERSION } from '../main/db/migrations'
import { inspectPngDimensions, MAX_PRODUCT_IMAGE_BYTES } from '../shared/domain/product-image'

const APP_ID = 'jp.co.sanko-okinawa.store-inventory'
const latestSchema = CURRENT_SCHEMA_VERSION
type Admin = { id: string; login_name: string; display_name: string }

function elevated(): boolean {
  if (process.platform !== 'win32') return false
  const command = '[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
  try { return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim().toLowerCase() === 'true' } catch { return false }
}
function validate(db: Database.Database): void {
  const appType = (db.prepare("SELECT value FROM app_meta WHERE key='app_type'").get() as { value: string } | undefined)?.value
  const version = Number((db.prepare('SELECT COALESCE(MAX(version),0) n FROM schema_migrations').get() as {n:number}).n)
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>).map((x) => x.name))
  if (appType !== APP_ID) throw new Error('別アプリのデータベースです。')
  if (version > latestSchema) throw new Error('データベースがツールより新しい版です。新しい復旧ツールを使用してください。')
  if (version !== latestSchema || ['users','password_reset_codes','audit_logs','app_settings','categories','products','stock_movements','product_images'].some((n) => !tables.has(n))) throw new Error('このアプリの対応済みデータベースではありません。')
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{version:number}>
  if (versions.length !== latestSchema || versions.some((row, index) => row.version !== index + 1)) throw new Error('マイグレーション履歴が不完全です。')
  const auditColumns = new Set((db.prepare('PRAGMA table_info(audit_logs)').all() as Array<{name:string}>).map((column) => column.name))
  if (!auditColumns.has('actor_kind') || !db.prepare("SELECT 1 FROM app_meta WHERE key='setup_completed_at'").get() || !db.prepare("SELECT 1 FROM app_meta WHERE key='store_name'").get()) throw new Error('アプリの必須情報が不足しています。')
  if ((db.pragma('integrity_check') as Array<{integrity_check:string}>)[0]?.integrity_check !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('データベースの整合性検査に失敗しました。')
  if (Number((db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE stock_after<>stock_before+quantity_delta').get() as {n:number}).n)) throw new Error('在庫履歴の整合性検査に失敗しました。')
  const images = db.prepare('SELECT content,mime_type,width,height FROM product_images').all() as Array<{ content: Buffer; mime_type: string; width: number; height: number }>
  for (const image of images) {
    const dimensions = Buffer.isBuffer(image.content) && image.content.length <= MAX_PRODUCT_IMAGE_BYTES ? inspectPngDimensions(image.content) : null
    if (image.mime_type !== 'image/png' || !dimensions || image.width !== dimensions.width || image.height !== dimensions.height) throw new Error('商品画像の整合性検査に失敗しました。')
  }
}
function storeName(db: Database.Database): string { return (db.prepare("SELECT value FROM app_meta WHERE key='store_name'").get() as {value:string}|undefined)?.value ?? '' }
function installationId(db: Database.Database): string { return (db.prepare("SELECT value FROM app_meta WHERE key='installation_id'").get() as {value:string}|undefined)?.value ?? '不明' }
function activeAdmins(db: Database.Database): Admin[] { return db.prepare("SELECT id,login_name,display_name FROM users WHERE role='ADMIN' AND is_active=1 ORDER BY login_name").all() as Admin[] }
function offlineAudit(db: Database.Database, action: string, entity: string | null, details: Record<string, string | number | null>, backupId: string): void {
  auditOfflineRecovery(db, action, entity, userInfo().username, { ...details, backupId })
}
async function validateBackupCandidate(path: string, directory: string): Promise<string> {
  const raw = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const appType = (raw.prepare("SELECT value FROM app_meta WHERE key='app_type'").get() as {value:string}|undefined)?.value
    const version = Number((raw.prepare('SELECT COALESCE(MAX(version),0) n FROM schema_migrations').get() as {n:number}).n)
    if (appType !== APP_ID || version > latestSchema || (raw.pragma('integrity_check') as Array<{integrity_check:string}>)[0]?.integrity_check !== 'ok') throw new Error('バックアップ候補が無効です。')
  } finally { raw.close() }
  const upgradedPath = join(directory, `.recovery-candidate-${randomUUID()}.sqlite`)
  await copyFile(path, upgradedPath)
  try {
    const upgraded = openStoreDatabase(upgradedPath)
    try { validate(upgraded); if (!activeAdmins(upgraded).length) throw new Error('有効ADMINのいないバックアップです。') } finally { upgraded.close() }
    return upgradedPath
  } catch (error) { await rm(upgradedPath, { force: true }); throw error }
}
async function recoverDamagedDatabase(target: string, directory: string): Promise<void> {
  const pick = await dialog.showOpenDialog({ title: '検証済みのバックアップを選択', properties: ['openFile'], filters: [{ name: 'SQLiteバックアップ', extensions: ['sqlite3','sqlite','db'] }] })
  if (pick.canceled || !pick.filePaths[0]) return
  let candidatePath: string
  try { candidatePath = await validateBackupCandidate(pick.filePaths[0], directory) } catch (error) { await dialog.showErrorBox('復元できません', error instanceof Error ? error.message : '候補が無効です。'); return }
  const selected = new Database(candidatePath, { readonly: true })
  let name: string
  try { name = storeName(selected) } finally { selected.close() }
  const confirm = await dialog.showMessageBox({ type: 'warning', title: 'データベースの復元確認', message: `対象: ${target}\n復元先店舗: ${name}\n現在のファイルを退避して置き換えます。続行しますか？`, buttons: ['復元する','キャンセル'], defaultId: 1, cancelId: 1, noLink: true })
  if (confirm.response !== 0) { await rm(candidatePath, { force: true }); return }
  const id = randomUUID(), original = `${target}.damaged-${id}`, staged = `${target}.candidate-${id}`, markerPath = join(directory, 'restore-state.json')
  const preBackup = `${target}.raw-preserved-${id}`
  const marker = { id, phase: 'PREPARED', original, preBackup, candidate: staged, dbPath: target }
  const writeMarker = async (phase: string) => { await writeFile(`${markerPath}.tmp`, JSON.stringify({ ...marker, phase })); await rename(`${markerPath}.tmp`, markerPath) }
  await copyFile(candidatePath, staged)
  if (existsSync(target)) await copyFile(target, preBackup)
  for (const suffix of ['-wal', '-shm']) if (existsSync(`${target}${suffix}`)) await copyFile(`${target}${suffix}`, `${preBackup}${suffix}`)
  const restore = new Database(staged)
  try {
    validate(restore)
    const at = new Date().toISOString()
    restore.transaction(() => {
      restore.prepare('UPDATE password_reset_codes SET revoked_at=? WHERE consumed_at IS NULL AND revoked_at IS NULL').run(at)
      offlineAudit(restore, 'BACKUP_RESTORED', null, { source: 'offline-recovery' }, id)
    }).immediate()
  } finally { restore.close() }
  await writeMarker('PREPARED')
  if (existsSync(target)) await rename(target, original)
  for (const suffix of ['-wal', '-shm']) if (existsSync(`${target}${suffix}`)) await rename(`${target}${suffix}`, `${original}${suffix}`)
  await writeMarker('ORIGINAL_RENAMED')
  await rename(staged, target)
  const applied = new Database(target, { readonly: true }); try { validate(applied) } finally { applied.close() }
  await writeMarker('COMMITTED')
  await rm(markerPath, { force: true }); await rm(original, { force: true }); await rm(`${original}-wal`, { force: true }); await rm(`${original}-shm`, { force: true }); await rm(candidatePath, { force: true }); await dialog.showMessageBox({ type: 'info', title: '復元完了', message: '復元しました。通常アプリを起動してログインしてください。', buttons: ['OK'] })
}

app.setName('沖縄店舗在庫管理 管理者復旧')
let selectedDataDirectory: string | null = null
app.whenReady().then(async () => {
  if (!elevated()) { await dialog.showErrorBox('管理者権限が必要です', 'このツールを右クリックして「管理者として実行」してください。データは変更していません。'); app.quit(); return }
  const picked = await dialog.showOpenDialog({ title: '対象アプリのデータベースを指定', properties: ['openFile'], filters: [{ name: '店舗在庫データベース', extensions: ['sqlite'] }] })
  if (picked.canceled || !picked.filePaths[0]) { app.quit(); return }
  const target = resolve(picked.filePaths[0]), directory = dirname(target)
  selectedDataDirectory = directory
  let release: (() => Promise<void>) | undefined
  try {
    release = await lockfile.lock(directory, { realpath: false, retries: 0, stale: 15_000, update: 5_000 })
    if (!target.toLowerCase().endsWith('store-inventory.sqlite')) throw new Error('対象ファイル名が店舗在庫DBと一致しません。')
    let db: Database.Database | null = null
    try {
      db = new Database(target)
      validate(db)
    } catch (error) {
      db?.close(); db = null
      if (error instanceof Error && (error.message.includes('別アプリ') || error.message.includes('新しい版'))) throw error
      await recoverDamagedDatabase(target, directory)
      app.quit(); return
    }
    const admins = activeAdmins(db)
    if (!admins.length) { db.close(); db = null; await recoverDamagedDatabase(target, directory); app.quit(); return }
    const targetChoice = await dialog.showMessageBox({ type: 'question', title: '復旧対象のADMIN', message: `店舗: ${storeName(db)}\n対象となる有効ADMINを選びます。`, buttons: [...admins.map((u) => `${u.display_name} (${u.login_name})`), 'キャンセル'], cancelId: admins.length, defaultId: admins.length })
    if (targetChoice.response >= admins.length) { db.close(); app.quit(); return }
    const selected = admins[targetChoice.response]!
    const backupChoice = await dialog.showSaveDialog({ title: '事前バックアップの保存先', defaultPath: `復旧前-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite3`, filters: [{name:'SQLiteバックアップ',extensions:['sqlite3']}] })
    if (backupChoice.canceled || !backupChoice.filePath) { db.close(); app.quit(); return }
    if (resolve(backupChoice.filePath).toLowerCase() === target.toLowerCase()) throw new Error('事前バックアップに現在のDBと異なるファイルを指定してください。')
    const confirmed = await dialog.showMessageBox({ type: 'warning', title: '管理者復旧の最終確認', message: `対象店舗: ${storeName(db)}\nインストールID: ${installationId(db)}\nDB: ${target}\n対象ADMIN: ${selected.display_name} (${selected.login_name})\n事前バックアップ: ${backupChoice.filePath}\n\nコード発行後は対象ADMINの現在のセッションを使えず、本人がコードでパスワードを再設定する必要があります。続行しますか？`, buttons: ['バックアップ後にコードを発行', 'キャンセル'], defaultId: 1, cancelId: 1, noLink: true })
    if (confirmed.response !== 0) { db.close(); app.quit(); return }
    const backupId = randomUUID(), backupCreatedAt = new Date().toISOString()
    await db.backup(backupChoice.filePath)
    const backupMeta = new Database(backupChoice.filePath)
    try {
      backupMeta.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('backup_id',?)").run(backupId)
      backupMeta.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('backup_created_at',?)").run(backupCreatedAt)
    } finally { backupMeta.close() }
    const backupCheck = new Database(backupChoice.filePath, { readonly: true, fileMustExist: true }); try { validate(backupCheck) } finally { backupCheck.close() }
    const windowsUser = userInfo().username
    const result = db.transaction(() => {
      const at = new Date().toISOString()
      db!.prepare('UPDATE users SET must_change_password=1,failed_login_count=0,locked_until=NULL,updated_at=? WHERE id=?').run(at, selected.id)
      const reset = issueResetCode(db!, selected.id, null, 'OFFLINE_RECOVERY', Date.now())
      offlineAudit(db!, 'ADMIN_RECOVERY_REQUESTED', selected.id, { windowsUser, expiresAt: reset.expiresAt }, backupId)
      offlineAudit(db!, 'DATABASE_BACKUP_CREATED', null, { windowsUser }, backupId)
      return { code: reset.code, expires: reset.expiresAt }
    }).immediate()
    const shown = await dialog.showMessageBox({ type: 'info', title: '一度限りの再設定コード', message: `対象: ${selected.display_name} (${selected.login_name})\n有効期限: ${result.expires}\n\n再設定コード（この画面を閉じると再表示できません）:\n${result.code}\n\n事前バックアップ: ${backupChoice.filePath}`, buttons: ['閉じる'], noLink: true })
    void shown
    db.close(); db = null
    await dialog.showMessageBox({ type: 'info', title: '復旧手順', message: '通常アプリを起動し、ログイン画面の「再設定コード」から本人が新しいパスワードを設定してください。', buttons: ['OK'] })
    app.quit()
  } catch (error) {
    if (selectedDataDirectory) {
      for (const entry of await readdir(selectedDataDirectory).catch(() => [])) if (/^\.recovery-candidate-[a-f0-9-]+\.sqlite$/i.test(entry)) await rm(join(selectedDataDirectory, entry), { force: true }).catch(() => undefined)
    }
    await dialog.showErrorBox('復旧を中止しました', error instanceof Error ? error.message : '排他ロックを取得できませんでした。アプリを閉じて再試行してください。')
    app.quit()
  } finally { if (release) await release().catch(() => undefined) }
}).catch(async (error: unknown) => { await dialog.showErrorBox('復旧ツールを起動できません', error instanceof Error ? error.message : '不明なエラー'); app.quit() })
