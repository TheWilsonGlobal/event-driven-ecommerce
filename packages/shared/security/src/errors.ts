import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

/**
 * One error shape for every service.
 *
 * It is a superset of Fastify's default (`statusCode`, `error`, `message`) so
 * existing clients that read those keep working, plus a stable machine `code`
 * and the `requestId` to quote in a bug report. Validation errors list WHICH
 * field broke WHICH rule, never the offending value (it may be a password or a
 * token) and never a stack trace.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {}
  ) {
    super(message)
    this.name = 'AppError'
  }
}

const REASONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
}

export const unauthorized = (
  code = 'AUTHENTICATION_REQUIRED',
  message = 'Authentication required'
) => new AppError(401, code, message)
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have permission to do this') =>
  new AppError(403, code, message)
/** Used instead of 403 for another user's record, so ids cannot be enumerated. */
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message)

interface ValidationIssue {
  instancePath?: string
  keyword?: string
  params?: Record<string, unknown>
}

function fieldsFrom(validation: unknown): { path: string; rule: string }[] {
  if (!Array.isArray(validation)) return []
  return (validation as ValidationIssue[]).slice(0, 20).map((v) => ({
    path: (v.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.') || '(root)',
    // The rule keyword only ("maxLength", "format", "required"), never the value.
    rule:
      v.keyword === 'required' && typeof v.params?.missingProperty === 'string'
        ? `required:${v.params.missingProperty}`
        : v.keyword === 'additionalProperties' && typeof v.params?.additionalProperty === 'string'
          ? `unknownField:${v.params.additionalProperty}`
          : (v.keyword ?? 'invalid'),
  }))
}

export function registerErrorHandling(server: FastifyInstance): void {
  server.setErrorHandler(
    (error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.id

      if (error instanceof AppError) {
        for (const [k, v] of Object.entries(error.headers)) reply.header(k, v)
        return reply.status(error.statusCode).send({
          statusCode: error.statusCode,
          error: REASONS[error.statusCode] ?? 'Error',
          code: error.code,
          message: error.message,
          requestId,
          ...error.extra,
        })
      }

      const fe = error as FastifyError
      if (fe.validation) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          fields: fieldsFrom(fe.validation),
          requestId,
        })
      }

      const status = typeof fe.statusCode === 'number' ? fe.statusCode : 500
      if (status >= 400 && status < 500) {
        const code =
          fe.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
            ? 'PAYLOAD_TOO_LARGE'
            : fe.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
              ? 'UNSUPPORTED_MEDIA_TYPE'
              : 'BAD_REQUEST'
        return reply.status(status).send({
          statusCode: status,
          error: REASONS[status] ?? 'Error',
          code,
          // Fastify's own 4xx messages are safe (no values); keep them.
          message: fe.message,
          requestId,
        })
      }

      // 5xx: log everything, tell the caller nothing.
      request.log.error({ err: error, requestId }, 'unhandled error')
      return reply.status(status).send({
        statusCode: status,
        error: REASONS[status] ?? 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong',
        requestId,
      })
    }
  )

  server.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      code: 'NOT_FOUND',
      message: 'Route not found',
      requestId: request.id,
    })
  })
}
