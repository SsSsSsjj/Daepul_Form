import type { AttendanceRecord, FormQuestion, ProgramInfo, ResponseTopic, ResultStats } from './types'

export const sampleProgram: ProgramInfo = {
  programName: '2026 하계 진로 멘토링',
  description: '재학생의 희망직무 이해와 취업 준비 방향 설정',
  target: '재학생 2~4학년',
  period: '2026. 7. 20. ~ 7. 31.',
  schedule: '2026. 8. 8. 오후 2시',
  capacity: '30명',
  requirements: '대학 재학생, 프로그램 전 일정 참여 가능자',
  privacyConsent: '프로그램 신청 및 운영을 위한 개인정보 수집·이용 동의',
}

export const sampleQuestions: FormQuestion[] = [
  { id: 1, label: '이름을 입력해 주세요.', type: 'short_text', required: true },
  { id: 2, label: '학과를 입력해 주세요.', type: 'short_text', required: true },
  { id: 3, label: '학년을 선택해 주세요.', type: 'select', required: true },
  { id: 4, label: '희망직무를 입력해 주세요.', type: 'short_text', required: true },
  { id: 5, label: '현재 취업 준비 상황을 작성해 주세요.', type: 'long_text', required: false },
  { id: 6, label: '프로그램에 참여하려는 이유를 작성해 주세요.', type: 'long_text', required: true },
  { id: 7, label: '개인정보 수집 및 이용에 동의해 주세요.', type: 'consent', required: true },
]

export const sampleStats: ResultStats = {
  applicants: 28,
  participants: 24,
  satisfactionResponses: 21,
  satisfactionScores: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 3],
}

export const sampleAttendance: AttendanceRecord[] = [
  { name: '김민준', applied: true, attended: true, status: '참여' },
  { name: '이서연', applied: true, attended: true, status: '참여' },
  { name: '박지훈', applied: true, attended: false, status: '미참여' },
  { name: '최유진 / 최유진?', applied: true, attended: null, status: '확인 필요' },
]

export const sampleResponses = [
  '현직자의 실제 취업 준비 경험을 들을 수 있어서 좋았습니다.',
  '마케팅 포트폴리오 사례가 도움이 되었습니다.',
  '질문 시간이 조금 더 길었으면 좋겠습니다.',
  '직무별로 멘토를 더 다양하게 만나고 싶습니다.',
  '프로그램 시간이 짧아 아쉬웠습니다.',
  '멘토의 현실적인 조언이 도움이 되었습니다.',
  '후속 상담 프로그램도 있었으면 좋겠습니다.',
]

export const sampleTopics: ResponseTopic[] = [
  {
    id: 'experience',
    title: '현직자 경험과 조언',
    category: '긍정 의견',
    summary: '현직자의 실제 경험과 현실적인 조언이 도움이 되었다는 의견이 많았습니다.',
    sourceIds: [0, 1, 5],
    reportSentence: '참여자들은 현직자의 실제 취업 경험과 직무 관련 조언을 긍정적으로 평가했습니다.',
  },
  {
    id: 'time',
    title: '프로그램 시간',
    category: '개선 의견',
    summary: '질문과 프로그램 진행 시간이 부족하다는 의견이 있었습니다.',
    sourceIds: [2, 4],
    reportSentence: '참여자와 멘토가 충분히 소통할 수 있도록 프로그램 시간을 확대할 필요가 있습니다.',
  },
  {
    id: 'followup',
    title: '후속 프로그램 요청',
    category: '후속 요청',
    summary: '다양한 직무 멘토와 후속 상담에 대한 요청이 있었습니다.',
    sourceIds: [3, 6],
    reportSentence: '직무별 멘토 구성과 후속 상담 프로그램 확대를 검토할 필요가 있습니다.',
  },
]

