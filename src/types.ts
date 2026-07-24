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
  randomizeQuestions: boolean
  submitLabel: string
  completionMessage: string
  maxResponses?: number
}

export interface FormQuizSettings {
  enabled: boolean
  releaseScore: 'immediately' | 'later'
  showCorrectAnswers: boolean
}

export interface FormWorkspaceSettings {
  enabled: boolean
  name: string
  emailDomain: string
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
  fontPreset?: 'system' | 'serif' | 'rounded' | 'custom'
  customFontFamily?: string
  customFontUrl?: string
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
  integrations: {
    sheetsWebhookUrl?: string
    webhookUrl?: string
  }
  quiz: FormQuizSettings
  workspace: FormWorkspaceSettings
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
    randomizeQuestions: false,
    submitLabel: '응답 제출하기',
    completionMessage: '응답이 정상적으로 제출되었습니다.',
  },
  schedule: { status: 'open' },
  branding: { theme: 'green', icon: 'clipboard' },
  quiz: {
    enabled: false,
    releaseScore: 'immediately',
    showCorrectAnswers: true,
  },
  workspace: {
    enabled: false,
    name: '',
    emailDomain: 'kangnam.ac.kr',
  },
  notifications: {
    newResponseEmail: false,
    startEmail: false,
    closingSoonEmail: false,
    closedEmail: false,
  },
  integrations: {},
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
  imageUrl?: string
  optionImageUrls?: string[]
  maxSelections?: number
  sectionId?: string
  sectionTitle?: string
  sectionNext?: string | 'submit'
  description?: string
  min?: number
  max?: number
  pattern?: string
  inputFormat?: 'none' | 'email' | 'phone'
  branch?: Record<string, string | 'submit'>
  randomizeOptions?: boolean
  points?: number
  correctAnswers?: Array<string | number | boolean>
  correctFeedback?: string
  incorrectFeedback?: string
}

export interface GeneratedForm {
  formType: FormType
  program: ProgramInfo
  questions: FormQuestion[]
  reviewNotes: string[]
  suggestedTheme: 'green' | 'spring' | 'summer' | 'autumn' | 'winter' | 'kangnam'
  suggestedEndDate: string
  suggestedSettings: {
    publicSlug: string
    participation: ParticipationPolicy
    identityCollection: IdentityCollection
    allowMultiple: boolean
    status: FormLifecycleStatus
    startsAt: string
    closesAt: string
    maxResponses: number
    allowDrafts: boolean
    allowEditAfterSubmit: boolean
    emailReceipt: boolean
    showOwnResponse: boolean
    showPublicResults: boolean
    randomizeQuestions: boolean
    submitLabel: string
    completionMessage: string
    icon: NonNullable<FormBrandingSettings['icon']>
    shareTitle: string
    shareDescription: string
    newResponseEmail: boolean
  }
}

export interface StoredFormResponse {
  id: string
  answers: Record<string, AnswerValue>
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
  quizResult?: QuizResult
}

export interface QuizQuestionResult {
  questionId: number
  earnedPoints: number
  possiblePoints: number
  correct: boolean
  correctAnswers?: Array<string | number | boolean>
  feedback?: string
}

export interface QuizResult {
  score: number
  maxScore: number
  percentage: number
  released: boolean
  questions?: QuizQuestionResult[]
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
  answers: Record<string, AnswerValue>
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
  overallTotal?: number
  page: number
  pageSize: number
  hasMore: boolean
  summaries?: QuestionSummary[]
  dailyCounts?: Array<{ date: string; count: number }>
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

export interface KeywordInsight {
  keyword: string
  count: number
  responseCount: number
}

// Stable domain contract consumed by the server-side form API and parallel UI work.
export type EntityId = string
export type FormStatus = FormLifecycleStatus
export type AccessMode = 'anyone' | 'authenticated' | 'university' | 'restricted'
export type DuplicatePolicy = 'allow' | 'account_once' | 'browser_once'
export type DomainQuestionType =
  | QuestionType
  | 'single_choice'
  | 'multiple_choice'
  | 'dropdown'
  | 'email'
  | 'phone'
  | 'student_id'
  | 'address'
  | 'date'
  | 'time'
  | 'datetime'
  | 'duration'
  | 'file_upload'
  | 'image_upload'
  | 'linear_scale'
  | 'like'
  | 'single_grid'
  | 'multiple_grid'
  | 'privacy_consent'
  | 'privacy_notice'
export type ContentType = DomainQuestionType | 'heading' | 'description' | 'divider' | 'image' | 'video'
export type AnswerValue = string | number | boolean | string[] | Record<string, string | string[]> | null

export interface Option {
  id: EntityId
  label: string
  imageUrl?: string
  isOther?: boolean
}

export interface QuestionValidation {
  minSelections?: number
  maxSelections?: number
  exactSelections?: number
  min?: number
  max?: number
  integerOnly?: boolean
  minLength?: number
  maxLength?: number
  format?: 'email' | 'phone' | 'student_id'
  studentIdLength?: number
  pattern?: string
  emailDomain?: string
  minDate?: string
  maxDate?: string
  allRowsRequired?: boolean
  uniqueColumns?: boolean
  fileTypes?: string[]
  maxFiles?: number
  maxFileSizeMb?: number
  errorMessage?: string
}

export interface Question {
  id: EntityId
  sectionId: EntityId
  type: ContentType
  title: string
  description?: string
  required: boolean
  options?: Option[]
  rows?: Option[]
  columns?: Option[]
  validation?: QuestionValidation
  shuffleOptions?: boolean
  imageUrl?: string
  videoUrl?: string
}

export interface Section {
  id: EntityId
  title: string
  description?: string
  questionIds: EntityId[]
  nextSectionId?: EntityId | 'submit'
}

export interface BranchRule {
  id: EntityId
  questionId: EntityId
  operator: 'equals' | 'not_equals' | 'includes' | 'not_includes'
  optionId?: EntityId
  value?: AnswerValue
  destination: { type: 'section'; sectionId: EntityId } | { type: 'submit' } | { type: 'block' }
}

export interface FormAccess {
  mode: AccessMode
  allowAnonymous: boolean
  collectVerifiedEmail: boolean
  allowedEmailDomains: string[]
  allowedUids: string[]
  allowedGroups: string[]
  duplicatePolicy: DuplicatePolicy
  universityDomain?: string
}

export interface FormSchedule {
  startAt: string | null
  endAt: string | null
  maxResponses: number | null
  closedMessage: string
  showBeforeOpen: boolean
  resultsPublic: boolean
}

export interface Theme {
  id: string
  accent?: string
  coverImageUrl?: string
  icon?: string
}

export interface FormVersion {
  version: number
  createdAt: string
  createdBy: string
  summary: string
}

export interface Form {
  formId: EntityId
  creatorUid: string
  title: string
  description: string
  formType: FormType
  status: FormStatus
  sections: Section[]
  questions: Question[]
  branchRules: BranchRule[]
  access: FormAccess
  schedule: FormSchedule
  theme: Theme
  slug: string | null
  randomId: string
  responseCount: number
  version: number
  versionHistory?: FormVersion[]
  createdAt?: string
  updatedAt?: string
}

export interface Answer {
  questionId: EntityId
  value: AnswerValue
  fileIds?: EntityId[]
}

export interface Respondent {
  respondentUid?: string
  anonymousId?: string
  respondentEmail?: string
  isAnonymous: boolean
}

export interface FormResponse {
  responseId: EntityId
  formId: EntityId
  submittedAt: string
  respondentUid?: string
  anonymousId?: string
  respondentEmail?: string
  answers: Answer[]
  status: ResponseStatus
  formVersion: number
}

export interface FormDraft {
  draftId: EntityId
  formId: EntityId
  creatorUid: string
  form: Form
  source: 'blank' | 'template' | 'ai'
  aiChanges?: string[]
  reviewWarnings: string[]
  saveState: 'saving' | 'saved' | 'failed'
  lastSavedAt?: string
}

export interface FormAccessDecision {
  allowed: boolean
  canSubmit: boolean
  reason:
    | 'ok'
    | 'not_found'
    | 'private'
    | 'not_started'
    | 'paused'
    | 'closed'
    | 'max_responses'
    | 'login_required'
    | 'university_account_required'
    | 'account_not_allowed'
    | 'duplicate'
  status: FormStatus
  responseCount: number
  remainingResponses: number | null
  remainingMs: number | null
}

export interface UploadMetadata {
  uploadId: EntityId
  formId: EntityId
  questionId: EntityId
  ownerUid: string
  storagePath: string
  fileName: string
  contentType: string
  size: number
  status: 'pending' | 'uploaded' | 'attached'
}
