import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { defineSecret, defineString } from 'firebase-functions/params'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
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
import { createFormCallables, scoreQuizAnswers } from './forms'

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
const formCallables = createFormCallables(getFirestore())

export const {
  getPublicForm,
  getFormAccess,
  checkSlugAvailability,
  reserveFormSlug,
  updateFormLifecycle,
  listFormResponses,
} = formCallables

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
    const allowedGroups = Array.isArray(access.allowedGroups) ? access.allowedGroups.map((value) => stringValue(value)) : []
    const userGroups = Array.isArray(token.groups) ? token.groups.map((value) => stringValue(value)) : []
    return verified && (allowed.includes(email) || allowedGroups.some((group) => userGroups.includes(group)))
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
      || (Array.isArray(value) && value.length === 0)
    if (question.required === true && empty) throw new HttpsError('invalid-argument', `${stringValue(question.label)} 질문은 필수입니다.`)
    if (empty) continue
    if (!['string', 'number', 'boolean'].includes(typeof value)
      && !(Array.isArray(value) && value.every((entry) => typeof entry === 'string'))) {
      throw new HttpsError('invalid-argument', '지원하지 않는 답변 형식입니다.')
    }
    if (typeof value === 'string' && value.length > 20_000) throw new HttpsError('invalid-argument', '답변이 너무 깁니다.')
    if (question.inputFormat === 'email' && (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
      throw new HttpsError('invalid-argument', '이메일 형식이 올바르지 않습니다.')
    }
    if (question.inputFormat === 'phone' && (typeof value !== 'string' || !/^010-\d{4}-\d{4}$/.test(value))) {
      throw new HttpsError('invalid-argument', '전화번호는 010-0000-0000 형식으로 입력해 주세요.')
    }
    if (question.type === 'number') {
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) throw new HttpsError('invalid-argument', '숫자 답변을 확인해 주세요.')
      if (question.min !== undefined && numeric < Number(question.min)) throw new HttpsError('invalid-argument', '숫자 답변이 최솟값보다 작습니다.')
      if (question.max !== undefined && numeric > Number(question.max)) throw new HttpsError('invalid-argument', '숫자 답변이 최댓값보다 큽니다.')
    }
    const options = Array.isArray(question.options) ? question.options : []
    if (question.type === 'select' && options.length && !options.includes(value)) {
      throw new HttpsError('invalid-argument', '선택지 답변이 올바르지 않습니다.')
    }
    if (question.type === 'checkbox' && Array.isArray(value) && options.length
      && value.some((entry) => !options.includes(entry))) {
      throw new HttpsError('invalid-argument', '체크박스 답변이 올바르지 않습니다.')
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
  const quizConfigRef = formRef.collection('quiz').doc('config')
  const provider = stringValue(authContext.token.firebase?.sign_in_provider)
  const anonymous = provider === 'anonymous'
  const result = await database.runTransaction(async (transaction) => {
    const [formSnapshot, quizConfigSnapshot] = await Promise.all([
      transaction.get(formRef),
      transaction.get(quizConfigRef),
    ])
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
    const identityCollection = stringValue(access.identityCollection, 30)
    if (identityCollection === 'profile'
      && (!stringValue(payload.respondentName) || !stringValue(payload.studentId, 40))) {
      throw new HttpsError('invalid-argument', '이름과 학번을 입력해 주세요.')
    }
    if (identityCollection === 'email_input'
      && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue(payload.respondentEmail, 320))) {
      throw new HttpsError('invalid-argument', '올바른 이메일을 입력해 주세요.')
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
    const quizResult = scoreQuizAnswers(
      quizConfigSnapshot.exists ? quizConfigSnapshot.data() ?? {} : {},
      answers,
    )
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
      ...(quizResult ? { quizResult } : {}),
    })
    if (maximum > 0 && currentCount + 1 >= maximum) {
      transaction.update(formRef, {
        responseCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        'settings.schedule.status': 'closed',
      })
    } else {
      transaction.update(formRef, {
        responseCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    return {
      responseId,
      formTitle: stringValue((form.program as Record<string, unknown> | undefined)?.programName) || '대플폼',
      ownerEmail: stringValue(form.ownerEmail),
      responseEmail,
      sendOwnerNotification: settings?.notifications?.newResponseEmail === true,
      sendReceipt: settings?.submission?.emailReceipt === true,
      integrationUrls: [
        stringValue(settings?.integrations?.sheetsWebhookUrl, 1000),
        stringValue(settings?.integrations?.webhookUrl, 1000),
      ].filter(Boolean),
      integrationPayload: {
        responseId,
        formId,
        formTitle: stringValue((form.program as Record<string, unknown> | undefined)?.programName) || '대플폼',
        submittedAt: new Date().toISOString(),
        respondentEmail: responseEmail,
        respondentName: stringValue(payload.respondentName),
        studentId: stringValue(payload.studentId, 40),
        answers,
        ...(quizResult ? { quizResult: {
          score: quizResult.score,
          maxScore: quizResult.maxScore,
          percentage: quizResult.percentage,
        } } : {}),
      },
      quizResult,
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
      formId,
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
      formId,
      status: 'queued',
      createdAt: FieldValue.serverTimestamp(),
    }))
  }
  for (const targetUrl of result.integrationUrls) {
    deliveries.push(database.collection('integrationDeliveries').add({
      targetUrl,
      payload: result.integrationPayload,
      formId,
      responseId: result.responseId,
      status: 'queued',
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
    }))
  }
  await Promise.allSettled(deliveries)
  return {
    responseId: result.responseId,
    quizResult: result.quizResult
      ? result.quizResult.released
        ? result.quizResult
        : {
            score: 0,
            maxScore: result.quizResult.maxScore,
            percentage: 0,
            released: false,
          }
      : undefined,
  }
})

function safeIntegrationUrl(value: unknown) {
  try {
    const url = new URL(stringValue(value, 1000))
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1'
      || host.endsWith('.local') || /^10[.]/.test(host) || /^192[.]168[.]/.test(host)
      || /^172[.](1[6-9]|2\d|3[01])[.]/.test(host)) return null
    return url.toString()
  } catch {
    return null
  }
}

export const deliverResponseIntegration = onDocumentCreated({
  document: 'integrationDeliveries/{deliveryId}',
  region: 'asia-northeast3',
  retry: true,
  timeoutSeconds: 30,
  memory: '256MiB',
}, async (event) => {
  const snapshot = event.data
  if (!snapshot) return
  const data = snapshot.data()
  const targetUrl = safeIntegrationUrl(data.targetUrl)
  if (!targetUrl) {
    await snapshot.ref.update({ status: 'failed', error: 'invalid-target-url', updatedAt: FieldValue.serverTimestamp() })
    return
  }
  const attempts = Number(data.attempts ?? 0) + 1
  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'DaepulForm-Integration/1.0' },
      body: JSON.stringify(data.payload ?? {}),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    await snapshot.ref.update({
      status: 'sent',
      attempts,
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    await snapshot.ref.update({
      status: attempts >= 5 ? 'failed' : 'retrying',
      attempts,
      error: error instanceof Error ? error.message.slice(0, 300) : 'delivery-failed',
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (attempts < 5) throw error
  }
})

type ManagedResponse = {
  id: string
  responseId: string
  answers: Record<string, unknown>
  submittedAt: string
  updatedAt: string
  respondentUid: string
  anonymousId: string
  respondentEmail: string
  respondentName: string
  studentId: string
  status: string
  formVersion: number
  attachments: unknown[]
  quizResult?: Record<string, unknown>
}

const responseCallableOptions = {
  region: 'asia-northeast3',
  timeoutSeconds: 60,
  memory: '512MiB' as const,
  maxInstances: 20,
  enforceAppCheck: true,
}

function canManageFormData(form: Record<string, unknown>, uid: string) {
  const collaborators = form.collaborators && typeof form.collaborators === 'object'
    ? form.collaborators as Record<string, unknown>
    : {}
  return form.ownerUid === uid || collaborators[uid] === 'viewer' || collaborators[uid] === 'editor'
}

function canEditFormData(form: Record<string, unknown>, uid: string) {
  const collaborators = form.collaborators && typeof form.collaborators === 'object'
    ? form.collaborators as Record<string, unknown>
    : {}
  return form.ownerUid === uid || collaborators[uid] === 'editor'
}

function responseIso(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : stringValue(value, 80)
}

function serializeManagedResponse(
  id: string,
  formId: string,
  data: Record<string, unknown>,
): ManagedResponse & { formId: string } {
  return {
    id,
    responseId: stringValue(data.responseId) || id,
    formId,
    answers: data.answers && typeof data.answers === 'object' ? data.answers as Record<string, unknown> : {},
    submittedAt: responseIso(data.submittedAt),
    updatedAt: responseIso(data.updatedAt),
    respondentUid: stringValue(data.respondentUid),
    anonymousId: stringValue(data.anonymousId),
    respondentEmail: stringValue(data.respondentEmail),
    respondentName: stringValue(data.respondentName),
    studentId: stringValue(data.studentId, 40),
    status: stringValue(data.status, 20) || 'submitted',
    formVersion: Number(data.formVersion ?? 1),
    attachments: Array.isArray(data.attachments) ? data.attachments : [],
    ...(data.quizResult && typeof data.quizResult === 'object' ? { quizResult: data.quizResult as Record<string, unknown> } : {}),
  }
}

function searchableResponseText(response: ManagedResponse) {
  return [
    response.respondentName,
    response.studentId,
    response.respondentEmail,
    ...Object.values(response.answers).map((value) => String(value ?? '')),
  ].join(' ').toLocaleLowerCase('ko')
}

function summarizeResponses(
  questions: Array<Record<string, unknown>>,
  responses: ManagedResponse[],
) {
  return questions.map((question) => {
    const questionId = Number(question.id)
    const values = responses
      .map((response) => response.answers[String(questionId)])
      .filter((value) => value !== undefined && value !== '')
    const type = stringValue(question.type, 30)
    const summary: Record<string, unknown> = {
      questionId,
      label: stringValue(question.label),
      type,
      responseCount: values.length,
    }
    if (type === 'rating' || type === 'number') {
      const numeric = values.map(Number).filter(Number.isFinite)
      summary.average = numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : 0
    }
    if (['select', 'checkbox', 'consent', 'rating'].includes(type)) {
      const counts = new Map<string, number>()
      values.flatMap((value) => Array.isArray(value) ? value : [value]).forEach((value) => {
        const label = value === true ? '동의' : value === false ? '미동의' : String(value)
        counts.set(label, (counts.get(label) ?? 0) + 1)
      })
      summary.distribution = [...counts.entries()].map(([label, count]) => ({ label, count }))
    } else {
      summary.texts = values.map(String).slice(0, 100)
    }
    return summary
  })
}

export const queryFormResponses = onCall(responseCallableOptions, async (request) => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', '제작자 로그인이 필요합니다.')
  }
  const formId = stringValue(request.data?.formId, 120)
  const database = getFirestore()
  const formSnapshot = await database.doc(`forms/${formId}`).get()
  if (!formSnapshot.exists) throw new HttpsError('not-found', '폼을 찾을 수 없습니다.')
  const form = formSnapshot.data() ?? {}
  if (!canManageFormData(form, request.auth.uid)) throw new HttpsError('permission-denied', '결과 조회 권한이 없습니다.')

  const queryValue = request.data?.query && typeof request.data.query === 'object'
    ? request.data.query as Record<string, unknown>
    : {}
  const filters = queryValue.filters && typeof queryValue.filters === 'object'
    ? queryValue.filters as Record<string, unknown>
    : {}
  const responseSnapshot = await formSnapshot.ref.collection('responses').limit(10_000).get()
  const allRows = responseSnapshot.docs.map((item) => serializeManagedResponse(item.id, formId, item.data()))
  const search = stringValue(filters.query, 200).trim().toLocaleLowerCase('ko')
  const selectedIds = Array.isArray(filters.selectedIds) ? filters.selectedIds.map(String).slice(0, 500) : []
  const status = stringValue(filters.status, 20) || 'all'
  const questionId = filters.questionId === undefined ? undefined : Number(filters.questionId)
  const expectedAnswer = filters.answer === undefined ? undefined : String(filters.answer)
  const missingQuestionId = filters.missingQuestionId === undefined ? undefined : Number(filters.missingQuestionId)
  const ratingMin = filters.ratingMin === undefined ? undefined : Number(filters.ratingMin)
  const ratingMax = filters.ratingMax === undefined ? undefined : Number(filters.ratingMax)
  const filtered = allRows.filter((response) => {
    if (selectedIds.length && !selectedIds.includes(response.id)) return false
    if (status !== 'all' && response.status !== status) return false
    if (search && !searchableResponseText(response).includes(search)) return false
    if (questionId !== undefined && expectedAnswer !== undefined
      && String(response.answers[String(questionId)] ?? '') !== expectedAnswer) return false
    if (missingQuestionId !== undefined) {
      const value = response.answers[String(missingQuestionId)]
      if (value !== undefined && value !== '') return false
    }
    if (ratingMin !== undefined || ratingMax !== undefined) {
      const value = Number(response.answers[String(questionId)])
      if (!Number.isFinite(value)) return false
      if (ratingMin !== undefined && value < ratingMin) return false
      if (ratingMax !== undefined && value > ratingMax) return false
    }
    return true
  })
  const sortBy = stringValue(queryValue.sortBy, 30) || 'submittedAt'
  const direction = queryValue.sortDirection === 'asc' ? 1 : -1
  filtered.sort((left, right) => {
    const leftValue = sortBy === 'name' ? left.respondentName
      : sortBy === 'studentId' ? left.studentId
        : sortBy === 'answer' ? String(left.answers[String(questionId)] ?? '')
          : left.submittedAt
    const rightValue = sortBy === 'name' ? right.respondentName
      : sortBy === 'studentId' ? right.studentId
        : sortBy === 'answer' ? String(right.answers[String(questionId)] ?? '')
          : right.submittedAt
    return leftValue.localeCompare(rightValue, 'ko', { numeric: true }) * direction
  })
  const exportAll = request.data?.exportAll === true
  const pageSize = exportAll ? 10_000 : Math.min(200, Math.max(25, Number(queryValue.pageSize ?? 25)))
  const page = exportAll ? 1 : Math.max(1, Number(queryValue.page ?? 1))
  const start = (page - 1) * pageSize
  const dailyMap = new Map<string, number>()
  filtered.forEach((response) => {
    const date = response.submittedAt.slice(0, 10) || '날짜 없음'
    dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1)
  })
  const questions = Array.isArray(form.questions) ? form.questions as Array<Record<string, unknown>> : []
  return {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    overallTotal: Number(form.responseCount ?? allRows.length),
    page,
    pageSize,
    hasMore: start + pageSize < filtered.length,
    summaries: summarizeResponses(questions, filtered),
    dailyCounts: [...dailyMap.entries()].sort(([left], [right]) => left.localeCompare(right))
      .slice(-30).map(([date, count]) => ({ date, count })),
    truncated: responseSnapshot.size >= 10_000,
  }
})

export const manageFormResponses = onCall(responseCallableOptions, async (request) => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', '제작자 로그인이 필요합니다.')
  }
  const formId = stringValue(request.data?.formId, 120)
  const responseIds: string[] = Array.isArray(request.data?.responseIds)
    ? request.data.responseIds.map((value: unknown) => stringValue(value, 120))
      .filter((value: string): value is string => Boolean(value)).slice(0, 200)
    : []
  const action = stringValue(request.data?.action, 20)
  if (!responseIds.length || !['delete', 'reviewed', 'archived', 'submitted'].includes(action)) {
    throw new HttpsError('invalid-argument', '응답과 작업을 확인해 주세요.')
  }
  const database = getFirestore()
  const formRef = database.doc(`forms/${formId}`)
  const formSnapshot = await formRef.get()
  if (!formSnapshot.exists || !canEditFormData(formSnapshot.data() ?? {}, request.auth.uid)) {
    throw new HttpsError('permission-denied', '응답을 변경할 권한이 없습니다.')
  }
  const responseRefs = responseIds.map((id) => formRef.collection('responses').doc(id))
  const existingResponses = (await database.getAll(...responseRefs)).filter((snapshot) => snapshot.exists)
  if (!existingResponses.length) throw new HttpsError('not-found', '변경할 응답을 찾을 수 없습니다.')
  const batch = database.batch()
  existingResponses.forEach((snapshot) => {
    const responseRef = snapshot.ref
    if (action === 'delete') batch.delete(responseRef)
    else batch.update(responseRef, { status: action, updatedAt: FieldValue.serverTimestamp() })
  })
  if (action === 'delete') {
    batch.update(formRef, {
      responseCount: FieldValue.increment(-existingResponses.length),
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
  return { changed: existingResponses.length }
})

async function findOwnResponse(formId: string, uid: string) {
  const collection = getFirestore().collection(`forms/${formId}/responses`)
  const direct = await collection.doc(uid).get()
  if (direct.exists) return direct
  const [signedIn, anonymous] = await Promise.all([
    collection.where('respondentUid', '==', uid).limit(1).get(),
    collection.where('anonymousId', '==', uid).limit(1).get(),
  ])
  return signedIn.docs[0] ?? anonymous.docs[0] ?? null
}

export const getOwnFormResponse = onCall(responseCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '응답 세션이 필요합니다.')
  const formId = stringValue(request.data?.formId, 120)
  const formSnapshot = await getFirestore().doc(`forms/${formId}`).get()
  if (!formSnapshot.exists) throw new HttpsError('not-found', '폼을 찾을 수 없습니다.')
  const settings = formSnapshot.data()?.settings as Record<string, Record<string, unknown>> | undefined
  if (settings?.submission?.showOwnResponse !== true && settings?.submission?.allowEditAfterSubmit !== true) {
    throw new HttpsError('permission-denied', '답변 확인이 허용되지 않았습니다.')
  }
  const response = await findOwnResponse(formId, request.auth.uid)
  const serialized = response ? serializeManagedResponse(response.id, formId, response.data() ?? {}) : null
  if (serialized?.quizResult) {
    const quizConfig = await getFirestore().doc(`forms/${formId}/quiz/config`).get()
    serialized.quizResult = {
      ...serialized.quizResult,
      released: quizConfig.data()?.releaseScore !== 'later',
    }
  }
  return {
    response: serialized,
  }
})

export const updateOwnFormResponse = onCall(responseCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '응답 세션이 필요합니다.')
  const formId = stringValue(request.data?.formId, 120)
  const database = getFirestore()
  const formSnapshot = await database.doc(`forms/${formId}`).get()
  if (!formSnapshot.exists) throw new HttpsError('not-found', '폼을 찾을 수 없습니다.')
  const form = formSnapshot.data() ?? {}
  const settings = form.settings as Record<string, Record<string, unknown>> | undefined
  if (settings?.submission?.allowEditAfterSubmit !== true) {
    throw new HttpsError('permission-denied', '답변 수정이 허용되지 않았습니다.')
  }
  const answers = request.data?.answers && typeof request.data.answers === 'object'
    ? request.data.answers as Record<string, unknown>
    : null
  if (!answers) throw new HttpsError('invalid-argument', '답변을 확인해 주세요.')
  validateAnswersAgainstQuestions(form.questions, answers)
  const response = await findOwnResponse(formId, request.auth.uid)
  if (!response) throw new HttpsError('not-found', '제출한 응답을 찾을 수 없습니다.')
  const quizConfigSnapshot = await database.doc(`forms/${formId}/quiz/config`).get()
  const quizResult = scoreQuizAnswers(
    quizConfigSnapshot.exists ? quizConfigSnapshot.data() ?? {} : {},
    answers,
  )
  await response.ref.update({
    answers,
    respondentName: stringValue(request.data?.respondentName),
    studentId: stringValue(request.data?.studentId, 40),
    respondentEmail: settings?.access?.identityCollection === 'verified_email'
      ? stringValue(request.auth.token.email)
      : stringValue(request.data?.respondentEmail),
    updatedAt: FieldValue.serverTimestamp(),
    ...(quizResult ? { quizResult } : {}),
  })
  return {
    responseId: response.id,
    quizResult: quizResult?.released ? quizResult : quizResult ? {
      score: 0,
      maxScore: quizResult.maxScore,
      percentage: 0,
      released: false,
    } : undefined,
  }
})

export const getPublicResultSummary = onCall(responseCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '응답 세션이 필요합니다.')
  const formId = stringValue(request.data?.formId, 120)
  const formSnapshot = await getFirestore().doc(`forms/${formId}`).get()
  if (!formSnapshot.exists || formSnapshot.data()?.published !== true) {
    throw new HttpsError('not-found', '공개 폼을 찾을 수 없습니다.')
  }
  const form = formSnapshot.data() ?? {}
  const settings = form.settings as Record<string, Record<string, unknown>> | undefined
  if (settings?.submission?.showPublicResults !== true) {
    throw new HttpsError('permission-denied', '결과 공개가 허용되지 않았습니다.')
  }
  const snapshot = await formSnapshot.ref.collection('responses').limit(10_000).get()
  const responses = snapshot.docs.map((item) => serializeManagedResponse(item.id, formId, item.data()))
  const questions = Array.isArray(form.questions) ? form.questions as Array<Record<string, unknown>> : []
  return { total: responses.length, summaries: summarizeResponses(questions, responses) }
})

export const setFormCollaborator = onCall(responseCallableOptions, async (request) => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', '제작자 로그인이 필요합니다.')
  }
  const formId = stringValue(request.data?.formId, 120)
  const email = stringValue(request.data?.email, 320).toLowerCase()
  const role = stringValue(request.data?.role, 20)
  if (!email || !['viewer', 'editor', 'remove'].includes(role)) {
    throw new HttpsError('invalid-argument', '이메일과 권한을 확인해 주세요.')
  }
  const formRef = getFirestore().doc(`forms/${formId}`)
  const formSnapshot = await formRef.get()
  if (!formSnapshot.exists || formSnapshot.data()?.ownerUid !== request.auth.uid) {
    throw new HttpsError('permission-denied', '폼 소유자만 공동 편집자를 관리할 수 있습니다.')
  }
  let collaborator
  try {
    collaborator = await getAuth().getUserByEmail(email)
  } catch {
    throw new HttpsError('not-found', '해당 이메일로 가입한 사용자를 찾을 수 없습니다.')
  }
  if (collaborator.uid === request.auth.uid) throw new HttpsError('invalid-argument', '소유자 권한은 변경할 수 없습니다.')
  await formRef.update({
    [`collaborators.${collaborator.uid}`]: role === 'remove' ? FieldValue.delete() : role,
    [`collaboratorEmails.${collaborator.uid}`]: role === 'remove' ? FieldValue.delete() : email,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { uid: collaborator.uid, email, role }
})

export const listOrganizationForms = onCall(responseCallableOptions, async (request) => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', '조직 공유 공간은 로그인한 사용자만 이용할 수 있습니다.')
  }
  const email = stringValue(request.auth.token.email, 320).toLowerCase()
  const emailDomain = email.split('@')[1] ?? ''
  if (!emailDomain || request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', '인증된 이메일 계정이 필요합니다.')
  }
  const snapshot = await getFirestore()
    .collection('forms')
    .where('settings.workspace.emailDomain', '==', emailDomain)
    .limit(100)
    .get()
  const forms = snapshot.docs
    .filter((item) => {
      const data = item.data()
      return data.deletedAt == null
        && data.settings?.workspace?.enabled === true
        && data.ownerUid !== request.auth?.uid
    })
    .map((item) => {
      const data = item.data()
      return {
        id: item.id,
        title: stringValue(data.program?.programName) || '제목 없는 폼',
        published: data.published === true,
        status: stringValue(data.settings?.schedule?.status) || 'draft',
        startsAt: stringValue(data.settings?.schedule?.startsAt),
        closesAt: stringValue(data.settings?.schedule?.closesAt),
        maxResponses: Number(data.settings?.submission?.maxResponses ?? 0),
        publicSlug: stringValue(data.settings?.publicSlug),
        responseCount: Number(data.responseCount ?? 0),
        workspaceName: stringValue(data.settings?.workspace?.name) || emailDomain,
        ownerEmail: stringValue(data.ownerEmail),
        organizationShared: true,
      }
    })
  return { forms, emailDomain }
})

export const getFormDeliveryStatus = onCall(responseCallableOptions, async (request) => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', '제작자 로그인이 필요합니다.')
  }
  const formId = stringValue(request.data?.formId, 120)
  const database = getFirestore()
  const formSnapshot = await database.doc(`forms/${formId}`).get()
  if (!formSnapshot.exists || !canManageFormData(formSnapshot.data() ?? {}, request.auth.uid)) {
    throw new HttpsError('permission-denied', '상태 조회 권한이 없습니다.')
  }
  const [mail, integrations] = await Promise.all([
    database.collection('mail').where('formId', '==', formId).limit(50).get(),
    database.collection('integrationDeliveries').where('formId', '==', formId).limit(50).get(),
  ])
  const summarize = (documents: FirebaseFirestore.QueryDocumentSnapshot[], source: 'mail' | 'integrationDeliveries') => documents.map((item) => ({
    id: item.id,
    source,
    status: stringValue(item.data().status, 30) || 'queued',
    type: stringValue(item.data().notificationType, 30) || (item.data().targetUrl ? 'integration' : 'email'),
    error: stringValue(item.data().error, 300),
    attempts: Number(item.data().attempts ?? 0),
  }))
  return { deliveries: [...summarize(mail.docs, 'mail'), ...summarize(integrations.docs, 'integrationDeliveries')] }
})

export const retryFormDelivery = onCall(responseCallableOptions, async (request) => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', '제작자 로그인이 필요합니다.')
  }
  const source = request.data?.source === 'mail' ? 'mail' : 'integrationDeliveries'
  const deliveryId = stringValue(request.data?.deliveryId, 120)
  const database = getFirestore()
  const delivery = await database.collection(source).doc(deliveryId).get()
  if (!delivery.exists) throw new HttpsError('not-found', '발송 기록을 찾을 수 없습니다.')
  const data = delivery.data() ?? {}
  const formId = stringValue(data.formId, 120)
  const form = await database.doc(`forms/${formId}`).get()
  if (!form.exists || !canEditFormData(form.data() ?? {}, request.auth.uid)) {
    throw new HttpsError('permission-denied', '재시도 권한이 없습니다.')
  }
  const { error: _error, sentAt: _sentAt, updatedAt: _updatedAt, ...retryData } = data
  void _error; void _sentAt; void _updatedAt
  await database.collection(source).add({
    ...retryData,
    status: 'queued',
    attempts: 0,
    retriedFrom: deliveryId,
    createdAt: FieldValue.serverTimestamp(),
  })
  return { queued: true }
})

export const emptyDeletedForms = onCall(responseCallableOptions, async (request) => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', '제작자 로그인이 필요합니다.')
  }
  const database = getFirestore()
  const snapshot = await database.collection('forms').where('ownerUid', '==', request.auth.uid).get()
  const deletedForms = snapshot.docs.filter((document) => Boolean(document.data().deletedAt))
  await Promise.all(deletedForms.map((document) => database.recursiveDelete(document.ref)))
  return { deleted: deletedForms.length }
})

export const processFormScheduleNotifications = onSchedule({
  region: 'asia-northeast3',
  schedule: 'every 15 minutes',
  timeZone: 'Asia/Seoul',
  timeoutSeconds: 120,
  memory: '256MiB',
}, async () => {
  const database = getFirestore()
  const now = Date.now()
  const snapshot = await database.collection('forms').where('published', '==', true).limit(500).get()
  for (const formDocument of snapshot.docs) {
    const form = formDocument.data()
    const settings = form.settings as Record<string, Record<string, unknown>> | undefined
    const notifications = settings?.notifications ?? {}
    const schedule = settings?.schedule ?? {}
    const state = form.notificationState && typeof form.notificationState === 'object'
      ? form.notificationState as Record<string, unknown>
      : {}
    const startsAt = Date.parse(stringValue(schedule.startsAt))
    const closesAt = Date.parse(stringValue(schedule.closesAt))
    const notices: Array<{ key: string; enabled: boolean; due: boolean; subject: string }> = [
      { key: 'started', enabled: notifications.startEmail === true, due: Number.isFinite(startsAt) && now >= startsAt, subject: '응답 접수가 시작되었습니다.' },
      { key: 'closingSoon', enabled: notifications.closingSoonEmail === true, due: Number.isFinite(closesAt) && now >= closesAt - 86_400_000, subject: '응답 접수가 하루 안에 마감됩니다.' },
      { key: 'closed', enabled: notifications.closedEmail === true, due: Number.isFinite(closesAt) && now >= closesAt, subject: '응답 접수가 마감되었습니다.' },
    ]
    for (const notice of notices) {
      if (!notice.enabled || !notice.due || state[notice.key]) continue
      const ownerEmail = stringValue(form.ownerEmail)
      if (!ownerEmail) continue
      await database.collection('mail').add({
        to: ownerEmail,
        message: {
          subject: `[대플폼] ${stringValue((form.program as Record<string, unknown> | undefined)?.programName) || '폼'} ${notice.subject}`,
          text: notice.subject,
        },
        formId: formDocument.id,
        notificationType: notice.key,
        status: 'queued',
        createdAt: FieldValue.serverTimestamp(),
      })
      await formDocument.ref.update({
        [`notificationState.${notice.key}`]: FieldValue.serverTimestamp(),
      })
    }
  }
})
