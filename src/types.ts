export type Step = 'start' | 'create' | 'edit' | 'publish' | 'results' | 'export'
export type DemoMode = 'normal' | 'empty' | 'failure'
export type AnalysisStatus = 'idle' | 'loading' | 'success' | 'error'
export type QuestionType = 'short_text' | 'long_text' | 'select' | 'checkbox' | 'consent' | 'rating' | 'number'
export type FormType = 'application' | 'satisfaction' | 'demand_survey' | 'general'

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
  options?: string[]
}

export interface GeneratedForm {
  formType: FormType
  program: ProgramInfo
  questions: FormQuestion[]
  reviewNotes: string[]
}

export interface StoredFormResponse {
  id: string
  answers: Record<string, string | boolean | number>
}

export interface QuestionSummary {
  questionId: number
  label: string
  type: QuestionType
  responseCount: number
  average?: number
  distribution?: Array<{ label: string; count: number }>
  texts?: string[]
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
