import { randomUUID } from 'node:crypto'
import type { StoreDatabase } from '../db/connection'
import { audit, type AuditActor } from '../services/audit'

const categories = ['飲料', '食品', '日用品'] as const

const products = [
  { sku: 'DEMO-DRINK-001', name: 'さんぴん茶 600ml', category: '飲料', unit: '本', stock: 24, reorderLevel: 6 },
  { sku: 'DEMO-DRINK-002', name: 'シークヮーサー飲料 500ml', category: '飲料', unit: '本', stock: 12, reorderLevel: 4 },
  { sku: 'DEMO-FOOD-001', name: '沖縄そば 2食入り', category: '食品', unit: '袋', stock: 16, reorderLevel: 5 },
  { sku: 'DEMO-FOOD-002', name: '黒糖 200g', category: '食品', unit: '袋', stock: 10, reorderLevel: 3 },
  { sku: 'DEMO-FOOD-003', name: 'ちんすこう 6個入り', category: '食品', unit: '箱', stock: 2, reorderLevel: 5 },
  { sku: 'DEMO-DAILY-001', name: 'ゴミ袋 45L 10枚入り', category: '日用品', unit: '袋', stock: 8, reorderLevel: 2 }
] as const

export function seedDemoData(db: StoreDatabase, actor: AuditActor, now: string): void {
  const categoryIds = new Map<string, string>()
  const insertCategory = db.prepare('INSERT INTO categories(id,name,name_key,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)')
  for (const name of categories) {
    const id = randomUUID()
    insertCategory.run(id, name, name.toLowerCase(), now, now)
    categoryIds.set(name, id)
    audit(db, 'CATEGORY_CREATED', actor, 'category', id, { name, source: 'DEMO_SEED' })
  }

  const insertProduct = db.prepare(`INSERT INTO products(id,sku,name,name_search_key,category_id,unit,current_stock,reorder_level,note,is_active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'DEMOサンプルデータ',1,?,?)`)
  const insertMovement = db.prepare(`INSERT INTO stock_movements(id,product_id,movement_type,quantity_delta,stock_before,stock_after,reason_code,note,
    actor_user_id,actor_login_snapshot,actor_name_snapshot,created_at) VALUES(?,?,'OPENING',?,0,?,'OTHER','初期デモデータの在庫',?,?,?,?)`)

  for (const item of products) {
    const id = randomUUID()
    insertProduct.run(id, item.sku, item.name, item.name.toLowerCase(), categoryIds.get(item.category), item.unit, item.stock, item.reorderLevel, now, now)
    audit(db, 'PRODUCT_CREATED', actor, 'product', id, {
      sku: item.sku, name: item.name, categoryId: categoryIds.get(item.category)!, unit: item.unit,
      reorderLevel: item.reorderLevel, source: 'DEMO_SEED'
    })
    const movementId = randomUUID()
    insertMovement.run(movementId, id, item.stock, item.stock, actor.id, actor.loginName, actor.displayName, now)
    audit(db, 'STOCK_RECORDED', actor, 'stock_movement', movementId, {
      productId: id, sku: item.sku, productName: item.name, type: 'OPENING', quantityDelta: item.stock,
      stockBefore: 0, stockAfter: item.stock, reasonCode: 'OTHER', source: 'DEMO_SEED'
    })
  }

  db.prepare("INSERT INTO app_meta(key,value) VALUES('demo_data_seeded_at',?)").run(now)
}
