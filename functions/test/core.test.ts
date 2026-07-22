import { describe, expect, it } from 'vitest'
import {
  addAuthParams,
  normalizePublicOrigin,
  readCookie,
  safeEqual,
  sanitizeReturnTo,
  serializeStateCookie,
} from '../src/auth/core'

describe('OAuth core utilities', () => {
  it('keeps same-origin return paths and removes auth parameters', () => {
    expect(sanitizeReturnTo('/?form=abc&auth_code=secret#result')).toBe('/?form=abc#result')
    expect(sanitizeReturnTo('https://evil.example/')).toBe('/')
    expect(sanitizeReturnTo('//evil.example/')).toBe('/')
  })

  it('builds a callback URL without losing the form query', () => {
    expect(addAuthParams('https://daepulform.web.app', '/?form=abc', {
      auth_code: 'one-time',
      auth_provider: 'kakao',
    })).toBe('https://daepulform.web.app/?form=abc&auth_code=one-time&auth_provider=kakao')
  })

  it('uses a secure host cookie in production and can read it back', () => {
    const cookie = serializeStateCookie('https://daepulform.web.app', 'state-value', 600)
    expect(cookie).toContain('__Host-daepul_oauth_state=state-value')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(readCookie('__Host-daepul_oauth_state=state-value; other=value', '__Host-daepul_oauth_state')).toBe('state-value')
  })

  it('performs timing-safe equality and validates configured origins', () => {
    expect(safeEqual('same', 'same')).toBe(true)
    expect(safeEqual('same', 'different')).toBe(false)
    expect(normalizePublicOrigin('https://daepulform.web.app')).toBe('https://daepulform.web.app')
    expect(() => normalizePublicOrigin('https://daepulform.web.app/path')).toThrow()
  })
})
