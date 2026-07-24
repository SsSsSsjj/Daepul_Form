// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultFormSettings } from '../../types'
import { toLocalDateTimeInputValue } from './dateTime'
import { FormPolicyEditor } from './FormPolicyEditor'

afterEach(cleanup)

describe('FormPolicyEditor branding guidance', () => {
  it('round-trips the selected local date and time without a timezone shift', () => {
    const selectedLocalTime = '2026-07-24T01:00'
    const storedUtcTime = new Date(selectedLocalTime).toISOString()

    expect(toLocalDateTimeInputValue(storedUtcTime)).toBe(selectedLocalTime)
  })

  it('shows understandable receipt and integration explanations', () => {
    render(<FormPolicyEditor value={defaultFormSettings} onChange={() => undefined}/>)

    expect(screen.getByText('제출자에게 답변 사본 보내기')).toBeInTheDocument()
    expect(screen.getByText(/자신이 제출한 답변 내용을 보내는 기능/)).toBeInTheDocument()
    expect(screen.getByText(/다른 서비스로 응답 데이터를 자동 전송/)).toBeInTheDocument()
  })

  it('renders and updates the visible link preview', () => {
    let current = structuredClone(defaultFormSettings)
    const view = render(
      <FormPolicyEditor
        value={current}
        previewTitle="강남대 취업 프로그램"
        previewDescription="참여자를 모집합니다."
        onChange={(next) => {
          current = next
          view.rerender(
            <FormPolicyEditor
              value={current}
              previewTitle="강남대 취업 프로그램"
              previewDescription="참여자를 모집합니다."
              onChange={() => undefined}
            />,
          )
        }}
      />,
    )

    expect(screen.getByLabelText('링크 공유 미리보기')).toHaveTextContent('강남대 취업 프로그램')
    fireEvent.change(screen.getByLabelText('공유 제목'), { target: { value: '새 공유 제목' } })
    expect(screen.getByLabelText('링크 공유 미리보기')).toHaveTextContent('새 공유 제목')
  })

  it('sends selected background and accent colors to the live form settings', () => {
    const onChange = vi.fn()
    render(<FormPolicyEditor value={defaultFormSettings} onChange={onChange}/>)

    fireEvent.change(screen.getByLabelText('배경색 선택'), { target: { value: '#fff2cc' } })
    fireEvent.change(screen.getByLabelText('강조색 선택'), { target: { value: '#a61b1b' } })

    expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({
      branding: expect.objectContaining({ backgroundColor: '#fff2cc' }),
    }))
    expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({
      branding: expect.objectContaining({ accentColor: '#a61b1b' }),
    }))
  })
})
