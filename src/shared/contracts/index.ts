/** 公開IPC DTO。内部トークン、ハッシュ、DB型を含めない。 */
export type Role = 'ADMIN' | 'STAFF'
export type SessionState = 'AUTHENTICATED' | 'LOCKED' | 'PASSWORD_RESET_REQUIRED'
export type SessionView = Readonly<{
  user: Readonly<{ id: string; loginName: string; displayName: string; role: Role }>
  state: SessionState
  storeName: string
  expiresAt: string
}>
export type UserSummary = Readonly<{ id: string; loginName: string; displayName: string; role: Role; isActive: boolean; mustChangePassword: boolean }>
export type ProductStatusFilter = 'ACTIVE' | 'INACTIVE' | 'ALL'
export type ProductStockFilter = 'ALL' | 'LOW' | 'ZERO'
export type ProductSortKey = 'name' | 'sku' | 'currentStock' | 'reorderLevel'
export type ProductSummary = Readonly<{
  id: string; sku: string; name: string; categoryId: string | null; categoryName: string | null; categoryActive: boolean | null
  unit: string; currentStock: number; reorderLevel: number; note: string | null; isActive: boolean; createdAt: string; updatedAt: string
}>
export type CategorySummary = Readonly<{ id: string; name: string; isActive: boolean }>
export type Page<T> = Readonly<{ items: readonly T[]; total: number; page: number; pageSize: number }>
export type ProductDraft = Readonly<{ sku: string; name: string; categoryId: string | null; unit: string; reorderLevel: number; note: string | null }>
export type UpdateProductInput = ProductDraft & Readonly<{ productId: string }>
export type ProductListQuery = Readonly<{
  search: string; categoryId: string | null; status: ProductStatusFilter; stockFilter: ProductStockFilter
  sortKey: ProductSortKey; direction: 'asc' | 'desc'; page: number; pageSize: number
}>
export type UpdateCategoryInput = Readonly<{ categoryId: string; name: string }>

export type PublicErrorCode = 'VALIDATION_ERROR' | 'AUTH_REQUIRED' | 'AUTH_FAILED' | 'SESSION_EXPIRED' | 'ACCOUNT_LOCKED' | 'FORBIDDEN' | 'DUPLICATE_LOGIN' | 'DUPLICATE_SKU' | 'DUPLICATE_CATEGORY' | 'LAST_ADMIN_REQUIRED' | 'NOT_FOUND' | 'INACTIVE_ENTITY' | 'DATABASE_BUSY' | 'DATABASE_ERROR' | 'RECOVERY_REQUIRED'
export type IpcResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: Readonly<{ code: PublicErrorCode; message: string }> }>

export type SetupInput = Readonly<{ storeName: string; displayName: string; loginName: string; password: string; confirmPassword: string }>
export type LoginInput = Readonly<{ loginName: string; password: string }>
export type PasswordChangeInput = Readonly<{ currentPassword: string; newPassword: string; confirmPassword: string }>
export type ResetInput = Readonly<{ loginName: string; code: string }>
export type NewPasswordInput = Readonly<{ password: string; confirmPassword: string }>
export type CreateUserInput = Readonly<{ loginName: string; displayName: string; role: Role }>
export type UpdateUserInput = Readonly<{ userId: string; displayName: string; role: Role }>

export type Phase0Status = Readonly<{ ready: true }>
