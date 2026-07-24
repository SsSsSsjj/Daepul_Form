import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './delete-form.css'
import './login.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <footer className="career-center-footer">
      <span>강남대학교 대학일자리플러스센터 문의 : <strong>031-280-3431~5</strong></span>
      <span>E-mail : <a href="mailto:job@kangnam.ac.kr">job@kangnam.ac.kr</a></span>
      <a className="kakao-channel" href="https://pf.kakao.com/_IzWdxj" target="_blank" rel="noreferrer" aria-label="강남대 대플 카카오톡 채널 열기">@강남대 대플</a>
    </footer>
  </StrictMode>,
)
