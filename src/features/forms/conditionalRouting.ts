import type { FormQuestion } from '../../types'

export const defaultSectionId = 'section-main'

export type QuestionSection = {
  id: string
  title: string
  questions: FormQuestion[]
}

function sectionIdFor(question: FormQuestion) {
  return question.sectionId?.trim() || defaultSectionId
}

export function getQuestionSections(questions: FormQuestion[]): QuestionSection[] {
  const sections: QuestionSection[] = []
  questions.forEach((question) => {
    const id = sectionIdFor(question)
    const existing = sections.find((section) => section.id === id)
    if (existing) {
      existing.questions.push(question)
      if (!existing.title && question.sectionTitle?.trim()) existing.title = question.sectionTitle.trim()
      return
    }
    sections.push({
      id,
      title: question.sectionTitle?.trim() || (id === defaultSectionId ? '기본 섹션' : '제목 없는 섹션'),
      questions: [question],
    })
  })
  return sections
}

export function branchTargetForSection(
  section: QuestionSection,
  answers: Record<string, unknown>,
) {
  for (const question of section.questions) {
    if (question.type !== 'select' || !question.branch) continue
    const target = question.branch[String(answers[String(question.id)] ?? '')]
    if (target) return target
  }
  return section.questions.find(({ sectionNext }) => sectionNext)?.sectionNext
}

export function resolveResponseRoute(
  questions: FormQuestion[],
  answers: Record<string, unknown>,
) {
  const sections = getQuestionSections(questions)
  if (!sections.length) return { sectionIds: [] as string[], questionIds: [] as number[], terminal: 'end' as const }

  const sectionIds: string[] = []
  const questionIds: number[] = []
  const visited = new Set<string>()
  let sectionIndex = 0
  let terminal: 'end' | 'submit' | 'cycle' = 'end'

  while (sectionIndex >= 0 && sectionIndex < sections.length) {
    const section = sections[sectionIndex]
    if (visited.has(section.id)) {
      terminal = 'cycle'
      break
    }
    visited.add(section.id)
    sectionIds.push(section.id)
    questionIds.push(...section.questions.map(({ id }) => id))

    const branchTarget = branchTargetForSection(section, answers)
    if (branchTarget === 'submit') {
      terminal = 'submit'
      break
    }
    if (branchTarget) {
      const targetIndex = sections.findIndex(({ id }) => id === branchTarget)
      if (targetIndex < 0) break
      sectionIndex = targetIndex
      continue
    }
    sectionIndex += 1
  }

  return { sectionIds, questionIds, terminal }
}

export function answersForResponseRoute(
  questions: FormQuestion[],
  answers: Record<string, unknown>,
) {
  const activeIds = new Set(resolveResponseRoute(questions, answers).questionIds.map(String))
  return Object.fromEntries(Object.entries(answers).filter(([id]) => activeIds.has(id)))
}

export function routingWarnings(questions: FormQuestion[]) {
  const warnings: string[] = []
  const sections = getQuestionSections(questions)
  const sectionIds = new Set(sections.map(({ id }) => id))
  const edges = new Map<string, string[]>()

  questions.forEach((question) => {
    if (!question.branch || !Object.keys(question.branch).length) return
    if (question.type !== 'select') {
      warnings.push(`“${question.label || '제목 없는 질문'}”은 단일 선택 객관식만 답변별 이동을 사용할 수 있습니다.`)
      return
    }
    const options = new Set(question.options ?? [])
    Object.entries(question.branch).forEach(([option, target]) => {
      if (!options.has(option)) warnings.push(`“${question.label || '제목 없는 질문'}”의 삭제된 선택지에 이동 규칙이 남아 있습니다.`)
      if (target !== 'submit' && !sectionIds.has(target)) warnings.push(`“${question.label || '제목 없는 질문'}”이 존재하지 않는 섹션으로 이동합니다.`)
      if (target !== 'submit' && sectionIds.has(target)) {
        const source = sectionIdFor(question)
        edges.set(source, [...(edges.get(source) ?? []), target])
      }
    })
  })
  sections.forEach((section) => {
    const target = section.questions.find(({ sectionNext }) => sectionNext)?.sectionNext
    if (!target || target === 'submit') return
    if (!sectionIds.has(target)) warnings.push(`“${section.title}” 섹션이 존재하지 않는 다음 섹션으로 이동합니다.`)
    else edges.set(section.id, [...(edges.get(section.id) ?? []), target])
  })

  const visited = new Set<string>()
  const visiting = new Set<string>()
  const hasCycle = (sectionId: string): boolean => {
    if (visiting.has(sectionId)) return true
    if (visited.has(sectionId)) return false
    visiting.add(sectionId)
    const cyclic = (edges.get(sectionId) ?? []).some(hasCycle)
    visiting.delete(sectionId)
    visited.add(sectionId)
    return cyclic
  }
  if (sections.some(({ id }) => hasCycle(id))) warnings.push('섹션 이동이 순환하도록 설정되어 응답자가 설문을 끝낼 수 없습니다.')

  return [...new Set(warnings)]
}

export function nextSectionId() {
  return `section-${crypto.randomUUID().slice(0, 8)}`
}
