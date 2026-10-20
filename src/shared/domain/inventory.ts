import type { RecordStockMovementInput } from '../contracts'

export const MAX_STOCK = 2_147_483_647

export type StockCalculation = Readonly<{ ok: true; quantityDelta: number; stockAfter: number }> |
  Readonly<{ ok: false; code: 'VALIDATION_ERROR' | 'INSUFFICIENT_STOCK' }>

export function calculateStockChange(currentStock: number, input: RecordStockMovementInput): StockCalculation {
  if (!Number.isSafeInteger(currentStock) || currentStock < 0 || currentStock > MAX_STOCK) return { ok: false, code: 'VALIDATION_ERROR' }
  if (input.type === 'ADJUSTMENT') {
    if (!Number.isSafeInteger(input.countedStock) || input.countedStock < 0 || input.countedStock > MAX_STOCK) return { ok: false, code: 'VALIDATION_ERROR' }
    return { ok: true, quantityDelta: input.countedStock - currentStock, stockAfter: input.countedStock }
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_STOCK) return { ok: false, code: 'VALIDATION_ERROR' }
  const quantityDelta = input.type === 'RECEIPT' ? input.quantity : -input.quantity
  const stockAfter = currentStock + quantityDelta
  if (stockAfter < 0) return { ok: false, code: 'INSUFFICIENT_STOCK' }
  if (stockAfter > MAX_STOCK) return { ok: false, code: 'VALIDATION_ERROR' }
  return { ok: true, quantityDelta, stockAfter }
}

export const isLowStock = (currentStock: number, reorderLevel: number): boolean => reorderLevel > 0 && currentStock <= reorderLevel
export const isZeroStock = (currentStock: number): boolean => currentStock === 0

export function localDateRangeToUtc(startDate: string, endDate: string): Readonly<{ startAt: string | null; endAt: string | null }> {
  const parse = (value: string): Date | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const parts = value.split('-').map(Number)
    const year = parts[0] ?? 0
    const month = parts[1] ?? 0
    const day = parts[2] ?? 0
    const result = new Date(year, month - 1, day)
    return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day ? result : null
  }
  const start = startDate ? parse(startDate) : null
  const end = endDate ? parse(endDate) : null
  if ((startDate && !start) || (endDate && !end) || (start && end && start > end)) throw new RangeError('INVALID_LOCAL_DATE_RANGE')
  if (!start && !end) return { startAt: null, endAt: null }
  const exclusiveEnd = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1) : null
  return { startAt: start?.toISOString() ?? null, endAt: exclusiveEnd?.toISOString() ?? null }
}
