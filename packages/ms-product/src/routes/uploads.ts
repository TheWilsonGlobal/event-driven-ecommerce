import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RustFSStorageClient } from '@ecommerce/shared-database'
import { AppError, ErrorResponse } from '@ecommerce/shared-security'
import { UploadResponse } from '../schemas'
import { generateKey, verifyUpload, type VerifiedType } from '../uploadGuard'

interface UploadRouteDeps {
  rustfs: Pick<RustFSStorageClient, 'uploadObject'>
}

const MB = 1024 * 1024

/** Per-route ceilings on the file itself. */
export const IMAGE_MAX_BYTES = 10 * MB
export const RECEIPT_MAX_BYTES = 5 * MB

/** Multipart framing (boundaries, part headers, the small text fields) on top of the file. */
const FRAMING_OVERHEAD = 64 * 1024

/**
 * Explicit @fastify/multipart limits, registered once in index.ts. Without them
 * only `fileSize` was set and a request could carry unlimited parts and fields.
 * One file plus at most two small text fields; the per-route ceiling is applied
 * again at the call site (`req.file({ limits })`) so the receipt route is tighter.
 */
export const MULTIPART_LIMITS = {
  fileSize: IMAGE_MAX_BYTES,
  files: 1,
  fields: 2,
  parts: 3,
  fieldNameSize: 100,
  fieldSize: 1024,
  headerPairs: 20,
}

const IMAGE_TYPES: readonly VerifiedType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const RECEIPT_TYPES: readonly VerifiedType[] = [...IMAGE_TYPES, 'application/pdf']

interface UploadSpec {
  /** Multipart field the file must arrive in. */
  field: string
  allowed: readonly VerifiedType[]
  maxBytes: number
}

/**
 * Reads, bounds and VERIFIES one uploaded file, returning the bytes and the type
 * their content proves. Every refusal is an AppError so the caller sees the one
 * standard error shape.
 */
async function receiveFile(req: FastifyRequest, spec: UploadSpec) {
  // Cheap early refusal on the declared length; the stream limits below are the
  // real enforcement (a client can lie, or send it chunked).
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > spec.maxBytes + FRAMING_OVERHEAD) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'The uploaded file is too large')
  }

  const part = await req.file({ limits: { ...MULTIPART_LIMITS, fileSize: spec.maxBytes } })
  if (!part) throw new AppError(400, 'NO_FILE', 'No file uploaded')
  if (part.fieldname !== spec.field) {
    part.file.resume() // discard, so the connection is not left half-read
    throw new AppError(
      400,
      'UNEXPECTED_FIELD',
      `The file must be sent in the "${spec.field}" field`
    )
  }

  const chunks: Buffer[] = []
  let received = 0
  try {
    for await (const chunk of part.file) {
      received += (chunk as Buffer).length
      if (received > spec.maxBytes) {
        part.file.destroy()
        throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'The uploaded file is too large')
      }
      chunks.push(chunk as Buffer)
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'The uploaded file is too large')
    }
    throw err
  }
  if (part.file.truncated) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'The uploaded file is too large')
  }

  const buffer = Buffer.concat(chunks)
  // Decided by the bytes. `part.mimetype` is only the CLAIM and `part.filename`
  // is never read: the stored key below contains nothing the client chose.
  const verdict = verifyUpload(part.mimetype, buffer, spec.allowed)
  if (!verdict.ok) throw new AppError(verdict.status, verdict.code, verdict.message)
  return { buffer, type: verdict.type }
}

export function registerUploadRoutes(server: FastifyInstance, { rustfs }: UploadRouteDeps): void {
  // ─── Product Image Upload ─────────────────────────────────────────────────
  // POST /api/v1/products/upload  (multipart/form-data, field: "image")
  // Streams the file into RustFS and returns the public URL.
  // Note: the multipart body itself is not JSON-schema-validated (it is a stream,
  // not a JSON body); `receiveFile` applies the equivalent checks instead:
  // field name, size, MIME allow-list and magic bytes.
  server.post(
    '/api/v1/products/upload',
    {
      // Raised for this route only; every JSON route keeps the 100 KB default.
      bodyLimit: IMAGE_MAX_BYTES + FRAMING_OVERHEAD,
      config: { policy: { permission: 'uploads:write', audit: true }, rateTier: 'expensive' },
      schema: {
        tags: ['products'],
        description:
          'Upload a product image (multipart/form-data, field name "image"; jpeg, png, webp or ' +
          'gif, max 10 MB). The content is verified against its declared type and stored under ' +
          'a generated key; the client filename is ignored.',
        consumes: ['multipart/form-data'],
        response: {
          201: UploadResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          413: ErrorResponse,
          415: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const { buffer, type } = await receiveFile(req, {
        field: 'image',
        allowed: IMAGE_TYPES,
        maxBytes: IMAGE_MAX_BYTES,
      })
      const key = generateKey('products', type)
      try {
        const { url } = await rustfs.uploadObject(key, buffer, type)
        return reply.status(201).send({ key, url, size: buffer.byteLength })
      } catch (err: unknown) {
        // The cause stays in the log; the caller learns only that storage failed.
        server.log.error({ err }, '[RustFS] Upload failed')
        throw new AppError(503, 'STORAGE_UNAVAILABLE', 'Storage upload failed')
      }
    }
  )

  // ─── Receipt Upload (Order Saga) ─────────────────────────────────────────
  // POST /api/v1/receipts/upload  (multipart/form-data, field: "receipt")
  server.post(
    '/api/v1/receipts/upload',
    {
      bodyLimit: RECEIPT_MAX_BYTES + FRAMING_OVERHEAD,
      config: { policy: { permission: 'uploads:write', audit: true }, rateTier: 'expensive' },
      schema: {
        tags: ['products'],
        description:
          'Upload an order receipt (multipart/form-data, field name "receipt"; pdf, jpeg, png, ' +
          'webp or gif, max 5 MB). The content is verified against its declared type and stored ' +
          'under a generated key; the client filename is ignored.',
        consumes: ['multipart/form-data'],
        response: {
          201: UploadResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          413: ErrorResponse,
          415: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const { buffer, type } = await receiveFile(req, {
        field: 'receipt',
        allowed: RECEIPT_TYPES,
        maxBytes: RECEIPT_MAX_BYTES,
      })
      const key = generateKey('receipts', type)
      try {
        const { url } = await rustfs.uploadObject(key, buffer, type)
        return reply.status(201).send({ key, url, size: buffer.byteLength })
      } catch (err: unknown) {
        server.log.error({ err }, '[RustFS] Receipt upload failed')
        throw new AppError(503, 'STORAGE_UNAVAILABLE', 'Receipt upload failed')
      }
    }
  )
}
