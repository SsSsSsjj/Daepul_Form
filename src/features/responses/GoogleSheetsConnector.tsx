import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, FilePlus2, LoaderCircle, RefreshCcw, Sheet, Unlink } from 'lucide-react'
import {
  createAndConnectGoogleSpreadsheet,
  disconnectGoogleSheets,
  getGoogleSheetsConnection,
  googleSheetsAppsScriptConfigured,
  type GoogleSheetsConnectionStatus,
} from '../../firebase'

const disconnected:GoogleSheetsConnectionStatus={status:'disconnected'}

function connectionError(error:unknown){
  const message=error instanceof Error?error.message:''
  const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):''
  if(code==='apps-script/not-configured'){
    return '운영자가 Google 스프레드시트 자동 저장 설정을 완료해야 합니다.'
  }
  if(code==='apps-script/unauthenticated'||code==='unauthenticated'){
    return '제작자 계정으로 다시 로그인한 뒤 연결해 주세요.'
  }
  if(code==='permission-denied'||message.includes('권한')){
    return '이 폼을 수정할 수 있는 제작자 계정인지 확인해 주세요.'
  }
  if(code==='apps-script/quota'){
    return 'Google 자동 저장 사용량을 초과했습니다. 잠시 후 다시 시도해 주세요.'
  }
  return message||'Google 스프레드시트 연결을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

export function GoogleSheetsConnector({formId}:{formId?:string}){
  const [connection,setConnection]=useState<GoogleSheetsConnectionStatus>(disconnected)
  const [loading,setLoading]=useState(false)
  const [message,setMessage]=useState('')
  const configured=googleSheetsAppsScriptConfigured()

  const loadConnection=useCallback(async()=>{
    if(!formId||!configured){setConnection(disconnected);return}
    setLoading(true);setMessage('')
    try{
      setConnection(await getGoogleSheetsConnection(formId))
    }catch(error){
      setMessage(connectionError(error))
    }finally{
      setLoading(false)
    }
  },[configured,formId])

  useEffect(()=>{void loadConnection()},[loadConnection])

  const connect=async()=>{
    if(!formId)return
    setLoading(true);setMessage('')
    try{
      setConnection(await createAndConnectGoogleSpreadsheet(formId))
      setMessage('응답용 스프레드시트를 만들고 제작자 계정에 공유했습니다.')
    }catch(error){
      setMessage(connectionError(error))
    }finally{
      setLoading(false)
    }
  }

  const disconnect=async()=>{
    if(!formId||!window.confirm('자동 저장 연결을 해제할까요? 이미 생성된 스프레드시트는 삭제되지 않습니다.'))return
    setLoading(true);setMessage('')
    try{
      setConnection(await disconnectGoogleSheets(formId))
      setMessage('자동 저장 연결을 해제했습니다. 기존 스프레드시트는 그대로 유지됩니다.')
    }catch(error){
      setMessage(connectionError(error))
    }finally{
      setLoading(false)
    }
  }

  if(!formId)return <div className="sheets-connector sheets-disabled"><Sheet/><span><b>Google 스프레드시트 자동 저장</b><small>폼을 먼저 배포하면 응답용 스프레드시트를 만들 수 있습니다.</small></span></div>

  return <div className="sheets-connector">
    <div className="sheets-connector-heading"><Sheet/><span><b>Google 스프레드시트 자동 저장</b><small>응답 저장용 스프레드시트를 자동으로 만들고 제작자 계정에 공유합니다.</small></span></div>
    {!configured&&<small className="sheets-message" role="status">운영자가 자동 저장 기능을 준비 중입니다.</small>}
    {configured&&connection.status==='disconnected'&&<button type="button" className="google-sheets-connect" disabled={loading} onClick={()=>void connect()}>{loading?<LoaderCircle className="spin"/>:<FilePlus2/>} 응답 시트 만들고 연결</button>}
    {connection.status==='connected'&&<div className="sheets-connected">
      <CheckCircle2/>
      <span><b>{connection.spreadsheetTitle||'Google 스프레드시트'}</b><small>새 응답은 약 1분 간격으로 자동 추가됩니다.</small></span>
      {connection.spreadsheetUrl&&<a href={connection.spreadsheetUrl} target="_blank" rel="noreferrer"><ExternalLink/> 시트 열기</a>}
      <button type="button" disabled={loading} onClick={()=>void disconnect()}><Unlink/> 연결 해제</button>
    </div>}
    {configured&&<button type="button" className="sheets-refresh" disabled={loading} onClick={()=>void loadConnection()}><RefreshCcw className={loading?'spin':undefined}/> 연결 상태 새로고침</button>}
    {message&&<small className="sheets-message" role="status">{message}</small>}
  </div>
}
