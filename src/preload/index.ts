import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, BackupCandidate, CategorySummary, CreateProductInput, CreateUserInput, DashboardSummary, DataOperationResult, IpcResult, LoginInput, NewPasswordInput, Page, PasswordChangeInput, ProductListQuery, ProductSummary, RecordStockMovementInput, RecordStockMovementResult, ResetInput, SessionView, SetupInput, StockActorOption, StockMovementQuery, StockMovementSummary, UpdateCategoryInput, UpdateProductInput, UpdateUserInput, UserSummary } from '../shared/contracts'

let internalToken: string | null = null
type TokenResponse = IpcResult<{ session: SessionView; internalToken: string }>
async function sessionCall(channel: string, payload: unknown): Promise<IpcResult<SessionView>> {
  const result = await ipcRenderer.invoke(channel, payload) as TokenResponse
  if (!result.ok) return result
  internalToken = result.value.internalToken
  return { ok: true, value: result.value.session }
}
async function protectedCall<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, internalToken, payload) as Promise<IpcResult<T>>
}
const api = Object.freeze({
  setup: Object.freeze({
    isRequired: () => ipcRenderer.invoke('setup:isRequired') as Promise<IpcResult<boolean>>,
    createInitialAdmin: (input: SetupInput) => sessionCall('setup:createInitialAdmin', input)
  }),
  auth: Object.freeze({
    login: (input: LoginInput) => sessionCall('auth:login', input),
    getSession: () => ipcRenderer.invoke('auth:getSession') as Promise<IpcResult<SessionView | null>>,
    logout: async () => { internalToken = null; return ipcRenderer.invoke('auth:logout') as Promise<IpcResult<null>> },
    unlock: (password: string) => sessionCall('auth:unlock', { password }),
    changeOwnPassword: (input: PasswordChangeInput) => protectedCall<null>('auth:changeOwnPassword', input).then((r) => { if (r.ok) internalToken = null; return r }),
    beginPasswordReset: (input: ResetInput) => sessionCall('auth:beginPasswordReset', input),
    completePasswordReset: (input: NewPasswordInput) => protectedCall<null>('auth:completePasswordReset', input).then((r) => { if (r.ok) internalToken = null; return r })
  }),
  users: Object.freeze({
    list: () => protectedCall<UserSummary[]>('users:list'),
    create: (input: CreateUserInput) => protectedCall<{ user: UserSummary; code: string; expiresAt: string }>('users:create', input),
    update: (input: UpdateUserInput) => protectedCall<null>('users:update', input),
    deactivate: (userId: string) => protectedCall<null>('users:deactivate', userId),
    issuePasswordReset: (userId: string) => protectedCall<{ code: string; expiresAt: string }>('users:issuePasswordReset', userId)
  }),
  products: Object.freeze({
    list: (query: ProductListQuery) => protectedCall<Page<ProductSummary>>('products:list', query),
    create: (input: CreateProductInput) => protectedCall<ProductSummary>('products:create', input),
    update: (input: UpdateProductInput) => protectedCall<ProductSummary>('products:update', input),
    deactivate: (productId: string) => protectedCall<null>('products:deactivate', productId)
  }),
  categories: Object.freeze({
    list: (includeInactive = false) => protectedCall<CategorySummary[]>('categories:list', { includeInactive }),
    create: (name: string) => protectedCall<CategorySummary>('categories:create', { name }),
    update: (input: UpdateCategoryInput) => protectedCall<CategorySummary>('categories:update', input),
    deactivate: (categoryId: string) => protectedCall<null>('categories:deactivate', categoryId)
  }),
  stock: Object.freeze({
    record: (input: RecordStockMovementInput) => protectedCall<RecordStockMovementResult>('stock:record', input),
    list: (query: StockMovementQuery) => protectedCall<Page<StockMovementSummary>>('stock:list', query),
    getDashboard: () => protectedCall<DashboardSummary>('stock:getDashboard'),
    listActors: () => protectedCall<StockActorOption[]>('stock:listActors')
  }),
  settings: Object.freeze({
    get: () => protectedCall<AppSettings>('settings:get'),
    update: (input: Pick<AppSettings, 'storeName' | 'idleLockMinutes'>) => protectedCall<AppSettings>('settings:update', input)
  }),
  data: Object.freeze({
    exportProducts: (query: ProductListQuery) => protectedCall<DataOperationResult>('data:exportProducts', query),
    createBackup: () => protectedCall<DataOperationResult>('data:createBackup'),
    inspectRestore: () => protectedCall<{ cancelled: boolean; candidate?: BackupCandidate }>('data:inspectRestore'),
    applyRestore: (input: { candidateId: string; confirmation: string; password: string }) => protectedCall<{ backupPath: string } | { cancelled: true }>('data:applyRestore', input)
  })
})
contextBridge.exposeInMainWorld('storeApp', api)

for (const eventName of ['pointerdown', 'keydown']) {
  window.addEventListener(eventName, (event) => {
    if (event.isTrusted) ipcRenderer.send('auth:trustedActivity')
  }, { capture: true, passive: true })
}
