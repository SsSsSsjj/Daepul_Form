import type { AnswerValue, Question, QuestionValidation } from '../types'

export interface FieldValidationResult {
  questionId: string
  valid: boolean
  message?: string
}

function empty(value: AnswerValue | undefined) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

function validationMessage(validation: QuestionValidation | undefined, fallback: string) {
  return validation?.errorMessage?.trim() || fallback
}

export function validateAnswer(question: Question, value: AnswerValue | undefined): FieldValidationResult {
  const fail = (fallback: string): FieldValidationResult => ({
    questionId: question.id,
    valid: false,
    message: validationMessage(question.validation, fallback),
  })
  if (empty(value)) return question.required ? fail('필수 질문입니다.') : { questionId: question.id, valid: true }

  const rules = question.validation
  const values = Array.isArray(value) ? value : [value]
  if (rules?.minSelections !== undefined && values.length < rules.minSelections) return fail(`최소 ${rules.minSelections}개를 선택해 주세요.`)
  if (rules?.maxSelections !== undefined && values.length > rules.maxSelections) return fail(`최대 ${rules.maxSelections}개까지 선택할 수 있습니다.`)
  if (rules?.exactSelections !== undefined && values.length !== rules.exactSelections) return fail(`${rules.exactSelections}개를 선택해 주세요.`)

  if (typeof value === 'number') {
    if (rules?.min !== undefined && value < rules.min) return fail(`${rules.min} 이상의 값을 입력해 주세요.`)
    if (rules?.max !== undefined && value > rules.max) return fail(`${rules.max} 이하의 값을 입력해 주세요.`)
    if (rules?.integerOnly && !Number.isInteger(value)) return fail('정수만 입력할 수 있습니다.')
  }

  if (typeof value === 'string') {
    if (rules?.minLength !== undefined && value.length < rules.minLength) return fail(`${rules.minLength}자 이상 입력해 주세요.`)
    if (rules?.maxLength !== undefined && value.length > rules.maxLength) return fail(`${rules.maxLength}자 이하로 입력해 주세요.`)
    if ((question.type === 'email' || rules?.format === 'email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return fail('올바른 이메일 주소를 입력해 주세요.')
    if ((question.type === 'phone' || rules?.format === 'phone') && !/^[0-9+\-()\s]{8,20}$/.test(value)) return fail('올바른 전화번호를 입력해 주세요.')
    if (question.type === 'student_id' || rules?.format === 'student_id') {
      const length = rules?.studentIdLength
      if (!/^\d+$/.test(value) || (length !== undefined && value.length !== length)) {
        return fail(length ? `학번은 숫자 ${length}자리로 입력해 주세요.` : '학번은 숫자로 입력해 주세요.')
      }
    }
    if (rules?.emailDomain && !value.toLowerCase().endsWith(`@${rules.emailDomain.toLowerCase()}`)) return fail(`${rules.emailDomain} 이메일만 사용할 수 있습니다.`)
    if (rules?.pattern) {
      try {
        if (!new RegExp(rules.pattern).test(value)) return fail('입력 형식이 맞지 않습니다.')
      } catch {
        return fail('제작자가 설정한 정규표현식이 올바르지 않습니다.')
      }
    }
    if (rules?.minDate && value < rules.minDate) return fail(`${rules.minDate} 이후 날짜를 선택해 주세요.`)
    if (rules?.maxDate && value > rules.maxDate) return fail(`${rules.maxDate} 이전 날짜를 선택해 주세요.`)
  }
  return { questionId: question.id, valid: true }
}

export function validateAnswers(questions: Question[], answers: Record<string, AnswerValue>) {
  return questions.map((question) => validateAnswer(question, answers[question.id])).filter((result) => !result.valid)
}
