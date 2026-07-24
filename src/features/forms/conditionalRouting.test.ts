import { describe, expect, it } from 'vitest'
import type { FormQuestion } from '../../types'
import {
  answersForResponseRoute,
  getQuestionSections,
  resolveResponseRoute,
  routingWarnings,
} from './conditionalRouting'

const routedQuestions: FormQuestion[] = [
  { id: 1, label: '학적 상태', type: 'select', required: true, options: ['재학생', '휴학생'], sectionId: 'status', sectionTitle: '학적 확인', branch: { 재학생: 'student', 휴학생: 'leave' } },
  { id: 2, label: '재학생 질문', type: 'short_text', required: true, sectionId: 'student', sectionTitle: '재학생 문항', sectionNext: 'submit' },
  { id: 3, label: '휴학생 질문', type: 'short_text', required: true, sectionId: 'leave', sectionTitle: '휴학생 문항', sectionNext: 'submit' },
]

describe('conditional section routing', () => {
  it('keeps section order and titles from questions', () => {
    expect(getQuestionSections(routedQuestions).map(({ id, title }) => ({ id, title }))).toEqual([
      { id: 'status', title: '학적 확인' },
      { id: 'student', title: '재학생 문항' },
      { id: 'leave', title: '휴학생 문항' },
    ])
  })

  it('follows a selected answer to its target section', () => {
    expect(resolveResponseRoute(routedQuestions, { 1: '휴학생' }).sectionIds).toEqual(['status', 'leave'])
    expect(resolveResponseRoute(routedQuestions, { 1: '재학생' }).sectionIds).toEqual(['status', 'student'])
  })

  it('stops the route when an option submits the form', () => {
    const questions = routedQuestions.map((question) => question.id === 1
      ? { ...question, branch: { 재학생: 'student', 휴학생: 'submit' as const } }
      : question)
    expect(resolveResponseRoute(questions, { 1: '휴학생' })).toMatchObject({
      sectionIds: ['status'],
      terminal: 'submit',
    })
  })

  it('removes answers that are not on the selected route', () => {
    expect(answersForResponseRoute(routedQuestions, { 1: '휴학생', 2: '숨겨진 답', 3: '유효한 답' })).toEqual({
      1: '휴학생',
      3: '유효한 답',
    })
  })

  it('warns about missing targets and cycles', () => {
    const invalid: FormQuestion[] = [
      { id: 1, label: '분기', type: 'select', required: true, options: ['A'], sectionId: 'one', branch: { A: 'two' } },
      { id: 2, label: '되돌아가기', type: 'select', required: true, options: ['B'], sectionId: 'two', branch: { B: 'one' } },
    ]
    expect(routingWarnings(invalid)).toContain('섹션 이동이 순환하도록 설정되어 응답자가 설문을 끝낼 수 없습니다.')
    expect(routingWarnings([{ ...invalid[0], branch: { A: 'missing' } }])[0]).toContain('존재하지 않는 섹션')
  })
})
