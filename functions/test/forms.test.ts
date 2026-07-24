import { describe, expect, it } from 'vitest'
import { evaluateFormAccess, scoreQuizAnswers, validateSubmittedAnswers } from '../src/forms'

const openForm = {
  status: 'open',
  responseCount: 2,
  access: {
    mode: 'anyone',
    allowAnonymous: true,
    duplicatePolicy: 'browser_once',
  },
  schedule: {
    startAt: null,
    endAt: null,
    maxResponses: 10,
    showBeforeOpen: true,
  },
}

describe('evaluateFormAccess', () => {
  it('allows an anonymous respondent when the creator selected anyone', () => {
    expect(evaluateFormAccess(openForm, undefined)).toMatchObject({
      allowed: true,
      canSubmit: true,
      reason: 'ok',
      remainingResponses: 8,
    })
  })

  it('requires a real account for authenticated forms', () => {
    expect(evaluateFormAccess({
      ...openForm,
      access: { ...openForm.access, mode: 'authenticated', allowAnonymous: false },
    }, undefined)).toMatchObject({ allowed: true, canSubmit: false, reason: 'login_required' })
  })

  it('blocks submissions after capacity is reached', () => {
    expect(evaluateFormAccess({
      ...openForm,
      responseCount: 10,
    }, undefined)).toMatchObject({ canSubmit: false, reason: 'max_responses' })
  })

  it('keeps paused forms readable but not submittable', () => {
    expect(evaluateFormAccess({ ...openForm, status: 'paused' }, undefined)).toMatchObject({
      allowed: true,
      canSubmit: false,
      reason: 'paused',
    })
  })
})

describe('validateSubmittedAnswers', () => {
  const form = {
    questions: [
      { id: 'email', type: 'email', required: true },
      { id: 'student', type: 'student_id', required: false, validation: { studentIdLength: 8 } },
    ],
  }

  it('returns the failing field for inline error display', () => {
    expect(validateSubmittedAnswers(form, [{ questionId: 'email', value: 'wrong' }])).toEqual({
      valid: false,
      questionId: 'email',
      reason: 'email',
    })
  })

  it('accepts valid constrained values', () => {
    expect(validateSubmittedAnswers(form, [
      { questionId: 'email', value: 'student@kangnam.ac.kr' },
      { questionId: 'student', value: '20261234' },
    ])).toEqual({ valid: true })
  })
})

describe('scoreQuizAnswers', () => {
  it('scores single and multiple answer questions without depending on answer order', () => {
    expect(scoreQuizAnswers({
      enabled: true,
      releaseScore: 'immediately',
      showCorrectAnswers: true,
      questions: {
        1: { points: 2, correctAnswers: ['서울'] },
        2: { points: 3, correctAnswers: ['A', 'B'] },
      },
    }, { 1: '서울', 2: ['B', 'A'] })).toMatchObject({
      score: 5,
      maxScore: 5,
      percentage: 100,
      released: true,
    })
  })

  it('keeps scores private when release is deferred', () => {
    expect(scoreQuizAnswers({
      enabled: true,
      releaseScore: 'later',
      questions: { 1: { points: 10, correctAnswers: ['yes'] } },
    }, { 1: 'no' })).toMatchObject({ score: 0, maxScore: 10, released: false })
  })
})
