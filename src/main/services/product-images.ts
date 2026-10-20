import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { ProductImageResult, ProductImageSelection, Role } from '../../shared/contracts'
import type { StoreDatabase } from '../db/connection'
import { AppError, AuthService } from '../auth/service'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGE_SIDE = 4096
const SELECTION_TTL_MS = 10 * 60 * 1000
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

type NormalizedImage = Readonly<{ content: Buffer; width: number; height: number }>
type PendingSelection = NormalizedImage & Readonly<{ senderId: number; expiresAt: number }>

function jpegDimensions(content: Buffer): { width: number; height: number } | null {
  if (content.length < 4 || content[0] !== 0xff || content[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < content.length) {
    if (content[offset] !== 0xff) { offset++; continue }
    while (content[offset] === 0xff) offset++
    const marker = content[offset++] ?? 0
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 1 >= content.length) return null
    const length = content.readUInt16BE(offset)
    if (length < 2 || offset + length > content.length) return null
    const isFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
    if (isFrame && length >= 7) return { height: content.readUInt16BE(offset + 3), width: content.readUInt16BE(offset + 5) }
    offset += length
  }
  return null
}

function headerDimensions(content: Buffer): { width: number; height: number } | null {
  if (content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) && content.length >= 24 && content.toString('ascii', 12, 16) === 'IHDR') {
    return { width: content.readUInt32BE(16), height: content.readUInt32BE(20) }
  }
  return jpegDimensions(content)
}

export function isStoredPngConsistent(content: Buffer, width: number, height: number): boolean {
  if (!content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) || content.length < 24 || content.toString('ascii', 12, 16) !== 'IHDR') return false
  return content.readUInt32BE(16) === width && content.readUInt32BE(20) === height
}

function selectionId(value: string): boolean { return /^[0-9a-f-]{36}$/i.test(value) }

export class ProductImagesService {
  private readonly selections = new Map<string, PendingSelection>()
  constructor(private readonly db: StoreDatabase, private readonly auth: AuthService, private readonly clock: () => number = Date.now) {}

  private actor(token: string, senderId: number, role?: Role): void { this.auth.canUseProtected(token, senderId, role) }

  async selectFile(token: string, senderId: number, filePath: string): Promise<ProductImageSelection> {
    this.actor(token, senderId, 'ADMIN')
    const fileStat = await stat(filePath).catch(() => null)
    if (!fileStat || !fileStat.isFile() || fileStat.size < 1 || fileStat.size > MAX_IMAGE_BYTES) throw new AppError('VALIDATION_ERROR')
    const raw = await readFile(filePath)
    if (raw.length < 1 || raw.length > MAX_IMAGE_BYTES) throw new AppError('VALIDATION_ERROR')
    const dimensions = headerDimensions(raw)
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_IMAGE_SIDE || dimensions.height > MAX_IMAGE_SIDE) throw new AppError('VALIDATION_ERROR')
    let normalized: Buffer
    let size = dimensions
    try {
      const { nativeImage } = await import('electron')
      const decoded = nativeImage.createFromBuffer(raw)
      if (decoded.isEmpty()) throw new Error('image decode failed')
      size = decoded.getSize()
      normalized = decoded.toPNG()
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('VALIDATION_ERROR')
    }
    if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1 || size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE || normalized.length < 1 || normalized.length > MAX_IMAGE_BYTES) throw new AppError('VALIDATION_ERROR')
    for (const [id, pending] of this.selections) if (pending.senderId === senderId) this.selections.delete(id)
    const id = randomUUID()
    this.selections.set(id, { content: Buffer.from(normalized), width: size.width, height: size.height, senderId, expiresAt: this.clock() + SELECTION_TTL_MS })
    return { selectionId: id, width: size.width, height: size.height, previewDataUrl: `data:image/png;base64,${normalized.toString('base64')}` }
  }

  discardSelection(token: string, senderId: number, id: string): null {
    this.actor(token, senderId, 'ADMIN')
    if (!selectionId(id)) throw new AppError('VALIDATION_ERROR')
    const pending = this.selections.get(id)
    if (pending && pending.senderId === senderId) this.selections.delete(id)
    return null
  }

  clearSender(senderId: number): void { for (const [id, pending] of this.selections) if (pending.senderId === senderId) this.selections.delete(id) }
  clearAll(): void { this.selections.clear() }

  requireSelection(token: string, senderId: number, id: string): NormalizedImage {
    this.actor(token, senderId, 'ADMIN')
    if (!selectionId(id)) throw new AppError('VALIDATION_ERROR')
    const pending = this.selections.get(id)
    if (!pending || pending.senderId !== senderId || pending.expiresAt <= this.clock()) {
      if (pending) this.selections.delete(id)
      throw new AppError('VALIDATION_ERROR')
    }
    return pending
  }

  consumeSelection(senderId: number, id: string): void {
    const pending = this.selections.get(id)
    if (pending?.senderId === senderId) this.selections.delete(id)
  }

  get(token: string, senderId: number, productId: string, variant: 'THUMBNAIL' | 'DETAIL'): Promise<ProductImageResult | null> {
    this.actor(token, senderId)
    if (!selectionId(productId) || (variant !== 'THUMBNAIL' && variant !== 'DETAIL')) throw new AppError('VALIDATION_ERROR')
    const row = this.db.prepare('SELECT content,updated_at FROM product_images WHERE product_id=?').get(productId) as { content: Buffer; updated_at: string } | undefined
    if (!row) return Promise.resolve(null)
    return this.toDataUrl(row.content, variant).then((dataUrl) => ({ dataUrl, updatedAt: row.updated_at }))
  }

  private async toDataUrl(content: Buffer, variant: 'THUMBNAIL' | 'DETAIL'): Promise<string> {
    if (variant === 'DETAIL') return `data:image/png;base64,${content.toString('base64')}`
    try {
      const { nativeImage } = await import('electron')
      const image = nativeImage.createFromBuffer(content)
      const size = image.getSize()
      const scale = Math.min(1, 128 / Math.max(size.width, size.height))
      const thumb = scale < 1 ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' }) : image
      return `data:image/png;base64,${thumb.toPNG().toString('base64')}`
    } catch {
      return `data:image/png;base64,${content.toString('base64')}`
    }
  }

  save(db: StoreDatabase, productId: string, image: NormalizedImage, updatedAt: string): void {
    db.prepare(`INSERT INTO product_images(product_id,content,mime_type,width,height,updated_at) VALUES(?,?,?, ?,?,?)
      ON CONFLICT(product_id) DO UPDATE SET content=excluded.content,mime_type=excluded.mime_type,width=excluded.width,height=excluded.height,updated_at=excluded.updated_at`)
      .run(productId, image.content, 'image/png', image.width, image.height, updatedAt)
  }

  remove(db: StoreDatabase, productId: string): void { db.prepare('DELETE FROM product_images WHERE product_id=?').run(productId) }
}
