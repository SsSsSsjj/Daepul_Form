import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, FilePlus2, Link2, LoaderCircle, RefreshCcw, Sheet, Unlink } from 'lucide-react'
import {
  beginGoogleSheetsConnection,
  createAndConnectGoogleSpreadsheet,
  disconnectGoogleSheets,
  getGoogleSheetsConnection,
  listAvailableGoogleSpreadsheets,
  selectGoogleSpreadsheet,
  type GoogleSheetsConnectionStatus,
  type GoogleSpreadsheetChoice,
} from '../../firebase'

const disconnected:GoogleSheetsConnectionStatus={status:'disconnected'}

function connectionError(error:unknown){
  const message=error instanceof Error?error.message:''
  if(message.includes('OAuth 설정'))return '운영자가 Google 연결 설정을 완료해야 합니다.'
  if(message.includes('permission-denied'))return '스프레드시트 접근 권한을 확인해 주세요.'
  return 'Google 스프레드시트 연결을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

export function GoogleSheetsConnector({formId}:{formId?:string}){
  const [connection,setConnection]=useState<GoogleSheetsConnectionStatus>(disconnected)
  const [items,setItems]=useState<GoogleSpreadsheetChoice[]>([])
  const [selectedId,setSelectedId]=useState('')
  const [loading,setLoading]=useState(false)
  const [message,setMessage]=useState('')

  const loadConnection=useCallback(async()=>{
    if(!formId){setConnection(disconnected);return}
    setLoading(true);setMessage('')
    try{
      const next=await getGoogleSheetsConnection(formId)
      setConnection(next)
      if(next.status==='authorized'){
        const choices=await listAvailableGoogleSpreadsheets(formId)
        setItems(choices)
        setSelectedId(choices[0]?.id??'')
      }
    }catch(error){
      setMessage(connectionError(error))
    }finally{
      setLoading(false)
    }
  },[formId])

  useEffect(()=>{void loadConnection()},[loadConnection])
  useEffect(()=>{
    const receiveConnection=(event:MessageEvent)=>{
      const data=event.data as {type?:string;formId?:string}|undefined
      if(data?.type==='daepulform-google-sheets-connected'&&data.formId===formId)void loadConnection()
    }
    window.addEventListener('message',receiveConnection)
    return()=>window.removeEventListener('message',receiveConnection)
  },[formId,loadConnection])

  const authorize=async()=>{
    if(!formId)return
    const popup=window.open('about:blank','daepulform-google-sheets','popup,width=560,height=720')
    if(!popup){setMessage('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.');return}
    setLoading(true);setMessage('')
    try{
      popup.location.href=await beginGoogleSheetsConnection(formId)
    }catch(error){
      popup.close()
      setMessage(connectionError(error))
      setLoading(false)
    }
  }

  const choose=async()=>{
    if(!formId||!selectedId)return
    setLoading(true);setMessage('')
    try{
      setConnection(await selectGoogleSpreadsheet(formId,selectedId))
      setMessage('선택한 스프레드시트에 새 응답을 자동 저장합니다.')
    }catch(error){
      setMessage(connectionError(error))
    }finally{
      setLoading(false)
    }
  }

  const create=async()=>{
    if(!formId)return
    setLoading(true);setMessage('')
    try{
      setConnection(await createAndConnectGoogleSpreadsheet(formId))
      setMessage('새 응답용 스프레드시트를 만들고 연결했습니다.')
    }catch(error){
      setMessage(connectionError(error))
    }finally{
      setLoading(false)
    }
  }

  const disconnect=async()=>{
    if(!formId||!window.confirm('Google 스프레드시트 자동 저장 연결을 해제할까요?'))return
    setLoading(true);setMessage('')
    try{
      await disconnectGoogleSheets(formId)
      setConnection(disconnected);setItems([]);setSelectedId('')
      setMessage('Google 스프레드시트 연결을 해제했습니다.')
    }catch(error){
      setMessage(connectionError(error))
    }finally{
      setLoading(false)
    }
  }

  if(!formId)return <div className="sheets-connector sheets-disabled"><Sheet/><span><b>Google 스프레드시트 자동 저장</b><small>폼을 먼저 배포하면 연결할 수 있습니다.</small></span></div>

  return <div className="sheets-connector">
    <div className="sheets-connector-heading"><Sheet/><span><b>Google 스프레드시트 자동 저장</b><small>Apps Script 없이 구글 계정 권한만 승인하면 됩니다.</small></span></div>
    {connection.status==='disconnected'&&<button type="button" className="google-sheets-connect" disabled={loading} onClick={()=>void authorize()}>{loading?<LoaderCircle className="spin"/>:<Link2/>} Google 스프레드시트 연결</button>}
    {connection.status==='authorized'&&<div className="sheets-picker">
      <label>저장할 스프레드시트
        <select value={selectedId} disabled={loading||items.length===0} onChange={(event)=>setSelectedId(event.target.value)}>
          {items.length===0?<option value="">선택 가능한 스프레드시트가 없습니다</option>:items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className="actions-inline"><button type="button" className="primary" disabled={loading||!selectedId} onClick={()=>void choose()}><CheckCircle2/> 선택한 시트 연결</button><button type="button" disabled={loading} onClick={()=>void create()}><FilePlus2/> 새 시트 만들기</button><button type="button" disabled={loading} onClick={()=>void loadConnection()}><RefreshCcw/> 새로고침</button></div>
    </div>}
    {connection.status==='connected'&&<div className="sheets-connected">
      <CheckCircle2/>
      <span><b>{connection.spreadsheetTitle||'Google 스프레드시트'}</b><small>새 응답이 들어오면 `대플폼 응답` 탭에 자동 추가됩니다.</small></span>
      {connection.spreadsheetUrl&&<a href={connection.spreadsheetUrl} target="_blank" rel="noreferrer"><ExternalLink/> 열기</a>}
      <button type="button" disabled={loading} onClick={()=>void disconnect()}><Unlink/> 연결 해제</button>
    </div>}
    {loading&&connection.status!=='disconnected'&&<span className="sheets-loading"><LoaderCircle className="spin"/> Google에서 정보를 불러오는 중입니다.</span>}
    {message&&<small className="sheets-message" role="status">{message}</small>}
  </div>
}
