import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const socialProviders = ['kakao', 'naver'] as const
export type SocialProvider = (typeof socialProviders)[number]
export type LoginProvider = SocialProvider | 'google' | 'email' | 'existing'

export type AuthErrorCode =
  | 'account_exists'
  | 'email_required'
  | 'invalid_exchange_code'
  | 'invalid_request'
  | 'invalid_state'
  | 'oauth_cancelled'
  | 'origin_not_allowed'
  | 'provider_unavailable'

export class AuthFlowError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly existingProvider?: LoginProvider,
  ) {
    super(message)
    this.name = 'AuthFlowError'
  }
}

export function isSocialProvider(value: string): value is SocialProvider {
  return socialProviders.includes(value as SocialProvider)
}

export function randomCode() {
  return randomBytes(32).toString('base64url')
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function safeEqual(first: string, second: string) {
  const firstBuffer = Buffer.from(first)
  const secondBuffer = Buffer.from(second)
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer)
}

export function sanitizeReturnTo(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/'
  try {
    const url = new URL(value, 'https://daepul.invalid')
    if (url.origin !== 'https://daepul.invalid') return '/'
    for (const key of ['auth_code', 'auth_error', 'auth_provider', 'existing_provider']) {
      url.searchParams.delete(key)
    }
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

export function normalizePublicOrigin(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('AUTH_PUBLIC_ORIGIN은 경로가 없는 http(s) origin이어야 합니다.')
  }
  return url.origin
}

export function addAuthParams(publicOrigin: string, returnTo: string, params: Record<string, string | undefined>) {
  const target = new URL(sanitizeReturnTo(returnTo), publicOrigin)
  for (const [key, value] of Object.entries(params)) {
    if (value) target.searchParams.set(key, value)
  }
  return target.toString()
}

export function stateCookieName(publicOrigin: string) {
  return new URL(publicOrigin).protocol === 'https:' ? '__Host-daepul_oauth_state' : 'daepul_oauth_state'
}

export function serializeStateCookie(publicOrigin: string, value: string, maxAgeSeconds: number) {
  const secure = new URL(publicOrigin).protocol === 'https:'
  return [
    `${stateCookieName(publicOrigin)}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${maxAgeSeconds}`,
  ].filter(Boolean).join('; ')
}

export function readCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return ''
  for (const item of cookieHeader.split(';')) {
    const [key, ...rest] = item.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}
