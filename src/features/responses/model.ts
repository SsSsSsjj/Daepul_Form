import {
  defaultFormSettings,
  type FormQuestion,
  type FormSettings,
  type GeneratedForm,
  type KeywordInsight,
  type ResponseFilters,
  type ResponsePage,
  type ResponseQuery,
  type ResponseTopic,
  type StoredFormResponse,
} from '../../types'
import { answersForResponseRoute } from '../forms/conditionalRouting'

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
  if (question.inputFormat === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return '이메일 형식에 맞게 입력해 주세요. 예: name@example.com'
  }
  if (question.inputFormat === 'phone' && !/^010-\d{4}-\d{4}$/.test(text)) {
    return '전화번호 형식에 맞게 입력해 주세요. 예: 010-0000-0000'
  }
  if (question.inputFormat === 'date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
    const date = match ? new Date(`${text}T00:00:00Z`) : null
    if (!match || !date || Number.isNaN(date.getTime())
      || date.getUTCFullYear() !== Number(match[1])
      || date.getUTCMonth() + 1 !== Number(match[2])
      || date.getUTCDate() !== Number(match[3])) {
      return '날짜 형식에 맞게 입력해 주세요. 예: YYYY-MM-DD'
    }
  }
  if (question.min !== undefined && question.type === 'number' && Number(value) < question.min) {
    return `${question.min} 이상이어야 합니다.`
  }
  if (question.max !== undefined && question.type === 'number' && Number(value) > question.max) {
    return `${question.max} 이하여야 합니다.`
  }
  if (question.type === 'checkbox' && Array.isArray(value) && question.maxSelections && value.length > question.maxSelections) {
    return `최대 ${question.maxSelections}개까지 선택할 수 있습니다.`
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

export function queryResponses(items: StoredFormResponse[], query: ResponseQuery, exportAll = false): ResponsePage {
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
  const page = exportAll ? 1 : query.page
  const pageSize = exportAll ? Math.max(1, sorted.length) : query.pageSize
  const start = Math.max(0, (page - 1) * pageSize)
  return {
    items: sorted.slice(start, start + pageSize),
    total: sorted.length,
    overallTotal: items.length,
    page,
    pageSize,
    hasMore: start + pageSize < sorted.length,
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

const samplePeople = [
  { name: '김민준', email: 'minjun.kim@kangnam.ac.kr', phone: '010-2741-5836', birthDate: '2002-03-14' },
  { name: '이서연', email: 'seoyeon.lee@kangnam.ac.kr', phone: '010-5168-2047', birthDate: '2001-11-02' },
  { name: '박지훈', email: 'jihoon.park@kangnam.ac.kr', phone: '010-8392-4615', birthDate: '2003-07-25' },
  { name: '최유진', email: 'yujin.choi@kangnam.ac.kr', phone: '010-4027-9158', birthDate: '2002-09-08' },
  { name: '정하늘', email: 'haneul.jeong@kangnam.ac.kr', phone: '010-6813-7294', birthDate: '2000-12-19' },
  { name: '윤서준', email: 'seojun.yoon@kangnam.ac.kr', phone: '010-3259-8471', birthDate: '2001-05-30' },
  { name: '한지민', email: 'jimin.han@kangnam.ac.kr', phone: '010-7486-1302', birthDate: '2003-01-17' },
  { name: '오시우', email: 'siwoo.oh@kangnam.ac.kr', phone: '010-1974-6253', birthDate: '2002-06-11' },
  { name: '강예린', email: 'yerin.kang@kangnam.ac.kr', phone: '010-9531-4806', birthDate: '2001-08-23' },
  { name: '임도윤', email: 'doyoon.lim@kangnam.ac.kr', phone: '010-4608-3719', birthDate: '2003-10-05' },
] as const

const departments = ['경영학전공', '소프트웨어응용학부', '사회복지학부', '글로벌문화학부', '교육학과', '인공지능융합공학부']
const desiredRoles = ['서비스 기획', '데이터 분석', '백엔드 개발', '디지털 마케팅', '사회복지사', '교육 콘텐츠 기획']
const preparationAnswers = [
  '관심 직무를 정하고 관련 자격증과 포트폴리오를 준비하고 있습니다.',
  '채용 공고를 살펴보며 필요한 역량을 정리하고 현직자 멘토링에 참여하고 있습니다.',
  '아직 직무를 탐색하는 단계라 여러 분야의 실무 경험과 정보를 비교해 보고 싶습니다.',
  '자기소개서 초안을 작성했고 면접 경험을 쌓기 위해 모의 면접을 준비하고 있습니다.',
]
const participationReasons = [
  '현직자의 실제 업무 이야기를 듣고 제 진로 방향을 구체적으로 정하고 싶어서 신청했습니다.',
  '희망 직무에 필요한 역량과 포트폴리오 준비 방법을 알고 싶습니다.',
  '혼자 준비하며 막혔던 부분을 멘토에게 질문하고 취업 준비 계획을 점검하고 싶습니다.',
  '다양한 직무를 비교해 보고 제 강점에 맞는 진로를 찾는 데 도움을 받고 싶습니다.',
]
const returnSupportAnswers = [
  '복학 신청 일정과 수강신청 절차를 한눈에 볼 수 있는 안내 자료가 필요합니다.',
  '복학 전에 학업 계획을 점검할 수 있도록 담당자와 일대일 상담을 받고 싶습니다.',
  '휴학 기간의 경험을 살려 취업 준비를 이어갈 수 있는 진로 상담과 채용 정보가 필요합니다.',
  '등록금과 장학금, 복학 후 학사 일정에 대한 알림을 미리 받고 싶습니다.',
  '복학 예정자를 위한 온라인 설명회와 충분한 질문 시간을 운영해 주면 좋겠습니다.',
  '전공별 수강 계획과 졸업 요건을 함께 확인할 수 있는 상담이 필요합니다.',
]
const programFeedbackAnswers = [
  '현직자의 실제 사례를 들을 수 있어 진로를 구체화하는 데 도움이 되었습니다.',
  '실습 시간이 유익했으며 결과물에 대한 개별 피드백도 받을 수 있어 좋았습니다.',
  '질문 시간이 조금 짧아 다음에는 멘토와 이야기할 시간을 더 늘려 주면 좋겠습니다.',
  '프로그램 자료를 미리 공유해 주면 내용을 준비하고 참여하는 데 도움이 될 것 같습니다.',
  '후속 상담이나 심화 프로그램이 이어진다면 다시 참여하고 싶습니다.',
]

function includesAny(label: string, keywords: string[]) {
  return keywords.some((keyword) => label.includes(keyword))
}

function sampleEmail(index: number) {
  const person = samplePeople[index % samplePeople.length]
  if (index < samplePeople.length) return person.email
  const [localPart, domain] = person.email.split('@')
  return `${localPart}+${Math.floor(index / samplePeople.length) + 1}@${domain}`
}

function sampleTextAnswer(question: FormQuestion, index: number) {
  const person = samplePeople[index % samplePeople.length]
  const label = question.label.replace(/\s+/g, ' ').trim()
  if (question.inputFormat === 'email' || includesAny(label, ['이메일', '메일 주소'])) return sampleEmail(index)
  if (question.inputFormat === 'phone' || includesAny(label, ['연락처', '전화번호', '휴대전화'])) return person.phone
  if (question.inputFormat === 'date' || includesAny(label, ['생년월일', '생일', '날짜'])) return person.birthDate
  if (includesAny(label, ['이름', '성명'])) return person.name
  if (includesAny(label, ['학번'])) return `202${index % 4}${String(1200 + index * 37).padStart(4, '0')}`
  if (includesAny(label, ['학과', '전공'])) return departments[index % departments.length]
  if (includesAny(label, ['학년'])) return `${(index % 4) + 1}학년`
  if (includesAny(label, ['희망직무', '희망 직무', '관심 직무'])) return desiredRoles[index % desiredRoles.length]
  if (includesAny(label, ['취업 준비', '준비 상황'])) return preparationAnswers[index % preparationAnswers.length]
  if (includesAny(label, ['참여하려는 이유', '신청 이유', '지원 동기', '참여 이유'])) return participationReasons[index % participationReasons.length]
  if (includesAny(label, ['복학', '학교 지원'])) return returnSupportAnswers[index % returnSupportAnswers.length]
  if (includesAny(label, ['의견', '후기', '만족', '도움', '개선', '아쉬'])) return programFeedbackAnswers[index % programFeedbackAnswers.length]
  return question.type === 'long_text'
    ? programFeedbackAnswers[index % programFeedbackAnswers.length]
    : ['참여를 희망합니다', '관련 경험이 있습니다', '안내 내용을 확인했습니다', '추가 상담을 희망합니다'][index % 4]
}

export function createSampleResponses(questions: FormQuestion[], count = 10): StoredFormResponse[] {
  return Array.from({ length: count }, (_, index) => {
    const person = samplePeople[index % samplePeople.length]
    const generatedAnswers = Object.fromEntries(questions.map((question) => {
      if (question.type === 'rating') return [String(question.id), [5, 4, 5, 4, 3, 5, 4, 5, 4, 5][index % 10]]
      if (question.type === 'number') {
        const minimum = question.min ?? 1
        const maximum = question.max ?? Math.max(minimum + 9, 10)
        return [String(question.id), Math.min(maximum, minimum + (index % Math.max(1, maximum - minimum + 1)))]
      }
      if (question.type === 'consent') return [String(question.id), true]
      if (question.type === 'checkbox') {
        const options = question.options?.length ? question.options : ['선택지 1', '선택지 2']
        const selected = options.filter((_, optionIndex) => (optionIndex + index) % 2 === 0)
        return [String(question.id), (selected.length ? selected : [options[index % options.length]]).slice(0, question.maxSelections)]
      }
      if (question.type === 'select') return [String(question.id), question.options?.[index % Math.max(question.options.length, 1)] ?? '선택 1']
      if (question.type === 'file') return [String(question.id), `포트폴리오_${person.name}.pdf`]
      return [String(question.id), sampleTextAnswer(question, index)]
    }))
    return {
      id: `sample-${index + 1}`,
      responseId: `sample-${index + 1}`,
      submittedAt: new Date(Date.now() - index * 86_400_000).toISOString(),
      respondentName: person.name,
      studentId: `202${index % 4}${String(1200 + index * 37).padStart(4, '0')}`,
      respondentEmail: sampleEmail(index),
      status: 'submitted',
      answers: answersForResponseRoute(questions, generatedAnswers) as StoredFormResponse['answers'],
    }
  })
}

export function createSampleAnalysisTopics(
  questions: FormQuestion[],
  responses: StoredFormResponse[],
): ResponseTopic[] {
  const labels = questions.map((question) => question.label).join(' ')
  const sourcesMatching = (pattern: RegExp) => responses
    .map((response, index) => ({ index, text: Object.values(response.answers).filter((value) => typeof value === 'string').join(' ') }))
    .filter(({ text }) => pattern.test(text))
    .map(({ index }) => index)
    .slice(0, 8)

  if (labels.includes('복학')) {
    return [
      {
        id: 'return-schedule',
        title: '복학 일정과 학사 절차 안내',
        category: '개선 의견',
        summary: '복학 신청, 수강신청, 등록금·장학금 일정을 한 번에 확인할 수 있는 안내가 필요하다는 의견이 반복되었습니다.',
        sourceIds: sourcesMatching(/일정|수강신청|등록금|장학금|절차/),
        reportSentence: '복학 예정자가 주요 학사 일정을 놓치지 않도록 통합 안내 자료와 사전 알림을 제공할 필요가 있습니다.',
      },
      {
        id: 'return-counseling',
        title: '개별 학업 상담 수요',
        category: '후속 요청',
        summary: '전공별 수강 계획과 졸업 요건을 점검할 수 있는 일대일 상담 및 설명회 요청이 확인되었습니다.',
        sourceIds: sourcesMatching(/상담|졸업 요건|설명회|학업 계획/),
        reportSentence: '복학 전 개인별 학업 계획을 점검할 수 있도록 전공 맞춤 상담 기회를 확대하는 방안을 검토할 수 있습니다.',
      },
      {
        id: 'return-career',
        title: '진로·취업 연계 지원',
        category: '후속 요청',
        summary: '휴학 기간의 경험을 취업 준비로 연결할 수 있는 진로 상담과 채용 정보에 대한 수요가 나타났습니다.',
        sourceIds: sourcesMatching(/진로|취업|채용/),
        reportSentence: '복학 지원 과정에 진로 상담과 최신 채용 정보를 함께 제공하면 학교생활 복귀와 취업 준비에 도움이 될 수 있습니다.',
      },
    ]
  }

  const positiveSources = sourcesMatching(/도움|좋았|유익|구체화|실제 사례/)
  const improvementSources = sourcesMatching(/짧|늘려|미리 공유|아쉬|개선/)
  const followupSources = sourcesMatching(/후속|심화|상담|다시 참여/)
  const topics: ResponseTopic[] = []
  if (positiveSources.length) topics.push({
    id: 'sample-positive',
    title: '실무 중심 구성에 대한 만족',
    category: '긍정 의견',
    summary: '실제 사례와 실습, 개별 피드백이 진로와 준비 방향을 구체화하는 데 도움이 되었다는 의견이 많았습니다.',
    sourceIds: positiveSources,
    reportSentence: '참여자들은 실무 사례와 직접 적용해 보는 활동을 프로그램의 주요 강점으로 평가했습니다.',
  })
  if (improvementSources.length) topics.push({
    id: 'sample-improvement',
    title: '충분한 질의응답 시간과 사전 자료',
    category: '개선 의견',
    summary: '멘토와 대화할 시간을 늘리고 프로그램 자료를 사전에 공유해 달라는 의견이 확인되었습니다.',
    sourceIds: improvementSources,
    reportSentence: '다음 운영 시 질의응답 시간을 확대하고 사전 자료를 제공하면 참여 몰입도를 높일 수 있습니다.',
  })
  if (followupSources.length) topics.push({
    id: 'sample-followup',
    title: '후속 상담과 심화 과정 요청',
    category: '후속 요청',
    summary: '프로그램 이후에도 상담이나 심화 활동을 이어가고 싶다는 수요가 나타났습니다.',
    sourceIds: followupSources,
    reportSentence: '일회성 프로그램을 후속 상담 및 심화 과정과 연계하는 방안을 검토할 필요가 있습니다.',
  })
  return topics.length ? topics : [{
    id: 'sample-overview',
    title: '주요 응답 경향',
    category: '기타 의견',
    summary: '선택형과 주관식 응답을 종합하면 프로그램 안내와 참여 지원에 대한 다양한 의견이 확인되었습니다.',
    sourceIds: responses.slice(0, 5).map((_, index) => index),
    reportSentence: '실제 운영 전 원문 응답과 함께 세부 의견을 추가로 검토해 주세요.',
  }]
}
