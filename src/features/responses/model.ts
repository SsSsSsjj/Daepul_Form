import {
  defaultFormSettings,
  type FormQuestion,
  type FormSettings,
  type GeneratedForm,
  type KeywordInsight,
  type ResponseFilters,
  type ResponsePage,
  type ResponseQuery,
  type StoredFormResponse,
} from '../../types'

export function settingsFromAiSuggestion(suggestion: GeneratedForm['suggestedSettings']): FormSettings {
  const publicSlug = suggestion.publicSlug.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const startsAt = suggestion.startsAt && !Number.isNaN(Date.parse(suggestion.startsAt)) ? new Date(suggestion.startsAt).toISOString() : undefined
  const closesAt = suggestion.closesAt && !Number.isNaN(Date.parse(suggestion.closesAt)) ? new Date(suggestion.closesAt).toISOString() : undefined
  return normalizeFormSettings({
    ...defaultFormSettings,
    publicSlug,
    access: {
      ...defaultFormSettings.access,
      participation: suggestion.participation,
      identityCollection: suggestion.identityCollection,
      allowMultiple: suggestion.allowMultiple,
    },
    schedule: { status: suggestion.status, startsAt, closesAt },
    submission: {
      ...defaultFormSettings.submission,
      allowDrafts: suggestion.allowDrafts,
      allowEditAfterSubmit: suggestion.allowEditAfterSubmit,
      emailReceipt: suggestion.emailReceipt && suggestion.identityCollection !== 'anonymous',
      showOwnResponse: suggestion.showOwnResponse,
      showPublicResults: suggestion.showPublicResults,
      randomizeQuestions: suggestion.randomizeQuestions,
      submitLabel: suggestion.submitLabel.trim() || defaultFormSettings.submission.submitLabel,
      completionMessage: suggestion.completionMessage.trim() || defaultFormSettings.submission.completionMessage,
      maxResponses: suggestion.maxResponses > 0 ? suggestion.maxResponses : undefined,
    },
    branding: {
      ...defaultFormSettings.branding,
      icon: suggestion.icon,
      shareTitle: suggestion.shareTitle.trim(),
      shareDescription: suggestion.shareDescription.trim(),
    },
    notifications: {
      ...defaultFormSettings.notifications,
      newResponseEmail: suggestion.newResponseEmail,
    },
  })
}

export type PublicFormAvailability =
  | { state: 'open'; message: string }
  | { state: 'scheduled' | 'paused' | 'closed' | 'private' | 'full' | 'not-found'; message: string }

export function normalizeFormSettings(value?: Partial<FormSettings>): FormSettings {
  return {
    ...defaultFormSettings,
    ...value,
    access: { ...defaultFormSettings.access, ...value?.access },
    submission: { ...defaultFormSettings.submission, ...value?.submission },
    schedule: { ...defaultFormSettings.schedule, ...value?.schedule },
    branding: { ...defaultFormSettings.branding, ...value?.branding },
    notifications: { ...defaultFormSettings.notifications, ...value?.notifications },
    integrations: { ...defaultFormSettings.integrations, ...value?.integrations },
    quiz: { ...defaultFormSettings.quiz, ...value?.quiz },
    workspace: { ...defaultFormSettings.workspace, ...value?.workspace },
    version: Number(value?.version) || 1,
  }
}

const keywordStopWords = new Set([
  '그리고', '그러나', '하지만', '대한', '위한', '있는', '없는', '있습니다', '없습니다', '입니다',
  '합니다', '했습니다', '좋아요', '좋습니다', '정말', '매우', '조금', '너무', 'the', 'and', 'for',
  'that', 'this', 'with', 'from', 'have', 'was', 'were',
])

export function extractKeywordInsights(
  responses: StoredFormResponse[],
  questions: FormQuestion[],
  limit = 12,
): KeywordInsight[] {
  const textQuestionIds = new Set(
    questions.filter(({ type }) => type === 'short_text' || type === 'long_text').map(({ id }) => String(id)),
  )
  const counts = new Map<string, { count: number; responses: Set<string> }>()
  responses.forEach((response) => {
    const responseKeywords = new Set<string>()
    Object.entries(response.answers).forEach(([questionId, value]) => {
      if (!textQuestionIds.has(questionId) || typeof value !== 'string') return
      const tokens = value.toLocaleLowerCase('ko')
        .match(/[가-힣]{2,}|[a-z][a-z0-9-]{2,}/g) ?? []
      tokens.forEach((token) => {
        if (keywordStopWords.has(token)) return
        const entry = counts.get(token) ?? { count: 0, responses: new Set<string>() }
        entry.count += 1
        entry.responses.add(response.id)
        counts.set(token, entry)
        responseKeywords.add(token)
      })
    })
    void responseKeywords
  })
  return [...counts.entries()]
    .map(([keyword, value]) => ({ keyword, count: value.count, responseCount: value.responses.size }))
    .filter(({ responseCount }) => responseCount >= 2)
    .sort((left, right) => right.responseCount - left.responseCount || right.count - left.count || left.keyword.localeCompare(right.keyword, 'ko'))
    .slice(0, Math.max(1, limit))
}

export function getFormAvailability(
  settings: FormSettings,
  responseCount = 0,
  now = new Date(),
): PublicFormAvailability {
  const { status, startsAt, closesAt } = settings.schedule
  if (status === 'private') return { state: 'private', message: '비공개 폼입니다.' }
  if (status === 'paused') return { state: 'paused', message: '제작자가 응답 접수를 잠시 중지했습니다.' }
  if (status === 'closed') return { state: 'closed', message: '응답 접수가 마감되었습니다.' }
  if (startsAt && now < new Date(startsAt)) return { state: 'scheduled', message: '아직 응답 접수가 시작되지 않았습니다.' }
  if (closesAt && now > new Date(closesAt)) return { state: 'closed', message: '응답 접수가 마감되었습니다.' }
  if (settings.submission.maxResponses && responseCount >= settings.submission.maxResponses) {
    return { state: 'full', message: '최대 참여 인원에 도달해 접수가 마감되었습니다.' }
  }
  return { state: 'open', message: '응답 접수 중' }
}

export function validateAnswer(question: FormQuestion, value: unknown) {
  const empty = value === undefined || value === null || value === '' || value === false
    || (Array.isArray(value) && value.length === 0)
  if (question.required && empty) return '필수 질문입니다.'
  if (empty) return ''
  const text = String(value)
  if (question.min !== undefined && question.type === 'number' && Number(value) < question.min) {
    return `${question.min} 이상이어야 합니다.`
  }
  if (question.max !== undefined && question.type === 'number' && Number(value) > question.max) {
    return `${question.max} 이하여야 합니다.`
  }
  if (question.pattern) {
    try {
      if (!new RegExp(question.pattern).test(text)) return '입력 형식이 올바르지 않습니다.'
    } catch {
      return ''
    }
  }
  return ''
}

export function validateAnswers(questions: FormQuestion[], answers: Record<string, unknown>) {
  return Object.fromEntries(
    questions
      .map((question) => [String(question.id), validateAnswer(question, answers[String(question.id)])] as const)
      .filter(([, error]) => error),
  )
}

function responseText(response: StoredFormResponse) {
  return [
    response.respondentName,
    response.studentId,
    response.respondentEmail,
    ...Object.values(response.answers),
  ].filter(Boolean).join(' ').toLocaleLowerCase('ko')
}

export function filterResponses(items: StoredFormResponse[], filters: ResponseFilters) {
  const query = filters.query.trim().toLocaleLowerCase('ko')
  return items.filter((response) => {
    if (filters.selectedIds.length && !filters.selectedIds.includes(response.id)) return false
    if (filters.status !== 'all' && (response.status ?? 'submitted') !== filters.status) return false
    if (query && !responseText(response).includes(query)) return false
    if (filters.questionId !== undefined && filters.answer !== undefined) {
      if (String(response.answers[String(filters.questionId)] ?? '') !== filters.answer) return false
    }
    if (filters.ratingMin !== undefined || filters.ratingMax !== undefined) {
      const value = Number(response.answers[String(filters.questionId)])
      if (!Number.isFinite(value)) return false
      if (filters.ratingMin !== undefined && value < filters.ratingMin) return false
      if (filters.ratingMax !== undefined && value > filters.ratingMax) return false
    }
    if (filters.missingQuestionId !== undefined) {
      const value = response.answers[String(filters.missingQuestionId)]
      if (value !== undefined && value !== '') return false
    }
    return true
  })
}

export function queryResponses(items: StoredFormResponse[], query: ResponseQuery): ResponsePage {
  const filtered = filterResponses(items, query.filters)
  const sorted = [...filtered].sort((left, right) => {
    let a = ''
    let b = ''
    if (query.sortBy === 'submittedAt') {
      a = left.submittedAt ?? ''
      b = right.submittedAt ?? ''
    } else if (query.sortBy === 'name') {
      a = left.respondentName ?? ''
      b = right.respondentName ?? ''
    } else if (query.sortBy === 'studentId') {
      a = left.studentId ?? ''
      b = right.studentId ?? ''
    } else {
      a = String(left.answers[String(query.filters.questionId)] ?? '')
      b = String(right.answers[String(query.filters.questionId)] ?? '')
    }
    const comparison = a.localeCompare(b, 'ko', { numeric: true })
    return query.sortDirection === 'asc' ? comparison : -comparison
  })
  const start = Math.max(0, (query.page - 1) * query.pageSize)
  return {
    items: sorted.slice(start, start + query.pageSize),
    total: sorted.length,
    page: query.page,
    pageSize: query.pageSize,
    hasMore: start + query.pageSize < sorted.length,
  }
}

function csvCell(value: unknown) {
  const raw = value === true ? '동의' : value === false ? '미동의' : String(value ?? '')
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw
  return `"${text.replace(/"/g, '""')}"`
}

export function responsesToCsv(questions: FormQuestion[], responses: StoredFormResponse[]) {
  const header = ['제출시간', '이름', '학번', '이메일', ...questions.map((question) => question.label)]
  const rows = responses.map((response) => [
    response.submittedAt ?? '',
    response.respondentName ?? '',
    response.studentId ?? '',
    response.respondentEmail ?? '',
    ...questions.map((question) => response.answers[String(question.id)]),
  ])
  return '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export function downloadTextFile(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function createSampleResponses(questions: FormQuestion[], count = 10): StoredFormResponse[] {
  const names = ['김민준', '이서연', '박지훈', '최유진', '정하늘', '윤서준', '한지민', '오시우', '강예린', '임도윤']
  return Array.from({ length: count }, (_, index) => ({
    id: `sample-${index + 1}`,
    responseId: `sample-${index + 1}`,
    submittedAt: new Date(Date.now() - index * 86_400_000).toISOString(),
    respondentName: names[index % names.length],
    studentId: `2026${String(index + 1).padStart(4, '0')}`,
    respondentEmail: `sample${index + 1}@kangnam.ac.kr`,
    status: 'submitted',
    answers: Object.fromEntries(questions.map((question) => {
      if (question.type === 'rating') return [String(question.id), (index % 5) + 1]
      if (question.type === 'number') return [String(question.id), index + 1]
      if (question.type === 'consent' || question.type === 'checkbox') return [String(question.id), true]
      if (question.type === 'select') return [String(question.id), question.options?.[index % Math.max(question.options.length, 1)] ?? '선택 1']
      return [String(question.id), question.type === 'long_text' ? `예시 장문 응답 ${index + 1}` : `예시 답변 ${index + 1}`]
    })),
  }))
}
