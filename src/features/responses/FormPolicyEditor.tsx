import { Bell, CalendarClock, LockKeyhole, Mail, Settings2, Users } from 'lucide-react'
import type { FormSettings, FormLifecycleStatus, IdentityCollection, ParticipationPolicy } from '../../types'

export function FormPolicyEditor({ value, onChange }: { value: FormSettings; onChange: (value: FormSettings) => void }) {
  const updateAccess = (change: Partial<FormSettings['access']>) => onChange({ ...value, access: { ...value.access, ...change } })
  const updateSubmission = (change: Partial<FormSettings['submission']>) => onChange({ ...value, submission: { ...value.submission, ...change } })
  const updateSchedule = (change: Partial<FormSettings['schedule']>) => onChange({ ...value, schedule: { ...value.schedule, ...change } })
  const updateNotifications = (change: Partial<FormSettings['notifications']>) => onChange({ ...value, notifications: { ...value.notifications, ...change } })

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
    </section>
    <section>
      <h3><Bell/> 제작자 알림</h3>
      <label className="switch-row"><input type="checkbox" checked={value.notifications.newResponseEmail} onChange={(event) => updateNotifications({ newResponseEmail: event.target.checked })}/><span><b>새 응답 이메일 알림</b></span></label>
      <label className="switch-row"><input type="checkbox" checked={value.notifications.startEmail} onChange={(event) => updateNotifications({ startEmail: event.target.checked })}/><span><b>접수 시작 알림</b></span></label>
      <label className="switch-row"><input type="checkbox" checked={value.notifications.closingSoonEmail} onChange={(event) => updateNotifications({ closingSoonEmail: event.target.checked })}/><span><b>마감 하루 전 알림</b></span></label>
      <label className="switch-row"><input type="checkbox" checked={value.notifications.closedEmail} onChange={(event) => updateNotifications({ closedEmail: event.target.checked })}/><span><b>마감 알림</b></span></label>
    </section>
    <p className="policy-security-note"><LockKeyhole/> 참여 정책과 제출 제한은 화면뿐 아니라 Firestore 보안 규칙에서 다시 확인합니다.</p>
    <p className="policy-security-note"><Bell/> 이메일 발송은 운영 환경의 Firebase Trigger Email 설정이 필요합니다.</p>
  </div>
}
