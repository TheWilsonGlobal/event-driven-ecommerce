import { signServiceToken } from '@ecommerce/shared-security'

/** What ms-order needs from a catalogue entry; everything else is ignored. */
export interface CatalogProduct {
  id: string
  price: number
  currency: string | null
  title: string | null
  sku: string | null
}

/**
 * ms-product could not give an answer we can trust: unreachable, too slow,
 * 5xx, rejected our service token, or a body without a usable price. Distinct
 * from "the product does not exist" (a `null` result), because the caller must
 * treat the first as an outage (503) and the second as a bad order (422).
 */
export class ProductUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductUnavailableError'
  }
}

export interface ProductClientOptions {
  baseUrl: string
  /** SERVICE_AUTH_SECRET. Null sends no token (the product read is public anyway). */
  serviceSecret: string | null
  timeoutMs?: number
  /** Injected in tests. */
  fetchImpl?: typeof fetch
}

const TOKEN_REUSE_MS = 30_000

/**
 * Reads authoritative prices from ms-product with a short-lived SERVICE token.
 * The token is never a user's: ms-order proves who IT is, so the call works
 * identically when ms-product starts enforcing authentication.
 */
export class ProductClient {
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private token: { value: string; mintedAt: number } | null = null

  constructor(private readonly opts: ProductClientOptions) {
    this.timeoutMs = opts.timeoutMs ?? 2_000
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private async authHeader(): Promise<Record<string, string>> {
    if (!this.opts.serviceSecret) return {}
    const now = Date.now()
    if (!this.token || now - this.token.mintedAt > TOKEN_REUSE_MS) {
      // 60 s life (the default) outlives the 30 s reuse window above.
      this.token = {
        value: await signServiceToken(this.opts.serviceSecret, 'ms-order'),
        mintedAt: now,
      }
    }
    return { authorization: `Bearer ${this.token.value}` }
  }

  /**
   * The product, or null when ms-product says it does not exist.
   * `extraHeaders` carries the trace headers (x-correlation-id, traceparent) of
   * the checkout request so ms-product's log lines join the same story.
   */
  async getProduct(
    productId: string,
    extraHeaders: Record<string, string> = {}
  ): Promise<CatalogProduct | null> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}/api/v1/products/${encodeURIComponent(productId)}`
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        headers: { accept: 'application/json', ...extraHeaders, ...(await this.authHeader()) },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      // Duck-typed: the DOMException AbortSignal.timeout raises is not an
      // `Error` instance in every realm (jest's sandbox, for one).
      const name = (err as { name?: string } | null)?.name
      const timedOut = name === 'TimeoutError' || name === 'AbortError'
      throw new ProductUnavailableError(
        timedOut ? 'ms-product timed out' : 'ms-product is unreachable'
      )
    }

    if (res.status === 404) return null
    if (!res.ok) throw new ProductUnavailableError(`ms-product answered ${res.status}`)

    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw new ProductUnavailableError('ms-product returned a non-JSON body')
    }
    const p = body as Record<string, unknown> | null
    if (
      !p ||
      typeof p !== 'object' ||
      typeof p.price !== 'number' ||
      !Number.isFinite(p.price) ||
      p.price < 0
    ) {
      throw new ProductUnavailableError('ms-product returned a product without a usable price')
    }
    return {
      id: productId,
      price: p.price,
      currency: typeof p.currency === 'string' ? p.currency : null,
      title: typeof p.title === 'string' ? p.title : null,
      sku: typeof p.sku === 'string' ? p.sku : null,
    }
  }
}

export function createProductClientFromEnv(env: NodeJS.ProcessEnv = process.env): ProductClient {
  const baseUrl =
    env.PRODUCT_SERVICE_URL?.trim() ||
    `http://127.0.0.1:${env.PRODUCT_SERVICE_PORT?.trim() || '5464'}`
  return new ProductClient({ baseUrl, serviceSecret: env.SERVICE_AUTH_SECRET?.trim() || null })
}
