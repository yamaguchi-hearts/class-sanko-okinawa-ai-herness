import { ipcMain, dialog, type IpcMainInvokeEvent, type WebContents, type BrowserWindow } from 'electron'
import { AppError, AuthService } from '../auth/service'
import { validateCategoryList, validateCategoryName, validateCreateProduct, validateCreateUser, validateLogin, validateNewPassword, validatePasswordChange, validateProductListQuery, validateRecordStockMovement, validateReset, validateSetup, validateStockMovementQuery, validateUpdateCategory, validateUpdateProduct, validateUpdateUser } from '../../shared/validation'
import type { ValidationResult } from '../../shared/validation'
import type { IpcResult, PublicErrorCode } from '../../shared/contracts'
import type { CatalogService } from '../services/catalog'
import type { InventoryService } from '../services/inventory'
import type { MaintenanceService } from '../services/maintenance'

type TokenEnvelope<T> = { token: string; value: T }
function errorResult(error: unknown): IpcResult<never> {
  if (error instanceof AppError) {
    const messages: Record<PublicErrorCode, string> = {
      VALIDATION_ERROR: '入力内容を確認してください。', AUTH_REQUIRED: 'ログインしてください。', AUTH_FAILED: '認証に失敗しました。入力内容を確認してください。',
      SESSION_EXPIRED: 'セッションの有効期限が切れました。もう一度ログインしてください。', ACCOUNT_LOCKED: 'アカウントが一時的にロックされています。', FORBIDDEN: 'この操作を行う権限がありません。',
      DUPLICATE_LOGIN: 'このログインIDはすでに使用されています。', DUPLICATE_SKU: 'このSKUはすでに登録されています。', DUPLICATE_CATEGORY: 'このカテゴリ名はすでに登録されています。',
      LAST_ADMIN_REQUIRED: '有効なADMINを1人以上残す必要があります。', NOT_FOUND: '対象が見つかりません。', INACTIVE_ENTITY: '無効な商品またはカテゴリは新たに選択できません。',
      INSUFFICIENT_STOCK: '在庫が不足しています。最新の在庫数を確認してください。',
      DATABASE_BUSY: 'データベースが使用中です。少し待ってから再試行してください。', DATABASE_ERROR: 'データを保存できませんでした。', RECOVERY_REQUIRED: 'データベースに有効なADMINがないか、初期設定状態に不整合があります。通常セットアップを行わず、管理者復旧手順を確認してください。',
      BACKUP_INVALID: '選択したバックアップは破損しているか、このアプリでは使用できません。', BACKUP_FAILED: 'バックアップを作成できませんでした。', RESTORE_FAILED: '復元に失敗しました。元のデータを検査中です。業務画面へ戻らず、管理者へ連絡してください。'
    }
    return { ok: false, error: { code: error.code, message: messages[error.code] } }
  }
  const message = error instanceof Error ? error.message : ''
  const code: PublicErrorCode = message.includes('SQLITE_BUSY') ? 'DATABASE_BUSY' : 'DATABASE_ERROR'
  return { ok: false, error: { code, message: code === 'DATABASE_BUSY' ? 'データベースが使用中です。少し待ってから再試行してください。' : '処理を完了できませんでした。' } }
}

export function registerIpc(auth: AuthService, catalog: CatalogService, inventory: InventoryService, getMainContents: () => WebContents | null, allowedUrl: (url: string) => boolean, maintenance: MaintenanceService, getWindow: () => BrowserWindow | null, restart: () => void): void {
  let maintenanceMode = false
  let inFlight = 0
  const assertSender = (event: IpcMainInvokeEvent): number => {
    const frame = event.senderFrame
    const main = getMainContents()
    if (!main || event.sender.id !== main.id || !frame || frame !== event.sender.mainFrame || !allowedUrl(frame.url)) throw new AppError('FORBIDDEN')
    return event.sender.id
  }
  const handle = (channel: string, action: (event: IpcMainInvokeEvent, senderId: number, ...args: unknown[]) => unknown | Promise<unknown>) => {
    ipcMain.handle(channel, async (event, ...args) => {
      let counted = false
      try {
        const senderId = assertSender(event)
        if (maintenanceMode && channel !== 'data:applyRestore') throw new AppError('FORBIDDEN')
        counted = channel !== 'data:applyRestore'
        if (counted) inFlight++
        return { ok: true, value: await action(event, senderId, ...args) }
      }
      catch (error) { return errorResult(error) }
      finally { if (counted) inFlight-- }
    })
  }
  const valid = <T>(result: ValidationResult<T>): T => {
    if (!result.ok) throw new AppError('VALIDATION_ERROR')
    return result.value as T
  }
  handle('setup:isRequired', () => auth.isSetupRequired())
  handle('setup:createInitialAdmin', async (_event, senderId, raw) => {
    const input = valid(validateSetup(raw))
    const result = await auth.setup(input, senderId)
    return { session: result.view, internalToken: result.token }
  })
  handle('auth:login', async (_event, senderId, raw) => {
    const input = valid<{ loginName: string; password: string }>(validateLogin(raw))
    const result = await auth.login(input.loginName, input.password, senderId)
    return { session: result.view, internalToken: result.token }
  })
  handle('auth:getSession', (_event, senderId) => auth.getSession(senderId))
  handle('auth:logout', (_event, senderId) => { auth.logout(senderId); return null })
  handle('auth:unlock', async (_event, senderId, raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw as object).join(',') !== 'password' || typeof (raw as { password?: unknown }).password !== 'string') throw new AppError('VALIDATION_ERROR')
    const result = await auth.unlock((raw as { password: string }).password, senderId)
    return { session: result.view, internalToken: result.token }
  })
  handle('auth:changeOwnPassword', async (_event, senderId, token, raw) => {
    const input = valid<{ currentPassword: string; newPassword: string; confirmPassword: string }>(validatePasswordChange(raw))
    await auth.changeOwnPassword(String(token), senderId, input.currentPassword, input.newPassword); return null
  })
  handle('auth:beginPasswordReset', async (_event, senderId, raw) => {
    const input = valid<{ loginName: string; code: string }>(validateReset(raw)); const result = await auth.beginPasswordReset(input.loginName, input.code, senderId)
    return { session: result.view, internalToken: result.token }
  })
  handle('auth:completePasswordReset', async (_event, senderId, token, raw) => {
    const input = valid<{ password: string; confirmPassword: string }>(validateNewPassword(raw))
    await auth.completePasswordReset(String(token), senderId, input.password); return null
  })
  handle('users:list', (_event, senderId, token) => auth.listUsers(String(token), senderId))
  handle('users:create', async (_event, senderId, token, raw) => {
    const input = valid<{ loginName: string; displayName: string; role: 'ADMIN' | 'STAFF' }>(validateCreateUser(raw))
    return auth.createUser(String(token), senderId, input)
  })
  handle('users:update', (_event, senderId, token, raw) => {
    const input = valid<{ userId: string; displayName: string; role: 'ADMIN' | 'STAFF' }>(validateUpdateUser(raw)); auth.updateUser(String(token), senderId, input); return null
  })
  handle('users:deactivate', (_event, senderId, token, userId) => {
    if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) throw new AppError('VALIDATION_ERROR')
    auth.deactivateUser(String(token), senderId, userId); return null
  })
  handle('users:issuePasswordReset', (_event, senderId, token, userId) => {
    if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) throw new AppError('VALIDATION_ERROR')
    return auth.issuePasswordReset(String(token), senderId, userId)
  })
  handle('products:list', (_event, senderId, token, raw) => catalog.listProducts(String(token), senderId, valid(validateProductListQuery(raw)))
  )
  handle('products:create', (_event, senderId, token, raw) => catalog.createProduct(String(token), senderId, valid(validateCreateProduct(raw)))
  )
  handle('products:update', (_event, senderId, token, raw) => catalog.updateProduct(String(token), senderId, valid(validateUpdateProduct(raw)))
  )
  handle('products:deactivate', (_event, senderId, token, productId) => {
    if (typeof productId !== 'string' || !/^[0-9a-f-]{36}$/i.test(productId)) throw new AppError('VALIDATION_ERROR')
    catalog.deactivateProduct(String(token), senderId, productId); return null
  })
  handle('categories:list', (_event, senderId, token, raw) => catalog.listCategories(String(token), senderId, valid(validateCategoryList(raw)).includeInactive)
  )
  handle('categories:create', (_event, senderId, token, raw) => catalog.createCategory(String(token), senderId, valid(validateCategoryName(raw)).name)
  )
  handle('categories:update', (_event, senderId, token, raw) => catalog.updateCategory(String(token), senderId, valid(validateUpdateCategory(raw)))
  )
  handle('categories:deactivate', (_event, senderId, token, categoryId) => {
    if (typeof categoryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(categoryId)) throw new AppError('VALIDATION_ERROR')
    catalog.deactivateCategory(String(token), senderId, categoryId); return null
  })
  handle('stock:record', (_event, senderId, token, raw) => inventory.record(String(token), senderId, valid(validateRecordStockMovement(raw))))
  handle('stock:list', (_event, senderId, token, raw) => {
    const query = valid(validateStockMovementQuery(raw))
    if (query.startAt && query.endAt && query.startAt >= query.endAt) throw new AppError('VALIDATION_ERROR')
    return inventory.list(String(token), senderId, query)
  })
  handle('stock:getDashboard', (_event, senderId, token) => inventory.dashboard(String(token), senderId))
  handle('stock:listActors', (_event, senderId, token) => inventory.listActors(String(token), senderId))
  handle('settings:get', (_event, senderId, token) => maintenance.readSettings(String(token), senderId))
  handle('settings:update', (_event, senderId, token, raw) => maintenance.updateSettings(String(token), senderId, raw))
  handle('data:exportProducts', async (_event, senderId, token, raw) => {
    const query = valid(validateProductListQuery(raw))
    const window = getWindow()
    const options = { title: '商品一覧をCSVへ保存', defaultPath: '商品一覧.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] }
    const selected = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (selected.canceled || !selected.filePath) { maintenance.recordDialogCancelled(String(token), senderId, 'CSV_EXPORT_CANCELLED'); return { cancelled: true } }
    const result = maintenance.exportProducts(String(token), senderId, query, selected.filePath)
    return { cancelled: false, ...result }
  })
  handle('data:createBackup', async (_event, senderId, token) => {
    maintenance.readSettings(String(token), senderId)
    const options = { title: 'データベースをバックアップ', defaultPath: '店舗在庫バックアップ.sqlite3', filters: [{ name: 'SQLiteバックアップ', extensions: ['sqlite3'] }] }
    const window = getWindow()
    const selected = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (selected.canceled || !selected.filePath) { maintenance.recordDialogCancelled(String(token), senderId, 'BACKUP_CANCELLED'); return { cancelled: true } }
    return { cancelled: false, ...await maintenance.createBackup(String(token), senderId, selected.filePath) }
  })
  handle('data:inspectRestore', async (_event, senderId, token) => {
    maintenance.readSettings(String(token), senderId)
    const options = { title: '復元するバックアップを選択', properties: ['openFile'] as Array<'openFile'>, filters: [{ name: 'SQLiteバックアップ', extensions: ['sqlite3', 'sqlite', 'db'] }] }
    const window = getWindow()
    const selected = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (selected.canceled || !selected.filePaths[0]) { maintenance.recordDialogCancelled(String(token), senderId, 'RESTORE_CANCELLED'); return { cancelled: true } }
    return { cancelled: false, candidate: maintenance.inspectRestoreCandidate(String(token), senderId, selected.filePaths[0]) }
  })
  handle('data:applyRestore', async (_event, senderId, token, raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw as object).sort().join(',') !== 'candidateId,confirmation,password' || Object.values(raw as Record<string, unknown>).some((v) => typeof v !== 'string')) throw new AppError('VALIDATION_ERROR')
    const input = raw as { candidateId: string; confirmation: string; password: string }
    if (!/^[0-9a-f-]{36}$/i.test(input.candidateId) || input.confirmation.length > 100 || input.password.length < 12 || input.password.length > 128) throw new AppError('VALIDATION_ERROR')
    const confirmOptions = { type: 'warning' as const, title: 'データベース復元の最終確認', message: '現在のデータを置き換えます。SQLite形式の事前バックアップを作成し、復元後にアプリを再起動します。続行しますか？', buttons: ['復元を実行', 'キャンセル'], defaultId: 1, cancelId: 1, noLink: true }
    const parent = getWindow()
    const confirmed = parent ? await dialog.showMessageBox(parent, confirmOptions) : await dialog.showMessageBox(confirmOptions)
    if (confirmed.response !== 0) { maintenance.recordDialogCancelled(String(token), senderId, 'RESTORE_CANCELLED'); return { cancelled: true } }
    maintenanceMode = true
    while (inFlight > 0) await new Promise((resolve) => setTimeout(resolve, 10))
    let restartRequested = false
    try {
      return await maintenance.applyRestore(String(token), senderId, input.candidateId, input.confirmation, input.password, (t, s, p) => auth.reauthenticateAdmin(t, s, p), () => { restartRequested = true; restart() })
    } catch (error) {
      if (!restartRequested) maintenanceMode = false
      throw error
    }
  })
  ipcMain.on('auth:trustedActivity', (event) => {
    try { assertSender(event as IpcMainInvokeEvent); if (!maintenanceMode) auth.reportActivity(event.sender.id) } catch { /* reject silently */ }
  })
}

export function unwrapToken<T>(result: IpcResult<{ session: T; internalToken: string }>): IpcResult<TokenEnvelope<T>> {
  if (!result.ok) return result
  return { ok: true, value: { token: result.value.internalToken, value: result.value.session } }
}
