import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStoreDatabase } from '../../src/main/db/connection'
import { AppError, AuthService } from '../../src/main/auth/service'
import { CatalogService } from '../../src/main/services/catalog'
import { InventoryService } from '../../src/main/services/inventory'
import { calculateStockChange, isLowStock, isZeroStock, localDateRangeToUtc, MAX_STOCK } from '../../src/shared/domain/inventory'
import { validateRecordStockMovement, validateStockMovementQuery } from '../../src/shared/validation'
import type { ProductDraft, RecordStockMovementInput, StockMovementQuery } from '../../src/shared/contracts'

let dir = ''
let db: ReturnType<typeof openStoreDatabase> | null = null
let auth: AuthService
let catalog: CatalogService
let inventory: InventoryService
let adminToken = ''
afterEach(() => { db?.close(); db = null; if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); dir = '' })

async function setup(clock: () => number = Date.now): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), 'inventory-stock-'))
  db = openStoreDatabase(join(dir, 'store.sqlite'))
  auth = new AuthService(db, clock)
  catalog = new CatalogService(db, auth, clock)
  inventory = new InventoryService(db, auth, clock)
  const admin = await auth.setup({ storeName: '検証店舗', displayName: '管理者', loginName: 'admin', password: 'inventory test passphrase' }, 1)
  adminToken = admin.token
}

const draft = (patch: Partial<ProductDraft> = {}): ProductDraft => ({ sku: 'STOCK-1', name: '在庫商品', categoryId: null, unit: '個', reorderLevel: 1, note: null, ...patch })
const query = (patch: Partial<StockMovementQuery> = {}): StockMovementQuery => ({ productId: null, startAt: null, endAt: null, type: null, actorUserId: null, page: 1, pageSize: 50, ...patch })
const record = (productId: string, patch: Partial<RecordStockMovementInput> & { type: 'RECEIPT' | 'ISSUE'; quantity?: number } = { type: 'RECEIPT', quantity: 1 }): RecordStockMovementInput => ({
  productId, type: patch.type, quantity: patch.quantity ?? 1, reasonCode: patch.reasonCode ?? 'OTHER', note: patch.note ?? null
})

describe('inventory domain and persistence', () => {
  it('calculates integer movements, zero adjustments and stock states at their boundaries', () => {
    expect(calculateStockChange(0, { type: 'RECEIPT', productId: 'p', quantity: 2, reasonCode: 'OTHER', note: null })).toEqual({ ok: true, quantityDelta: 2, stockAfter: 2 })
    expect(calculateStockChange(2, { type: 'ISSUE', productId: 'p', quantity: 2, reasonCode: 'OTHER', note: null })).toEqual({ ok: true, quantityDelta: -2, stockAfter: 0 })
    expect(calculateStockChange(0, { type: 'ADJUSTMENT', productId: 'p', countedStock: 0, reasonCode: 'STOCKTAKE', note: null })).toEqual({ ok: true, quantityDelta: 0, stockAfter: 0 })
    expect(calculateStockChange(0, { type: 'ISSUE', productId: 'p', quantity: 1, reasonCode: 'OTHER', note: null })).toEqual({ ok: false, code: 'INSUFFICIENT_STOCK' })
    expect(calculateStockChange(MAX_STOCK, { type: 'RECEIPT', productId: 'p', quantity: 1, reasonCode: 'OTHER', note: null })).toEqual({ ok: false, code: 'VALIDATION_ERROR' })
    expect(isLowStock(0, 0)).toBe(false)
    expect(isZeroStock(0)).toBe(true)
    expect(isLowStock(0, 1)).toBe(true)
    expect(isZeroStock(0)).toBe(true)
    expect(isLowStock(1, 1)).toBe(true)
    expect(isLowStock(2, 1)).toBe(false)
  })

  it('validates discriminated DTOs, exact integers, reasons and UTC movement filters', () => {
    const id = 'c8a89772-22e1-4d10-8fd2-c0a41a82092c'
    expect(validateRecordStockMovement({ productId: id, type: 'ISSUE', quantity: 1, reasonCode: 'DAMAGE', note: null }).ok).toBe(true)
    expect(validateRecordStockMovement({ productId: id, type: 'ADJUSTMENT', countedStock: 0, quantity: 3, reasonCode: 'STOCKTAKE', note: null }).ok).toBe(false)
    expect(validateRecordStockMovement({ productId: id, type: 'RECEIPT', quantity: 1.5, reasonCode: 'OTHER', note: null }).ok).toBe(false)
    expect(validateRecordStockMovement({ productId: id, type: 'RECEIPT', quantity: 1, reasonCode: 'CUSTOM', note: null }).ok).toBe(false)
    expect(validateRecordStockMovement({ productId: id, type: 'RECEIPT', quantity: 0, reasonCode: 'OTHER', note: null }).ok).toBe(false)
    expect(validateRecordStockMovement({ productId: id, type: 'ADJUSTMENT', countedStock: -1, reasonCode: 'STOCKTAKE', note: null }).ok).toBe(false)
    expect(validateStockMovementQuery(query({ startAt: '2026-01-01T00:00:00.000Z' })).ok).toBe(true)
    expect(validateStockMovementQuery(query({ startAt: '2026-02-31T00:00:00.000Z' })).ok).toBe(false)
    expect(validateStockMovementQuery({ ...query(), unexpected: true }).ok).toBe(false)
  })

  it('records receipt, exact issue and zero adjustment from latest database stock', async () => {
    await setup()
    const product = catalog.createProduct(adminToken, 1, draft())
    const received = inventory.record(adminToken, 1, record(product.id, { type: 'RECEIPT', quantity: 3, reasonCode: 'DELIVERY' }))
    expect(received).toMatchObject({ currentStock: 3, movement: { stockBefore: 0, quantityDelta: 3, stockAfter: 3 } })
    const firstIssue = inventory.record(adminToken, 1, record(product.id, { type: 'ISSUE', quantity: 2, reasonCode: 'OTHER' }))
    expect(firstIssue).toMatchObject({ currentStock: 1, movement: { stockBefore: 3, quantityDelta: -2, stockAfter: 1 } })
    const secondIssue = inventory.record(adminToken, 1, record(product.id, { type: 'ISSUE', quantity: 1, reasonCode: 'OTHER' }))
    expect(secondIssue).toMatchObject({ currentStock: 0, movement: { stockBefore: 1, quantityDelta: -1, stockAfter: 0 } })
    const count = inventory.record(adminToken, 1, { productId: product.id, type: 'ADJUSTMENT', countedStock: 0, reasonCode: 'STOCKTAKE', note: null })
    expect(count).toMatchObject({ currentStock: 0, movement: { quantityDelta: 0, stockBefore: 0, stockAfter: 0 } })
    expect(db!.prepare('SELECT current_stock FROM products WHERE id=?').get(product.id)).toMatchObject({ current_stock: 0 })
    expect(inventory.list(adminToken, 1, query({ productId: product.id })).total).toBe(4)
    const noMinimum = catalog.createProduct(adminToken, 1, draft({ sku: 'STOCK-2', reorderLevel: 0 }))
    expect(inventory.record(adminToken, 1, { productId: noMinimum.id, type: 'ADJUSTMENT', countedStock: 0, reasonCode: 'STOCKTAKE', note: null }).movement.quantityDelta).toBe(0)
    const atMinimum = catalog.createProduct(adminToken, 1, draft({ sku: 'STOCK-3', reorderLevel: 2 }))
    inventory.record(adminToken, 1, { productId: atMinimum.id, type: 'ADJUSTMENT', countedStock: 2, reasonCode: 'STOCKTAKE', note: null })
    const overMinimum = catalog.createProduct(adminToken, 1, draft({ sku: 'STOCK-4', reorderLevel: 1 }))
    inventory.record(adminToken, 1, { productId: overMinimum.id, type: 'ADJUSTMENT', countedStock: 2, reasonCode: 'STOCKTAKE', note: null })
    const inactive = catalog.createProduct(adminToken, 1, draft({ sku: 'STOCK-5', reorderLevel: 2 }))
    catalog.deactivateProduct(adminToken, 1, inactive.id)
    expect(inventory.dashboard(adminToken, 1)).toMatchObject({ registeredProductCount: 5, activeProductCount: 4, lowStockProductCount: 2, zeroStockProductCount: 2 })
    expect(catalog.listProducts(adminToken, 1, { search: '', categoryId: null, status: 'ACTIVE', stockFilter: 'LOW', sortKey: 'name', direction: 'asc', page: 1, pageSize: 50 }).items.map((item) => item.id)).toEqual([product.id, atMinimum.id])
    expect(catalog.listProducts(adminToken, 1, { search: '', categoryId: null, status: 'ACTIVE', stockFilter: 'ZERO', sortKey: 'name', direction: 'asc', page: 1, pageSize: 50 }).items).toHaveLength(2)
  })

  it('rejects shortage, disabled products and out-of-range adjustments without writes', async () => {
    await setup()
    const product = catalog.createProduct(adminToken, 1, draft())
    expect(() => inventory.record(adminToken, 1, record(product.id, { type: 'ISSUE', quantity: 1 }))).toThrowError(AppError)
    inventory.record(adminToken, 1, { productId: product.id, type: 'ADJUSTMENT', countedStock: MAX_STOCK, reasonCode: 'STOCKTAKE', note: null })
    expect(() => inventory.record(adminToken, 1, record(product.id, { type: 'RECEIPT', quantity: 1 }))).toThrowError(AppError)
    catalog.deactivateProduct(adminToken, 1, product.id)
    expect(() => inventory.record(adminToken, 1, { productId: product.id, type: 'ADJUSTMENT', countedStock: 0, reasonCode: 'STOCKTAKE', note: null })).toThrowError(AppError)
    expect((db!.prepare('SELECT COUNT(*) AS n FROM stock_movements').get() as { n: number }).n).toBe(1)
  })

  it('rolls back product, movement and audit when movement or audit insertion fails', async () => {
    await setup()
    const product = catalog.createProduct(adminToken, 1, draft())
    const beforeAudit = Number((db!.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE action=\'STOCK_RECORDED\'').get() as { n: number }).n)
    db!.exec(`CREATE TRIGGER reject_movement BEFORE INSERT ON stock_movements BEGIN SELECT RAISE(ABORT,'movement failure'); END`)
    expect(() => inventory.record(adminToken, 1, record(product.id))).toThrow()
    db!.exec('DROP TRIGGER reject_movement')
    expect(db!.prepare('SELECT current_stock FROM products WHERE id=?').get(product.id)).toMatchObject({ current_stock: 0 })
    expect((db!.prepare('SELECT COUNT(*) AS n FROM stock_movements').get() as { n: number }).n).toBe(0)
    db!.exec(`CREATE TRIGGER reject_stock_audit BEFORE INSERT ON audit_logs WHEN NEW.action='STOCK_RECORDED' BEGIN SELECT RAISE(ABORT,'audit failure'); END`)
    expect(() => inventory.record(adminToken, 1, record(product.id))).toThrow()
    expect(db!.prepare('SELECT current_stock FROM products WHERE id=?').get(product.id)).toMatchObject({ current_stock: 0 })
    expect((db!.prepare('SELECT COUNT(*) AS n FROM stock_movements').get() as { n: number }).n).toBe(0)
    expect((db!.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE action=\'STOCK_RECORDED\'').get() as { n: number }).n).toBe(beforeAudit)
  })

  it('keeps actor snapshots after rename/deactivation and applies inclusive UTC start/exclusive end filters', async () => {
    let now = Date.parse('2026-01-01T23:59:59.999Z')
    await setup(() => now)
    const product = catalog.createProduct(adminToken, 1, draft())
    const staff = await auth.createUser(adminToken, 1, { loginName: 'worker', displayName: '記録時の担当', role: 'STAFF' })
    const reset = await auth.beginPasswordReset('worker', staff.code, 2)
    await auth.completePasswordReset(reset.token, 2, 'worker inventory passphrase')
    const worker = await auth.login('worker', 'worker inventory passphrase', 2)
    inventory.record(worker.token, 2, record(product.id, { type: 'RECEIPT', quantity: 1 }))
    now = Date.parse('2026-01-02T00:00:00.000Z')
    inventory.record(adminToken, 1, record(product.id, { type: 'RECEIPT', quantity: 1 }))
    auth.updateUser(adminToken, 1, { userId: staff.user.id, displayName: '変更後の担当', role: 'STAFF' })
    auth.deactivateUser(adminToken, 1, staff.user.id)
    const history = inventory.list(adminToken, 1, query({ productId: product.id, actorUserId: staff.user.id }))
    expect(history.items[0]).toMatchObject({ actorDisplayName: '記録時の担当', actorLoginName: 'worker' })
    const boundary = inventory.list(adminToken, 1, query({ startAt: '2026-01-02T00:00:00.000Z', endAt: '2026-01-03T00:00:00.000Z' }))
    expect(boundary.items).toHaveLength(1)
    expect(boundary.items[0]?.actorDisplayName).toBe('管理者')
    expect(inventory.list(adminToken, 1, query({ endAt: '2026-01-02T00:00:00.000Z' })).items).toHaveLength(1)
    expect(inventory.list(adminToken, 1, query({ type: 'RECEIPT', pageSize: 1, page: 2 })).total).toBe(2)
  })

  it('converts local date boundaries independently so daylight-saving changes use local midnights', () => {
    const range = localDateRangeToUtc('2024-03-10', '2024-03-10')
    expect(range.startAt).toBe(new Date(2024, 2, 10).toISOString())
    expect(range.endAt).toBe(new Date(2024, 2, 11).toISOString())
    expect(() => localDateRangeToUtc('2024-02-30', '')).toThrow(RangeError)
    expect(() => localDateRangeToUtc('2024-03-11', '2024-03-10')).toThrow(RangeError)
  })
})
