import { Type, type TSchema, type TProperties, type ObjectOptions } from '@sinclair/typebox'

export { Type }
export type { Static, TSchema } from '@sinclair/typebox'

/**
 * Reusable, deliberately tight building blocks for route schemas.
 *
 * TypeBox is used only to AUTHOR schemas: `Type.Object(...)` produces a plain
 * JSON Schema that Fastify's Ajv validates and @fastify/swagger documents, and
 * `Static<typeof X>` gives the TypeScript type from the same definition, so the
 * contract and the type cannot drift.
 *
 * Every limit below is a decision, not a default: strings are bounded, numbers
 * have ranges, arrays have a maximum length, objects reject unknown fields.
 */

/** An object that rejects unknown properties (the rule for every request body). */
export const Strict = <T extends TProperties>(props: T, options: ObjectOptions = {}) =>
  Type.Object(props, { additionalProperties: false, ...options })

export const Str = (maxLength: number, minLength = 1) => Type.String({ minLength, maxLength })

export const Email = Type.String({ format: 'email', minLength: 3, maxLength: 254 })

export const Uuid = Type.String({ format: 'uuid' })

/** Ids the catalogue still uses in the legacy `prod-N` form, or uuids. */
export const EntityId = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' })

/** Money in major units with at most 2 decimals, never negative, bounded. */
export const Money = Type.Number({ minimum: 0, maximum: 1_000_000, multipleOf: 0.01 })

/** Whole units of a product on an order line. */
export const Quantity = Type.Integer({ minimum: 1, maximum: 1000 })

export const CurrencyCode = Type.String({ pattern: '^[A-Z]{3}$' })

export const CountryCode = Type.String({ pattern: '^[A-Z]{2}$' })

export const Password = Type.String({ minLength: 10, maxLength: 128 })

export const Pagination = {
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
  offset: Type.Integer({ minimum: 0, maximum: 100_000, default: 0 }),
}

export const SearchTerm = Type.String({ maxLength: 100 })

/** Array with an explicit ceiling, so a request cannot ask for unbounded work. */
export const Bounded = <T extends TSchema>(item: T, maxItems: number, minItems = 0) =>
  Type.Array(item, { minItems, maxItems })

/** The error body every service returns (see errors.ts). Use it in `response`. */
export const ErrorResponse = Type.Object(
  {
    statusCode: Type.Integer(),
    error: Type.String(),
    code: Type.String(),
    message: Type.String(),
    requestId: Type.Optional(Type.String()),
    fields: Type.Optional(
      Type.Array(
        Type.Object({ path: Type.String(), rule: Type.String() }, { additionalProperties: false })
      )
    ),
  },
  { additionalProperties: true }
)
