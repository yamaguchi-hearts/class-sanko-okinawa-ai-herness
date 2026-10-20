import type { CategorySummary, CreateUserInput, LoginInput, NewPasswordInput, PasswordChangeInput, ProductDraft, ProductListQuery, ProductSortKey, ProductStatusFilter, ProductStockFilter, RecordStockMovementInput, ResetInput, Role, SetupInput, StockMovementQuery, StockMovementType, StockReasonCode, UpdateCategoryInput, UpdateProductInput, UpdateUserInput } from '../contracts'

export type ValidationIssue = Readonly<{ path: string; message: string }>
export type ValidationResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; issues: readonly ValidationIssue[] }>
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const stringField = (v: Record<string, unknown>, key: string, min: number, max: number): string | undefined => {
  const value = v[key]
  return typeof value === 'string' && [...value].length >= min && [...value].length <= max ? value : undefined
}
const trimmedField = (v: Record<string, unknown>, key: string, min: number, max: number): string | undefined => {
  const value = v[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return [...trimmed].length >= min && [...trimmed].length <= max ? trimmed : undefined
}
function parse<T>(input: unknown, fields: Record<string, (v: Record<string, unknown>) => unknown>, required: readonly string[]): ValidationResult<T> {
  if (!isRecord(input) || Object.keys(input).some((key) => !required.includes(key))) return { ok: false, issues: [{ path: '', message: '入力形式が正しくありません。' }] }
  const output: Record<string, unknown> = {}
  const issues: ValidationIssue[] = []
  for (const key of required) {
    const value = fields[key]?.(input)
    if (value === undefined) issues.push({ path: key, message: '入力内容を確認してください。' })
    else output[key] = value
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: output as T }
}
const role = (v: Record<string, unknown>): Role | undefined => v.role === 'ADMIN' || v.role === 'STAFF' ? v.role : undefined
const login = (v: Record<string, unknown>): string | undefined => {
  const value = trimmedField(v, 'loginName', 1, 64)
  return value && [...value].length > 0 ? value : undefined
}
const name = (v: Record<string, unknown>, key: string): string | undefined => {
  const value = trimmedField(v, key, 1, 100)
  return value && [...value].length > 0 ? value : undefined
}
const password = (v: Record<string, unknown>, key: string): string | undefined => {
  const value = stringField(v, key, 12, 128)
  return value && [...value].length >= 12 ? value : undefined
}
export const validateSetup = (v: unknown) => parse<SetupInput>(v, {
  storeName: (x) => name(x, 'storeName'), displayName: (x) => name(x, 'displayName'), loginName: login,
  password: (x) => password(x, 'password'), confirmPassword: (x) => password(x, 'confirmPassword')
}, ['storeName', 'displayName', 'loginName', 'password', 'confirmPassword'])
export const validateLogin = (v: unknown) => parse<LoginInput>(v, { loginName: login, password: (x) => stringField(x, 'password', 1, 128) }, ['loginName', 'password'])
export const validatePasswordChange = (v: unknown) => parse<PasswordChangeInput>(v, {
  currentPassword: (x) => stringField(x, 'currentPassword', 1, 128), newPassword: (x) => password(x, 'newPassword'), confirmPassword: (x) => password(x, 'confirmPassword')
}, ['currentPassword', 'newPassword', 'confirmPassword'])
export const validateReset = (v: unknown) => parse<ResetInput>(v, { loginName: login, code: (x) => stringField(x, 'code', 1, 128) }, ['loginName', 'code'])
export const validateNewPassword = (v: unknown) => parse<NewPasswordInput>(v, { password: (x) => password(x, 'password'), confirmPassword: (x) => password(x, 'confirmPassword') }, ['password', 'confirmPassword'])
export const validateCreateUser = (v: unknown) => parse<CreateUserInput>(v, { loginName: login, displayName: (x) => name(x, 'displayName'), role }, ['loginName', 'displayName', 'role'])
export const validateUpdateUser = (v: unknown) => parse<UpdateUserInput>(v, {
  userId: (x) => typeof x.userId === 'string' && /^[0-9a-f-]{36}$/i.test(x.userId) ? x.userId : undefined,
  displayName: (x) => name(x, 'displayName'), role
}, ['userId', 'displayName', 'role'])

const uuidField = (v: Record<string, unknown>, key: string): string | null | undefined => v[key] === null ? null : typeof v[key] === 'string' && /^[0-9a-f-]{36}$/i.test(v[key] as string) ? v[key] as string : undefined
const productSku = (v: Record<string, unknown>): string | undefined => {
  const sku = trimmedField(v, 'sku', 1, 64)
  return sku && /^[A-Za-z0-9_-]{1,64}$/.test(sku) ? sku : undefined
}
const productName = (v: Record<string, unknown>): string | undefined => {
  const value = trimmedField(v, 'name', 1, 200)
  return value && [...value].length > 0 ? value : undefined
}
const unitField = (v: Record<string, unknown>): string | undefined => {
  const value = trimmedField(v, 'unit', 1, 16)
  return value && [...value].length > 0 ? value : undefined
}
const reorderLevel = (v: Record<string, unknown>): number | undefined => Number.isSafeInteger(v.reorderLevel) && (v.reorderLevel as number) >= 0 && (v.reorderLevel as number) <= 2_147_483_647 ? v.reorderLevel as number : undefined
const noteField = (v: Record<string, unknown>): string | null | undefined => {
  if (v.note === null) return null
  if (typeof v.note !== 'string') return undefined
  const note = v.note.trim()
  if ([...note].length > 2000) return undefined
  return note || null
}
const productFields = {
  sku: productSku, name: productName, categoryId: (v: Record<string, unknown>) => uuidField(v, 'categoryId'),
  unit: unitField, reorderLevel, note: noteField
}
export const validateCreateProduct = (v: unknown) => parse<ProductDraft>(v, productFields, ['sku', 'name', 'categoryId', 'unit', 'reorderLevel', 'note'])
export const validateUpdateProduct = (v: unknown) => parse<UpdateProductInput>(v, {
  ...productFields,
  productId: (x) => typeof x.productId === 'string' && /^[0-9a-f-]{36}$/i.test(x.productId) ? x.productId : undefined
}, ['productId', 'sku', 'name', 'categoryId', 'unit', 'reorderLevel', 'note'])
export const validateProductListQuery = (v: unknown) => parse<ProductListQuery>(v, {
  search: (x) => typeof x.search === 'string' && [...x.search.trim()].length <= 200 ? x.search.trim() : undefined,
  categoryId: (x) => uuidField(x, 'categoryId'),
  status: (x) => ['ACTIVE', 'INACTIVE', 'ALL'].includes(String(x.status)) ? x.status as ProductStatusFilter : undefined,
  stockFilter: (x) => ['ALL', 'LOW', 'ZERO'].includes(String(x.stockFilter)) ? x.stockFilter as ProductStockFilter : undefined,
  sortKey: (x) => ['name', 'sku', 'currentStock', 'reorderLevel'].includes(String(x.sortKey)) ? x.sortKey as ProductSortKey : undefined,
  direction: (x) => x.direction === 'asc' || x.direction === 'desc' ? x.direction : undefined,
  page: (x) => Number.isSafeInteger(x.page) && (x.page as number) >= 1 ? x.page : undefined,
  pageSize: (x) => Number.isSafeInteger(x.pageSize) && (x.pageSize as number) >= 1 && (x.pageSize as number) <= 200 ? x.pageSize : undefined
}, ['search', 'categoryId', 'status', 'stockFilter', 'sortKey', 'direction', 'page', 'pageSize'])
export const validateCategoryName = (v: unknown) => parse<{ name: string }>(v, { name: (x) => name(x, 'name') }, ['name'])
export const validateUpdateCategory = (v: unknown) => parse<UpdateCategoryInput>(v, {
  categoryId: (x) => typeof x.categoryId === 'string' && /^[0-9a-f-]{36}$/i.test(x.categoryId) ? x.categoryId : undefined,
  name: (x) => name(x, 'name')
}, ['categoryId', 'name'])
export const validateCategoryList = (v: unknown) => parse<{ includeInactive: boolean }>(v, { includeInactive: (x) => typeof x.includeInactive === 'boolean' ? x.includeInactive : undefined }, ['includeInactive'])

const movementReason = (v: Record<string, unknown>): StockReasonCode | undefined => ['DELIVERY', 'RETURN', 'DAMAGE', 'EXPIRED', 'STOCKTAKE', 'OTHER'].includes(String(v.reasonCode)) ? v.reasonCode as StockReasonCode : undefined
const stockInteger = (v: Record<string, unknown>, key: string, allowZero: boolean): number | undefined => Number.isSafeInteger(v[key]) && (v[key] as number) >= (allowZero ? 0 : 1) && (v[key] as number) <= 2_147_483_647 ? v[key] as number : undefined
const stockNote = (v: Record<string, unknown>): string | null | undefined => noteField({ note: v.note })
const movementBase = {
  productId: (v: Record<string, unknown>) => typeof v.productId === 'string' && /^[0-9a-f-]{36}$/i.test(v.productId) ? v.productId : undefined,
  reasonCode: movementReason,
  note: stockNote
}
export const validateRecordStockMovement = (v: unknown) => {
  if (!isRecord(v)) return { ok: false as const, issues: [{ path: '', message: '入力形式が正しくありません。' }] }
  if (v.type === 'RECEIPT' || v.type === 'ISSUE') return parse<RecordStockMovementInput>(v, {
    ...movementBase, type: (x) => x.type, quantity: (x) => stockInteger(x, 'quantity', false)
  }, ['type', 'productId', 'quantity', 'reasonCode', 'note'])
  if (v.type === 'ADJUSTMENT') return parse<RecordStockMovementInput>(v, {
    ...movementBase, type: (x) => x.type, countedStock: (x) => stockInteger(x, 'countedStock', true)
  }, ['type', 'productId', 'countedStock', 'reasonCode', 'note'])
  return { ok: false as const, issues: [{ path: 'type', message: '入力内容を確認してください。' }] }
}
const movementType = (x: Record<string, unknown>): StockMovementType | null | undefined => x.type === null ? null : ['OPENING', 'RECEIPT', 'ISSUE', 'ADJUSTMENT'].includes(String(x.type)) ? x.type as StockMovementType : undefined
const utcTimestamp = (x: Record<string, unknown>, key: string): string | null | undefined => {
  if (x[key] === null) return null
  const value = x[key]
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return undefined
  const parsed = Date.parse(value)
  const canonical = Number.isFinite(parsed) ? new Date(parsed).toISOString() : ''
  const expected = value.includes('.') ? value : value.replace(/Z$/, '.000Z')
  return canonical === expected ? canonical : undefined
}
export const validateStockMovementQuery = (v: unknown) => parse<StockMovementQuery>(v, {
  productId: (x) => uuidField(x, 'productId'), startAt: (x) => utcTimestamp(x, 'startAt'), endAt: (x) => utcTimestamp(x, 'endAt'),
  type: movementType, actorUserId: (x) => uuidField(x, 'actorUserId'),
  page: (x) => Number.isSafeInteger(x.page) && (x.page as number) >= 1 ? x.page : undefined,
  pageSize: (x) => Number.isSafeInteger(x.pageSize) && (x.pageSize as number) >= 1 && (x.pageSize as number) <= 200 ? x.pageSize : undefined
}, ['productId', 'startAt', 'endAt', 'type', 'actorUserId', 'page', 'pageSize'])
