import { FieldValue, Timestamp, type DocumentData, type Transaction } from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'

const region = 'asia-northeast3'
const reservedSlugs = new Set(['admin', 'login', 'api', 'settings', 'forms', 'f'])
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const publicStatuses = new Set(['scheduled', 'open', 'paused', 'closed'])

type AuthContext = CallableRequest<unknown>['auth']

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function statusOf(form: DocumentData) {
  const settings = typeof form.settings === 'object' && form.settings ? form.settings as DocumentData : {}
  const settingsSchedule = typeof settings.schedule === 'object' && settings.schedule ? settings.schedule as DocumentData : {}
  const status = stringValue(form.status ?? settingsSchedule.status)
  if (['draft', 'scheduled', 'open', 'paused', 'closed', 'private'].includes(status)) return status
  return form.published === true ? 'open' : 'draft'
}

function millis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function scheduleOf(form: DocumentData) {
  const settings = typeof form.settings === 'object' && form.settings ? form.settings as DocumentData : {}
  const settingsSchedule = typeof settings.schedule === 'object' && settings.schedule ? settings.schedule as DocumentData : {}
  const settingsSubmission = typeof settings.submission === 'object' && settings.submission ? settings.submission as DocumentData : {}
  const schedule = typeof form.schedule === 'object' && form.schedule ? form.schedule as DocumentData : {}
  return {
    startAt: millis(schedule.startAt ?? settingsSchedule.startsAt ?? form.startAt),
    endAt: millis(schedule.endAt ?? settingsSchedule.closesAt ?? form.surveyEndAt),
    maxResponses: (schedule.maxResponses ?? settingsSubmission.maxResponses) === null
      || (schedule.maxResponses ?? settingsSubmission.maxResponses) === undefined
      ? null
      : Math.max(0, numberValue(schedule.maxResponses ?? settingsSubmission.maxResponses)),
    showBeforeOpen: schedule.showBeforeOpen !== false,
  }
}

function accessOf(form: DocumentData) {
  const settings = typeof form.settings === 'object' && form.settings ? form.settings as DocumentData : {}
  const settingsAccess = typeof settings.access === 'object' && settings.access ? settings.access as DocumentData : {}
  const access = typeof form.access === 'object' && form.access ? form.access as DocumentData : {}
  const participation = stringValue(settingsAccess.participation)
  const mode = stringValue(access.mode)
    || (participation === 'kangnam' ? 'university'
      : participation === 'allowlist' ? 'restricted'
        : participation || 'authenticated')
  return {
    mode,
    allowAnonymous: access.allowAnonymous === true || participation === 'anyone',
    duplicatePolicy: stringValue(access.duplicatePolicy) || (settingsAccess.allowMultiple === true ? 'allow' : 'account_once'),
    universityDomain: stringValue(access.universityDomain) || (participation === 'kangnam' ? 'kangnam.ac.kr' : ''),
    allowedEmailDomains: Array.isArray(access.allowedEmailDomains) ? access.allowedEmailDomains.map(stringValue) : [],
    allowedUids: Array.isArray(access.allowedUids) ? access.allowedUids.map(stringValue) : [],
    allowedGroups: Array.isArray(access.allowedGroups)
      ? access.allowedGroups.map(stringValue)
      : Array.isArray(settingsAccess.allowedGroups) ? settingsAccess.allowedGroups.map(stringValue) : [],
    allowedEmails: Array.isArray(settingsAccess.allowedEmails) ? settingsAccess.allowedEmails.map(stringValue) : [],
    collectVerifiedEmail: access.collectVerifiedEmail === true || settingsAccess.identityCollection === 'verified_email',
  }
}

function creatorUidOf(form: DocumentData) {
  return stringValue(form.creatorUid ?? form.ownerUid)
}

function isAnonymous(auth: AuthContext) {
  return auth?.token.firebase?.sign_in_provider === 'anonymous'
}

function tokenEmail(auth: AuthContext) {
  return stringValue(auth?.token.email).toLowerCase()
}

function tokenGroups(auth: AuthContext) {
  const groups = auth?.token.groups
  return Array.isArray(groups) ? groups.map(stringValue) : []
}

export type AccessReason =
  | 'ok'
  | 'not_found'
  | 'private'
  | 'not_started'
  | 'paused'
  | 'closed'
  | 'max_responses'
  | 'login_required'
  | 'university_account_required'
  | 'account_not_allowed'
  | 'duplicate'

export function evaluateFormAccess(form: DocumentData, auth: AuthContext, now = Date.now()) {
  const schedule = scheduleOf(form)
  let status = statusOf(form)
  if (status === 'scheduled' && (schedule.startAt === null || now >= schedule.startAt)) status = 'open'
  if (status === 'open' && schedule.endAt !== null && now >= schedule.endAt) status = 'closed'
  const access = accessOf(form)
  const responseCount = Math.max(0, numberValue(form.responseCount))
  const remainingResponses = schedule.maxResponses === null ? null : Math.max(0, schedule.maxResponses - responseCount)
  const result = (reason: AccessReason, allowed: boolean, canSubmit: boolean) => ({
    allowed,
    canSubmit,
    reason,
    status,
    responseCount,
    remainingResponses,
    remainingMs: schedule.endAt === null ? null : Math.max(0, schedule.endAt - now),
  })

  if (status === 'draft' || status === 'private') return result('private', false, false)
  if ((schedule.startAt !== null && now < schedule.startAt) || status === 'scheduled') {
    return result('not_started', schedule.showBeforeOpen, false)
  }
  if (status === 'paused') return result('paused', true, false)
  if (status === 'closed') return result('closed', true, false)
  if (remainingResponses === 0) return result('max_responses', true, false)

  const anonymous = !auth || isAnonymous(auth)
  if ((access.mode !== 'anyone' || !access.allowAnonymous) && anonymous) return result('login_required', true, false)
  if (access.mode === 'university') {
    const domain = access.universityDomain || access.allowedEmailDomains[0]
    if (!domain || !tokenEmail(auth).endsWith(`@${domain.toLowerCase()}`) || auth?.token.email_verified !== true) {
      return result('university_account_required', true, false)
    }
  }
  if (access.mode === 'restricted') {
    const uidAllowed = auth?.uid ? access.allowedUids.includes(auth.uid) : false
    const exactEmailAllowed = access.allowedEmails.includes(tokenEmail(auth))
    const emailAllowed = access.allowedEmailDomains.some((domain) => tokenEmail(auth).endsWith(`@${domain.toLowerCase()}`))
    const groupAllowed = tokenGroups(auth).some((group) => access.allowedGroups.includes(group))
    if (!uidAllowed && !exactEmailAllowed && !emailAllowed && !groupAllowed) return result('account_not_allowed', true, false)
  }
  return result('ok', true, true)
}

function publicFormPayload(formId: string, form: DocumentData) {
  return {
    formId,
    title: form.title ?? form.program?.programName ?? '',
    description: form.description ?? form.program?.description ?? '',
    program: form.program ?? null,
    formType: form.formType ?? 'general',
    sections: form.sections ?? [],
    questions: form.questions ?? [],
    branchRules: form.branchRules ?? [],
    access: accessOf(form),
    schedule: form.schedule ?? {
      startAt: form.settings?.schedule?.startsAt ?? form.startAt ?? null,
      endAt: form.settings?.schedule?.closesAt ?? form.surveyEndAt ?? null,
      maxResponses: form.settings?.submission?.maxResponses ?? null,
      closedMessage: '응답 접수가 마감되었습니다.',
    },
    theme: form.theme ?? 'green',
    status: statusOf(form),
    version: numberValue(form.version, 1),
    responseCount: numberValue(form.responseCount),
  }
}

function formIdFromData(data: unknown) {
  const value = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
  const formId = stringValue(value.formId)
  if (!formId) throw new HttpsError('invalid-argument', 'formId가 필요합니다.')
  return { formId, value }
}

export function validateSubmittedAnswers(form: DocumentData, answers: unknown[]) {
  const questions = Array.isArray(form.questions) ? form.questions as DocumentData[] : []
  const answerMap = new Map(answers.map((answer) => [
    stringValue((answer as DocumentData).questionId),
    (answer as DocumentData).value,
  ]))
  for (const question of questions) {
    const id = stringValue(question.id)
    const value = answerMap.get(id)
    const missing = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
    if (question.required === true && missing) return { valid: false, questionId: id, reason: 'required' }
    if (missing) continue
    const validation = typeof question.validation === 'object' && question.validation ? question.validation as DocumentData : {}
    const type = stringValue(question.type)
    if ((type === 'email' || validation.format === 'email') && (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
      return { valid: false, questionId: id, reason: 'email' }
    }
    if ((type === 'phone' || validation.format === 'phone') && (typeof value !== 'string' || !/^[0-9+\-()\s]{8,20}$/.test(value))) {
      return { valid: false, questionId: id, reason: 'phone' }
    }
    if (type === 'student_id' || validation.format === 'student_id') {
      const expectedLength = numberValue(validation.studentIdLength)
      if (typeof value !== 'string' || !/^\d+$/.test(value) || (expectedLength > 0 && value.length !== expectedLength)) {
        return { valid: false, questionId: id, reason: 'student_id' }
      }
    }
    if (typeof value === 'number') {
      if (validation.integerOnly === true && !Number.isInteger(value)) return { valid: false, questionId: id, reason: 'integer' }
      if (typeof validation.min === 'number' && value < validation.min) return { valid: false, questionId: id, reason: 'min' }
      if (typeof validation.max === 'number' && value > validation.max) return { valid: false, questionId: id, reason: 'max' }
    }
    if (typeof value === 'string') {
      if (typeof validation.minLength === 'number' && value.length < validation.minLength) return { valid: false, questionId: id, reason: 'min_length' }
      if (typeof validation.maxLength === 'number' && value.length > validation.maxLength) return { valid: false, questionId: id, reason: 'max_length' }
      if (typeof validation.pattern === 'string') {
        try {
          if (!new RegExp(validation.pattern).test(value)) return { valid: false, questionId: id, reason: 'pattern' }
        } catch {
          return { valid: false, questionId: id, reason: 'invalid_pattern' }
        }
      }
    }
    if (Array.isArray(value)) {
      if (typeof validation.minSelections === 'number' && value.length < validation.minSelections) return { valid: false, questionId: id, reason: 'min_selections' }
      if (typeof validation.maxSelections === 'number' && value.length > validation.maxSelections) return { valid: false, questionId: id, reason: 'max_selections' }
      if (typeof validation.exactSelections === 'number' && value.length !== validation.exactSelections) return { valid: false, questionId: id, reason: 'exact_selections' }
    }
  }
  return { valid: true as const }
}

export function createFormCallables(db: FirebaseFirestore.Firestore) {
  const getPublicForm = onCall({ region, enforceAppCheck: true }, async (request) => {
    const data = typeof request.data === 'object' && request.data ? request.data as Record<string, unknown> : {}
    let formId = stringValue(data.formId)
    if (!formId) {
      const userId = stringValue(data.userId)
      const slug = stringValue(data.slug)
      if (!userId || !slug) throw new HttpsError('invalid-argument', 'formId 또는 userId/slug가 필요합니다.')
      const slugSnapshot = await db.doc(`formSlugs/${userId}_${slug}`).get()
      formId = stringValue(slugSnapshot.data()?.formId)
    }
    if (!formId) throw new HttpsError('not-found', '폼을 찾을 수 없습니다.')
    const snapshot = await db.doc(`forms/${formId}`).get()
    if (!snapshot.exists) throw new HttpsError('not-found', '폼을 찾을 수 없습니다.')
    const form = snapshot.data() ?? {}
    const decision = evaluateFormAccess(form, request.auth)
    if (!decision.allowed || !publicStatuses.has(statusOf(form))) throw new HttpsError('permission-denied', decision.reason)
    const payload = publicFormPayload(snapshot.id, form)
    if (decision.reason === 'login_required' || decision.reason === 'university_account_required' || decision.reason === 'account_not_allowed') {
      payload.questions = []
      payload.sections = []
      payload.branchRules = []
    }
    return { form: payload, access: decision }
  })

  const getFormAccess = onCall({ region, enforceAppCheck: true }, async (request) => {
    const { formId } = formIdFromData(request.data)
    const snapshot = await db.doc(`forms/${formId}`).get()
    if (!snapshot.exists) return { allowed: false, canSubmit: false, reason: 'not_found' as const }
    return evaluateFormAccess(snapshot.data() ?? {}, request.auth)
  })

  const checkSlugAvailability = onCall({ region, enforceAppCheck: true }, async (request) => {
    if (!request.auth || isAnonymous(request.auth)) throw new HttpsError('unauthenticated', '제작자 로그인이 필요합니다.')
    const data = typeof request.data === 'object' && request.data ? request.data as Record<string, unknown> : {}
    const slug = stringValue(data.slug)
    if (!slugPattern.test(slug) || reservedSlugs.has(slug) || slug.length < 3 || slug.length > 60) {
      return { available: false, reason: 'invalid' }
    }
    const snapshot = await db.doc(`formSlugs/${request.auth.uid}_${slug}`).get()
    const currentFormId = stringValue(data.formId)
    return { available: !snapshot.exists || snapshot.data()?.formId === currentFormId, reason: snapshot.exists ? 'taken' : 'available' }
  })

  const reserveFormSlug = onCall({ region, enforceAppCheck: true }, async (request) => {
    if (!request.auth || isAnonymous(request.auth)) throw new HttpsError('unauthenticated', '제작자 로그인이 필요합니다.')
    const { formId, value } = formIdFromData(request.data)
    const slug = stringValue(value.slug)
    if (!slugPattern.test(slug) || reservedSlugs.has(slug) || slug.length < 3 || slug.length > 60) {
      throw new HttpsError('invalid-argument', 'invalid_slug')
    }
    const formRef = db.doc(`forms/${formId}`)
    const slugRef = db.doc(`formSlugs/${request.auth.uid}_${slug}`)
    await db.runTransaction(async (transaction: Transaction) => {
      const [formSnapshot, slugSnapshot] = await Promise.all([transaction.get(formRef), transaction.get(slugRef)])
      if (!formSnapshot.exists || creatorUidOf(formSnapshot.data() ?? {}) !== request.auth?.uid) {
        throw new HttpsError('permission-denied', '폼 소유자만 주소를 변경할 수 있습니다.')
      }
      if (slugSnapshot.exists && slugSnapshot.data()?.formId !== formId) throw new HttpsError('already-exists', 'slug_taken')
      transaction.set(slugRef, { creatorUid: request.auth?.uid, formId, slug, updatedAt: FieldValue.serverTimestamp() })
      transaction.update(formRef, { slug, 'settings.publicSlug': slug, updatedAt: FieldValue.serverTimestamp() })
    })
    return { slug }
  })

  const updateFormLifecycle = onCall({ region, enforceAppCheck: true }, async (request) => {
    if (!request.auth || isAnonymous(request.auth)) throw new HttpsError('unauthenticated', '제작자 로그인이 필요합니다.')
    const { formId, value } = formIdFromData(request.data)
    const status = stringValue(value.status)
    if (!['draft', 'scheduled', 'open', 'paused', 'closed', 'private'].includes(status)) {
      throw new HttpsError('invalid-argument', 'invalid_status')
    }
    const formRef = db.doc(`forms/${formId}`)
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(formRef)
      if (!snapshot.exists || creatorUidOf(snapshot.data() ?? {}) !== request.auth?.uid) {
        throw new HttpsError('permission-denied', '폼 소유자만 상태를 변경할 수 있습니다.')
      }
      transaction.update(formRef, {
        status,
        'settings.schedule.status': status,
        published: status !== 'private',
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
    return { status }
  })

  const listFormResponses = onCall({ region, enforceAppCheck: true }, async (request) => {
    if (!request.auth || isAnonymous(request.auth)) throw new HttpsError('unauthenticated', '제작자 로그인이 필요합니다.')
    const { formId, value } = formIdFromData(request.data)
    const formSnapshot = await db.doc(`forms/${formId}`).get()
    if (!formSnapshot.exists || creatorUidOf(formSnapshot.data() ?? {}) !== request.auth.uid) {
      throw new HttpsError('permission-denied', '결과 조회 권한이 없습니다.')
    }
    const pageSize = Math.min(100, Math.max(1, numberValue(value.pageSize, 50)))
    let query = db.collection(`forms/${formId}/responses`).orderBy('submittedAt', 'desc').limit(pageSize)
    const cursor = stringValue(value.cursor)
    if (cursor) {
      const cursorSnapshot = await db.doc(`forms/${formId}/responses/${cursor}`).get()
      if (cursorSnapshot.exists) query = query.startAfter(cursorSnapshot)
    }
    const snapshot = await query.get()
    return {
      items: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
      nextCursor: snapshot.size === pageSize ? snapshot.docs.at(-1)?.id ?? null : null,
    }
  })

  return {
    getPublicForm,
    getFormAccess,
    checkSlugAvailability,
    reserveFormSlug,
    updateFormLifecycle,
    listFormResponses,
  }
}
