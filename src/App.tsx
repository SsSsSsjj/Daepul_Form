import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Copy,
  Download,
  FileCheck2,
  FileText,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  Plus,
  QrCode,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
  WandSparkles,
} from 'lucide-react'
import QRCode from 'qrcode'
import {
  sampleAttendance,
  sampleProgram,
  sampleQuestions,
  sampleResponses,
  sampleStats,
  sampleTopics,
} from './sampleData'
import {
  demoAuthEnabled,
  firebaseConfigured,
  getPublishedForm,
  hasSubmittedResponse,
  observeAuthState,
  publishFormRecord,
  saveAnalysisRecord,
  signInWithGoogle,
  submitResponseOnce,
  type FirebaseUser,
} from './firebase'
import type {
  AnalysisStatus,
  DemoMode,
  FormQuestion,
  ProgramInfo,
  QuestionType,
  ResponseTopic,
  ResultStats,
  Step,
} from './types'

const storageKeys = {
  program: 'daepul-program',
  questions: 'daepul-questions',
  stats: 'daepul-stats',
  responses: 'daepul-responses',
  topics: 'daepul-topics',
}

const demoFormId = 'mentoring-2026'
const demoCreatorUid = 'creator-demo-001'
const demoResponderUid = 'responder-demo-001'
const demoSubmissionKey = `daepul-submission-${demoFormId}-${demoResponderUid}`

const emptyProgram: ProgramInfo = {
  programName: '',
  description: '',
  target: '',
  period: '',
  schedule: '',
  capacity: '',
  requirements: '',
  privacyConsent: '',
}

const emptyStats: ResultStats = {
  applicants: 0,
  participants: 0,
  satisfactionResponses: 0,
  satisfactionScores: [],
}

const stepItems: { id: Step; label: string; shortLabel: string }[] = [
  { id: 'create', label: '문서 분석', shortLabel: '분석' },
  { id: 'edit', label: '폼 편집', shortLabel: '편집' },
  { id: 'publish', label: '미리보기·배포', shortLabel: '배포' },
  { id: 'results', label: '결과 분석', shortLabel: '결과' },
  { id: 'export', label: '내보내기', shortLabel: '저장' },
]

const questionTypeLabels: Record<QuestionType, string> = {
  short_text: '단답형',
  long_text: '장문형',
  select: '객관식',
  checkbox: '체크박스',
  consent: '개인정보 동의',
}

function loadStored<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function classifyResponses(responses: string[]): ResponseTopic[] {
  if (responses.join('|') === sampleResponses.join('|')) return sampleTopics

  const groups: Record<string, number[]> = { experience: [], time: [], followup: [], other: [] }
  responses.forEach((response, index) => {
    if (/시간|질문/.test(response)) groups.time.push(index)
    else if (/후속|상담|다양|직무별/.test(response)) groups.followup.push(index)
    else if (/좋|도움|현직|조언|사례|유익/.test(response)) groups.experience.push(index)
    else groups.other.push(index)
  })

  const templates: Record<string, Omit<ResponseTopic, 'sourceIds'>> = {
    experience: {
      id: 'experience',
      title: '현직자 경험과 조언',
      category: '긍정 의견',
      summary: '현직자의 경험과 실무 조언을 긍정적으로 평가한 의견입니다.',
      reportSentence: '참여자들은 현직자의 경험과 실무 중심 조언을 긍정적으로 평가했습니다.',
    },
    time: {
      id: 'time',
      title: '프로그램 시간',
      category: '개선 의견',
      summary: '질문 또는 프로그램 시간 조정이 필요하다는 의견입니다.',
      reportSentence: '참여자와 멘토가 충분히 소통할 수 있도록 운영 시간 조정을 검토할 필요가 있습니다.',
    },
    followup: {
      id: 'followup',
      title: '후속 프로그램 요청',
      category: '후속 요청',
      summary: '직무별 멘토 구성과 후속 상담에 관한 요청입니다.',
      reportSentence: '직무별 멘토 구성과 후속 상담 프로그램 확대를 검토할 필요가 있습니다.',
    },
    other: {
      id: 'other',
      title: '기타 의견',
      category: '기타 의견',
      summary: '공통 주제를 특정하기 어려워 담당자의 확인이 필요한 의견입니다.',
      reportSentence: '기타 개별 의견은 원문을 추가로 검토하여 다음 운영에 반영할 필요가 있습니다.',
    },
  }

  return Object.entries(groups)
    .filter(([, sourceIds]) => sourceIds.length > 0)
    .map(([key, sourceIds]) => ({ ...templates[key], sourceIds }))
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="section-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  )
}

function StatusNotice({ tone, children }: { tone: 'info' | 'error' | 'success' | 'warning'; children: ReactNode }) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'success' ? CheckCircle2 : tone === 'warning' ? AlertCircle : Sparkles
  return (
    <div className={`status-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loginLoading, setLoginLoading] = useState(false)
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null)
  const [usingDemoAuth, setUsingDemoAuth] = useState(false)
  const [authError, setAuthError] = useState('')
  const [step, setStep] = useState<Step>('start')
  const [demoMode, setDemoMode] = useState<DemoMode>('normal')
  const [files, setFiles] = useState<string[]>([])
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [draft, setDraft] = useState('')
  const [program, setProgram] = useState<ProgramInfo>(() => loadStored(storageKeys.program, emptyProgram))
  const [questions, setQuestions] = useState<FormQuestion[]>(() => loadStored(storageKeys.questions, []))
  const [documentStatus, setDocumentStatus] = useState<AnalysisStatus>('idle')
  const [documentError, setDocumentError] = useState('')
  const [formError, setFormError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [publishState, setPublishState] = useState<'draft' | 'published'>('draft')
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [surveyEndDate, setSurveyEndDate] = useState('2026-08-08')
  const [stats, setStats] = useState<ResultStats>(() => loadStored(storageKeys.stats, emptyStats))
  const [responsesText, setResponsesText] = useState(() => loadStored(storageKeys.responses, ''))
  const [topics, setTopics] = useState<ResponseTopic[]>(() => loadStored(storageKeys.topics, []))
  const [resultStatus, setResultStatus] = useState<AnalysisStatus>('idle')
  const [resultError, setResultError] = useState('')
  const [excludedSources, setExcludedSources] = useState<number[]>([])
  const [selectedTopics, setSelectedTopics] = useState<string[]>([])
  const [toast, setToast] = useState('')
  const [respondentView, setRespondentView] = useState(false)

  const requestedFormId = useMemo(() => new URLSearchParams(window.location.search).get('form'), [])
  const virtualLink = `${window.location.origin}/?form=${demoFormId}`
  const responses = useMemo(
    () => responsesText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    [responsesText],
  )
  const participationRate = stats.applicants > 0 ? (stats.participants / stats.applicants) * 100 : 0
  const satisfactionAverage = stats.satisfactionScores.length
    ? stats.satisfactionScores.reduce((sum, score) => sum + score, 0) / stats.satisfactionScores.length
    : 0
  const noShowCount = Math.max(stats.applicants - stats.participants, 0)
  const formReady = Boolean(program.programName && program.target && program.period && questions.length > 0)
  const deletionDateLabel = useMemo(() => {
    const date = new Date(`${surveyEndDate}T23:59:59+09:00`)
    date.setDate(date.getDate() + 14)
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
  }, [surveyEndDate])

  useEffect(() => {
    window.localStorage.setItem(storageKeys.program, JSON.stringify(program))
    window.localStorage.setItem(storageKeys.questions, JSON.stringify(questions))
    window.localStorage.setItem(storageKeys.stats, JSON.stringify(stats))
    window.localStorage.setItem(storageKeys.responses, JSON.stringify(responsesText))
    window.localStorage.setItem(storageKeys.topics, JSON.stringify(topics))
  }, [program, questions, stats, responsesText, topics])

  useEffect(() => observeAuthState((user) => {
    setAuthUser(user)
    if (!user) return
    setIsLoggedIn(true)
    setUsingDemoAuth(false)
    if (requestedFormId) {
      void getPublishedForm(requestedFormId)
        .then((publishedForm) => {
          setProgram(publishedForm.program)
          setQuestions(publishedForm.questions)
          if (publishedForm.surveyEndDate) setSurveyEndDate(publishedForm.surveyEndDate)
          setRespondentView(true)
        })
        .catch(() => setAuthError('공개된 폼을 불러오지 못했습니다. 링크와 공개 상태를 확인해 주세요.'))
    } else {
      setStep((current) => current === 'start' ? 'create' : current)
    }
  }), [requestedFormId])

  useEffect(() => {
    if (!program.programName) return
    void QRCode.toDataURL(virtualLink, {
      width: 260,
      margin: 2,
      color: { dark: '#153f3a', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''))
  }, [program.programName, virtualLink])

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  const login = async () => {
    setAuthError('')
    setLoginLoading(true)
    try {
      await signInWithGoogle()
    } catch {
      setAuthError('Google 로그인에 실패했습니다. Firebase Console의 로그인 제공업체와 승인된 도메인을 확인해 주세요.')
    } finally {
      setLoginLoading(false)
    }
  }

  const demoLogin = () => {
    setAuthError('')
    setLoginLoading(true)
    window.setTimeout(() => {
      setLoginLoading(false)
      setUsingDemoAuth(true)
      setIsLoggedIn(true)
      if (requestedFormId) {
        setProgram(sampleProgram)
        setQuestions(sampleQuestions)
        setSurveyEndDate('2026-08-08')
        setRespondentView(true)
      } else {
        setStep(program.programName ? 'edit' : 'create')
      }
    }, 650)
  }

  const handleDemoMode = (mode: DemoMode) => {
    setDemoMode(mode)
    setDocumentError('')
    setResultError('')
    if (mode === 'empty') {
      setFiles([])
      setDraft('')
      setResponsesText('')
    }
    showToast(mode === 'normal' ? '정상 시나리오로 전환했습니다.' : mode === 'empty' ? '빈 입력 상태를 준비했습니다.' : '실패 시나리오를 준비했습니다.')
  }

  const addReferenceFiles = (selected: File[]) => {
    const supported = ['pdf', 'doc', 'docx', 'hwp', 'hwpx', 'png']
    const invalid = selected.find((file) => !supported.includes(file.name.split('.').pop()?.toLowerCase() ?? ''))
    if (invalid) {
      setDocumentError(`${invalid.name}: 지원하지 않는 파일 형식입니다. PDF, DOCX, HWP, PNG 파일을 선택해 주세요.`)
      return
    }
    setDocumentError('')
    setFiles((current) => Array.from(new Set([...current, ...selected.map((file) => file.name)])))
  }

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    addReferenceFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handleFileDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setIsDraggingFile(false)
    addReferenceFiles(Array.from(event.dataTransfer.files))
  }

  const loadSampleDocument = () => {
    setFiles(['2026_하계_진로멘토링_운영계획서.pdf'])
    setDraft('재학생의 직무 이해와 취업 준비를 돕는 하계 진로 멘토링 프로그램입니다.')
    setDocumentError('')
    setDemoMode('normal')
  }

  const analyzeDocument = (forceNormal = false) => {
    if (demoMode === 'empty' || (files.length === 0 && !draft.trim())) {
      setDocumentError('공고문, 운영계획서 또는 프로그램 초안을 입력해 주세요.')
      setDocumentStatus('idle')
      return
    }
    setDocumentStatus('loading')
    setDocumentError('')
    window.setTimeout(() => {
      if (demoMode === 'failure' && !forceNormal) {
        setDocumentStatus('error')
        setDocumentError('문서를 분석하지 못했습니다. 다시 시도해 주세요.')
        return
      }
      setProgram(sampleProgram)
      setQuestions(sampleQuestions)
      setDocumentStatus('success')
      setStep('edit')
    }, 950)
  }

  const updateProgram = (field: keyof ProgramInfo, value: string) => {
    setProgram((current) => ({ ...current, [field]: value }))
  }

  const updateQuestion = (id: number, changes: Partial<FormQuestion>) => {
    setQuestions((current) => current.map((question) => (question.id === id ? { ...question, ...changes } : question)))
  }

  const moveQuestion = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= questions.length) return
    setQuestions((current) => {
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }

  const addQuestion = () => {
    setQuestions((current) => [
      ...current,
      { id: Date.now(), label: '새 질문을 입력해 주세요.', type: 'short_text', required: false },
    ])
  }

  const confirmForm = () => {
    if (!formReady) {
      setFormError(!program.programName ? '폼 제목을 입력해 주세요.' : !questions.length ? '질문을 한 개 이상 추가해 주세요.' : '필수 프로그램 정보를 입력해 주세요.')
      return
    }
    setFormError('')
    setStep('publish')
  }

  const copyText = async (text: string, successMessage: string) => {
    try {
      fallbackCopyText(text)
      showToast(successMessage)
    } catch {
      try {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable')
        await navigator.clipboard.writeText(text)
        showToast(successMessage)
      } catch {
        showToast('복사하지 못했습니다. 브라우저 권한을 확인해 주세요.')
      }
    }
  }

  const publishForm = async () => {
    setPublishError('')
    setPublishLoading(true)
    try {
      if (usingDemoAuth) {
        await new Promise((resolve) => window.setTimeout(resolve, 500))
      } else {
        if (!authUser) throw new Error('auth-required')
        await publishFormRecord({
          formId: demoFormId,
          owner: authUser,
          program,
          questions,
          surveyEndDate,
        })
      }
      setPublishState('published')
      showToast(usingDemoAuth ? '가상 폼을 배포했습니다.' : 'Firebase에 폼을 배포했습니다.')
    } catch {
      setPublishError('폼을 배포하지 못했습니다. 로그인 상태와 Firestore 보안 규칙을 확인해 주세요.')
    } finally {
      setPublishLoading(false)
    }
  }

  const loadSampleResults = () => {
    setStats(sampleStats)
    setResponsesText(sampleResponses.join('\n'))
    setResultError('')
    setDemoMode('normal')
  }

  const analyzeResults = (forceNormal = false) => {
    if (demoMode === 'empty' || responses.length === 0 || stats.applicants <= 0) {
      setResultError('분석할 결과 데이터와 자유응답을 입력해 주세요.')
      setResultStatus('idle')
      return
    }
    setResultStatus('loading')
    setResultError('')
    window.setTimeout(() => {
      if (demoMode === 'failure' && !forceNormal) {
        setResultStatus('error')
        setResultError('예시 분석 결과를 생성하지 못했습니다. 다시 분석해 주세요.')
        return
      }
      const nextTopics = classifyResponses(responses)
      setTopics(nextTopics)
      setSelectedTopics(nextTopics.map((topic) => topic.id))
      setExcludedSources([])
      setResultStatus('success')
      if (authUser && !usingDemoAuth && publishState === 'published') {
        void saveAnalysisRecord({
          formId: demoFormId,
          owner: authUser,
          stats,
          topics: nextTopics,
          surveyEndDate,
        }).catch(() => showToast('분석 결과의 서버 저장에 실패했습니다.'))
      }
    }, 950)
  }

  const updateTopic = (id: string, changes: Partial<ResponseTopic>) => {
    setTopics((current) => current.map((topic) => (topic.id === id ? { ...topic, ...changes } : topic)))
  }

  const toggleExcludedSource = (sourceId: number) => {
    setExcludedSources((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId],
    )
  }

  const toggleSelectedTopic = (id: string) => {
    setSelectedTopics((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  const selectedReportText = topics
    .filter((topic) => selectedTopics.includes(topic.id))
    .map((topic) => `• ${topic.reportSentence}`)
    .join('\n')

  const exportWorkbook = () => {
    try {
      if (!topics.length) throw new Error('No analysis')
      const summaryRows: Array<Array<string | number>> = [
        ['항목', '값'],
        ['프로그램명', program.programName],
        ['신청 인원', stats.applicants],
        ['참여 인원', stats.participants],
        ['미참여 인원', noShowCount],
        ['참여율', `${participationRate.toFixed(1)}%`],
        ['만족도 평균', satisfactionAverage.toFixed(1)],
        ['자유응답 수', responses.length],
      ]
      const attendanceRows: Array<Array<string | number>> = [['신청자', '신청 여부', '출석 여부', '상태'], ...sampleAttendance.map((row) => [row.name, row.applied ? '신청' : '미신청', row.attended === null ? '이름 불일치' : row.attended ? '출석' : '미출석', row.status])]
      const topicRows: Array<Array<string | number>> = [['주제', '분류', '관련 응답 수', '핵심 요약', '결과보고서 후보 문장'], ...topics.map((topic) => [topic.title, topic.category, topic.sourceIds.filter((id) => !excludedSources.includes(id)).length, topic.summary, topic.reportSentence])]
      const workbook = createExcelWorkbook([
        ['핵심 통계', summaryRows],
        ['출석 비교', attendanceRows],
        ['자유응답 요약', topicRows],
      ])
      const url = URL.createObjectURL(new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = '대플폼_2026하계진로멘토링_예시결과.xls'
      anchor.click()
      URL.revokeObjectURL(url)
      showToast('예시 결과 엑셀 파일을 저장했습니다.')
    } catch {
      showToast('파일을 만들지 못했습니다. 분석 결과를 확인한 뒤 다시 시도해 주세요.')
    }
  }

  const resetAll = () => {
    Object.values(storageKeys).forEach((key) => window.localStorage.removeItem(key))
    setFiles([])
    setDraft('')
    setProgram(emptyProgram)
    setQuestions([])
    setDocumentStatus('idle')
    setDocumentError('')
    setStats(emptyStats)
    setResponsesText('')
    setTopics([])
    setResultStatus('idle')
    setResultError('')
    setExcludedSources([])
    setSelectedTopics([])
    setPublishState('draft')
    window.localStorage.removeItem(demoSubmissionKey)
    setRespondentView(false)
    setDemoMode('normal')
    setStep('create')
    showToast('새 작업을 시작합니다.')
  }

  const canVisitStep = (target: Step) => {
    if (target === 'create') return true
    if (target === 'edit') return Boolean(program.programName)
    if (target === 'publish') return formReady
    if (target === 'results') return formReady
    if (target === 'export') return topics.length > 0
    return false
  }

  if (!isLoggedIn || step === 'start') {
    return (
      <main className="login-shell">
        <div className="login-brand">
          <div className="brand-mark" aria-hidden="true">대</div>
          <span>대플폼</span>
        </div>
        <section className="login-card">
          <div className="login-copy">
            <span className="eyebrow">대학일자리플러스센터 업무 도구</span>
            <h1>프로그램 준비부터<br />결과 정리까지, 한 흐름으로.</h1>
            <p>운영계획서를 신청 폼으로 바꾸고, 흩어진 결과와 자유의견을 보고서에 쓸 수 있는 형태로 정리합니다.</p>
            <div className="login-benefits">
              <div><FileCheck2 size={21} /><span><b>반복 입력 줄이기</b>문서에서 신청 폼 초안을 만듭니다.</span></div>
              <div><BarChart3 size={21} /><span><b>결과 한눈에 보기</b>참여율과 만족도를 함께 봅니다.</span></div>
              <div><Clipboard size={21} /><span><b>근거까지 확인하기</b>요약과 원문을 나란히 검토합니다.</span></div>
            </div>
          </div>
          <div className="signin-panel">
            <span className="prototype-pill">부서 피드백용 프로토타입</span>
            <h2>{requestedFormId ? '신청서 응답하기' : '담당자 시작하기'}</h2>
            <p>{requestedFormId ? 'Google 로그인 후 공개된 신청서에 한 번만 응답할 수 있습니다.' : 'Google 계정으로 로그인하면 본인이 만든 폼만 수정하고 결과를 확인할 수 있습니다.'}</p>
            <button className="google-button" type="button" onClick={() => void login()} disabled={loginLoading || !firebaseConfigured}>
              {loginLoading ? <LoaderCircle className="spin" size={20} /> : <LogIn size={20} />}
              {loginLoading ? '로그인 정보를 확인하고 있습니다.' : 'Google로 로그인'}
            </button>
            {demoAuthEnabled && <button className="demo-login-button" type="button" onClick={demoLogin} disabled={loginLoading}><Sparkles size={17} /> 샘플 계정으로 둘러보기</button>}
            {authError && <StatusNotice tone="error"><b>{authError}</b></StatusNotice>}
            {!firebaseConfigured && <StatusNotice tone="error"><b>Firebase 환경 설정이 필요합니다.</b></StatusNotice>}
            <div className="security-note">
              <ShieldCheck size={18} />
              <span>Firebase Authentication으로 로그인하며, 샘플 계정에서는 실제 개인정보를 수집하지 않습니다.</span>
            </div>
            <div className="retention-note">
              <LockKeyhole size={16} /> 실제 서비스에서는 설문 종료 후 14일 보관 정책을 적용할 예정입니다.
            </div>
          </div>
        </section>
        <p className="login-footnote">DAEPUL FORM · 2026 FIRST PROTOTYPE</p>
      </main>
    )
  }

  if (respondentView) {
    return <RespondentExperience program={program} questions={questions} authUser={authUser} usingDemoAuth={usingDemoAuth} surveyEndDate={surveyEndDate} onBack={() => setRespondentView(false)} />
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <button className="brand-button" type="button" onClick={() => setStep('create')} aria-label="대플폼 홈">
            <span className="brand-mark small" aria-hidden="true">대</span>
            <span>대플폼</span>
            <span className="header-prototype">PROTOTYPE</span>
          </button>
          <div className="header-actions">
            <div className="demo-switch" aria-label="시연 상태 선택">
              <span>시연 상태</span>
              {(['normal', 'empty', 'failure'] as DemoMode[]).map((mode) => (
                <button key={mode} type="button" className={demoMode === mode ? 'active' : ''} onClick={() => handleDemoMode(mode)}>
                  {mode === 'normal' ? '정상' : mode === 'empty' ? '빈 입력' : '분석 실패'}
                </button>
              ))}
            </div>
            <button className="icon-text-button" type="button" onClick={resetAll}><RotateCcw size={16} /> 새로 시작</button>
            <div className="avatar" title={usingDemoAuth ? '샘플 로그인 사용자' : authUser?.email ?? 'Google 로그인 사용자'}>{usingDemoAuth ? '샘' : authUser?.displayName?.slice(0, 1) ?? 'G'}</div>
          </div>
        </div>
      </header>

      <nav className="step-nav" aria-label="작업 단계">
        <div className="step-nav-inner">
          {stepItems.map((item, index) => {
            const activeIndex = stepItems.findIndex((stepItem) => stepItem.id === step)
            const isActive = item.id === step
            const isComplete = activeIndex > index
            return (
              <button
                key={item.id}
                type="button"
                className={`step-item ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`}
                disabled={!canVisitStep(item.id)}
                onClick={() => setStep(item.id)}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className="step-number">{isComplete ? <Check size={14} /> : index + 1}</span>
                <span className="step-label"><span className="full-label">{item.label}</span><span className="short-label">{item.shortLabel}</span></span>
              </button>
            )
          })}
        </div>
      </nav>

      <main className="workspace">
        {step === 'create' && (
          <section>
            <SectionHeading
              eyebrow="01 · DOCUMENT TO FORM"
              title="운영계획서를 신청 폼으로 바꿔보세요"
              description="문서를 첨부하거나 간단한 초안을 입력하면 프로그램 정보와 질문 예시를 준비합니다."
            />
            <StatusNotice tone="info"><b>예시 분석 기능입니다.</b> 실제 문서 내용은 서버로 전송하거나 읽지 않으며, 파일명과 입력 여부를 확인해 가상 결과를 보여줍니다.</StatusNotice>
            <div className="two-column input-layout">
              <div className="panel upload-panel">
                <div className="panel-heading">
                  <div><span className="number-chip">1</span><h2>참고 문서</h2></div>
                  <span className="optional">PDF · DOCX · HWP · PNG</span>
                </div>
                <label
                  className={`dropzone ${files.length ? 'has-file' : ''} ${isDraggingFile ? 'is-dragging' : ''}`}
                  onDragEnter={(event) => { event.preventDefault(); setIsDraggingFile(true) }}
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={handleFileDrop}
                >
                  <input type="file" multiple accept=".pdf,.doc,.docx,.hwp,.hwpx,.png,image/png" onChange={handleFiles} />
                  {files.length || isDraggingFile ? <FileCheck2 size={30} /> : <Upload size={30} />}
                  <b>{isDraggingFile ? '여기에 놓으면 바로 첨부됩니다' : files.length ? `${files.length}개 문서가 준비되었습니다` : '파일을 선택하거나 여기에 놓아주세요'}</b>
                  <span>{isDraggingFile ? '마우스를 놓아 파일을 추가하세요.' : files.length ? files.join(' · ') : 'PDF, 문서 파일과 PNG 이미지를 여러 개 선택할 수 있습니다.'}</span>
                </label>
                <button className="text-button sample-button" type="button" onClick={loadSampleDocument}><Sparkles size={17} /> 샘플 운영계획서 사용</button>
              </div>
              <div className="panel draft-panel">
                <div className="panel-heading">
                  <div><span className="number-chip">2</span><h2>담당자 메모</h2></div>
                  <span className="optional">선택</span>
                </div>
                <label className="field-label" htmlFor="draft">문서에 없는 내용이나 강조할 점</label>
                <textarea id="draft" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="예: 재학생 2~4학년 대상, 30명 모집, 오프라인 진행" />
                <div className="helper-row"><span>{draft.length}/500자</span><span>실제 개인정보는 입력하지 마세요.</span></div>
              </div>
            </div>
            {documentError && <StatusNotice tone="error"><b>{documentError}</b>{documentStatus === 'error' && <button className="inline-action" type="button" onClick={() => { setDemoMode('normal'); analyzeDocument(true) }}><RefreshCcw size={14} /> 정상 모드로 다시 시도</button>}</StatusNotice>}
            {documentStatus === 'loading' && (
              <div className="analysis-progress" role="status">
                <LoaderCircle className="spin" size={28} />
                <div><b>문서에서 프로그램 정보를 찾고 있습니다.</b><span>프로그램 기본 정보와 신청 질문을 구성하는 중입니다.</span></div>
                <div className="progress-track"><span /></div>
              </div>
            )}
            <div className="page-actions right">
              <button className="primary-button" type="button" onClick={() => analyzeDocument()} disabled={documentStatus === 'loading'}>
                <WandSparkles size={18} /> 문서 분석하기 <ArrowRight size={18} />
              </button>
            </div>
          </section>
        )}

        {step === 'edit' && (
          <section>
            <SectionHeading
              eyebrow="02 · REVIEW & EDIT"
              title="추출된 정보와 질문을 확인해 주세요"
              description="틀리거나 빠진 내용은 바로 고칠 수 있습니다. 변경 내용은 이 브라우저에 임시 저장됩니다."
            />
            <StatusNotice tone="warning"><b>예시 분석 결과</b> 실제 AI 분석 결과가 아닙니다. 노란색 표시 항목과 질문을 담당자가 반드시 확인해 주세요.</StatusNotice>
            <div className="edit-layout">
              <div className="edit-main">
                <div className="panel">
                  <div className="panel-heading"><div><span className="number-chip">1</span><h2>프로그램 정보</h2></div><span className="saved-label"><Check size={14} /> 임시 저장됨</span></div>
                  <div className="form-grid">
                    {([
                      ['programName', '프로그램명', true],
                      ['description', '프로그램 목적', false],
                      ['target', '모집 대상', true],
                      ['period', '모집 기간', true],
                      ['schedule', '운영 일시', false],
                      ['capacity', '모집 인원', false],
                      ['requirements', '신청 조건', false],
                      ['privacyConsent', '개인정보 수집 동의', false],
                    ] as [keyof ProgramInfo, string, boolean][]).map(([field, label, required]) => (
                      <label key={field} className={field === 'description' || field === 'privacyConsent' ? 'span-2' : ''}>
                        <span className="field-label">{label}{required && <em>필수</em>}</span>
                        <input value={program[field]} onChange={(event) => updateProgram(field, event.target.value)} placeholder="직접 입력이 필요합니다." />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="panel questions-panel">
                  <div className="panel-heading"><div><span className="number-chip">2</span><h2>신청 질문</h2></div><span className="question-count">{questions.length}개</span></div>
                  <div className="question-list">
                    {questions.map((question, index) => (
                      <article className="question-editor" key={question.id}>
                        <div className="drag-controls">
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <button type="button" onClick={() => moveQuestion(index, -1)} disabled={index === 0} aria-label="위로 이동"><ArrowUp size={15} /></button>
                          <button type="button" onClick={() => moveQuestion(index, 1)} disabled={index === questions.length - 1} aria-label="아래로 이동"><ArrowDown size={15} /></button>
                        </div>
                        <div className="question-fields">
                          <input aria-label={`${index + 1}번 질문`} value={question.label} onChange={(event) => updateQuestion(question.id, { label: event.target.value })} />
                          <div className="question-options">
                            <label className="select-wrap"><select value={question.type} onChange={(event) => updateQuestion(question.id, { type: event.target.value as QuestionType })}>{Object.entries(questionTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={15} /></label>
                            <label className="toggle-label"><input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} /><span className="toggle" /> 필수</label>
                          </div>
                        </div>
                        <button className="delete-button" type="button" onClick={() => setQuestions((current) => current.filter((item) => item.id !== question.id))} aria-label={`${index + 1}번 질문 삭제`}><Trash2 size={17} /></button>
                      </article>
                    ))}
                  </div>
                  <button className="add-button" type="button" onClick={addQuestion}><Plus size={17} /> 질문 추가</button>
                </div>
              </div>
              <aside className="preview-card sticky-preview">
                <div className="preview-browser"><span /><span /><span /><b>신청 화면 미리보기</b></div>
                <FormPreview program={program} questions={questions} compact />
              </aside>
            </div>
            {formError && <StatusNotice tone="error"><b>{formError}</b></StatusNotice>}
            <div className="page-actions between">
              <button className="secondary-button" type="button" onClick={() => setStep('create')}><ArrowLeft size={18} /> 문서 다시 선택</button>
              <button className="primary-button" type="button" onClick={confirmForm} disabled={!formReady}>폼 미리보기 <ArrowRight size={18} /></button>
            </div>
          </section>
        )}

        {step === 'publish' && (
          <section>
            <SectionHeading
              eyebrow="03 · PREVIEW & SHARE"
              title="신청 폼이 준비되었습니다"
              description="참여자 화면을 마지막으로 확인하고 가상 링크와 QR코드를 부서 시연에 활용하세요."
            />
            <div className="publish-grid">
              <div className="preview-card full-preview">
                <div className="preview-browser"><span /><span /><span /><b>참여자 화면</b></div>
                <FormPreview program={program} questions={questions} />
              </div>
              <aside className="share-panel panel">
                <div className={`publish-status ${publishState}`}><span />{publishState === 'published' ? '가상 공개 상태' : '아직 공개되지 않음'}</div>
                <div className="qr-wrap">
                  {qrDataUrl ? <img src={qrDataUrl} alt="가상 신청 링크 QR코드" /> : <QrCode size={120} />}
                </div>
                <span className="example-badge">{usingDemoAuth ? '가상 링크 · 실제 외부 공개 아님' : 'Firebase 공개 링크'}</span>
                <label className="field-label" htmlFor="survey-end">설문 종료일</label>
                <input className="date-field" id="survey-end" type="date" value={surveyEndDate} onChange={(event) => setSurveyEndDate(event.target.value)} />
                <span className="deletion-date">데이터 삭제 예정일 · {deletionDateLabel}</span>
                <label className="field-label" htmlFor="virtual-link">신청 링크</label>
                <div className="copy-field"><input id="virtual-link" value={virtualLink} readOnly /><button type="button" onClick={() => void copyText(virtualLink, '가상 링크를 복사했습니다.')} aria-label="링크 복사"><Copy size={17} /></button></div>
                <div className="share-actions">
                  <button className="secondary-button" type="button" onClick={() => qrDataUrl && downloadDataUrl(qrDataUrl, '대플폼_가상_QR코드.png')} disabled={!qrDataUrl}><Download size={17} /> QR 저장</button>
                  <button className="primary-button" type="button" onClick={() => void publishForm()} disabled={publishLoading || !surveyEndDate}>{publishLoading ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />} {usingDemoAuth ? '가상 배포하기' : 'Firebase에 배포'}</button>
                </div>
                <button className="respondent-test-button" type="button" onClick={() => setRespondentView(true)} disabled={publishState !== 'published'}><Users size={17} /> 응답자 화면 체험</button>
                {publishError && <StatusNotice tone="error"><b>{publishError}</b></StatusNotice>}
                <StatusNotice tone="info">{usingDemoAuth ? '샘플 계정에서는 링크와 QR코드가 시연용이며 실제 신청 데이터가 수집되지 않습니다.' : '공개 링크는 로그인한 사용자에게만 열리며 Firestore 보안 규칙이 소유권과 중복 제출을 검사합니다.'}</StatusNotice>
                <div className="permission-summary">
                  <b><ShieldCheck size={16} /> 권한·중복 제출 정책</b>
                  <span>제작자 UID <code>{authUser?.uid ?? demoCreatorUid}</code>만 이 폼의 결과를 확인합니다.</span>
                  <span>응답은 폼 ID + 가상 사용자 UID 조합으로 한 번만 제출됩니다.</span>
                  <span>종료 후 14일이 지나면 관련 데이터를 영구 삭제하는 정책입니다.</span>
                </div>
                <div className="next-action-card"><span>다음 행동</span><b>프로그램 종료 후 결과를 분석해 보세요.</b><button type="button" onClick={() => setStep('results')}>결과 데이터 분석 <ArrowRight size={16} /></button></div>
              </aside>
            </div>
            <div className="page-actions between"><button className="secondary-button" type="button" onClick={() => setStep('edit')}><ArrowLeft size={18} /> 폼 수정</button><button className="primary-button" type="button" onClick={() => setStep('results')}>결과 분석으로 <ArrowRight size={18} /></button></div>
          </section>
        )}

        {step === 'results' && (
          <section>
            <SectionHeading
              eyebrow="04 · RESULT INSIGHT"
              title="프로그램 결과를 한눈에 정리하세요"
              description="가상 수치와 자유응답을 불러와 통계, 확인 항목, 보고서 후보 문장을 함께 검토합니다."
            />
            <StatusNotice tone="info"><b>가상 데이터 · 예시 AI 분석 결과</b> 실제 개인정보나 부서 원본 자료를 사용하지 않습니다.</StatusNotice>
            <div className="result-input panel">
              <div className="panel-heading"><div><span className="number-chip">1</span><h2>결과 데이터 입력</h2></div><button className="text-button" type="button" onClick={loadSampleResults}><Sparkles size={16} /> 샘플 데이터 사용</button></div>
              <div className="stats-input-grid">
                <label><span className="field-label">신청 인원</span><input type="number" min="0" value={stats.applicants} onChange={(event) => setStats((current) => ({ ...current, applicants: Number(event.target.value) }))} /></label>
                <label><span className="field-label">실제 참여 인원</span><input type="number" min="0" value={stats.participants} onChange={(event) => setStats((current) => ({ ...current, participants: Number(event.target.value) }))} /></label>
                <label><span className="field-label">만족도 응답 인원</span><input type="number" min="0" value={stats.satisfactionResponses} onChange={(event) => setStats((current) => ({ ...current, satisfactionResponses: Number(event.target.value) }))} /></label>
                <label><span className="field-label">만족도 평균</span><input value={satisfactionAverage ? satisfactionAverage.toFixed(1) : '샘플 사용 시 계산'} readOnly /></label>
              </div>
              <label className="responses-field"><span className="field-label">만족도 자유응답 <em>한 줄에 한 개</em></span><textarea value={responsesText} onChange={(event) => setResponsesText(event.target.value)} placeholder="자유응답을 한 줄에 하나씩 입력해 주세요." /></label>
              <div className="helper-row"><span>{responses.length}개 응답</span><span>이름·학번 등 개인정보는 입력하지 마세요.</span></div>
              <div className="page-actions right"><button className="primary-button" type="button" onClick={() => analyzeResults()} disabled={resultStatus === 'loading'}>{resultStatus === 'loading' ? <LoaderCircle className="spin" size={18} /> : <WandSparkles size={18} />} 분석 시작</button></div>
            </div>
            {resultError && <StatusNotice tone="error"><b>{resultError}</b>{resultStatus === 'error' && <button className="inline-action" type="button" onClick={() => { setDemoMode('normal'); analyzeResults(true) }}><RefreshCcw size={14} /> 정상 모드로 다시 분석</button>}</StatusNotice>}
            {resultStatus === 'loading' && <div className="analysis-progress"><LoaderCircle className="spin" size={28} /><div><b>결과를 정리하고 있습니다.</b><span>통계를 계산하고 자유응답을 주제별로 묶는 중입니다.</span></div><div className="progress-track"><span /></div></div>}
            {topics.length > 0 && resultStatus !== 'loading' && (
              <ResultDashboard
                stats={stats}
                topics={topics}
                responses={responses}
                excludedSources={excludedSources}
                onToggleExcluded={toggleExcludedSource}
                onUpdateTopic={updateTopic}
                participationRate={participationRate}
                satisfactionAverage={satisfactionAverage}
                noShowCount={noShowCount}
              />
            )}
            <div className="page-actions between">
              <button className="secondary-button" type="button" onClick={() => setStep('publish')}><ArrowLeft size={18} /> 폼 화면</button>
              <button className="primary-button" type="button" onClick={() => setStep('export')} disabled={!topics.length}>문장 선택·내보내기 <ArrowRight size={18} /></button>
            </div>
          </section>
        )}

        {step === 'export' && (
          <section>
            <SectionHeading
              eyebrow="05 · EXPORT"
              title="확인한 결과만 골라 내보내세요"
              description="보고서에 반영할 문장을 마지막으로 검토하고 복사하거나 엑셀 파일로 저장합니다."
            />
            <StatusNotice tone="warning"><b>사람의 최종 확인이 필요합니다.</b> 예시 분석 결과와 원문 근거가 일치하는지 확인한 뒤 사용하세요.</StatusNotice>
            <div className="export-grid">
              <div className="panel">
                <div className="panel-heading"><div><span className="number-chip">1</span><h2>보고서 반영 문장 선택</h2></div><span className="question-count">{selectedTopics.length}/{topics.length} 선택</span></div>
                <div className="export-sentences">
                  {topics.map((topic) => (
                    <label key={topic.id} className={`export-option ${selectedTopics.includes(topic.id) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={selectedTopics.includes(topic.id)} onChange={() => toggleSelectedTopic(topic.id)} />
                      <span className="custom-check"><Check size={14} /></span>
                      <span><b>{topic.title}</b>{topic.reportSentence}</span>
                    </label>
                  ))}
                </div>
              </div>
              <aside className="panel export-preview">
                <div className="panel-heading"><div><span className="number-chip">2</span><h2>내보내기 미리보기</h2></div></div>
                <div className="report-paper">
                  <span>2026 하계 진로 멘토링</span>
                  <h3>운영 결과 주요 의견</h3>
                  {selectedReportText ? selectedReportText.split('\n').map((line) => <p key={line}>{line}</p>) : <p className="muted">내보낼 문장을 한 개 이상 선택해 주세요.</p>}
                </div>
                <div className="export-actions">
                  <button className="secondary-button" type="button" disabled={!selectedReportText} onClick={() => void copyText(selectedReportText, '보고서 후보 문장을 복사했습니다.')}><Copy size={17} /> 문장 복사</button>
                  <button className="primary-button" type="button" disabled={!selectedReportText} onClick={exportWorkbook}><Download size={17} /> 엑셀 저장</button>
                </div>
                <div className="next-action-list"><b>저장 전 확인할 항목</b><span><CheckCircle2 size={16} /> 통계 수치와 원본 데이터 일치 여부</span><span><CheckCircle2 size={16} /> 요약 문장과 근거 원문 일치 여부</span><span><AlertCircle size={16} /> 이름 불일치 1건 담당자 확인</span></div>
              </aside>
            </div>
            <div className="page-actions between"><button className="secondary-button" type="button" onClick={() => setStep('results')}><ArrowLeft size={18} /> 분석 결과 수정</button><button className="primary-button" type="button" onClick={resetAll}><Plus size={18} /> 새 프로그램 시작</button></div>
          </section>
        )}
      </main>
      <footer className="app-footer"><span>대플폼 · 부서 피드백용 첫 프로토타입</span><span>Google 로그인·Firebase 저장 지원 · AI 분석은 예시 결과</span></footer>
      {toast && <div className="toast" role="status"><CheckCircle2 size={18} /> {toast}</div>}
    </div>
  )
}

function FormPreview({ program, questions, compact = false }: { program: ProgramInfo; questions: FormQuestion[]; compact?: boolean }) {
  return (
    <div className={`form-preview ${compact ? 'compact' : ''}`}>
      <div className="form-cover"><span className="form-tag">진로 · 취업 프로그램</span><h2>{program.programName || '프로그램명을 입력해 주세요'}</h2><p>{program.description || '프로그램 안내 문구가 여기에 표시됩니다.'}</p></div>
      <div className="form-meta"><span><b>모집 대상</b>{program.target || '—'}</span><span><b>신청 기간</b>{program.period || '—'}</span><span><b>운영 일시</b>{program.schedule || '—'}</span></div>
      <div className="preview-questions">
        {questions.length ? questions.slice(0, compact ? 4 : questions.length).map((question, index) => (
          <label key={question.id}><span>{index + 1}. {question.label}{question.required && <em>*</em>}</span>{question.type === 'long_text' ? <textarea readOnly placeholder="답변을 입력해 주세요." /> : question.type === 'select' ? <select disabled><option>선택해 주세요</option></select> : question.type === 'consent' || question.type === 'checkbox' ? <span className="preview-checkbox"><input type="checkbox" disabled /> 동의합니다</span> : <input readOnly placeholder="답변을 입력해 주세요." />}</label>
        )) : <div className="empty-preview">질문을 한 개 이상 추가해 주세요.</div>}
        {compact && questions.length > 4 && <span className="more-questions">+ 질문 {questions.length - 4}개 더 보기</span>}
      </div>
      {!compact && <button className="preview-submit" type="button" onClick={() => undefined}>신청서 제출</button>}
    </div>
  )
}

function RespondentExperience({
  program,
  questions,
  authUser,
  usingDemoAuth,
  surveyEndDate,
  onBack,
}: {
  program: ProgramInfo
  questions: FormQuestion[]
  authUser: FirebaseUser | null
  usingDemoAuth: boolean
  surveyEndDate: string
  onBack: () => void
}) {
  const [loggedIn, setLoggedIn] = useState(usingDemoAuth || Boolean(authUser))
  const [loginLoading, setLoginLoading] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [alreadySubmitted, setAlreadySubmitted] = useState(() => usingDemoAuth && Boolean(window.localStorage.getItem(demoSubmissionKey)))
  const [answers, setAnswers] = useState<Record<number, string | boolean>>({})
  const [submitError, setSubmitError] = useState('')
  const responderUid = authUser?.uid ?? demoResponderUid

  useEffect(() => {
    if (usingDemoAuth || !authUser) return
    void hasSubmittedResponse(demoFormId, authUser.uid)
      .then(setAlreadySubmitted)
      .catch(() => setSubmitError('제출 이력을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'))
  }, [authUser, usingDemoAuth])

  const responderLogin = async () => {
    setLoginLoading(true)
    try {
      await signInWithGoogle()
      setLoggedIn(true)
    } catch {
      setSubmitError('Google 로그인에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setLoginLoading(false)
    }
  }

  const submitResponse = async () => {
    const missing = questions.find((question) => question.required && !answers[question.id])
    if (missing) {
      setSubmitError(`필수 질문을 확인해 주세요: ${missing.label}`)
      return
    }
    setSubmitLoading(true)
    try {
      if (usingDemoAuth) {
        window.localStorage.setItem(demoSubmissionKey, JSON.stringify({
          formId: demoFormId,
          userUid: demoResponderUid,
          submittedAt: new Date().toISOString(),
          answers,
          immutable: true,
        }))
      } else {
        if (!authUser) throw new Error('auth-required')
        await submitResponseOnce({ formId: demoFormId, user: authUser, answers, surveyEndDate })
      }
      setAlreadySubmitted(true)
      setSubmitError('')
    } catch (error) {
      setSubmitError(error instanceof Error && error.message === 'already-submitted' ? '이미 제출한 폼입니다.' : '응답을 제출하지 못했습니다. 로그인 상태와 공개 기간을 확인해 주세요.')
    } finally {
      setSubmitLoading(false)
    }
  }

  if (!loggedIn) {
    return (
      <main className="respondent-shell">
        <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={17} /> 제작자 화면으로</button>
        <section className="respondent-login panel">
          <div className="brand-mark" aria-hidden="true">대</div>
          <span className="prototype-pill">응답자용 가상 로그인</span>
          <h1>신청 전에 Google 로그인이 필요합니다</h1>
          <p>공개된 폼도 로그인한 사용자만 응답할 수 있으며, 같은 계정은 한 번만 제출할 수 있습니다.</p>
          <button className="google-button" type="button" onClick={() => void responderLogin()} disabled={loginLoading}>{loginLoading ? <LoaderCircle className="spin" size={19} /> : <LogIn size={19} />}{loginLoading ? '로그인 정보를 확인하고 있습니다.' : 'Google로 로그인하고 응답하기'}</button>
          {submitError && <StatusNotice tone="error"><b>{submitError}</b></StatusNotice>}
          <div className="security-note"><ShieldCheck size={18} /><span>Firebase Authentication UID로 로그인 상태와 중복 제출 여부를 확인합니다.</span></div>
        </section>
      </main>
    )
  }

  if (alreadySubmitted) {
    return (
      <main className="respondent-shell">
        <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={17} /> 제작자 화면으로</button>
        <section className="submitted-card panel">
          <div className="submitted-icon"><CheckCircle2 size={31} /></div>
          <span className="eyebrow">SUBMISSION COMPLETE</span>
          <h1>이미 제출한 폼입니다</h1>
          <p>이 Google 계정으로 제출한 응답이 있습니다. 제출된 응답은 응답자가 임의로 수정하거나 삭제할 수 없습니다.</p>
          <div className="submission-key"><span>중복 확인 기준</span><code>{demoFormId} + {responderUid}</code></div>
          <StatusNotice tone="info">응답 및 분석 데이터는 설문 종료 후 14일이 지나면 서버에서 모두 영구 삭제되는 정책입니다.</StatusNotice>
          <button className="primary-button" type="button" onClick={onBack}>제작자 화면으로 돌아가기</button>
        </section>
      </main>
    )
  }

  return (
    <main className="respondent-shell respondent-form-shell">
      <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={17} /> 제작자 화면으로</button>
      <section className="public-form">
        <div className="public-form-identity"><span className="brand-mark small">대</span><span><b>대플폼</b><small>가상 Google 계정으로 로그인됨</small></span></div>
        <div className="form-cover"><span className="form-tag">진로 · 취업 프로그램</span><h1>{program.programName}</h1><p>{program.description}</p></div>
        <div className="form-meta"><span><b>모집 대상</b>{program.target}</span><span><b>신청 기간</b>{program.period}</span><span><b>운영 일시</b>{program.schedule}</span></div>
        <div className="public-questions">
          {questions.map((question, index) => (
            <label key={question.id}>
              <span>{index + 1}. {question.label}{question.required && <em>*</em>}</span>
              {question.type === 'long_text' ? (
                <textarea value={String(answers[question.id] ?? '')} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="답변을 입력해 주세요." />
              ) : question.type === 'select' ? (
                <select value={String(answers[question.id] ?? '')} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}><option value="">선택해 주세요</option><option>2학년</option><option>3학년</option><option>4학년</option></select>
              ) : question.type === 'consent' || question.type === 'checkbox' ? (
                <span className="public-checkbox"><input type="checkbox" checked={Boolean(answers[question.id])} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.checked }))} /> 개인정보 수집 및 이용에 동의합니다.</span>
              ) : (
                <input value={String(answers[question.id] ?? '')} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="답변을 입력해 주세요." />
              )}
            </label>
          ))}
          {submitError && <StatusNotice tone="error"><b>{submitError}</b></StatusNotice>}
          <button className="public-submit" type="button" onClick={() => void submitResponse()} disabled={submitLoading}>{submitLoading ? '제출하고 있습니다.' : '신청서 제출'}</button>
          <p className="immutable-note"><LockKeyhole size={14} /> 제출 후에는 응답을 수정하거나 삭제할 수 없습니다.</p>
        </div>
      </section>
    </main>
  )
}

function ResultDashboard({
  stats,
  topics,
  responses,
  excludedSources,
  onToggleExcluded,
  onUpdateTopic,
  participationRate,
  satisfactionAverage,
  noShowCount,
}: {
  stats: ResultStats
  topics: ResponseTopic[]
  responses: string[]
  excludedSources: number[]
  onToggleExcluded: (sourceId: number) => void
  onUpdateTopic: (id: string, changes: Partial<ResponseTopic>) => void
  participationRate: number
  satisfactionAverage: number
  noShowCount: number
}) {
  const scoreDistribution = [1, 2, 3, 4, 5].map((score) => stats.satisfactionScores.filter((item) => item === score).length)
  const maxScoreCount = Math.max(...scoreDistribution, 1)
  const maxTopicCount = Math.max(...topics.map((topic) => topic.sourceIds.length), 1)

  return (
    <div className="dashboard-results">
      <div className="result-title-row"><div><span className="number-chip">2</span><h2>통합 결과 대시보드</h2></div><span className="example-badge">예시 분석 결과</span></div>
      <div className="stat-cards">
        <article><Users size={20} /><span>전체 신청</span><b>{stats.applicants}<small>명</small></b></article>
        <article><CheckCircle2 size={20} /><span>실제 참여</span><b>{stats.participants}<small>명</small></b></article>
        <article className="attention"><AlertCircle size={20} /><span>미참여</span><b>{noShowCount}<small>명</small></b></article>
        <article><BarChart3 size={20} /><span>참여율</span><b>{participationRate.toFixed(1)}<small>%</small></b></article>
        <article><Clipboard size={20} /><span>만족도 응답</span><b>{stats.satisfactionResponses}<small>명</small></b></article>
        <article><Sparkles size={20} /><span>만족도 평균</span><b>{satisfactionAverage.toFixed(1)}<small>/5</small></b></article>
        <article><FileText size={20} /><span>자유응답</span><b>{responses.length}<small>개</small></b></article>
      </div>
      <div className="chart-grid">
        <article className="panel chart-panel">
          <div className="chart-heading"><span><b>신청·참여 비교</b>참여율 {participationRate.toFixed(1)}%</span><LayoutDashboard size={20} /></div>
          <div className="horizontal-bars"><div><span>신청</span><i><b style={{ width: '100%' }} /></i><strong>{stats.applicants}</strong></div><div><span>참여</span><i><b style={{ width: `${participationRate}%` }} /></i><strong>{stats.participants}</strong></div></div>
          <div className="donut-row"><div className="donut" style={{ '--rate': `${participationRate * 3.6}deg` } as React.CSSProperties}><span>{participationRate.toFixed(1)}<small>%</small></span></div><div><b>높은 참여율</b><p>신청자 28명 중 24명이 실제 프로그램에 참여했습니다.</p></div></div>
        </article>
        <article className="panel chart-panel">
          <div className="chart-heading"><span><b>만족도 점수 분포</b>응답 {stats.satisfactionResponses}명</span><BarChart3 size={20} /></div>
          <div className="vertical-chart">{scoreDistribution.map((count, index) => <div key={index}><span>{count || ''}</span><i><b style={{ height: `${(count / maxScoreCount) * 100}%` }} /></i><small>{index + 1}점</small></div>)}</div>
        </article>
      </div>
      <div className="panel attendance-panel">
        <div className="panel-heading"><div><span className="number-chip">3</span><h2>신청자·출석자 확인</h2></div><span className="warning-badge"><AlertCircle size={14} /> 확인 필요 1건</span></div>
        <div className="table-wrap"><table><thead><tr><th>신청자</th><th>신청 여부</th><th>출석 여부</th><th>상태</th><th>다음 행동</th></tr></thead><tbody>{sampleAttendance.map((row) => <tr key={row.name}><td><b>{row.name}</b></td><td>신청</td><td>{row.attended === null ? '이름 불일치' : row.attended ? '출석' : '미출석'}</td><td><span className={`status-badge ${row.status === '참여' ? 'ok' : row.status === '미참여' ? 'neutral' : 'check'}`}>{row.status}</span></td><td>{row.status === '확인 필요' ? <button className="table-action" type="button">원본 명단 확인</button> : '—'}</td></tr>)}</tbody></table></div>
      </div>
      <div className="topics-heading"><div><span className="number-chip">4</span><h2>자유응답 주제별 분석</h2></div><p>주제명과 보고서 문장을 수정할 수 있습니다. 근거로 쓰지 않을 원문은 제외하세요.</p></div>
      <div className="topic-chart panel"><b>주제별 관련 응답 수</b><div>{topics.map((topic) => { const count = topic.sourceIds.filter((id) => !excludedSources.includes(id)).length; return <span key={topic.id}><em>{topic.title}</em><i><b style={{ width: `${(count / maxTopicCount) * 100}%` }} /></i><strong>{count}개</strong></span> })}</div></div>
      <div className="topic-list">
        {topics.map((topic) => {
          const activeSources = topic.sourceIds.filter((id) => !excludedSources.includes(id))
          return (
            <article className="topic-card" key={topic.id}>
              <div className="topic-card-head"><span className={`category category-${topic.id}`}>{topic.category}</span><span>{activeSources.length}개 응답</span></div>
              <label className="editable-title"><input value={topic.title} onChange={(event) => onUpdateTopic(topic.id, { title: event.target.value })} aria-label="주제명 수정" /><span>주제명 수정 가능</span></label>
              <p className="topic-summary">{topic.summary}</p>
              <details className="sources" open={topic.id === 'experience'}><summary>근거 원문 {topic.sourceIds.length}개 확인 <ChevronDown size={16} /></summary><div>{topic.sourceIds.map((sourceId) => <label key={sourceId} className={excludedSources.includes(sourceId) ? 'excluded' : ''}><input type="checkbox" checked={!excludedSources.includes(sourceId)} onChange={() => onToggleExcluded(sourceId)} /><span><b>원문 {sourceId + 1}</b>{responses[sourceId]}</span><em>{excludedSources.includes(sourceId) ? '제외됨' : '요약에 포함'}</em></label>)}</div></details>
              <label className="report-sentence"><span><Clipboard size={16} /> 결과보고서 반영 후보</span><textarea value={topic.reportSentence} onChange={(event) => onUpdateTopic(topic.id, { reportSentence: event.target.value })} /></label>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  anchor.click()
}

function fallbackCopyText(value: string) {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Copy command failed')
}

function createExcelWorkbook(sheets: Array<[string, Array<Array<string | number>>]>) {
  const worksheets = sheets.map(([name, rows]) => {
    const tableRows = rows.map((row, rowIndex) => `<Row>${row.map((value) => {
      const type = typeof value === 'number' ? 'Number' : 'String'
      const style = rowIndex === 0 ? ' ss:StyleID="Header"' : ''
      return `<Cell${style}><Data ss:Type="${type}">${escapeXml(String(value))}</Data></Cell>`
    }).join('')}</Row>`).join('')
    return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${tableRows}</Table></Worksheet>`
  }).join('')
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#DDEFE9" ss:Pattern="Solid"/></Style></Styles>${worksheets}</Workbook>`
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export default App
