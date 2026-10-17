import Ajv, { type Options } from 'ajv'
import addFormats from 'ajv-formats'
import type { FastifyInstance } from 'fastify'

/**
 * Strict request validation for every service (pillar 1).
 *
 * Fastify's default Ajv silently COERCES types in request bodies ("5" becomes 5)
 * and, with `removeAdditional`, silently drops unknown fields. Both hide client
 * bugs and let hostile shapes through quietly. This compiler differs by part of
 * the request:
 *
 *   body                no coercion; extra fields are rejected wherever the
 *                       schema says `additionalProperties: false`
 *   querystring/params  coercion on, because those are strings on the wire
 *                       (`?limit=20` must validate as an integer)
 *
 * `allErrors` is off: stop at the first violation (cheaper, and it gives an
 * attacker less to learn from one response).
 */
const base: Options = {
  allErrors: false,
  useDefaults: true,
  removeAdditional: false,
  // `multipleOf: 0.01` on floats rejects valid prices (0.07, 0.29) without this.
  multipleOfPrecision: 2,
  // Route schemas carry OpenAPI-only keywords (`example`, `description`, ...).
  strict: false,
}

function makeAjv(coerce: boolean): Ajv {
  const ajv = new Ajv({ ...base, coerceTypes: coerce ? 'array' : false })
  addFormats(ajv)
  return ajv
}

export function registerStrictValidation(server: FastifyInstance): void {
  // Fastify ships a `text/plain` parser that hands handlers a raw string. This API
  // speaks JSON (and multipart on upload routes, which register their own
  // parser), so anything else is refused with 415 instead of reaching a handler.
  server.removeContentTypeParser('text/plain')

  const bodyAjv = makeAjv(false)
  const looseAjv = makeAjv(true)

  server.setValidatorCompiler(({ schema, httpPart }) => {
    const ajv = httpPart === 'body' ? bodyAjv : looseAjv
    const validate = ajv.compile(schema as object)
    return (data: unknown) => {
      if (validate(data)) return { value: data }
      return { error: validate.errors as never }
    }
  })
}

/** Server construction options every service should spread into `fastify({...})`. */
export function securityServerOptions(env: NodeJS.ProcessEnv = process.env): {
  bodyLimit: number
  requestTimeout: number
  keepAliveTimeout: number
  trustProxy: boolean | number | string
} {
  const v = env.TRUST_PROXY?.trim()
  const trustProxy: boolean | number | string =
    !v || v === 'false' ? false : v === 'true' ? true : /^\d+$/.test(v) ? parseInt(v, 10) : v
  return {
    // 100 KB default for JSON. Upload routes raise their own limit explicitly.
    bodyLimit: parseInt(env.BODY_LIMIT_BYTES ?? '', 10) || 100 * 1024,
    requestTimeout: parseInt(env.REQUEST_TIMEOUT_MS ?? '', 10) || 30_000,
    keepAliveTimeout: 5_000,
    trustProxy,
  }
}
