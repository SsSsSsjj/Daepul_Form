// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormQuestion, QuestionSummary } from '../../types'
import { createSampleResponses } from './model'
import { ResultsDashboard } from './ResultsDashboard'

const questions: FormQuestion[] = [
  { id: 1, label: '이름', type: 'short_text', required: true },
  { id: 2, label: '만족도', type: 'rating', required: true },
]
const responses = createSampleResponses(questions, 10)
const summaries: QuestionSummary[] = [
  { questionId: 1, label: '이름', type: 'short_text', responseCount: 10, texts: responses.map((item) => String(item.answers[1])) },
  { questionId: 2, label: '만족도', type: 'rating', responseCount: 10, average: 3, distribution: [{ label: '1', count: 2 }] },
]

afterEach(cleanup)

describe('ResultsDashboard', () => {
  it('exposes all four result views and the sample-data warning', () => {
    render(<ResultsDashboard
      title="테스트 폼"
      loading={false}
      responses={responses}
      questions={questions}
      summaries={summaries}
      message=""
      sample
      onRefresh={vi.fn()}
      onExportExcel={vi.fn()}
    />)
    expect(screen.getByText('예시 데이터이며 실제 응답이 아닙니다')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    fireEvent.click(screen.getByRole('tab', { name: /표/ }))
    expect(screen.getByLabelText('응답 표')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('이름·학번·이메일·답변 검색')).toBeInTheDocument()
  })

  it('switches to an individual response and provides print/PDF action', () => {
    render(<ResultsDashboard
      title="테스트 폼"
      loading={false}
      responses={responses}
      questions={questions}
      summaries={summaries}
      message=""
      onRefresh={vi.fn()}
      onExportExcel={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('tab', { name: /개별/ }))
    expect(screen.getByRole('button', { name: /인쇄 \/ PDF/ })).toBeInTheDocument()
    expect(screen.getByText('20260001')).toBeInTheDocument()
  })
})
