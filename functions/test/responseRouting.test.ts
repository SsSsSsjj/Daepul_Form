import { describe, expect, it } from 'vitest'
import { questionsOnResponseRoute } from '../src/responseRouting'

const questions = [
  { id: 1, type: 'select', sectionId: 'status', options: ['재학생', '휴학생'], branch: { 재학생: 'student', 휴학생: 'leave' } },
  { id: 2, sectionId: 'student', sectionNext: 'submit' },
  { id: 3, sectionId: 'leave', sectionNext: 'submit' },
]

describe('server response routing', () => {
  it('validates only questions on the selected section path', () => {
    expect(questionsOnResponseRoute(questions, { 1: '재학생' }).map(({ id }) => id)).toEqual([1, 2])
    expect(questionsOnResponseRoute(questions, { 1: '휴학생' }).map(({ id }) => id)).toEqual([1, 3])
  })

  it('keeps every question for legacy forms without sections', () => {
    expect(questionsOnResponseRoute([{ id: 1 }, { id: 2 }], {}).map(({ id }) => id)).toEqual([1, 2])
  })

  it('stops safely when a route cycles', () => {
    const cyclic = [
      { id: 1, sectionId: 'one', sectionNext: 'two' },
      { id: 2, sectionId: 'two', sectionNext: 'one' },
    ]
    expect(questionsOnResponseRoute(cyclic, {}).map(({ id }) => id)).toEqual([1, 2])
  })
})
