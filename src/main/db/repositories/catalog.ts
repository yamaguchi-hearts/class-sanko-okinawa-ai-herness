import type { CategorySummary, Page, ProductListQuery, ProductSummary } from '../../../shared/contracts'
import type { StoreDatabase } from '../connection'

type ProductRow = {
  id: string; sku: string; name: string; category_id: string | null; category_name: string | null; category_active: number | null
  unit: string; current_stock: number; reorder_level: number; note: string | null; is_active: number; created_at: string; updated_at: string
  image_updated_at: string | null
}
const toProduct = (r: ProductRow): ProductSummary => ({
  id: r.id, sku: r.sku, name: r.name, categoryId: r.category_id, categoryName: r.category_name,
  categoryActive: r.category_active === null ? null : !!r.category_active,
  unit: r.unit, currentStock: r.current_stock, reorderLevel: r.reorder_level, note: r.note,
  isActive: !!r.is_active, createdAt: r.created_at, updatedAt: r.updated_at, hasImage: r.image_updated_at !== null, imageUpdatedAt: r.image_updated_at
})

export class CatalogRepository {
  constructor(private readonly db: StoreDatabase) {}
  listCategories(includeInactive: boolean): CategorySummary[] {
    const rows = includeInactive
      ? this.db.prepare('SELECT id,name,is_active FROM categories ORDER BY name_key COLLATE NOCASE ASC,id ASC').all()
      : this.db.prepare('SELECT id,name,is_active FROM categories WHERE is_active=1 ORDER BY name_key COLLATE NOCASE ASC,id ASC').all()
    return (rows as Array<{ id: string; name: string; is_active: number }>).map((r) => ({ id: r.id, name: r.name, isActive: !!r.is_active }))
  }
  getCategory(id: string): { id: string; name: string; name_key: string; is_active: number } | undefined {
    return this.db.prepare('SELECT id,name,name_key,is_active FROM categories WHERE id=?').get(id) as { id: string; name: string; name_key: string; is_active: number } | undefined
  }
  getProduct(id: string): ProductSummary | undefined {
    const row = this.db.prepare(`SELECT p.*,c.name AS category_name,c.is_active AS category_active,pi.updated_at AS image_updated_at
      FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN product_images pi ON pi.product_id=p.id WHERE p.id=?`).get(id) as ProductRow | undefined
    return row ? toProduct(row) : undefined
  }
  listProducts(query: ProductListQuery): Page<ProductSummary> {
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.status === 'ACTIVE') where.push('p.is_active=1')
    if (query.status === 'INACTIVE') where.push('p.is_active=0')
    if (query.categoryId) { where.push('p.category_id=?'); params.push(query.categoryId) }
    if (query.stockFilter === 'ZERO') where.push('p.current_stock=0')
    if (query.stockFilter === 'LOW') where.push('p.reorder_level>0 AND p.current_stock<=p.reorder_level')
    const search = query.search.trim().toLowerCase()
    if (search) {
      const literal = `%${search.replace(/[\\%_]/g, '\\$&')}%`
      where.push("(p.sku LIKE ? ESCAPE '\\' COLLATE NOCASE OR p.name_search_key LIKE ? ESCAPE '\\' COLLATE NOCASE)")
      params.push(literal, literal)
    }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const sortColumns = { name: 'p.name_search_key COLLATE NOCASE', sku: 'p.sku COLLATE NOCASE', currentStock: 'p.current_stock', reorderLevel: 'p.reorder_level' } as const
    const direction = query.direction.toUpperCase()
    const order = `${sortColumns[query.sortKey]} ${direction},p.name_search_key COLLATE NOCASE ASC,p.sku COLLATE NOCASE ASC,p.id ASC`
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS total FROM products p ${filter}`).get(...params) as { total: number }).total)
    const rows = this.db.prepare(`SELECT p.*,c.name AS category_name,c.is_active AS category_active,pi.updated_at AS image_updated_at
      FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN product_images pi ON pi.product_id=p.id ${filter} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as ProductRow[]
    return { items: rows.map(toProduct), total, page: query.page, pageSize: query.pageSize }
  }
}
