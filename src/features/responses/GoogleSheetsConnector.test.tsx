// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleSheetsConnector } from './GoogleSheetsConnector'

const firebaseMocks=vi.hoisted(()=>({
  configured:vi.fn(),
  connect:vi.fn(),
  disconnect:vi.fn(),
  getConnection:vi.fn(),
}))

vi.mock('../../firebase',()=>({
  createAndConnectGoogleSpreadsheet:firebaseMocks.connect,
  disconnectGoogleSheets:firebaseMocks.disconnect,
  getGoogleSheetsConnection:firebaseMocks.getConnection,
  googleSheetsAppsScriptConfigured:firebaseMocks.configured,
}))

afterEach(cleanup)

describe('GoogleSheetsConnector',()=>{
  beforeEach(()=>{
    Object.values(firebaseMocks).forEach(mock=>mock.mockReset())
    firebaseMocks.configured.mockReturnValue(true)
    firebaseMocks.getConnection.mockResolvedValue({status:'disconnected'})
  })

  it('asks the creator to publish before connecting',()=>{
    render(<GoogleSheetsConnector/>)
    expect(screen.getByText('폼을 먼저 배포하면 응답용 스프레드시트를 만들 수 있습니다.')).toBeInTheDocument()
  })

  it('creates and connects a response spreadsheet with one button',async()=>{
    firebaseMocks.connect.mockResolvedValue({
      status:'connected',
      spreadsheetTitle:'진로 설문 응답',
      spreadsheetUrl:'https://docs.google.com/spreadsheets/d/sheet-id/edit',
    })
    render(<GoogleSheetsConnector formId="form-1"/>)
    fireEvent.click(await screen.findByRole('button',{name:/응답 시트 만들고 연결/}))
    expect(firebaseMocks.connect).toHaveBeenCalledWith('form-1')
    expect(await screen.findByText('진로 설문 응답')).toBeInTheDocument()
    expect(screen.getByText(/약 1분 간격/)).toBeInTheDocument()
  })

  it('shows a setup message before the operator configures Apps Script',()=>{
    firebaseMocks.configured.mockReturnValue(false)
    render(<GoogleSheetsConnector formId="form-1"/>)
    expect(screen.getByText('운영자가 자동 저장 기능을 준비 중입니다.')).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:/응답 시트 만들고 연결/})).not.toBeInTheDocument()
  })
})
