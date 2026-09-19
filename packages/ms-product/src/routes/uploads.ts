import type { FastifyInstance, FastifyRequest } from 'fastify'
import * as crypto from 'crypto'
import type { RustFSStorageClient } from '@ecommerce/shared-database'

interface UploadRouteDeps {
  rustfs: RustFSStorageClient
}

export function registerUploadRoutes(server: FastifyInstance, { rustfs }: UploadRouteDeps): void {
  // ─── Product Image Upload ─────────────────────────────────────────────────
  // POST /api/v1/products/upload  (multipart/form-data, field: "image")
  // Streams the file into RustFS and returns the public URL.
  // Note: the multipart body itself is intentionally not JSON-schema-validated
  // here — @fastify/multipart streams are not plain JSON bodies, and fastify's
  // body-schema validation does not apply cleanly to them. The `consumes` hint
  // and response schema below still let Swagger UI document and drive this
  // endpoint correctly.
  server.post(
    '/api/v1/products/upload',
    {
      schema: {
        tags: ['products'],
        description:
          'Upload a product image (multipart/form-data, field name "image"). ' +
          'Streams the file into RustFS and returns its storage key and public URL.',
        consumes: ['multipart/form-data'],
        response: {
          201: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              url: { type: 'string' },
              size: { type: 'number' },
            },
          },
          400: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          415: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          500: {
            type: 'object',
            properties: { error: { type: 'string' }, detail: { type: 'string' } },
          },
        },
      },
    },
    async (req: FastifyRequest, reply) => {
      const data = await req.file()
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' })
      }

      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
      if (!allowedMimes.includes(data.mimetype)) {
        return reply.status(415).send({
          error: 'Unsupported media type. Allowed: jpeg, png, webp, gif',
        })
      }

      // Collect stream into buffer
      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk as Buffer)
      }
      const buffer = Buffer.concat(chunks)

      const ext = data.filename.split('.').pop() ?? 'jpg'
      const uid = crypto.randomUUID()
      const key = `products/${uid}.${ext}`

      try {
        const { url } = await rustfs.uploadObject(key, buffer, data.mimetype)
        return reply.status(201).send({ key, url, size: buffer.byteLength })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        server.log.error(`[RustFS] Upload failed: ${message}`)
        return reply.status(500).send({ error: 'Storage upload failed', detail: message })
      }
    }
  )

  // ─── Receipt Upload (Order Saga) ─────────────────────────────────────────
  // POST /api/v1/receipts/upload  (multipart/form-data, field: "receipt")
  // Note: as above, the multipart body is not JSON-schema-validated; only the
  // consumes hint and response shape are documented.
  server.post(
    '/api/v1/receipts/upload',
    {
      schema: {
        tags: ['products'],
        description:
          'Upload an order receipt (multipart/form-data, field name "receipt"). ' +
          'Streams the file into RustFS as a PDF and returns its storage key and public URL.',
        consumes: ['multipart/form-data'],
        response: {
          201: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              url: { type: 'string' },
              size: { type: 'number' },
            },
          },
          400: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          500: {
            type: 'object',
            properties: { error: { type: 'string' }, detail: { type: 'string' } },
          },
        },
      },
    },
    async (req: FastifyRequest, reply) => {
      const data = await req.file()
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' })
      }

      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk as Buffer)
      }
      const buffer = Buffer.concat(chunks)

      const uid = crypto.randomUUID()
      const key = `receipts/${uid}.pdf`

      try {
        const { url } = await rustfs.uploadObject(key, buffer, 'application/pdf')
        return reply.status(201).send({ key, url, size: buffer.byteLength })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return reply.status(500).send({ error: 'Receipt upload failed', detail: message })
      }
    }
  )
}
