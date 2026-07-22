import { AuthFlowError, type SocialProvider } from './core'

export type ProviderCredentials = {
  clientId: string
  clientSecret: string
}

export type SocialProfile = {
  provider: SocialProvider
  id: string
  email: string
  displayName: string
  photoURL?: string
}

type FetchLike = typeof fetch

function redirectUri(publicOrigin: string, provider: SocialProvider) {
  return `${publicOrigin}/api/auth/${provider}/callback`
}

function validProviderId(value: unknown) {
  const id = String(value ?? '').trim()
  if (!id || [...id].some((character) => character.charCodeAt(0) < 32)) {
    throw new AuthFlowError('provider_unavailable', '공급자가 올바른 사용자 ID를 반환하지 않았습니다.')
  }
  return id
}

function requiredEmail(value: unknown, valid = true) {
  const email = String(value ?? '').trim().toLowerCase()
  if (!email || !valid || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new AuthFlowError('email_required', '로그인하려면 이메일 제공 동의가 필요합니다.')
  }
  return email
}

function httpsPhoto(value: unknown) {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

async function requestJson(fetcher: FetchLike, url: string, init: RequestInit) {
  let response: Response
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new AuthFlowError('provider_unavailable', '로그인 공급자에 연결하지 못했습니다.')
  }
  if (!response.ok) throw new AuthFlowError('provider_unavailable', `로그인 공급자가 ${response.status} 오류를 반환했습니다.`)
  try {
    return await response.json() as Record<string, unknown>
  } catch {
    throw new AuthFlowError('provider_unavailable', '로그인 공급자의 응답을 해석하지 못했습니다.')
  }
}

export function buildAuthorizationUrl(
  provider: SocialProvider,
  credentials: ProviderCredentials,
  publicOrigin: string,
  state: string,
) {
  const url = new URL(provider === 'kakao'
    ? 'https://kauth.kakao.com/oauth/authorize'
    : 'https://nid.naver.com/oauth2.0/authorize')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', credentials.clientId)
  url.searchParams.set('redirect_uri', redirectUri(publicOrigin, provider))
  url.searchParams.set('state', state)
  if (provider === 'kakao') url.searchParams.set('scope', 'account_email profile_nickname profile_image')
  return url.toString()
}

async function kakaoProfile(
  code: string,
  credentials: ProviderCredentials,
  publicOrigin: string,
  fetcher: FetchLike,
): Promise<SocialProfile> {
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: redirectUri(publicOrigin, 'kakao'),
    code,
  })
  const token = await requestJson(fetcher, 'https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: tokenBody,
  })
  const accessToken = typeof token.access_token === 'string' ? token.access_token : ''
  if (!accessToken) throw new AuthFlowError('provider_unavailable', '카카오 액세스 토큰을 받지 못했습니다.')
  const user = await requestJson(fetcher, 'https://kapi.kakao.com/v2/user/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const account = (user.kakao_account ?? {}) as Record<string, unknown>
  const profile = (account.profile ?? {}) as Record<string, unknown>
  const emailIsValid = account.is_email_valid !== false && account.is_email_verified !== false
  const email = requiredEmail(account.email, emailIsValid)
  return {
    provider: 'kakao',
    id: validProviderId(user.id),
    email,
    displayName: String(profile.nickname ?? email.split('@')[0]),
    photoURL: httpsPhoto(profile.profile_image_url),
  }
}

async function naverProfile(
  code: string,
  state: string,
  credentials: ProviderCredentials,
  publicOrigin: string,
  fetcher: FetchLike,
): Promise<SocialProfile> {
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: redirectUri(publicOrigin, 'naver'),
    code,
    state,
  })
  const token = await requestJson(fetcher, 'https://nid.naver.com/oauth2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: tokenBody,
  })
  const accessToken = typeof token.access_token === 'string' ? token.access_token : ''
  if (!accessToken) throw new AuthFlowError('provider_unavailable', '네이버 액세스 토큰을 받지 못했습니다.')
  const user = await requestJson(fetcher, 'https://openapi.naver.com/v1/nid/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (user.resultcode !== '00') throw new AuthFlowError('provider_unavailable', '네이버 사용자 정보를 받지 못했습니다.')
  const profile = (user.response ?? {}) as Record<string, unknown>
  const email = requiredEmail(profile.email)
  return {
    provider: 'naver',
    id: validProviderId(profile.id),
    email,
    displayName: String(profile.name ?? profile.nickname ?? email.split('@')[0]),
    photoURL: httpsPhoto(profile.profile_image),
  }
}

export async function exchangeCodeForProfile(
  provider: SocialProvider,
  code: string,
  state: string,
  credentials: ProviderCredentials,
  publicOrigin: string,
  fetcher: FetchLike = fetch,
) {
  if (!code) throw new AuthFlowError('invalid_request', 'OAuth 인가 코드가 없습니다.')
  return provider === 'kakao'
    ? kakaoProfile(code, credentials, publicOrigin, fetcher)
    : naverProfile(code, state, credentials, publicOrigin, fetcher)
}
