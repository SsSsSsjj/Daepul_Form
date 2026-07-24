import { describe, expect, it } from 'vitest'
import {
  buildGoogleSheetsAuthorizationUrl,
  buildResponseSheetRow,
  serializeSheetCell,
} from './googleSheets'

describe('Google Sheets integration helpers',()=>{
  it('builds an offline OAuth authorization request',()=>{
    const url=new URL(buildGoogleSheetsAuthorizationUrl({
      clientId:'client-id',
      redirectUri:'https://example.com/callback',
      state:'state-token',
      loginHint:'owner@example.com',
    }))
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('state')).toBe('state-token')
    expect(url.searchParams.get('scope')).toContain('spreadsheets')
  })

  it('serializes response values for a spreadsheet row',()=>{
    expect(serializeSheetCell(['첫 번째','두 번째'])).toBe('첫 번째, 두 번째')
    expect(serializeSheetCell(true)).toBe('예')
    expect(buildResponseSheetRow({
      responseId:'response-1',
      formId:'form-1',
      formTitle:'진로 설문',
      submittedAt:'2026-07-24T12:00:00.000Z',
      respondentEmail:'student@example.com',
      respondentName:'홍길동',
      studentId:'20260001',
      answers:{'101':'취업','102':['서울','경기']},
    },['101','102'])).toEqual([
      'response-1',
      '2026-07-24T12:00:00.000Z',
      '진로 설문',
      '홍길동',
      '20260001',
      'student@example.com',
      '취업',
      '서울, 경기',
    ])
  })
})
