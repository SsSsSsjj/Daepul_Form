import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const option = (name, fallback = '') => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const projectId = option('--project', 'daepulform')
const ownerUids = option('--uids').split(',').map((value) => value.trim()).filter(Boolean)
const apply = args.includes('--apply')
const cleanup = args.includes('--cleanup')
const prefix = 'demo-dashboard'

if (!ownerUids.length) {
  throw new Error('대상 UID를 --uids uid1,uid2 형식으로 지정하세요.')
}
if (apply && cleanup) {
  throw new Error('--apply와 --cleanup은 동시에 사용할 수 없습니다.')
}

const firebaseToolsRoot = path.join(
  process.env.APPDATA ?? '',
  'npm',
  'node_modules',
  'firebase-tools',
  'lib',
)
const cliAuth = require(path.join(firebaseToolsRoot, 'auth.js'))
const api = require(path.join(firebaseToolsRoot, 'apiv2.js'))
const account = cliAuth.getGlobalDefaultAccount()
if (!account?.tokens?.refresh_token) {
  throw new Error('Firebase CLI 로그인이 필요합니다. firebase login을 먼저 실행하세요.')
}
api.setRefreshToken(account.tokens.refresh_token)
const accessToken = await api.getAccessToken()

const programs = [
  { key: 'career-2024', name: '진로 탐색 캠프', year: 2024, selected: 28, demand: 33, applications: 31, satisfaction: 21, rating: 3.9 },
  { key: 'career-2025', name: '진로 탐색 캠프', year: 2025, selected: 36, demand: 47, applications: 41, satisfaction: 29, rating: 4.2 },
  { key: 'career-2026', name: '진로 탐색 캠프', year: 2026, selected: 42, demand: 63, applications: 55, satisfaction: 38, rating: 4.55 },
  { key: 'job-2025', name: '취업 역량 특강', year: 2025, selected: 50, demand: 39, applications: 32, satisfaction: 22, rating: 3.75 },
  { key: 'job-2026', name: '취업 역량 특강', year: 2026, selected: 45, demand: 58, applications: 49, satisfaction: 34, rating: 4.05 },
  { key: 'startup-2026', name: '창업 아이디어 워크숍', year: 2026, selected: 30, demand: 36, applications: 27, satisfaction: 18, rating: 4.35 },
]
const gradeOptions = ['1학년', '2학년', '2학년', '3학년', '3학년', '4학년', '기타']
const strengths = [
  '현직자 사례가 구체적이라 진로를 이해하는 데 도움이 되었습니다.',
  '실습 중심으로 진행되어 바로 적용해 볼 수 있었습니다.',
  '멘토의 피드백이 자세하고 질문하기 편했습니다.',
  '비슷한 고민을 가진 학생들과 의견을 나눌 수 있어 좋았습니다.',
]
const improvements = [
  '실습 시간이 조금 더 길었으면 좋겠습니다.',
  '장소와 준비물 안내를 더 일찍 받고 싶습니다.',
  '질의응답 시간이 부족해 아쉬웠습니다.',
  '학년별 난이도를 나누어 진행하면 좋겠습니다.',
  '사례를 더 다양하게 소개해 주세요.',
  '조별 활동 인원이 조금 많았습니다.',
]
const motivations = [
  '진로 방향을 구체적으로 정하고 싶어서 신청했습니다.',
  '취업 준비에 필요한 실무 정보를 얻고 싶습니다.',
  '관심 직무의 현직자 이야기를 듣고 싶습니다.',
  '포트폴리오와 자기소개서 피드백을 받고 싶습니다.',
]

function hash(text) {
  let value = 2166136261
  for (const character of text) {
    value ^= character.charCodeAt(0)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

function random(seedText) {
  let seed = hash(seedText)
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function firestoreValue(value) {
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value }
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } }
  return { mapValue: { fields: firestoreFields(value) } }
}

function firestoreFields(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, firestoreValue(value)]))
}

function documentName(documentPath) {
  return `projects/${projectId}/databases/(default)/documents/${documentPath}`
}

function updateWrite(documentPath, data) {
  return { update: { name: documentName(documentPath), fields: firestoreFields(data) } }
}

function formQuestions(formType) {
  if (formType === 'demand_survey') return [
    { id: 101, label: '학년을 선택해 주세요.', type: 'select', required: true, options: ['1학년', '2학년', '3학년', '4학년', '기타'], analyticsRole: 'grade' },
    { id: 102, label: '이 프로그램에 참여할 의향이 있나요?', type: 'select', required: true, options: ['매우 있음', '있음', '보통', '없음'] },
  ]
  if (formType === 'application') return [
    { id: 201, label: '학년을 선택해 주세요.', type: 'select', required: true, options: ['1학년', '2학년', '3학년', '4학년', '기타'], analyticsRole: 'grade' },
    { id: 202, label: '신청 동기를 적어 주세요.', type: 'long_text', required: true },
  ]
  return [
    { id: 301, label: '학년을 선택해 주세요.', type: 'select', required: true, options: ['1학년', '2학년', '3학년', '4학년', '기타'], analyticsRole: 'grade' },
    { id: 302, label: '프로그램 전반에 얼마나 만족하셨나요?', type: 'rating', required: true, analyticsRole: 'overall_satisfaction' },
    { id: 303, label: '프로그램에서 좋았던 점을 적어 주세요.', type: 'long_text', required: false, analyticsRole: 'strength' },
    { id: 304, label: '프로그램에서 아쉬웠거나 개선이 필요한 점을 적어 주세요.', type: 'long_text', required: false, analyticsRole: 'improvement' },
  ]
}

function responseAnswers(formType, index, rng, targetRating) {
  const grade = gradeOptions[Math.floor(rng() * gradeOptions.length)]
  if (formType === 'demand_survey') {
    const interest = rng() < .58 ? '매우 있음' : rng() < .78 ? '있음' : rng() < .92 ? '보통' : '없음'
    return { 101: grade, 102: interest }
  }
  if (formType === 'application') {
    return { 201: grade, 202: motivations[(index + Math.floor(rng() * motivations.length)) % motivations.length] }
  }
  const noise = (rng() - .5) * 2.2
  const rating = Math.max(1, Math.min(5, Math.round(targetRating + noise)))
  return {
    301: grade,
    302: rating,
    303: strengths[(index + Math.floor(rng() * strengths.length)) % strengths.length],
    304: improvements[(index * 2 + Math.floor(rng() * improvements.length)) % improvements.length],
  }
}

function formSettings(year, selectedHeadcount) {
  return {
    access: {
      participation: 'authenticated',
      identityCollection: 'profile',
      allowMultiple: false,
      allowedEmails: [],
      allowedGroups: [],
    },
    submission: {
      allowDrafts: false,
      allowEditAfterSubmit: false,
      emailReceipt: false,
      showOwnResponse: true,
      showPublicResults: false,
      randomizeQuestions: false,
      submitLabel: '응답 제출하기',
      completionMessage: '응답이 제출되었습니다.',
      maxResponses: selectedHeadcount * 2,
    },
    schedule: {
      status: 'closed',
      startsAt: `${year}-03-01T00:00:00.000Z`,
      closesAt: `${year}-12-20T14:59:59.000Z`,
    },
    branding: { theme: 'kangnam', icon: 'graduation' },
    notifications: {
      newResponseEmail: false,
      startEmail: false,
      closingSoonEmail: false,
      closedEmail: false,
    },
    integrations: {},
    quiz: { enabled: false, releaseScore: 'immediately', showCorrectAnswers: false },
    workspace: { enabled: false, name: '', emailDomain: 'kangnam.ac.kr' },
    version: 1,
  }
}

const writes = []
const summary = []
for (const [ownerIndex, ownerUid] of ownerUids.entries()) {
  const ownerKey = ownerUid.slice(0, 8).toLowerCase()
  for (const program of programs) {
    const programId = `${prefix}-${ownerKey}-${program.key}`
    const countOffset = ownerIndex * 2
    writes.push(updateWrite(`programs/${programId}`, {
      name: program.name,
      year: program.year,
      selectedHeadcount: program.selected + ownerIndex * 3,
      ownerUid,
      ownerEmail: '',
      seedTag: prefix,
      createdAt: new Date(`${program.year}-01-15T03:00:00.000Z`),
      updatedAt: new Date(),
    }))
    for (const formType of ['demand_survey', 'application', 'satisfaction']) {
      const typeLabel = {
        demand_survey: '수요조사',
        application: '참가신청',
        satisfaction: '만족도조사',
      }[formType]
      const formId = `${prefix}-${ownerKey}-${program.key}-${formType}`
      const responseCount = (
        formType === 'demand_survey'
          ? program.demand
          : formType === 'application'
            ? program.applications
            : program.satisfaction
      ) + countOffset
      const questions = formQuestions(formType)
      writes.push(updateWrite(`forms/${formId}`, {
        formId,
        creatorUid: ownerUid,
        ownerUid,
        ownerEmail: '',
        programId,
        program: {
          programName: `${program.year} ${program.name} ${typeLabel}`,
          description: `${program.name} ${typeLabel} 대시보드 검증용 가상 데이터입니다.`,
          target: '강남대학교 재학생',
          period: `${program.year}. 3. ~ ${program.year}. 12.`,
          schedule: '',
          capacity: `${program.selected + ownerIndex * 3}명`,
          requirements: '',
          privacyConsent: '',
        },
        questions,
        formType,
        theme: 'kangnam',
        settings: formSettings(program.year, program.selected + ownerIndex * 3),
        status: 'closed',
        responseCount,
        published: false,
        seedTag: prefix,
        surveyEndAt: new Date(`${program.year}-12-20T14:59:59.000Z`),
        createdAt: new Date(`${program.year}-02-15T03:00:00.000Z`),
        updatedAt: new Date(),
      }))
      const rng = random(`${ownerUid}-${program.key}-${formType}`)
      for (let index = 0; index < responseCount; index += 1) {
        const responseId = `demo-response-${String(index + 1).padStart(4, '0')}`
        const submittedAt = new Date(Date.UTC(program.year, 2 + (index % 8), 2 + (index % 24), 1 + (index % 12), index % 60))
        writes.push(updateWrite(`forms/${formId}/responses/${responseId}`, {
          responseId,
          formId,
          actorUid: `demo-actor-${ownerKey}-${index + 1}`,
          respondentUid: null,
          anonymousId: `demo-anonymous-${ownerKey}-${index + 1}`,
          respondentEmail: `demo.${ownerKey}.${index + 1}@example.invalid`,
          respondentName: `가상 응답자 ${index + 1}`,
          studentId: `${program.year}${String(1000 + index + ownerIndex * 100).slice(-4)}`,
          attachments: [],
          answers: responseAnswers(formType, index, rng, program.rating + ownerIndex * .05),
          status: 'submitted',
          formVersion: 1,
          submittedAt,
          updatedAt: submittedAt,
          immutable: true,
          seedTag: prefix,
        }))
      }
      summary.push({ ownerUid, program: `${program.year} ${program.name}`, formType, responseCount })
    }
  }
}

const uniqueWrites = [...new Map(writes.map((write) => [write.update.name, write])).values()]
console.log(`프로젝트: ${projectId}`)
console.log(`대상 계정: ${ownerUids.length}개`)
console.log(`프로그램: ${ownerUids.length * programs.length}개`)
console.log(`폼: ${summary.length}개`)
console.log(`응답: ${summary.reduce((sum, item) => sum + item.responseCount, 0)}건`)
console.log(`총 문서 쓰기: ${uniqueWrites.length}건`)

if (!apply && !cleanup) {
  console.log('드라이런입니다. 실제 생성은 --apply를 추가하세요.')
  process.exit(0)
}

const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchWrite`
for (let start = 0; start < uniqueWrites.length; start += 400) {
  const selected = uniqueWrites.slice(start, start + 400)
  const body = cleanup
    ? { writes: selected.map((write) => ({ delete: write.update.name })) }
    : { writes: selected }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': projectId,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`Firestore batchWrite 실패 (${response.status}): ${(await response.text()).slice(0, 500)}`)
  }
  console.log(`${Math.min(start + selected.length, uniqueWrites.length)} / ${uniqueWrites.length} 처리`)
}

console.log(cleanup ? '데모 대시보드 데이터를 삭제했습니다.' : '데모 대시보드 데이터를 생성했습니다.')
