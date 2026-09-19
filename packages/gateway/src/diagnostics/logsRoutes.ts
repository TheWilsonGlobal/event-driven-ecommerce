import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { listLogFiles, readLogFile } from '@ecommerce/shared-utils'

const SERVICE = 'gateway'

const logFileSchema = {
  type: 'object',
  properties: {
    filename: { type: 'string' },
    service: { type: 'string' },
    sizeBytes: { type: 'number' },
    mtime: { type: 'string', format: 'date-time' },
    birthtime: { type: 'string', format: 'date-time' },
    level: { type: 'string', enum: ['error', 'warn', 'info'] },
  },
  required: ['filename', 'service', 'sizeBytes', 'mtime', 'birthtime', 'level'],
} as const

/**
 * Real log-file listing and single-file read routes, backed by the NDJSON
 * files this service's own pino logger writes to `<repo-root>/logs/` (see
 * `@ecommerce/shared-utils`'s `buildLoggerOptions`). No in-memory buffer, no
 * mock entries — restarting the service does not lose history because the
 * files persist on disk.
 */
export function registerLogRoutes(server: FastifyInstance): void {
  server.get(
    '/api/v1/logs',
    {
      schema: {
        tags: ['logs'],
        description:
          "List this service's real log files on disk, each with real size/mtime and a " +
          'level inferred by scanning the file for pino error(50)/warn(40) JSON lines.',
        response: {
          200: {
            type: 'object',
            properties: {
              files: { type: 'array', items: logFileSchema },
              total: { type: 'number' },
            },
            required: ['files', 'total'],
          },
        },
      },
    },
    async () => {
      const files = listLogFiles(SERVICE)
      return { files, total: files.length }
    }
  )

  server.get(
    '/api/v1/logs/:filename',
    {
      schema: {
        tags: ['logs'],
        description:
          "Return one real log file's raw NDJSON content by filename. The filename is " +
          "validated against this service's real log directory listing first; path traversal " +
          '(`..`, `/`, `\\`) and any name not already on disk are rejected with 400/404.',
        params: {
          type: 'object',
          properties: { filename: { type: 'string' } },
          required: ['filename'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              filename: { type: 'string' },
              sizeBytes: { type: 'number' },
              content: { type: 'string' },
            },
            required: ['filename', 'sizeBytes', 'content'],
          },
          400: { type: 'object', properties: { error: { type: 'string' } } },
          404: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { filename: string } }>, reply: FastifyReply) => {
      const { filename } = request.params
      const result = readLogFile(SERVICE, filename)

      if (!result.ok) {
        if (result.reason === 'invalid_filename') {
          return reply.status(400).send({ error: 'Invalid filename' })
        }
        return reply.status(404).send({ error: `Log file ${filename} not found` })
      }

      return result.data
    }
  )
}
