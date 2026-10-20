import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ProductImageData, ProductImageSelection, ProductImageVariant, Role } from '../../shared/contracts'
import { inspectPngDimensions, MAX_PRODUCT_IMAGE_BYTES, MAX_PRODUCT_IMAGE_DIMENSION } from '../../shared/domain/product-image'
import type { StoreDatabase } from '../db/connection'
import { AppError, AuthService } from '../auth/service'
import { audit, type AuditActor } from './audit'

const SELECTION_TTL_MS = 10 * 60 * 1000
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
type ImageSize = Readonly<{ width: number; height: number }>
export type DecodedProductImage = Readonly<{
  isEmpty(): boolean
  getSize(): ImageSize
  toPNG(): Buffer
  resize(size: ImageSize & Readonly<{ quality?: 'good' | 'better' | 'best' }>): DecodedProductImage
}>
type PendingImage = {
  selectionId: string
  senderId: number
  userId: string
  expiresAt: number
  content: Buffer
  width: number
  height: number
  previewDataUrl: string
}
export type ProductImageForSave = Readonly<{ content: Buffer; width: number; height: number }>

export class ProductImageService {
  private readonly pendingBySender = new Map<number, PendingImage>()
  private readonly unsubscribeSessionRevoked: () => void
  constructor(
    private readonly db: StoreDatabase,
    private readonly auth: AuthService,
    private readonly decode: (content: Buffer) => DecodedProductImage,
    private readonly clock: () => number = Date.now
  ) {
    this.unsubscribeSessionRevoked = auth.onSessionRevoked((senderId) => this.clearSender(senderId))
  }

  private requireActor(token: string, senderId: number, role?: Role): AuditActor {
    this.auth.canUseProtected(token, senderId, role)
    const session = this.auth.getSession(senderId)
    if (!session || session.state !== 'AUTHENTICATED') throw new AppError('AUTH_REQUIRED')
    if (role && session.user.role !== role) throw new AppError('FORBIDDEN')
    return { id: session.user.id, loginName: session.user.loginName, displayName: session.user.displayName, role: session.user.role }
  }

  async selectFile(token: string, senderId: number, filePath: string): Promise<ProductImageSelection> {
    const actor = this.requireActor(token, senderId, 'ADMIN')
    try {
      const extension = extname(filePath).toLowerCase()
      const fileInfo = await stat(filePath)
      if (!fileInfo.isFile() || fileInfo.size < 1 || fileInfo.size > MAX_PRODUCT_IMAGE_BYTES) throw new Error('INVALID_IMAGE')
      const source = await readFile(filePath)
      if (source.length < 1 || source.length > MAX_PRODUCT_IMAGE_BYTES) throw new Error('INVALID_IMAGE')
      const png = source.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
      const jpeg = source.length >= 3 && source[0] === 0xff && source[1] === 0xd8 && source[2] === 0xff
      if (!(png && extension === '.png') && !(jpeg && (extension === '.jpg' || extension === '.jpeg'))) throw new Error('INVALID_IMAGE')
      const header = await import('image-size').then(({ imageSize }) => imageSize(source))
      if (header.type !== (png ? 'png' : 'jpg') || !this.validDimensions(header.width, header.height)) throw new Error('INVALID_IMAGE')
      const decoded = this.decode(source)
      if (decoded.isEmpty()) throw new Error('INVALID_IMAGE')
      const decodedSize = decoded.getSize()
      if (!this.validDimensions(decodedSize.width, decodedSize.height)) throw new Error('INVALID_IMAGE')
      const content = decoded.toPNG()
      const normalizedSize = inspectPngDimensions(content)
      if (content.length < 1 || content.length > MAX_PRODUCT_IMAGE_BYTES || !normalizedSize ||
        normalizedSize.width !== decodedSize.width || normalizedSize.height !== decodedSize.height) throw new Error('INVALID_IMAGE')
      this.requireActor(token, senderId, 'ADMIN')
      const selectionId = randomUUID()
      const selection: PendingImage = {
        selectionId, senderId, userId: actor.id, expiresAt: this.clock() + SELECTION_TTL_MS,
        content: Buffer.from(content), width: normalizedSize.width, height: normalizedSize.height,
        previewDataUrl: `data:image/png;base64,${content.toString('base64')}`
      }
      this.pendingBySender.set(senderId, selection)
      return { selectionId, width: selection.width, height: selection.height, previewDataUrl: selection.previewDataUrl }
    } catch {
      throw new AppError('VALIDATION_ERROR')
    }
  }

  assertAdmin(token: string, senderId: number): void { this.requireActor(token, senderId, 'ADMIN') }

  discardSelection(token: string, senderId: number, selectionId: string): null {
    const actor = this.requireActor(token, senderId, 'ADMIN')
    const pending = this.pendingBySender.get(senderId)
    if (pending && pending.userId === actor.id && pending.selectionId === selectionId) this.pendingBySender.delete(senderId)
    return null
  }

  getSelectionForSave(token: string, senderId: number, selectionId: string): ProductImageForSave {
    const actor = this.requireActor(token, senderId, 'ADMIN')
    const pending = this.pendingBySender.get(senderId)
    if (!pending || pending.selectionId !== selectionId || pending.userId !== actor.id || pending.expiresAt <= this.clock()) {
      if (pending?.expiresAt && pending.expiresAt <= this.clock()) this.pendingBySender.delete(senderId)
      throw new AppError('VALIDATION_ERROR')
    }
    return { content: Buffer.from(pending.content), width: pending.width, height: pending.height }
  }

  consumeSelection(senderId: number, selectionId: string): void {
    const pending = this.pendingBySender.get(senderId)
    if (pending?.selectionId === selectionId) this.pendingBySender.delete(senderId)
  }

  setProductImage(productId: string, image: ProductImageForSave, actor: AuditActor, change: 'ADDED' | 'REPLACED', updatedAt: string): void {
    if (!this.db.inTransaction) throw new Error('PRODUCT_IMAGE_REQUIRES_TRANSACTION')
    this.db.prepare(`INSERT INTO product_images(product_id,content,mime_type,width,height,updated_at) VALUES(?,?,'image/png',?,?,?)
      ON CONFLICT(product_id) DO UPDATE SET content=excluded.content,mime_type=excluded.mime_type,width=excluded.width,height=excluded.height,updated_at=excluded.updated_at`)
      .run(productId, image.content, image.width, image.height, updatedAt)
    audit(this.db, 'PRODUCT_IMAGE_SET', actor, 'product', productId, { productId, width: image.width, height: image.height, bytes: image.content.length, change })
  }

  removeProductImage(productId: string, actor: AuditActor): void {
    if (!this.db.inTransaction) throw new Error('PRODUCT_IMAGE_REQUIRES_TRANSACTION')
    const existing = this.db.prepare('SELECT width,height,length(content) AS bytes FROM product_images WHERE product_id=?').get(productId) as { width: number; height: number; bytes: number } | undefined
    if (!existing) return
    this.db.prepare('DELETE FROM product_images WHERE product_id=?').run(productId)
    audit(this.db, 'PRODUCT_IMAGE_REMOVED', actor, 'product', productId, { productId, width: existing.width, height: existing.height, bytes: existing.bytes })
  }

  get(token: string, senderId: number, productId: string, variant: ProductImageVariant): ProductImageData | null {
    this.requireActor(token, senderId)
    if (!this.db.prepare('SELECT 1 FROM products WHERE id=?').get(productId)) throw new AppError('NOT_FOUND')
    const row = this.db.prepare('SELECT content,mime_type,width,height,updated_at FROM product_images WHERE product_id=?').get(productId) as { content: Buffer; mime_type: string; width: number; height: number; updated_at: string } | undefined
    if (!row) return null
    const dimensions = inspectPngDimensions(row.content)
    if (row.mime_type !== 'image/png' || !dimensions || dimensions.width !== row.width || dimensions.height !== row.height || !this.validDimensions(row.width, row.height)) throw new AppError('DATABASE_ERROR')
    let content = row.content
    if (variant === 'THUMBNAIL') {
      const decoded = this.decode(row.content)
      if (decoded.isEmpty()) throw new AppError('DATABASE_ERROR')
      const size = decoded.getSize()
      const scale = Math.min(1, 128 / size.width, 128 / size.height)
      content = decoded.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'best' }).toPNG()
    }
    return { dataUrl: `data:image/png;base64,${content.toString('base64')}`, updatedAt: row.updated_at }
  }

  clearSender(senderId: number): void { this.pendingBySender.delete(senderId) }
  clearAll(): void { this.pendingBySender.clear() }
  dispose(): void { this.clearAll(); this.unsubscribeSessionRevoked() }
  clearExpired(): void {
    const now = this.clock()
    for (const [senderId, pending] of this.pendingBySender) if (pending.expiresAt <= now) this.pendingBySender.delete(senderId)
  }

  private validDimensions(width: number | undefined, height: number | undefined): width is number {
    return Number.isInteger(width) && Number.isInteger(height) && width! >= 1 && width! <= MAX_PRODUCT_IMAGE_DIMENSION && height! >= 1 && height! <= MAX_PRODUCT_IMAGE_DIMENSION
  }
}