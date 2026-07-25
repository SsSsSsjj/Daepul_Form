// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { ProgramComparisonDashboard } from './ProgramComparisonDashboard'

describe('ProgramComparisonDashboard', () => {
  it('shows separate rankings and a same-name yearly comparison', () => {
    render(<ProgramComparisonDashboard
      data={{
        years: [2026, 2025],
        truncated: false,
        programs: [
          {
            programId: 'p-2026',
            programName: '진로 캠프',
            year: 2026,
            selectedHeadcount: 20,
            demandResponses: 30,
            applicationResponses: 25,
            satisfactionResponses: 18,
            applicationRatio: 1.25,
            satisfactionResponseRate: .9,
            satisfactionAverage: 4.5,
            satisfactionSampleSize: 18,
            gradeBreakdown: {},
            improvementComments: ['시간을 늘려 주세요.'],
            truncated: false,
          },
          {
            programId: 'p-2025',
            programName: '진로 캠프',
            year: 2025,
            selectedHeadcount: 20,
            demandResponses: 20,
            applicationResponses: 18,
            satisfactionResponses: 15,
            applicationRatio: .9,
            satisfactionResponseRate: .75,
            satisfactionAverage: 4.1,
            satisfactionSampleSize: 15,
            gradeBreakdown: {},
            improvementComments: [],
            truncated: false,
          },
        ],
      }}
      loading={false}
      onBack={vi.fn()}
      onRefresh={vi.fn()}
      onAnalyze={vi.fn(async () => [])}
    />)
    expect(screen.getByRole('heading', { name: '프로그램 비교' })).toBeInTheDocument()
    expect(screen.getByText('신청자 수 1위')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '연도별 추이' })).toBeInTheDocument()
    expect(screen.getByText(/신청 18명 · 응답률 75.0%/)).toBeInTheDocument()
  })
})
