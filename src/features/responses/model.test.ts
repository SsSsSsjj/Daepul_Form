import { describe, expect, it } from 'vitest'
import { defaultFormSettings, type FormQuestion, type StoredFormResponse } from '../../types'
import {
  createSampleResponses,
  extractKeywordInsights,
  getFormAvailability,
  queryResponses,
  responsesToCsv,
  validateAnswers,
} from './model'

const questions: FormQuestion[] = [
  { id: 1, label: '이름', type: 'short_text', required: true },
  { id: 2, label: '평점', type: 'rating', required: true, min: 1, max: 5 },
]

describe('public response model', () => {
  it('resolves lifecycle and capacity states', () => {
    expect(getFormAvailability(defaultFormSettings).state).toBe('open')
    expect(getFormAvailability({
      ...defaultFormSettings,
      schedule: { status: 'paused' },
    }).state).toBe('paused')
    expect(getFormAvailability({
      ...defaultFormSettings,
      submission: { ...defaultFormSettings.submission, maxResponses: 10 },
    }, 10).state).toBe('full')
  })

  it('returns field-level required errors', () => {
    expect(validateAnswers(questions, { 2: 4 })).toEqual({ 1: '필수 질문입니다.' })
    expect(validateAnswers(questions, { 1: '홍길동', 2: 4 })).toEqual({})
  })

  it('searches, sorts and paginates response metadata and answers', () => {
    const responses = createSampleResponses(questions, 60)
    const page = queryResponses(responses, {
      filters: { query: 'sample1@kangnam.ac.kr', status: 'all', selectedIds: [] },
      sortBy: 'submittedAt',
      sortDirection: 'desc',
      page: 1,
      pageSize: 25,
    })
    expect(page.total).toBe(1)
    expect(page.items[0].respondentName).toBe('김민준')
  })

  it('escapes spreadsheet formulas and quotes as CSV text', () => {
    const response: StoredFormResponse = { id: '1', answers: { 1: '="quoted"', 2: 5 } }
    const csv = responsesToCsv(questions, [response])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('""quoted""')
  })

  it('handles a 10,000 response performance scenario without returning all rows', () => {
    const responses = createSampleResponses(questions, 10_000)
    const startedAt = performance.now()
    const page = queryResponses(responses, {
      filters: { query: '', status: 'all', selectedIds: [] },
      sortBy: 'submittedAt',
      sortDirection: 'desc',
      page: 1,
      pageSize: 200,
    })
    expect(page.items).toHaveLength(200)
    expect(page.total).toBe(10_000)
    expect(performance.now() - startedAt).toBeLessThan(2_000)
  })

  it('combines status, answer, rating, missing and selected-response filters', () => {
    const responses: StoredFormResponse[] = [
      { id: 'a', status: 'reviewed', answers: { 1: '홍길동', 2: 5 } },
      { id: 'b', status: 'submitted', answers: { 1: '김대플' } },
    ]
    const reviewed = queryResponses(responses, {
      filters: { query: '', status: 'reviewed', questionId: 2, ratingMin: 4, selectedIds: ['a'] },
      sortBy: 'answer',
      sortDirection: 'desc',
      page: 1,
      pageSize: 25,
    })
    expect(reviewed.items.map((item) => item.id)).toEqual(['a'])
    const missing = queryResponses(responses, {
      filters: { query: '', status: 'all', missingQuestionId: 2, selectedIds: [] },
      sortBy: 'name',
      sortDirection: 'asc',
      page: 1,
      pageSize: 25,
    })
    expect(missing.items.map((item) => item.id)).toEqual(['b'])
  })

  it('finds repeated keywords across free-text responses and excludes one-off words', () => {
    const textQuestions: FormQuestion[] = [{ id: 1, label: '의견', type: 'long_text', required: false }]
    const responses: StoredFormResponse[] = [
      { id: 'a', answers: { 1: '멘토링 일정과 멘토링 안내가 좋았습니다' } },
      { id: 'b', answers: { 1: '멘토링 시간을 조금 늘려주세요' } },
      { id: 'c', answers: { 1: '시설이 깨끗합니다' } },
    ]
    expect(extractKeywordInsights(responses, textQuestions)).toEqual([
      { keyword: '멘토링', count: 3, responseCount: 2 },
    ])
  })
})
