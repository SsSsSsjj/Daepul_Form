import type { Auth, CreateRequest, UpdateRequest, UserRecord } from 'firebase-admin/auth'
import { AuthFlowError, type LoginProvider, type SocialProvider } from './core'
import type { SocialProfile } from './providers'

export type AccountUser = Pick<UserRecord, 'uid' | 'email' | 'displayName' | 'photoURL' | 'customClaims'> & {
  providerData: Array<{ providerId: string }>
}

export interface AccountAuthGateway {
  getUserByEmail(email: string): Promise<AccountUser>
  getUser(uid: string): Promise<AccountUser>
  createUser(properties: CreateRequest): Promise<AccountUser>
  updateUser(uid: string, properties: UpdateRequest): Promise<AccountUser>
  setCustomUserClaims(uid: string, claims: Record<string, unknown>): Promise<void>
  createCustomToken(uid: string, claims: Record<string, unknown>): Promise<string>
}

export class FirebaseAdminAuthGateway implements AccountAuthGateway {
  constructor(private readonly auth: Auth) {}

  getUserByEmail(email: string) { return this.auth.getUserByEmail(email) }
  getUser(uid: string) { return this.auth.getUser(uid) }
  createUser(properties: CreateRequest) { return this.auth.createUser(properties) }
  updateUser(uid: string, properties: UpdateRequest) { return this.auth.updateUser(uid, properties) }
  setCustomUserClaims(uid: string, claims: Record<string, unknown>) { return this.auth.setCustomUserClaims(uid, claims) }
  createCustomToken(uid: string, claims: Record<string, unknown>) { return this.auth.createCustomToken(uid, claims) }
}

function isUserNotFound(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'auth/user-not-found'
}

async function findUserByEmail(auth: AccountAuthGateway, email: string) {
  try {
    return await auth.getUserByEmail(email)
  } catch (error) {
    if (isUserNotFound(error)) return null
    throw error
  }
}

async function findUserByUid(auth: AccountAuthGateway, uid: string) {
  try {
    return await auth.getUser(uid)
  } catch (error) {
    if (isUserNotFound(error)) return null
    throw error
  }
}

export function loginProviderForUser(user: AccountUser): LoginProvider {
  const customProvider = user.customClaims?.socialProvider
  if (customProvider === 'kakao' || customProvider === 'naver') return customProvider
  const providerIds = user.providerData.map((item) => item.providerId)
  if (providerIds.includes('google.com')) return 'google'
  if (providerIds.includes('password')) return 'email'
  return 'existing'
}

function userProperties(profile: SocialProfile) {
  return {
    email: profile.email,
    emailVerified: true,
    displayName: profile.displayName,
    ...(profile.photoURL ? { photoURL: profile.photoURL } : {}),
  }
}

export async function createSocialCustomToken(auth: AccountAuthGateway, profile: SocialProfile) {
  const uid = `${profile.provider}:${profile.id}`
  if (uid.length > 128) throw new AuthFlowError('provider_unavailable', '공급자 사용자 ID가 Firebase UID 제한을 초과했습니다.')

  const emailUser = await findUserByEmail(auth, profile.email)
  if (emailUser && emailUser.uid !== uid) {
    throw new AuthFlowError('account_exists', '같은 이메일로 가입된 Firebase 계정이 있습니다.', loginProviderForUser(emailUser))
  }

  let user = await findUserByUid(auth, uid)
  if (!user) {
    user = await auth.createUser({ uid, ...userProperties(profile) })
  } else {
    user = await auth.updateUser(uid, userProperties(profile))
  }

  await auth.setCustomUserClaims(uid, { ...user.customClaims, socialProvider: profile.provider })
  return auth.createCustomToken(uid, { socialProvider: profile.provider })
}

export function isSocialProviderClaim(value: unknown): value is SocialProvider {
  return value === 'kakao' || value === 'naver'
}
