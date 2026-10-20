import type { DashboardSummary, Page, StockActorOption, StockMovementQuery, StockMovementSummary } from '../../../shared/contracts'
import type { StoreDatabase } from '../connection'

type MovementRow = {
  id: string; product_id: string; product_sku: string; product_name: string; movement_type: StockMovementSummary['type']
  quantity_delta: number; stock_before: number; stock_after: number; reason_code: StockMovementSummary['reasonCode']; note: string | null
  actor_user_id: string | null; actor_login_snapshot: string; actor_name_snapshot: string; created_at: string
}
const toMovement = (row: MovementRow): StockMovementSummary => ({
  id: row.id, productId: row.product_id, productSku: row.product_sku, productName: row.product_name, type: row.movement_type,
  quantityDelta: row.quantity_delta, stockBefore: row.stock_before, stockAfter: row.stock_after, reasonCode: row.reason_code,
  note: row.note, actorUserId: row.actor_user_id, actorLoginName: row.actor_login_snapshot,
  actorDisplayName: row.actor_name_snapshot, createdAt: row.created_at
})

export class InventoryRepository {
  constructor(private readonly db: StoreDatabase) {}

  getProductForStock(productId: string): { id: string; sku: string; name: string; current_stock: number; is_active: number } | undefined {
    return this.db.prepare('SELECT id,sku,name,current_stock,is_active FROM products WHERE id=?').get(productId) as
      { id: string; sku: string; name: string; current_stock: number; is_active: number } | undefined
  }

  updateCurrentStock(productId: string, expectedStock: number, nextStock: number, updatedAt: string): void {
    const result = this.db.prepare('UPDATE products SET current_stock=?,updated_at=? WHERE id=? AND current_stock=? AND is_active=1')
      .run(nextStock, updatedAt, productId, expectedStock)
    if (result.changes !== 1) throw new Error('STOCK_WRITE_CONFLICT')
  }

  insertMovement(input: {
    id: string; productId: string; type: StockMovementSummary['type']; delta: number; before: number; after: number
    reasonCode: StockMovementSummary['reasonCode']; note: string | null; actorId: string; actorLogin: string; actorName: string; createdAt: string
  }): void {
    this.db.prepare(`INSERT INTO stock_movements(id,product_id,movement_type,quantity_delta,stock_before,stock_after,reason_code,note,
      actor_user_id,actor_login_snapshot,actor_name_snapshot,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(input.id, input.productId, input.type, input.delta, input.before, input.after, input.reasonCode, input.note,
        input.actorId, input.actorLogin, input.actorName, input.createdAt)
  }

  listMovements(query: StockMovementQuery): Page<StockMovementSummary> {
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.productId) { where.push('m.product_id=?'); params.push(query.productId) }
    if (query.startAt) { where.push('m.created_at>=?'); params.push(query.startAt) }
    if (query.endAt) { where.push('m.created_at<?'); params.push(query.endAt) }
    if (query.type) { where.push('m.movement_type=?'); params.push(query.type) }
    if (query.actorUserId) { where.push('m.actor_user_id=?'); params.push(query.actorUserId) }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS total FROM stock_movements m ${filter}`).get(...params) as { total: number }).total)
    const rows = this.db.prepare(`SELECT m.*,p.sku AS product_sku,p.name AS product_name FROM stock_movements m
      JOIN products p ON p.id=m.product_id ${filter} ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?`)
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as MovementRow[]
    return { items: rows.map(toMovement), total, page: query.page, pageSize: query.pageSize }
  }

  listActors(): StockActorOption[] {
    return this.db.prepare(`SELECT userId,loginName,displayName FROM (
      SELECT actor_user_id AS userId,actor_login_snapshot AS loginName,actor_name_snapshot AS displayName,
        ROW_NUMBER() OVER(PARTITION BY actor_user_id ORDER BY created_at DESC,id DESC) AS rank
      FROM stock_movements WHERE actor_user_id IS NOT NULL
    ) WHERE rank=1 ORDER BY displayName COLLATE NOCASE,loginName COLLATE NOCASE,userId`)
      .all() as StockActorOption[]
  }

  dashboard(): DashboardSummary {
    const counts = this.db.prepare(`SELECT COUNT(*) AS registered,COUNT(CASE WHEN is_active=1 THEN 1 END) AS active,
      COUNT(CASE WHEN is_active=1 AND reorder_level>0 AND current_stock<=reorder_level THEN 1 END) AS low,
      COUNT(CASE WHEN is_active=1 AND current_stock=0 THEN 1 END) AS zero FROM products`).get() as
      { registered: number; active: number; low: number; zero: number }
    const recentMovements = this.db.prepare(`SELECT m.*,p.sku AS product_sku,p.name AS product_name FROM stock_movements m
      JOIN products p ON p.id=m.product_id ORDER BY m.created_at DESC,m.id DESC LIMIT 10`).all() as MovementRow[]
    return {
      registeredProductCount: counts.registered, activeProductCount: counts.active, lowStockProductCount: counts.low,
      zeroStockProductCount: counts.zero, recentMovements: recentMovements.map(toMovement)
    }
  }
}
