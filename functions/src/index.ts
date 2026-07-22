import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { defineSecret, defineString } from 'firebase-functions/params'
import { onRequest, type Request } from 'firebase-functions/v2/https'
import { createSocialCustomToken, FirebaseAdminAuthGateway } from './auth/accounts'
import {
  addAuthParams,
  AuthFlowError,
  isSocialProvider,
  normalizePublicOrigin,
  readCookie,
  sanitizeReturnTo,
  serializeStateCookie,
  stateCookieName,
  type SocialProvider,
} from './auth/core'
import { buildAuthorizationUrl, exchangeCodeForProfile, type ProviderCredentials } from './auth/providers'
import { FirestoreOAuthSessionRepository, OAuthSessionService } from './auth/sessions'

type Response = Parameters<Parameters<typeof onRequest>[0]>[1]

initializeApp()

const authPublicOrigin = defineString('AUTH_PUBLIC_ORIGIN', {
  default: 'https://daepulform.web.app',
  description: '카카오·네이버에 등록한 대플폼 공개 origin',
})
const kakaoClientId = defineSecret('KAKAO_CLIENT_ID')
const kakaoClientSecret = defineSecret('KAKAO_CLIENT_SECRET')
const naverClientId = defineSecret('NAVER_CLIENT_ID')
const naverClientSecret = defineSecret('NAVER_CLIENT_SECRET')

const sessionService = new OAuthSessionService(new FirestoreOAuthSessionRepository(getFirestore()))
const accountAuth = new FirebaseAdminAuthGateway(getAuth())

function credentialsFor(provider: SocialProvider): ProviderCredentials {
  return provider === 'kakao'
    ? { clientId: kakaoClientId.value(), clientSecret: kakaoClientSecret.value() }
    : { clientId: naverClientId.value(), clientSecret: naverClientSecret.value() }
}

function queryString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function requestOrigin(request: Request) {
  const forwardedProtocol = queryString(request.headers['x-forwarded-proto']).split(',')[0]
  const protocol = forwardedProtocol || request.protocol
  return `${protocol}://${request.get('host')}`
}

function setPrivateResponseHeaders(response: Response) {
  response.set({
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  })
}

function redirectWithError(
  response: Response,
  publicOrigin: string,
  returnTo: string,
  provider: SocialProvider,
  error: AuthFlowError,
) {
  response.redirect(303, addAuthParams(publicOrigin, returnTo, {
    auth_error: error.code,
    auth_provider: provider,
    existing_provider: error.existingProvider,
  }))
}

async function startLogin(request: Request, response: Response, provider: SocialProvider, publicOrigin: string) {
  const returnTo = sanitizeReturnTo(request.query.returnTo)
  if (requestOrigin(request) !== publicOrigin) {
    const canonicalStart = new URL(`/api/auth/${provider}/start`, publicOrigin)
    canonicalStart.searchParams.set('returnTo', returnTo)
    response.redirect(302, canonicalStart.toString())
    return
  }

  const state = await sessionService.createState(provider, returnTo)
  response.setHeader('Set-Cookie', serializeStateCookie(publicOrigin, state, 10 * 60))
  response.redirect(302, buildAuthorizationUrl(provider, credentialsFor(provider), publicOrigin, state))
}

async function completeLogin(request: Request, response: Response, provider: SocialProvider, publicOrigin: string) {
  const state = queryString(request.query.state)
  const cookieState = readCookie(request.headers.cookie, stateCookieName(publicOrigin))
  let returnTo = '/'

  try {
    returnTo = await sessionService.consumeState(provider, state, cookieState)
    if (request.query.error) throw new AuthFlowError('oauth_cancelled', `${provider} 로그인이 취소되었습니다.`)

    const profile = await exchangeCodeForProfile(
      provider,
      queryString(request.query.code),
      state,
      credentialsFor(provider),
      publicOrigin,
    )
    const customToken = await createSocialCustomToken(accountAuth, profile)
    const exchangeCode = await sessionService.createExchange(customToken)
    response.setHeader('Set-Cookie', serializeStateCookie(publicOrigin, '', 0))
    response.redirect(303, addAuthParams(publicOrigin, returnTo, {
      auth_code: exchangeCode,
      auth_provider: provider,
    }))
  } catch (error) {
    const authError = error instanceof AuthFlowError
      ? error
      : new AuthFlowError('provider_unavailable', '소셜 로그인 처리 중 오류가 발생했습니다.')
    logger.warn('Social login callback failed', { provider, code: authError.code })
    response.setHeader('Set-Cookie', serializeStateCookie(publicOrigin, '', 0))
    redirectWithError(response, publicOrigin, returnTo, provider, authError)
  }
}

async function exchangeLoginCode(request: Request, response: Response, publicOrigin: string) {
  if (request.get('origin') !== publicOrigin) throw new AuthFlowError('origin_not_allowed', '허용되지 않은 origin입니다.')
  if (!request.is('application/json')) throw new AuthFlowError('invalid_request', 'JSON 요청만 허용됩니다.')
  const body = typeof request.body === 'object' && request.body !== null ? request.body as Record<string, unknown> : {}
  const code = typeof body.code === 'string' ? body.code : ''
  const customToken = await sessionService.consumeExchange(code)
  response.status(200).json({ customToken })
}

async function routeAuthRequest(request: Request, response: Response) {
  setPrivateResponseHeaders(response)
  const publicOrigin = normalizePublicOrigin(authPublicOrigin.value())
  const path = request.path.replace(/\/+$/, '')

  const providerRoute = path.match(/^\/api\/auth\/(kakao|naver)\/(start|callback)$/)
  if (providerRoute && isSocialProvider(providerRoute[1])) {
    const [, provider, action] = providerRoute
    if (request.method !== 'GET') {
      response.status(405).set('Allow', 'GET').json({ error: 'method_not_allowed' })
      return
    }
    if (action === 'start') await startLogin(request, response, provider, publicOrigin)
    else await completeLogin(request, response, provider, publicOrigin)
    return
  }

  if (path === '/api/auth/exchange') {
    if (request.method !== 'POST') {
      response.status(405).set('Allow', 'POST').json({ error: 'method_not_allowed' })
      return
    }
    try {
      await exchangeLoginCode(request, response, publicOrigin)
    } catch (error) {
      const authError = error instanceof AuthFlowError
        ? error
        : new AuthFlowError('invalid_exchange_code', '로그인 코드를 교환하지 못했습니다.')
      const status = authError.code === 'origin_not_allowed' ? 403 : 400
      response.status(status).json({ error: authError.code })
    }
    return
  }

  response.status(404).json({ error: 'not_found' })
}

export const socialAuth = onRequest({
  region: 'asia-northeast3',
  secrets: [kakaoClientId, kakaoClientSecret, naverClientId, naverClientSecret],
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 20,
}, async (request, response) => {
  try {
    await routeAuthRequest(request, response)
  } catch (error) {
    logger.error('Unhandled social auth error', error)
    if (!response.headersSent) response.status(500).json({ error: 'internal_error' })
  }
})
