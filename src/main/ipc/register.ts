import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { AppError, AuthService } from '../auth/service'
import { validateCategoryList, validateCategoryName, validateCreateProduct, validateCreateUser, validateLogin, validateNewPassword, validatePasswordChange, validateProductListQuery, validateReset, validateSetup, validateUpdateCategory, validateUpdateProduct, validateUpdateUser } from '../../shared/validation'
import type { ValidationResult } from '../../shared/validation'
import type { IpcResult, PublicErrorCode } from '../../shared/contracts'
import type { CatalogService } from '../services/catalog'

type TokenEnvelope<T> = { token: string; value: T }
function errorResult(error: unknown): IpcResult<never> {
  if (error instanceof AppError) {
    const messages: Record<PublicErrorCode, string> = {
      VALIDATION_ERROR: '入力内容を確認してください。', AUTH_REQUIRED: 'ログインしてください。', AUTH_FAILED: '認証に失敗しました。入力内容を確認してください。',
      SESSION_EXPIRED: 'セッションの有効期限が切れました。もう一度ログインしてください。', ACCOUNT_LOCKED: 'アカウントが一時的にロックされています。', FORBIDDEN: 'この操作を行う権限がありません。',
      DUPLICATE_LOGIN: 'このログインIDはすでに使用されています。', DUPLICATE_SKU: 'このSKUはすでに登録されています。', DUPLICATE_CATEGORY: 'このカテゴリ名はすでに登録されています。',
      LAST_ADMIN_REQUIRED: '有効なADMINを1人以上残す必要があります。', NOT_FOUND: '対象が見つかりません。', INACTIVE_ENTITY: '無効なカテゴリは新たに選択できません。',
      DATABASE_BUSY: 'データベースが使用中です。少し待ってから再試行してください。', DATABASE_ERROR: 'データを保存できませんでした。', RECOVERY_REQUIRED: 'データベースに有効なADMINがないか、初期設定状態に不整合があります。通常セットアップを行わず、管理者復旧手順を確認してください。'
    }
    return { ok: false, error: { code: error.code, message: messages[error.code] } }
  }
  const message = error instanceof Error ? error.message : ''
  const code: PublicErrorCode = message.includes('SQLITE_BUSY') ? 'DATABASE_BUSY' : 'DATABASE_ERROR'
  return { ok: false, error: { code, message: code === 'DATABASE_BUSY' ? 'データベースが使用中です。少し待ってから再試行してください。' : '処理を完了できませんでした。' } }
}

export function registerIpc(auth: AuthService, catalog: CatalogService, getMainContents: () => WebContents | null, allowedUrl: (url: string) => boolean): void {
  const assertSender = (event: IpcMainInvokeEvent): number => {
    const frame = event.senderFrame
    const main = getMainContents()
    if (!main || event.sender.id !== main.id || !frame || frame !== event.sender.mainFrame || !allowedUrl(frame.url)) throw new AppError('FORBIDDEN')
    return event.sender.id
  }
  const handle = (channel: string, action: (event: IpcMainInvokeEvent, senderId: number, ...args: unknown[]) => unknown | Promise<unknown>) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try { const senderId = assertSender(event); return { ok: true, value: await action(event, senderId, ...args) } }
      catch (error) { return errorResult(error) }
    })
  }
  const valid = <T>(result: ValidationResult<T>): T => {
    if (!result.ok) throw new AppError('VALIDATION_ERROR')
    return result.value as T
  }
  handle('setup:isRequired', () => auth.isSetupRequired())
  handle('setup:createInitialAdmin', async (_event, senderId, raw) => {
    const input = valid(validateSetup(raw))
    if (input.password !== input.confirmPassword) throw new AppError('VALIDATION_ERROR')
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
    if (input.newPassword !== input.confirmPassword) throw new AppError('VALIDATION_ERROR')
    await auth.changeOwnPassword(String(token), senderId, input.currentPassword, input.newPassword); return null
  })
  handle('auth:beginPasswordReset', async (_event, senderId, raw) => {
    const input = valid<{ loginName: string; code: string }>(validateReset(raw)); const result = await auth.beginPasswordReset(input.loginName, input.code, senderId)
    return { session: result.view, internalToken: result.token }
  })
  handle('auth:completePasswordReset', async (_event, senderId, token, raw) => {
    const input = valid<{ password: string; confirmPassword: string }>(validateNewPassword(raw))
    if (input.password !== input.confirmPassword) throw new AppError('VALIDATION_ERROR')
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
  ipcMain.on('auth:trustedActivity', (event) => {
    try { assertSender(event as IpcMainInvokeEvent); auth.reportActivity(event.sender.id) } catch { /* reject silently */ }
  })
}

export function unwrapToken<T>(result: IpcResult<{ session: T; internalToken: string }>): IpcResult<TokenEnvelope<T>> {
  if (!result.ok) return result
  return { ok: true, value: { token: result.value.internalToken, value: result.value.session } }
}
