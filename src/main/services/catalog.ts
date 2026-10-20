import { randomUUID } from 'node:crypto'
import type { CategorySummary, CreateProductInput, Page, ProductListQuery, ProductSummary, Role, UpdateCategoryInput, UpdateProductInput } from '../../shared/contracts'
import type { StoreDatabase } from '../db/connection'
import { CatalogRepository } from '../db/repositories/catalog'
import { AppError, AuthService } from '../auth/service'
import { audit, type AuditActor } from './audit'
import type { InventoryService } from './inventory'

function translateConstraint(error: unknown, entity: 'product' | 'category'): never {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('UNIQUE')) throw new AppError(entity === 'product' ? 'DUPLICATE_SKU' : 'DUPLICATE_CATEGORY')
  throw error
}

export class CatalogService {
  private readonly repository: CatalogRepository
  constructor(private readonly db: StoreDatabase, private readonly auth: AuthService, private readonly inventory: InventoryService, private readonly clock: () => number = Date.now) {
    this.repository = new CatalogRepository(db)
  }
  private now(): string { return new Date(this.clock()).toISOString() }
  private requireActor(token: string, senderId: number, role?: Role): AuditActor {
    this.auth.canUseProtected(token, senderId, role)
    const currentRole = this.auth.getCurrentRole(token, senderId)
    const session = this.auth.getSession(senderId)
    if (!session || session.state !== 'AUTHENTICATED') throw new AppError('AUTH_REQUIRED')
    if (role && currentRole !== role) throw new AppError('FORBIDDEN')
    return { id: session.user.id, loginName: session.user.loginName, displayName: session.user.displayName, role: currentRole }
  }
  listProducts(token: string, senderId: number, query: ProductListQuery): Page<ProductSummary> {
    this.auth.canUseProtected(token, senderId)
    return this.repository.listProducts(query)
  }
  listCategories(token: string, senderId: number, includeInactive: boolean): CategorySummary[] {
    this.auth.canUseProtected(token, senderId)
    return this.repository.listCategories(includeInactive)
  }
  createProduct(token: string, senderId: number, input: CreateProductInput): ProductSummary {
    if (!Number.isSafeInteger(input.initialStock) || input.initialStock < 0 || input.initialStock > 2_147_483_647) throw new AppError('VALIDATION_ERROR')
    const actor = this.requireActor(token, senderId, 'ADMIN')
    const id = randomUUID(); const now = this.now(); const sku = input.sku.trim(); const name = input.name.trim()
    try {
      this.db.transaction(() => {
        if (input.categoryId) {
          const category = this.repository.getCategory(input.categoryId)
          if (!category) throw new AppError('NOT_FOUND')
          if (!category.is_active) throw new AppError('INACTIVE_ENTITY')
        }
        this.db.prepare(`INSERT INTO products(id,sku,name,name_search_key,category_id,unit,current_stock,reorder_level,note,is_active,created_at,updated_at)
          VALUES(?,?,?,?,?,?,0,?,?,1,?,?)`).run(id, sku, name, name.toLowerCase(), input.categoryId, input.unit.trim(), input.reorderLevel, input.note?.trim() || null, now, now)
        audit(this.db, 'PRODUCT_CREATED', actor, 'product', id, { sku, name, categoryId: input.categoryId, unit: input.unit.trim(), reorderLevel: input.reorderLevel })
        if (input.initialStock > 0) this.inventory.recordOpeningForNewProduct(id, input.initialStock, actor)
      }).immediate()
    } catch (error) { translateConstraint(error, 'product') }
    const product = this.repository.getProduct(id)
    if (!product) throw new AppError('DATABASE_ERROR')
    return product
  }
  updateProduct(token: string, senderId: number, input: UpdateProductInput): ProductSummary {
    const actor = this.requireActor(token, senderId, 'ADMIN'); const now = this.now(); const sku = input.sku.trim(); const name = input.name.trim()
    try {
      this.db.transaction(() => {
        const old = this.repository.getProduct(input.productId)
        if (!old) throw new AppError('NOT_FOUND')
        if (input.categoryId) {
          const category = this.repository.getCategory(input.categoryId)
          if (!category) throw new AppError('NOT_FOUND')
          if (!category.is_active && input.categoryId !== old.categoryId) throw new AppError('INACTIVE_ENTITY')
        }
        this.db.prepare(`UPDATE products SET sku=?,name=?,name_search_key=?,category_id=?,unit=?,reorder_level=?,note=?,updated_at=? WHERE id=?`)
          .run(sku, name, name.toLowerCase(), input.categoryId, input.unit.trim(), input.reorderLevel, input.note?.trim() || null, now, input.productId)
        audit(this.db, 'PRODUCT_UPDATED', actor, 'product', input.productId, {
          oldSku: old.sku, newSku: sku, oldName: old.name, newName: name,
          oldCategoryId: old.categoryId, newCategoryId: input.categoryId,
          oldUnit: old.unit, newUnit: input.unit.trim(), oldReorderLevel: old.reorderLevel, newReorderLevel: input.reorderLevel
        })
      }).immediate()
    } catch (error) { translateConstraint(error, 'product') }
    const product = this.repository.getProduct(input.productId)
    if (!product) throw new AppError('DATABASE_ERROR')
    return product
  }
  deactivateProduct(token: string, senderId: number, productId: string): void {
    const actor = this.requireActor(token, senderId, 'ADMIN'); const now = this.now()
    this.db.transaction(() => {
      const product = this.repository.getProduct(productId)
      if (!product) throw new AppError('NOT_FOUND')
      if (product.isActive) {
        this.db.prepare('UPDATE products SET is_active=0,updated_at=? WHERE id=?').run(now, productId)
        audit(this.db, 'PRODUCT_DEACTIVATED', actor, 'product', productId, { sku: product.sku, name: product.name })
      }
    }).immediate()
  }
  createCategory(token: string, senderId: number, nameInput: string): CategorySummary {
    const actor = this.requireActor(token, senderId, 'ADMIN'); const id = randomUUID(); const name = nameInput.trim(); const now = this.now()
    try {
      this.db.transaction(() => {
        this.db.prepare('INSERT INTO categories(id,name,name_key,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(id, name, name.toLowerCase(), now, now)
        audit(this.db, 'CATEGORY_CREATED', actor, 'category', id, { name })
      }).immediate()
    } catch (error) { translateConstraint(error, 'category') }
    return { id, name, isActive: true }
  }
  updateCategory(token: string, senderId: number, input: UpdateCategoryInput): CategorySummary {
    const actor = this.requireActor(token, senderId, 'ADMIN'); const name = input.name.trim(); const now = this.now()
    try {
      this.db.transaction(() => {
        const old = this.repository.getCategory(input.categoryId)
        if (!old) throw new AppError('NOT_FOUND')
        this.db.prepare('UPDATE categories SET name=?,name_key=?,updated_at=? WHERE id=?').run(name, name.toLowerCase(), now, input.categoryId)
        audit(this.db, 'CATEGORY_UPDATED', actor, 'category', input.categoryId, { oldName: old.name, newName: name })
      }).immediate()
    } catch (error) { translateConstraint(error, 'category') }
    const updated = this.repository.getCategory(input.categoryId)
    if (!updated) throw new AppError('DATABASE_ERROR')
    return { id: updated.id, name: updated.name, isActive: !!updated.is_active }
  }
  deactivateCategory(token: string, senderId: number, categoryId: string): void {
    const actor = this.requireActor(token, senderId, 'ADMIN'); const now = this.now()
    this.db.transaction(() => {
      const category = this.repository.getCategory(categoryId)
      if (!category) throw new AppError('NOT_FOUND')
      if (category.is_active) {
        this.db.prepare('UPDATE categories SET is_active=0,updated_at=? WHERE id=?').run(now, categoryId)
        audit(this.db, 'CATEGORY_DEACTIVATED', actor, 'category', categoryId, { name: category.name })
      }
    }).immediate()
  }
}
