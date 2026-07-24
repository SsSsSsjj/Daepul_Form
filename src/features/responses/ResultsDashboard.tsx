import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  BarChart3, ChevronLeft, ChevronRight, Download, FileText, Filter, LayoutList,
  Printer, RefreshCcw, RotateCcw, Search, Sheet, Table2, UserRound,
} from 'lucide-react'
import type { FormQuestion, QuestionSummary, ResponseFilters, ResponseQuery, StoredFormResponse } from '../../types'
import { downloadTextFile, queryResponses, responsesToCsv } from './model'

type ResultsTab = 'summary' | 'question' | 'individual' | 'table'

const emptyFilters: ResponseFilters = {
  query: '',
  status: 'all',
  selectedIds: [],
}

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

function SummaryView({ summaries, responses }: { summaries: QuestionSummary[]; responses: StoredFormResponse[] }) {
  const daily = useMemo(() => {
    const counts = new Map<string, number>()
    responses.forEach((response) => {
      const key = response.submittedAt ? response.submittedAt.slice(0, 10) : '날짜 없음'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14)
  }, [responses])
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

function QuestionView({ questions, responses }: { questions: FormQuestion[]; responses: StoredFormResponse[] }) {
  const [questionId, setQuestionId] = useState(questions[0]?.id)
  const question = questions.find((item) => item.id === questionId)
  const values = question ? responses.map((response) => response.answers[String(question.id)]).filter((value) => value !== undefined && value !== '') : []
  const counts = new Map<string, number>()
  values.forEach((value) => counts.set(answerText(value), (counts.get(answerText(value)) ?? 0) + 1))

  return <section className="card result-pane">
    <label className="field-label">질문 선택
      <select value={questionId} onChange={(event) => setQuestionId(Number(event.target.value))}>
        {questions.map((item, index) => <option value={item.id} key={item.id}>{index + 1}. {item.label}</option>)}
      </select>
    </label>
    {question && <><div className="question-metrics"><strong>{values.length}<small> 응답</small></strong><strong>{responses.length - values.length}<small> 미응답</small></strong></div>
      <div className="answer-frequency">{[...counts.entries()].map(([answer, count]) =>
        <article key={answer}><span>{answer}</span><strong>{count}회</strong></article>,
      )}</div>
    </>}
  </section>
}

function IndividualView({ questions, responses }: { questions: FormQuestion[]; responses: StoredFormResponse[] }) {
  const [index, setIndex] = useState(0)
  const response = responses[index]
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

function VirtualTable({ questions, responses }: { questions: FormQuestion[]; responses: StoredFormResponse[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({ count: responses.length, getScrollElement: () => parentRef.current, estimateSize: () => 52, overscan: 8 })
  return <div className="response-table-shell" ref={parentRef} tabIndex={0} aria-label="응답 표">
    <div className="response-table" style={{ minWidth: `${680 + questions.length * 180}px` }}>
      <div className="response-row response-header" style={{ gridTemplateColumns: `52px 150px 140px 220px repeat(${questions.length}, 180px)` }}>
        <span>#</span><span>이름</span><span>학번</span><span>이메일</span>{questions.map((question) => <span key={question.id} title={question.label}>{question.label}</span>)}
      </div>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => {
          const response = responses[row.index]
          return <div className="response-row" key={response.id} style={{ gridTemplateColumns: `52px 150px 140px 220px repeat(${questions.length}, 180px)`, transform: `translateY(${row.start}px)` }}>
            <span>{row.index + 1}</span><span>{response.respondentName ?? '익명'}</span><span>{response.studentId ?? '-'}</span><span>{response.respondentEmail ?? '-'}</span>
            {questions.map((question) => <span key={question.id} title={answerText(response.answers[String(question.id)])}>{answerText(response.answers[String(question.id)])}</span>)}
          </div>
        })}
      </div>
    </div>
  </div>
}

export function ResultsDashboard({
  title, loading, responses, questions, summaries, message, sample = false, onRefresh, onExportExcel,
}: {
  title: string
  loading: boolean
  responses: StoredFormResponse[]
  questions: FormQuestion[]
  summaries: QuestionSummary[]
  message: string
  sample?: boolean
  onRefresh: () => void
  onExportExcel: (items: StoredFormResponse[]) => void
}) {
  const [tab, setTab] = useState<ResultsTab>('summary')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<ResponseQuery['pageSize']>(25)
  const [sortDirection, setSortDirection] = useState<ResponseQuery['sortDirection']>('desc')
  const result = useMemo(() => queryResponses(responses, {
    filters: { ...emptyFilters, query: deferredSearch },
    sortBy: 'submittedAt',
    sortDirection,
    page,
    pageSize,
  }), [responses, deferredSearch, sortDirection, page, pageSize])
  const pageCount = Math.max(1, Math.ceil(result.total / pageSize))
  const safeTitle = (title || '대플폼').replace(/[\\/:*?"<>|]/g, '_')

  return <section className="results-dashboard">
    <div className="result-dashboard-head">
      <div><span className="eyebrow">RESPONSE DASHBOARD</span><h1>{title}</h1><p>응답을 요약·질문별·개별·표 형태로 확인합니다.</p></div>
      <div className="stat"><UserRound/><span>전체 응답</span><b>{responses.length}<small>명</small></b></div>
    </div>
    {sample && <div className="sample-data-badge" role="status">예시 데이터이며 실제 응답이 아닙니다</div>}
    {message && <div className="notice">{message}</div>}
    <div className="result-commandbar card">
      <div className="result-tabs" role="tablist" aria-label="결과 보기">
        {([
          ['summary', BarChart3, '종합'], ['question', LayoutList, '질문별'], ['individual', FileText, '개별'], ['table', Table2, '표'],
        ] as const).map(([value, Icon, label]) => <button role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)} key={value}><Icon/>{label}</button>)}
      </div>
      <div className="result-actions">
        <button onClick={onRefresh} disabled={loading}>{loading ? <RefreshCcw className="spin"/> : <RefreshCcw/>} 새로고침</button>
        <button onClick={() => downloadTextFile(`${safeTitle}_응답.csv`, responsesToCsv(questions, result.items))} disabled={!result.items.length}><Download/> CSV</button>
        <button className="primary" onClick={() => onExportExcel(result.items)} disabled={!result.items.length}><Sheet/> Excel</button>
      </div>
    </div>
    {(tab === 'table' || tab === 'individual') && <div className="result-filters card">
      <label className="search-field"><Search/><span className="sr-only">통합 검색</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="이름·학번·이메일·답변 검색"/></label>
      <label><Filter/><span className="sr-only">정렬</span><select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')}><option value="desc">최신 제출순</option><option value="asc">오래된 제출순</option></select></label>
      {search && <button onClick={() => setSearch('')}><RotateCcw/> 초기화</button>}
    </div>}
    {tab === 'summary' && <SummaryView summaries={summaries} responses={responses}/>}
    {tab === 'question' && <QuestionView questions={questions} responses={responses}/>}
    {tab === 'individual' && <IndividualView questions={questions} responses={result.items}/>}
    {tab === 'table' && <><VirtualTable questions={questions} responses={result.items}/>
      <nav className="pagination" aria-label="응답 페이지">
        <span>총 {result.total.toLocaleString()}개</span>
        <label>페이지당 <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as ResponseQuery['pageSize']); setPage(1) }}>{[25, 50, 100, 200].map((size) => <option key={size}>{size}</option>)}</select></label>
        <button onClick={() => setPage(1)} disabled={page === 1}>처음</button><button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>이전</button>
        <label><span className="sr-only">페이지 번호</span><input type="number" min="1" max={pageCount} value={page} onChange={(event) => setPage(Math.min(pageCount, Math.max(1, Number(event.target.value))))}/></label>
        <span>/ {pageCount}</span><button onClick={() => setPage(Math.min(pageCount, page + 1))} disabled={page === pageCount}>다음</button><button onClick={() => setPage(pageCount)} disabled={page === pageCount}>마지막</button>
      </nav></>}
  </section>
}

