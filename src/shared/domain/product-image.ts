import { imageSize } from 'image-size'

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PRODUCT_IMAGE_DIMENSION = 4096
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function inspectPngDimensions(content: Uint8Array): Readonly<{ width: number; height: number }> | null {
  try {
    if (content.byteLength < PNG_SIGNATURE.length || !Buffer.from(content).subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null
    const parsed = imageSize(Buffer.from(content))
    if (parsed.type !== 'png' || !Number.isInteger(parsed.width) || !Number.isInteger(parsed.height) ||
      parsed.width < 1 || parsed.width > MAX_PRODUCT_IMAGE_DIMENSION || parsed.height < 1 || parsed.height > MAX_PRODUCT_IMAGE_DIMENSION) return null
    return { width: parsed.width, height: parsed.height }
  } catch { return null }
}