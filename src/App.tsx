import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from 'react'
import { ArrowDown, ArrowUp, BarChart3, CalendarClock, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, CloudUpload, Copy, Download, Eye, FileText, Flower2, GraduationCap, GripVertical, Heart, House, ImagePlus, Leaf, LayoutDashboard, Link2, LoaderCircle, LogIn, LogOut, Palette, Plus, QrCode, RefreshCcw, Send, Snowflake, Sparkles, Sun, Trash2, TriangleAlert, Upload, WandSparkles, Waves, X } from 'lucide-react'
import QRCode from 'qrcode'
import writeXlsxFile, { type SheetData } from 'write-excel-file/browser'
import kangnamPromotionBar from './assets/kangnam-promotion-bar.png'
import kangnamUniversityLogo from './assets/kangnam-university-logo-transparent.png'
import kangnamWelcomeMascot from './assets/kangnam-welcome-mascot.png'
import {
  aiFailureMessage, completeEmailSignIn, deleteFormRecord, deleteResponseDraft, discardEmailSignInLink, firebaseConfigured, generateFormFromDocuments,
  emptyDeletedForms, getDeletedForms, getFormDeliveryStatus, getFormVersions, getOwnResponse, getOwnedForms, getPendingEmailAddress, getPublicResultSummary, getPublishedForm, hasEmailSignInLink,
  hasSubmittedResponse, loadResponseDraft, loginFailureMessage, logout, observeAuthState, publishFormRecord, requestEmailSignInLink,
  manageFormResponses, queryFormResponses, restoreFormRecord, retryFormDelivery, saveAnalysisRecord, saveResponseDraft, setFormCollaborator, signInAsGuest, signInWithGoogle, summarizeResponses,
  submitResponseOnce, updateFormLifecycle, updateFormSchedule, updateOwnResponse, uploadFormImage, uploadResponseAttachment, type FirebaseUser, type LoginProvider,
} from './firebase'
import { defaultFormSettings, type AnswerValue, type FormQuestion, type FormSettings, type FormType, type ProgramInfo, type QuestionSummary, type QuizResult, type ResponseAttachment, type ResponsePage, type ResponseQuery, type StoredFormResponse } from './types'
import { ResultsDashboard } from './features/responses/ResultsDashboard'
import { FormPolicyEditor } from './features/responses/FormPolicyEditor'
import { createSampleResponses, getFormAvailability, normalizeFormSettings, settingsFromAiSuggestion, validateAnswers } from './features/responses/model'

type Page = 'create' | 'edit' | 'publish' | 'results' | 'manage'
type CreationMode = 'ai' | 'manual'
type Theme = 'green' | 'spring' | 'summer' | 'autumn' | 'winter' | 'kangnam' | 'blue' | 'coral'
type SelectableTheme = Exclude<Theme, 'blue' | 'coral'>
type OwnedForm = { id: string; title: string; published: boolean; responseCount: number; status?: string; startsAt?: string; closesAt?: string; maxResponses?: number; publicSlug?: string; organizationShared?: boolean; workspaceName?: string; ownerEmail?: string }
type DeletedForm = { id: string; title: string; deletedAt: string }
type EmailLinkMode = 'none' | 'checking' | 'needs-email'
type SubmissionStatus = 'checking' | 'ready' | 'submitted-now' | 'already-submitted' | 'check-error'
type PublicAnswerValue = string | boolean | number | string[]

const emptyProgram: ProgramInfo = { programName: '', description: '', target: '', period: '', schedule: '', capacity: '', requirements: '', privacyConsent: '' }
const serviceSampleProgram: ProgramInfo = { programName: '2026 강남대학교 진로 프로그램 만족도 조사', description: '참여 경험을 바탕으로 다음 프로그램을 더 알차게 만들기 위한 예시 폼입니다.', target: '강남대학교 재학생', period: '2026. 7. 1. ~ 7. 31.', schedule: '', capacity: '', requirements: '', privacyConsent: '' }
const serviceSampleQuestions: FormQuestion[] = [
  { id: 9001, label: '프로그램을 어떻게 알게 되었나요?', type: 'select', required: true, options: ['교내 공지', '친구 추천', '교수·직원 안내', 'SNS'] },
  { id: 9002, label: '프로그램 전반에 얼마나 만족하셨나요?', type: 'rating', required: true },
  { id: 9003, label: '가장 도움이 된 내용을 선택해 주세요.', type: 'checkbox', required: false, options: ['진로 탐색', '취업 준비', '현직자 멘토링', '실습 활동'] },
  { id: 9004, label: '다음 프로그램을 위한 의견을 남겨 주세요.', type: 'long_text', required: false },
]
const typeLabels = { short_text: '단답형', long_text: '장문형', select: '객관식', checkbox: '체크박스', consent: '개인정보 동의', rating: '1~5점 평점', number: '숫자', file: '파일 업로드' }
const legacyQuestionPlaceholders = new Set(['질문을 입력해 주세요', '새 질문'])
const editableQuestionLabel = (label: string) => legacyQuestionPlaceholders.has(label.trim()) ? '' : label
const editableOptionLabel = (label: string) => /^선택지 \d+$/.test(label.trim()) ? '' : label
const draftStorageKey = 'daepul-form-creator-draft'
const selectableThemes: Array<{ id: SelectableTheme; label: string; description: string }> = [
  { id: 'green', label: '기본 디자인', description: '단정하고 편안한 기본 폼' },
  { id: 'spring', label: '봄', description: '벚꽃과 새싹의 화사함' },
  { id: 'summer', label: '여름', description: '햇살과 바다의 청량함' },
  { id: 'autumn', label: '가을', description: '단풍과 노을의 따뜻함' },
  { id: 'winter', label: '겨울', description: '눈꽃과 새벽의 고요함' },
  { id: 'kangnam', label: '강남대학교', description: '강남대 로고와 교색을 적용한 공식형' },
]

function normalizeTheme(value: string): Theme {
  return ['green', 'spring', 'summer', 'autumn', 'winter', 'kangnam', 'blue', 'coral'].includes(value) ? value as Theme : 'green'
}

function normalizeSelectableTheme(value: string): SelectableTheme {
  const theme = normalizeTheme(value)
  return theme === 'blue' || theme === 'coral' ? 'green' : theme
}

type CreatorDraft = {
  memo: string
  program: ProgramInfo
  questions: FormQuestion[]
  formType: FormType
  theme: Theme
  endDate: string
  settings: FormSettings
}

function getCreatorDraft(): Partial<CreatorDraft> {
  try {
    return JSON.parse(localStorage.getItem(draftStorageKey) ?? '{}') as Partial<CreatorDraft>
  } catch {
    return {}
  }
}

function toPublicAnswer(value: AnswerValue | undefined): PublicAnswerValue {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && !Array.isArray(value)) return JSON.stringify(value)
  return value
}

function answerForExcel(value: AnswerValue | undefined) {
  if (value === true) return '동의'
  if (value === false) return '미동의'
  if (Array.isArray(value)) return value.join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return value ?? ''
}

async function exportResponsesToExcel(title: string, questions: FormQuestion[], responses: StoredFormResponse[], summaries: QuestionSummary[]) {
  const responseRows: SheetData = [
    ['응답 번호', ...questions.map((question) => question.label)],
    ...responses.map((response, index) => [index + 1, ...questions.map((question) => answerForExcel(response.answers[String(question.id)]))]),
  ]
  const summaryRows: SheetData = [['질문', '유형', '응답 수', '평균', '항목', '개수', '비율']]
  summaries.forEach((summary) => {
    if (summary.distribution?.length) summary.distribution.forEach((item) => summaryRows.push([
      summary.label, typeLabels[summary.type], summary.responseCount, summary.average ?? '', item.label, item.count,
      summary.responseCount ? `${(item.count / summary.responseCount * 100).toFixed(1)}%` : '0%',
    ]))
    else summaryRows.push([summary.label, typeLabels[summary.type], summary.responseCount, summary.average ?? '', '', '', ''])
  })

  const safeTitle = (title || '대플폼').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  await writeXlsxFile([
    { data: responseRows, sheet: '응답 원본', columns: [{ width: 12 }, ...questions.map((question) => ({ width: Math.min(Math.max(question.label.length + 4, 16), 40) }))], stickyRowsCount: 1 },
    { data: summaryRows, sheet: '통계 요약', columns: [{ width: 32 }, { width: 16 }, { width: 12 }, { width: 12 }, { width: 24 }, { width: 10 }, { width: 12 }], stickyRowsCount: 1 },
  ]).toFile(`${safeTitle}_응답결과.xlsx`)
}

function newFormId() {
  return `form-${crypto.randomUUID().slice(0, 8)}`
}
async function copyQrImage(dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob()
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('clipboard-unavailable')
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
  } catch {
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = 'daepul-form-QR.png'
    link.click()
  }
}

async function sharePublicForm(title: string, url: string) {
  if (navigator.share) {
    await navigator.share({ title, text: `${title} 응답에 참여해 주세요.`, url })
    return
  }
  await navigator.clipboard.writeText(url)
}

function analyzeStoredResponses(questions: FormQuestion[], responses: StoredFormResponse[]): QuestionSummary[] {
  return questions.map((question) => {
    const values = responses.map((response) => response.answers[String(question.id)]).filter((value) => value !== undefined && value !== '' && value !== false && (!Array.isArray(value) || value.length > 0))
    if (question.type === 'rating' || question.type === 'number') {
      const numbers = values.map(Number).filter(Number.isFinite)
      const labels = question.type === 'rating' ? ['1', '2', '3', '4', '5'] : [...new Set(numbers.map(String))].sort((a, b) => Number(a) - Number(b))
      return { questionId: question.id, label: question.label, type: question.type, responseCount: numbers.length, average: numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0, distribution: labels.map((label) => ({ label, count: numbers.filter((number) => String(number) === label).length })) }
    }
    if (question.type === 'select' || question.type === 'checkbox' || question.type === 'consent') {
      const labels = question.options?.length ? question.options : question.type === 'select' ? [...new Set(values.map(String))] : ['동의']
      const expanded = values.flatMap((value) => Array.isArray(value) ? value : [value])
      return { questionId: question.id, label: question.label, type: question.type, responseCount: values.length, distribution: labels.map((label) => ({ label, count: expanded.filter((value) => String(value) === label || (label === '동의' && value === true)).length })) }
    }
    return { questionId: question.id, label: question.label, type: question.type, responseCount: values.length, texts: values.map(String) }
  })
}

export default function App() {
  const initialDraft = useMemo(getCreatorDraft, [])
  const requestedFormId = useMemo(() => new URLSearchParams(location.search).get('form'), [])
  const requestedPreview = useMemo(() => new URLSearchParams(location.search).get('preview') === '1', [])
  const requestedLogin = useMemo(() => new URLSearchParams(location.search).get('login') === '1', [])
  const requestedPublicResults = useMemo(() => new URLSearchParams(location.search).get('results') === '1', [])
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  const [loginProvider, setLoginProvider] = useState<LoginProvider | null>(null)
  const [emailLinkMode, setEmailLinkMode] = useState<EmailLinkMode>(() => hasEmailSignInLink() ? 'checking' : 'none')
  const [page, setPage] = useState<Page>('create')
  const [creationMode, setCreationMode] = useState<CreationMode>('ai')
  const [menuOpen, setMenuOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [memo, setMemo] = useState(initialDraft.memo ?? '')
  const [dragging, setDragging] = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [reviewNotes, setReviewNotes] = useState<string[]>([])
  const [program, setProgram] = useState<ProgramInfo>(initialDraft.program ?? emptyProgram)
  const [questions, setQuestions] = useState<FormQuestion[]>(initialDraft.questions ?? [])
  const [formType, setFormType] = useState<FormType>(initialDraft.formType ?? 'general')
  const [theme, setTheme] = useState<Theme>(normalizeSelectableTheme(String(initialDraft.theme ?? 'green')))
  const [formId, setFormId] = useState(newFormId)
  const [endDate, setEndDate] = useState(initialDraft.endDate ?? '2026-07-31')
  const [formSettings, setFormSettings] = useState<FormSettings>(normalizeFormSettings(initialDraft.settings ?? defaultFormSettings))
  const [published, setPublished] = useState(false)
  const [publishLoading, setPublishLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [responses, setResponses] = useState<StoredFormResponse[]>([])
  const [responsePage, setResponsePage] = useState<ResponsePage>()
  const [sampleResults, setSampleResults] = useState(false)
  const [resultLoading, setResultLoading] = useState(false)
  const [ownedForms, setOwnedForms] = useState<OwnedForm[]>([])
  const [deletedForms, setDeletedForms] = useState<DeletedForm[]>([])
  const [deletingFormId, setDeletingFormId] = useState('')
  const [emptyingTrash, setEmptyingTrash] = useState(false)
  const [shareFormId, setShareFormId] = useState('')
  const [manageQr, setManageQr] = useState('')
  const [copiedFormId, setCopiedFormId] = useState('')
  const [versionHistory, setVersionHistory] = useState<Array<{version:number;createdAt:string;questionCount:number;title:string}>>([])
  const [versionHistoryTitle, setVersionHistoryTitle] = useState('')
  const [deliveryStatus, setDeliveryStatus] = useState<Array<{id:string;source:'mail'|'integrationDeliveries';status:string;type:string;error:string;attempts:number}>>([])
  const [deliveryStatusTitle, setDeliveryStatusTitle] = useState('')
  const [publicFormLoaded, setPublicFormLoaded] = useState(false)
  const [qr, setQr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const emailLinkHandled = useRef(false)

  const shareLink = `${location.origin}/?form=${encodeURIComponent(formSettings.publicSlug || formId)}`
  const previewLink = `${shareLink}&preview=1`
  const summaries = useMemo(() => responsePage?.summaries ?? analyzeStoredResponses(questions, responses), [questions, responses, responsePage])

  useEffect(() => observeAuthState((nextUser) => { setUser(nextUser); setAuthReady(true) }), [])
  useEffect(() => {
    if (requestedFormId) return
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({ memo, program, questions, formType, theme, endDate, settings: formSettings } satisfies CreatorDraft))
    } catch {
      // Keep editing available even when browser storage is blocked or full.
    }
  }, [memo, program, questions, formType, theme, endDate, formSettings, requestedFormId])
  useEffect(() => {
    if (!authReady || user || !requestedFormId || requestedLogin) return
    void signInAsGuest().catch(() => setAuthError('익명 응답 세션을 시작하지 못했습니다. 로그인하거나 잠시 후 다시 시도해 주세요.'))
  }, [authReady, user, requestedFormId, requestedLogin])
  useEffect(() => {
    if (emailLinkMode !== 'checking' || emailLinkHandled.current) return
    emailLinkHandled.current = true
    const savedEmail = getPendingEmailAddress()
    if (!savedEmail) {
      setEmailLinkMode('needs-email')
      return
    }

    setLoginProvider('email')
    void completeEmailSignIn(savedEmail).then((signedInUser) => {
      setUser(signedInUser)
      setEmailLinkMode('none')
    }).catch((error) => {
      setAuthError(loginFailureMessage(error, 'email'))
      setEmailLinkMode('needs-email')
    }).finally(() => setLoginProvider(null))
  }, [emailLinkMode])
  useEffect(() => {
    if (!user || !requestedFormId || publicFormLoaded) return
    void getPublishedForm(requestedFormId).then((form) => {
      setProgram(form.program); setQuestions(form.questions); setFormType(form.formType); setTheme(normalizeTheme(form.theme)); setEndDate(form.surveyEndDate); setFormSettings(normalizeFormSettings(form.settings)); setFormId(form.id); setPublicFormLoaded(true)
    }).catch(() => setAuthError('공개된 폼을 불러오지 못했습니다. 링크와 공개 상태를 확인해 주세요.'))
  }, [user, requestedFormId, publicFormLoaded])
  useEffect(() => { if (published) void QRCode.toDataURL(shareLink, { width: 240, margin: 2 }).then(setQr) }, [published, shareLink])
  useEffect(() => {
    if (!requestedFormId || !publicFormLoaded) return
    document.title = formSettings.branding.shareTitle || program.programName || '대플폼'
    const metadata: Record<string, string | undefined> = {
      description: formSettings.branding.shareDescription || program.description,
      'og:title': formSettings.branding.shareTitle || program.programName,
      'og:description': formSettings.branding.shareDescription || program.description,
      'og:image': formSettings.branding.shareImageUrl,
    }
    Object.entries(metadata).forEach(([name, content]) => {
      if (!content) return
      const property = name.startsWith('og:') ? 'property' : 'name'
      let element = document.head.querySelector<HTMLMetaElement>(`meta[${property}="${name}"]`)
      if (!element) { element = document.createElement('meta'); element.setAttribute(property, name); document.head.append(element) }
      element.content = content
    })
  }, [formSettings.branding, program.description, program.programName, publicFormLoaded, requestedFormId])

  const login = async (provider: LoginProvider, email = '') => {
    setLoginProvider(provider); setAuthError('')
    try {
      if (provider === 'google') await signInWithGoogle()
      else if (emailLinkMode === 'needs-email') {
        const signedInUser = await completeEmailSignIn(email)
        setUser(signedInUser)
        setEmailLinkMode('none')
      } else await requestEmailSignInLink(email)
      return true
    } catch (error) {
      setAuthError(loginFailureMessage(error, provider))
      return false
    } finally {
      setLoginProvider(null)
    }
  }
  const startNewEmailLink = () => {
    discardEmailSignInLink()
    setEmailLinkMode('none')
    setAuthError('')
  }
  const startNewForm = () => {
    setMenuOpen(false)
    setFiles([])
    setMemo('')
    setAnalysisError('')
    setReviewNotes([])
    setProgram(emptyProgram)
    setQuestions([])
    setFormType('general')
    setTheme('green')
    setFormId(newFormId())
    setEndDate('2026-07-31')
    setFormSettings(normalizeFormSettings(defaultFormSettings))
    setPublished(false)
    setPublishLoading(false)
    setMessage('')
    setResponses([])
    setResponsePage(undefined)
    setSampleResults(false)
    setQr('')
    setCreationMode('ai')
    setPage('create')
  }
  const startManualForm = () => {
    startNewForm()
    setCreationMode('manual')
    setQuestions([{ id: Date.now(), label: '', type: 'short_text', required: false }])
    setPage('edit')
  }
  const doLogout = async () => { await logout(); setUser(null); setMenuOpen(false); setPage('create') }
  const addFiles = (incoming: File[]) => {
    const supportedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.hwp', '.hwpx']
    const valid = incoming.filter((file) => supportedExtensions.some((extension) => file.name.toLowerCase().endsWith(extension)))
    if (valid.length !== incoming.length) setAnalysisError('PDF, PNG, JPG, HWP, HWPX 파일만 지원합니다.')
    setFiles((current) => [...current, ...valid].slice(0, 5))
  }
  const onFiles = (event: ChangeEvent<HTMLInputElement>) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)) }
  const analyze = async () => {
    if (!files.length && !memo.trim()) { setAnalysisError('참고문서를 첨부하거나 담당자 메모를 입력해 주세요.'); return }
    setAnalysisLoading(true); setAnalysisError('')
    try {
      const generated = await generateFormFromDocuments(files, memo)
      setProgram(generated.program)
      setQuestions(generated.questions)
      setFormType(generated.formType)
      setReviewNotes(generated.reviewNotes)
      setTheme(normalizeSelectableTheme(generated.suggestedTheme))
      setFormSettings(settingsFromAiSuggestion(generated.suggestedSettings))
      if (/^\d{4}-\d{2}-\d{2}$/.test(generated.suggestedEndDate)) setEndDate(generated.suggestedEndDate)
      setCreationMode('ai')
      setPage('edit')
    } catch (error) {
      console.error(error)
      setAnalysisError(aiFailureMessage(error))
    } finally { setAnalysisLoading(false) }
  }
  const publish = async () => {
    if (!user) return
    if (!program.programName || !questions.length) { setMessage('폼 제목과 질문을 확인해 주세요.'); return }
    const unnamedQuestionIndex=questions.findIndex(question=>!editableQuestionLabel(question.label).trim())
    if(unnamedQuestionIndex>=0){setMessage(`${unnamedQuestionIndex+1}번 질문 내용을 입력해 주세요.`);return}
    const invalidChoiceQuestion=questions.find(question=>(question.type==='select'||question.type==='checkbox')&&new Set((question.options??[]).map(option=>editableOptionLabel(option).trim()).filter(Boolean)).size<2)
    if(invalidChoiceQuestion){setMessage(`"${invalidChoiceQuestion.label}" 질문에 서로 다른 선택지를 2개 이상 입력해 주세요.`);return}
    const duplicateChoiceQuestion=questions.find(question=>{
      if(question.type!=='select'&&question.type!=='checkbox')return false
      const values=(question.options??[]).map(option=>editableOptionLabel(option).trim().toLocaleLowerCase('ko')).filter(Boolean)
      return new Set(values).size!==values.length
    })
    if(duplicateChoiceQuestion){setMessage(`"${duplicateChoiceQuestion.label}" 질문의 중복 선택지를 수정해 주세요.`);return}
    if(formSettings.quiz.enabled&&!questions.some(question=>(question.points??0)>0&&(question.correctAnswers?.length??0)>0)){setMessage('퀴즈 모드에는 정답과 1점 이상의 배점이 설정된 문항이 필요합니다. 폼 수정 화면에서 설정해 주세요.');return}
    if(formSettings.workspace.enabled&&(!formSettings.workspace.name.trim()||!formSettings.workspace.emailDomain.includes('.'))){setMessage('조직 공유 공간 이름과 올바른 이메일 도메인을 입력해 주세요.');return}
    if(formSettings.branding.fontPreset==='custom'&&(!formSettings.branding.customFontFamily||!formSettings.branding.customFontUrl?.startsWith('https://'))){setMessage('사용자 글꼴 이름과 HTTPS CSS 주소를 입력해 주세요.');return}
    if (!window.confirm(`${published ? '변경한 설정으로 다시 배포할까요?' : '이 폼을 실제로 배포할까요?'}\n\n배포하면 공개 링크가 활성화되어 응답을 받을 수 있습니다.`)) return
    setPublishLoading(true); setMessage('')
    try {
      const publishedFormId = await publishFormRecord({
        formId, owner: user, program, questions, formType, surveyEndDate: endDate, theme, settings: formSettings,
        checkForExistingResponses: published,
      })
      const separatedFromExistingResponses = publishedFormId !== formId
      setFormId(publishedFormId); setPublished(true); setFormSettings((current)=>({...current,version:separatedFromExistingResponses?1:published?current.version+1:1}))
      setMessage(separatedFromExistingResponses
        ? '기존 응답을 보호하기 위해 새 폼으로 분리했습니다. 아래의 새 공개 링크를 사용해 주세요.'
        : '실제 공개 링크가 생성되었습니다. 이제 응답이 Firestore에 저장됩니다.')
    }
    catch (error) {
      setMessage(error instanceof Error && error.message === 'public-slug-in-use'
        ? '이미 사용 중인 공개 주소입니다. 다른 주소를 입력해 주세요.'
        : '배포하지 못했습니다. 로그인과 Firestore 설정을 확인해 주세요.')
    }
    finally { setPublishLoading(false) }
  }
  const loadResults = async (targetFormId = formId) => {
    if (ownedForms.find((form)=>form.id===targetFormId)?.organizationShared) {
      setMessage('조직 공유 폼은 공개 응답 화면에서 확인할 수 있습니다. 결과 접근은 소유자가 공동 편집 권한을 부여해야 합니다.')
      return
    }
    setResultLoading(true); setMessage(''); setSampleResults(false)
    try {
      const form = targetFormId === formId ? { program, questions, formType, theme, surveyEndDate: endDate, settings: formSettings } : await getPublishedForm(targetFormId, true)
      setFormId(targetFormId); setProgram(form.program); setQuestions(form.questions); setFormType(form.formType); setTheme(normalizeTheme(form.theme)); setEndDate(form.surveyEndDate); setFormSettings(normalizeFormSettings(form.settings))
      const initialQuery: ResponseQuery = {
        filters: { query: '', status: 'all', selectedIds: [] },
        sortBy: 'submittedAt',
        sortDirection: 'desc',
        page: 1,
        pageSize: 25,
      }
      const result = await queryFormResponses(targetFormId, initialQuery)
      setResponses(result.items); setResponsePage(result); setPage('results')
    } catch { setMessage('응답을 불러오지 못했습니다. 폼 제작자 계정인지 확인해 주세요.') }
    finally { setResultLoading(false) }
  }
  const openManage = async () => {
    if (!user) return
    setMenuOpen(false); setPage('manage'); setResultLoading(true)
    try { const [active,deleted]=await Promise.all([getOwnedForms(user.uid),getDeletedForms(user.uid)]);setOwnedForms(active);setDeletedForms(deleted) } catch { setMessage('내 폼 목록을 불러오지 못했습니다.') } finally { setResultLoading(false) }
  }
  const deleteOwnedForm = async (form: OwnedForm) => {
    if(form.organizationShared){setMessage('조직 공유 폼은 소유자만 삭제할 수 있습니다.');return}
    if (!window.confirm(`“${form.title}” 폼을 휴지통으로 이동할까요?\n응답 ${form.responseCount}건은 보존되며 복구할 수 있습니다.`)) return
    setDeletingFormId(form.id); setMessage('')
    try {
      await deleteFormRecord(form.id)
      setOwnedForms((current) => current.filter((item) => item.id !== form.id))
      setDeletedForms((current)=>[{id:form.id,title:form.title,deletedAt:new Date().toISOString()},...current])
      setMessage('폼을 휴지통으로 이동했습니다. 응답과 첨부파일은 보존됩니다.')
      if (form.id === formId) { setPublished(false); setFormId(newFormId()) }
    } catch { setMessage('폼을 휴지통으로 이동하지 못했습니다. 제작자 계정인지 확인한 뒤 다시 시도해 주세요.') }
    finally { setDeletingFormId('') }
  }
  const toggleManageShare = async (form: OwnedForm) => {
    if (shareFormId === form.id) {
      setShareFormId(''); setManageQr(''); setCopiedFormId('')
      return
    }
    const publicLink = `${location.origin}/?form=${encodeURIComponent(form.publicSlug || form.id)}`
    setShareFormId(form.id); setManageQr(''); setCopiedFormId(''); setMessage('')
    try { setManageQr(await QRCode.toDataURL(publicLink, { width: 280, margin: 2 })) }
    catch { setMessage('QR 코드를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.') }
  }
  const copyManageLink = async (form: OwnedForm) => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/?form=${encodeURIComponent(form.publicSlug || form.id)}`)
      setCopiedFormId(form.id)
    } catch { setMessage('링크를 복사하지 못했습니다. 주소를 직접 선택해 복사해 주세요.') }
  }
  const restoreDeletedForm = async (form: DeletedForm) => {
    try {
      await restoreFormRecord(form.id)
      setDeletedForms((items)=>items.filter((item)=>item.id!==form.id))
      if(user)setOwnedForms(await getOwnedForms(user.uid))
      setMessage('폼을 일시중지 상태로 복구했습니다.')
    } catch {
      setMessage('폼을 복구하지 못했습니다.')
    }
  }
  const emptyTrash = async () => {
    if (!deletedForms.length || !window.confirm(`휴지통의 폼 ${deletedForms.length}개를 영구 삭제할까요?\n\n폼과 모든 응답이 삭제되며 복구할 수 없습니다.`)) return
    setEmptyingTrash(true); setMessage('')
    try {
      const deleted = await emptyDeletedForms()
      setDeletedForms([])
      setMessage(`휴지통을 비웠습니다. 폼 ${deleted}개를 영구 삭제했습니다.`)
    } catch { setMessage('휴지통을 비우지 못했습니다. 잠시 후 다시 시도해 주세요.') }
    finally { setEmptyingTrash(false) }
  }
  const copyPrefilledLink = async () => {
    const url = new URL(shareLink)
    let filled = 0
    for (const question of questions.filter((item) => item.type !== 'file')) {
      const value = window.prompt(`미리 채울 답변: ${question.label}\n비워두면 링크에서 제외됩니다.`)
      if (value === null) return
      if (value) { url.searchParams.set(`q${question.id}`, value); filled += 1 }
    }
    if (!filled) { setMessage('미리 채울 답변을 하나 이상 입력해 주세요.'); return }
    await navigator.clipboard.writeText(url.toString())
    setMessage('미리 답변이 채워진 링크를 복사했습니다.')
  }
  const openSampleResults = () => {
    setResponses(createSampleResponses(questions, 10))
    setResponsePage(undefined)
    setSampleResults(true)
    setMessage('')
    setPage('results')
  }
  const openServiceSample = () => {
    setProgram(serviceSampleProgram); setQuestions(serviceSampleQuestions); setTheme('kangnam')
    setFormSettings(normalizeFormSettings({...defaultFormSettings,branding:{...defaultFormSettings.branding,accentColor:'#087fc5',backgroundColor:'#f3f8fd'}}))
    setResponses(createSampleResponses(serviceSampleQuestions,36)); setResponsePage(undefined); setSampleResults(true); setMessage(''); setPage('results')
  }
  const moveQuestion = (index:number,direction:-1|1) => {
    const target=index+direction
    if(target<0||target>=questions.length)return
    const next=[...questions];[next[index],next[target]]=[next[target],next[index]];setQuestions(next)
  }
  const toggleFormReception = async (form: OwnedForm) => {
    if(form.organizationShared){setMessage('조직 공유 폼의 접수 상태는 소유자 또는 편집자만 변경할 수 있습니다.');return}
    const nextStatus = form.status === 'open' ? 'paused' : 'open'
    setMessage('')
    try {
      await updateFormLifecycle(form.id, nextStatus)
      setOwnedForms((current) => current.map((item) => item.id === form.id
        ? { ...item, status: nextStatus, published: true }
        : item))
      setMessage(nextStatus === 'open' ? '응답 접수를 시작했습니다.' : '응답 접수를 일시중지했습니다.')
    } catch {
      setMessage('접수 상태를 변경하지 못했습니다.')
    }
  }
  const editFormCloseTime = async (form: OwnedForm) => {
    if(form.organizationShared){setMessage('조직 공유 폼의 마감 시각은 소유자 또는 편집자만 변경할 수 있습니다.');return}
    const current = form.closesAt ? new Date(form.closesAt).toISOString().slice(0, 16) : ''
    const value = window.prompt('새 마감 시각을 YYYY-MM-DDTHH:mm 형식으로 입력하세요. 비우면 마감 시각을 제거합니다.', current)
    if (value === null) return
    const closesAt = value ? new Date(value).toISOString() : undefined
    try {
      await updateFormSchedule(form.id, form.startsAt, closesAt)
      setOwnedForms((items) => items.map((item) => item.id === form.id ? { ...item, closesAt } : item))
      setMessage('마감 시각을 변경했습니다.')
    } catch {
      setMessage('마감 시각을 변경하지 못했습니다.')
    }
  }
  const duplicateOwnedForm = async (form: OwnedForm) => {
    setResultLoading(true); setMessage('')
    try {
      const source = await getPublishedForm(form.id, true)
      setProgram({ ...source.program, programName: `${source.program.programName} 복사본` })
      setQuestions(source.questions.map((question) => ({
        ...question,
        options: question.options ? [...question.options] : undefined,
        optionImageUrls: question.optionImageUrls ? [...question.optionImageUrls] : undefined,
      })))
      setFormType(source.formType); setTheme(normalizeTheme(source.theme)); setEndDate(source.surveyEndDate)
      setFormSettings({ ...normalizeFormSettings(source.settings), publicSlug: undefined, version: normalizeFormSettings(source.settings).version + 1 })
      setFormId(newFormId()); setPublished(false); setResponses([]); setResponsePage(undefined); setPage('edit')
      setMessage('폼을 새 복사본으로 불러왔습니다. 검토 후 배포해 주세요.')
    } catch {
      setMessage('폼을 복사하지 못했습니다.')
    } finally {
      setResultLoading(false)
    }
  }
  const openVersionHistory = async (form: OwnedForm) => {
    try {
      setVersionHistory(await getFormVersions(form.id)); setVersionHistoryTitle(form.title)
    } catch {
      setMessage('버전 기록을 불러오지 못했습니다.')
    }
  }
  const openDeliveryStatus = async (form: OwnedForm) => {
    try {
      setDeliveryStatus(await getFormDeliveryStatus(form.id)); setDeliveryStatusTitle(form.title)
    } catch {
      setMessage('알림·연동 상태를 불러오지 못했습니다.')
    }
  }

  if (!authReady || emailLinkMode === 'checking') return <div className="center"><LoaderCircle className="spin" /></div>
  if (emailLinkMode === 'needs-email' || (!user && (!requestedFormId || requestedLogin))) return <Login loadingProvider={loginProvider} error={authError} initialEmail={getPendingEmailAddress()} completingEmailLink={emailLinkMode === 'needs-email'} onLogin={login} onStartNewEmailLink={startNewEmailLink} />
  if (requestedFormId && publicFormLoaded && user) return <PublicForm user={user} formId={formId} program={program} questions={questions} theme={theme} endDate={endDate} settings={formSettings} preview={requestedPreview} publicResults={requestedPublicResults} onLogout={doLogout} />
  if (requestedFormId && authError) return <main className="public-shell"><div className="complete card"><h1>폼을 열 수 없습니다</h1><p>{authError}</p><a className="primary link" href="/">대플폼 홈으로</a></div></main>
  if (requestedFormId) return <div className="center"><LoaderCircle className="spin"/></div>
  if (!user) return <div className="center"><LoaderCircle className="spin"/></div>

  return <div className={`app theme-${theme}`}>
    <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
    <header><button className="brand university-brand" aria-label="강남대학교 대플폼 홈" onClick={startNewForm}><img src={kangnamUniversityLogo} alt="강남대학교"/><span className="university-name"><b>강남대학교</b><small>KANGNAM UNIVERSITY</small></span><i aria-hidden="true"/><span className="service-name"><b>대플폼</b><small>AI FORM BUILDER</small></span></button><nav><button onClick={startNewForm}>새 폼</button><button onClick={() => void openManage()}>내 폼 관리</button><div className="user-menu"><button className="avatar" onClick={() => setMenuOpen(!menuOpen)}>{user.displayName?.[0] ?? 'U'} <ChevronDown size={14}/></button>{menuOpen && <div className="menu"><strong>{user.displayName}</strong><small>{user.email}</small><button onClick={() => void openManage()}><LayoutDashboard size={16}/> 내 폼 관리</button><button onClick={() => void doLogout()}><LogOut size={16}/> 로그아웃</button></div>}</div></nav></header>
    <div className="university-promotion-bar" aria-hidden="true"><img src={kangnamPromotionBar} alt=""/></div>
    <UniversityPatternBand/>
    <main id="main-content">
      {page === 'create' && <section><Title step="1" title="자료를 읽고 폼을 만듭니다" text="PDF·PNG·JPG·HWP 참고문서와 담당자 메모를 Gemini가 함께 분석합니다."/><div className="grid two"><div className="card"><h2>참고문서</h2><div className={`drop ${dragging ? 'dragging' : ''}`} onClick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}><Upload/><b>파일을 선택하거나 끌어 놓으세요</b><span>PDF, PNG, JPG, HWP, HWPX · 최대 5개</span><input ref={fileRef} hidden type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.hwp,.hwpx" onChange={onFiles}/></div>{files.map((file, i) => <div className="file" key={`${file.name}-${i}`}><FileText size={16}/><span>{file.name}</span><button onClick={() => setFiles(files.filter((_, index) => index !== i))}><Trash2 size={15}/></button></div>)}</div><div className="card"><h2>담당자 메모</h2><textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 이 자료는 행사 만족도 조사입니다. 익명으로 받고 개선 의견을 자세히 물어봐 주세요."/><small>문서와 메모가 함께 AI 분석에 반영됩니다.</small></div></div>{analysisError && <Notice text={analysisError}/>}<div className="actions create-actions"><button type="button" className="manual-create" onClick={startManualForm}><Plus/> 직접 폼 만들기</button><button type="button" className="sample-view" onClick={openServiceSample}><Eye/> 샘플 보기</button><button className="primary" onClick={() => void analyze()} disabled={analysisLoading}>{analysisLoading ? <LoaderCircle className="spin"/> : <WandSparkles/>}{analysisLoading ? '문서를 읽는 중...' : 'AI로 폼 만들기'}</button></div></section>}
      {page === 'edit' && <section><Title step="2" title={creationMode === 'manual' ? '폼 내용을 직접 입력하세요' : 'AI가 만든 폼을 확인하세요'} text={creationMode === 'manual' ? '기본 정보와 질문을 입력한 뒤 디자인·배포 설정으로 이동합니다.' : '문서에서 확실하지 않은 내용은 검토 항목으로 표시합니다.'}/>{reviewNotes.length > 0 && <div className="notice warn"><b>사람이 확인할 항목</b>{reviewNotes.map((note) => <span key={note}>• {note}</span>)}</div>}<div className="grid edit"><div><div className="card form-fields"><h2>폼 기본 정보</h2><label>폼 제목<input value={program.programName} onChange={(e) => setProgram({...program, programName:e.target.value})}/></label><label>설명<textarea value={program.description} onChange={(e) => setProgram({...program, description:e.target.value})}/></label><div className="grid two"><label>대상<input value={program.target} onChange={(e) => setProgram({...program, target:e.target.value})}/></label><label>기간<input value={program.period} onChange={(e) => setProgram({...program, period:e.target.value})}/></label></div></div><div className="card"><div className="row"><h2>질문 {questions.length}개</h2><button onClick={() => setQuestions([...questions,{id:Date.now(),label:'',type:'short_text',required:false}])}><Plus size={16}/> 질문 추가</button></div>{questions.map((q,index)=><QuestionEditor key={q.id} question={q} index={index} count={questions.length} formId={formId} user={user} onChange={(change)=>setQuestions(questions.map(item=>item.id===q.id?{...item,...change}:item))} onMove={(direction)=>moveQuestion(index,direction)} onDelete={()=>setQuestions(questions.filter(item=>item.id!==q.id))}/>)}{formSettings.quiz.enabled&&<QuizConfiguration questions={questions} onChange={setQuestions}/>}</div></div><aside className="card preview"><h2>미리보기</h2><FormBody program={program} questions={questions} theme={theme} branding={formSettings.branding}/></aside></div><div className="actions between"><button onClick={() => setPage('create')}>자료 다시 선택</button><button className="primary" onClick={() => setPage('publish')}>디자인·배포 설정</button></div></section>}
      {page === 'publish' && <section><Title step="3" title="디자인과 참여 정책을 설정하세요" text="참여 대상, 접수 일정, 제출 후 동작을 정한 뒤 공개 링크를 생성합니다."/><div className="grid two"><div className="card"><h2><Palette size={20}/> 폼 디자인</h2><div className="themes" role="group" aria-label="폼 디자인 선택">{selectableThemes.map((item) => <button type="button" key={item.id} className={`theme-option ${item.id} ${theme===item.id?'selected':''}`} aria-pressed={theme===item.id} onClick={() => setTheme(item.id)}><span className="theme-swatch"><ThemeIcon theme={item.id}/></span><span className="theme-copy"><b>{item.label}</b><small>{item.description}</small></span></button>)}</div>{theme==='green'&&<div className="basic-color-customizer"><div><Palette aria-hidden="true"/><span><b>기본 디자인 색상</b><small>원하는 강조색과 배경색을 자유롭게 선택하세요.</small></span></div><label>강조색<input type="color" value={formSettings.branding.accentColor} onChange={(event)=>setFormSettings(current=>({...current,branding:{...current.branding,accentColor:event.target.value}}))}/><code>{formSettings.branding.accentColor}</code></label><label>배경색<input type="color" value={formSettings.branding.backgroundColor} onChange={(event)=>setFormSettings(current=>({...current,branding:{...current.branding,backgroundColor:event.target.value}}))}/><code>{formSettings.branding.backgroundColor}</code></label></div>}<FormBody program={program} questions={questions} theme={theme} branding={formSettings.branding}/></div><div className="card publish-card"><h2>공개·응답 설정</h2>{creationMode==='ai'&&<div className="ai-settings-note"><WandSparkles/><span><b>AI 추천 설정이 적용되었습니다</b><small>문서에서 찾은 대상·일정·응답 방식과 공유 정보를 바탕으로 채웠습니다. 배포 전에 확인하고 자유롭게 수정할 수 있습니다.</small></span></div>}<FormPolicyEditor value={formSettings} previewTitle={program.programName} previewDescription={program.description} onChange={setFormSettings} onCollaborator={published?async(email,role)=>setFormCollaborator(formId,email,role):undefined}/><label>데이터 보존 기준일<input type="date" value={endDate} onChange={(e)=>setEndDate(e.target.value)}/></label><button className="primary wide" onClick={() => void publish()} disabled={publishLoading}>{publishLoading?<LoaderCircle className="spin"/>:<Send/>} 설정 저장하고 배포하기</button>{message && <Notice text={message}/>} {published && <div className="share"><CheckCircle2/><h3>배포 완료</h3>{qr?<img src={qr} alt="공개 폼 QR 코드"/>:<QrCode/>}<div className="copy"><input readOnly value={shareLink}/><button onClick={() => void navigator.clipboard.writeText(shareLink)} aria-label="공개 링크 복사"><Copy/></button></div><div className="share-action-grid"><a className="primary link" href={previewLink} target="_blank" rel="noreferrer"><Eye size={17}/> 미리보기</a><button onClick={() => void sharePublicForm(program.programName,shareLink).catch(()=>setMessage('공유를 완료하지 못했습니다. 링크를 직접 복사해 주세요.'))}><Send size={17}/> 공유</button>{qr&&<button onClick={() => void copyQrImage(qr).catch(()=>setMessage('QR 이미지 복사가 지원되지 않아 PNG 저장을 이용해 주세요.'))}><Copy size={17}/> QR 복사</button>}{qr&&<a className="link" href={qr} download={`${program.programName.replace(/[\\/:*?"<>|]/g,'_')}_QR.png`}><Download size={17}/> QR PNG</a>}<a className="link" href={`mailto:?subject=${encodeURIComponent(formSettings.branding.shareTitle||program.programName)}&body=${encodeURIComponent(`${formSettings.branding.shareDescription||program.description}\n${shareLink}`)}`}><Send size={17}/> 이메일</a><button onClick={() => void navigator.clipboard.writeText(`<iframe src="${shareLink}" title="${program.programName}" width="100%" height="720" loading="lazy"></iframe>`)}><Copy size={17}/> 삽입 코드</button><button onClick={() => void copyPrefilledLink().catch(()=>setMessage('미리 채운 링크를 복사하지 못했습니다.'))}><Copy size={17}/> 미리 채운 링크</button>{formSettings.submission.showPublicResults&&<button onClick={() => void navigator.clipboard.writeText(`${shareLink}&results=1`).then(()=>setMessage('익명 결과 공개 링크를 복사했습니다.'))}><BarChart3 size={17}/> 결과 공개 링크</button>}</div></div>}</div></div><div className="actions between"><button onClick={() => setPage('edit')}>폼 수정</button><div className="actions-inline"><button onClick={openSampleResults}><BarChart3/> 샘플 결과</button><button className="primary" onClick={() => void loadResults()} disabled={resultLoading}>실제 응답 결과</button></div></div></section>}
      {page === 'results' && <ResultsDashboard title={program.programName} loading={resultLoading} responses={responses} questions={questions} summaries={summaries} message={message} sample={sampleResults} initialPage={responsePage} onRefresh={() => sampleResults?openSampleResults():void loadResults()} onQuery={sampleResults?undefined:async(query)=>queryFormResponses(formId,query)} onManage={sampleResults?undefined:async(ids,action)=>manageFormResponses(formId,ids,action)} onLoadExport={sampleResults?undefined:async(query)=>(await queryFormResponses(formId,query,true)).items} onAnalyze={sampleResults?undefined:async(query)=>{const items=(await queryFormResponses(formId,query,true)).items;const topics=await summarizeResponses(items.flatMap(item=>Object.values(item.answers).filter(value=>typeof value==='string').map(String)));if(user)await saveAnalysisRecord({formId,owner:user,stats:{applicants:items.length,participants:items.length,satisfactionResponses:0,satisfactionScores:[]},topics,surveyEndDate:endDate});return topics}} onExportExcel={(items,exportQuestions) => void exportResponsesToExcel(program.programName, exportQuestions, items, analyzeStoredResponses(exportQuestions, items))}/>}
      {page === 'manage' && ownedForms.length>0 && <section className="card version-history-panel"><div className="row"><div><span className="eyebrow">VERSION HISTORY</span><h2>폼 수정 기록</h2></div><div className="version-form-buttons">{ownedForms.map(form=><button key={form.id} onClick={()=>void openVersionHistory(form)}>{form.title}</button>)}</div></div>{versionHistoryTitle&&<div><h3>{versionHistoryTitle}</h3>{versionHistory.length?<ol>{versionHistory.map(version=><li key={version.version}><strong>버전 {version.version}</strong><span>{version.questionCount}개 질문 · {version.createdAt?new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(version.createdAt)):'저장 시각 없음'}</span></li>)}</ol>:<p>저장된 버전 기록이 없습니다.</p>}</div>}</section>}
      {page === 'manage' && ownedForms.length>0 && <section className="card delivery-status-panel"><div className="row"><div><span className="eyebrow">DELIVERY STATUS</span><h2>알림·외부 연동 상태</h2></div><div className="version-form-buttons">{ownedForms.map(form=><button key={form.id} onClick={()=>void openDeliveryStatus(form)}>{form.title}</button>)}</div></div>{deliveryStatusTitle&&<div><h3>{deliveryStatusTitle}</h3>{deliveryStatus.length?<ul>{deliveryStatus.map(item=><li key={`${item.source}-${item.id}`}><span className={`badge delivery-${item.status}`}>{item.status}</span><b>{item.type}</b><span>{item.error||`${item.attempts}회 시도`}</span>{item.status==='failed'&&<button onClick={()=>void retryFormDelivery(item.id,item.source).then(()=>setMessage('재시도를 대기열에 추가했습니다.')).catch(()=>setMessage('재시도를 요청하지 못했습니다.'))}><RefreshCcw/> 재시도</button>}</li>)}</ul>:<p>아직 발송 또는 연동 기록이 없습니다.</p>}</div>}</section>}
      {page === 'manage' && deletedForms.length>0 && <section className="card trash-panel"><div className="trash-heading"><div><span className="eyebrow">TRASH</span><h2>휴지통</h2><p>삭제한 폼과 응답은 복구 전까지 공개되지 않습니다.</p></div><button type="button" className="danger" disabled={emptyingTrash} onClick={()=>void emptyTrash()}>{emptyingTrash?<LoaderCircle className="spin" size={16}/>:<Trash2 size={16}/>} 휴지통 비우기</button></div>{deletedForms.map(form=><div className="row" key={form.id}><span><b>{form.title}</b><small>{form.deletedAt?new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(form.deletedAt)):'삭제 시각 없음'}</small></span><button onClick={()=>void restoreDeletedForm(form)}><RefreshCcw/> 복구</button></div>)}</section>}
      {page === 'manage' && <section><Title step="" title="내가 만든 폼" text="폼별 접수 상태, 응답 수와 공유 링크를 관리합니다."/>{message&&<Notice text={message}/>} {resultLoading?<div className="center"><LoaderCircle className="spin"/></div>:<div className="manage-list">{ownedForms.length?ownedForms.map((form)=>{const publicLink=`${location.origin}/?form=${encodeURIComponent(form.publicSlug||form.id)}`;const formPreviewLink=`${publicLink}&preview=1`;const shareOpen=shareFormId===form.id;const full=Boolean(form.maxResponses&&form.responseCount>=form.maxResponses);const statusLabel=full?'최대 인원 마감':{draft:'초안',scheduled:'시작 전',open:'접수 중',paused:'일시중지',closed:'마감',private:'비공개'}[form.status??'draft'];const remaining=form.closesAt?new Date(form.closesAt).getTime()-Date.now():0;return <article className="card" key={form.id}><div><span className={`badge status-${full?'closed':form.status??'draft'}`}>{statusLabel}</span><h2>{form.title}</h2><small>{form.closesAt?`마감 ${new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(form.closesAt))}${remaining>0?` · ${Math.ceil(remaining/3600000)}시간 남음`:''}`:form.id}</small></div><strong>{form.responseCount}<small>명 응답{form.maxResponses?` / ${form.maxResponses}명`:''}</small></strong><div className="manage-actions"><button className="primary" onClick={() => void loadResults(form.id)}>결과 보기</button><button type="button" onClick={() => void duplicateOwnedForm(form)}><Copy size={16}/> 복사</button><button type="button" onClick={() => void toggleFormReception(form)}>{form.status==='open'?'접수 중지':'접수 시작'}</button><button type="button" onClick={() => void editFormCloseTime(form)}><CalendarClock size={16}/> 마감 수정</button><button type="button" aria-expanded={shareOpen} aria-controls={`share-${form.id}`} onClick={() => void toggleManageShare(form)}><QrCode size={16}/> 공유</button><button className="danger" disabled={deletingFormId===form.id} onClick={() => void deleteOwnedForm(form)}>{deletingFormId===form.id?<LoaderCircle className="spin" size={16}/>:<Trash2 size={16}/>} 삭제</button></div>{shareOpen&&<div className="manage-share-panel" id={`share-${form.id}`}><div className="manage-share-qr">{manageQr?<img src={manageQr} alt={`${form.title} 공개 링크 QR 코드`}/>:<LoaderCircle className="spin"/>}</div><div className="manage-share-info"><span>공개 링크</span><div className="copy"><input readOnly value={publicLink} aria-label={`${form.title} 공개 링크`}/><button type="button" onClick={() => void copyManageLink(form)} aria-label="공개 링크 복사">{copiedFormId===form.id?'복사됨':<Copy size={17}/>}</button></div><div className="manage-share-links"><a className="primary link" href={formPreviewLink} target="_blank" rel="noreferrer"><Eye size={16}/> 응답 화면 미리보기</a>{manageQr&&<a className="link" href={manageQr} download={`${form.title.replace(/[\\/:*?"<>|]/g,'_')}_QR.png`}><Download size={16}/> QR 저장</a>}</div></div></div>}</article>}):<div className="empty card">아직 배포한 폼이 없습니다.<button className="primary" onClick={startNewForm}>첫 폼 만들기</button></div>}</div>}</section>}
    </main>
  </div>
}

function Login({loadingProvider,error,initialEmail,completingEmailLink,onLogin,onStartNewEmailLink}:{
  loadingProvider: LoginProvider | null
  error: string
  initialEmail: string
  completingEmailLink: boolean
  onLogin: (provider: LoginProvider, email?: string) => Promise<boolean>
  onStartNewEmailLink: () => void
}) {
  const [email, setEmail] = useState(initialEmail)
  const [sentEmail, setSentEmail] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const loading = loadingProvider !== null

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  const submitEmail = async () => {
    if (!completingEmailLink && cooldown > 0) return
    const succeeded = await onLogin('email', email)
    if (succeeded && !completingEmailLink) {
      setSentEmail(email.trim())
      setCooldown(60)
    }
  }

  const emailButtonText = loadingProvider === 'email'
    ? '처리 중...'
    : completingEmailLink
      ? '이메일 확인 후 로그인'
      : cooldown > 0
        ? `${cooldown}초 후 재전송`
        : sentEmail
          ? '로그인 링크 다시 받기'
          : '로그인 링크 받기'

  return <main className="login"><div className="login-university-visual" aria-hidden="true"><img src={kangnamPromotionBar} alt=""/><UniversityPatternBand/></div><div className="login-card">
    <div className="logo"><img src={kangnamUniversityLogo} alt=""/></div><span className="eyebrow">DAEPUL FORM</span>
    <h1>자료 한 번 올리면<br/>폼부터 결과까지</h1>
    <p>첨부문서를 AI가 읽어 알맞은 폼을 만들고, 실제 응답을 자동으로 집계합니다.</p>
    {!completingEmailLink && <div className="login-options"><button className="social-login google" disabled={loading||!firebaseConfigured} onClick={()=>void onLogin('google')}>{loadingProvider==='google'?<LoaderCircle className="spin"/>:<span className="login-mark">G</span>} Google로 로그인</button></div>}
    {!completingEmailLink && <div className="login-divider"><span>또는 이메일</span></div>}
    <form className="email-login" onSubmit={(event)=>{event.preventDefault();void submitEmail()}}>
      {completingEmailLink && <div className="email-link-heading"><b>로그인을 마무리해 주세요</b><span>보안을 위해 링크를 받은 이메일을 다시 입력해 주세요.</span></div>}
      <label>{completingEmailLink ? '로그인 링크를 받은 이메일' : '이메일'}<input type="email" autoComplete="email" value={email} onChange={(event)=>setEmail(event.target.value)} disabled={loading} required/></label>
      {!completingEmailLink && <span className="email-login-note">처음 이용해도 이메일 확인 후 바로 시작할 수 있습니다.</span>}
      <button className="email-login-button" disabled={loading||!firebaseConfigured||(!completingEmailLink&&cooldown>0)}>{loadingProvider==='email'?<LoaderCircle className="spin"/>:completingEmailLink?<LogIn/>:<Send/>} {emailButtonText}</button>
    </form>
    {sentEmail && !error && <div className="email-link-sent"><b>로그인 링크를 보냈습니다.</b><span>{sentEmail}의 받은편지함을 확인해 주세요.</span></div>}
    {error&&<Notice text={error}/>}
    {completingEmailLink && <button className="email-link-reset" type="button" onClick={onStartNewEmailLink}>새 로그인 링크 받기</button>}
    <small>폼 제작자와 응답자 모두 로그인이 필요합니다.</small>
  </div></main>
}
const supportedImageAccept='.pjp,.jfif,.jpe,.pjpeg,.jpeg,.jpg,.gif,.png,.tif,.tiff,.bmp,.heic,.heif,.ico,.webp'

function ImageAttachmentDialog({title,formId,user,currentUrl,onApply,onClose}:{
  title:string
  formId:string
  user:FirebaseUser
  currentUrl:string
  onApply:(url:string)=>void
  onClose:()=>void
}) {
  const [mode,setMode]=useState<'url'|'upload'>('upload')
  const [url,setUrl]=useState(currentUrl)
  const [dragging,setDragging]=useState(false)
  const [uploadProgress,setUploadProgress]=useState(0)
  const [error,setError]=useState('')
  const fileInput=useRef<HTMLInputElement>(null)
  const applyUrl=()=>{
    const value=url.trim()
    if(value&&!/^https?:\/\//i.test(value)){setError('http:// 또는 https://로 시작하는 이미지 주소를 입력해 주세요.');return}
    onApply(value);onClose()
  }
  const uploadFile=async(file?:File)=>{
    if(!file)return
    setError('');setUploadProgress(1)
    try{
      const uploadedUrl=await uploadFormImage({formId,user,file,onProgress:setUploadProgress})
      onApply(uploadedUrl);onClose()
    }catch(issue){
      const message=issue instanceof Error?issue.message:''
      setError(message==='unsupported-image-type'?'지원되는 이미지 파일을 선택해 주세요.':message==='image-too-large'?'이미지는 20MB 이하만 업로드할 수 있습니다.':'이미지를 업로드하지 못했습니다.')
      setUploadProgress(0)
    }
  }
  return <div className="image-dialog-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose()}}>
    <section className="image-dialog" role="dialog" aria-modal="true" aria-labelledby="image-dialog-title">
      <header><h2 id="image-dialog-title">{title}</h2><button type="button" aria-label="이미지 첨부 창 닫기" onClick={onClose}><X/></button></header>
      <div className="image-dialog-body">
        <nav aria-label="이미지 첨부 방식"><button type="button" className={mode==='url'?'selected':''} onClick={()=>{setMode('url');setError('')}}><Link2/> URL 입력</button><button type="button" className={mode==='upload'?'selected':''} onClick={()=>{setMode('upload');setError('')}}><CloudUpload/> 이미지 업로드</button></nav>
        {mode==='url'?<div className="image-url-panel"><label>이미지 URL<input type="url" value={url} onChange={(event)=>setUrl(event.target.value)} placeholder="https://example.com/image.jpg"/></label>{url&&/^https?:\/\//i.test(url)&&<img src={url} alt="입력한 이미지 미리보기"/>}<button type="button" className="primary" onClick={applyUrl}>이미지 적용</button></div>:<div className={`image-upload-panel ${dragging?'dragging':''}`} onDragEnter={(event)=>{event.preventDefault();setDragging(true)}} onDragOver={(event)=>event.preventDefault()} onDragLeave={(event)=>{if(event.currentTarget===event.target)setDragging(false)}} onDrop={(event)=>{event.preventDefault();setDragging(false);void uploadFile(event.dataTransfer.files[0])}}><CloudUpload size={58}/><strong>이미지를 여기에 끌어 놓으세요</strong><span>또는</span><button type="button" className="primary" onClick={()=>fileInput.current?.click()}>내 PC에서 선택</button><input ref={fileInput} className="sr-only" type="file" accept={supportedImageAccept} onChange={(event)=>void uploadFile(event.target.files?.[0])}/><small>JPG, PNG, GIF, TIFF, BMP, HEIC, HEIF, ICO, WEBP 등 · 최대 20MB</small>{uploadProgress>0&&<progress value={uploadProgress} max="100">{uploadProgress}%</progress>}</div>}
        {error&&<div className="image-dialog-error" role="alert">{error}</div>}
        {currentUrl&&<button type="button" className="remove-image" onClick={()=>{onApply('');onClose()}}><Trash2 size={16}/> 현재 이미지 제거</button>}
      </div>
    </section>
  </div>
}

function QuestionEditor({question,index,count,formId,user,onChange,onMove,onDelete}:{
  question:FormQuestion
  index:number
  count:number
  formId:string
  user:FirebaseUser
  onChange:(change:Partial<FormQuestion>)=>void
  onMove:(direction:-1|1)=>void
  onDelete:()=>void
}) {
  const selectable=question.type==='select'||question.type==='checkbox'
  const label=editableQuestionLabel(question.label)
  const questionName=label.trim()||`${index+1}번 질문`
  const options=question.options?.length?question.options:['','']
  const [draggedOptionIndex,setDraggedOptionIndex]=useState<number|null>(null)
  const [imageTarget,setImageTarget]=useState<'question'|number|null>(null)
  const optionImageUrls=options.map((_,optionIndex)=>question.optionImageUrls?.[optionIndex]??'')
  const normalizedOptions=options.map(option=>editableOptionLabel(option).trim().toLocaleLowerCase('ko'))
  const duplicateOptionIndexes=new Set(normalizedOptions.flatMap((value,optionIndex)=>value&&normalizedOptions.indexOf(value)!==normalizedOptions.lastIndexOf(value)?[optionIndex]:[]))
  const changeType=(type:FormQuestion['type'])=>{
    const nextSelectable=type==='select'||type==='checkbox'
    onChange({
      type,
      options:nextSelectable?options:undefined,
      inputFormat:type==='short_text'?(question.inputFormat??'none'):'none',
    })
  }
  const updateOption=(optionIndex:number,value:string)=>onChange({options:options.map((option,current)=>current===optionIndex?value:option)})
  const removeOption=(optionIndex:number)=>{
    const nextOptions=options.filter((_,current)=>current!==optionIndex)
    const nextImages=optionImageUrls.filter((_,current)=>current!==optionIndex)
    onChange({options:nextOptions,optionImageUrls:nextImages,maxSelections:question.maxSelections?Math.min(question.maxSelections,nextOptions.length):undefined})
  }
  const moveOption=(from:number,to:number)=>{
    if(from===to)return
    const nextOptions=[...options]
    const nextImages=[...optionImageUrls]
    const [moved]=nextOptions.splice(from,1)
    const [movedImage]=nextImages.splice(from,1)
    nextOptions.splice(to,0,moved)
    nextImages.splice(to,0,movedImage)
    onChange({options:nextOptions,optionImageUrls:nextImages})
  }
  const applyImage=(url:string)=>{
    if(imageTarget==='question'){onChange({imageUrl:url});return}
    if(typeof imageTarget==='number'){
      const nextImages=[...optionImageUrls]
      nextImages[imageTarget]=url
      onChange({optionImageUrls:nextImages})
    }
  }
  return <article className="question-editor">
    <div className="question">
      <div className="question-order" aria-label={`${index+1}번 질문 순서 조정`}><span>{index+1}</span><button type="button" aria-label={`${questionName} 위로 이동`} disabled={index===0} onClick={()=>onMove(-1)}><ArrowUp size={15}/></button><button type="button" aria-label={`${questionName} 아래로 이동`} disabled={index===count-1} onClick={()=>onMove(1)}><ArrowDown size={15}/></button></div>
      <input aria-label={`${index+1}번 질문 내용`} value={label} placeholder="질문을 입력해 주세요" onChange={(event)=>onChange({label:event.target.value})}/>
      <button type="button" className={`question-image-button ${question.imageUrl?'has-image':''}`} aria-label={`${index+1}번 질문 이미지 첨부`} onClick={()=>setImageTarget('question')}><ImagePlus size={18}/></button>
      <select aria-label={`${questionName} 질문 유형`} value={question.type} onChange={(event)=>changeType(event.target.value as FormQuestion['type'])}>{Object.entries(typeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      <label className="check"><input type="checkbox" checked={question.required} onChange={(event)=>onChange({required:event.target.checked})}/>필수</label>
      <button type="button" aria-label={`${questionName} 삭제`} onClick={onDelete}><Trash2 size={16}/></button>
    </div>
    {question.imageUrl&&<div className="question-image-preview"><img src={question.imageUrl} alt={`${questionName} 첨부 이미지`}/><button type="button" onClick={()=>onChange({imageUrl:''})}><X size={15}/> 이미지 제거</button></div>}
    {question.type==='short_text'&&<div className="response-validation"><label>답변 형식<select value={question.inputFormat??'none'} onChange={(event)=>onChange({inputFormat:event.target.value as FormQuestion['inputFormat']})}><option value="none">제한 없음</option><option value="email">이메일 주소</option><option value="phone">휴대전화 010-0000-0000</option></select></label><small>{question.inputFormat==='email'?'올바른 이메일 주소가 아니면 제출할 수 없습니다.':question.inputFormat==='phone'?'하이픈(-)을 포함한 010-0000-0000 형식만 허용합니다.':'필요하면 이메일이나 휴대전화 형식을 지정하세요.'}</small></div>}
    {selectable&&<fieldset className="option-editor"><legend>{question.type==='checkbox'?'체크박스 선택지':'객관식 선택지'} <span>{options.length}개</span></legend><p>{question.type==='checkbox'?'응답자는 아래 항목을 여러 개 선택할 수 있습니다.':'응답자는 아래 항목 중 하나를 선택합니다.'} 손잡이를 드래그해 순서를 바꿀 수 있습니다.</p>{options.map((option,optionIndex)=>{const duplicate=duplicateOptionIndexes.has(optionIndex);const warningId=`option-warning-${question.id}-${optionIndex}`;const optionImage=optionImageUrls[optionIndex];return <div key={optionIndex} className={`${draggedOptionIndex===optionIndex?'dragging ':''}${duplicate?'duplicate-option ':''}${optionImage?'has-option-image':''}`} onDragOver={(event)=>event.preventDefault()} onDrop={(event)=>{event.preventDefault();if(draggedOptionIndex!==null)moveOption(draggedOptionIndex,optionIndex);setDraggedOptionIndex(null)}}><button type="button" className="option-drag-handle" draggable aria-label={`선택지 ${optionIndex+1} 순서 변경`} title="드래그해서 순서 변경" onDragStart={(event)=>{setDraggedOptionIndex(optionIndex);event.dataTransfer.effectAllowed='move'}} onDragEnd={()=>setDraggedOptionIndex(null)} onKeyDown={(event)=>{if(event.key==='ArrowUp'&&optionIndex>0){event.preventDefault();moveOption(optionIndex,optionIndex-1)}if(event.key==='ArrowDown'&&optionIndex<options.length-1){event.preventDefault();moveOption(optionIndex,optionIndex+1)}}}><GripVertical size={17}/></button><span aria-hidden="true">{question.type==='checkbox'?'□':'○'}</span><div className="option-input-content"><input aria-label={`선택지 ${optionIndex+1}`} aria-invalid={duplicate||undefined} aria-describedby={duplicate?warningId:undefined} value={editableOptionLabel(option)} onChange={(event)=>updateOption(optionIndex,event.target.value)} placeholder={`선택지 ${optionIndex+1}`}/>{optionImage&&<img src={optionImage} alt={`선택지 ${optionIndex+1} 첨부 이미지`}/>}</div><button type="button" className={`option-image-button ${optionImage?'has-image':''}`} aria-label={`선택지 ${optionIndex+1} 이미지 첨부`} onClick={()=>setImageTarget(optionIndex)}><ImagePlus size={18}/></button><span className={`option-duplicate-warning ${duplicate?'visible':''}`} tabIndex={duplicate?0:-1} aria-label={duplicate?'중복 옵션은 지원되지 않습니다.':undefined}><TriangleAlert size={20}/>{duplicate&&<span id={warningId} role="tooltip">중복 옵션은 지원되지 않습니다.</span>}</span><button type="button" aria-label={`선택지 ${optionIndex+1} 삭제`} disabled={options.length<=2} onClick={()=>removeOption(optionIndex)}><Trash2 size={15}/></button></div>})}<div className="option-editor-actions"><button type="button" className="add-option" disabled={options.length>=50} onClick={()=>onChange({options:[...options,''],optionImageUrls:[...optionImageUrls,'']})}><Plus size={16}/> 선택지 추가</button>{question.type==='checkbox'&&<label>최대 선택 개수<input type="number" min="1" max={options.length} value={question.maxSelections??''} placeholder="제한 없음" onChange={(event)=>{const value=Number(event.target.value);onChange({maxSelections:event.target.value===''?undefined:Math.max(1,Math.min(options.length,value))})}}/></label>}</div></fieldset>}
    {imageTarget!==null&&<ImageAttachmentDialog title={imageTarget==='question'?`${index+1}번 질문 이미지 첨부`:`선택지 ${imageTarget+1} 이미지 첨부`} formId={formId} user={user} currentUrl={imageTarget==='question'?question.imageUrl??'':optionImageUrls[imageTarget]??''} onApply={applyImage} onClose={()=>setImageTarget(null)}/>}
  </article>
}

function QuizConfiguration({questions,onChange}:{questions:FormQuestion[];onChange:(questions:FormQuestion[])=>void}) {
  const update=(id:number,change:Partial<FormQuestion>)=>onChange(questions.map(question=>question.id===id?{...question,...change}:question))
  return <section className="quiz-configuration" aria-labelledby="quiz-config-title">
    <div><span className="eyebrow">QUIZ</span><h3 id="quiz-config-title">정답과 배점 설정</h3><p>선택형·체크박스·숫자·단답형 문항을 자동채점할 수 있습니다.</p></div>
    {questions.filter(question=>question.type!=='long_text'&&question.type!=='file'&&question.type!=='consent').map(question=><fieldset key={question.id}>
      <legend>{question.label}</legend>
      <label>배점<input type="number" min="0" max="1000" value={question.points??0} onChange={event=>update(question.id,{points:Math.max(0,Number(event.target.value))})}/></label>
      <label>정답
        {question.type==='select'&&question.options?.length
          ?<select value={String(question.correctAnswers?.[0]??'')} onChange={event=>update(question.id,{correctAnswers:event.target.value?[event.target.value]:[]})}><option value="">정답 선택</option>{question.options.map(option=><option key={option}>{option}</option>)}</select>
          :question.type==='checkbox'&&question.options?.length
            ?<span className="quiz-answer-options">{question.options.map(option=><label key={option}><input type="checkbox" checked={question.correctAnswers?.map(String).includes(option)??false} onChange={event=>{const selected=question.correctAnswers?.map(String)??[];update(question.id,{correctAnswers:event.target.checked?[...selected,option]:selected.filter(item=>item!==option)})}}/>{option}</label>)}</span>
            :<input value={String(question.correctAnswers?.[0]??'')} onChange={event=>update(question.id,{correctAnswers:event.target.value===''?[]:[question.type==='number'?Number(event.target.value):event.target.value]})} inputMode={question.type==='number'?'numeric':undefined}/>}
      </label>
      <label>정답 피드백<input value={question.correctFeedback??''} onChange={event=>update(question.id,{correctFeedback:event.target.value})} placeholder="예: 정확합니다."/></label>
      <label>오답 피드백<input value={question.incorrectFeedback??''} onChange={event=>update(question.id,{incorrectFeedback:event.target.value})} placeholder="예: 핵심 개념을 다시 확인해 보세요."/></label>
    </fieldset>)}
  </section>
}

function Title({step,title,text}:{step:string;title:string;text:string}) { return <div className="title"><span>{step&&`${step}단계`}</span><h1>{title}</h1><p>{text}</p></div> }
function Notice({text}:{text:string}) { return <div className="notice" role="alert">{text}</div> }

function UniversityPatternBand(){return <div className="university-pattern-band" aria-hidden="true">{Array.from({length:10},(_,index)=><i key={index}/>)}</div>}
function CompletionMascot(){return <img className="completion-mascot" src={kangnamWelcomeMascot} alt="두 팔을 벌려 환영하는 강남대학교 마스코트"/>}

function ThemeIcon({theme}:{theme:SelectableTheme}) {
  if(theme==='kangnam')return <img src={kangnamUniversityLogo} alt="" aria-hidden="true"/>
  if(theme==='spring')return <Flower2 aria-hidden="true"/>
  if(theme==='summer')return <Waves aria-hidden="true"/>
  if(theme==='autumn')return <Leaf aria-hidden="true"/>
  if(theme==='winter')return <Snowflake aria-hidden="true"/>
  return <Sparkles aria-hidden="true"/>
}

function ThemeDecoration({theme}:{theme:Theme}) {
  if(theme==='kangnam')return <div className="kangnam-decor" aria-hidden="true"><img src={kangnamUniversityLogo} alt=""/></div>
  if(theme==='spring')return <div className="seasonal-decor spring-decor" aria-hidden="true"><Flower2/><Flower2/><Flower2/></div>
  if(theme==='summer')return <div className="seasonal-decor summer-decor" aria-hidden="true"><Sun/><Waves/><Waves/></div>
  if(theme==='autumn')return <div className="seasonal-decor autumn-decor" aria-hidden="true"><Leaf/><Leaf/><Leaf/></div>
  if(theme==='winter')return <div className="seasonal-decor winter-decor" aria-hidden="true"><Snowflake/><Snowflake/><Snowflake/></div>
  return null
}

function FormCover({program,theme,headingLevel='preview',branding}:{program:ProgramInfo;theme:Theme;headingLevel?:'preview'|'public';branding?:FormSettings['branding']}) {
  const eyebrow=theme==='spring'?'SPRING FORM':theme==='summer'?'SUMMER FORM':theme==='autumn'?'AUTUMN FORM':theme==='winter'?'WINTER FORM':theme==='kangnam'?'KANGNAM UNIVERSITY':theme==='blue'?'OFFICIAL FORM':theme==='coral'?'WELCOME FORM':'PROGRAM FORM'
  const icon=branding?.icon==='calendar'?<CalendarClock/>:branding?.icon==='graduation'?<GraduationCap/>:branding?.icon==='heart'?<Heart/>:branding?.icon==='clipboard'?<ClipboardList/>:null
  return <div className="form-cover" style={branding?.headerImageUrl?{backgroundImage:`linear-gradient(90deg,#0d2b26dd,#0d2b2677),url("${branding.headerImageUrl.replace(/["\\]/g,'')}")`}:undefined}><ThemeDecoration theme={theme}/><div className="form-cover-content">{icon&&<div className="form-cover-icon" aria-hidden="true">{icon}</div>}<span>{eyebrow}</span>{headingLevel==='public'?<h1>{program.programName||'폼 제목'}</h1>:<h2>{program.programName||'폼 제목'}</h2>}<p>{program.description||'폼 설명이 표시됩니다.'}</p></div></div>
}

function FormBody({program,questions,theme,branding}:{program:ProgramInfo;questions:FormQuestion[];theme:Theme;branding?:FormSettings['branding']}) {
  const previewStyle = theme==='green'?{backgroundColor:branding?.backgroundColor,'--accent':branding?.accentColor} as CSSProperties:undefined
  return <div className={`form-body theme-${theme}`} style={previewStyle}><FormCover program={program} theme={theme} branding={branding}/>{questions.map((q,i)=>{const options=q.options?.length?q.options:['선택지 1','선택지 2'];return <label className="form-question" key={q.id}><span>{i+1}. {q.label} {q.required&&<em>*</em>}</span>{q.imageUrl&&<img className="question-response-image" src={q.imageUrl} alt={`${q.label} 질문 이미지`}/>} {q.type==='select'&&q.optionImageUrls?.some(Boolean)&&<div className="option-image-gallery">{options.map((option,index)=>q.optionImageUrls?.[index]?<span key={`${option}-${index}`}><img src={q.optionImageUrls[index]} alt=""/><small>{option}</small></span>:null)}</div>}{q.type==='long_text'?<textarea disabled/>:q.type==='select'?<select disabled><option>선택해 주세요</option>{options.map((o,index)=><option key={`${o}-${index}`}>{o}</option>)}</select>:q.type==='rating'?<div className="rating">{[1,2,3,4,5].map(n=><i key={n}>{n}</i>)}</div>:q.type==='checkbox'?<div className="checkbox-options preview-options">{options.map((option,index)=><span className="check-line option-with-image" key={`${option}-${index}`}>□ <span>{option}</span>{q.optionImageUrls?.[index]&&<img src={q.optionImageUrls[index]} alt=""/>}</span>)}</div>:q.type==='consent'?<div className="check-line">□ 동의합니다</div>:q.type==='file'?<div className="file-upload-preview"><Upload/> 파일 선택</div>:<input disabled type={q.inputFormat==='email'?'email':q.inputFormat==='phone'?'tel':q.type==='number'?'number':'text'} placeholder={q.inputFormat==='email'?'name@example.com':q.inputFormat==='phone'?'010-0000-0000':undefined}/>}</label>})}</div>
}

function stableShuffle<T>(items:T[],seed:string){
  const score=(value:T)=>[...`${seed}:${String(value)}`].reduce((sum,char)=>((sum*33)^char.charCodeAt(0))>>>0,5381)
  return [...items].sort((left,right)=>score(left)-score(right))
}

function fontFamilyForBranding(branding:FormSettings['branding']){
  if(branding.fontPreset==='serif')return '"Noto Serif KR", "Batang", serif'
  if(branding.fontPreset==='rounded')return '"Arial Rounded MT Bold", "NanumSquareRound", sans-serif'
  if(branding.fontPreset==='custom'&&branding.customFontFamily)return `"${branding.customFontFamily}", sans-serif`
  return 'Inter, Pretendard, system-ui, sans-serif'
}

function QuizCompletion({result,questions,message,branding,onLogout}:{result:QuizResult;questions:FormQuestion[];message:string;branding:FormSettings['branding'];onLogout:()=>void}){
  return <main className="public-shell theme-green" style={{fontFamily:fontFamilyForBranding(branding)}}><div className="complete card"><CompletionMascot/><CheckCircle2/><h1>응답 제출 완료</h1><p>{message}</p><section className="quiz-result" aria-live="polite">{result.released?<><span className="eyebrow">QUIZ RESULT</span><h2>{result.score} / {result.maxScore}점</h2><strong>{result.percentage}%</strong>{result.questions?.map(item=><div key={item.questionId} className={item.correct?'correct':'incorrect'}><b>{questions.find(question=>question.id===item.questionId)?.label}</b><span>{item.earnedPoints} / {item.possiblePoints}점</span>{item.correctAnswers?.length?<small>정답: {item.correctAnswers.join(', ')}</small>:null}{item.feedback&&<small>{item.feedback}</small>}</div>)}</>:<><h2>채점 결과는 검토 후 공개됩니다</h2><p>제작자가 결과를 공개하면 확인할 수 있습니다.</p></>}</section><div className="complete-actions"><a className="primary link" href="/"><House/> 대플폼 홈으로</a><button type="button" onClick={onLogout}><LogOut/> 세션 종료</button></div></div></main>
}

function PublicForm({user,formId,program,questions,theme,endDate,settings,preview,publicResults,onLogout}:{
  user:FirebaseUser;formId:string;program:ProgramInfo;questions:FormQuestion[];theme:Theme;endDate:string;settings:FormSettings;preview:boolean;publicResults:boolean;onLogout:()=>void
}) {
  const [answers,setAnswers]=useState<Record<number,PublicAnswerValue>>(()=>{
    const initial:Record<number,PublicAnswerValue>={}
    const parameters=new URLSearchParams(location.search)
    questions.forEach((question)=>{
      const value=parameters.get(`q${question.id}`)
      if(value===null)return
      if(question.type==='rating'||question.type==='number')initial[question.id]=Number(value)
      else if(question.type==='checkbox'||question.type==='consent')initial[question.id]=value==='true'
      else initial[question.id]=value
    })
    return initial
  })
  const [submissionStatus,setSubmissionStatus]=useState<SubmissionStatus>(preview?'ready':'checking')
  const [checkAttempt,setCheckAttempt]=useState(0)
  const [submitting,setSubmitting]=useState(false)
  const [error,setError]=useState('')
  const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({})
  const [lastSaved,setLastSaved]=useState('')
  const [draftError,setDraftError]=useState('')
  const [pageIndex,setPageIndex]=useState(0)
  const [respondentName,setRespondentName]=useState(user.displayName??'')
  const [studentId,setStudentId]=useState('')
  const [respondentEmail,setRespondentEmail]=useState('')
  const [attachments,setAttachments]=useState<ResponseAttachment[]>([])
  const [uploadProgress,setUploadProgress]=useState<Record<number,number>>({})
  const [uploadError,setUploadError]=useState<Record<number,string>>({})
  const [submittedResponse,setSubmittedResponse]=useState<StoredFormResponse|null>(null)
  const [showOwnDetails,setShowOwnDetails]=useState(false)
  const [editingSubmitted,setEditingSubmitted]=useState(false)
  const [publicResult,setPublicResult]=useState<{total:number;summaries:QuestionSummary[]}|null>(null)
  const [quizResult,setQuizResult]=useState<QuizResult|null>(null)
  const [userGroups,setUserGroups]=useState<string[]>([])
  const availability=getFormAvailability(settings)
  const displayQuestions=useMemo(()=>{
    if(!settings.submission.randomizeQuestions)return questions
    const score=(id:number)=>[...`${user.uid}:${id}`].reduce((sum,char)=>((sum*31)+char.charCodeAt(0))>>>0,7)
    return [...questions].sort((left,right)=>score(left.id)-score(right.id))
  },[questions,settings.submission.randomizeQuestions,user.uid])
  const sections=useMemo(()=>{
    const keys=[...new Set(displayQuestions.map(question=>question.sectionId??'default'))]
    return keys.map(key=>displayQuestions.filter(question=>(question.sectionId??'default')===key))
  },[displayQuestions])
  const visibleQuestions=sections[pageIndex]??displayQuestions
  const loginRequired=settings.access.participation!=='anyone'
  const kangnamUser=Boolean(user.emailVerified&&user.email?.toLowerCase().endsWith('@kangnam.ac.kr'))
  const participantAllowed=settings.access.participation==='anyone'
    ||(settings.access.participation==='authenticated'&&!user.isAnonymous)
    ||(settings.access.participation==='kangnam'&&kangnamUser)
    ||(settings.access.participation==='allowlist'&&Boolean((user.email&&settings.access.allowedEmails.map(value=>value.toLowerCase()).includes(user.email.toLowerCase()))||settings.access.allowedGroups.some(group=>userGroups.includes(group))))

  useEffect(()=>{
    if(settings.branding.fontPreset!=='custom'||!settings.branding.customFontUrl?.startsWith('https://'))return
    const link=document.createElement('link')
    link.rel='stylesheet';link.href=settings.branding.customFontUrl;link.dataset.daepulCustomFont='true'
    document.head.append(link)
    return()=>link.remove()
  },[settings.branding.customFontUrl,settings.branding.fontPreset])

  useEffect(()=>{
    if(user.isAnonymous)return
    let active=true
    void user.getIdTokenResult().then((token)=>{if(!active)return;setUserGroups(Array.isArray(token.claims.groups)?token.claims.groups.map(String):[]);if(typeof token.claims.studentId==='string')setStudentId(token.claims.studentId);if(typeof token.claims.name==='string')setRespondentName(token.claims.name)})
    return()=>{active=false}
  },[user])

  useEffect(()=>{
    if(preview||!settings.submission.allowDrafts)return
    let active=true
    const localKey=`daepul-response-draft:${formId}:${user.uid}`
    void loadResponseDraft(formId,user.uid).catch(()=>null).then((draft)=>{
      if(!active)return
      let recovered=draft
      if(!recovered)try{recovered=JSON.parse(localStorage.getItem(localKey)??'null')}catch{recovered=null}
      if(!recovered)return
      if(recovered.formVersion!==settings.version){setDraftError('폼이 변경되어 이전 초안에서 일치하는 질문만 복구했습니다. 파일은 다시 선택해야 합니다.')}
      setAnswers(Object.fromEntries(Object.entries(recovered.answers).filter(([id])=>questions.some(question=>String(question.id)===id))) as Record<number,PublicAnswerValue>)
      setLastSaved(recovered.updatedAt)
    })
    return()=>{active=false}
  },[formId,user.uid,preview,questions,settings.submission.allowDrafts,settings.version])

  useEffect(()=>{
    if(preview||!settings.submission.allowDrafts||!Object.keys(answers).length||(submissionStatus!=='ready'&&!editingSubmitted))return
    const timer=window.setTimeout(()=>{
      const draft={formId,actorId:user.uid,formVersion:settings.version,answers:Object.fromEntries(Object.entries(answers).map(([key,value])=>[key,value])),updatedAt:new Date().toISOString()}
      try{localStorage.setItem(`daepul-response-draft:${formId}:${user.uid}`,JSON.stringify(draft))}catch{setDraftError('브라우저에 초안을 저장하지 못했습니다.')}
      void saveResponseDraft(draft).then(()=>{setLastSaved(new Date().toISOString());setDraftError('')}).catch(()=>setDraftError('초안 동기화에 실패했습니다. 브라우저에는 계속 저장합니다.'))
    },700)
    return()=>window.clearTimeout(timer)
  },[answers,editingSubmitted,formId,user.uid,preview,settings.submission.allowDrafts,settings.version,submissionStatus])

  useEffect(()=>{
    if(preview||settings.access.allowMultiple){setSubmissionStatus('ready');return}
    let active=true
    setSubmissionStatus('checking');setError('')
    void hasSubmittedResponse(formId,user.uid)
      .then((submitted)=>{if(active)setSubmissionStatus(submitted?'already-submitted':'ready')})
      .catch(()=>{if(active)setSubmissionStatus('check-error')})
    return()=>{active=false}
  },[formId,user.uid,preview,settings.access.allowMultiple,checkAttempt])

  useEffect(()=>{
    if(preview||!['submitted-now','already-submitted'].includes(submissionStatus)||(!settings.submission.showOwnResponse&&!settings.submission.allowEditAfterSubmit))return
    let active=true
    void getOwnResponse(formId).then((response)=>{if(active){setSubmittedResponse(response);setQuizResult(response?.quizResult??null)}}).catch(()=>undefined)
    return()=>{active=false}
  },[formId,preview,settings.submission.allowEditAfterSubmit,settings.submission.showOwnResponse,submissionStatus])

  useEffect(()=>{
    if(!publicResults||!settings.submission.showPublicResults)return
    let active=true
    void getPublicResultSummary(formId).then((result)=>{if(active)setPublicResult(result)}).catch(()=>setError('공개 결과를 불러오지 못했습니다.'))
    return()=>{active=false}
  },[formId,publicResults,settings.submission.showPublicResults])

  const updateAnswer=(question:FormQuestion,value:PublicAnswerValue)=>{
    const next={...answers,[question.id]:value}
    setAnswers(next)
    const nextErrors=validateAnswers([question],Object.fromEntries(Object.entries(next).map(([key,item])=>[key,item])))
    setFieldErrors(current=>({...current,[String(question.id)]:nextErrors[String(question.id)]??''}))
  }
  const continueFromPage=()=>{
    const errors=validateAnswers(visibleQuestions,Object.fromEntries(Object.entries(answers)))
    setFieldErrors(errors)
    if(Object.keys(errors).length)return
    const branchTarget=visibleQuestions.map((question)=>question.branch?.[String(answers[question.id])]).find(Boolean)
    if(branchTarget==='submit'){void submit();return}
    if(branchTarget){
      const targetIndex=sections.findIndex(section=>(section[0]?.sectionId??'default')===branchTarget)
      if(targetIndex>=0){setPageIndex(targetIndex);return}
    }
    setPageIndex(index=>Math.min(sections.length-1,index+1))
  }
  const submit=async()=>{
    if(preview)return
    if(settings.access.identityCollection==='profile'&&(!respondentName.trim()||!studentId.trim())){setError('이름과 학번을 입력해 주세요.');return}
    if(settings.access.identityCollection==='email_input'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(respondentEmail)){setError('올바른 이메일을 입력해 주세요.');return}
    const errors=validateAnswers(questions,Object.fromEntries(Object.entries(answers).map(([key,value])=>[key,value])))
    if(Object.keys(errors).length){setFieldErrors(errors);setError('필수 질문과 입력 형식을 확인해 주세요.');document.getElementById(`question-${Object.keys(errors)[0]}-input`)?.focus();return}
    setSubmitting(true);setError('')
    try{
      if(editingSubmitted)setQuizResult(await updateOwnResponse(formId,answers,{name:respondentName,studentId,email:respondentEmail}))
      else{
        setQuizResult(await submitResponseOnce({formId,user,answers,surveyEndDate:endDate,questions,settings,respondentName,studentId,respondentEmail,attachments}))
        try{localStorage.removeItem(`daepul-response-draft:${formId}:${user.uid}`)}catch{/* submission already succeeded */}
        void deleteResponseDraft(formId,user.uid).catch(()=>undefined)
      }
      setSubmittedResponse({id:submittedResponse?.id??user.uid,formId,answers:Object.fromEntries(Object.entries(answers).map(([key,value])=>[key,value])),respondentName,studentId,respondentEmail,submittedAt:submittedResponse?.submittedAt??new Date().toISOString(),updatedAt:new Date().toISOString(),status:'submitted',attachments})
      setEditingSubmitted(false)
      setSubmissionStatus('submitted-now')
    }
    catch(e){if(e instanceof Error&&e.message==='already-submitted')setSubmissionStatus('already-submitted');else setError(e instanceof Error&&e.message!=='server-validation-failed'?e.message:'서버 검증을 통과하지 못했거나 제출에 실패했습니다. 접수 상태와 입력 내용을 확인해 주세요.')}
    finally{setSubmitting(false)}
  }

  if(publicResults){
    if(!settings.submission.showPublicResults)return <main className={`public-shell theme-${theme}`}><div className="complete card"><h1>공개되지 않은 결과입니다</h1><p>제작자가 익명 집계 결과 공개를 허용하지 않았습니다.</p><a className="link" href={`/?form=${encodeURIComponent(formId)}`}>응답 화면으로</a></div></main>
    return <main className={`public-shell theme-${theme}`}><div className="complete card"><BarChart3/><h1>{program.programName} 결과</h1>{!publicResult&&!error&&<LoaderCircle className="spin"/>}{publicResult&&<div className="public-result-summary"><h2>익명 집계 · {publicResult.total}명</h2>{publicResult.summaries.map(summary=><section key={summary.questionId}><b>{summary.label}</b>{summary.average!==undefined&&<p>평균 {summary.average.toFixed(1)}</p>}{summary.distribution?.map(item=><p key={item.label}>{item.label}: {item.count}명</p>)}</section>)}</div>}{error&&<Notice text={error}/>}<a className="primary link" href={`/?form=${encodeURIComponent(formId)}`}>응답 화면으로</a></div></main>
  }
  if(!preview&&availability.state!=='open')return <main className={`public-shell theme-${theme}`}><div className="complete card"><CalendarClock/><h1>{availability.message}</h1><p>접수 상태가 변경되면 이 페이지를 새로고침해 주세요.</p><a className="link" href="/"><House/> 대플폼 홈으로</a></div></main>
  if(!preview&&loginRequired&&!participantAllowed)return <main className={`public-shell theme-${theme}`}><div className="complete card"><LogIn/><h1>로그인이 필요한 폼입니다</h1><p>{settings.access.participation==='kangnam'?'인증된 @kangnam.ac.kr 계정으로 로그인해 주세요.':'제작자가 허용한 계정으로 로그인해 주세요.'}</p><div className="complete-actions"><a className="primary link" href={`/?form=${encodeURIComponent(formId)}&login=1`}><LogIn/> 로그인</a><button onClick={onLogout}><LogOut/> 현재 세션 종료</button></div></div></main>
  if(submissionStatus==='checking')return <div className="center" role="status" aria-label="제출 이력 확인 중"><LoaderCircle className="spin"/></div>
  if(submissionStatus==='check-error')return <main className={`public-shell theme-${theme}`}><div className="complete card"><h1>제출 이력을 확인하지 못했습니다</h1><p>네트워크 연결을 확인한 뒤 다시 시도해 주세요.</p><div className="complete-actions"><button type="button" className="primary" onClick={()=>setCheckAttempt((attempt)=>attempt+1)}><RefreshCcw/> 다시 시도</button><a className="link" href="/"><House/> 대플폼 홈으로</a></div></div></main>
  if((submissionStatus==='submitted-now'||submissionStatus==='already-submitted')&&!editingSubmitted){
    const submittedNow=submissionStatus==='submitted-now'
    if(quizResult)return <QuizCompletion result={quizResult} questions={questions} message={submittedNow?settings.submission.completionMessage:'제출한 퀴즈 결과입니다.'} branding={settings.branding} onLogout={onLogout}/>
    return <main className={`public-shell theme-${theme}`}><div className="complete card"><CompletionMascot/><CheckCircle2/><h1>{submittedNow?'응답 제출 완료':'이미 제출한 폼입니다'}</h1><p>{submittedNow?settings.submission.completionMessage:'현재 계정 또는 브라우저에서 이미 제출했습니다. 비로그인 1회 제한은 브라우저 기준이며 완전한 본인 확인 수단은 아닙니다.'}</p><div className="complete-actions"><a className="primary link" href="/"><House/> 대플폼 홈으로</a>{settings.submission.showOwnResponse&&<button onClick={()=>setShowOwnDetails(value=>!value)}><Eye/> 내 답변 확인</button>}{settings.submission.allowEditAfterSubmit&&submittedResponse&&<button onClick={()=>{setAnswers(Object.fromEntries(Object.entries(submittedResponse.answers).map(([key,value])=>[Number(key),toPublicAnswer(value)])));setRespondentName(submittedResponse.respondentName??'');setStudentId(submittedResponse.studentId??'');setRespondentEmail(submittedResponse.respondentEmail??'');setEditingSubmitted(true);setPageIndex(0)}}>답변 수정</button>}{settings.submission.showPublicResults&&<button onClick={()=>void getPublicResultSummary(formId).then(setPublicResult).catch(()=>setError('공개 결과를 불러오지 못했습니다.'))}><BarChart3/> 전체 결과</button>}<button type="button" onClick={onLogout}><LogOut/> 세션 종료</button></div>{showOwnDetails&&submittedResponse&&<div className="submitted-answer-review"><h2>제출한 답변</h2>{questions.map((question,index)=><section key={question.id}><b>{index+1}. {question.label}</b><p>{String(submittedResponse.answers[String(question.id)]??'미응답')}</p></section>)}<button onClick={()=>window.print()}><Download/> 인쇄 / PDF</button></div>}{publicResult&&<div className="public-result-summary"><h2>익명 집계 결과 · {publicResult.total}명</h2>{publicResult.summaries.map(summary=><section key={summary.questionId}><b>{summary.label}</b>{summary.average!==undefined&&<p>평균 {summary.average.toFixed(1)}</p>}{summary.distribution?.map(item=><p key={item.label}>{item.label}: {item.count}명</p>)}</section>)}</div>}{error&&<Notice text={error}/>}</div></main>
  }

  return <main id="main-content" className={`public-shell theme-${theme}`} style={{fontFamily:fontFamilyForBranding(settings.branding),...(theme==='green'?{backgroundColor:settings.branding.backgroundColor,'--accent':settings.branding.accentColor}:{})} as CSSProperties}>
    <div className="public-user">{preview&&<strong className="preview-chip"><Eye size={14}/> 미리보기</strong>}<span>{user.isAnonymous?'익명 참여':user.email}</span><button type="button" onClick={onLogout}><LogOut/> 나가기</button></div>
    <div className="public-form card">
      {preview&&<div className="preview-banner" role="status"><Eye aria-hidden="true"/><div><b>응답 화면 미리보기</b><span>입력 화면을 확인할 수 있지만 실제 응답은 제출되지 않습니다.</span></div></div>}
      <FormCover program={program} theme={theme} headingLevel="public" branding={settings.branding}/>
      <div className="form-progress"><div><b style={{width:`${(pageIndex+1)/Math.max(1,sections.length)*100}%`}}/></div><span>{pageIndex+1} / {Math.max(1,sections.length)} 페이지</span></div>
      {user.isAnonymous&&!settings.access.allowMultiple&&<div className="anonymous-limit-note">이 브라우저에서 중복 제출을 방지합니다. 브라우저 데이터 삭제·기기 변경까지 막는 완전한 1인 1회 제한은 아닙니다.</div>}
      {draftError&&<div className="notice draft-error"><span>{draftError}</span><button type="button" onClick={()=>{const draft={formId,actorId:user.uid,formVersion:settings.version,answers:Object.fromEntries(Object.entries(answers)),updatedAt:new Date().toISOString()};void saveResponseDraft(draft).then(()=>{setLastSaved(new Date().toISOString());setDraftError('')}).catch(()=>setDraftError('초안 저장 재시도에 실패했습니다.'))}}><RefreshCcw/> 다시 저장</button></div>}
      {settings.submission.allowDrafts&&lastSaved&&<div className="draft-status" role="status">방금 저장됨 · {new Intl.DateTimeFormat('ko-KR',{timeStyle:'short'}).format(new Date(lastSaved))}</div>}
      {settings.access.identityCollection==='profile'&&<div className="identity-fields"><label>이름<input value={respondentName} onChange={event=>setRespondentName(event.target.value)} required/></label><label>학번<input inputMode="numeric" value={studentId} onChange={event=>setStudentId(event.target.value)} required/></label></div>}
      {settings.access.identityCollection==='email_input'&&<div className="identity-fields"><label>이메일<input type="email" inputMode="email" value={respondentEmail} onChange={event=>setRespondentEmail(event.target.value)} required/></label></div>}
      {visibleQuestions.map((q)=>{
        const questionIndex=questions.findIndex(item=>item.id===q.id)
        const labelId=`question-${q.id}-label`
        const inputId=`question-${q.id}-input`
        const fieldError=fieldErrors[String(q.id)]
        return <div className={`form-question ${fieldError?'invalid':''}`} key={q.id}>
          <span id={labelId}>{questionIndex+1}. {q.label} {q.required&&<em aria-label="필수">*</em>}</span>{q.description&&<small>{q.description}</small>}{q.imageUrl&&<img className="question-response-image" src={q.imageUrl} alt={`${q.label} 질문 이미지`}/>}
          {q.type==='select'&&q.options?.length&&q.optionImageUrls?.some(Boolean)&&<div className="option-image-gallery">{q.options.map((option,index)=>q.optionImageUrls?.[index]?<span key={`${option}-${index}`}><img src={q.optionImageUrls[index]} alt=""/><small>{option}</small></span>:null)}</div>}
          {q.type==='long_text'?<textarea id={inputId} aria-labelledby={labelId} aria-invalid={Boolean(fieldError)} value={String(answers[q.id]??'')} onChange={e=>updateAnswer(q,e.target.value)}/>
          :q.type==='select'?<select id={inputId} aria-labelledby={labelId} aria-invalid={Boolean(fieldError)} value={String(answers[q.id]??'')} onChange={e=>updateAnswer(q,e.target.value)}><option value="">선택해 주세요</option>{(q.randomizeOptions?stableShuffle(q.options?.length?q.options:['예','아니오'],`${user.uid}:${q.id}`):(q.options?.length?q.options:['예','아니오'])).map(o=><option key={o}>{o}</option>)}</select>
          :q.type==='rating'?<div id={inputId} className="rating input" role="radiogroup" aria-labelledby={labelId}>{[1,2,3,4,5].map(n=><button className={answers[q.id]===n?'active':''} aria-checked={answers[q.id]===n} role="radio" onClick={()=>updateAnswer(q,n)} type="button" key={n}>{n}</button>)}</div>
          :q.type==='consent'?<label className="check-line" htmlFor={inputId}><input id={inputId} type="checkbox" checked={Boolean(answers[q.id])} onChange={e=>updateAnswer(q,e.target.checked)}/><span>개인정보 수집·이용에 동의합니다.</span></label>
          :q.type==='checkbox'&&q.options?.length?<fieldset id={inputId} className="checkbox-options" aria-labelledby={labelId}>{q.maxSelections&&<small className="selection-limit">최대 {q.maxSelections}개까지 선택할 수 있습니다.</small>}{(q.randomizeOptions?stableShuffle(q.options,`${user.uid}:${q.id}`):q.options).map((option,index)=>{const selected=Array.isArray(answers[q.id])?answers[q.id] as string[]:[];const selectionLimitReached=Boolean(q.maxSelections&&selected.length>=q.maxSelections&&!selected.includes(option));const originalIndex=q.options?.indexOf(option)??index;return <label className="check-line option-with-image" key={option}><input type="checkbox" checked={selected.includes(option)} disabled={selectionLimitReached} onChange={event=>updateAnswer(q,event.target.checked&&(!q.maxSelections||selected.length<q.maxSelections)?[...selected,option]:selected.filter(item=>item!==option))}/><span>{option}</span>{q.optionImageUrls?.[originalIndex]&&<img src={q.optionImageUrls[originalIndex]} alt=""/>}{index===0&&<span className="sr-only">여러 개 선택 가능</span>}</label>})}</fieldset>
          :q.type==='checkbox'?<label className="check-line" htmlFor={inputId}><input id={inputId} type="checkbox" checked={Boolean(answers[q.id])} onChange={e=>updateAnswer(q,e.target.checked)}/><span>선택합니다.</span></label>
          :q.type==='file'?<div className="response-file-upload"><input id={inputId} type="file" onChange={event=>{const file=event.target.files?.[0];if(!file)return;setUploadError(current=>({...current,[q.id]:''}));void uploadResponseAttachment({formId,user,questionId:q.id,file,onProgress:percentage=>setUploadProgress(current=>({...current,[q.id]:percentage}))}).then(attachment=>{setAttachments(current=>[...current.filter(item=>item.questionId!==q.id),attachment]);updateAnswer(q,attachment.name)}).catch(uploadIssue=>setUploadError(current=>({...current,[q.id]:uploadIssue instanceof Error&&uploadIssue.message==='file-too-large'?'파일은 20MB 이하만 업로드할 수 있습니다.':'업로드에 실패했습니다. 다시 선택해 주세요.'})))}}/>{uploadProgress[q.id]>0&&uploadProgress[q.id]<100&&<progress value={uploadProgress[q.id]} max="100">{uploadProgress[q.id]}%</progress>}{attachments.find(item=>item.questionId===q.id)&&<small>{attachments.find(item=>item.questionId===q.id)?.name} 업로드 완료</small>}{uploadError[q.id]&&<small className="field-error" role="alert">{uploadError[q.id]}</small>}</div>
          :<input id={inputId} aria-labelledby={labelId} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError?`${inputId}-error`:undefined} inputMode={q.inputFormat==='email'?'email':q.inputFormat==='phone'?'tel':q.type==='number'?'numeric':undefined} type={q.inputFormat==='email'?'email':q.inputFormat==='phone'?'tel':q.type==='number'?'number':'text'} placeholder={q.inputFormat==='email'?'name@example.com':q.inputFormat==='phone'?'010-0000-0000':undefined} min={q.min} max={q.max} value={String(answers[q.id]??'')} onChange={e=>updateAnswer(q,q.type==='number'&&e.target.value!==''?Number(e.target.value):e.target.value)}/>}
          {fieldError&&<small id={`${inputId}-error`} className="field-error" role="alert">{fieldError}</small>}
        </div>
      })}
      <div className="public-actions">
        {error&&<Notice text={error}/>}
        <div className="page-actions">{pageIndex>0&&<button type="button" onClick={()=>setPageIndex(index=>index-1)}><ChevronLeft/> 이전</button>}
          {pageIndex<sections.length-1?<button type="button" className="primary" onClick={continueFromPage}>다음 <ChevronRight/></button>
          :<button type="button" className="primary submit-response" onClick={()=>void submit()} disabled={preview||submitting}>{submitting?<LoaderCircle className="spin"/>:preview?<Eye/>:<Send/>} {preview?'미리보기에서는 제출할 수 없습니다':editingSubmitted?'수정 내용 저장':settings.submission.submitLabel}</button>}</div>
        <small>{preview?'실제 공개 링크에서는 제출할 수 있습니다.':editingSubmitted?'제출한 답변을 수정하고 있습니다.':settings.submission.allowEditAfterSubmit?'제출 후 답변 수정이 허용됩니다.':'제출 후에는 제작자 설정에 따라 수정이 제한됩니다.'}</small>
      </div>
    </div>
  </main>
}
