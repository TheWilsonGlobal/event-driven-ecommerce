#!/usr/bin/env node
// DEV helper: print the current TOTP code for a base32 secret (RFC 6238, SHA-1, 30 s, 6 digits).
//
//   node packages/admin/scripts/totp-dev.mjs <BASE32_SECRET>
//
// Take the secret from the "Can't scan? Enter this key manually" line of the enrolment screen.
// Never paste a production secret into shared terminals or logs.
import { createHmac } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32 -> bytes. Ignores spaces, hyphens and '=' padding; case-insensitive. */
export function base32Decode(input) {
  const clean = input.replace(/[\s=-]/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** HOTP/TOTP code for `secret` at unix time `timeSec`. */
export function totp(secret, timeSec = Math.floor(Date.now() / 1000), digits = 6, step = 30) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(timeSec / step)))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const secret = process.argv[2]
  if (!secret) {
    console.error('Usage: node packages/admin/scripts/totp-dev.mjs <BASE32_SECRET>')
    process.exit(2)
  }
  try {
    const show = () => {
      const now = Math.floor(Date.now() / 1000)
      console.log(`code: ${totp(secret, now)}  (valid for ${30 - (now % 30)}s)`)
    }
    show()
    // --watch: print a fresh code every time the window rolls over (Ctrl+C to stop), so the
    // code is never already expired by the time you switch windows and type it.
    if (process.argv.includes('--watch')) {
      let last = Math.floor(Date.now() / 30000)
      setInterval(() => {
        const cur = Math.floor(Date.now() / 30000)
        if (cur !== last) {
          last = cur
          show()
        }
      }, 500)
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
