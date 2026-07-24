import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { defineSecret, defineString } from 'firebase-functions/params'
import { onRequest, type Request } from 'firebase-functions/v2/https'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
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

type SubmissionPayload = {
  formId?: unknown
  answers?: unknown
  respondentEmail?: unknown
  respondentName?: unknown
  studentId?: unknown
  attachments?: unknown
}

function stringValue(value: unknown, maximum = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function participantIsAllowed(
  access: Record<string, unknown>,
  token: Record<string, unknown>,
  anonymous: boolean,
) {
  const participation = stringValue(access.participation)
  const email = stringValue(token.email).toLowerCase()
  const verified = token.email_verified === true
  if (participation === 'anyone') return true
  if (participation === 'authenticated') return !anonymous
  if (participation === 'kangnam') return verified && email.endsWith('@kangnam.ac.kr')
  if (participation === 'allowlist') {
    const allowed = Array.isArray(access.allowedEmails) ? access.allowedEmails.map((value) => stringValue(value).toLowerCase()) : []
    return verified && allowed.includes(email)
  }
  return !anonymous
}

function validateAnswersAgainstQuestions(questions: unknown, answers: Record<string, unknown>) {
  if (!Array.isArray(questions) || Object.keys(answers).length > 300) {
    throw new HttpsError('invalid-argument', '답변 구조가 올바르지 않습니다.')
  }
  for (const item of questions) {
    const question = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const id = String(question.id ?? '')
    const value = answers[id]
    const empty = value === undefined || value === null || value === '' || value === false
    if (question.required === true && empty) throw new HttpsError('invalid-argument', `${stringValue(question.label)} 질문은 필수입니다.`)
    if (empty) continue
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new HttpsError('invalid-argument', '지원하지 않는 답변 형식입니다.')
    }
    if (typeof value === 'string' && value.length > 20_000) throw new HttpsError('invalid-argument', '답변이 너무 깁니다.')
    if (question.type === 'number') {
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) throw new HttpsError('invalid-argument', '숫자 답변을 확인해 주세요.')
      if (question.min !== undefined && numeric < Number(question.min)) throw new HttpsError('invalid-argument', '숫자 답변이 최솟값보다 작습니다.')
      if (question.max !== undefined && numeric > Number(question.max)) throw new HttpsError('invalid-argument', '숫자 답변이 최댓값보다 큽니다.')
    }
    if (question.type === 'select' && Array.isArray(question.options) && !question.options.includes(value)) {
      throw new HttpsError('invalid-argument', '선택지 답변이 올바르지 않습니다.')
    }
  }
}

export const submitFormResponse = onCall({
  region: 'asia-northeast3',
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 40,
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '응답 세션이 필요합니다.')
  const authContext = request.auth
  const payload = request.data as SubmissionPayload
  const formId = stringValue(payload.formId, 120)
  const answers = payload.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers)
    ? payload.answers as Record<string, unknown>
    : null
  if (!formId || !answers) throw new HttpsError('invalid-argument', '폼과 답변을 확인해 주세요.')

  const database = getFirestore()
  const formRef = database.doc(`forms/${formId}`)
  const provider = stringValue(authContext.token.firebase?.sign_in_provider)
  const anonymous = provider === 'anonymous'
  const result = await database.runTransaction(async (transaction) => {
    const formSnapshot = await transaction.get(formRef)
    if (!formSnapshot.exists) throw new HttpsError('not-found', '폼을 찾을 수 없습니다.')
    const form = formSnapshot.data() ?? {}
    const settings = form.settings as Record<string, Record<string, unknown>> | undefined
    const access = settings?.access ?? { participation: 'authenticated', allowMultiple: false }
    const submission = settings?.submission ?? {}
    const schedule = settings?.schedule ?? { status: 'open' }
    validateAnswersAgainstQuestions(form.questions, answers)
    if (form.published !== true || schedule.status !== 'open') throw new HttpsError('failed-precondition', '현재 응답을 접수하지 않습니다.')
    const startsAt = Date.parse(stringValue(schedule.startsAt))
    const closesAt = Date.parse(stringValue(schedule.closesAt))
    if (Number.isFinite(startsAt) && startsAt > Date.now()) throw new HttpsError('failed-precondition', '아직 응답 접수가 시작되지 않았습니다.')
    if (Number.isFinite(closesAt) && closesAt < Date.now()) throw new HttpsError('deadline-exceeded', '응답 접수가 마감되었습니다.')
    if (form.surveyEndAt instanceof Timestamp && form.surveyEndAt.toMillis() < Date.now()) {
      throw new HttpsError('deadline-exceeded', '응답 접수가 마감되었습니다.')
    }
    if (!participantIsAllowed(access, authContext.token as Record<string, unknown>, anonymous)) {
      throw new HttpsError('permission-denied', '이 폼의 참여 대상이 아닙니다.')
    }
    const maximum = Number(submission.maxResponses ?? 0)
    const currentCount = Number(form.responseCount ?? 0)
    if (maximum > 0 && currentCount >= maximum) throw new HttpsError('resource-exhausted', '최대 참여 인원에 도달했습니다.')

    const allowMultiple = access.allowMultiple === true
    const responseId = allowMultiple ? crypto.randomUUID() : authContext.uid
    const responseRef = formRef.collection('responses').doc(responseId)
    if (!allowMultiple && (await transaction.get(responseRef)).exists) {
      throw new HttpsError('already-exists', '이미 제출했습니다.')
    }
    const responseEmail = settings?.access?.identityCollection === 'verified_email'
      ? stringValue(authContext.token.email)
      : stringValue(payload.respondentEmail)
    transaction.create(responseRef, {
      responseId,
      formId,
      respondentUid: anonymous ? null : authContext.uid,
      anonymousId: anonymous ? authContext.uid : null,
      respondentEmail: responseEmail,
      respondentName: stringValue(payload.respondentName),
      studentId: stringValue(payload.studentId, 40),
      attachments: Array.isArray(payload.attachments)
        ? payload.attachments.slice(0, 10).map((item) => {
          const attachment = item && typeof item === 'object' ? item as Record<string, unknown> : {}
          const attachmentPath = stringValue(attachment.path, 500)
          if (!attachmentPath.startsWith(`response-files/${formId}/${authContext.uid}/`)) {
            throw new HttpsError('invalid-argument', '첨부파일 경로가 올바르지 않습니다.')
          }
          return {
            id: stringValue(attachment.id, 80),
            questionId: Number(attachment.questionId ?? 0),
            name: stringValue(attachment.name),
            contentType: stringValue(attachment.contentType, 100),
            size: Math.max(0, Number(attachment.size ?? 0)),
            path: attachmentPath,
            downloadUrl: stringValue(attachment.downloadUrl, 1000),
          }
        })
        : [],
      answers,
      status: 'submitted',
      formVersion: Number(settings?.version ?? 1),
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      immutable: settings?.submission?.allowEditAfterSubmit !== true,
    })
    transaction.update(formRef, {
      responseCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return {
      responseId,
      formTitle: stringValue((form.program as Record<string, unknown> | undefined)?.programName) || '대플폼',
      ownerEmail: stringValue(form.ownerEmail),
      responseEmail,
      sendOwnerNotification: settings?.notifications?.newResponseEmail === true,
      sendReceipt: settings?.submission?.emailReceipt === true,
    }
  })
  const mail = database.collection('mail')
  const deliveries: Promise<unknown>[] = []
  if (result.sendOwnerNotification && result.ownerEmail) {
    deliveries.push(mail.add({
      to: result.ownerEmail,
      message: {
        subject: `[대플폼] ${result.formTitle}에 새 응답이 도착했습니다.`,
        text: '대플폼 결과 관리 화면에서 새 응답을 확인해 주세요.',
      },
      responseId: result.responseId,
      status: 'queued',
      createdAt: FieldValue.serverTimestamp(),
    }))
  }
  if (result.sendReceipt && result.responseEmail) {
    deliveries.push(mail.add({
      to: result.responseEmail,
      message: {
        subject: `[대플폼] ${result.formTitle} 응답이 제출되었습니다.`,
        text: '응답이 정상적으로 제출되었습니다.',
      },
      responseId: result.responseId,
      status: 'queued',
      createdAt: FieldValue.serverTimestamp(),
    }))
  }
  await Promise.allSettled(deliveries)
  return { responseId: result.responseId }
})
