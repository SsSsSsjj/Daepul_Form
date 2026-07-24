// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FormBody } from '../../App'
import type { FormQuestion, ProgramInfo } from '../../types'

const program: ProgramInfo = {
  programName: '조건부 섹션 미리보기',
  description: '선택한 답변에 맞는 질문만 표시합니다.',
  target: '',
  period: '',
  schedule: '',
  capacity: '',
  requirements: '',
  privacyConsent: '',
}

const questions: FormQuestion[] = [
  { id: 1, label: '학적 상태', type: 'select', required: true, options: ['재학생', '휴학생'], sectionId: 'status', sectionTitle: '응답자 구분', branch: { 재학생: 'student', 휴학생: 'leave' } },
  { id: 2, label: '프로그램 만족도', type: 'rating', required: true, sectionId: 'student', sectionTitle: '재학생 질문', sectionNext: 'submit' },
  { id: 3, label: '필요한 복학 지원', type: 'short_text', required: true, sectionId: 'leave', sectionTitle: '휴학생 질문', sectionNext: 'submit' },
]

describe('FormBody section preview', () => {
  it('moves to the section selected by an objective answer and supports back navigation', () => {
    render(<FormBody program={program} questions={questions} theme="green"/>)

    expect(screen.getByRole('heading', { name: '응답자 구분' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('1. 학적 상태 *'), { target: { value: '휴학생' } })
    fireEvent.click(screen.getByRole('button', { name: /다음/ }))

    expect(screen.getByRole('heading', { name: '휴학생 질문' })).toBeInTheDocument()
    expect(screen.getByText(/필요한 복학 지원/)).toBeInTheDocument()
    expect(screen.queryByText(/프로그램 만족도/)).not.toBeInTheDocument()
    expect(screen.getByText('2 / 2 페이지')).toBeInTheDocument()
    expect(screen.getByText('SECTION 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /이전/ }))
    expect(screen.getByRole('heading', { name: '응답자 구분' })).toBeInTheDocument()
  })
})
