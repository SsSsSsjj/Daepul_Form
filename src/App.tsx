import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { CheckCircle2, ChevronDown, Copy, Download, FileText, Flower2, Leaf, LayoutDashboard, LoaderCircle, LogIn, LogOut, Palette, Plus, QrCode, RefreshCcw, Send, Snowflake, Sparkles, Sun, Trash2, Upload, UserRound, WandSparkles, Waves } from 'lucide-react'
import QRCode from 'qrcode'
import writeXlsxFile, { type SheetData } from 'write-excel-file/browser'
import {
  completeSocialLoginCallback, deleteFormRecord, firebaseConfigured, generateFormFromDocuments, getFormResponses,
  getOwnedForms, getPublishedForm, hasSocialLoginCallback, hasSubmittedResponse, loginFailureMessage, logout,
  observeAuthState, publishFormRecord, signInWithEmail, signInWithGoogle, startSocialLogin,
  submitResponseOnce, summarizeResponses, type FirebaseUser, type LoginProvider,
} from './firebase'
import type { FormQuestion, FormType, ProgramInfo, QuestionSummary, ResponseTopic, StoredFormResponse } from './types'

type Page = 'create' | 'edit' | 'publish' | 'results' | 'manage'
type Theme = 'green' | 'spring' | 'summer' | 'autumn' | 'winter' | 'blue' | 'coral'
type SelectableTheme = Exclude<Theme, 'blue' | 'coral'>
type OwnedForm = { id: string; title: string; published: boolean; responseCount: number }

const emptyProgram: ProgramInfo = { programName: '', description: '', target: '', period: '', schedule: '', capacity: '', requirements: '', privacyConsent: '' }
const typeLabels = { short_text: '단답형', long_text: '장문형', select: '객관식', checkbox: '체크박스', consent: '개인정보 동의', rating: '1~5점 평점', number: '숫자' }
const draftStorageKey = 'daepul-form-creator-draft'
const selectableThemes: Array<{ id: SelectableTheme; label: string; description: string }> = [
  { id: 'green', label: '기본 디자인', description: '단정하고 편안한 기본 폼' },
  { id: 'spring', label: '봄', description: '벚꽃과 새싹의 화사함' },
  { id: 'summer', label: '여름', description: '햇살과 바다의 청량함' },
  { id: 'autumn', label: '가을', description: '단풍과 노을의 따뜻함' },
  { id: 'winter', label: '겨울', description: '눈꽃과 새벽의 고요함' },
]

function normalizeTheme(value: string): Theme {
  return ['green', 'spring', 'summer', 'autumn', 'winter', 'blue', 'coral'].includes(value) ? value as Theme : 'green'
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
}

function getCreatorDraft(): Partial<CreatorDraft> {
  try {
    return JSON.parse(localStorage.getItem(draftStorageKey) ?? '{}') as Partial<CreatorDraft>
  } catch {
    return {}
  }
}

function answerForExcel(value: string | boolean | number | undefined) {
  if (value === true) return '동의'
  if (value === false) return '미동의'
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

function analyzeStoredResponses(questions: FormQuestion[], responses: StoredFormResponse[]): QuestionSummary[] {
  return questions.map((question) => {
    const values = responses.map((response) => response.answers[String(question.id)]).filter((value) => value !== undefined && value !== '' && value !== false)
    if (question.type === 'rating' || question.type === 'number') {
      const numbers = values.map(Number).filter(Number.isFinite)
      const labels = question.type === 'rating' ? ['1', '2', '3', '4', '5'] : [...new Set(numbers.map(String))].sort((a, b) => Number(a) - Number(b))
      return { questionId: question.id, label: question.label, type: question.type, responseCount: numbers.length, average: numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0, distribution: labels.map((label) => ({ label, count: numbers.filter((number) => String(number) === label).length })) }
    }
    if (question.type === 'select' || question.type === 'checkbox' || question.type === 'consent') {
      const labels = question.options?.length ? question.options : question.type === 'select' ? [...new Set(values.map(String))] : ['동의']
      return { questionId: question.id, label: question.label, type: question.type, responseCount: values.length, distribution: labels.map((label) => ({ label, count: values.filter((value) => String(value) === label || (label === '동의' && value === true)).length })) }
    }
    return { questionId: question.id, label: question.label, type: question.type, responseCount: values.length, texts: values.map(String) }
  })
}

export default function App() {
  const initialDraft = useMemo(getCreatorDraft, [])
  const requestedFormId = useMemo(() => new URLSearchParams(location.search).get('form'), [])
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  const [loginProvider, setLoginProvider] = useState<LoginProvider | null>(null)
  const [authCallbackPending, setAuthCallbackPending] = useState(hasSocialLoginCallback)
  const [page, setPage] = useState<Page>('create')
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
  const [published, setPublished] = useState(false)
  const [publishLoading, setPublishLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [responses, setResponses] = useState<StoredFormResponse[]>([])
  const [resultLoading, setResultLoading] = useState(false)
  const [topics, setTopics] = useState<ResponseTopic[]>([])
  const [ownedForms, setOwnedForms] = useState<OwnedForm[]>([])
  const [deletingFormId, setDeletingFormId] = useState('')
  const [publicFormLoaded, setPublicFormLoaded] = useState(false)
  const [qr, setQr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const shareLink = `${location.origin}/?form=${formId}`
  const summaries = useMemo(() => analyzeStoredResponses(questions, responses), [questions, responses])

  useEffect(() => observeAuthState((nextUser) => { setUser(nextUser); setAuthReady(true) }), [])
  useEffect(() => {
    if (requestedFormId) return
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({ memo, program, questions, formType, theme, endDate } satisfies CreatorDraft))
    } catch {
      // Keep editing available even when browser storage is blocked or full.
    }
  }, [memo, program, questions, formType, theme, endDate, requestedFormId])
  useEffect(() => {
    if (!authCallbackPending) return
    void completeSocialLoginCallback().then((error) => {
      setAuthError(error)
      setAuthCallbackPending(false)
    })
  }, [authCallbackPending])
  useEffect(() => {
    if (!user || !requestedFormId || publicFormLoaded) return
    void getPublishedForm(requestedFormId).then((form) => {
      setProgram(form.program); setQuestions(form.questions); setFormType(form.formType); setTheme(normalizeTheme(form.theme)); setEndDate(form.surveyEndDate); setFormId(requestedFormId); setPublicFormLoaded(true)
    }).catch(() => setAuthError('공개된 폼을 불러오지 못했습니다. 링크와 공개 상태를 확인해 주세요.'))
  }, [user, requestedFormId, publicFormLoaded])
  useEffect(() => { if (published) void QRCode.toDataURL(shareLink, { width: 240, margin: 2 }).then(setQr) }, [published, shareLink])

  const login = async (provider: LoginProvider, email = '', password = '') => {
    setLoginProvider(provider); setAuthError('')
    if (provider === 'kakao' || provider === 'naver') {
      startSocialLogin(provider)
      return
    }
    try {
      if (provider === 'google') await signInWithGoogle()
      else await signInWithEmail(email, password)
    } catch (error) {
      setAuthError(loginFailureMessage(error, provider))
    } finally {
      setLoginProvider(null)
    }
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
      setProgram(generated.program); setQuestions(generated.questions); setFormType(generated.formType); setReviewNotes(generated.reviewNotes); setPage('edit')
    } catch (error) {
      console.error(error)
      setAnalysisError(error instanceof Error && error.message.startsWith('HWP 파일')
        ? error.message
        : 'AI 문서 분석을 실행하지 못했습니다. Firebase Console에서 AI Logic(Gemini Developer API)을 활성화한 뒤 다시 시도해 주세요.')
    } finally { setAnalysisLoading(false) }
  }
  const publish = async () => {
    if (!user) return
    if (!program.programName || !questions.length) { setMessage('폼 제목과 질문을 확인해 주세요.'); return }
    setPublishLoading(true); setMessage('')
    try { await publishFormRecord({ formId, owner: user, program, questions, formType, surveyEndDate: endDate, theme }); setPublished(true); setMessage('실제 공개 링크가 생성되었습니다. 이제 응답이 Firestore에 저장됩니다.') }
    catch { setMessage('배포하지 못했습니다. 로그인과 Firestore 설정을 확인해 주세요.') }
    finally { setPublishLoading(false) }
  }
  const loadResults = async (targetFormId = formId) => {
    setResultLoading(true); setMessage(''); setTopics([])
    try {
      const form = targetFormId === formId ? { program, questions, formType, theme, surveyEndDate: endDate } : await getPublishedForm(targetFormId)
      setFormId(targetFormId); setProgram(form.program); setQuestions(form.questions); setFormType(form.formType); setTheme(normalizeTheme(form.theme)); setEndDate(form.surveyEndDate)
      const stored = await getFormResponses(targetFormId); setResponses(stored); setPage('results')
      const text = analyzeStoredResponses(form.questions, stored).filter((item) => item.type === 'long_text').flatMap((item) => item.texts ?? [])
      if (text.length) setTopics(await summarizeResponses(text))
    } catch { setMessage('응답을 불러오지 못했습니다. 폼 제작자 계정인지 확인해 주세요.') }
    finally { setResultLoading(false) }
  }
  const openManage = async () => {
    if (!user) return
    setMenuOpen(false); setPage('manage'); setResultLoading(true)
    try { setOwnedForms(await getOwnedForms(user.uid)) } catch { setMessage('내 폼 목록을 불러오지 못했습니다.') } finally { setResultLoading(false) }
  }
  const deleteOwnedForm = async (form: OwnedForm) => {
    if (!window.confirm(`“${form.title}” 폼과 응답 ${form.responseCount}건을 모두 삭제할까요?\n삭제한 데이터는 복구할 수 없습니다.`)) return
    setDeletingFormId(form.id); setMessage('')
    try {
      await deleteFormRecord(form.id)
      setOwnedForms((current) => current.filter((item) => item.id !== form.id))
      setMessage('폼과 관련 응답·분석 데이터를 삭제했습니다.')
      if (form.id === formId) { setPublished(false); setFormId(newFormId()) }
    } catch { setMessage('폼을 삭제하지 못했습니다. 제작자 계정인지 확인한 뒤 다시 시도해 주세요.') }
    finally { setDeletingFormId('') }
  }

  if (!authReady || authCallbackPending) return <div className="center"><LoaderCircle className="spin" /></div>
  if (!user) return <Login loadingProvider={loginProvider} error={authError} onLogin={login} />
  if (requestedFormId && publicFormLoaded) return <PublicForm user={user} formId={formId} program={program} questions={questions} theme={theme} endDate={endDate} onLogout={doLogout} />

  return <div className={`app theme-${theme}`}>
    <header><button className="brand" onClick={() => setPage('create')}>대플폼 <small>AI FORM BUILDER</small></button><nav><button onClick={() => setPage('create')}>새 폼</button><button onClick={() => void openManage()}>내 폼 관리</button><div className="user-menu"><button className="avatar" onClick={() => setMenuOpen(!menuOpen)}>{user.displayName?.[0] ?? 'U'} <ChevronDown size={14}/></button>{menuOpen && <div className="menu"><strong>{user.displayName}</strong><small>{user.email}</small><button onClick={() => void openManage()}><LayoutDashboard size={16}/> 내 폼 관리</button><button onClick={() => void doLogout()}><LogOut size={16}/> 로그아웃</button></div>}</div></nav></header>
    <main>
      {page === 'create' && <section><Title step="1" title="자료를 읽고 폼을 만듭니다" text="PDF·PNG·JPG·HWP 참고문서와 담당자 메모를 Gemini가 함께 분석합니다."/><div className="grid two"><div className="card"><h2>참고문서</h2><div className={`drop ${dragging ? 'dragging' : ''}`} onClick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}><Upload/><b>파일을 선택하거나 끌어 놓으세요</b><span>PDF, PNG, JPG, HWP, HWPX · 최대 5개</span><input ref={fileRef} hidden type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.hwp,.hwpx" onChange={onFiles}/></div>{files.map((file, i) => <div className="file" key={`${file.name}-${i}`}><FileText size={16}/><span>{file.name}</span><button onClick={() => setFiles(files.filter((_, index) => index !== i))}><Trash2 size={15}/></button></div>)}</div><div className="card"><h2>담당자 메모</h2><textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 이 자료는 행사 만족도 조사입니다. 익명으로 받고 개선 의견을 자세히 물어봐 주세요."/><small>문서와 메모가 함께 AI 분석에 반영됩니다.</small></div></div>{analysisError && <Notice text={analysisError}/>}<div className="actions"><button className="primary" onClick={() => void analyze()} disabled={analysisLoading}>{analysisLoading ? <LoaderCircle className="spin"/> : <WandSparkles/>}{analysisLoading ? '문서를 읽는 중...' : 'AI로 폼 만들기'}</button></div></section>}
      {page === 'edit' && <section><Title step="2" title="AI가 만든 폼을 확인하세요" text="문서에서 확실하지 않은 내용은 검토 항목으로 표시합니다."/>{reviewNotes.length > 0 && <div className="notice warn"><b>사람이 확인할 항목</b>{reviewNotes.map((note) => <span key={note}>• {note}</span>)}</div>}<div className="grid edit"><div><div className="card form-fields"><h2>폼 기본 정보</h2><label>폼 제목<input value={program.programName} onChange={(e) => setProgram({...program, programName:e.target.value})}/></label><label>설명<textarea value={program.description} onChange={(e) => setProgram({...program, description:e.target.value})}/></label><div className="grid two"><label>대상<input value={program.target} onChange={(e) => setProgram({...program, target:e.target.value})}/></label><label>기간<input value={program.period} onChange={(e) => setProgram({...program, period:e.target.value})}/></label></div></div><div className="card"><div className="row"><h2>질문 {questions.length}개</h2><button onClick={() => setQuestions([...questions,{id:Date.now(),label:'새 질문',type:'short_text',required:false}])}><Plus size={16}/> 질문 추가</button></div>{questions.map((q) => <div className="question" key={q.id}><input value={q.label} onChange={(e) => setQuestions(questions.map((item) => item.id===q.id?{...item,label:e.target.value}:item))}/><select value={q.type} onChange={(e) => setQuestions(questions.map((item) => item.id===q.id?{...item,type:e.target.value as FormQuestion['type']}:item))}>{Object.entries(typeLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select><label className="check"><input type="checkbox" checked={q.required} onChange={(e) => setQuestions(questions.map((item) => item.id===q.id?{...item,required:e.target.checked}:item))}/>필수</label><button onClick={() => setQuestions(questions.filter((item) => item.id!==q.id))}><Trash2 size={16}/></button></div>)}</div></div><aside className="card preview"><h2>미리보기</h2><FormBody program={program} questions={questions} theme={theme}/></aside></div><div className="actions between"><button onClick={() => setPage('create')}>자료 다시 선택</button><button className="primary" onClick={() => setPage('publish')}>디자인·배포 설정</button></div></section>}
      {page === 'publish' && <section><Title step="3" title="디자인을 고르고 실제로 배포하세요" text="배포하면 로그인한 응답자가 사용할 수 있는 공개 링크와 QR이 생성됩니다."/><div className="grid two"><div className="card"><h2><Palette size={20}/> 폼 디자인</h2><div className="themes" role="group" aria-label="폼 디자인 선택">{selectableThemes.map((item) => <button type="button" key={item.id} className={`theme-option ${item.id} ${theme===item.id?'selected':''}`} aria-pressed={theme===item.id} onClick={() => setTheme(item.id)}><span className="theme-swatch"><ThemeIcon theme={item.id}/></span><span className="theme-copy"><b>{item.label}</b><small>{item.description}</small></span></button>)}</div><FormBody program={program} questions={questions} theme={theme}/></div><div className="card publish-card"><h2>공개 설정</h2><label>설문 종료일<input type="date" value={endDate} onChange={(e)=>setEndDate(e.target.value)}/></label><button className="primary wide" onClick={() => void publish()} disabled={publishLoading}>{publishLoading?<LoaderCircle className="spin"/>:<Send/>} 실제 폼 배포하기</button>{message && <Notice text={message}/>} {published && <div className="share"><CheckCircle2/><h3>배포 완료</h3>{qr?<img src={qr} alt="공개 폼 QR 코드"/>:<QrCode/>}<div className="copy"><input readOnly value={shareLink}/><button onClick={() => void navigator.clipboard.writeText(shareLink)}><Copy/></button></div><a className="primary link" href={shareLink} target="_blank">응답 화면 열기</a></div>}</div></div><div className="actions between"><button onClick={() => setPage('edit')}>폼 수정</button><button className="primary" onClick={() => void loadResults()} disabled={resultLoading}>응답 결과 보기</button></div></section>}
      {page === 'results' && <Results title={program.programName} loading={resultLoading} responses={responses} summaries={summaries} topics={topics} message={message} onRefresh={() => void loadResults()} onExport={() => void exportResponsesToExcel(program.programName, questions, responses, summaries)}/>}
      {page === 'manage' && <section><Title step="" title="내가 만든 폼" text="폼별 공개 상태와 실제 신청 인원을 확인할 수 있습니다."/>{message&&<Notice text={message}/>} {resultLoading?<div className="center"><LoaderCircle className="spin"/></div>:<div className="manage-list">{ownedForms.length?ownedForms.map((form)=><article className="card" key={form.id}><div><span className="badge">{form.published?'공개 중':'초안'}</span><h2>{form.title}</h2><small>{form.id}</small></div><strong>{form.responseCount}<small>명 응답</small></strong><button className="primary" onClick={() => void loadResults(form.id)}>결과 보기</button><button className="danger" disabled={deletingFormId===form.id} onClick={() => void deleteOwnedForm(form)}>{deletingFormId===form.id?<LoaderCircle className="spin" size={16}/>:<Trash2 size={16}/>} 삭제</button></article>):<div className="empty card">아직 배포한 폼이 없습니다.<button className="primary" onClick={()=>setPage('create')}>첫 폼 만들기</button></div>}</div>}</section>}
    </main>
  </div>
}

function Login({loadingProvider,error,onLogin}:{loadingProvider:LoginProvider|null;error:string;onLogin:(provider:LoginProvider,email?:string,password?:string)=>void}) {
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const loading=loadingProvider!==null
  return <main className="login"><div className="login-card"><div className="logo">대</div><span className="eyebrow">DAEPUL FORM</span><h1>자료 한 번 올리면<br/>폼부터 결과까지</h1><p>첨부문서를 AI가 읽어 알맞은 폼을 만들고, 실제 응답을 자동으로 집계합니다.</p><div className="login-options"><button className="social-login google" disabled={loading||!firebaseConfigured} onClick={()=>void onLogin('google')}>{loadingProvider==='google'?<LoaderCircle className="spin"/>:<span className="login-mark">G</span>} Google로 로그인</button><button className="social-login kakao" disabled={loading||!firebaseConfigured} onClick={()=>void onLogin('kakao')}>{loadingProvider==='kakao'?<LoaderCircle className="spin"/>:<span className="login-mark">K</span>} 카카오로 로그인</button><button className="social-login naver" disabled={loading||!firebaseConfigured} onClick={()=>void onLogin('naver')}>{loadingProvider==='naver'?<LoaderCircle className="spin"/>:<span className="login-mark">N</span>} 네이버로 로그인</button></div><div className="login-divider"><span>또는 이메일</span></div><form className="email-login" onSubmit={(event)=>{event.preventDefault();void onLogin('email',email,password)}}><label>이메일<input type="email" autoComplete="email" value={email} onChange={(event)=>setEmail(event.target.value)} required/></label><label>비밀번호<input type="password" autoComplete="current-password" value={password} onChange={(event)=>setPassword(event.target.value)} required/></label><button className="email-login-button" disabled={loading||!firebaseConfigured}>{loadingProvider==='email'?<LoaderCircle className="spin"/>:<LogIn/>} 이메일로 로그인</button></form>{error&&<Notice text={error}/>}<small>폼 제작자와 응답자 모두 로그인이 필요합니다.</small></div></main>
}
function Title({step,title,text}:{step:string;title:string;text:string}) { return <div className="title"><span>{step&&`${step}단계`}</span><h1>{title}</h1><p>{text}</p></div> }
function Notice({text}:{text:string}) { return <div className="notice">{text}</div> }

function ThemeIcon({theme}:{theme:SelectableTheme}) {
  if(theme==='spring')return <Flower2 aria-hidden="true"/>
  if(theme==='summer')return <Waves aria-hidden="true"/>
  if(theme==='autumn')return <Leaf aria-hidden="true"/>
  if(theme==='winter')return <Snowflake aria-hidden="true"/>
  return <Sparkles aria-hidden="true"/>
}

function ThemeDecoration({theme}:{theme:Theme}) {
  if(theme==='spring')return <div className="seasonal-decor spring-decor" aria-hidden="true"><Flower2/><Flower2/><Flower2/></div>
  if(theme==='summer')return <div className="seasonal-decor summer-decor" aria-hidden="true"><Sun/><Waves/><Waves/></div>
  if(theme==='autumn')return <div className="seasonal-decor autumn-decor" aria-hidden="true"><Leaf/><Leaf/><Leaf/></div>
  if(theme==='winter')return <div className="seasonal-decor winter-decor" aria-hidden="true"><Snowflake/><Snowflake/><Snowflake/></div>
  return null
}

function FormCover({program,theme,headingLevel='preview'}:{program:ProgramInfo;theme:Theme;headingLevel?:'preview'|'public'}) {
  const eyebrow=theme==='spring'?'SPRING FORM':theme==='summer'?'SUMMER FORM':theme==='autumn'?'AUTUMN FORM':theme==='winter'?'WINTER FORM':theme==='blue'?'OFFICIAL FORM':theme==='coral'?'WELCOME FORM':'PROGRAM FORM'
  return <div className="form-cover"><ThemeDecoration theme={theme}/><div className="form-cover-content"><span>{eyebrow}</span>{headingLevel==='public'?<h1>{program.programName||'폼 제목'}</h1>:<h2>{program.programName||'폼 제목'}</h2>}<p>{program.description||'폼 설명이 표시됩니다.'}</p></div></div>
}

function FormBody({program,questions,theme}:{program:ProgramInfo;questions:FormQuestion[];theme:Theme}) { return <div className={`form-body theme-${theme}`}><FormCover program={program} theme={theme}/>{questions.map((q,i)=><label className="form-question" key={q.id}><span>{i+1}. {q.label} {q.required&&<em>*</em>}</span>{q.type==='long_text'?<textarea disabled/>:q.type==='select'?<select disabled><option>선택해 주세요</option>{q.options?.map(o=><option key={o}>{o}</option>)}</select>:q.type==='rating'?<div className="rating">{[1,2,3,4,5].map(n=><i key={n}>{n}</i>)}</div>:q.type==='checkbox'||q.type==='consent'?<div className="check-line">□ 동의합니다</div>:<input disabled type={q.type==='number'?'number':'text'}/>}</label>)}</div> }

function PublicForm({user,formId,program,questions,theme,endDate,onLogout}:{user:FirebaseUser;formId:string;program:ProgramInfo;questions:FormQuestion[];theme:Theme;endDate:string;onLogout:()=>void}) {
  const [answers,setAnswers]=useState<Record<number,string|boolean|number>>({})
  const [submitted,setSubmitted]=useState(false)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')

  useEffect(()=>{void hasSubmittedResponse(formId,user.uid).then(setSubmitted).finally(()=>setLoading(false))},[formId,user.uid])

  const submit=async()=>{
    const missing=questions.find(q=>q.required&&!answers[q.id])
    if(missing){setError(`필수 질문을 확인해 주세요: ${missing.label}`);return}
    setLoading(true);setError('')
    try{await submitResponseOnce({formId,user,answers,surveyEndDate:endDate});setSubmitted(true)}
    catch(e){setError(e instanceof Error&&e.message==='already-submitted'?'이미 제출한 폼입니다.':'제출하지 못했습니다. 다시 시도해 주세요.')}
    finally{setLoading(false)}
  }

  if(loading)return <div className="center"><LoaderCircle className="spin"/></div>
  if(submitted)return <main className="public-shell"><div className="complete card"><CheckCircle2/><h1>응답 제출 완료</h1><p>현재 로그인한 계정으로 제출한 응답이 있습니다. 제출 후에는 수정하거나 삭제할 수 없습니다.</p><button type="button" onClick={onLogout}><LogOut/> 로그아웃</button></div></main>

  return <main className={`public-shell theme-${theme}`}>
    <div className="public-user"><span>{user.email}</span><button type="button" onClick={onLogout}><LogOut/> 로그아웃</button></div>
    <div className="public-form card">
      <FormCover program={program} theme={theme} headingLevel="public"/>
      {questions.map((q,i)=>{
        const labelId=`question-${q.id}-label`
        const inputId=`question-${q.id}-input`
        return <div className="form-question" key={q.id}>
          <span id={labelId}>{i+1}. {q.label} {q.required&&<em aria-label="필수">*</em>}</span>
          {q.type==='long_text'?<textarea id={inputId} aria-labelledby={labelId} value={String(answers[q.id]??'')} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}/>
          :q.type==='select'?<select id={inputId} aria-labelledby={labelId} value={String(answers[q.id]??'')} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}><option value="">선택해 주세요</option>{(q.options?.length?q.options:['예','아니오']).map(o=><option key={o}>{o}</option>)}</select>
          :q.type==='rating'?<div className="rating input" role="radiogroup" aria-labelledby={labelId}>{[1,2,3,4,5].map(n=><button className={answers[q.id]===n?'active':''} aria-checked={answers[q.id]===n} role="radio" onClick={()=>setAnswers({...answers,[q.id]:n})} type="button" key={n}>{n}</button>)}</div>
          :q.type==='checkbox'||q.type==='consent'?<label className="check-line" htmlFor={inputId}><input id={inputId} type="checkbox" checked={Boolean(answers[q.id])} onChange={e=>setAnswers({...answers,[q.id]:e.target.checked})}/><span>{q.type==='consent'?'개인정보 수집·이용에 동의합니다.':'동의합니다.'}</span></label>
          :<input id={inputId} aria-labelledby={labelId} type={q.type==='number'?'number':'text'} value={String(answers[q.id]??'')} onChange={e=>setAnswers({...answers,[q.id]:q.type==='number'?Number(e.target.value):e.target.value})}/>}</div>
      })}
      <div className="public-actions">
        {error&&<Notice text={error}/>}<button type="button" className="primary wide submit-response" onClick={()=>void submit()} disabled={loading}>{loading?<LoaderCircle className="spin"/>:<Send/>} 응답 제출하기</button>
        <small>제출된 응답은 수정하거나 삭제할 수 없습니다.</small>
      </div>
    </div>
  </main>
}

function Results({title,loading,responses,summaries,topics,message,onRefresh,onExport}:{title:string;loading:boolean;responses:StoredFormResponse[];summaries:QuestionSummary[];topics:ResponseTopic[];message:string;onRefresh:()=>void;onExport:()=>void}) {
  return <section>
    <Title step="4" title={`${title} 결과`} text="응답 결과를 질문별 통계와 원본 데이터로 확인할 수 있습니다."/>
    <div className="row result-head">
      <div className="stat"><UserRound/><span>전체 응답</span><b>{responses.length}<small>명</small></b></div>
      <div className="result-actions"><button type="button" onClick={onRefresh} disabled={loading}>{loading?<LoaderCircle className="spin"/>:<RefreshCcw/>} 새로고침</button><button type="button" className="primary" onClick={onExport} disabled={!responses.length}><Download/> Excel 저장</button></div>
    </div>
    {message&&<Notice text={message}/>} {!responses.length&&!loading?<div className="empty card">아직 제출된 응답이 없습니다. 공개 링크를 응답자에게 공유해 주세요.</div>:<div className="results">{summaries.map(summary=><article className="card result" key={summary.questionId}><div className="row"><div><span className="badge">{typeLabels[summary.type]}</span><h2>{summary.label}</h2><small className="response-total">유효 응답 {summary.responseCount}개</small></div>{summary.average!==undefined&&<strong>{summary.average.toFixed(1)}<small> 평균</small></strong>}</div>{summary.distribution&&<div className="bars" aria-label={`${summary.label} 응답 분포`}>{summary.distribution.map(item=>{const percentage=summary.responseCount?item.count/summary.responseCount*100:0;return <div key={item.label}><span>{item.label}</span><i role="img" aria-label={`${item.label} ${item.count}명, ${percentage.toFixed(0)}퍼센트`}><b style={{width:`${percentage}%`}}/></i><strong>{item.count}<small>{percentage.toFixed(0)}%</small></strong></div>})}</div>}{summary.texts&&<details><summary>원문 응답 {summary.texts.length}개 보기</summary>{summary.texts.map((text,i)=><p key={i}>{text}</p>)}</details>}</article>)}</div>}
    {topics.length>0&&<div className="ai-topics"><h2><Sparkles/> AI 자유응답 요약</h2><p className="human-check">아래 요약은 AI 결과입니다. 담당자가 근거 원문과 함께 확인해 주세요.</p>{topics.map(topic=><article className="card" key={topic.id}><span className="badge">{topic.category}</span><h3>{topic.title}</h3><p>{topic.summary}</p><b>보고서 후보 문장</b><p>{topic.reportSentence}</p></article>)}</div>}
  </section>
}
