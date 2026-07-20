export type Step = 'start' | 'create' | 'edit' | 'publish' | 'results' | 'export'
export type DemoMode = 'normal' | 'empty' | 'failure'
export type AnalysisStatus = 'idle' | 'loading' | 'success' | 'error'
export type QuestionType = 'short_text' | 'long_text' | 'select' | 'checkbox' | 'consent'

export interface ProgramInfo {
  programName: string
  description: string
  target: string
  period: string
  schedule: string
  capacity: string
  requirements: string
  privacyConsent: string
}

export interface FormQuestion {
  id: number
  label: string
  type: QuestionType
  required: boolean
}

export interface ResultStats {
  applicants: number
  participants: number
  satisfactionResponses: number
  satisfactionScores: number[]
}

export interface AttendanceRecord {
  name: string
  applied: boolean
  attended: boolean | null
  status: '참여' | '미참여' | '확인 필요'
}

export interface ResponseTopic {
  id: string
  title: string
  category: '긍정 의견' | '개선 의견' | '후속 요청' | '기타 의견'
  summary: string
  sourceIds: number[]
  reportSentence: string
}

