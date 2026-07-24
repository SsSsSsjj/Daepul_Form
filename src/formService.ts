import { getFunctions, httpsCallable } from 'firebase/functions'
import type { User } from 'firebase/auth'
import type { Answer, FormAccessDecision } from './types'

type FunctionsApp = Parameters<typeof getFunctions>[0]

export interface PublicFormPayload {
  formId: string
  title: string
  description: string
  program: Record<string, unknown> | null
  formType: string
  sections: unknown[]
  questions: unknown[]
  branchRules: unknown[]
  access: Record<string, unknown>
  schedule: Record<string, unknown>
  theme: string | Record<string, unknown>
  status: string
  version: number
  responseCount: number
}

export function createFormService(app: FunctionsApp | null) {
  const functions = app ? getFunctions(app, 'asia-northeast3') : null
  const call = async <Input, Output>(name: string, input: Input): Promise<Output> => {
    if (!functions) throw new Error('Firebase가 설정되지 않았습니다.')
    return (await httpsCallable<Input, Output>(functions, name)(input)).data
  }

  return {
    getPublicForm(formId: string) {
      return call<{ formId: string }, { form: PublicFormPayload; access: FormAccessDecision }>('getPublicForm', { formId })
    },
    getPublicFormBySlug(userId: string, slug: string) {
      return call<{ userId: string; slug: string }, { form: PublicFormPayload; access: FormAccessDecision }>(
        'getPublicForm',
        { userId, slug },
      )
    },
    getFormAccess(formId: string) {
      return call<{ formId: string }, FormAccessDecision>('getFormAccess', { formId })
    },
    submitResponse(input: {
      formId: string
      answers: Answer[]
      anonymousId?: string
      respondentEmail?: string
      status?: 'submitted' | 'test'
    }) {
      return call<
        Omit<typeof input, 'answers'> & { answers: Record<string, Answer['value']> },
        { responseId: string }
      >('submitFormResponse', {
        ...input,
        answers: Object.fromEntries(input.answers.map(({ questionId, value }) => [questionId, value])),
      })
    },
    checkSlug(slug: string, formId?: string) {
      return call<{ slug: string; formId?: string }, { available: boolean; reason: 'invalid' | 'taken' | 'available' }>(
        'checkSlugAvailability',
        { slug, formId },
      )
    },
    reserveSlug(formId: string, slug: string) {
      return call<{ formId: string; slug: string }, { slug: string }>('reserveFormSlug', { formId, slug })
    },
    updateLifecycle(formId: string, status: string) {
      return call<{ formId: string; status: string }, { status: string }>('updateFormLifecycle', { formId, status })
    },
    listResponses(formId: string, pageSize = 50, cursor?: string) {
      return call<
        { formId: string; pageSize: number; cursor?: string },
        { items: Array<Record<string, unknown>>; nextCursor: string | null }
      >('listFormResponses', { formId, pageSize, cursor })
    },
  }
}

export function isRealAccount(user: User | null): user is User {
  return Boolean(user && !user.isAnonymous)
}
