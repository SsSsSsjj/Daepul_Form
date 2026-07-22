import { describe, expect, it, vi } from 'vitest'
import { buildAuthorizationUrl, exchangeCodeForProfile } from '../src/auth/providers'

const credentials = { clientId: 'client-id', clientSecret: 'client-secret' }
const origin = 'https://daepulform.web.app'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('social OAuth providers', () => {
  it('builds provider authorization URLs with a fixed callback and state', () => {
    const kakao = new URL(buildAuthorizationUrl('kakao', credentials, origin, 'state'))
    expect(kakao.origin).toBe('https://kauth.kakao.com')
    expect(kakao.searchParams.get('redirect_uri')).toBe(`${origin}/api/auth/kakao/callback`)
    expect(kakao.searchParams.get('state')).toBe('state')

    const naver = new URL(buildAuthorizationUrl('naver', credentials, origin, 'state'))
    expect(naver.origin).toBe('https://nid.naver.com')
    expect(naver.searchParams.get('redirect_uri')).toBe(`${origin}/api/auth/naver/callback`)
  })

  it('exchanges a Kakao code and normalizes the required profile', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'kakao-token' }))
      .mockResolvedValueOnce(jsonResponse({
        id: 12345,
        kakao_account: {
          email: 'USER@EXAMPLE.COM',
          is_email_valid: true,
          is_email_verified: true,
          profile: { nickname: '카카오 사용자', profile_image_url: 'https://example.com/kakao.png' },
        },
      })) as unknown as typeof fetch

    await expect(exchangeCodeForProfile('kakao', 'code', 'state', credentials, origin, fetcher)).resolves.toEqual({
      provider: 'kakao',
      id: '12345',
      email: 'user@example.com',
      displayName: '카카오 사용자',
      photoURL: 'https://example.com/kakao.png',
    })
  })

  it('exchanges a Naver code and normalizes the required profile', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'naver-token' }))
      .mockResolvedValueOnce(jsonResponse({
        resultcode: '00',
        response: { id: 'naver-id', email: 'naver@example.com', name: '네이버 사용자' },
      })) as unknown as typeof fetch

    await expect(exchangeCodeForProfile('naver', 'code', 'state', credentials, origin, fetcher)).resolves.toMatchObject({
      provider: 'naver',
      id: 'naver-id',
      email: 'naver@example.com',
      displayName: '네이버 사용자',
    })
  })

  it('requires email consent and reports provider outages without leaking responses', async () => {
    const noEmailFetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token' }))
      .mockResolvedValueOnce(jsonResponse({ id: 1, kakao_account: { profile: { nickname: '사용자' } } })) as unknown as typeof fetch
    await expect(exchangeCodeForProfile('kakao', 'code', 'state', credentials, origin, noEmailFetcher))
      .rejects.toMatchObject({ code: 'email_required' })

    const failedFetcher = vi.fn().mockResolvedValue(jsonResponse({ error: 'temporary' }, 503)) as unknown as typeof fetch
    await expect(exchangeCodeForProfile('naver', 'code', 'state', credentials, origin, failedFetcher))
      .rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})
