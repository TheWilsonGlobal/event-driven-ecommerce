import type { EnforceMode } from '@ecommerce/shared-security'
import type { ProductClient, CatalogProduct } from './ProductClient'

export { ProductUnavailableError } from './ProductClient'

/** Money comparisons tolerate one cent: clients round differently than we do. */
export const PRICE_TOLERANCE = 0.01

export interface PriceCheckInput {
  items: { productId: string; unitPrice: number; quantity: number }[]
  subtotal: number
  taxAmount: number
  shippingAmount: number
  discountAmount: number
  totalAmount: number
  currency: string
}

export interface PriceMismatch {
  /** e.g. `items[2].unitPrice`, `subtotal`, `totalAmount`. */
  field: string
  /** What the catalogue implies; null when the product does not exist. */
  expected: number | string | null
  actual: number | string
  reason: 'price' | 'unknown-product' | 'currency' | 'arithmetic'
}

export interface PriceCheckResult {
  mismatches: PriceMismatch[]
  /** Catalogue entries by product id, so a caller can use the authoritative title/sku. */
  products: Map<string, CatalogProduct>
}

export interface PriceVerifier {
  mode: EnforceMode
  client: ProductClient
}

const round2 = (n: number) => Math.round(n * 100) / 100
const differs = (a: number, b: number) => Math.abs(a - b) > PRICE_TOLERANCE + 1e-9

/**
 * Plan 4.3: never trust prices from the client. Recomputes every line from
 * ms-product's price and the totals from those lines, and reports each
 * difference. Tax, shipping and discount stay client-asserted (there is no
 * tax or coupon service to ask); they are only checked for arithmetic
 * consistency.
 *
 * Throws ProductUnavailableError when the catalogue cannot answer: that is an
 * outage, not a mismatch, and the caller decides what an outage means.
 */
export async function checkOrderPrices(
  client: ProductClient,
  input: PriceCheckInput,
  traceHeaders: Record<string, string> = {}
): Promise<PriceCheckResult> {
  const ids = [...new Set(input.items.map((i) => i.productId))]
  const found = new Map<string, CatalogProduct | null>()
  // Bounded fan-out: an order has at most 100 lines.
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10)
    const results = await Promise.all(batch.map((id) => client.getProduct(id, traceHeaders)))
    batch.forEach((id, n) => found.set(id, results[n] ?? null))
  }

  const mismatches: PriceMismatch[] = []
  let computedSubtotal = 0
  let currencyReported = false

  input.items.forEach((line, idx) => {
    const product = found.get(line.productId)
    if (!product) {
      mismatches.push({
        field: `items[${idx}].productId`,
        expected: null,
        actual: line.productId,
        reason: 'unknown-product',
      })
      return
    }
    computedSubtotal += round2(product.price * line.quantity)
    if (differs(line.unitPrice, product.price)) {
      mismatches.push({
        field: `items[${idx}].unitPrice`,
        expected: product.price,
        actual: line.unitPrice,
        reason: 'price',
      })
    }
    if (product.currency && product.currency !== input.currency && !currencyReported) {
      currencyReported = true
      mismatches.push({
        field: 'currency',
        expected: product.currency,
        actual: input.currency,
        reason: 'currency',
      })
    }
  })

  // Totals only mean something when every line resolved.
  if (!mismatches.some((m) => m.reason === 'unknown-product')) {
    computedSubtotal = round2(computedSubtotal)
    if (differs(input.subtotal, computedSubtotal)) {
      mismatches.push({
        field: 'subtotal',
        expected: computedSubtotal,
        actual: input.subtotal,
        reason: 'price',
      })
    }
    const expectedTotal = round2(
      computedSubtotal + input.taxAmount + input.shippingAmount - input.discountAmount
    )
    if (differs(input.totalAmount, expectedTotal)) {
      mismatches.push({
        field: 'totalAmount',
        expected: expectedTotal,
        actual: input.totalAmount,
        reason: 'arithmetic',
      })
    }
    if (input.discountAmount > computedSubtotal + PRICE_TOLERANCE) {
      mismatches.push({
        field: 'discountAmount',
        expected: computedSubtotal,
        actual: input.discountAmount,
        reason: 'arithmetic',
      })
    }
  }

  const products = new Map<string, CatalogProduct>()
  for (const [id, p] of found) if (p) products.set(id, p)
  return { mismatches, products }
}

export function parsePriceCheckMode(raw: string | undefined): EnforceMode {
  return raw?.trim().toLowerCase() === 'enforce' ? 'enforce' : 'report'
}
