import { describe, it, expect } from 'vitest'
import { base32Decode, totp } from '../../scripts/totp-dev.mjs'

// RFC 6238 appendix B: ASCII secret '12345678901234567890' (SHA-1).
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('totp-dev script', () => {
  it('decodes base32 to the RFC secret bytes', () => {
    expect(base32Decode(SECRET).toString('ascii')).toBe('12345678901234567890')
    expect(base32Decode('gezd gnbv-gy3t qojq====').toString('ascii')).toBe('1234567890')
  })

  it('matches the RFC 6238 vectors (8 digits)', () => {
    expect(totp(SECRET, 59, 8)).toBe('94287082')
    expect(totp(SECRET, 1111111109, 8)).toBe('07081804')
    expect(totp(SECRET, 20000000000, 8)).toBe('65353130')
  })

  it('produces the 6-digit variant (truncation of the same value)', () => {
    expect(totp(SECRET, 59, 6)).toBe('287082')
  })

  it('rejects characters outside the base32 alphabet', () => {
    expect(() => totp('abc1', 59)).toThrow(/Invalid base32/)
  })
})
