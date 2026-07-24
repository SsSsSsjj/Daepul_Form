// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleSheetsConnector } from './GoogleSheetsConnector'

const firebaseMocks=vi.hoisted(()=>({
  beginGoogleSheetsConnection:vi.fn(),
  getGoogleSheetsConnection:vi.fn(),
  listAvailableGoogleSpreadsheets:vi.fn(),
}))

vi.mock('../../firebase',()=>({
  beginGoogleSheetsConnection:firebaseMocks.beginGoogleSheetsConnection,
  createAndConnectGoogleSpreadsheet:vi.fn(),
  disconnectGoogleSheets:vi.fn(),
  getGoogleSheetsConnection:firebaseMocks.getGoogleSheetsConnection,
  listAvailableGoogleSpreadsheets:firebaseMocks.listAvailableGoogleSpreadsheets,
  selectGoogleSpreadsheet:vi.fn(),
}))

afterEach(cleanup)

describe('GoogleSheetsConnector',()=>{
  beforeEach(()=>{
    firebaseMocks.beginGoogleSheetsConnection.mockReset()
    firebaseMocks.getGoogleSheetsConnection.mockReset()
    firebaseMocks.listAvailableGoogleSpreadsheets.mockReset()
  })

  it('asks the creator to publish before connecting',()=>{
    render(<GoogleSheetsConnector/>)
    expect(screen.getByText('폼을 먼저 배포하면 연결할 수 있습니다.')).toBeInTheDocument()
  })

  it('shows the connected spreadsheet without Apps Script fields',async()=>{
    firebaseMocks.getGoogleSheetsConnection.mockResolvedValue({
      status:'connected',
      spreadsheetTitle:'진로 설문 응답',
      spreadsheetUrl:'https://docs.google.com/spreadsheets/d/sheet-id/edit',
    })
    render(<GoogleSheetsConnector formId="form-1"/>)
    expect(await screen.findByText('진로 설문 응답')).toBeInTheDocument()
    expect(screen.getByText(/대플폼 응답/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Apps Script 웹앱 URL')).not.toBeInTheDocument()
  })

  it('explains when the Google Sheets connection server is not deployed',async()=>{
    firebaseMocks.getGoogleSheetsConnection.mockRejectedValue(
      Object.assign(new Error('NOT FOUND'),{code:'functions/not-found'}),
    )
    render(<GoogleSheetsConnector formId="form-1"/>)
    expect(await screen.findByText(
      'Google 스프레드시트 연결 서버가 아직 배포되지 않았습니다. 운영자에게 문의해 주세요.',
    )).toBeInTheDocument()
  })
})
