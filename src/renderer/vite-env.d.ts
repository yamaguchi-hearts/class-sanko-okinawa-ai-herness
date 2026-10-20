/// <reference types="vite/client" />
import type { AppSettings, BackupCandidate, CategorySummary, CreateProductInput, CreateUserInput, DashboardSummary, DataOperationResult, IpcResult, LoginInput, NewPasswordInput, Page, PasswordChangeInput, ProductImageData, ProductImageSelectionResult, ProductImageVariant, ProductListQuery, ProductSummary, RecordStockMovementInput, RecordStockMovementResult, ResetInput, SessionView, SetupInput, StockActorOption, StockMovementQuery, StockMovementSummary, UpdateCategoryInput, UpdateProductInput, UpdateUserInput, UserSummary } from '../shared/contracts'

declare global {
  interface Window {
    storeApp: {
      setup: { isRequired(): Promise<IpcResult<boolean>>; createInitialAdmin(input: SetupInput): Promise<IpcResult<SessionView>> }
      auth: {
        login(input: LoginInput): Promise<IpcResult<SessionView>>
        getSession(): Promise<IpcResult<SessionView | null>>
        logout(): Promise<IpcResult<null>>
        unlock(password: string): Promise<IpcResult<SessionView>>
        changeOwnPassword(input: PasswordChangeInput): Promise<IpcResult<null>>
        beginPasswordReset(input: ResetInput): Promise<IpcResult<SessionView>>
        completePasswordReset(input: NewPasswordInput): Promise<IpcResult<null>>
      }
      users: {
        list(): Promise<IpcResult<UserSummary[]>>
        create(input: CreateUserInput): Promise<IpcResult<{ user: UserSummary; code: string; expiresAt: string }>>
        update(input: UpdateUserInput): Promise<IpcResult<null>>
        deactivate(userId: string): Promise<IpcResult<null>>
        issuePasswordReset(userId: string): Promise<IpcResult<{ code: string; expiresAt: string }>>
      }
      products: {
        list(query: ProductListQuery): Promise<IpcResult<Page<ProductSummary>>>
        create(input: CreateProductInput): Promise<IpcResult<ProductSummary>>
        update(input: UpdateProductInput): Promise<IpcResult<ProductSummary>>
        deactivate(productId: string): Promise<IpcResult<null>>
      }
      productImages: {
        select(): Promise<IpcResult<ProductImageSelectionResult>>
        discardSelection(selectionId: string): Promise<IpcResult<null>>
        get(productId: string, variant: ProductImageVariant): Promise<IpcResult<ProductImageData | null>>
      }
      categories: {
        list(includeInactive?: boolean): Promise<IpcResult<CategorySummary[]>>
        create(name: string): Promise<IpcResult<CategorySummary>>
        update(input: UpdateCategoryInput): Promise<IpcResult<CategorySummary>>
        deactivate(categoryId: string): Promise<IpcResult<null>>
      }
      stock: {
        record(input: RecordStockMovementInput): Promise<IpcResult<RecordStockMovementResult>>
        list(query: StockMovementQuery): Promise<IpcResult<Page<StockMovementSummary>>>
        getDashboard(): Promise<IpcResult<DashboardSummary>>
        listActors(): Promise<IpcResult<StockActorOption[]>>
      }
      settings: { get(): Promise<IpcResult<AppSettings>>; update(input: Pick<AppSettings, 'storeName' | 'idleLockMinutes'>): Promise<IpcResult<AppSettings>> }
      data: {
        exportProducts(query: ProductListQuery): Promise<IpcResult<DataOperationResult>>
        createBackup(): Promise<IpcResult<DataOperationResult>>
        inspectRestore(): Promise<IpcResult<{ cancelled: boolean; candidate?: BackupCandidate }>>
        applyRestore(input: { candidateId: string; confirmation: string; password: string }): Promise<IpcResult<{ backupPath: string } | { cancelled: true }>>
      }
    }
  }
}
