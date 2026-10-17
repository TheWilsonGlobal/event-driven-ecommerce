import {
  AppError,
  Bounded,
  CurrencyCode,
  EntityId,
  SearchTerm,
  Str,
  Strict,
  Type,
  type Static,
  type TSchema,
} from '@ecommerce/shared-security'

/**
 * Request and response contracts for ms-product.
 *
 * Bounds were chosen against what the admin SPA and storefront actually send
 * (packages/admin/src/hooks/ecommerce/useProducts.ts) and against the seed data,
 * so a legitimate payload is never rejected; everything beyond that is closed.
 */

// ─── Building blocks ────────────────────────────────────────────────────────

/**
 * A price in major units: bounded, non-negative. The two-decimal rule is checked
 * by `assertTwoDecimals` in the handler rather than `multipleOf: 0.01`: Ajv's
 * float modulo rejects valid prices (0.07, 0.29, ... about one in nine 2-dp
 * values) unless `multipleOfPrecision` is set, and the shared compiler does not
 * set it. Swap this for the shared `Money` once it does.
 */
export const Price = Type.Number({ minimum: 0, maximum: 1_000_000 })

/** Admin derives compareAtPrice as price * 1.2, so it can carry float noise; it is rounded server side. */
const CompareAtPrice = Type.Number({ minimum: 0, maximum: 1_000_000 })

/** Slugs come from `title.toLowerCase().replace(/[^a-z0-9]+/g, '-')`, so edge hyphens are legitimate. */
const Slug = Type.String({ minLength: 1, maxLength: 200, pattern: '^[a-z0-9-]+$' })

/** Catalogue codes: letters, digits and `. _ / -`, never spaces or control characters. */
const Sku = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9][A-Za-z0-9._/-]*$' })

/**
 * The category embedded on a product. The admin builds `id`/`slug` from the
 * display name (`Audio & Headphones` -> `audio-&-headphones`) and sends empty
 * strings for "no category", so this is bounded text rather than the stricter
 * EntityId pattern the catalogue ids use.
 */
const CategoryRef = Strict({ id: Str(64, 0), name: Str(100, 0), slug: Str(100, 0) })

/** http(s) only: a `javascript:` or `data:` URL in an <img src> is never legitimate. */
const Image = Strict({
  url: Type.String({ minLength: 8, maxLength: 2048, pattern: '^https?://' }),
  alt: Str(300, 0),
  isPrimary: Type.Boolean(),
})

const Attribute = Strict({ name: Str(100), value: Str(500, 0) })

const Ratings = Strict({
  average: Type.Number({ minimum: 0, maximum: 5 }),
  count: Type.Integer({ minimum: 0, maximum: 10_000_000 }),
})

const productFields = {
  title: Str(200),
  slug: Slug,
  sku: Sku,
  description: Str(5000, 0),
  price: Price,
  compareAtPrice: CompareAtPrice,
  currency: CurrencyCode,
  stock: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
  isAvailable: Type.Boolean(),
  category: CategoryRef,
  tags: Bounded(Str(50), 30),
  images: Bounded(Image, 20),
  attributes: Bounded(Attribute, 50),
  ratings: Ratings,
}

type Optionalised<T extends Record<string, TSchema>> = {
  [K in keyof T]: ReturnType<typeof Type.Optional<T[K]>>
}
function optionalAll<T extends Record<string, TSchema>>(fields: T): Optionalised<T> {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, Type.Optional(v)])
  ) as Optionalised<T>
}

const optionalFields = optionalAll(productFields)

// ─── Requests ───────────────────────────────────────────────────────────────

/** `title` is the one field a product cannot sensibly default; the rest keep their defaults. */
export const CreateProductBody = Strict({
  ...optionalFields,
  id: Type.Optional(EntityId),
  title: productFields.title,
})
export type CreateProductBody = Static<typeof CreateProductBody>

export const PatchProductBody = Strict({ ...optionalFields }, { minProperties: 1 })
export type PatchProductBody = Static<typeof PatchProductBody>

export const ProductParams = Strict({ id: EntityId })

export const SORT_FIELDS = ['title', 'price', 'stock'] as const

export const ListProductsQuery = Strict({
  page: Type.Integer({ minimum: 1, maximum: 10_000, default: 1 }),
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
  category: Type.Optional(Str(100)),
  search: Type.Optional(SearchTerm),
  sort: Type.Optional(Type.Union(SORT_FIELDS.map((f) => Type.Literal(f)))),
  order: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
})
export type ListProductsQuery = Static<typeof ListProductsQuery>

// ─── Responses (closed: a new column can never leak by accident) ────────────

/**
 * Every field is optional on the way OUT: a legacy document that lacks one must
 * still serialise. `vendorId` is deliberately absent, so it is never published.
 */
export const ProductResponse = Strict({ id: Type.Optional(Type.String()), ...optionalFields })

export const ProductListResponse = Strict({
  products: Type.Array(ProductResponse),
  total: Type.Integer(),
  page: Type.Integer(),
  limit: Type.Integer(),
  // Which engine answered: "elasticsearch" (relevance-ranked), "memory"
  // (substring fallback) or "none" (no ?search term).
  searchEngine: Type.String(),
})

export const CategoryResponse = Strict({
  categories: Type.Array(
    Strict({
      id: Type.Optional(Type.String()),
      name: Type.Optional(Type.String()),
      slug: Type.Optional(Type.String()),
      icon: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      productCount: Type.Optional(Type.Number()),
    })
  ),
})

export const SuccessResponse = Strict({ success: Type.Boolean() })

// ─── Storage / uploads ──────────────────────────────────────────────────────

/**
 * An object key read from a client. Only the two prefixes the upload routes
 * generate, a single path segment after it, no `..` anywhere: so `../x`,
 * `/etc/passwd`, `products/../receipts/x` and `products//x` are all refused at
 * validation, before the key reaches the storage client.
 */
export const OBJECT_KEY_PATTERN =
  '^(?:products|receipts)/(?!.*\\.\\.)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'

export const DownloadQuery = Strict({
  key: Type.String({ minLength: 1, maxLength: 160, pattern: OBJECT_KEY_PATTERN }),
})

export const UploadResponse = Strict({
  key: Type.String(),
  url: Type.String(),
  size: Type.Integer(),
})

// ─── Handler-level checks Ajv cannot express ────────────────────────────────

/** True when `value` has at most two decimal places (tolerant of binary float noise). */
export function hasAtMostTwoDecimals(value: number): boolean {
  const cents = value * 100
  return Math.abs(cents - Math.round(cents)) < 1e-6
}

/** Throws the standard 400 validation error for a price with more than two decimals. */
export function assertTwoDecimals(value: number | undefined, path: string): void {
  if (value !== undefined && !hasAtMostTwoDecimals(value)) {
    throw new AppError(400, 'VALIDATION_FAILED', 'Request validation failed', {
      fields: [{ path, rule: 'multipleOf' }],
    })
  }
}

export const roundMoney = (value: number): number => Math.round(value * 100) / 100
