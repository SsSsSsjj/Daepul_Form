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
    expect(screen.getByText(/버튼 한 번으로 응답용 스프레드시트/)).toBeInTheDocument()
    expect(screen.getByText('Google 스프레드시트 자동 저장')).toBeInTheDocument()
  })

  it('stores a form-specific Apps Script fallback URL',()=>{
    const onChange=vi.fn()
    render(<FormPolicyEditor value={defaultFormSettings} onChange={onChange}/>)
    fireEvent.change(screen.getByLabelText('Apps Script 웹앱 URL'),{
      target:{value:'https://script.google.com/macros/s/deployment-id/exec'},
    })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      integrations:expect.objectContaining({
        sheetsWebhookUrl:'https://script.google.com/macros/s/deployment-id/exec',
      }),
    }))
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

  it('explains how each participation policy is enforced', () => {
    const onChange = vi.fn()
    render(<FormPolicyEditor value={defaultFormSettings} onChange={onChange}/>)

    expect(screen.getByRole('option', { name: '로그인 없이 누구나' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '대플폼 로그인 계정만' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '강남대 인증 이메일 계정만' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '지정한 이메일 계정만' })).toBeInTheDocument()
    expect(screen.getByText(/Google 또는 이메일로 대플폼에 로그인한 계정인지 확인/)).toBeInTheDocument()
    expect(screen.queryByLabelText('허용 그룹 ID')).not.toBeInTheDocument()
  })

  it('switches verified-email collection to anonymous for login-free participation', () => {
    const onChange = vi.fn()
    render(<FormPolicyEditor value={defaultFormSettings} onChange={onChange}/>)

    fireEvent.change(screen.getByLabelText('참여 정책'), { target: { value: 'anyone' } })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      access: expect.objectContaining({
        participation: 'anyone',
        identityCollection: 'anonymous',
      }),
    }))
  })
})
