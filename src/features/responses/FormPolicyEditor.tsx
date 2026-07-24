import { useState } from 'react'
import { Bell, CalendarClock, LockKeyhole, Mail, Settings2, Users } from 'lucide-react'
import type { FormSettings, FormLifecycleStatus, IdentityCollection, ParticipationPolicy } from '../../types'

export function FormPolicyEditor({
  value,
  onChange,
  onCollaborator,
}: {
  value: FormSettings
  onChange: (value: FormSettings) => void
  onCollaborator?: (email: string, role: 'viewer' | 'editor' | 'remove') => Promise<void>
}) {
  const [collaboratorEmail, setCollaboratorEmail] = useState('')
  const [collaboratorRole, setCollaboratorRole] = useState<'viewer' | 'editor'>('viewer')
  const [collaboratorMessage, setCollaboratorMessage] = useState('')
  const [collaboratorSaving, setCollaboratorSaving] = useState(false)
  const updateAccess = (change: Partial<FormSettings['access']>) => onChange({ ...value, access: { ...value.access, ...change } })
  const updateSubmission = (change: Partial<FormSettings['submission']>) => onChange({ ...value, submission: { ...value.submission, ...change } })
  const updateSchedule = (change: Partial<FormSettings['schedule']>) => onChange({ ...value, schedule: { ...value.schedule, ...change } })
  const updateNotifications = (change: Partial<FormSettings['notifications']>) => onChange({ ...value, notifications: { ...value.notifications, ...change } })
  const updateBranding = (change: Partial<FormSettings['branding']>) => onChange({ ...value, branding: { ...value.branding, ...change } })
  const updateIntegrations = (change: Partial<FormSettings['integrations']>) => onChange({ ...value, integrations: { ...value.integrations, ...change } })

  return <div className="policy-editor">
    <section>
      <h3><LockKeyhole/> 공개 주소</h3>
      <label>짧은 사용자 지정 주소
        <input value={value.publicSlug ?? ''} onChange={(event) => onChange({ ...value, publicSlug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) })} placeholder="예: summer-mentor-2026" pattern="[a-z0-9-]+"/>
      </label>
      <small>영문 소문자, 숫자와 하이픈만 사용할 수 있습니다.</small>
    </section>
    <section>
      <h3><Users/> 참여 대상</h3>
      <label>참여 정책
        <select value={value.access.participation} onChange={(event) => updateAccess({ participation: event.target.value as ParticipationPolicy })}>
          <option value="anyone">누구나 참여</option>
          <option value="authenticated">대플 로그인 사용자</option>
          <option value="kangnam">강남대학교 구성원</option>
          <option value="allowlist">특정 계정</option>
        </select>
      </label>
      {value.access.participation === 'allowlist' && <label>허용 이메일
        <textarea value={value.access.allowedEmails.join('\n')} onChange={(event) => updateAccess({ allowedEmails: event.target.value.split(/\s+/).filter(Boolean) })} placeholder="한 줄에 하나씩 입력"/>
      </label>}
      {value.access.participation === 'allowlist' && <label>허용 그룹 ID
        <textarea value={value.access.allowedGroups.join('\n')} onChange={(event) => updateAccess({ allowedGroups: event.target.value.split(/\s+/).filter(Boolean) })} placeholder="관리자가 계정 클레임에 부여한 그룹 ID"/>
      </label>}
      <label>응답자 정보
        <select value={value.access.identityCollection} onChange={(event) => updateAccess({ identityCollection: event.target.value as IdentityCollection })}>
          <option value="anonymous">익명</option>
          <option value="profile">이름·학번 직접 입력</option>
          <option value="email_input">이메일 직접 입력</option>
          <option value="verified_email">인증 이메일 자동 수집</option>
        </select>
      </label>
      <label className="switch-row"><input type="checkbox" checked={value.access.allowMultiple} onChange={(event) => updateAccess({ allowMultiple: event.target.checked })}/><span><b>중복 제출 허용</b><small>끄면 로그인 계정 또는 이 브라우저에서 한 번만 제출할 수 있습니다.</small></span></label>
    </section>

    <section>
      <h3><CalendarClock/> 공개 일정</h3>
      <label>폼 상태
        <select value={value.schedule.status} onChange={(event) => updateSchedule({ status: event.target.value as FormLifecycleStatus })}>
          <option value="open">접수 중</option><option value="scheduled">시작 전</option><option value="paused">일시중지</option><option value="closed">마감</option><option value="private">비공개</option>
        </select>
      </label>
      <div className="grid two"><label>시작 시각<input type="datetime-local" value={value.schedule.startsAt?.slice(0, 16) ?? ''} onChange={(event) => updateSchedule({ startsAt: event.target.value ? new Date(event.target.value).toISOString() : undefined })}/></label>
        <label>마감 시각<input type="datetime-local" value={value.schedule.closesAt?.slice(0, 16) ?? ''} onChange={(event) => updateSchedule({ closesAt: event.target.value ? new Date(event.target.value).toISOString() : undefined })}/></label></div>
      <label>최대 응답 수<input type="number" min="1" value={value.submission.maxResponses ?? ''} onChange={(event) => updateSubmission({ maxResponses: event.target.value ? Number(event.target.value) : undefined })}/></label>
    </section>

    <section>
      <h3><Settings2/> 제출 후 동작</h3>
      <label>제출 버튼 문구<input value={value.submission.submitLabel} onChange={(event) => updateSubmission({ submitLabel: event.target.value })}/></label>
      <label>완료 메시지<textarea value={value.submission.completionMessage} onChange={(event) => updateSubmission({ completionMessage: event.target.value })}/></label>
      <label className="switch-row"><input type="checkbox" checked={value.submission.allowDrafts} onChange={(event) => updateSubmission({ allowDrafts: event.target.checked })}/><span><b>작성 중 임시저장</b><small>계정 또는 현재 브라우저에서 복구합니다.</small></span></label>
      <label className="switch-row"><input type="checkbox" checked={value.submission.showOwnResponse} onChange={(event) => updateSubmission({ showOwnResponse: event.target.checked })}/><span><b>제출 후 자기 답변 확인</b></span></label>
      <label className="switch-row"><input type="checkbox" checked={value.submission.allowEditAfterSubmit} onChange={(event) => updateSubmission({ allowEditAfterSubmit: event.target.checked })}/><span><b>제출 후 답변 수정</b></span></label>
      <label className="switch-row"><input type="checkbox" checked={value.submission.showPublicResults} onChange={(event) => updateSubmission({ showPublicResults: event.target.checked })}/><span><b>익명 집계 결과 공개</b></span></label>
      <label className="switch-row"><input type="checkbox" checked={value.submission.emailReceipt} onChange={(event) => updateSubmission({ emailReceipt: event.target.checked })}/><span><b><Mail/> 응답 사본 이메일</b></span></label>
      <label className="switch-row"><input type="checkbox" checked={value.submission.randomizeQuestions} onChange={(event) => updateSubmission({ randomizeQuestions: event.target.checked })}/><span><b>질문 순서 무작위 배치</b><small>섹션 안에서 응답자마다 안정적으로 섞습니다.</small></span></label>
    </section>
    <section>
      <h3><Settings2/> 브랜딩과 링크 미리보기</h3>
      <label>폼 아이콘<select value={value.branding.icon ?? 'none'} onChange={(event) => updateBranding({ icon: event.target.value as FormSettings['branding']['icon'] })}><option value="none">아이콘 없음</option><option value="calendar">행사·일정</option><option value="clipboard">신청·설문</option><option value="graduation">교육</option><option value="heart">복지</option></select></label>
      <label>헤더 이미지 URL<input type="url" value={value.branding.headerImageUrl ?? ''} onChange={(event) => updateBranding({ headerImageUrl: event.target.value })} placeholder="https://..."/></label>
      <div className="grid two"><label>배경색<input type="color" value={value.branding.backgroundColor ?? '#f4f7f5'} onChange={(event) => updateBranding({ backgroundColor: event.target.value })}/></label><label>강조색<input type="color" value={value.branding.accentColor ?? '#086f63'} onChange={(event) => updateBranding({ accentColor: event.target.value })}/></label></div>
      <label>공유 제목<input value={value.branding.shareTitle ?? ''} onChange={(event) => updateBranding({ shareTitle: event.target.value })}/></label>
      <label>공유 설명<textarea value={value.branding.shareDescription ?? ''} onChange={(event) => updateBranding({ shareDescription: event.target.value })}/></label>
      <label>공유 대표 이미지 URL<input type="url" value={value.branding.shareImageUrl ?? ''} onChange={(event) => updateBranding({ shareImageUrl: event.target.value })}/></label>
      <small>기관 로고는 사용 허가를 확인한 공식 이미지 URL만 입력해 주세요.</small>
    </section>
    <section>
      <h3><Bell/> 제작자 알림</h3>
      <label className="switch-row"><input type="checkbox" checked={value.notifications.newResponseEmail} onChange={(event) => updateNotifications({ newResponseEmail: event.target.checked })}/><span><b>새 응답 이메일 알림</b></span></label>
      <label className="switch-row"><input type="checkbox" checked={value.notifications.startEmail} onChange={(event) => updateNotifications({ startEmail: event.target.checked })}/><span><b>접수 시작 알림</b></span></label>
      <label className="switch-row"><input type="checkbox" checked={value.notifications.closingSoonEmail} onChange={(event) => updateNotifications({ closingSoonEmail: event.target.checked })}/><span><b>마감 하루 전 알림</b></span></label>
      <label className="switch-row"><input type="checkbox" checked={value.notifications.closedEmail} onChange={(event) => updateNotifications({ closedEmail: event.target.checked })}/><span><b>마감 알림</b></span></label>
    </section>
    <section>
      <h3><Users/> 공동 편집자</h3>
      <div className="collaborator-row"><label>가입 이메일<input type="email" value={collaboratorEmail} onChange={(event) => setCollaboratorEmail(event.target.value)} placeholder="collaborator@example.com"/></label><label>권한<select value={collaboratorRole} onChange={(event) => setCollaboratorRole(event.target.value as 'viewer' | 'editor')}><option value="viewer">결과 보기</option><option value="editor">폼 편집</option></select></label></div>
      <div className="actions-inline"><button type="button" disabled={!onCollaborator || !collaboratorEmail || collaboratorSaving} onClick={() => {
        if (!onCollaborator) return
        setCollaboratorSaving(true); setCollaboratorMessage('')
        void onCollaborator(collaboratorEmail, collaboratorRole).then(() => {
          setCollaboratorMessage('공동 편집자 권한을 저장했습니다.'); setCollaboratorEmail('')
        }).catch(() => setCollaboratorMessage('가입된 이메일과 소유자 권한을 확인해 주세요.')).finally(() => setCollaboratorSaving(false))
      }}>초대·권한 저장</button><button type="button" disabled={!onCollaborator || !collaboratorEmail || collaboratorSaving} onClick={() => {
        if (!onCollaborator) return
        setCollaboratorSaving(true)
        void onCollaborator(collaboratorEmail, 'remove').then(() => setCollaboratorMessage('공동 편집자 권한을 제거했습니다.')).catch(() => setCollaboratorMessage('권한을 제거하지 못했습니다.')).finally(() => setCollaboratorSaving(false))
      }}>권한 제거</button></div>
      {!onCollaborator && <small>폼을 먼저 배포한 뒤 공동 편집자를 추가할 수 있습니다.</small>}
      {collaboratorMessage && <small role="status">{collaboratorMessage}</small>}
    </section>
    <section>
      <h3><Settings2/> 외부 연동</h3>
      <label>Google Sheets Apps Script 웹앱 URL<input type="url" value={value.integrations.sheetsWebhookUrl ?? ''} onChange={(event) => updateIntegrations({ sheetsWebhookUrl: event.target.value })} placeholder="https://script.google.com/macros/s/.../exec"/></label>
      <label>일반 웹훅 URL<input type="url" value={value.integrations.webhookUrl ?? ''} onChange={(event) => updateIntegrations({ webhookUrl: event.target.value })} placeholder="https://example.com/hooks/daepul"/></label>
      <small>새 응답을 HTTPS POST로 전달합니다. 전송 상태와 실패 사유는 서버의 integrationDeliveries 기록에 보관됩니다.</small>
    </section>
    <p className="policy-security-note"><LockKeyhole/> 참여 정책과 제출 제한은 화면뿐 아니라 Firestore 보안 규칙에서 다시 확인합니다.</p>
    <p className="policy-security-note"><Bell/> 이메일 발송은 운영 환경의 Firebase Trigger Email 설정이 필요합니다.</p>
  </div>
}
