import { randomUUID } from 'node:crypto'
import type { DashboardSummary, Page, RecordStockMovementInput, RecordStockMovementResult, Role, StockActorOption, StockMovementQuery, StockMovementSummary } from '../../shared/contracts'
import { calculateStockChange, MAX_STOCK } from '../../shared/domain/inventory'
import type { StoreDatabase } from '../db/connection'
import { InventoryRepository } from '../db/repositories/inventory'
import { AppError, AuthService } from '../auth/service'
import { audit, type AuditActor } from './audit'

export class InventoryService {
  private readonly repository: InventoryRepository
  constructor(private readonly db: StoreDatabase, private readonly auth: AuthService, private readonly clock: () => number = Date.now) {
    this.repository = new InventoryRepository(db)
  }

  private actor(token: string, senderId: number): Readonly<{ id: string; loginName: string; displayName: string; role: Role }> {
    this.auth.canUseProtected(token, senderId)
    const session = this.auth.getSession(senderId)
    if (!session || session.state !== 'AUTHENTICATED') throw new AppError('AUTH_REQUIRED')
    return { id: session.user.id, loginName: session.user.loginName, displayName: session.user.displayName, role: this.auth.getCurrentRole(token, senderId) }
  }

  record(token: string, senderId: number, input: RecordStockMovementInput): RecordStockMovementResult {
    const actor = this.actor(token, senderId)
    const movementId = randomUUID()
    const createdAt = new Date(this.clock()).toISOString()
    const result = this.db.transaction((): RecordStockMovementResult => {
      const product = this.repository.getProductForStock(input.productId)
      if (!product) throw new AppError('NOT_FOUND')
      if (!product.is_active) throw new AppError('INACTIVE_ENTITY')
      const calculation = calculateStockChange(product.current_stock, input)
      if (!calculation.ok) throw new AppError(calculation.code)
      this.repository.updateCurrentStock(product.id, product.current_stock, calculation.stockAfter, createdAt)
      this.repository.insertMovement({
        id: movementId, productId: product.id, type: input.type, delta: calculation.quantityDelta,
        before: product.current_stock, after: calculation.stockAfter, reasonCode: input.reasonCode, note: input.note,
        actorId: actor.id, actorLogin: actor.loginName, actorName: actor.displayName, createdAt
      })
      audit(this.db, 'STOCK_RECORDED', actor, 'stock_movement', movementId, {
        productId: product.id, sku: product.sku, productName: product.name, type: input.type,
        quantityDelta: calculation.quantityDelta, stockBefore: product.current_stock, stockAfter: calculation.stockAfter,
        reasonCode: input.reasonCode
      })
      return {
        currentStock: calculation.stockAfter,
        movement: {
          id: movementId, productId: product.id, productSku: product.sku, productName: product.name, type: input.type,
          quantityDelta: calculation.quantityDelta, stockBefore: product.current_stock, stockAfter: calculation.stockAfter,
          reasonCode: input.reasonCode, note: input.note, actorUserId: actor.id, actorLoginName: actor.loginName,
          actorDisplayName: actor.displayName, createdAt
        }
      }
    }).immediate()
    return result
  }

  recordOpeningForNewProduct(productId: string, initialStock: number, actor: AuditActor): void {
    if (!this.db.inTransaction) throw new Error('OPENING_REQUIRES_TRANSACTION')
    if (!Number.isSafeInteger(initialStock) || initialStock < 1 || initialStock > MAX_STOCK) throw new AppError('VALIDATION_ERROR')
    const product = this.repository.getProductForStock(productId)
    if (!product || !product.is_active) throw new AppError('NOT_FOUND')
    if (product.current_stock !== 0 || this.db.prepare('SELECT 1 FROM stock_movements WHERE product_id=? LIMIT 1').get(productId)) {
      throw new AppError('VALIDATION_ERROR')
    }
    const movementId = randomUUID()
    const createdAt = new Date(this.clock()).toISOString()
    this.repository.updateCurrentStock(product.id, 0, initialStock, createdAt)
    this.repository.insertMovement({
      id: movementId, productId: product.id, type: 'OPENING', delta: initialStock,
      before: 0, after: initialStock, reasonCode: 'OTHER', note: '商品登録時の初期在庫',
      actorId: actor.id, actorLogin: actor.loginName, actorName: actor.displayName, createdAt
    })
    audit(this.db, 'STOCK_RECORDED', actor, 'stock_movement', movementId, {
      productId: product.id, sku: product.sku, productName: product.name, type: 'OPENING',
      quantityDelta: initialStock, stockBefore: 0, stockAfter: initialStock, reasonCode: 'OTHER'
    })
  }

  list(token: string, senderId: number, query: StockMovementQuery): Page<StockMovementSummary> {
    this.auth.canUseProtected(token, senderId)
    return this.repository.listMovements(query)
  }

  dashboard(token: string, senderId: number): DashboardSummary {
    this.auth.canUseProtected(token, senderId)
    return this.repository.dashboard()
  }

  listActors(token: string, senderId: number): StockActorOption[] {
    this.auth.canUseProtected(token, senderId)
    return this.repository.listActors()
  }
}
