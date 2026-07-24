import type {
  BranchRule,
  Form,
  FormAccess,
  FormAccessDecision,
  FormSchedule,
  FormStatus,
  Question,
} from '../types'

export const defaultFormAccess: FormAccess = {
  mode: 'anyone',
  allowAnonymous: true,
  collectVerifiedEmail: false,
  allowedEmailDomains: [],
  allowedUids: [],
  allowedGroups: [],
  duplicatePolicy: 'browser_once',
}

export const defaultFormSchedule: FormSchedule = {
  startAt: null,
  endAt: null,
  maxResponses: null,
  closedMessage: '응답 접수가 마감되었습니다.',
  showBeforeOpen: true,
  resultsPublic: false,
}

export const reservedSlugs = new Set(['admin', 'login', 'api', 'settings', 'forms', 'f'])
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function normalizeStatus(value: unknown, published?: unknown): FormStatus {
  if (['draft', 'scheduled', 'open', 'paused', 'closed', 'private'].includes(String(value))) return value as FormStatus
  return published === true ? 'open' : 'draft'
}

export function normalizeLegacyForm(formId: string, value: Record<string, unknown>): Form {
  const program = (value.program ?? {}) as Record<string, unknown>
  const legacyQuestions = Array.isArray(value.questions) ? value.questions as Array<Record<string, unknown>> : []
  const sectionId = 'section-main'
  const questions: Question[] = legacyQuestions.map((question, index) => ({
    id: String(question.id ?? `question-${index + 1}`),
    sectionId,
    type: String(question.type ?? 'short_text') as Question['type'],
    title: String(question.label ?? question.title ?? ''),
    required: question.required === true,
    options: Array.isArray(question.options)
      ? question.options.map((option, optionIndex) => ({
          id: `${String(question.id ?? index)}-option-${optionIndex + 1}`,
          label: typeof option === 'string' ? option : String((option as Record<string, unknown>).label ?? ''),
        }))
      : undefined,
  }))

  return {
    formId,
    creatorUid: String(value.creatorUid ?? value.ownerUid ?? ''),
    title: String(value.title ?? program.programName ?? ''),
    description: String(value.description ?? program.description ?? ''),
    formType: (value.formType ?? 'general') as Form['formType'],
    status: normalizeStatus(value.status, value.published),
    sections: [{ id: sectionId, title: '', questionIds: questions.map(({ id }) => id) }],
    questions,
    branchRules: Array.isArray(value.branchRules) ? value.branchRules as BranchRule[] : [],
    access: { ...defaultFormAccess, ...((value.access ?? {}) as Partial<FormAccess>) },
    schedule: { ...defaultFormSchedule, ...((value.schedule ?? {}) as Partial<FormSchedule>) },
    theme: typeof value.theme === 'string' ? { id: value.theme } : (value.theme as Form['theme'] ?? { id: 'green' }),
    slug: typeof value.slug === 'string' ? value.slug : null,
    randomId: String(value.randomId ?? formId),
    responseCount: Number(value.responseCount ?? 0),
    version: Number(value.version ?? 1),
  }
}

export function validateSlug(slug: string) {
  if (!slugPattern.test(slug)) return '영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.'
  if (reservedSlugs.has(slug)) return '예약된 주소는 사용할 수 없습니다.'
  if (slug.length < 3 || slug.length > 60) return '주소는 3자 이상 60자 이하로 입력해 주세요.'
  return null
}

export function validateBranchRules(form: Pick<Form, 'sections' | 'questions' | 'branchRules'>) {
  const warnings: string[] = []
  const sectionIds = new Set(form.sections.map(({ id }) => id))
  const questionIds = new Set(form.questions.map(({ id }) => id))
  const edges = new Map<string, string[]>()

  form.branchRules.forEach((rule) => {
    if (!questionIds.has(rule.questionId)) warnings.push(`분기 ${rule.id}의 시작 질문이 없습니다.`)
    if (rule.destination.type === 'section') {
      if (!sectionIds.has(rule.destination.sectionId)) warnings.push(`분기 ${rule.id}의 이동 섹션이 없습니다.`)
      const sourceSection = form.questions.find(({ id }) => id === rule.questionId)?.sectionId
      if (sourceSection) edges.set(sourceSection, [...(edges.get(sourceSection) ?? []), rule.destination.sectionId])
    }
  })

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (sectionId: string): boolean => {
    if (visiting.has(sectionId)) return true
    if (visited.has(sectionId)) return false
    visiting.add(sectionId)
    const cyclic = (edges.get(sectionId) ?? []).some(visit)
    visiting.delete(sectionId)
    visited.add(sectionId)
    return cyclic
  }
  if (form.sections.some(({ id }) => visit(id))) warnings.push('순환하는 분기가 있어 응답자가 폼을 끝낼 수 없습니다.')
  return warnings
}

export function accessDecision(
  form: Pick<Form, 'status' | 'schedule' | 'access' | 'responseCount'>,
  respondent: { uid?: string; email?: string; isAnonymous?: boolean; alreadySubmitted?: boolean },
  now = Date.now(),
): FormAccessDecision {
  const start = form.schedule.startAt ? Date.parse(form.schedule.startAt) : null
  const end = form.schedule.endAt ? Date.parse(form.schedule.endAt) : null
  let status = form.status
  if (status === 'scheduled' && (start === null || now >= start)) status = 'open'
  if (status === 'open' && end !== null && now >= end) status = 'closed'
  const remainingResponses = form.schedule.maxResponses === null
    ? null
    : Math.max(0, form.schedule.maxResponses - form.responseCount)
  const base = {
    status,
    responseCount: form.responseCount,
    remainingResponses,
    remainingMs: end === null ? null : Math.max(0, end - now),
  }
  const blocked = (reason: FormAccessDecision['reason'], allowed = true): FormAccessDecision => ({
    ...base, allowed, canSubmit: false, reason,
  })

  if (status === 'draft' || status === 'private') return blocked('private', false)
  if (start !== null && now < start) return blocked('not_started', form.schedule.showBeforeOpen)
  if (status === 'scheduled') return blocked('not_started', form.schedule.showBeforeOpen)
  if (status === 'paused') return blocked('paused')
  if (status === 'closed') return blocked('closed')
  if (remainingResponses === 0) return blocked('max_responses')
  if (form.access.mode !== 'anyone' && (!respondent.uid || respondent.isAnonymous)) return blocked('login_required')
  if (form.access.mode === 'university') {
    const domain = form.access.universityDomain ?? form.access.allowedEmailDomains[0]
    if (!domain || !respondent.email?.toLowerCase().endsWith(`@${domain.toLowerCase()}`)) {
      return blocked('university_account_required')
    }
  }
  if (form.access.mode === 'restricted' && respondent.uid && !form.access.allowedUids.includes(respondent.uid)) {
    return blocked('account_not_allowed')
  }
  if (respondent.alreadySubmitted && form.access.duplicatePolicy !== 'allow') return blocked('duplicate')
  return { ...base, allowed: true, canSubmit: true, reason: 'ok' }
}
