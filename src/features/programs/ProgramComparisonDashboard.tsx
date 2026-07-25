import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
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

function ProgramVolumeChart({ programs }: { programs: ProgramComparisonMetric[] }) {
  const maximum = Math.max(1, ...programs.flatMap((program) => [
    program.demandResponses,
    program.applicationResponses,
    program.satisfactionResponses,
  ]))
  return <section className="card comparison-chart volume-chart" aria-labelledby="volume-chart-title">
    <header><div><span className="eyebrow">PROGRAM VOLUME</span><h2 id="volume-chart-title">프로그램별 관심·신청·응답 규모</h2></div>
      <div className="chart-legend"><span className="demand">수요</span><span className="application">신청</span><span className="satisfaction">만족도 응답</span></div>
    </header>
    <div className="volume-chart-body">{programs.map((program) => <article key={program.programId}>
      <b>{program.programName}</b>
      {([
        ['demand', program.demandResponses, '수요'],
        ['application', program.applicationResponses, '신청'],
        ['satisfaction', program.satisfactionResponses, '만족도'],
      ] as const).map(([kind, value, label]) => <div className="volume-bar" key={kind}>
        <span>{label}</span><i><b className={kind} style={{ width: `${value / maximum * 100}%` }}/></i><strong>{value}명</strong>
      </div>)}
    </article>)}</div>
    {!programs.length && <p className="empty-copy">표시할 프로그램이 없습니다.</p>}
  </section>
}

function ResponseDonut({ program }: { program?: ProgramComparisonMetric }) {
  const rawRate = program?.satisfactionResponseRate ?? 0
  const chartRate = Math.max(0, Math.min(1, rawRate))
  return <section className="card comparison-chart donut-chart" aria-labelledby="response-donut-title">
    <header><div><span className="eyebrow">RESPONSE COVERAGE</span><h2 id="response-donut-title">만족도 응답률</h2></div></header>
    {program ? <div className="donut-chart-body">
      <div className="donut" role="img" aria-label={`${program.programName} 만족도 응답률 ${percent(rawRate)}`} style={{ '--donut-rate': `${chartRate * 360}deg` } as CSSProperties}>
        <span><strong>{percent(rawRate)}</strong><small>응답률</small></span>
      </div>
      <div><h3>{program.programName}</h3><p><b>{program.satisfactionResponses}명</b> 응답 / 선발 {program.selectedHeadcount ?? '-'}명</p>
        <small>실제 출석률이 아닌 선발 인원 대비 만족도 응답 비율입니다.</small></div>
    </div> : <p className="empty-copy">프로그램을 선택해 주세요.</p>}
  </section>
}

function GradePopularityChart({ program }: { program?: ProgramComparisonMetric }) {
  const grades = program
    ? Object.entries(program.gradeBreakdown).filter(([grade]) => grade !== '학년 미응답')
    : []
  const maximum = Math.max(1, ...grades.flatMap(([, metric]) => [metric.applicationResponses, metric.satisfactionResponses]))
  return <section className="card comparison-chart grade-chart" aria-labelledby="grade-chart-title">
    <header><div><span className="eyebrow">GRADE POPULARITY</span><h2 id="grade-chart-title">학년별 신청·만족도 응답</h2></div>
      <div className="chart-legend"><span className="application">신청</span><span className="satisfaction">만족도 응답</span></div></header>
    <div className="grade-chart-body">{grades.map(([grade, metric]) => <div key={grade}>
      <b>{grade}</b>
      <span><i className="application" style={{ width: `${metric.applicationResponses / maximum * 100}%` }}/><strong>{metric.applicationResponses}</strong></span>
      <span><i className="satisfaction" style={{ width: `${metric.satisfactionResponses / maximum * 100}%` }}/><strong>{metric.satisfactionResponses}</strong></span>
    </div>)}</div>
    {!grades.length && <p className="empty-copy">학년별 응답 데이터가 없습니다.</p>}
  </section>
}

function YearlyRatingChart({ items }: { items: ProgramComparisonMetric[] }) {
  const points = items.filter((item) => item.satisfactionAverage !== undefined)
  const x = (index: number) => points.length <= 1 ? 300 : 55 + index * (520 / (points.length - 1))
  const y = (rating: number) => 215 - (rating - 1) / 4 * 160
  const polyline = points.map((item, index) => `${x(index)},${y(item.satisfactionAverage ?? 1)}`).join(' ')
  return <section className="card comparison-chart yearly-line-chart" aria-labelledby="yearly-rating-title">
    <header><div><span className="eyebrow">YEARLY TREND</span><h2 id="yearly-rating-title">연도별 평균 만족도 변화</h2></div></header>
    {points.length >= 2 ? <svg viewBox="0 0 620 260" role="img" aria-label={`${points[0].programName} 연도별 평균 만족도 선그래프`}>
      {[1, 2, 3, 4, 5].map((rating) => <g key={rating}><line x1="55" x2="575" y1={y(rating)} y2={y(rating)} /><text x="35" y={y(rating) + 4}>{rating}</text></g>)}
      <polyline className="rating-line" points={polyline}/>
      {points.map((item, index) => <g className="rating-point" key={item.programId}>
        <circle cx={x(index)} cy={y(item.satisfactionAverage ?? 1)} r="7"/>
        <text className="point-score" x={x(index)} y={y(item.satisfactionAverage ?? 1) - 14}>{score(item.satisfactionAverage)}</text>
        <text className="point-year" x={x(index)} y="244">{item.year}</text>
      </g>)}
    </svg> : <p className="empty-copy">같은 프로그램의 연도별 데이터가 2개 이상 필요합니다.</p>}
  </section>
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
  const [programName, setProgramName] = useState('all')
  const [topics, setTopics] = useState<Record<string, ResponseTopic[]>>({})
  const [analyzing, setAnalyzing] = useState(false)
  useEffect(() => {
    if (year !== 'all' && data.years.length && !data.years.includes(year)) setYear(data.years[0])
  }, [data.years, year])
  const programOptions = useMemo(() => [...new Set(data.programs.map(({ programName: name }) => name))]
    .sort((left, right) => left.localeCompare(right, 'ko')), [data.programs])
  const filtered = useMemo(() => {
    const source = year === 'all'
      ? data.programs
      : filterProgramMetrics(data.programs, year, grade)
    const filterProgram = (items: ProgramComparisonMetric[]) => programName === 'all'
      ? items
      : items.filter((program) => program.programName === programName)
    if (year === 'all' && grade !== 'all') {
      return filterProgram([...new Set(data.programs.map(({ year: itemYear }) => itemYear))]
        .flatMap((itemYear) => filterProgramMetrics(data.programs, itemYear, grade))
      )
    }
    return filterProgram(source)
  }, [data.programs, grade, programName, year])
  const selected = filtered.find((program) =>
    program.demandResponses + program.applicationResponses + program.satisfactionResponses > 0,
  ) ?? filtered[0]
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
  const selectedYearlyItems = useMemo(() => {
    if (!selected) return []
    return data.programs
      .filter((program) => program.programName.trim().toLocaleLowerCase('ko') === selected.programName.trim().toLocaleLowerCase('ko'))
      .sort((left, right) => left.year - right.year)
  }, [data.programs, selected])

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
      <label>프로그램<select value={programName} onChange={(event) => setProgramName(event.target.value)}>
        <option value="all">전체 프로그램 비교</option>
        {programOptions.map((name) => <option value={name} key={name}>{name}</option>)}
      </select></label>
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
      <section className="comparison-visuals" aria-label="프로그램 비교 그래프">
        <ProgramVolumeChart programs={filtered}/>
        <div className="comparison-chart-grid"><ResponseDonut program={selected}/><GradePopularityChart program={selected}/></div>
        <YearlyRatingChart items={selectedYearlyItems}/>
      </section>
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
          <select value={programName} onChange={(event) => setProgramName(event.target.value)}>
            <option value="all">현재 필터의 대표 프로그램</option>
            {programOptions.map((name) => <option value={name} key={name}>{name}</option>)}
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
