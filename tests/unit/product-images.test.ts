import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStoreDatabase } from '../../src/main/db/connection'
import { AppError, AuthService } from '../../src/main/auth/service'
import { CatalogService } from '../../src/main/services/catalog'
import { InventoryService } from '../../src/main/services/inventory'
import { ProductImageService, type DecodedProductImage } from '../../src/main/services/product-images'
import { MAX_PRODUCT_IMAGE_BYTES } from '../../src/shared/domain/product-image'
import type { ProductDraft } from '../../src/shared/contracts'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVf8AAAAASUVORK5CYII=', 'base64')
let dir = ''
let db: ReturnType<typeof openStoreDatabase> | null = null
afterEach(() => { db?.close(); db = null; if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); dir = '' })

function decoder(content: Buffer): DecodedProductImage {
  return {
    isEmpty: () => false,
    getSize: () => ({ width: 1, height: 1 }),
    toPNG: () => Buffer.from(png),
    resize: () => decoder(content)
  }
}

async function setup(): Promise<{
  auth: AuthService
  catalog: CatalogService
  images: ProductImageService
  token: string
  now: () => number
  setNow: (value: number) => void
}> {
  dir = mkdtempSync(join(tmpdir(), 'inventory-product-image-'))
  db = openStoreDatabase(join(dir, 'store.sqlite'))
  let time = Date.now()
  const now = () => time
  const setNow = (value: number) => { time = value }
  const auth = new AuthService(db)
  const inventory = new InventoryService(db, auth, now)
  const images = new ProductImageService(db, auth, decoder, now)
  const catalog = new CatalogService(db, auth, inventory, images, now)
  const admin = await auth.setup({ storeName: '画像検証店舗', displayName: '管理者', loginName: 'admin', password: 'image test password' }, 1)
  return { auth, catalog, images, token: admin.token, now, setNow }
}

function product(patch: Partial<ProductDraft> = {}): ProductDraft {
  return { sku: 'IMAGE-1', name: '画像商品', categoryId: null, unit: '個', reorderLevel: 0, note: null, ...patch }
}
function writeImage(fileName = 'valid.png', content = png): string {
  const path = join(dir, fileName)
  writeFileSync(path, content)
  return path
}

describe('product image selection and persistence', () => {
  it('normalizes a selected image and atomically saves it with product and opening stock', async () => {
    const { auth, catalog, images, token } = await setup()
    const selected = await images.selectFile(token, 1, writeImage())
    expect(selected).toMatchObject({ width: 1, height: 1, previewDataUrl: 'data:image/png;base64,' + png.toString('base64') })
    expect(Object.keys(selected).sort()).toEqual(['height', 'previewDataUrl', 'selectionId', 'width'])
    const item = catalog.createProduct(token, 1, { ...product(), initialStock: 8, imageSelectionId: selected.selectionId })
    expect(item).toMatchObject({ currentStock: 8, hasImage: true, imageUpdatedAt: expect.any(String) })
    const stored = db!.prepare('SELECT content,mime_type,width,height FROM product_images WHERE product_id=?').get(item.id) as { content: Buffer; mime_type: string; width: number; height: number }
    expect(stored).toMatchObject({ content: png, mime_type: 'image/png', width: 1, height: 1 })
    expect(images.get(token, 1, item.id, 'DETAIL')?.dataUrl).toBe(`data:image/png;base64,${png.toString('base64')}`)
    expect(images.get(token, 1, item.id, 'THUMBNAIL')?.dataUrl).toContain('data:image/png;base64,')
    const issued = await auth.createUser(token, 1, { loginName: 'staff', displayName: '担当者', role: 'STAFF' })
    const reset = await auth.beginPasswordReset('staff', issued.code, 2)
    await auth.completePasswordReset(reset.token, 2, 'staff image password')
    const staff = await auth.login('staff', 'staff image password', 2)
    expect(images.get(staff.token, 2, item.id, 'DETAIL')?.dataUrl).toBe(`data:image/png;base64,${png.toString('base64')}`)
    expect(() => images.assertAdmin(staff.token, 2)).toThrowError(AppError)
    expect((db!.prepare("SELECT COUNT(*) AS count FROM stock_movements WHERE product_id=? AND movement_type='OPENING'").get(item.id) as { count: number }).count).toBe(1)
    expect((db!.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_id=? AND action IN ('PRODUCT_CREATED','PRODUCT_IMAGE_SET')").get(item.id) as { count: number }).count).toBe(2)
    expect((db!.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='STOCK_RECORDED' AND details_json LIKE ?").get(`%${item.id}%`) as { count: number }).count).toBe(1)
  })

  it('rejects disguised, oversized, and over-dimensioned files before decoding', async () => {
    const { auth, token } = await setup()
    let decodeCalls = 0
    const guarded = new ProductImageService(db!, auth, (content) => { decodeCalls++; return decoder(content) })
    await expect(guarded.selectFile(token, 1, writeImage('fake.jpg'))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(guarded.selectFile(token, 1, writeImage('oversized.png', Buffer.concat([png, Buffer.alloc(MAX_PRODUCT_IMAGE_BYTES)])))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const tooWide = Buffer.from(png)
    tooWide.writeUInt32BE(4097, 16)
    await expect(guarded.selectFile(token, 1, writeImage('too-wide.png', tooWide))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(decodeCalls).toBe(0)
  })

  it('rejects image data that passes signature and dimensions but fails actual decoding', async () => {
    const { auth, token } = await setup()
    const invalidDecoder = new ProductImageService(db!, auth, () => { throw new Error('decode failed') })
    await expect(invalidDecoder.selectFile(token, 1, writeImage())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('keeps the selection after a failed image audit and consumes it only after commit', async () => {
    const { catalog, images, token } = await setup()
    const selected = await images.selectFile(token, 1, writeImage())
    db!.exec("CREATE TRIGGER reject_image_audit BEFORE INSERT ON audit_logs WHEN NEW.action='PRODUCT_IMAGE_SET' BEGIN SELECT RAISE(ABORT,'audit failure'); END")
    expect(() => catalog.createProduct(token, 1, { ...product(), initialStock: 8, imageSelectionId: selected.selectionId })).toThrow()
    expect((db!.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }).count).toBe(0)
    expect((db!.prepare('SELECT COUNT(*) AS count FROM product_images').get() as { count: number }).count).toBe(0)
    expect((db!.prepare('SELECT COUNT(*) AS count FROM stock_movements').get() as { count: number }).count).toBe(0)
    expect((db!.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action IN ('PRODUCT_CREATED','STOCK_RECORDED','PRODUCT_IMAGE_SET')").get() as { count: number }).count).toBe(0)
    db!.exec('DROP TRIGGER reject_image_audit')
    const retry = catalog.createProduct(token, 1, { ...product(), sku: 'IMAGE-RETRY', initialStock: 8, imageSelectionId: selected.selectionId })
    expect(retry).toMatchObject({ currentStock: 8, hasImage: true })
    expect(() => images.getSelectionForSave(token, 1, selected.selectionId)).toThrowError(AppError)
  })

  it('rejects expired or other-sender selections and clears them on logout', async () => {
    const { auth, catalog, images, token, now, setNow } = await setup()
    const selected = await images.selectFile(token, 1, writeImage())
    const other = await auth.login('admin', 'image test password', 2)
    expect(() => images.getSelectionForSave(other.token, 2, selected.selectionId)).toThrowError(AppError)
    setNow(now() + 10 * 60 * 1000 + 1)
    expect(() => images.getSelectionForSave(token, 1, selected.selectionId)).toThrowError(AppError)
    const replacement = await images.selectFile(token, 1, writeImage('again.png'))
    auth.logout(1)
    const loggedIn = await auth.login('admin', 'image test password', 1)
    expect(() => catalog.createProduct(loggedIn.token, 1, { ...product(), initialStock: 0, imageSelectionId: replacement.selectionId })).toThrowError(AppError)
    expect((db!.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }).count).toBe(0)
  })

  it('retains the old image when replacement or removal auditing fails', async () => {
    const { catalog, images, token, now, setNow } = await setup()
    const first = await images.selectFile(token, 1, writeImage())
    const item = catalog.createProduct(token, 1, { ...product(), initialStock: 0, imageSelectionId: first.selectionId })
    const old = db!.prepare('SELECT content,updated_at FROM product_images WHERE product_id=?').get(item.id) as { content: Buffer; updated_at: string }
    const replacement = await images.selectFile(token, 1, writeImage('replacement.png', Buffer.concat([png, Buffer.from([0])])) )
    setNow(now() + 1000)
    const update = (imageChange: { action: 'KEEP' | 'REMOVE' } | { action: 'REPLACE'; selectionId: string }) => catalog.updateProduct(token, 1, { ...product(), productId: item.id, imageChange })
    db!.exec("CREATE TRIGGER reject_image_update_audit BEFORE INSERT ON audit_logs WHEN NEW.action='PRODUCT_IMAGE_SET' BEGIN SELECT RAISE(ABORT,'audit failure'); END")
    expect(() => update({ action: 'REPLACE', selectionId: replacement.selectionId })).toThrow()
    expect(db!.prepare('SELECT content,updated_at FROM product_images WHERE product_id=?').get(item.id)).toEqual(old)
    db!.exec('DROP TRIGGER reject_image_update_audit')
    update({ action: 'REPLACE', selectionId: replacement.selectionId })
    const replaced = db!.prepare('SELECT content,updated_at FROM product_images WHERE product_id=?').get(item.id) as { content: Buffer; updated_at: string }
    expect(replaced.updated_at).not.toBe(old.updated_at)
    db!.exec("CREATE TRIGGER reject_image_remove_audit BEFORE INSERT ON audit_logs WHEN NEW.action='PRODUCT_IMAGE_REMOVED' BEGIN SELECT RAISE(ABORT,'audit failure'); END")
    expect(() => update({ action: 'REMOVE' })).toThrow()
    expect(db!.prepare('SELECT content,updated_at FROM product_images WHERE product_id=?').get(item.id)).toEqual(replaced)
    db!.exec('DROP TRIGGER reject_image_remove_audit')
    expect(update({ action: 'REMOVE' }).hasImage).toBe(false)
    expect(db!.prepare('SELECT 1 FROM product_images WHERE product_id=?').get(item.id)).toBeUndefined()
  })
})