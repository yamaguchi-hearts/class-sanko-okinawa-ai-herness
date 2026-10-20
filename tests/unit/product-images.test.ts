import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openStoreDatabase } from '../../src/main/db/connection'
import { AppError, AuthService } from '../../src/main/auth/service'
import { CatalogService } from '../../src/main/services/catalog'
import { ProductImagesService } from '../../src/main/services/product-images'
import type { CreateProductInput } from '../../src/shared/contracts'

vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 10, height: 20 }),
      toPNG: () => Buffer.from('normalized-png')
    })
  }
}))

let dir = ''
let db: ReturnType<typeof openStoreDatabase> | null = null
let auth: AuthService
let images: ProductImagesService
let catalog: CatalogService
let adminToken = ''
let now = Date.parse('2026-01-01T00:00:00.000Z')

afterEach(() => {
  db?.close()
  db = null
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  dir = ''
  now = Date.parse('2026-01-01T00:00:00.000Z')
})

function pngFixture(width = 10, height = 20): Buffer {
  const content = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(content)
  content.write('IHDR', 12, 'ascii')
  content.writeUInt32BE(width, 16)
  content.writeUInt32BE(height, 20)
  return content
}

async function setup(): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), 'product-images-'))
  db = openStoreDatabase(join(dir, 'store.sqlite'))
  auth = new AuthService(db, () => now)
  images = new ProductImagesService(db, auth, () => now)
  catalog = new CatalogService(db, auth, () => now, images)
  const admin = await auth.setup({ storeName: '店舗', displayName: '管理者', loginName: 'admin', password: 'product image passphrase' }, 1)
  adminToken = admin.token
}

function draft(patch: Partial<CreateProductInput> = {}): CreateProductInput {
  return { sku: 'IMAGE-1', name: '画像商品', categoryId: null, unit: '個', reorderLevel: 0, note: null, initialStock: 0, imageSelectionId: null, ...patch }
}

function fixturePath(name: string, content: Buffer): string {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

describe('product image service and catalog integration', () => {
  it('validates a selection, persists it with a product, and serves both variants', async () => {
    await setup()
    const selected = await images.selectFile(adminToken, 1, fixturePath('valid.png', pngFixture()))
    expect(selected.previewDataUrl).toMatch(/^data:image\/png;base64,/)
    const pending = images.requireSelection(adminToken, 1, selected.selectionId)
    expect(pending).toMatchObject({ width: 10, height: 20 })

    const product = catalog.createProduct(adminToken, 1, draft({ imageSelectionId: selected.selectionId }))
    expect(product.hasImage).toBe(true)
    expect(db!.prepare('SELECT mime_type,width,height FROM product_images WHERE product_id=?').get(product.id)).toEqual({ mime_type: 'image/png', width: 10, height: 20 })
    expect(() => images.requireSelection(adminToken, 1, selected.selectionId)).toThrowError(AppError)
    await expect(images.get(adminToken, 1, product.id, 'DETAIL')).resolves.toMatchObject({ dataUrl: expect.stringContaining('data:image/png;base64,') })
    await expect(images.get(adminToken, 1, product.id, 'THUMBNAIL')).resolves.toMatchObject({ dataUrl: expect.stringContaining('data:image/png;base64,') })
    expect(() => images.requireSelection(adminToken, 2, selected.selectionId)).toThrowError(AppError)
  })

  it('expires and replaces sender-scoped selections, and rejects invalid files', async () => {
    await setup()
    const first = await images.selectFile(adminToken, 1, fixturePath('first.png', pngFixture()))
    const second = await images.selectFile(adminToken, 1, fixturePath('second.png', pngFixture()))
    expect(() => images.requireSelection(adminToken, 1, first.selectionId)).toThrowError(AppError)
    now += 10 * 60 * 1000 + 1
    expect(() => images.requireSelection(adminToken, 1, second.selectionId)).toThrowError(AppError)
    await expect(images.selectFile(adminToken, 1, fixturePath('bad.png', Buffer.from('not-an-image')))).rejects.toThrowError(AppError)
    await expect(images.selectFile(adminToken, 1, fixturePath('large.png', pngFixture(4097, 1)))).rejects.toThrowError(AppError)
  })

  it('supports replace and remove while recording image audit events', async () => {
    await setup()
    const first = await images.selectFile(adminToken, 1, fixturePath('first.png', pngFixture()))
    const product = catalog.createProduct(adminToken, 1, draft({ imageSelectionId: first.selectionId }))
    const replacement = await images.selectFile(adminToken, 1, fixturePath('replacement.png', pngFixture(30, 40)))
    expect(catalog.updateProduct(adminToken, 1, { ...draft({ sku: product.sku }), productId: product.id, imageChange: { kind: 'REPLACE', selectionId: replacement.selectionId } }).hasImage).toBe(true)
    expect(db!.prepare('SELECT width,height FROM product_images WHERE product_id=?').get(product.id)).toEqual({ width: 10, height: 20 })
    expect(catalog.updateProduct(adminToken, 1, { ...draft({ sku: product.sku }), productId: product.id, imageChange: { kind: 'REMOVE' } }).hasImage).toBe(false)
    expect((db!.prepare("SELECT action FROM audit_logs WHERE action LIKE 'PRODUCT_IMAGE_%'").all() as Array<{ action: string }>).map(({ action }) => action).sort()).toEqual(['PRODUCT_IMAGE_REMOVED', 'PRODUCT_IMAGE_SET', 'PRODUCT_IMAGE_SET'])
  })

  it('rolls back image persistence and keeps the selection when image audit fails', async () => {
    await setup()
    const selected = await images.selectFile(adminToken, 1, fixturePath('rollback.png', pngFixture()))
    db!.exec("CREATE TRIGGER reject_product_image_audit BEFORE INSERT ON audit_logs WHEN NEW.action='PRODUCT_IMAGE_SET' BEGIN SELECT RAISE(ABORT,'audit failure'); END")
    expect(() => catalog.createProduct(adminToken, 1, draft({ imageSelectionId: selected.selectionId }))).toThrow()
    expect((db!.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n).toBe(0)
    expect((db!.prepare('SELECT COUNT(*) AS n FROM product_images').get() as { n: number }).n).toBe(0)
    expect(images.requireSelection(adminToken, 1, selected.selectionId)).toMatchObject({ width: 10, height: 20 })
  })
})
