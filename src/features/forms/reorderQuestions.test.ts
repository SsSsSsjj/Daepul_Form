import { describe, expect, it } from 'vitest'
import type { FormQuestion } from '../../types'
import { reorderQuestions } from './reorderQuestions'

const questions: FormQuestion[] = [
  { id: 1, label: '첫 번째', type: 'short_text', required: true },
  { id: 2, label: '두 번째', type: 'short_text', required: true },
  { id: 3, label: '세 번째', type: 'short_text', required: true },
]

describe('reorderQuestions', () => {
  it('앞 질문을 뒤 위치로 이동한다', () => {
    expect(reorderQuestions(questions, 1, 3).map(({ id }) => id)).toEqual([2, 3, 1])
  })

  it('뒤 질문을 앞 위치로 이동한다', () => {
    expect(reorderQuestions(questions, 3, 1).map(({ id }) => id)).toEqual([3, 1, 2])
  })

  it('같은 위치나 없는 질문이면 기존 배열을 유지한다', () => {
    expect(reorderQuestions(questions, 2, 2)).toBe(questions)
    expect(reorderQuestions(questions, 99, 1)).toBe(questions)
  })
})
