import { randomUUID } from 'node:crypto'
import type { DashboardSummary, Page, RecordStockMovementInput, RecordStockMovementResult, Role, StockActorOption, StockMovementQuery, StockMovementSummary } from '../../shared/contracts'
import { calculateStockChange } from '../../shared/domain/inventory'
import type { StoreDatabase } from '../db/connection'
import { InventoryRepository } from '../db/repositories/inventory'
import { AppError, AuthService } from '../auth/service'
import { audit } from './audit'

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
