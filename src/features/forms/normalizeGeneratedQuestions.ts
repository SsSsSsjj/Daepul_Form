import type { FormQuestion } from '../../types'

export type AiGeneratedQuestion = Omit<FormQuestion, 'id' | 'branch'> & {
  branchRules?: Array<{
    option: string
    action: 'next' | 'section' | 'submit'
    targetSectionId?: string
  }>
}

const maxQuestionsPerSection = 10

function optionSignature(question: FormQuestion) {
  if (question.type !== 'select') return ''
  return (question.options ?? []).map((option) => option.trim().toLocaleLowerCase()).join('\u0000')
}

export function normalizeGeneratedQuestions(items: AiGeneratedQuestion[], idBase = Date.now()) {
  const rawSectionIds = [...new Set(items
    .map((question) => question.sectionId?.trim())
    .filter((value): value is string => Boolean(value)))]
  const sectionIds = new Map(rawSectionIds.map((raw, index) => {
    const slug = raw.toLocaleLowerCase()
      .replace(/[^a-z0-9가-힣-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
    return [raw, slug ? `section-${slug}` : `section-${index + 1}`]
  }))
  const reviewNotes: string[] = []

  const normalized = items.map((question, index) => {
    const selectable = question.type === 'select' || question.type === 'checkbox'
    const options = question.options?.map((option) => option.trim()).filter(Boolean) ?? []
    const rawSectionId = question.sectionId?.trim()
    const sectionId = rawSectionId ? sectionIds.get(rawSectionId) : undefined
    const rawSectionNext = question.sectionNext?.trim()
    const sectionNext = rawSectionNext === 'submit'
      ? 'submit'
      : rawSectionNext
        ? sectionIds.get(rawSectionNext)
        : undefined
    const branch = question.type === 'select'
      ? Object.fromEntries((question.branchRules ?? []).flatMap((rule) => {
        const option = rule.option?.trim()
        if (!option || !options.includes(option) || rule.action === 'next') return []
        if (rule.action === 'submit') return [[option, 'submit']]
        const target = rule.targetSectionId?.trim()
          ? sectionIds.get(rule.targetSectionId.trim())
          : undefined
        if (!target) {
          reviewNotes.push(`“${question.label}”의 “${option}” 선택지가 존재하지 않는 섹션을 가리켜 이동 규칙을 적용하지 않았습니다.`)
          return []
        }
        return [[option, target]]
      }))
      : undefined
    const { branchRules: _branchRules, ...formQuestion } = question
    void _branchRules
    return {
      ...formQuestion,
      id: idBase + index,
      inputFormat: question.type === 'short_text' && ['email', 'phone', 'date'].includes(question.inputFormat ?? '')
        ? question.inputFormat
        : 'none',
      options: selectable ? (options.length >= 2 ? options : ['선택지 1', '선택지 2']) : undefined,
      sectionId,
      sectionTitle: sectionId ? question.sectionTitle?.trim() || '제목 없는 섹션' : undefined,
      sectionNext,
      branch: branch && Object.keys(branch).length ? branch : undefined,
    } satisfies FormQuestion
  })

  const compacted: FormQuestion[] = []
  const sectionOrder = [...new Set(normalized.map((question) => question.sectionId ?? ''))]
  let removedCount = 0

  for (const sectionId of sectionOrder) {
    const sectionQuestions = normalized.filter((question) => (question.sectionId ?? '') === sectionId)
    const branchOptionSignatures = new Set(sectionQuestions
      .filter((question) => question.branch && Object.keys(question.branch).length)
      .map(optionSignature)
      .filter(Boolean))
    const withoutRepeatedRoutingPrompts = sectionQuestions.filter((question) => {
      const repeated = !question.branch
        && branchOptionSignatures.has(optionSignature(question))
      if (repeated) removedCount += 1
      return !repeated
    })

    if (withoutRepeatedRoutingPrompts.length <= maxQuestionsPerSection) {
      compacted.push(...withoutRepeatedRoutingPrompts)
      continue
    }

    const branchQuestions = withoutRepeatedRoutingPrompts.filter((question) => question.branch)
    const regularQuestions = withoutRepeatedRoutingPrompts.filter((question) => !question.branch)
    const availableRegularSlots = Math.max(0, maxQuestionsPerSection - branchQuestions.length)
    compacted.push(...regularQuestions.slice(0, availableRegularSlots), ...branchQuestions)
    removedCount += withoutRepeatedRoutingPrompts.length - maxQuestionsPerSection
  }

  if (removedCount > 0) {
    reviewNotes.push(`AI가 반복 생성한 분기 질문 ${removedCount}개를 정리했습니다. 섹션별 질문과 이동 규칙을 배포 전에 확인해 주세요.`)
  }

  return { questions: compacted, reviewNotes }
}
