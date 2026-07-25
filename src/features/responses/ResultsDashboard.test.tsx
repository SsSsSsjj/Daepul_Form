// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormQuestion, QuestionSummary, ResponseTopic } from '../../types'
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
  it('returns to the screen that opened the results dashboard', () => {
    const onBack = vi.fn()
    render(<ResultsDashboard
      title="테스트 폼"
      loading={false}
      responses={responses}
      questions={questions}
      summaries={summaries}
      message=""
      sample
      onBack={onBack}
      onRefresh={vi.fn()}
      onExportExcel={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('button', { name: '이전 화면' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('exposes all four result views, AI summary, and the sample-data warning', async () => {
    const topics: ResponseTopic[] = [{
      id: 'sample-topic',
      title: '실무 중심 구성에 대한 만족',
      category: '긍정 의견',
      summary: '실제 사례가 도움이 되었다는 의견이 많았습니다.',
      sourceIds: [0, 1],
      reportSentence: '참여자들은 실무 사례를 긍정적으로 평가했습니다.',
    }]
    render(<ResultsDashboard
      title="테스트 폼"
      loading={false}
      responses={responses}
      questions={questions}
      summaries={summaries}
      message=""
      sample
      onRefresh={vi.fn()}
      onAnalyze={vi.fn().mockResolvedValue(topics)}
      onExportExcel={vi.fn()}
    />)
    expect(screen.getByText('예시 데이터이며 실제 응답이 아닙니다')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'AI 요약' }))
    expect(await screen.findByText('실무 중심 구성에 대한 만족')).toBeInTheDocument()
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
    expect(screen.getByText('20201200')).toBeInTheDocument()
  })

  it('provides advanced filters, configurable columns and server-backed bulk actions', () => {
    const manage = vi.fn().mockResolvedValue(undefined)
    render(<ResultsDashboard
      title="테스트 폼"
      loading={false}
      responses={responses}
      questions={questions}
      summaries={summaries}
      message=""
      onRefresh={vi.fn()}
      onExportExcel={vi.fn()}
      onManage={manage}
    />)
    fireEvent.click(screen.getByRole('tab', { name: /표/ }))
    expect(screen.getByLabelText('상태')).toBeInTheDocument()
    expect(screen.getByText('선택 질문 미응답만')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /열 설정/ }))
    expect(screen.getByText('질문 열 너비')).toBeInTheDocument()
    expect(screen.getByLabelText('현재 페이지 전체 선택')).toBeInTheDocument()
  })
})
