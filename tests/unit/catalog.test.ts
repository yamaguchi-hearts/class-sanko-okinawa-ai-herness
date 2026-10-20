import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStoreDatabase } from '../../src/main/db/connection'
import { AppError, AuthService } from '../../src/main/auth/service'
import { CatalogService } from '../../src/main/services/catalog'
import type { ProductDraft, ProductListQuery } from '../../src/shared/contracts'
import { validateCategoryName, validateCreateProduct, validateProductListQuery } from '../../src/shared/validation'

let dir = ''
let db: ReturnType<typeof openStoreDatabase> | null = null
let auth: AuthService
let catalog: CatalogService
let adminToken = ''
afterEach(() => { db?.close(); db = null; if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); dir = '' })
async function setup(): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), 'inventory-catalog-')); db = openStoreDatabase(join(dir, 'store.sqlite'))
  auth = new AuthService(db); catalog = new CatalogService(db, auth)
  const admin = await auth.setup({ storeName: '検証店舗', displayName: '管理者', loginName: 'admin', password: 'catalog test passphrase' }, 1)
  adminToken = admin.token
}
const query = (patch: Partial<ProductListQuery> = {}): ProductListQuery => ({ search: '', categoryId: null, status: 'ALL', stockFilter: 'ALL', sortKey: 'name', direction: 'asc', page: 1, pageSize: 50, ...patch })
const product = (patch: Partial<ProductDraft> = {}): ProductDraft => ({ sku: 'SKU-1', name: '試験商品', categoryId: null, unit: '個', reorderLevel: 0, note: null, ...patch })

describe('catalog and category foundation', () => {
  it('starts at migration 3 and creates products with zero stock and no stock update DTO', async () => {
    await setup()
    expect((db!.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version).toBe(3)
    const created = catalog.createProduct(adminToken, 1, product())
    expect(created.currentStock).toBe(0)
    expect(validateCreateProduct({ ...product(), currentStock: 500 }).ok).toBe(false)
    expect((db!.prepare("SELECT current_stock FROM products WHERE id=?").get(created.id) as { current_stock: number }).current_stock).toBe(0)
  })

  it('validates normalized boundaries, SKU alphabet, and page size', () => {
    const atLimit = { ...product(), sku: ` ${'A'.repeat(64)} `, name: ` ${'商'.repeat(200)} `, unit: ` ${'単'.repeat(16)} ` }
    expect(validateCreateProduct(atLimit).ok).toBe(true)
    expect(validateCreateProduct({ ...atLimit, sku: `${'A'.repeat(65)}` }).ok).toBe(false)
    expect(validateCreateProduct({ ...product(), sku: '商品-01' }).ok).toBe(false)
    expect(validateCreateProduct({ ...product(), reorderLevel: 2_147_483_648 }).ok).toBe(false)
    expect(validateCategoryName({ name: ` ${'分類'.repeat(50)} ` }).ok).toBe(true)
    expect(validateProductListQuery(query({ pageSize: 201 })).ok).toBe(false)
  })

  it('normalizes SKU spacing, prevents case-insensitive reuse even after deactivation and rejects edit duplicates', async () => {
    await setup()
    const one = catalog.createProduct(adminToken, 1, product({ sku: '  AbC_1  ' }))
    const two = catalog.createProduct(adminToken, 1, product({ sku: 'SKU-2', name: '別商品' }))
    expect(one.sku).toBe('AbC_1')
    expect(() => catalog.updateProduct(adminToken, 1, { ...product({ sku: 'abc_1' }), productId: two.id })).toThrowError(AppError)
    catalog.deactivateProduct(adminToken, 1, one.id)
    expect(() => catalog.createProduct(adminToken, 1, product({ sku: 'abc_1' }))).toThrowError(AppError)
    expect(catalog.listProducts(adminToken, 1, query({ status: 'INACTIVE' })).items.map((p) => p.id)).toContain(one.id)
  })

  it('keeps an inactive category on its existing product but disallows selecting it for new products', async () => {
    await setup()
    const category = catalog.createCategory(adminToken, 1, '備品')
    expect(catalog.updateCategory(adminToken, 1, { categoryId: category.id, name: '備品・工具' }).name).toBe('備品・工具')
    const item = catalog.createProduct(adminToken, 1, product({ categoryId: category.id }))
    catalog.deactivateCategory(adminToken, 1, category.id)
    expect(catalog.listProducts(adminToken, 1, query()).items[0]).toMatchObject({ categoryId: category.id, categoryName: '備品・工具', categoryActive: false })
    expect(catalog.updateProduct(adminToken, 1, { ...product({ sku: item.sku, name: '編集商品', categoryId: category.id }), productId: item.id }).categoryActive).toBe(false)
    expect(() => catalog.createProduct(adminToken, 1, product({ sku: 'SKU-OTHER', categoryId: category.id }))).toThrowError(AppError)
    const other = catalog.createCategory(adminToken, 1, '日用品')
    expect(catalog.updateProduct(adminToken, 1, { ...product({ sku: item.sku, categoryId: other.id }), productId: item.id }).categoryId).toBe(other.id)
    expect(catalog.listCategories(adminToken, 1, true)).toHaveLength(2)
  })

  it('treats percent and underscore as literal search text and pages in stable order', async () => {
    await setup()
    const under = catalog.createProduct(adminToken, 1, product({ sku: 'BOX_01', name: '50% bundle' }))
    const alpha = catalog.createProduct(adminToken, 1, product({ sku: 'A-2', name: 'Alpha' }))
    const beta = catalog.createProduct(adminToken, 1, product({ sku: 'B-1', name: 'Beta' }))
    expect(catalog.listProducts(adminToken, 1, query({ search: '%' })).items.map((p) => p.id)).toEqual([under.id])
    expect(catalog.listProducts(adminToken, 1, query({ search: '_' })).items.map((p) => p.id)).toEqual([under.id])
    expect(catalog.listProducts(adminToken, 1, query({ search: '  alpha ' })).items.map((p) => p.id)).toEqual([alpha.id])
    const pageOne = catalog.listProducts(adminToken, 1, query({ pageSize: 1, page: 1 }))
    const pageTwo = catalog.listProducts(adminToken, 1, query({ pageSize: 1, page: 2 }))
    const pageThree = catalog.listProducts(adminToken, 1, query({ pageSize: 1, page: 3 }))
    expect(pageOne.items[0]?.id).toBe(under.id)
    expect(pageTwo.items[0]?.id).toBe(alpha.id)
    expect(pageThree.items[0]?.id).toBe(beta.id)
    expect(pageOne.total).toBe(3)
  })

  it('allows STAFF to read catalog but denies all mutation services and rolls audit failures back', async () => {
    await setup()
    const issued = await auth.createUser(adminToken, 1, { loginName: 'staff', displayName: '担当者', role: 'STAFF' })
    const limited = await auth.beginPasswordReset('staff', issued.code, 2)
    await auth.completePasswordReset(limited.token, 2, 'staff catalog passphrase')
    const staff = await auth.login('staff', 'staff catalog passphrase', 2)
    expect(catalog.listProducts(staff.token, 2, query()).total).toBe(0)
    expect(() => catalog.createProduct(staff.token, 2, product())).toThrowError(AppError)
    expect(() => catalog.createCategory(staff.token, 2, '禁止')).toThrowError(AppError)
    db!.exec(`CREATE TRIGGER reject_category_audit BEFORE INSERT ON audit_logs WHEN NEW.action='CATEGORY_CREATED' BEGIN SELECT RAISE(ABORT,'audit failure'); END`)
    expect(() => catalog.createCategory(adminToken, 1, '監査失敗')).toThrow()
    expect((db!.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n).toBe(0)
    db!.exec(`CREATE TRIGGER reject_product_audit BEFORE INSERT ON audit_logs WHEN NEW.action='PRODUCT_CREATED' BEGIN SELECT RAISE(ABORT,'audit failure'); END`)
    expect(() => catalog.createProduct(adminToken, 1, product())).toThrow()
    expect((db!.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n).toBe(0)
  })

  it('rejects category names that collide after normalization', async () => {
    await setup()
    catalog.createCategory(adminToken, 1, '  Tools ')
    expect(() => catalog.createCategory(adminToken, 1, 'tools')).toThrowError(AppError)
  })
})
