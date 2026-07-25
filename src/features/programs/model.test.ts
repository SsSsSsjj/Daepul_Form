import { describe, expect, it } from 'vitest'
import type { ProgramComparisonMetric } from '../../types'
import {
  aggregateProgramComparison,
  ensureAnalyticsQuestions,
  filterProgramMetrics,
  improvementKeywords,
  rankedPrograms,
  ratio,
} from './model'

const metric = (change: Partial<ProgramComparisonMetric>): ProgramComparisonMetric => ({
  programId: 'p1',
  programName: '진로 캠프',
  year: 2026,
  selectedHeadcount: 20,
  demandResponses: 30,
  applicationResponses: 25,
  satisfactionResponses: 15,
  applicationRatio: 1.25,
  satisfactionResponseRate: .75,
  satisfactionAverage: 4.5,
  satisfactionSampleSize: 15,
  gradeBreakdown: {},
  improvementComments: [],
  truncated: false,
  ...change,
})

describe('program comparison model', () => {
  it('aggregates owner-readable Firestore forms without a callable function', () => {
    const [result] = aggregateProgramComparison([
      { id: 'p1', name: '진로 캠프', year: 2026, selectedHeadcount: 20 },
    ], [
      {
        id: 'application',
        programId: 'p1',
        formType: 'application',
        questions: [{ id: 1, label: '학년', type: 'select', required: true, analyticsRole: 'grade' }],
        responses: [{ id: 'a1', answers: { 1: '2학년' } }],
      },
      {
        id: 'satisfaction',
        programId: 'p1',
        formType: 'satisfaction',
        questions: [
          { id: 1, label: '학년', type: 'select', required: true, analyticsRole: 'grade' },
          { id: 2, label: '만족도', type: 'rating', required: true, analyticsRole: 'overall_satisfaction' },
          { id: 3, label: '개선', type: 'long_text', required: false, analyticsRole: 'improvement' },
        ],
        responses: [{ id: 's1', answers: { 1: '2학년', 2: 4, 3: '시간을 늘려 주세요.' } }],
      },
    ])
    expect(result).toMatchObject({
      applicationResponses: 1,
      satisfactionResponses: 1,
      applicationRatio: .05,
      satisfactionResponseRate: .05,
      satisfactionAverage: 4,
      improvementComments: ['시간을 늘려 주세요.'],
    })
  })

  it('adds standard questions once for each categorized form type', () => {
    const satisfaction = ensureAnalyticsQuestions([], 'satisfaction', 10)
    expect(satisfaction.map(({ analyticsRole }) => analyticsRole)).toEqual([
      'grade', 'overall_satisfaction', 'strength', 'improvement',
    ])
    expect(ensureAnalyticsQuestions(satisfaction, 'satisfaction', 20)).toHaveLength(4)
    expect(ensureAnalyticsQuestions([], 'general')).toEqual([])
  })

  it('calculates ratios only with a positive selected headcount', () => {
    expect(ratio(15, 20)).toBe(.75)
    expect(ratio(15, 0)).toBeUndefined()
    expect(ratio(15)).toBeUndefined()
  })

  it('uses grade-specific values while retaining the selected headcount denominator', () => {
    const [filtered] = filterProgramMetrics([metric({
      gradeBreakdown: {
        '2학년': {
          demandResponses: 6,
          applicationResponses: 5,
          satisfactionResponses: 4,
          satisfactionAverage: 4.25,
          satisfactionSampleSize: 4,
        },
      },
    })], 2026, '2학년')
    expect(filtered.applicationResponses).toBe(5)
    expect(filtered.applicationRatio).toBe(.25)
    expect(filtered.satisfactionAverage).toBe(4.25)
  })

  it('excludes satisfaction samples smaller than three from rankings', () => {
    const ranked = rankedPrograms([
      metric({ programId: 'small', satisfactionAverage: 5, satisfactionSampleSize: 2 }),
      metric({ programId: 'valid', satisfactionAverage: 4.2, satisfactionSampleSize: 3 }),
    ], 'satisfactionAverage')
    expect(ranked.map(({ programId }) => programId)).toEqual(['valid'])
  })

  it('extracts repeated improvement keywords', () => {
    expect(improvementKeywords(['시간 안내가 아쉬웠습니다', '시간 배정과 장소 안내 필요']))
      .toEqual(expect.arrayContaining([{ keyword: '시간', count: 2 }, { keyword: '안내', count: 2 }]))
  })
})
