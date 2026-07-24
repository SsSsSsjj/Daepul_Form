export type Step = 'start' | 'create' | 'edit' | 'publish' | 'results' | 'export'
export type DemoMode = 'normal' | 'empty' | 'failure'
export type AnalysisStatus = 'idle' | 'loading' | 'success' | 'error'
export type QuestionType = 'short_text' | 'long_text' | 'select' | 'checkbox' | 'consent' | 'rating' | 'number' | 'file'
export type FormType = 'application' | 'satisfaction' | 'demand_survey' | 'general'
export type FormLifecycleStatus = 'draft' | 'scheduled' | 'open' | 'paused' | 'closed' | 'private'
export type ParticipationPolicy = 'anyone' | 'authenticated' | 'kangnam' | 'allowlist'
export type IdentityCollection = 'anonymous' | 'profile' | 'email_input' | 'verified_email'
export type ResponseStatus = 'draft' | 'submitted' | 'reviewed' | 'archived'
export type CollaboratorRole = 'viewer' | 'editor'
export type NotificationStatus = 'idle' | 'queued' | 'sent' | 'failed'

export interface FormAccessSettings {
  participation: ParticipationPolicy
  identityCollection: IdentityCollection
  allowMultiple: boolean
  allowedEmails: string[]
  allowedGroups: string[]
}

export interface FormSubmissionSettings {
  allowDrafts: boolean
  allowEditAfterSubmit: boolean
  emailReceipt: boolean
  showOwnResponse: boolean
  showPublicResults: boolean
  submitLabel: string
  completionMessage: string
  maxResponses?: number
}

export interface FormScheduleSettings {
  status: FormLifecycleStatus
  startsAt?: string
  closesAt?: string
}

export interface FormBrandingSettings {
  theme: string
  icon?: 'calendar' | 'clipboard' | 'graduation' | 'heart' | 'none'
  headerImageUrl?: string
  backgroundColor?: string
  accentColor?: string
  shareTitle?: string
  shareDescription?: string
  shareImageUrl?: string
}

export interface FormSettings {
  access: FormAccessSettings
  submission: FormSubmissionSettings
  schedule: FormScheduleSettings
  branding: FormBrandingSettings
  notifications: {
    newResponseEmail: boolean
    startEmail: boolean
    closingSoonEmail: boolean
    closedEmail: boolean
  }
  publicSlug?: string
  version: number
}

export const defaultFormSettings: FormSettings = {
  access: {
    participation: 'authenticated',
    identityCollection: 'verified_email',
    allowMultiple: false,
    allowedEmails: [],
    allowedGroups: [],
  },
  submission: {
    allowDrafts: true,
    allowEditAfterSubmit: false,
    emailReceipt: false,
    showOwnResponse: true,
    showPublicResults: false,
    submitLabel: '응답 제출하기',
    completionMessage: '응답이 정상적으로 제출되었습니다.',
  },
  schedule: { status: 'open' },
  branding: { theme: 'green', icon: 'clipboard' },
  notifications: {
    newResponseEmail: false,
    startEmail: false,
    closingSoonEmail: false,
    closedEmail: false,
  },
  version: 1,
}

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
  sectionId?: string
  description?: string
  min?: number
  max?: number
  pattern?: string
  branch?: Record<string, string | 'submit'>
  randomizeOptions?: boolean
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
  responseId?: string
  formId?: string
  submittedAt?: string
  updatedAt?: string
  respondentUid?: string
  anonymousId?: string
  respondentEmail?: string
  respondentName?: string
  studentId?: string
  status?: ResponseStatus
  formVersion?: number
  attachments?: ResponseAttachment[]
}

export interface ResponseAttachment {
  id: string
  questionId: number
  name: string
  contentType: string
  size: number
  path: string
  downloadUrl?: string
}

export interface ResponseDraft {
  formId: string
  actorId: string
  formVersion: number
  answers: Record<string, string | boolean | number>
  updatedAt: string
}

export interface ResponseFilters {
  query: string
  status: ResponseStatus | 'all'
  questionId?: number
  answer?: string
  ratingMin?: number
  ratingMax?: number
  missingQuestionId?: number
  selectedIds: string[]
}

export interface ResponseQuery {
  filters: ResponseFilters
  sortBy: 'submittedAt' | 'name' | 'studentId' | 'answer'
  sortDirection: 'asc' | 'desc'
  page: number
  pageSize: 25 | 50 | 100 | 200
}

export interface ResponsePage {
  items: StoredFormResponse[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
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
