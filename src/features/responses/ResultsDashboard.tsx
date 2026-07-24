import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Archive, ArrowDown, ArrowUp, BarChart3, CheckSquare, ChevronLeft, ChevronRight,
  Columns3, Download, ExternalLink, Eye, FileText, LayoutList, Paperclip,
  Printer, RefreshCcw, RotateCcw, Search, Sheet, Sparkles, Table2, Trash2, UserRound, X,
} from 'lucide-react'
import type {
  FormQuestion, QuestionSummary, ResponseFilters, ResponsePage, ResponseQuery, ResponseTopic, StoredFormResponse,
} from '../../types'
import { downloadTextFile, filterResponses, queryResponses, responsesToCsv } from './model'

type ResultsTab = 'summary' | 'question' | 'individual' | 'table'
type ColumnKey = 'submittedAt' | 'respondentName' | 'studentId' | 'respondentEmail' | `question:${number}`

const emptyFilters: ResponseFilters = { query: '', status: 'all', selectedIds: [] }

function formatDate(value?: string) {
  if (!value) return '시간 정보 없음'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function answerText(value: unknown) {
  if (value === true) return '동의'
  if (value === false) return '미동의'
  return String(value ?? '미응답')
}

function SummaryView({
  summaries,
  responses,
  dailyCounts,
}: {
  summaries: QuestionSummary[]
  responses: StoredFormResponse[]
  dailyCounts?: Array<{ date: string; count: number }>
}) {
  const daily = useMemo(() => {
    if (dailyCounts) return dailyCounts.map((item) => [item.date, item.count] as const)
    const counts = new Map<string, number>()
    responses.forEach((response) => {
      const key = response.submittedAt ? response.submittedAt.slice(0, 10) : '날짜 없음'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14)
  }, [dailyCounts, responses])
  const maximum = Math.max(1, ...daily.map(([, count]) => count))

  return <div className="result-pane">
    <section className="card trend-card" aria-labelledby="response-trend-title">
      <div className="result-section-title"><BarChart3/><div><h2 id="response-trend-title">응답 추이</h2><p>최근 일자별 참여자 수입니다.</p></div></div>
      {daily.length ? <div className="trend-bars">{daily.map(([date, count]) =>
        <div key={date}><span>{date.slice(5)}</span><i><b style={{ height: `${Math.max(8, count / maximum * 100)}%` }}/></i><strong>{count}</strong></div>,
      )}</div> : <p className="empty-copy">표시할 응답이 없습니다.</p>}
    </section>
    <div className="results">{summaries.map((summary) =>
      <article className="card result" key={summary.questionId}>
        <div className="row"><div><span className="badge">{summary.type}</span><h2>{summary.label}</h2><small>유효 응답 {summary.responseCount}개</small></div>
          {summary.average !== undefined && <strong>{summary.average.toFixed(1)}<small> 평균</small></strong>}
        </div>
        {summary.distribution && <div className="bars">{summary.distribution.map((item) => {
          const percentage = summary.responseCount ? item.count / summary.responseCount * 100 : 0
          return <div key={item.label}><span>{item.label}</span><i><b style={{ width: `${percentage}%` }}/></i><strong>{item.count}<small>{percentage.toFixed(0)}%</small></strong></div>
        })}</div>}
        {summary.texts && <details><summary>주관식 응답 {summary.texts.length}개</summary>{summary.texts.slice(0, 20).map((text, index) => <p key={index}>{text}</p>)}</details>}
      </article>,
    )}</div>
  </div>
}

function QuestionView({
  questions,
  summaries,
  total,
}: {
  questions: FormQuestion[]
  summaries: QuestionSummary[]
  total: number
}) {
  const [questionId, setQuestionId] = useState(questions[0]?.id)
  const question = questions.find((item) => item.id === questionId)
  const summary = summaries.find((item) => item.questionId === questionId)
  return <section className="card result-pane">
    <label className="field-label">질문 선택
      <select value={questionId} onChange={(event) => setQuestionId(Number(event.target.value))}>
        {questions.map((item, index) => <option value={item.id} key={item.id}>{index + 1}. {item.label}</option>)}
      </select>
    </label>
    {question && summary && <><div className="question-metrics"><strong>{summary.responseCount}<small> 응답</small></strong><strong>{total - summary.responseCount}<small> 미응답</small></strong></div>
      <div className="answer-frequency">
        {summary.distribution?.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.count}회</strong></article>)}
        {summary.texts?.map((text, index) => <article key={index}><span>{text}</span></article>)}
      </div>
    </>}
  </section>
}

function ResponseDetail({
  response,
  questions,
  onClose,
}: {
  response: StoredFormResponse
  questions: FormQuestion[]
  onClose: () => void
}) {
  return <aside className="response-detail" role="dialog" aria-modal="true" aria-labelledby="response-detail-title">
    <div className="response-detail-head"><div><span className="badge">{response.status ?? 'submitted'}</span><h2 id="response-detail-title">{response.respondentName || '익명 응답'}</h2></div><button onClick={onClose} aria-label="상세 닫기"><X/></button></div>
    <p>{formatDate(response.submittedAt)} · {response.studentId || '학번 없음'} · {response.respondentEmail || '이메일 없음'}</p>
    <div className="individual-answers">{questions.map((question, index) => <section key={question.id}><b>{index + 1}. {question.label}</b><p>{answerText(response.answers[String(question.id)])}</p></section>)}</div>
    {!!response.attachments?.length && <section className="attachment-list"><h3><Paperclip/> 첨부파일</h3>{response.attachments.map((attachment) =>
      <a key={attachment.id} href={attachment.downloadUrl} target="_blank" rel="noreferrer" download><Download/> {attachment.name}</a>,
    )}</section>}
    <button onClick={() => window.print()}><Printer/> 이 응답 인쇄 / PDF</button>
  </aside>
}

function IndividualView({
  questions,
  responses,
}: {
  questions: FormQuestion[]
  responses: StoredFormResponse[]
}) {
  const [index, setIndex] = useState(0)
  const response = responses[Math.min(index, Math.max(0, responses.length - 1))]
  if (!response) return <div className="empty card">표시할 응답이 없습니다.</div>
  return <section className="individual-view">
    <div className="card individual-toolbar">
      <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0} aria-label="이전 응답"><ChevronLeft/></button>
      <label><span className="sr-only">응답자 선택</span><select value={index} onChange={(event) => setIndex(Number(event.target.value))}>
        {responses.map((item, itemIndex) => <option key={item.id} value={itemIndex}>{itemIndex + 1} / {responses.length} · {item.respondentName ?? item.respondentEmail ?? `익명 ${itemIndex + 1}`}</option>)}
      </select></label>
      <button onClick={() => setIndex(Math.min(responses.length - 1, index + 1))} disabled={index === responses.length - 1} aria-label="다음 응답"><ChevronRight/></button>
      <button onClick={() => window.print()}><Printer/> 인쇄 / PDF</button>
    </div>
    <article className="card printable-response">
      <header><div><span className="badge">{response.status ?? 'submitted'}</span><h2>{response.respondentName ?? '익명 응답'}</h2></div><time>{formatDate(response.submittedAt)}</time></header>
      <dl className="identity-grid"><div><dt>학번</dt><dd>{response.studentId ?? '-'}</dd></div><div><dt>이메일</dt><dd>{response.respondentEmail ?? '-'}</dd></div></dl>
      <div className="individual-answers">{questions.map((question, questionIndex) => <section key={question.id}><b>{questionIndex + 1}. {question.label}</b><p>{answerText(response.answers[String(question.id)])}</p></section>)}</div>
    </article>
  </section>
}

function VirtualTable({
  questions,
  responses,
  selectedIds,
  onSelectionChange,
  visibleColumns,
  questionOrder,
  questionWidth,
  onDetail,
}: {
  questions: FormQuestion[]
  responses: StoredFormResponse[]
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
  visibleColumns: ColumnKey[]
  questionOrder: number[]
  questionWidth: number
  onDetail: (response: StoredFormResponse) => void
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({ count: responses.length, getScrollElement: () => parentRef.current, estimateSize: () => 58, overscan: 8 })
  const orderedQuestions = questionOrder.map((id) => questions.find((question) => question.id === id)).filter(Boolean) as FormQuestion[]
  const identity = [
    ['submittedAt', '제출시간', 190], ['respondentName', '이름', 150],
    ['studentId', '학번', 140], ['respondentEmail', '이메일', 220],
  ] as const
  const shownIdentity = identity.filter(([key]) => visibleColumns.includes(key))
  const shownQuestions = orderedQuestions.filter((question) => visibleColumns.includes(`question:${question.id}`))
  const template = `52px ${shownIdentity.map(([, , width]) => `${width}px`).join(' ')} ${shownQuestions.map(() => `${questionWidth}px`).join(' ')} 56px`
  const allSelected = responses.length > 0 && responses.every((response) => selectedIds.includes(response.id))
  const toggleAll = () => onSelectionChange(allSelected
    ? selectedIds.filter((id) => !responses.some((response) => response.id === id))
    : [...new Set([...selectedIds, ...responses.map((response) => response.id)])])
  return <div className="response-table-shell" ref={parentRef} tabIndex={0} aria-label="응답 표">
    <div className="response-table" style={{ minWidth: `${160 + shownIdentity.reduce((sum, [, , width]) => sum + width, 0) + shownQuestions.length * questionWidth}px` }}>
      <div className="response-row response-header" style={{ gridTemplateColumns: template }}>
        <span><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="현재 페이지 전체 선택"/></span>
        {shownIdentity.map(([key, label]) => <span key={key}>{label}</span>)}
        {shownQuestions.map((question) => <span key={question.id} title={question.label}>{question.label}</span>)}
        <span>상세</span>
      </div>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => {
          const response = responses[row.index]
          return <div className="response-row" key={response.id} style={{ gridTemplateColumns: template, transform: `translateY(${row.start}px)` }}>
            <span><input type="checkbox" checked={selectedIds.includes(response.id)} onChange={() => onSelectionChange(selectedIds.includes(response.id) ? selectedIds.filter((id) => id !== response.id) : [...selectedIds, response.id])} aria-label={`${row.index + 1}번 응답 선택`}/></span>
            {shownIdentity.map(([key]) => <span key={key} title={key === 'submittedAt' ? formatDate(response.submittedAt) : String(response[key] ?? '')}>{key === 'submittedAt' ? formatDate(response.submittedAt) : String(response[key] ?? '-')}</span>)}
            {shownQuestions.map((question) => <span key={question.id} title={answerText(response.answers[String(question.id)])}>{answerText(response.answers[String(question.id)])}</span>)}
            <span><button onClick={() => onDetail(response)} aria-label={`${row.index + 1}번 응답 상세`}><Eye/></button></span>
          </div>
        })}
      </div>
    </div>
  </div>
}

export function ResultsDashboard({
  title,
  loading,
  responses,
  questions,
  summaries,
  message,
  sample = false,
  initialPage,
  onRefresh,
  onExportExcel,
  onQuery,
  onManage,
  onLoadExport,
  onAnalyze,
}: {
  title: string
  loading: boolean
  responses: StoredFormResponse[]
  questions: FormQuestion[]
  summaries: QuestionSummary[]
  message: string
  sample?: boolean
  initialPage?: ResponsePage
  onRefresh: () => void
  onExportExcel: (items: StoredFormResponse[], questions: FormQuestion[]) => void
  onQuery?: (query: ResponseQuery) => Promise<ResponsePage>
  onManage?: (ids: string[], action: 'delete' | 'reviewed' | 'archived' | 'submitted') => Promise<void>
  onLoadExport?: (query: ResponseQuery) => Promise<StoredFormResponse[]>
  onAnalyze?: (query: ResponseQuery) => Promise<ResponseTopic[]>
}) {
  const [tab, setTab] = useState<ResultsTab>('summary')
  const [filters, setFilters] = useState<ResponseFilters>(emptyFilters)
  const deferredSearch = useDeferredValue(filters.query)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<ResponseQuery['pageSize']>(25)
  const [sortBy, setSortBy] = useState<ResponseQuery['sortBy']>('submittedAt')
  const [sortDirection, setSortDirection] = useState<ResponseQuery['sortDirection']>('desc')
  const [serverPage, setServerPage] = useState<ResponsePage | undefined>(initialPage)
  const [serverLoading, setServerLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [detail, setDetail] = useState<StoredFormResponse | null>(null)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [questionWidth, setQuestionWidth] = useState(180)
  const [questionOrder, setQuestionOrder] = useState(() => questions.map((question) => question.id))
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => [
    'submittedAt', 'respondentName', 'studentId', 'respondentEmail',
    ...questions.map((question) => `question:${question.id}` as const),
  ])
  const [actionMessage, setActionMessage] = useState('')
  const [exporting, setExporting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [topics, setTopics] = useState<ResponseTopic[]>([])
  const [incomingPage, setIncomingPage] = useState<ResponsePage>()
  const dashboardRef = useRef<HTMLElement>(null)
  const latestTotal = useRef(initialPage?.overallTotal ?? initialPage?.total ?? responses.length)
  const query: ResponseQuery = useMemo(() => ({
    filters: { ...filters, query: deferredSearch },
    sortBy,
    sortDirection,
    page,
    pageSize,
  }), [filters, deferredSearch, sortBy, sortDirection, page, pageSize])
  const localResult = useMemo(() => queryResponses(responses, query), [responses, query])

  useEffect(() => {
    setQuestionOrder((current) => {
      const existing = current.filter((id) => questions.some((question) => question.id === id))
      return [...existing, ...questions.map((question) => question.id).filter((id) => !existing.includes(id))]
    })
  }, [questions])

  useEffect(() => {
    if (!onQuery || sample) return
    let active = true
    const timer = window.setTimeout(() => {
      setServerLoading(true)
      void onQuery(query).then((result) => {
        if (active) setServerPage(result)
      }).catch(() => {
        if (active) setActionMessage('서버에서 응답을 조회하지 못했습니다.')
      }).finally(() => {
        if (active) setServerLoading(false)
      })
    }, filters.query === deferredSearch ? 80 : 320)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query, onQuery, sample, filters.query, deferredSearch])

  useEffect(() => {
    if (!onQuery || sample) return
    const timer = window.setInterval(() => {
      void onQuery({ ...query, page: 1 }).then((next) => {
        const nextTotal = next.overallTotal ?? next.total
        if (nextTotal > latestTotal.current) setIncomingPage(next)
      }).catch(() => undefined)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [onQuery, query, sample])

  useEffect(() => {
    if (!serverPage || incomingPage) return
    latestTotal.current = Math.max(latestTotal.current, serverPage.overallTotal ?? serverPage.total)
  }, [incomingPage, serverPage])

  const result = onQuery && !sample ? (serverPage ?? localResult) : localResult
  const activeSummaries = result.summaries ?? summaries
  const pageCount = Math.max(1, Math.ceil(result.total / pageSize))
  const safeTitle = (title || '대플폼').replace(/[\\/:*?"<>|]/g, '_')
  const filterCount = Number(filters.status !== 'all') + Number(filters.questionId !== undefined)
    + Number(filters.missingQuestionId !== undefined) + Number(filters.ratingMin !== undefined || filters.ratingMax !== undefined)
    + Number(filters.selectedIds.length > 0)

  const resetFilters = () => {
    setFilters(emptyFilters)
    setPage(1)
  }
  const performExport = async (format: 'csv' | 'excel') => {
    setExporting(true)
    try {
      const items = onLoadExport ? await onLoadExport(query) : filterResponses(responses, query.filters)
      const selectedQuestions = questionOrder
        .filter((id) => visibleColumns.includes(`question:${id}`))
        .map((id) => questions.find((question) => question.id === id))
        .filter(Boolean) as FormQuestion[]
      if (format === 'csv') downloadTextFile(`${safeTitle}_응답.csv`, responsesToCsv(selectedQuestions, items))
      else onExportExcel(items, selectedQuestions)
      setActionMessage(`${items.length.toLocaleString()}개 응답을 내보냈습니다.`)
    } finally {
      setExporting(false)
    }
  }
  const manageSelected = async (action: 'delete' | 'reviewed' | 'archived' | 'submitted') => {
    if (!onManage || !selectedIds.length) return
    if (action === 'delete' && !window.confirm(`선택한 응답 ${selectedIds.length}개를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return
    setServerLoading(true)
    try {
      await onManage(selectedIds, action)
      setActionMessage(`${selectedIds.length}개 응답을 변경했습니다.`)
      setSelectedIds([])
      setServerPage(await onQuery?.(query))
    } catch {
      setActionMessage('선택한 응답을 변경하지 못했습니다.')
    } finally {
      setServerLoading(false)
    }
  }

  return <section className="results-dashboard" aria-busy={loading || serverLoading} ref={dashboardRef}>
    <div className="result-dashboard-head">
      <div><span className="eyebrow">RESPONSE DASHBOARD</span><h1>{title}</h1><p>응답을 요약·질문별·개별·표 형태로 확인합니다.</p></div>
      <div className="stat"><UserRound/><span>전체 응답</span><b>{(result.overallTotal ?? result.total).toLocaleString()}<small>명</small></b></div>
    </div>
    {sample && <div className="sample-data-badge" role="status">예시 데이터이며 실제 응답이 아닙니다</div>}
    {(message || actionMessage) && <div className="notice" role="status">{actionMessage || message}</div>}
    {incomingPage && <button className="new-response-banner" onClick={() => { setServerPage(incomingPage); latestTotal.current = incomingPage.overallTotal ?? incomingPage.total; setIncomingPage(undefined) }}><RefreshCcw/> 새 응답 {(incomingPage.overallTotal ?? incomingPage.total) - latestTotal.current}개 보기</button>}
    <div className="result-commandbar card">
      <div className="result-tabs" role="tablist" aria-label="결과 보기">
        {([
          ['summary', BarChart3, '종합'], ['question', LayoutList, '질문별'], ['individual', FileText, '개별'], ['table', Table2, '표'],
        ] as const).map(([value, Icon, label]) => <button role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)} key={value}><Icon/>{label}</button>)}
      </div>
      <div className="result-actions">
        <button onClick={onRefresh} disabled={loading || serverLoading}>{loading || serverLoading ? <RefreshCcw className="spin"/> : <RefreshCcw/>} 새로고침</button>
        {onAnalyze && <button onClick={() => { setAnalyzing(true); void onAnalyze(query).then((items) => { setTopics(items); setActionMessage('AI가 주관식 의견을 요약·분류했습니다.') }).catch(() => setActionMessage('AI 분석을 완료하지 못했습니다.')).finally(() => setAnalyzing(false)) }} disabled={analyzing || !result.total}>{analyzing ? <RefreshCcw className="spin"/> : <Sparkles/>} AI 요약</button>}
        <button onClick={() => void dashboardRef.current?.requestFullscreen?.()}><ExternalLink/> 전체화면</button>
        <button onClick={() => void performExport('csv')} disabled={exporting || !result.total}><Download/> CSV</button>
        <button className="primary" onClick={() => void performExport('excel')} disabled={exporting || !result.total}><Sheet/> Excel</button>
      </div>
    </div>
    {(tab === 'table' || tab === 'individual') && <div className="result-filter-panel card">
      <div className="result-filters">
        <label className="search-field"><Search/><span className="sr-only">통합 검색</span><input value={filters.query} onChange={(event) => { setFilters((current) => ({ ...current, query: event.target.value })); setPage(1) }} placeholder="이름·학번·이메일·답변 검색"/></label>
        <label><span className="sr-only">정렬 기준</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as ResponseQuery['sortBy'])}><option value="submittedAt">제출시간</option><option value="name">이름</option><option value="studentId">학번</option><option value="answer">선택 질문 답변</option></select></label>
        <button onClick={() => setSortDirection((value) => value === 'asc' ? 'desc' : 'asc')} aria-label={sortDirection === 'asc' ? '오름차순, 내림차순으로 변경' : '내림차순, 오름차순으로 변경'}>{sortDirection === 'asc' ? <ArrowUp/> : <ArrowDown/>}</button>
        {tab === 'table' && <button onClick={() => setColumnsOpen((value) => !value)} aria-expanded={columnsOpen}><Columns3/> 열 설정</button>}
      </div>
      <div className="advanced-filters">
        <label>상태<select value={filters.status} onChange={(event) => { setFilters((current) => ({ ...current, status: event.target.value as ResponseFilters['status'] })); setPage(1) }}><option value="all">전체</option><option value="submitted">제출됨</option><option value="reviewed">검토됨</option><option value="archived">보관됨</option></select></label>
        <label>질문<select value={filters.questionId ?? ''} onChange={(event) => setFilters((current) => ({ ...current, questionId: event.target.value ? Number(event.target.value) : undefined, answer: undefined }))}><option value="">선택 안 함</option>{questions.map((question) => <option key={question.id} value={question.id}>{question.label}</option>)}</select></label>
        {filters.questionId !== undefined && <label>답변<input value={filters.answer ?? ''} onChange={(event) => setFilters((current) => ({ ...current, answer: event.target.value || undefined }))} placeholder="정확히 일치"/></label>}
        <label>최소 평점<input type="number" min="1" max="10" value={filters.ratingMin ?? ''} onChange={(event) => setFilters((current) => ({ ...current, ratingMin: event.target.value ? Number(event.target.value) : undefined }))}/></label>
        <label>최대 평점<input type="number" min="1" max="10" value={filters.ratingMax ?? ''} onChange={(event) => setFilters((current) => ({ ...current, ratingMax: event.target.value ? Number(event.target.value) : undefined }))}/></label>
        <label className="check-filter"><input type="checkbox" checked={filters.questionId !== undefined && filters.missingQuestionId === filters.questionId} onChange={(event) => setFilters((current) => ({ ...current, missingQuestionId: event.target.checked ? current.questionId : undefined }))}/> 선택 질문 미응답만</label>
        <label className="check-filter"><input type="checkbox" checked={filters.selectedIds.length > 0} disabled={!selectedIds.length} onChange={(event) => setFilters((current) => ({ ...current, selectedIds: event.target.checked ? selectedIds : [] }))}/> 선택 응답만</label>
        {(filterCount > 0 || filters.query) && <button onClick={resetFilters}><RotateCcw/> 필터 초기화 <span className="filter-count">{filterCount}</span></button>}
      </div>
      {columnsOpen && <div className="column-settings">
        <label>질문 열 너비 <input type="range" min="140" max="360" step="20" value={questionWidth} onChange={(event) => setQuestionWidth(Number(event.target.value))}/><output>{questionWidth}px</output></label>
        <div>{(['submittedAt', 'respondentName', 'studentId', 'respondentEmail'] as ColumnKey[]).map((key) => <label key={key}><input type="checkbox" checked={visibleColumns.includes(key)} onChange={() => setVisibleColumns((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])}/>{({ submittedAt: '제출시간', respondentName: '이름', studentId: '학번', respondentEmail: '이메일' } as Record<string, string>)[key]}</label>)}</div>
        <ol>{questionOrder.map((id, index) => {
          const question = questions.find((item) => item.id === id)
          if (!question) return null
          const key = `question:${id}` as ColumnKey
          return <li key={id}><label><input type="checkbox" checked={visibleColumns.includes(key)} onChange={() => setVisibleColumns((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])}/>{question.label}</label><span><button disabled={index === 0} onClick={() => setQuestionOrder((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })} aria-label={`${question.label} 열 앞으로`}><ArrowUp/></button><button disabled={index === questionOrder.length - 1} onClick={() => setQuestionOrder((current) => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next })} aria-label={`${question.label} 열 뒤로`}><ArrowDown/></button></span></li>
        })}</ol>
      </div>}
    </div>}
    {selectedIds.length > 0 && tab === 'table' && <div className="bulk-action-bar" role="toolbar" aria-label="선택 응답 작업"><strong><CheckSquare/> {selectedIds.length}개 선택</strong><button onClick={() => void manageSelected('reviewed')}>검토 완료</button><button onClick={() => void manageSelected('archived')}><Archive/> 보관</button><button className="danger" onClick={() => void manageSelected('delete')}><Trash2/> 삭제</button><button onClick={() => setSelectedIds([])}>선택 해제</button></div>}
    {tab === 'summary' && <SummaryView summaries={activeSummaries} responses={result.items} dailyCounts={result.dailyCounts}/>}
    {tab === 'summary' && topics.length > 0 && <section className="card ai-result-topics"><h2><Sparkles/> AI 의견 요약</h2><p>자동 분석 결과는 원문과 함께 검토해 주세요.</p><div>{topics.map((topic) => <article key={topic.id}><span className="badge">{topic.category}</span><h3>{topic.title}</h3><p>{topic.summary}</p><small>{topic.reportSentence}</small></article>)}</div></section>}
    {tab === 'question' && <QuestionView questions={questions} summaries={activeSummaries} total={result.total}/>}
    {tab === 'individual' && <IndividualView questions={questions} responses={result.items}/>}
    {tab === 'table' && <><VirtualTable questions={questions} responses={result.items} selectedIds={selectedIds} onSelectionChange={setSelectedIds} visibleColumns={visibleColumns} questionOrder={questionOrder} questionWidth={questionWidth} onDetail={setDetail}/>
      <nav className="pagination" aria-label="응답 페이지">
        <span>필터 결과 {result.total.toLocaleString()}개</span>
        <label>페이지당 <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as ResponseQuery['pageSize']); setPage(1) }}>{[25, 50, 100, 200].map((size) => <option key={size}>{size}</option>)}</select></label>
        <button onClick={() => setPage(1)} disabled={page === 1}>처음</button><button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>이전</button>
        <label><span className="sr-only">페이지 번호</span><input type="number" min="1" max={pageCount} value={page} onChange={(event) => setPage(Math.min(pageCount, Math.max(1, Number(event.target.value))))}/></label>
        <span>/ {pageCount}</span><button onClick={() => setPage(Math.min(pageCount, page + 1))} disabled={page === pageCount}>다음</button><button onClick={() => setPage(pageCount)} disabled={page === pageCount}>마지막</button>
      </nav></>}
    {detail && <><button className="drawer-scrim" aria-label="응답 상세 닫기" onClick={() => setDetail(null)}/><ResponseDetail response={detail} questions={questions} onClose={() => setDetail(null)}/></>}
    {result.items.some((response) => response.attachments?.length) && <section className="card attachment-downloads"><h2><Paperclip/> 현재 페이지 첨부파일</h2><div>{result.items.flatMap((response) => response.attachments ?? []).map((attachment) => <a key={attachment.id} href={attachment.downloadUrl} target="_blank" rel="noreferrer" download><ExternalLink/> {attachment.name}</a>)}</div><button onClick={() => result.items.flatMap((response) => response.attachments ?? []).forEach((attachment) => { if (!attachment.downloadUrl) return; const link = document.createElement('a'); link.href = attachment.downloadUrl; link.download = attachment.name; link.target = '_blank'; link.click() })}><Download/> 현재 페이지 첨부파일 모두 다운로드</button><small>브라우저 보안 정책상 여러 파일은 링크별로 내려받아야 할 수 있습니다.</small></section>}
  </section>
}
