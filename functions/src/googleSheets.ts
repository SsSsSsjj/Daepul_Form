export type GoogleTokenSet = {
  accessToken: string
  refreshToken?: string
  expiresIn: number
}

export type GoogleSpreadsheetItem = {
  id: string
  name: string
  modifiedTime: string
  webViewLink: string
}

export type GoogleSheetsConnection = {
  refreshToken: string
  accessToken?: string
  accessTokenExpiresAt?: number
  spreadsheetId?: string
  spreadsheetTitle?: string
  sheetName?: string
  status?: 'authorized' | 'connected'
  columns?: string[]
  columnLabels?: Record<string,string>
}

export type SheetsResponsePayload = {
  responseId: string
  formId: string
  formTitle: string
  submittedAt: string
  respondentEmail: string
  respondentName: string
  studentId: string
  answers: Record<string,unknown>
  answerLabels?: Record<string,string>
}

const authorizationEndpoint='https://accounts.google.com/o/oauth2/v2/auth'
const tokenEndpoint='https://oauth2.googleapis.com/token'
const sheetsApi='https://sheets.googleapis.com/v4'
const driveApi='https://www.googleapis.com/drive/v3'
export const googleSheetsScopes=[
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
]
export const responseSheetName='대플폼 응답'
export const fixedResponseHeaders=['응답 ID','제출 시각','폼 제목','이름','학번','이메일']

function text(value:unknown,maximum=500){
  return typeof value==='string'?value.trim().slice(0,maximum):''
}

async function googleRequest<T>(url:string,accessToken:string,init:RequestInit={}):Promise<T>{
  const response=await fetch(url,{
    ...init,
    headers:{
      authorization:`Bearer ${accessToken}`,
      ...(init.body?{'content-type':'application/json'}:{}),
      ...(init.headers??{}),
    },
  })
  if(!response.ok){
    const body=(await response.text()).slice(0,500)
    throw new Error(`google-api-${response.status}:${body}`)
  }
  return await response.json() as T
}

export function buildGoogleSheetsAuthorizationUrl({
  clientId,redirectUri,state,loginHint='',
}:{
  clientId:string
  redirectUri:string
  state:string
  loginHint?:string
}){
  const url=new URL(authorizationEndpoint)
  url.searchParams.set('client_id',clientId)
  url.searchParams.set('redirect_uri',redirectUri)
  url.searchParams.set('response_type','code')
  url.searchParams.set('scope',googleSheetsScopes.join(' '))
  url.searchParams.set('access_type','offline')
  url.searchParams.set('include_granted_scopes','true')
  url.searchParams.set('prompt','consent')
  url.searchParams.set('state',state)
  if(loginHint)url.searchParams.set('login_hint',loginHint)
  return url.toString()
}

export async function exchangeGoogleSheetsCode({
  clientId,clientSecret,redirectUri,code,
}:{
  clientId:string
  clientSecret:string
  redirectUri:string
  code:string
}):Promise<GoogleTokenSet>{
  const response=await fetch(tokenEndpoint,{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:clientId,
      client_secret:clientSecret,
      redirect_uri:redirectUri,
      grant_type:'authorization_code',
      code,
    }),
  })
  const body=await response.json() as Record<string,unknown>
  if(!response.ok)throw new Error(`google-token-${response.status}:${text(body.error_description)}`)
  const accessToken=text(body.access_token,2000)
  if(!accessToken)throw new Error('google-token-missing')
  return {
    accessToken,
    refreshToken:text(body.refresh_token,2000)||undefined,
    expiresIn:Math.max(60,Number(body.expires_in??3600)),
  }
}

export async function refreshGoogleAccessToken({
  clientId,clientSecret,refreshToken,
}:{
  clientId:string
  clientSecret:string
  refreshToken:string
}):Promise<GoogleTokenSet>{
  const response=await fetch(tokenEndpoint,{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:clientId,
      client_secret:clientSecret,
      refresh_token:refreshToken,
      grant_type:'refresh_token',
    }),
  })
  const body=await response.json() as Record<string,unknown>
  if(!response.ok)throw new Error(`google-refresh-${response.status}:${text(body.error_description)}`)
  const accessToken=text(body.access_token,2000)
  if(!accessToken)throw new Error('google-refresh-missing')
  return {accessToken,expiresIn:Math.max(60,Number(body.expires_in??3600))}
}

export async function listGoogleSpreadsheets(accessToken:string):Promise<GoogleSpreadsheetItem[]>{
  const url=new URL(`${driveApi}/files`)
  url.searchParams.set('q',"mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")
  url.searchParams.set('fields','files(id,name,modifiedTime,webViewLink)')
  url.searchParams.set('orderBy','modifiedTime desc')
  url.searchParams.set('pageSize','50')
  const result=await googleRequest<{files?:Array<Record<string,unknown>>}>(url.toString(),accessToken)
  return (result.files??[]).map(item=>({
    id:text(item.id,200),
    name:text(item.name)||'제목 없는 스프레드시트',
    modifiedTime:text(item.modifiedTime,80),
    webViewLink:text(item.webViewLink,1000),
  })).filter(item=>item.id)
}

export async function createGoogleSpreadsheet(accessToken:string,title:string){
  const result=await googleRequest<{
    spreadsheetId?:string
    properties?:{title?:string}
  }>(`${sheetsApi}/spreadsheets`,accessToken,{
    method:'POST',
    body:JSON.stringify({properties:{title},sheets:[{properties:{title:responseSheetName}}]}),
  })
  const spreadsheetId=text(result.spreadsheetId,200)
  if(!spreadsheetId)throw new Error('google-spreadsheet-create-failed')
  return {id:spreadsheetId,name:text(result.properties?.title)||title}
}

export async function prepareGoogleSpreadsheet({
  accessToken,spreadsheetId,columns,columnLabels,
}:{
  accessToken:string
  spreadsheetId:string
  columns:string[]
  columnLabels:Record<string,string>
}){
  const metadata=await googleRequest<{
    properties?:{title?:string}
    sheets?:Array<{properties?:{title?:string}}>
  }>(`${sheetsApi}/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`,accessToken)
  const sheetExists=(metadata.sheets??[]).some(sheet=>sheet.properties?.title===responseSheetName)
  if(!sheetExists){
    await googleRequest(`${sheetsApi}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,accessToken,{
      method:'POST',
      body:JSON.stringify({requests:[{addSheet:{properties:{title:responseSheetName}}}]}),
    })
  }
  await updateGoogleSheetHeaders({accessToken,spreadsheetId,columns,columnLabels})
  return {
    title:text(metadata.properties?.title)||'Google 스프레드시트',
    sheetName:responseSheetName,
  }
}

export async function updateGoogleSheetHeaders({
  accessToken,spreadsheetId,columns,columnLabels,
}:{
  accessToken:string
  spreadsheetId:string
  columns:string[]
  columnLabels:Record<string,string>
}){
  const headers=[
    ...fixedResponseHeaders,
    ...columns.map(id=>columnLabels[id]?`${columnLabels[id]} [${id}]`:`질문 ${id}`),
  ]
  const range=encodeURIComponent(`'${responseSheetName}'!A1`)
  await googleRequest(`${sheetsApi}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=RAW`,accessToken,{
    method:'PUT',
    body:JSON.stringify({range:`'${responseSheetName}'!A1`,majorDimension:'ROWS',values:[headers]}),
  })
}

export function serializeSheetCell(value:unknown){
  if(Array.isArray(value))return value.map(item=>text(item)).filter(Boolean).join(', ')
  if(typeof value==='boolean')return value?'예':'아니오'
  if(typeof value==='number'&&Number.isFinite(value))return value
  if(value&&typeof value==='object')return JSON.stringify(value).slice(0,5000)
  return text(value,5000)
}

export function buildResponseSheetRow(payload:SheetsResponsePayload,columns:string[]){
  return [
    payload.responseId,
    payload.submittedAt,
    payload.formTitle,
    payload.respondentName,
    payload.studentId,
    payload.respondentEmail,
    ...columns.map(id=>serializeSheetCell(payload.answers[id])),
  ]
}

export async function appendGoogleSheetResponse({
  accessToken,spreadsheetId,payload,columns,
}:{
  accessToken:string
  spreadsheetId:string
  payload:SheetsResponsePayload
  columns:string[]
}){
  const range=encodeURIComponent(`'${responseSheetName}'!A:ZZ`)
  await googleRequest(`${sheetsApi}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,accessToken,{
    method:'POST',
    body:JSON.stringify({
      range:`'${responseSheetName}'!A:ZZ`,
      majorDimension:'ROWS',
      values:[buildResponseSheetRow(payload,columns)],
    }),
  })
}
