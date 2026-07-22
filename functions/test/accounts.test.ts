import { describe, expect, it } from 'vitest'
import { createSocialCustomToken, type AccountAuthGateway, type AccountUser } from '../src/auth/accounts'
import type { SocialProfile } from '../src/auth/providers'

function notFound() {
  return Object.assign(new Error('not found'), { code: 'auth/user-not-found' })
}

class FakeAuth implements AccountAuthGateway {
  readonly users = new Map<string, AccountUser>()

  async getUserByEmail(email: string) {
    const user = [...this.users.values()].find((item) => item.email === email)
    if (!user) throw notFound()
    return user
  }
  async getUser(uid: string) {
    const user = this.users.get(uid)
    if (!user) throw notFound()
    return user
  }
  async createUser(properties: { uid?: string; email?: string; displayName?: string; photoURL?: string }) {
    const uid = properties.uid ?? 'generated'
    const user: AccountUser = {
      uid,
      email: properties.email,
      displayName: properties.displayName,
      photoURL: properties.photoURL,
      customClaims: {},
      providerData: [],
    }
    this.users.set(uid, user)
    return user
  }
  async updateUser(uid: string, properties: { email?: string; displayName?: string; photoURL?: string }) {
    const current = await this.getUser(uid)
    const updated = { ...current, ...properties }
    this.users.set(uid, updated)
    return updated
  }
  async setCustomUserClaims(uid: string, claims: Record<string, unknown>) {
    const user = await this.getUser(uid)
    this.users.set(uid, { ...user, customClaims: claims })
  }
  async createCustomToken(uid: string) { return `token:${uid}` }
}

const kakaoProfile: SocialProfile = {
  provider: 'kakao',
  id: '1234',
  email: 'user@example.com',
  displayName: '사용자',
}

describe('social Firebase accounts', () => {
  it('creates a deterministic Firebase user and provider claim', async () => {
    const auth = new FakeAuth()
    await expect(createSocialCustomToken(auth, kakaoProfile)).resolves.toBe('token:kakao:1234')
    expect(auth.users.get('kakao:1234')).toMatchObject({
      email: 'user@example.com',
      customClaims: { socialProvider: 'kakao' },
    })
  })

  it.each([
    ['google', [{ providerId: 'google.com' }], {}],
    ['email', [{ providerId: 'password' }], {}],
    ['naver', [], { socialProvider: 'naver' }],
  ] as const)('rejects an email already owned by %s', async (existingProvider, providerData, customClaims) => {
    const auth = new FakeAuth()
    auth.users.set('existing-user', {
      uid: 'existing-user',
      email: 'user@example.com',
      displayName: '기존 사용자',
      photoURL: undefined,
      providerData: [...providerData],
      customClaims: { ...customClaims },
    })
    await expect(createSocialCustomToken(auth, kakaoProfile)).rejects.toMatchObject({
      code: 'account_exists',
      existingProvider,
    })
    expect(auth.users.has('kakao:1234')).toBe(false)
  })
})
