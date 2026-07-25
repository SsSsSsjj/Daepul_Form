import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, BarChart3, LoaderCircle, Sparkles, TrendingDown, Trophy, Users } from 'lucide-react'
import type { ProgramComparisonData, ProgramComparisonMetric, ResponseTopic } from '../../types'
import {
  filterProgramMetrics,
  gradeOptions,
  improvementKeywords,
  rankedPrograms,
} from './model'

function percent(value?: number) {
  return value === undefined ? '-' : `${(value * 100).toFixed(1)}%`
}

function score(value?: number) {
  return value === undefined ? '-' : value.toFixed(2)
}

function MetricCard({
  label,
  program,
  value,
  sample,
  icon,
}: {
  label: string
  program?: ProgramComparisonMetric
  value: (program: ProgramComparisonMetric) => string
  sample: (program: ProgramComparisonMetric) => number
  icon: ReactNode
}) {
  return <article className="card comparison-highlight">
    <span>{icon}{label}</span>
    <strong>{program?.programName ?? '집계 없음'}</strong>
    <small>{program ? `${value(program)} · 표본 ${sample(program)}명` : '조건에 맞는 프로그램이 없습니다.'}</small>
  </article>
}

export function ProgramComparisonDashboard({
  data,
  loading,
  onBack,
  onRefresh,
  onAnalyze,
}: {
  data: ProgramComparisonData
  loading: boolean
  onBack: () => void
  onRefresh: () => void
  onAnalyze: (comments: string[]) => Promise<ResponseTopic[]>
}) {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState<number | 'all'>(
    data.years.includes(currentYear) ? currentYear : (data.years[0] ?? currentYear),
  )
  const [grade, setGrade] = useState('all')
  const [programId, setProgramId] = useState('')
  const [topics, setTopics] = useState<Record<string, ResponseTopic[]>>({})
  const [analyzing, setAnalyzing] = useState(false)
  useEffect(() => {
    if (year !== 'all' && data.years.length && !data.years.includes(year)) setYear(data.years[0])
  }, [data.years, year])
  const filtered = useMemo(() => {
    const source = year === 'all'
      ? data.programs
      : filterProgramMetrics(data.programs, year, grade)
    if (year === 'all' && grade !== 'all') {
      return [...new Set(data.programs.map(({ year: itemYear }) => itemYear))]
        .flatMap((itemYear) => filterProgramMetrics(data.programs, itemYear, grade))
    }
    return source
  }, [data.programs, grade, year])
  const selected = filtered.find(({ programId: id }) => id === programId) ?? filtered[0]
  const topDemand = rankedPrograms([...filtered], 'demandResponses')[0]
  const topApplications = rankedPrograms([...filtered], 'applicationResponses')[0]
  const topCompetition = rankedPrograms([...filtered], 'applicationRatio')[0]
  const topSatisfaction = rankedPrograms([...filtered], 'satisfactionAverage')[0]
  const lowCompetition = rankedPrograms([...filtered], 'applicationRatio', 'low')[0]
  const lowResponseRate = rankedPrograms([...filtered], 'satisfactionResponseRate', 'low')[0]
  const lowSatisfaction = rankedPrograms([...filtered], 'satisfactionAverage', 'low')[0]
  const keywords = improvementKeywords(selected?.improvementComments ?? [])
  const yearlyGroups = useMemo(() => {
    const groups = new Map<string, ProgramComparisonMetric[]>()
    data.programs.forEach((program) => {
      const key = program.programName.trim().toLocaleLowerCase('ko')
      groups.set(key, [...(groups.get(key) ?? []), program])
    })
    return [...groups.values()]
      .filter((items) => items.length > 1)
      .map((items) => items.sort((left, right) => left.year - right.year))
  }, [data.programs])

  const analyze = async () => {
    if (!selected?.improvementComments.length || topics[selected.programId]) return
    setAnalyzing(true)
    try {
      const analyzedTopics = await onAnalyze(selected.improvementComments)
      try {
        localStorage.setItem(`daepul-program-analysis:${selected.programId}`, JSON.stringify({
          commentCount: selected.improvementComments.length,
          topics: analyzedTopics,
        }))
      } catch {
        // The dashboard still works when browser storage is unavailable.
      }
      setTopics((current) => ({
        ...current,
        [selected.programId]: analyzedTopics,
      }))
    } finally {
      setAnalyzing(false)
    }
  }

  useEffect(() => {
    if (!selected || topics[selected.programId]) return
    try {
      const cached = JSON.parse(localStorage.getItem(`daepul-program-analysis:${selected.programId}`) ?? 'null') as {
        commentCount?: number
        topics?: ResponseTopic[]
      } | null
      if (cached?.commentCount === selected.improvementComments.length && Array.isArray(cached.topics)) {
        setTopics((current) => ({ ...current, [selected.programId]: cached.topics ?? [] }))
      }
    } catch {
      // Ignore stale or unavailable cached analysis.
    }
  }, [selected, topics])

  return <section className="program-comparison-dashboard">
    <button className="result-back-button" onClick={onBack}><ArrowLeft/> 폼 관리로</button>
    <div className="comparison-heading">
      <div><span className="eyebrow">PROGRAM INSIGHTS</span><h1>프로그램 비교</h1><p>신청, 선발, 만족도 데이터를 연도와 학년별로 비교합니다.</p></div>
      <button onClick={onRefresh} disabled={loading}>{loading ? <LoaderCircle className="spin"/> : <BarChart3/>} 새로고침</button>
    </div>
    <div className="card comparison-filters">
      <label>연도<select value={year} onChange={(event) => setYear(event.target.value === 'all' ? 'all' : Number(event.target.value))}>
        <option value="all">전체 연도 비교</option>
        {data.years.map((item) => <option value={item} key={item}>{item}년</option>)}
      </select></label>
      <label>학년<select value={grade} onChange={(event) => setGrade(event.target.value)}>
        <option value="all">전체 학년</option>
        {gradeOptions.map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <small>평균 만족도 순위는 유효 응답 3건 이상만 포함합니다.</small>
    </div>
    {data.truncated && <div className="notice warn">폼당 10,000건까지만 집계되어 일부 결과가 생략됐을 수 있습니다.</div>}
    {loading ? <div className="center"><LoaderCircle className="spin"/></div> : <>
      <div className="comparison-highlights">
        <MetricCard label="수요 응답 1위" program={topDemand} value={(item) => `${item.demandResponses}명`} sample={(item) => item.demandResponses} icon={<BarChart3/>}/>
        <MetricCard label="신청자 수 1위" program={topApplications} value={(item) => `${item.applicationResponses}명`} sample={(item) => item.applicationResponses} icon={<Users/>}/>
        <MetricCard label="신청 경쟁도 1위" program={topCompetition} value={(item) => percent(item.applicationRatio)} sample={(item) => item.applicationResponses} icon={<Trophy/>}/>
        <MetricCard label="평균 만족도 1위" program={topSatisfaction} value={(item) => `${score(item.satisfactionAverage)}점`} sample={(item) => item.satisfactionSampleSize} icon={<Sparkles/>}/>
      </div>
      <section className="card comparison-table-card">
        <h2>프로그램별 핵심 지표</h2>
        <div className="comparison-table-scroll"><table className="comparison-table">
          <thead><tr><th>연도</th><th>프로그램</th><th>수요 응답</th><th>참가신청</th><th>선발 인원</th><th>신청 경쟁도</th><th>만족도 응답</th><th>만족도 응답률</th><th>평균 평점</th></tr></thead>
          <tbody>{filtered.map((program) => <tr key={program.programId}>
            <td>{program.year}</td><th>{program.programName}</th><td>{program.demandResponses}</td><td>{program.applicationResponses}</td>
            <td>{program.selectedHeadcount ?? '-'}</td><td>{percent(program.applicationRatio)}</td><td>{program.satisfactionResponses}</td>
            <td>{percent(program.satisfactionResponseRate)}</td><td>{score(program.satisfactionAverage)} <small>({program.satisfactionSampleSize}명)</small></td>
          </tr>)}</tbody>
        </table></div>
        {!filtered.length && <p className="empty-copy">분류된 프로그램 데이터가 없습니다.</p>}
      </section>
      <div className="comparison-low-grid">
        <article className="card"><h2><TrendingDown/> 확인이 필요한 지표</h2>
          <p>낮은 신청 경쟁도 <strong>{lowCompetition?.programName ?? '-'}</strong> {percent(lowCompetition?.applicationRatio)}</p>
          <p>낮은 만족도 응답률 <strong>{lowResponseRate?.programName ?? '-'}</strong> {percent(lowResponseRate?.satisfactionResponseRate)}</p>
          <p>낮은 평균 만족도 <strong>{lowSatisfaction?.programName ?? '-'}</strong> {score(lowSatisfaction?.satisfactionAverage)}</p>
          <small>실제 출석률이 아니라 선발 인원 대비 만족도 응답률을 사용합니다.</small>
        </article>
        <article className="card"><h2>아쉬운 점 분석</h2>
          <select value={selected?.programId ?? ''} onChange={(event) => setProgramId(event.target.value)}>
            {filtered.map((program) => <option value={program.programId} key={program.programId}>{program.year} · {program.programName}</option>)}
          </select>
          <div className="comparison-keywords">{keywords.map((item) => <span key={item.keyword}>{item.keyword} <b>{item.count}</b></span>)}</div>
          <button onClick={() => void analyze()} disabled={analyzing || !selected?.improvementComments.length || Boolean(selected && topics[selected.programId])}>
            {analyzing ? <LoaderCircle className="spin"/> : <Sparkles/>} AI 의견 요약
          </button>
          {selected && topics[selected.programId]?.map((topic) => <div className="comparison-topic" key={topic.id}><b>{topic.title}</b><p>{topic.summary}</p><small>{topic.reportSentence}</small></div>)}
          {selected?.improvementComments.slice(0, 3).map((comment, index) => <blockquote key={index}>{comment}</blockquote>)}
        </article>
      </div>
      {yearlyGroups.length > 0 && <section className="card yearly-comparison">
        <h2>연도별 추이</h2><p>같은 이름으로 등록된 프로그램의 연도별 변화를 비교합니다.</p>
        {yearlyGroups.map((items) => <article key={items[0].programName}>
          <h3>{items[0].programName}</h3>
          <div>{items.map((item) => <span key={item.programId}><b>{item.year}</b>신청 {item.applicationResponses}명 · 응답률 {percent(item.satisfactionResponseRate)} · 평점 {score(item.satisfactionAverage)}</span>)}</div>
        </article>)}
      </section>}
    </>}
  </section>
}
