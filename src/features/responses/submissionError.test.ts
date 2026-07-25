import { describe, expect, it } from 'vitest'
import { submissionErrorMessage } from './submissionError'

describe('submissionErrorMessage', () => {
  it('does not expose Firebase internal errors to respondents', () => {
    expect(submissionErrorMessage({ code: 'functions/internal', message: 'internal' }))
      .toBe('서버에서 제출을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  })

  it('keeps actionable validation messages from callable functions', () => {
    expect(submissionErrorMessage({
      code: 'functions/invalid-argument',
      message: '생년월일은 YYYY-MM-DD 형식으로 입력해 주세요.',
    })).toBe('생년월일은 YYYY-MM-DD 형식으로 입력해 주세요.')
  })

  it('maps duplicate submissions to the existing application state', () => {
    expect(submissionErrorMessage({ code: 'functions/already-exists', message: '이미 제출했습니다.' }))
      .toBe('already-submitted')
  })
})
