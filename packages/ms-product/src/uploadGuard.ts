import * as crypto from 'crypto'

/**
 * Upload content verification.
 *
 * A multipart part carries two things the client controls: the claimed MIME type
 * and the filename. Neither is evidence. The only trustworthy signal is the bytes
 * themselves, so the type is decided by their magic number and the claim must
 * agree with it. The stored object key is generated here (uuid + an extension
 * derived from the VERIFIED type); the client filename is never used.
 */

export type VerifiedType =
  'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf'

export const EXTENSION: Record<VerifiedType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b)

/** Identifies png / jpeg / gif / webp / pdf from the leading bytes, or null. */
export function sniffType(buf: Buffer): VerifiedType | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  // "GIF87a" / "GIF89a"
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])) return 'image/gif'
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif'
  // "RIFF" <4-byte size> "WEBP"
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp'
  }
  // "%PDF-"
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  return null
}

export type UploadVerdict =
  { ok: true; type: VerifiedType } | { ok: false; status: 400 | 415; code: string; message: string }

/**
 * `claimed` is the part's Content-Type header, `allowed` the route's allow-list.
 * Order matters: an unlisted claim is refused before the bytes are examined.
 */
export function verifyUpload(
  claimed: string,
  buf: Buffer,
  allowed: readonly VerifiedType[]
): UploadVerdict {
  if (buf.length === 0) {
    return { ok: false, status: 400, code: 'EMPTY_FILE', message: 'The uploaded file is empty' }
  }
  const claim = claimed.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!(allowed as readonly string[]).includes(claim)) {
    return {
      ok: false,
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: `Unsupported media type. Allowed: ${allowed.join(', ')}`,
    }
  }
  const actual = sniffType(buf)
  if (actual === null || actual !== claim) {
    return {
      ok: false,
      status: 415,
      code: 'CONTENT_TYPE_MISMATCH',
      message: 'The file content does not match its declared type',
    }
  }
  return { ok: true, type: actual }
}

/** `<prefix>/<uuid>.<ext>`: nothing the client sent appears in it. */
export function generateKey(prefix: 'products' | 'receipts', type: VerifiedType): string {
  return `${prefix}/${crypto.randomUUID()}.${EXTENSION[type]}`
}
