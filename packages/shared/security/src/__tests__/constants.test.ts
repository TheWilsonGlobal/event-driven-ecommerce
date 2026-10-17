import { loadSecurityConfig } from '../config'
import { AUTH_AUDIENCE_DEFAULT, RATE_LIMIT_DEFAULTS } from '@ecommerce/shared-constants'

describe('security defaults', () => {
  it('equal the values that used to be literals / .env entries', () => {
    const cfg = loadSecurityConfig({})
    expect(cfg.limits).toEqual({
      ipPerMin: 300,
      authIpPerMin: 20,
      authEmailPerMin: 5,
      userReadPerMin: 120,
      userWritePerMin: 30,
      expensivePerMin: 20,
      adminPerMin: 10,
    })
    expect(cfg.limits).toEqual(RATE_LIMIT_DEFAULTS)
    expect(cfg.audience).toBe('authenticated')
    expect(AUTH_AUDIENCE_DEFAULT).toBe('authenticated')
    expect(cfg.authMode).toBe('report')
    expect(cfg.rateLimitMode).toBe('report')
  })

  it('still lets the environment override', () => {
    const cfg = loadSecurityConfig({ RATE_LIMIT_IP_PER_MIN: '5', AUTH_AUDIENCE: 'other' })
    expect(cfg.limits.ipPerMin).toBe(5)
    expect(cfg.limits.adminPerMin).toBe(10)
    expect(cfg.audience).toBe('other')
  })
})
