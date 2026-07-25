import { describe, expect, it } from 'vitest'
import { aggregateProgramComparison } from './programComparison'

describe('aggregateProgramComparison', () => {
  it('aggregates the application and satisfaction funnel by program and grade', () => {
    const result = aggregateProgramComparison([
      { id: 'p1', name: '진로 캠프', year: 2026, selectedHeadcount: 2 },
    ], [
      {
        id: 'application',
        programId: 'p1',
        formType: 'application',
        questions: [{ id: 1, analyticsRole: 'grade' }],
        responses: [{ answers: { 1: '2학년' } }, { answers: { 1: '3학년' } }],
      },
      {
        id: 'satisfaction',
        programId: 'p1',
        formType: 'satisfaction',
        questions: [
          { id: 1, analyticsRole: 'grade' },
          { id: 2, analyticsRole: 'overall_satisfaction' },
          { id: 3, analyticsRole: 'improvement' },
        ],
        responses: [
          { answers: { 1: '2학년', 2: 5, 3: '시간이 짧아요' } },
          { answers: { 1: '2학년', 2: 3, 3: '장소 안내 필요' } },
        ],
      },
    ])
    expect(result[0]).toMatchObject({
      applicationResponses: 2,
      satisfactionResponses: 2,
      applicationRatio: 1,
      satisfactionResponseRate: 1,
      satisfactionAverage: 4,
      satisfactionSampleSize: 2,
    })
    expect(result[0].gradeBreakdown['2학년']).toMatchObject({
      applicationResponses: 1,
      satisfactionResponses: 2,
      satisfactionAverage: 4,
    })
    expect(result[0].improvementComments).toEqual(['시간이 짧아요', '장소 안내 필요'])
  })

  it('does not create rates without a selected headcount and carries truncation', () => {
    const result = aggregateProgramComparison([
      { id: 'p1', name: '취업 특강', year: 2025 },
    ], [{
      id: 'satisfaction',
      programId: 'p1',
      formType: 'satisfaction',
      questions: [],
      responses: [],
      truncated: true,
    }])
    expect(result[0].applicationRatio).toBeUndefined()
    expect(result[0].satisfactionResponseRate).toBeUndefined()
    expect(result[0].truncated).toBe(true)
  })
})
